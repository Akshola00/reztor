import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'

import type {
  DissolveReason,
  JoinTicket,
  LobbyAck,
  LobbyUpdateMessage,
  PlayerId,
  PrivateView,
  SettlementConfirmedMessage,
  Side,
  StakeRequest,
  Tier,
  VoteTarget,
} from '../../protocol/generated'
import { createMatchStore } from '../state/match'
import { createLoopback, type Loopback } from './loopback'
import { BATCH_INTERVAL_MS, createOutbox, tapBatches, type Outbox } from './outbox'
import { createClient, type ReztorClient } from './socket'

// The one connection to the server, and everything tied to its lifetime: the ticket and session
// token, the heartbeat, the AppState reconnect, and the authoritative match store the socket
// writes. Module state rather than React context: the tap path and the batch timer read it
// synchronously, and it has to outlive route changes.
//
// The ticket — and with it the session token, the only thing that can reclaim the seat — is also
// written to AsyncStorage (item 5), so an app the OS killed, or the player force-stopped, rejoins
// its match on launch. It is cleared on MATCH_END, on a confirmed leave, and when the lobby
// dissolves or the server no longer knows the seat.

/** ../server/src/main.ts: `PORT ?? 3000`. Socket.IO's default path, /socket.io/. */
export const DEFAULT_PORT = 3000
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? `http://localhost:${DEFAULT_PORT}`

/** PROTOCOL.md §4 and server/src/net/auth.ts. Three missed beats start the grace clock. */
const HEARTBEAT_INTERVAL_MS = 2000
/** PROTOCOL.md §5: the heartbeat lapses after three missed beats, six seconds. */
const HEARTBEAT_LAPSE_MS = 3 * HEARTBEAT_INTERVAL_MS

/**
 * The socket's state, for the screens that must say so (§7.9). `idle` before anything has tried to
 * connect and after a leave; `offline` after a failed attempt or a dropped socket, while Socket.IO
 * retries on its own backoff.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline'

/**
 * The last LOBBY_UPDATE for this seat's lobby, and when it arrived on this phone's clock.
 * PROTOCOL.md §2: time left is `expiresAt - serverNow`, counted from arrival. The two clocks are
 * never compared with each other.
 */
export type LobbyState = { update: LobbyUpdateMessage; receivedAtMs: number }

/**
 * The funding stage (CHAIN-PROTOCOL-CHANGES.md §3), from the lobby filling until MATCH_STARTED or
 * LOBBY_DISSOLVED. `request` is the newest STAKE_REQUEST, which every JOIN rebuilds, and when it
 * arrived on this phone's clock; null until one arrives, and never sent once this seat has paid.
 * `staked` is STAKE_UPDATE's seat numbers. Null outside the funding stage.
 */
export type FundingState = {
  request: { stake: StakeRequest; receivedAtMs: number } | null
  staked: number[]
}

/** SETTLEMENT_CONFIRMED without its envelope tick: the chain has paid out MATCH_END's numbers. */
export type SettledState = Pick<SettlementConfirmedMessage, 'matchId' | 'signature' | 'payouts'>

/** PROTOCOL.md §4: chat messages are at most 240 characters. */
export const CHAT_MAX = 240

/**
 * PROTOCOL.md §4: one chat message per 2 seconds, which the server measures in ticks (8). A
 * message is applied on the tick after it arrives, so two sends exactly 2000ms apart can land 7
 * ticks apart when the first arrives late in its tick. One extra tick of margin means
 * CHAT_RATE_LIMITED never fires.
 */
export const CHAT_INTERVAL_MS = 2000 + 250

/** PROTOCOL.md §2 and ../server/src/match/lobby.ts: no I, O, 0 or 1, four characters. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 4

/** ../server/src/net/handlers.ts CreateLobbySchema: `z.string().min(1).max(32)`. */
export const NAME_MAX = 32

/** Dev tools, and the rehearsal, exist in dev builds and in release builds made with this flag. */
export const DEV_TOOLS = __DEV__ || process.env.EXPO_PUBLIC_DEV_TOOLS === '1'

export const match = createMatchStore()

