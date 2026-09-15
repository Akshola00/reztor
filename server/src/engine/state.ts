import type { MatchConfig, Tier } from './config.js'
import type { MatchEvent } from './events.js'

export type PlayerId = string
export type Stage = 'tap' | 'chat' | 'vote'
export type MatchPhase = 'LOBBY' | 'ESCROWED' | 'IN_PROGRESS' | 'SETTLING' | 'SETTLED' | 'VOIDING' | 'VOIDED'
export type PlayerStatus = 'alive' | 'disconnected' | 'ejected'
export type Side = 'crew' | 'impostor'
export type VoteTarget = PlayerId | 'skip'
export type TraceResult = 'natural' | 'received' | 'drained'

// Refilled lazily from updatedAtTick on each action (CLAUDE.md §6). Units are quarter-tokens.
export type TokenBucket = { tokens: number; updatedAtTick: number }

export type PlayerState = {
  id: PlayerId
  name: string
  wallet: string | null
  credits: number
  spent: number
  tier: Tier
  status: PlayerStatus
  disconnectedAtTick: number | null
  traceUsed: boolean
  tapsAccepted: number
  tapsDropped: number
  unitsTapped: number
  tapBucket: TokenBucket
  siphonBucket: TokenBucket
  lastChatTick: number | null
}

export type RoundDelta = {
  natural: number
  foreign: number
  received: number
  drained: number
}

export type LaneState = {
  owner: PlayerId
  units: number
  dormant: boolean
  roundStartUnits: number
  roundDelta: RoundDelta
  // A trace reads the previous round, which roundDelta no longer holds once a round starts.
  prevRoundDelta: RoundDelta | null
  dormantRemainder: Record<PlayerId, number>
}

export type ChatMessage = { from: PlayerId; text: string; tick: number }

export type VoteRound = { round: number; votes: Record<PlayerId, VoteTarget>; ejected: PlayerId | null }

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

export type MatchState = {
  matchId: string
  config: MatchConfig
  phase: MatchPhase
  round: number
  stage: Stage
  stageEndsAtTick: number
  tick: number

  players: Record<PlayerId, PlayerState>
  lanes: Record<PlayerId, LaneState>
  roleSeed: string
  impostorId: PlayerId

  chat: ChatMessage[]
  votes: Record<PlayerId, VoteTarget>
  voteHistory: VoteRound[]
  eventLog: MatchEvent[]

  resolution: Resolution | null
}
