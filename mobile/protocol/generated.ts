// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Regenerate:  cd server && pnpm protocol:emit
// Emitter:     server/src/protocol/emit.ts
// Guarded by:  server/test/protocol/generated.test.ts, which fails if this file is stale or if
//              any type here has drifted from the server's own.
//
// Prose contract, including ordering and secrecy rules: docs/PROTOCOL.md
//
// Deliberately self-contained: no imports, so the mobile package compiles it without depending
// on the server in any way.
//
// Types only, no runtime values. The mobile package has no "type": "module", so under NodeNext
// this file is CommonJS and a top-level `export const` is a compile error there. Compiling it
// yields an empty module stub: a "use strict" line, an __esModule marker, and no runtime code.

// ---------------------------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------------------------

export type PlayerId = string
export type Stage = 'tap' | 'chat' | 'vote'
export type PlayerStatus = 'alive' | 'disconnected' | 'ejected'
export type MatchPhase = 'LOBBY' | 'ESCROWED' | 'IN_PROGRESS' | 'SETTLING' | 'SETTLED' | 'VOIDING' | 'VOIDED'
export type Side = 'crew' | 'impostor'
export type Tier = 1 | 2
export type VoteTarget = PlayerId | 'skip'
export type TraceResult = 'natural' | 'received' | 'drained'

export type WinReason =
  | 'BOARD_TARGET'
  | 'IMPOSTOR_EJECTED'
  | 'IMPOSTOR_TIMED_OUT'
  | 'CREW_EJECTED'
  | 'ROUNDS_EXHAUSTED'

export type VoidReason = 'ABANDONED'

export type Resolution =
  | { kind: 'won'; winner: Side; reason: WinReason; tick: number }
  | { kind: 'voided'; reason: VoidReason; tick: number }

export type ChatMessage = { from: PlayerId; text: string; tick: number }

export type MatchConfig = {
  laneCapacity: number
  winTarget: number
  tapTiers: Record<Tier, { cost: number; units: number }>
  tapRatePerSec: number
  siphon: { pull: number; deliver: number; costOther: number; costSelf: number; ratePerSec: number }
  trace: { cost: number; perPlayer: 1 }
  dormantEfficiencyPct: number
  rounds: number
  stageDurations: { tap: number; chat: number; vote: number }
  buyInSkr: number
  creditsPerSkr: number
  rakeBps: number
  disconnectGraceSec: number
  lobbyFillTimeoutSec: number
}

// ---------------------------------------------------------------------------------------------
// Rejection codes
// ---------------------------------------------------------------------------------------------

/** A rule refused the action. The message reached the engine. */
export type RejectionCode =
  | 'MATCH_OVER'
  | 'WRONG_STAGE'
  | 'UNKNOWN_PLAYER'
  | 'NOT_ALIVE'
  | 'NOT_DORMANT'
  | 'INSUFFICIENT_CREDITS'
  | 'LANE_FULL'
  | 'NOT_IMPOSTOR'
  | 'SAME_LANE'
  | 'LANE_FROZEN'
  | 'SOURCE_TOO_LOW'
  | 'SINK_FULL'
  | 'RATE_LIMITED'
  | 'TRACE_USED'
  | 'NO_PREVIOUS_ROUND'
  | 'CHAT_RATE_LIMITED'
  | 'INVALID_VOTE_TARGET'
  | 'NOT_DISCONNECTED'

/** The message never reached the engine. These may carry a null matchId and serverTick. */
export type TransportCode = 'NOT_JOINED' | 'NO_MATCH' | 'INVALID_PAYLOAD' | 'TOO_MANY_MESSAGES'

export type LobbyError = 'UNKNOWN_CODE' | 'LOBBY_FULL' | 'ESCROW_FAILED'

export type JoinError = 'INVALID_PAYLOAD' | 'UNKNOWN_SESSION' | 'WRONG_MATCH'