let client: ReztorClient | null = null
let ticket: JoinTicket | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let appState: { remove: () => void } | null = null
let markingPending = false
let rehearsal: { outbox: Outbox; loopback: Loopback; timer: ReturnType<typeof setInterval> } | null = null
let rehearsalCount = 0
let rehearsalRole: Side = 'crew'
/** The vote this client last cast, and in which round. Survives the Judgement region remounting. */
let myVote: { round: number; target: VoteTarget } | null = null
let lastChatAtMs = 0
let lobby: LobbyState | null = null
let funding: FundingState | null = null
let settled: SettledState | null = null
let status: ConnectionStatus = 'idle'
/** When the socket last dropped, and when this phone last sent a heartbeat over a live socket. */
let lostAtMs = 0
let lastBeatAtMs = 0

const TICKET_KEY = 'reztor.ticket'

/** The server reads the chain to build a STAKE_REQUEST, so allow it a few round trips. */
const FRESH_STAKE_TIMEOUT_MS = 10_000

function persistTicket(value: JoinTicket) {
  // Fire and forget: a failed write costs only the rejoin after a restart, never the match.
  AsyncStorage.setItem(TICKET_KEY, JSON.stringify(value)).catch(() => undefined)
}

function forgetTicket() {
  AsyncStorage.removeItem(TICKET_KEY).catch(() => undefined)
}

async function readTicket(): Promise<JoinTicket | null> {
  try {
    const raw = await AsyncStorage.getItem(TICKET_KEY)
    return raw === null ? null : (JSON.parse(raw) as JoinTicket)
  } catch {
    return null
  }
}

/**
 * Where the app opens: home, the lobby this seat is waiting in, or the running match. `ended` is
 * home after a JOIN found the match already resolved.
 */
export type BootTarget = { route: 'home'; ended?: boolean } | { route: 'lobby'; code: string } | { route: 'match' }
let booted: Promise<BootTarget> | null = null
let bootTarget: BootTarget | null = null

const startedListeners = new Set<() => void>()
const resumeListeners = new Set<() => void>()
const lostListeners = new Set<() => void>()
const lobbyListeners = new Set<() => void>()
const dissolvedListeners = new Set<(reason: DissolveReason) => void>()
const fundingListeners = new Set<() => void>()
const settledListeners = new Set<() => void>()

const emit = (listeners: Set<() => void>) => {
  for (const listener of listeners) listener()
}

