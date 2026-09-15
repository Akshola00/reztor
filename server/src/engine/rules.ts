import { createHash } from 'node:crypto'
import {
  CHAT_INTERVAL_TICKS,
  REMAINDER_SCALE,
  TOKEN_SCALE,
  siphonBucketParams,
  tapBucketParams,
  ticksFor,
  type BucketParams,
} from './config.js'
import type { EventOf, Intent, IntentOf, Rejection, RejectionCode } from './events.js'
import { err, ok, type Result } from './result.js'
import type {
  MatchState,
  PlayerId,
  PlayerState,
  RoundDelta,
  Side,
  Stage,
  TokenBucket,
  TraceResult,
  VoteTarget,
  WinReason,
} from './state.js'

const reject = (action: Intent['kind'], code: RejectionCode, reason: string): Result<never, Rejection> =>
  err({ action, code, reason })

function refill(bucket: TokenBucket, params: BucketParams, tick: number): number {
  return Math.min(params.capacity, bucket.tokens + (tick - bucket.updatedAtTick) * params.refillPerTick)
}

function actor(
  state: MatchState,
  action: Intent['kind'],
  playerId: PlayerId,
  stage: Stage,
): Result<PlayerState, Rejection> {
  if (state.resolution !== null) return reject(action, 'MATCH_OVER', 'The match is over')
  if (state.stage !== stage) return reject(action, 'WRONG_STAGE', `Only allowed during the ${stage} stage`)
  const player = state.players[playerId]
  if (player === undefined) return reject(action, 'UNKNOWN_PLAYER', 'Unknown player')
  if (player.status !== 'alive') return reject(action, 'NOT_ALIVE', 'Only living, connected players can act')
  return ok(player)
}

const isLiving = (state: MatchState, id: PlayerId): boolean => {
  const status = state.players[id]?.status
  return status !== undefined && status !== 'ejected'
}

// Verifiable role assignment (spec §13.4): anyone holding the revealed seed can recompute the
// impostor. Players are ordered by playerId because wallet is nullable (CLAUDE.md §4). The seed
// is canonical lowercase hex for 32 bytes so there is exactly one spelling of any seed.
export function deriveImpostor(
  roleSeed: string,
  playerIds: readonly PlayerId[],
): Result<PlayerId, 'INVALID_SEED' | 'NO_PLAYERS'> {
  if (!/^[0-9a-f]{64}$/.test(roleSeed)) return err('INVALID_SEED')
  const sorted = [...playerIds].sort()
  const digest = createHash('sha256').update(roleSeed, 'hex').digest()
  const chosen = sorted[digest.readUInt32BE(0) % sorted.length]
  return chosen === undefined ? err('NO_PLAYERS') : ok(chosen)
}

export function decideSetTier(
  state: MatchState,
  intent: IntentOf<'SET_TIER'>,
  tick: number,
): Result<EventOf<'TIER_SET'>, Rejection> {
  // CLAUDE.md §5.1: tier changes only during a tap stage.
  const acting = actor(state, intent.kind, intent.playerId, 'tap')
  if (!acting.ok) return acting
  const event: EventOf<'TIER_SET'> = { type: 'TIER_SET', tick, playerId: intent.playerId, tier: intent.tier }
  return ok(event)
}