export type SettlementError =
  | 'NOT_STARTED'
  | 'CONFIG_MISMATCH'
  | 'INVALID_RAKE'
  | 'CORRUPT_LOG'
  | 'UNRESOLVED'
  | 'EVENTS_AFTER_RESOLUTION'
  | 'UNBALANCED'

export type MatchEndError = 'UNRESOLVED' | SettlementError

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export type LaneSnapshot = { owner: PlayerId; units: number; dormant: boolean }

export type PlayerSnapshot = { id: PlayerId; name: string; status: PlayerStatus }

export type RevealedVoteRound = {
  round: number
  votes: Record<PlayerId, VoteTarget>
  ejected: PlayerId | null
}

export type SiphonActivity = { siphons: number; selfSinks: number; destroyed: number }

/** BOARD_UPDATE, 4x per second. Only what changes per tick: no config, no chat history. */
export type BoardView = {
  round: number
  stage: Stage
  /** Whole seconds remaining in the current stage, computed server-side. */
  secondsLeft: number
  lanes: LaneSnapshot[]
  boardTotal: number
  players: PlayerSnapshot[]
}

/** The full public state. Sent inside MATCH_STARTED and RESUME_STATE only, never per tick. */
export type PublicView = {
  matchId: string
  config: MatchConfig
  phase: MatchPhase
  round: number
  stage: Stage
  stageEndsAtTick: number
  lanes: LaneSnapshot[]
  boardTotal: number
  players: PlayerSnapshot[]
  chat: ChatMessage[]
  voteHistory: RevealedVoteRound[]
  resolution: Resolution | null
}

/** PublicView plus what only the receiving player may see. siphonActivity is null unless impostor. */
export type PrivateView = PublicView & {
  you: {
    id: PlayerId
    role: Side
    credits: number
    spent: number
    tier: Tier
    traceUsed: boolean
  }
  currentVote: VoteTarget | null
  traces: { tick: number; target: PlayerId; result: TraceResult }[]
  siphonActivity: SiphonActivity | null
}

/** The post-match reveal. Hides nothing — only ever sent once the match has resolved. */
export type MatchEndView = {
  matchId: string
  resolution: Resolution
  impostorId: PlayerId
  roleSeed: string
  board: { total: number; capacity: number; winTarget: number; basisPoints: number }
  players: {
    id: PlayerId
    name: string
    role: Side
    status: PlayerStatus
    creditsSpent: number
    unitsContributed: number
    finalLane: number
  }[]
  impostor: { unitsDestroyed: number; siphons: number; selfSinks: number }
  traces: { round: number; tick: number; purchaser: PlayerId; target: PlayerId; result: TraceResult }[]
  voteHistory: RevealedVoteRound[]
}

export type SettlementLine = { playerId: PlayerId; spent: number; refund: number; payout: number }

export type Settlement = {
  matchId: string
  resolution: Resolution
  escrowCredits: number
  potCredits: number
  rakeBps: number
  rakeCredits: number
  dustCredits: number
  winners: PlayerId[]
  lines: SettlementLine[]
}

// ---------------------------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------------------------

export type CreateLobbyPayload = { name: string; wallet?: string | null }
export type JoinLobbyPayload = { code: string; name: string; wallet?: string | null }
export type JoinPayload = { matchId: string; sessionToken: string }

/** `tier` is advisory — the server applies the tier it stored. `clientTs` is accepted and ignored. */
export type TapBatchPayload = { tier: Tier; count: number; lane?: PlayerId; clientTs: number }
export type SetTierPayload = { tier: Tier }
export type SiphonPayload = { source: PlayerId; sink: PlayerId }
export type TracePayload = { target: PlayerId }
export type ChatPayload = { text: string }
export type VotePayload = { target: VoteTarget }
export type HeartbeatPayload = Record<string, never>