function getClient(): ReztorClient {
  if (client !== null) return client
  const c = createClient(SERVER_URL)

  // The dev log lines carry the transition only, never a payload.
  c.onDisconnect(() => {
    if (__DEV__) console.log('[net] disconnected')
    if (status === 'online') lostAtMs = Date.now()
    status = 'offline'
  })
  c.onConnectError(() => {
    status = 'offline'
  })
  c.onConnect(() => {
    if (__DEV__) console.log('[net] connected')
    status = 'online'
    lastBeatAtMs = Date.now()
    // A live socket and a rehearsal can never run together.
    stopRehearsal()
    // Every (re)connect re-binds this socket to the seat. The server answers with RESUME_STATE
    // when the match is running, or `waiting` while the lobby fills.
    if (ticket !== null) void rejoin()
  })

  // Only this seat's lobby: a socket can briefly hear a room it is leaving.
  c.on('LOBBY_UPDATE', (message) => {
    if (message.matchId !== ticket?.matchId) return
    lobby = { update: message, receivedAtMs: Date.now() }
    emit(lobbyListeners)
  })
  c.on('LOBBY_DISSOLVED', ({ matchId, reason }) => {
    if (matchId !== ticket?.matchId) return
    forgetTicket()
    setFunding(null)
    for (const listener of dissolvedListeners) listener(reason)
  })

  // The transaction is the player's to sign; nothing is sent back. The server watches the chain.
  c.on('STAKE_REQUEST', ({ matchId, tx, expiresAt, serverNow }) => {
    if (matchId !== ticket?.matchId) return
    setFunding({
      request: { stake: { tx, expiresAt, serverNow }, receivedAtMs: Date.now() },
      staked: funding?.staked ?? [],
    })
  })
  c.on('STAKE_UPDATE', ({ matchId, staked }) => {
    if (matchId !== ticket?.matchId) return
    setFunding({ request: funding?.request ?? null, staked })
  })

  c.on('MATCH_STARTED', (message) => {
    setFunding(null)
    markingPending = true
    match.applyView(message.view, message.serverTick)
    emit(startedListeners)
  })
  c.on('RESUME_STATE', (message) => {
    // Listeners first, so the match screen drops its pending taps before the view lands and the
    // reconcile that follows sees none. Applied wholesale, silently.
    emit(resumeListeners)
    match.applyView(message.view, message.serverTick)
  })
  c.on('BOARD_UPDATE', (message) => match.applyBoard(message.board, message.serverTick))
  c.on('CREDITS', (message) => match.applyCredits(message, message.serverTick))
  c.on('STAGE_CHANGE', (message) => match.applyStageChange(message, message.serverTick))
  c.on('CHAT_MESSAGE', ({ from, text, tick }) => match.appendChat({ from, text, tick }))
  c.on('MATCH_END', (message) => {
    // The seat is finished. Nothing may rejoin it: not a reconnect, not the next launch.
    forgetTicket()
    ticket = null
    stopHeartbeat()
    match.applyEnd(
      'error' in message ? { error: message.error } : { reveal: message.reveal, settlement: message.settlement },
    )
  })
  // After MATCH_END, so the ticket is already gone: matched against the match this phone played.
  c.on('SETTLEMENT_CONFIRMED', ({ matchId, signature, payouts }) => {
    if (matchId !== match.snapshot()?.matchId) return
    settled = { matchId, signature, payouts }
    emit(settledListeners)
  })
  c.on('TRACE_RESULT', ({ target, result }) => {
    // Dev only, so a test can check the card against what the server sent. The reading is this
    // player's own purchase; it carries no role.
    if (__DEV__) console.log('[net] TRACE_RESULT', target, result)
    match.applyTraceResult({ target, result })
  })
  // Hard rule 1: only the toll's size is kept. The source and sink are dropped here, unread — and
  // the dev log below prints the size alone, for the same reason.
  c.on('SIPHON_RESULT', ({ destroyed }) => {
    if (__DEV__) console.log('[net] SIPHON_RESULT destroyed', destroyed)
    match.applySiphonDestroyed(destroyed)
  })
  c.on('VOTE_RESULT', ({ round, votes, ejected, serverTick }) => {
    match.applyVoteResult({ round, votes, ejected }, serverTick)
    myVote = null
  })
  c.on('ACTION_REJECTED', ({ action, code, reason }) => {
    // PROTOCOL.md §3: a well-behaved client sees none. Logged so a test can count them.
    console.warn('[net] ACTION_REJECTED', action, code, reason)
  })

  client = c
  return c
}

function ensureConnected(): ReztorClient {
  const c = getClient()
  if (!c.connected()) {
    if (status !== 'offline') status = 'connecting'
    c.connect()
  }
  return c
}

async function rejoin(): Promise<void> {
  if (ticket === null) return
  try {
    const ack = await getClient().request('JOIN', { matchId: ticket.matchId, sessionToken: ticket.sessionToken })
    if (!ack.ok) {
      forgetTicket()
      emit(lostListeners)
    }
  } catch {
    // Timed out or dropped. The next connect event tries again.
  }
}

function setFunding(next: FundingState | null) {
  if (next === null && funding === null) return
  funding = next
  emit(fundingListeners)
}

