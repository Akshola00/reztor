import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'

import type {
  DissolveReason,
  JoinTicket,
  LobbyAck,
  LobbyUpdateMessage,
  PlayerId,
  PrivateView,
  Side,
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

/**
 * The last LOBBY_UPDATE for this seat's lobby, and when it arrived on this phone's clock.
 * PROTOCOL.md §2: time left is `expiresAt - serverNow`, counted from arrival. The two clocks are
 * never compared with each other.
 */
export type LobbyState = { update: LobbyUpdateMessage; receivedAtMs: number }

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

const TICKET_KEY = 'reztor.ticket'

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

/** Where the app opens: home, the lobby this seat is waiting in, or the running match. */
export type BootTarget = { route: 'home' } | { route: 'lobby'; code: string } | { route: 'match' }
let booted: Promise<BootTarget> | null = null
let bootTarget: BootTarget | null = null

const startedListeners = new Set<() => void>()
const resumeListeners = new Set<() => void>()
const lostListeners = new Set<() => void>()
const lobbyListeners = new Set<() => void>()
const dissolvedListeners = new Set<(reason: DissolveReason) => void>()

const emit = (listeners: Set<() => void>) => {
  for (const listener of listeners) listener()
}

function getClient(): ReztorClient {
  if (client !== null) return client
  const c = createClient(SERVER_URL)

  c.onConnect(() => {
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
    for (const listener of dissolvedListeners) listener(reason)
  })

  c.on('MATCH_STARTED', (message) => {
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
  c.on('MATCH_END', () => {
    forgetTicket()
    match.applyEnd()
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
  if (!c.connected()) c.connect()
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

function startHeartbeat() {
  if (heartbeat !== null) return
  heartbeat = setInterval(() => {
    if (client?.connected()) client.send('HEARTBEAT', {})
  }, HEARTBEAT_INTERVAL_MS)
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

  async createLobby(name: string): Promise<LobbyAck> {
    return this.seat(ensureConnected().request('CREATE_LOBBY', { name }))
  },

  async joinLobby(code: string, name: string): Promise<LobbyAck> {
    return this.seat(ensureConnected().request('JOIN_LOBBY', { code, name }))
  },

  /** PROTOCOL.md §2: send JOIN as soon as a ticket arrives, without waiting for the lobby. */
  async seat(request: Promise<LobbyAck>): Promise<LobbyAck> {
    const ack = await request
    if (!ack.ok) return ack
    match.clear()
    lobby = null
    ticket = ack.ticket
    persistTicket(ack.ticket)
    startHeartbeat()
    watchAppState()
    await rejoin()
    return ack
  },

  lobby: (): LobbyState | null => lobby,

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
      ticket = saved
      startHeartbeat()
      watchAppState()
      if (ack.waiting === true) return { route: 'lobby', code: saved.code }
      return match.snapshot() === null ? { route: 'home' } : { route: 'match' }
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
    markingPending = false
    if (heartbeat !== null) clearInterval(heartbeat)
    heartbeat = null
    appState?.remove()
    appState = null
    stopRehearsal()
    match.clear()
    client?.disconnect()
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
    if (!DEV_TOOLS || client?.connected()) return false
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