export type ClientMessages = {
  CREATE_LOBBY: CreateLobbyPayload
  JOIN_LOBBY: JoinLobbyPayload
  JOIN: JoinPayload
  TAP_BATCH: TapBatchPayload
  SET_TIER: SetTierPayload
  SIPHON: SiphonPayload
  TRACE: TracePayload
  CHAT: ChatPayload
  VOTE: VotePayload
  HEARTBEAT: HeartbeatPayload
}

export type ClientEvent = keyof ClientMessages

// ---------------------------------------------------------------------------------------------
// Acks (CREATE_LOBBY, JOIN_LOBBY and JOIN are request/response; everything else is fire and forget)
// ---------------------------------------------------------------------------------------------

export type JoinTicket = {
  code: string
  matchId: string
  playerId: PlayerId
  sessionToken: string
  /** How many seats are filled including this one, 1..4. */
  seated: number
  /** True when this seat filled the lobby and the match has started. */
  started: boolean
}

export type LobbyAck = { ok: true; ticket: JoinTicket } | { ok: false; error: LobbyError | 'INVALID_PAYLOAD' }

export type JoinAck =
  | { ok: true; playerId: PlayerId; reconnected: boolean; waiting?: boolean }
  | { ok: false; error: JoinError }

// ---------------------------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------------------------

/** Every server message carries these. ACTION_REJECTED may carry nulls; nothing else does. */
export type Envelope = { matchId: string; serverTick: number }

export type MatchStartedMessage = Envelope & { view: PrivateView }
export type ResumeStateMessage = Envelope & { view: PrivateView }
export type BoardUpdateMessage = Envelope & { board: BoardView }
export type ChatMessageMessage = Envelope & { from: PlayerId; text: string; tick: number }
export type StageChangeMessage = Envelope & { round: number; stage: Stage; endsAtTick: number }
export type CreditsMessage = Envelope & { credits: number; spent: number; tier: Tier }

/** Impostor only. The crew never receive this, and never learn a source/sink pairing. */
export type SiphonResultMessage = Envelope & {
  source: PlayerId
  sink: PlayerId
  pulled: number
  delivered: number
  destroyed: number
}

/** Purchaser only. Never names a counterparty. */
export type TraceResultMessage = Envelope & { target: PlayerId; result: TraceResult }

/** `votes` is what each player cast, revealed simultaneously at stage close. */
export type VoteResultMessage = Envelope & {
  round: number
  votes: Record<PlayerId, VoteTarget>
  ejected: PlayerId | null
}

export type MatchEndMessage =
  | (Envelope & { reveal: MatchEndView; settlement: Settlement })
  | (Envelope & { error: MatchEndError })

export type ActionRejectedMessage = {
  matchId: string | null
  serverTick: number | null
  action: string
  code: RejectionCode | TransportCode
  reason: string
}

export type ServerMessages = {
  MATCH_STARTED: MatchStartedMessage
  RESUME_STATE: ResumeStateMessage
  BOARD_UPDATE: BoardUpdateMessage
  CHAT_MESSAGE: ChatMessageMessage
  STAGE_CHANGE: StageChangeMessage
  CREDITS: CreditsMessage
  SIPHON_RESULT: SiphonResultMessage
  TRACE_RESULT: TraceResultMessage
  VOTE_RESULT: VoteResultMessage
  MATCH_END: MatchEndMessage
  ACTION_REJECTED: ActionRejectedMessage
}

export type ServerEvent = keyof ServerMessages

// Client -> server: CREATE_LOBBY, JOIN_LOBBY, JOIN, TAP_BATCH, SET_TIER, SIPHON, TRACE, CHAT, VOTE, HEARTBEAT
// Server -> client: MATCH_STARTED, RESUME_STATE, BOARD_UPDATE, CHAT_MESSAGE, STAGE_CHANGE, CREDITS, SIPHON_RESULT, TRACE_RESULT, VOTE_RESULT, MATCH_END, ACTION_REJECTED