function startHeartbeat() {
  if (heartbeat !== null) return
  heartbeat = setInterval(() => {
    if (!client?.connected()) return
    client.send('HEARTBEAT', {})
    lastBeatAtMs = Date.now()
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeat !== null) clearInterval(heartbeat)
  heartbeat = null
}

function watchAppState() {
  if (appState !== null) return
  let previous = AppState.currentState
  const subscription = AppState.addEventListener('change', (next) => {
    const returning = previous !== 'active' && next === 'active'
    previous = next
    if (!returning || ticket === null) return
    // BUILD-PLAN.md §6: Android kills the socket in the background. Reconnect, JOIN with the same
    // token, and let RESUME_STATE replace everything. If the socket survived, JOIN anyway: the
    // heartbeat may have lapsed and the server only learns the player is back from a JOIN.
    const c = getClient()
    if (c.connected()) void rejoin()
    else c.connect()
  })
  appState = subscription
}

function stopRehearsal() {
  if (rehearsal === null) return
  clearInterval(rehearsal.timer)
  rehearsal = null
}

export const session = {
  serverUrl: SERVER_URL,

  ticket: (): JoinTicket | null => ticket,

  /** `wallet` is the connected wallet's base58 address. Chain escrow requires it; fake escrow ignores it. */
  async createLobby(name: string, wallet: string): Promise<LobbyAck> {
    return this.seat(ensureConnected().request('CREATE_LOBBY', { name, wallet }))
  },

  async joinLobby(code: string, name: string, wallet: string): Promise<LobbyAck> {
    return this.seat(ensureConnected().request('JOIN_LOBBY', { code, name, wallet }))
  },

  /** PROTOCOL.md §2: send JOIN as soon as a ticket arrives, without waiting for the lobby. */
  async seat(request: Promise<LobbyAck>): Promise<LobbyAck> {
    const ack = await request
    if (!ack.ok) return ack
    match.clear()
    lobby = null
    setFunding(null)
    settled = null
    ticket = ack.ticket
    persistTicket(ack.ticket)
    startHeartbeat()
    watchAppState()
    await rejoin()
    return ack
  },

  lobby: (): LobbyState | null => lobby,

  funding: (): FundingState | null => funding,

  /**
   * CHAIN-PROTOCOL-CHANGES.md §3: JOIN for a newly built STAKE_REQUEST and wait for it. The stake
   * is signed from this, never from the one that arrived when the lobby filled: a blockhash lives
   * about 150 blocks, which on devnet has measured as little as 38s, so a transaction held while
   * the player reads the screen can expire inside the wallet. Null if the funding stage ends or no
   * fresh transaction arrives in time.
   */
  freshStake(): Promise<StakeRequest | null> {
    const before = funding?.request?.stake.tx
    return new Promise((resolve) => {
      const done = (stake: StakeRequest | null) => {
        clearTimeout(timer)
        fundingListeners.delete(check)
        resolve(stake)
      }
      const check = () => {
        if (funding === null) done(null)
        else if (funding.request !== null && funding.request.stake.tx !== before) done(funding.request.stake)
      }
      const timer = setTimeout(() => done(null), FRESH_STAKE_TIMEOUT_MS)
      fundingListeners.add(check)
      void rejoin()
    })
  },

  settled: (): SettledState | null => settled,

  /**
   * Once per launch, before home renders: if a ticket survived a restart, JOIN with it. A running
   * match answers with RESUME_STATE, applied before the ack resolves, so the match screen opens on
   * the real board. UNKNOWN_SESSION or WRONG_MATCH clears the ticket and opens home. An unreachable
   * server keeps the ticket for the next launch and opens home.
   */
  boot(): Promise<BootTarget> {
    booted ??= (async (): Promise<BootTarget> => {
      const saved = await readTicket()
      if (saved === null) return { route: 'home' }
      let ack
      try {
        // `ticket` stays null until the ack, so the connect handler does not send a second JOIN.
        ack = await ensureConnected().request('JOIN', { matchId: saved.matchId, sessionToken: saved.sessionToken })
      } catch {
        return { route: 'home' }
      }
      if (!ack.ok) {
        forgetTicket()
        return { route: 'home' }
      }
      if (ack.waiting === true) {
        ticket = saved
        startHeartbeat()
        watchAppState()
        return { route: 'lobby', code: saved.code }
      }
      const resumed = match.snapshot()
      if (resumed === null) return { route: 'home' }
      // A match that resolved while this phone was gone. MATCH_END went to the room once and is
      // not resent, so there is no reveal to show — only that the rite is over. Never rejoin it.
      if (resumed.resolution !== null) {
        forgetTicket()
        match.clear()
        return { route: 'home', ended: true }
      }
      ticket = saved
      startHeartbeat()
      watchAppState()
      return { route: 'match' }
    })().then((target) => {
      if (__DEV__) console.log('[boot] route', target.route)
      bootTarget = target
      return target
    })
    return booted
  },

  /** The launch destination, once: the home route redirects on it the first time and never again. */
  takeBootTarget(): BootTarget {
    const target = bootTarget ?? { route: 'home' }
    bootTarget = { route: 'home' }
    return target
  },

  /**
   * PROTOCOL.md §2: there is no leave message. Closing the socket is the leave; the server frees
   * the seat about 21s later and tells the room.
   */
  leave() {
    forgetTicket()
    ticket = null
    lobby = null
    setFunding(null)
    settled = null
    markingPending = false
    stopHeartbeat()
    appState?.remove()
    appState = null
    stopRehearsal()
    match.clear()
    client?.disconnect()
    status = 'idle'
  },

  status: (): ConnectionStatus => status,

  /**
   * §7.9's grace countdown: seconds this seat has left to return, counted down from when the socket
   * dropped. PROTOCOL.md §5 starts the server's clock at the later of the socket closing and the
   * heartbeat lapsing, and the server can only learn of the close after this phone does, so this
   * errs early — it never promises more time than the seat has. Null while connected.
   */
  graceLeftSec(graceSec: number): number | null {
    if (status === 'online') return null
    const start = Math.max(lostAtMs, lastBeatAtMs + HEARTBEAT_LAPSE_MS)
    return Math.max(0, Math.ceil((start + graceSec * 1000 - Date.now()) / 1000))
  },

  /** Home connects on open, so it can say whether the server is there before anyone presses. */
  connect() {
    if (rehearsal !== null) return
    const c = getClient()
    if (c.connected() || status === 'connecting') return
    status = 'connecting'
    c.connect()
  },

  /**
   * Home's retry: a fresh attempt now rather than at the end of Socket.IO's backoff, then the
   * launch-time rejoin again, in case a ticket was kept because the server was down at launch.
   */
  retry(): Promise<BootTarget> {
    const c = getClient()
    if (!c.connected()) {
      c.disconnect()
      status = 'connecting'
      c.connect()
    }
    booted = null
    return this.boot().then(() => this.takeBootTarget())
  },

  /** True once per MATCH_STARTED, for the match screen to play the Marking. */
  takeMarking(): boolean {
    const pending = markingPending
    markingPending = false
    return pending
  },

  onStarted(listener: () => void) {
    startedListeners.add(listener)
    return () => {
      startedListeners.delete(listener)
    }
  },
  onResume(listener: () => void) {
    resumeListeners.add(listener)
    return () => {
      resumeListeners.delete(listener)
    }
  },
  onLobby(listener: () => void) {
    lobbyListeners.add(listener)
    return () => {
      lobbyListeners.delete(listener)
    }
  },
  onFunding(listener: () => void) {
    fundingListeners.add(listener)
    return () => {
      fundingListeners.delete(listener)
    }
  },
  onSettled(listener: () => void) {
    settledListeners.add(listener)
    return () => {
      settledListeners.delete(listener)
    }
  },
  /** LOBBY_DISSOLVED for this seat's lobby. The session is already gone on the server. */
  onDissolved(listener: (reason: DissolveReason) => void) {
    dissolvedListeners.add(listener)
    return () => {
      dissolvedListeners.delete(listener)
    }
  },
  /**
   * The server no longer knows this seat: a lobby that dissolved or freed it while this phone was
   * away, or a match that has gone.
   */
  onLost(listener: () => void) {
    lostListeners.add(listener)
    return () => {
      lostListeners.delete(listener)
    }
  },

  /** Taps from the batch timer: over the socket, or into the rehearsal's outbox. */
  sendTaps(tier: Tier, count: number) {
    if (rehearsal !== null) {
      rehearsal.outbox.pushTaps(tier, count)
      return
    }
    if (!client?.connected()) return
    for (const payload of tapBatches(tier, count)) client.send('TAP_BATCH', payload)
  },

  /** Milliseconds until the next chat message may be sent; 0 when it may be sent now. */
  chatWaitMs(): number {
    return Math.max(0, lastChatAtMs + CHAT_INTERVAL_MS - Date.now())
  },

  sendChat(text: string): boolean {
    if (!client?.connected() || this.chatWaitMs() > 0) return false
    lastChatAtMs = Date.now()
    client.send('CHAT', { text })
    return true
  },

  /** The vote cast this round, if any: local memory first, then the server's view on a resume. */
  myVote(round: number): VoteTarget | null {
    if (myVote !== null && myVote.round === round) return myVote.target
    const s = match.snapshot()
    return s !== null && s.round === round && s.stage === 'vote' ? s.currentVote : null
  },

  vote(round: number, target: VoteTarget) {
    if (!client?.connected()) return
    myVote = { round, target }
    client.send('VOTE', { target })
  },

  /** Augury. The sheet checks every rule the server would, so nothing sent here is refused. */
  trace(target: PlayerId) {
    if (client?.connected()) client.send('TRACE', { target })
  },

  /** The Draw. The sheet checks every rule the server would, so nothing sent here is refused. */
  siphon(source: PlayerId, sink: PlayerId) {
    if (client?.connected()) client.send('SIPHON', { source, sink })
  },

  setTier(tier: Tier) {
    if (rehearsal !== null) {
      rehearsal.outbox.pushSetTier(tier)
      return
    }
    if (client?.connected()) client.send('SET_TIER', { tier })
  },

  // -- Dev rehearsal ---------------------------------------------------------------------------

  isRehearsal: () => rehearsal !== null,

  /**
   * A local match with fixture lanes and the loopback standing in for the server. Refused unless
   * dev tools are on and no socket is connected; a socket connecting later stops it.
   */
  startRehearsal(role: Side = rehearsalRole): boolean {
    if (!DEV_TOOLS) return false
    // Home's own connection is only a probe; a seat's socket is not given up for a rehearsal.
    if (client?.connected()) {
      if (ticket !== null) return false
      client.disconnect()
      status = 'idle'
    }
    rehearsalRole = role
    stopRehearsal()
    rehearsalCount += 1
    match.applyView(rehearsalView(`rehearsal-${rehearsalCount}`, role), 0)
    const outbox = createOutbox()
    const loopback = createLoopback(outbox, match, REHEARSAL_YOU)
    const timer = setInterval(() => {
      if (client?.connected()) stopRehearsal()
      else loopback.tick()
    }, BATCH_INTERVAL_MS)
    rehearsal = { outbox, loopback, timer }
    return true
  },

  setRehearsalDrop(on: boolean) {
    rehearsal?.loopback.setDrop(on)
  },

  dumpRehearsalOutbox() {
    if (rehearsal !== null) console.log('[outbox]', JSON.stringify(rehearsal.outbox.entries()))
  },

  /**
   * Ends the rehearsal with MATCH_END's error variant, which the dev server cannot produce: its
   * settlement only fails on a corrupt log. Written through the store's own door, so the match
   * screen takes the same path to the broken state as it would for a live one.
   */
  endRehearsalWithError() {
    if (rehearsal === null) return
    stopRehearsal()
    match.applyEnd({ error: 'UNBALANCED' })
  },
}

// -- Rehearsal fixture: mirrors ../server/src/engine/config.ts MVP_CONFIG -------------------------

const REHEARSAL_YOU = 'p-you'

// `role` exists so the closed board can be captured for both roles and compared (item 5): the
// rehearsal renders through the same components a live match does.
function rehearsalView(matchId: string, role: Side): PrivateView {
  const lanes = [
    { owner: 'p-2', units: 220, dormant: false },
    // Four units short of capacity: less room than a Draw delivers, so the rehearsal shows the
    // sheet refusing it as a sink. The own lane, at 0, shows a source below the pull.
    { owner: 'p-3', units: 996, dormant: false },
    { owner: 'p-4', units: 172, dormant: false },
    { owner: REHEARSAL_YOU, units: 0, dormant: false },
  ]
  return {
    matchId,
    config: {
      laneCapacity: 1000,
      winTarget: 2400,
      tapTiers: { 1: { cost: 1, units: 1 }, 2: { cost: 4, units: 3 } },
      tapRatePerSec: 6,
      siphon: { pull: 10, deliver: 6, costOther: 6, costSelf: 12, ratePerSec: 4 },
      trace: { cost: 200, perPlayer: 1 },
      dormantEfficiencyPct: 50,
      rounds: 3,
      stageDurations: { tap: 60, chat: 45, vote: 15 },
      buyInSkr: 12,
      creditsPerSkr: 100,
      rakeBps: 0,
      disconnectGraceSec: 30,
      lobbyFillTimeoutSec: 60,
    },
    phase: 'IN_PROGRESS',
    round: 1,
    stage: 'tap',
    // 60s at 4 ticks/sec from tick 0. The loopback's clock stands still, so this never arrives.
    stageEndsAtTick: 240,
    lanes,
    boardTotal: lanes.reduce((sum, lane) => sum + lane.units, 0),
    players: lanes.map((lane, i) => ({ id: lane.owner, name: `Seat ${i + 1}`, status: 'alive' as const })),
    chat: [],
    voteHistory: [],
    resolution: null,
    you: { id: REHEARSAL_YOU, role, credits: 1200, spent: 0, tier: 1, traceUsed: false },
    currentVote: null,
    traces: [],
    siphonActivity: null,
  }
}