export function decideTap(
  state: MatchState,
  intent: IntentOf<'TAP_BATCH'>,
  tick: number,
): Result<EventOf<'TAPS_APPLIED'>, Rejection> {
  const acting = actor(state, intent.kind, intent.playerId, 'tap')
  if (!acting.ok) return acting
  const player = acting.value

  // CLAUDE.md §7: lane defaults to the sender's own; any other lane must be dormant.
  const laneId = intent.lane ?? player.id
  const lane = state.lanes[laneId]
  if (lane === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown lane')
  const own = laneId === player.id
  if (!own && !lane.dormant) {
    return reject(intent.kind, 'NOT_DORMANT', 'You can only tap your own lane or a dormant lane')
  }

  const { config } = state
  const tier = config.tapTiers[player.tier]
  const available = refill(player.tapBucket, tapBucketParams(config), tick)
  const headroom = config.laneCapacity - lane.units
  const remainder = lane.dormantRemainder[player.id] ?? 0

  // CLAUDE.md §5.1 order: clamp by tokens → credits → lane headroom, then apply and charge.
  const byTokens = Math.min(intent.count, Math.floor(available / TOKEN_SCALE))
  const byCredits = Math.min(byTokens, Math.floor(player.credits / tier.cost))
  // CLAUDE.md §5.1 [D]: a tap whose units do not fully fit is dropped uncharged, never clipped.
  // CLAUDE.md §5.4 [D]: in a dormant lane the pending remainder claims headroom too, so no
  // credit buys a half-unit that could never land.
  const byHeadroom = own
    ? Math.floor(headroom / tier.units)
    : Math.floor((headroom * REMAINDER_SCALE - remainder) / (tier.units * config.dormantEfficiencyPct))
  const applied = Math.max(0, Math.min(byCredits, byHeadroom))

  // CLAUDE.md §5.1 [D]: only rate-clamp drops are silent. A batch that could be sent but applies
  // nothing is rejected and changes nothing, tokens included.
  if (byTokens > 0 && applied === 0) {
    return byCredits === 0
      ? reject(intent.kind, 'INSUFFICIENT_CREDITS', 'Not enough credits for a tap at your tier')
      : reject(intent.kind, 'LANE_FULL', 'That lane has no room for a tap at your tier')
  }

  // CLAUDE.md §5.4 [D]: dormant taps accumulate a per-player remainder so tier-1 taps at 50%
  // still yield units over successive batches instead of flooring to zero every time.
  const scaled = applied * tier.units * config.dormantEfficiencyPct + remainder
  const event: EventOf<'TAPS_APPLIED'> = {
    type: 'TAPS_APPLIED',
    tick,
    playerId: player.id,
    lane: laneId,
    requested: intent.count,
    // CLAUDE.md §5.1 [D]: tapsDropped is rate-clamp telemetry only.
    tokenDropped: intent.count - byTokens,
    applied,
    units: own ? applied * tier.units : Math.floor(scaled / REMAINDER_SCALE),
    cost: applied * tier.cost,
    // CLAUDE.md §5.1 [D]: in an accepted batch every tap that clears the clamp spends a token.
    tokensAfter: available - byTokens * TOKEN_SCALE,
    remainderAfter: own ? null : scaled % REMAINDER_SCALE,
  }
  return ok(event)
}

export function decideSiphon(
  state: MatchState,
  intent: IntentOf<'SIPHON'>,
  tick: number,
): Result<EventOf<'SIPHONED'>, Rejection> {
  // CLAUDE.md §5.2 [D]: checks run in the documented precedence so each failure has one reason.
  const acting = actor(state, intent.kind, intent.playerId, 'tap')
  if (!acting.ok) return acting
  const player = acting.value
  if (player.id !== state.impostorId) return reject(intent.kind, 'NOT_IMPOSTOR', 'Only the impostor can siphon')

  const source = state.lanes[intent.source]
  const sink = state.lanes[intent.sink]
  if (source === undefined || sink === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown lane')
  // CLAUDE.md §5.2 [D]: a self-loop is a pure burn that only confuses the board.
  if (source.owner === sink.owner) return reject(intent.kind, 'SAME_LANE', 'Source and sink must differ')
  if (state.players[source.owner]?.status === 'disconnected' || state.players[sink.owner]?.status === 'disconnected') {
    return reject(intent.kind, 'LANE_FROZEN', 'A disconnected player’s lane is frozen')
  }

  const { config } = state
  // CLAUDE.md §5.2 [D]: no partial pulls, so the 10-for-6 ratio stays legible.
  if (source.units < config.siphon.pull) {
    return reject(intent.kind, 'SOURCE_TOO_LOW', `The source lane needs at least ${config.siphon.pull} units`)
  }
  // CLAUDE.md §5.2 [D!]: the siphon bucket keeps sabotage visible as motion on the board.
  const available = refill(player.siphonBucket, siphonBucketParams(config), tick)
  if (available < TOKEN_SCALE) return reject(intent.kind, 'RATE_LIMITED', 'Siphoning too fast')
  const cost = sink.owner === player.id ? config.siphon.costSelf : config.siphon.costOther
  if (player.credits < cost) return reject(intent.kind, 'INSUFFICIENT_CREDITS', 'Not enough credits to siphon')

  // CLAUDE.md §5.2 [D]: a near-full sink clips the delivery, destroys the rest, and still costs
  // full price, because the impostor chose the target.
  const delivered = Math.min(config.siphon.deliver, config.laneCapacity - sink.units)
  const event: EventOf<'SIPHONED'> = {
    type: 'SIPHONED',
    tick,
    playerId: player.id,
    source: source.owner,
    sink: sink.owner,
    pulled: config.siphon.pull,
    delivered,
    destroyed: config.siphon.pull - delivered,
    cost,
    tokensAfter: available - TOKEN_SCALE,
  }
  return ok(event)
}

// CLAUDE.md §5.3 [D]: largest component wins, ties break drained > received > natural, and a
// lane that did not move at all is natural so the trace never accuses an idle lane.
export function traceResult(delta: RoundDelta): TraceResult {
  const natural = delta.natural + delta.foreign
  const { received, drained } = delta
  if (natural === 0 && received === 0 && drained === 0) return 'natural'
  if (drained >= received && drained >= natural) return 'drained'
  if (received >= natural) return 'received'
  return 'natural'
}

export function decideTrace(
  state: MatchState,
  intent: IntentOf<'TRACE'>,
  tick: number,
): Result<EventOf<'TRACED'>, Rejection> {
  // CLAUDE.md §5.3 [D]: purchasable during a tap stage only.
  const acting = actor(state, intent.kind, intent.playerId, 'tap')
  if (!acting.ok) return acting
  const player = acting.value
  if (player.traceUsed) return reject(intent.kind, 'TRACE_USED', 'You have already used your trace')

  // Own, dormant and frozen lanes are all traceable: a trace reads history, not the lane.
  const target = state.lanes[intent.target]
  if (target === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown lane')
  if (target.prevRoundDelta === null) {
    return reject(intent.kind, 'NO_PREVIOUS_ROUND', 'Traces read the previous round, so none exist in round 1')
  }
  if (player.credits < state.config.trace.cost) {
    return reject(intent.kind, 'INSUFFICIENT_CREDITS', 'Not enough credits for a trace')
  }

  const event: EventOf<'TRACED'> = {
    type: 'TRACED',
    tick,
    playerId: player.id,
    target: target.owner,
    result: traceResult(target.prevRoundDelta),
    cost: state.config.trace.cost,
  }
  return ok(event)
}

export function decideChat(
  state: MatchState,
  intent: IntentOf<'CHAT'>,
  tick: number,
): Result<EventOf<'CHAT_POSTED'>, Rejection> {
  // CLAUDE.md §7 [D]: chat is open during the chat stage only.
  const acting = actor(state, intent.kind, intent.playerId, 'chat')
  if (!acting.ok) return acting
  const { lastChatTick } = acting.value
  if (lastChatTick !== null && tick - lastChatTick < CHAT_INTERVAL_TICKS) {
    return reject(intent.kind, 'CHAT_RATE_LIMITED', 'One message every 2 seconds')
  }
  const event: EventOf<'CHAT_POSTED'> = { type: 'CHAT_POSTED', tick, playerId: intent.playerId, text: intent.text }
  return ok(event)
}

export function decideVote(
  state: MatchState,
  intent: IntentOf<'VOTE'>,
  tick: number,
): Result<EventOf<'VOTE_CAST'>, Rejection> {
  const acting = actor(state, intent.kind, intent.playerId, 'vote')
  if (!acting.ok) return acting
  // CLAUDE.md §5.5 [D]: self-votes are allowed, and so are votes for a disconnected player,
  // who is still living.
  if (intent.target !== 'skip') {
    const target = state.players[intent.target]
    if (target === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown player')
    if (target.status === 'ejected') {
      return reject(intent.kind, 'INVALID_VOTE_TARGET', 'Ejected players cannot be voted for')
    }
  }
  const event: EventOf<'VOTE_CAST'> = { type: 'VOTE_CAST', tick, playerId: intent.playerId, target: intent.target }
  return ok(event)
}

export function resolveVote(state: MatchState, tick: number): EventOf<'VOTE_RESOLVED'> {
  const living = Object.values(state.players).filter((p) => p.status !== 'ejected')
  const votes: Record<PlayerId, VoteTarget> = {}
  const tally = new Map<PlayerId, number>()

  for (const voter of living) {
    const cast = state.votes[voter.id] ?? 'skip'
    // CLAUDE.md §5.5 [D]: validity is judged at close. A vote cast before the voter disconnected
    // still counts; a vote for a player ejected since counts as skip.
    const counted = cast !== 'skip' && isLiving(state, cast) ? cast : 'skip'
    votes[voter.id] = counted
    if (counted !== 'skip') tally.set(counted, (tally.get(counted) ?? 0) + 1)
  }

  // CLAUDE.md §5.5 [D!]: strictly more than half of living players, disconnected included, so a
  // disconnect cannot hand the others a cheaper ejection.
  const threshold = Math.floor(living.length / 2) + 1
  const ejected = [...tally].find(([, count]) => count >= threshold)?.[0] ?? null
  return { type: 'VOTE_RESOLVED', tick, round: state.round, votes, ejected }
}

export function decideDisconnect(
  state: MatchState,
  intent: IntentOf<'DISCONNECT'>,
  tick: number,
): Result<EventOf<'PLAYER_DISCONNECTED'>, Rejection> {
  if (state.resolution !== null) return reject(intent.kind, 'MATCH_OVER', 'The match is over')
  const player = state.players[intent.playerId]
  if (player === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown player')
  if (player.status !== 'alive') return reject(intent.kind, 'NOT_ALIVE', 'Only a connected, living player can drop')
  const event: EventOf<'PLAYER_DISCONNECTED'> = { type: 'PLAYER_DISCONNECTED', tick, playerId: player.id }
  return ok(event)
}

export function decideReconnect(
  state: MatchState,
  intent: IntentOf<'RECONNECT'>,
  tick: number,
): Result<EventOf<'PLAYER_RECONNECTED'>, Rejection> {
  if (state.resolution !== null) return reject(intent.kind, 'MATCH_OVER', 'The match is over')
  const player = state.players[intent.playerId]
  if (player === undefined) return reject(intent.kind, 'UNKNOWN_PLAYER', 'Unknown player')
  if (player.status !== 'disconnected') {
    return reject(intent.kind, 'NOT_DISCONNECTED', 'Only a player within their grace period can rejoin')
  }
  const event: EventOf<'PLAYER_RECONNECTED'> = { type: 'PLAYER_RECONNECTED', tick, playerId: player.id }
  return ok(event)
}

// CLAUDE.md §6 [D]: expiries due in the same tick are applied in playerId order.
export function dueGraceExpiries(state: MatchState, tick: number): EventOf<'GRACE_EXPIRED'>[] {
  const grace = ticksFor(state.config.disconnectGraceSec)
  return Object.values(state.players)
    .filter((p) => p.status === 'disconnected' && p.disconnectedAtTick !== null && tick - p.disconnectedAtTick >= grace)
    .map((p) => p.id)
    .sort()
    .map((playerId): EventOf<'GRACE_EXPIRED'> => ({ type: 'GRACE_EXPIRED', tick, playerId }))
}

// CLAUDE.md §5.6: the exact resolution order. Each position is load-bearing.
export function checkResolution(state: MatchState): EventOf<'MATCH_RESOLVED'> | EventOf<'MATCH_VOIDED'> | null {
  if (state.resolution !== null) return null
  const { tick, config, impostorId } = state
  const won = (winner: Side, reason: WinReason): EventOf<'MATCH_RESOLVED'> => ({
    type: 'MATCH_RESOLVED',
    tick,
    winner,
    reason,
  })

  const players = Object.values(state.players)
  const board = Object.values(state.lanes).reduce((sum, lane) => sum + lane.units, 0)
  const votedOut = new Set(state.voteHistory.flatMap((round) => (round.ejected === null ? [] : [round.ejected])))

  // [D!] Crossing the target ends the match at once and latches.
  if (board >= config.winTarget) return won('crew', 'BOARD_TARGET')

  // Above the void: an impostor who abandons must still lose, or rage-quitting becomes a free refund.
  if (state.players[impostorId]?.status === 'ejected') {
    return won('crew', votedOut.has(impostorId) ? 'IMPOSTOR_EJECTED' : 'IMPOSTOR_TIMED_OUT')
  }

  // Two players walking out leaves no game to resolve, so nobody is paid. Voted-out players never
  // count. This sits above the crew-ejection win, which would otherwise always fire first.
  const graceExpired = players.filter((p) => p.status === 'ejected' && !votedOut.has(p.id)).length
  if (graceExpired >= 2) return { type: 'MATCH_VOIDED', tick, reason: 'ABANDONED' }

  // Grace-expired crew count as ejected here, so one vote-out plus one expiry is an impostor win.
  const ejectedCrew = players.filter((p) => p.id !== impostorId && p.status === 'ejected').length
  if (ejectedCrew >= 2) return won('impostor', 'CREW_EJECTED')

  if (state.voteHistory.length === config.rounds) return won('impostor', 'ROUNDS_EXHAUSTED')

  return null
}
