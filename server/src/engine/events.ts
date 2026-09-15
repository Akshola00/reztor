import { z } from 'zod'
import type { MatchConfig, Tier } from './config.js'
import type { PlayerId, Side, Stage, TraceResult, VoidReason, VoteTarget, WinReason } from './state.js'

const tier = z.union([z.literal(1), z.literal(2)])
const playerId = z.string().min(1).max(64)

// Inbound socket payloads (CLAUDE.md §7). Strict objects: unknown fields are rejected, which
// also stops a client smuggling a playerId into a payload (§8).
export const PayloadSchemas = {
  TAP_BATCH: z.strictObject({
    tier,
    // The bucket never admits more than 6 taps, so anything far above that is not tapping.
    count: z.int().min(1).max(60),
    lane: playerId.optional(),
    clientTs: z.int().nonnegative(),
  }),
  SET_TIER: z.strictObject({ tier }),
  SIPHON: z.strictObject({ source: playerId, sink: playerId }),
  TRACE: z.strictObject({ target: playerId }),
  CHAT: z.strictObject({ text: z.string().min(1).max(240) }),
  VOTE: z.strictObject({ target: z.union([z.literal('skip'), playerId]) }),
} as const

// A validated payload plus the sender bound at the connection layer (CLAUDE.md §8). TAP_BATCH
// carries neither `tier` nor `clientTs`: the stored tier is authoritative (§5.1) and client
// time is never trusted (§0.1), so neither can reach the engine.
export type Intent =
  | { kind: 'TAP_BATCH'; playerId: PlayerId; count: number; lane?: PlayerId }
  | { kind: 'SET_TIER'; playerId: PlayerId; tier: Tier }
  | { kind: 'SIPHON'; playerId: PlayerId; source: PlayerId; sink: PlayerId }
  | { kind: 'TRACE'; playerId: PlayerId; target: PlayerId }
  | { kind: 'CHAT'; playerId: PlayerId; text: string }
  | { kind: 'VOTE'; playerId: PlayerId; target: VoteTarget }
  | { kind: 'DISCONNECT'; playerId: PlayerId }
  | { kind: 'RECONNECT'; playerId: PlayerId }

export type IntentOf<K extends Intent['kind']> = Extract<Intent, { kind: K }>

// Resolved facts. Reduce applies them without re-running any rule, so a log replays
// identically even after rule code changes.
export type MatchEvent =
  | {
      type: 'MATCH_STARTED'
      tick: number
      matchId: string
      config: MatchConfig
      players: { id: PlayerId; name: string; wallet: string | null }[]
      impostorId: PlayerId
      roleSeed: string
    }
  | { type: 'TIER_SET'; tick: number; playerId: PlayerId; tier: Tier }
  | {
      type: 'TAPS_APPLIED'
      tick: number
      playerId: PlayerId
      lane: PlayerId
      requested: number
      tokenDropped: number
      applied: number
      units: number
      cost: number
      tokensAfter: number
      remainderAfter: number | null
    }
  | {
      type: 'SIPHONED'
      tick: number
      playerId: PlayerId
      source: PlayerId
      sink: PlayerId
      pulled: number
      delivered: number
      destroyed: number
      cost: number
      tokensAfter: number
    }
  | { type: 'TRACED'; tick: number; playerId: PlayerId; target: PlayerId; result: TraceResult; cost: number }
  | { type: 'CHAT_POSTED'; tick: number; playerId: PlayerId; text: string }
  | { type: 'VOTE_CAST'; tick: number; playerId: PlayerId; target: VoteTarget }
  | { type: 'PLAYER_DISCONNECTED'; tick: number; playerId: PlayerId }
  | { type: 'PLAYER_RECONNECTED'; tick: number; playerId: PlayerId }
  | { type: 'GRACE_EXPIRED'; tick: number; playerId: PlayerId }
  | {
      type: 'VOTE_RESOLVED'
      tick: number
      round: number
      votes: Record<PlayerId, VoteTarget>
      ejected: PlayerId | null
    }
  | { type: 'STAGE_ADVANCED'; tick: number; round: number; stage: Stage; endsAtTick: number }
  | { type: 'MATCH_RESOLVED'; tick: number; winner: Side; reason: WinReason }
  | { type: 'MATCH_VOIDED'; tick: number; reason: VoidReason }

export type EventOf<T extends MatchEvent['type']> = Extract<MatchEvent, { type: T }>

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
  | 'RATE_LIMITED'
  | 'TRACE_USED'
  | 'NO_PREVIOUS_ROUND'
  | 'CHAT_RATE_LIMITED'
  | 'INVALID_VOTE_TARGET'
  | 'NOT_DISCONNECTED'

export type Rejection = { action: Intent['kind']; code: RejectionCode; reason: string }
