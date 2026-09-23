import { AppState } from 'react-native'

import type { JoinAck, JoinTicket, LobbyAck, PrivateView, Tier, VoteTarget } from '../../protocol/generated'
import { createMatchStore } from '../state/match'
import { createLoopback, type Loopback } from './loopback'
import { BATCH_INTERVAL_MS, createOutbox, tapBatches, type Outbox } from './outbox'
import { createClient, type ReztorClient } from './socket'

// The one connection to the server, and everything tied to its lifetime: the ticket and session
// token, the heartbeat, the AppState reconnect, and the authoritative match store the socket
// writes. Module state rather than React context: the tap path and the batch timer read it
// synchronously, and it has to outlive route changes.
//
// The session token lives in memory only. A cold start loses it, and with it the seat; persisting
// it needs a storage dependency, which item 3 does not add.

/** ../server/src/main.ts: `PORT ?? 3000`. Socket.IO's default path, /socket.io/. */
export const DEFAULT_PORT = 3000
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? `http://localhost:${DEFAULT_PORT}`

/** PROTOCOL.md §4 and server/src/net/auth.ts. Three missed beats start the grace clock. */
const HEARTBEAT_INTERVAL_MS = 2000

/**
 * ../server/src/engine/config.ts MVP_CONFIG.lobbyFillTimeoutSec. A lobby's timeout lives in
 * `config`, and config only arrives with MATCH_STARTED — so a waiting client cannot learn it from
 * the wire and has to mirror it. See the item 3 report.
 */
export const LOBBY_FILL_TIMEOUT_SEC = 60

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
/** The vote this client last cast, and in which round. Survives the Judgement region remounting. */
let myVote: { round: number; target: VoteTarget } | null = null
let lastChatAtMs = 0

const startedListeners = new Set<() => void>()
const resumeListeners = new Set<() => void>()
const lostListeners = new Set<() => void>()

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
  c.on('MATCH_END', () => match.applyEnd())
  c.on('VOTE_RESULT', ({ round, votes, ejected, serverTick }) => {
    match.applyVoteResult({ round, votes, ejected }, serverTick)
    myVote = null
  })
  c.on('ACTION_REJECTED', ({ action, code, reason }) => {
    // PROTOCOL.md §3: a well-behaved client sees none. Logged so a test can count them.
    console.warn('[net] ACTION_REJECTED', action, code, reason)
  })
  // SIPHON_RESULT and TRACE_RESULT are known and have no reader until item 5.
  // SIPHON_RESULT must never be drawn as a pairing, on any client — hard rule 1.

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
    if (!ack.ok) emit(lostListeners)
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
    ticket = ack.ticket
    startHeartbeat()
    watchAppState()
    await rejoin()
    return ack
  },

  /**
   * A lobby that times out dissolves silently: its sessions are deleted and no message is sent
   * (PROTOCOL.md §2). The only way to learn it happened is that JOIN now fails.
   */
  async checkSeat(): Promise<JoinAck | null> {
    if (ticket === null) return null
    try {
      return await getClient().request('JOIN', { matchId: ticket.matchId, sessionToken: ticket.sessionToken })
    } catch {
      return null
    }
  },

  /** There is no LEAVE message in the protocol; see the item 3 report. This forgets the seat. */
  leave() {
    ticket = null
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
  /** The server no longer knows this seat: a dissolved lobby, or a match that has gone. */
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
  startRehearsal(): boolean {
    if (!DEV_TOOLS || client?.connected()) return false
    stopRehearsal()
    rehearsalCount += 1
    match.applyView(rehearsalView(`rehearsal-${rehearsalCount}`), 0)
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

function rehearsalView(matchId: string): PrivateView {
  const lanes = [
    { owner: 'p-2', units: 220, dormant: false },
    { owner: 'p-3', units: 700, dormant: false },
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
    you: { id: REHEARSAL_YOU, role: 'crew', credits: 1200, spent: 0, tier: 1, traceUsed: false },
    currentVote: null,
    traces: [],
    siphonActivity: null,
  }
}
