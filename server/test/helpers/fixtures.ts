import { MVP_CONFIG, ticksFor, type MatchConfig, type Tier } from '../../src/engine/config.js'
import type { EventOf, MatchEvent } from '../../src/engine/events.js'
import { initialState } from '../../src/engine/reduce.js'
import {
  decideChat,
  decideSetTier,
  decideSiphon,
  decideTap,
  decideTrace,
  decideVote,
  deriveImpostor,
  dueGraceExpiries,
  resolveVote,
} from '../../src/engine/rules.js'
import type { LaneState, MatchState, PlayerId, PlayerState, Stage, VoteTarget } from '../../src/engine/state.js'
import { accept, checkedCommit } from './checked.js'
import { assertInvariants } from './invariants.js'

export const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
export const SEED = '5eed'.repeat(16)

export function matchStarted(config: Partial<MatchConfig> = {}, roleSeed = SEED): EventOf<'MATCH_STARTED'> {
  const impostor = deriveImpostor(roleSeed, PLAYER_IDS)
  if (!impostor.ok) throw new Error(impostor.error)
  return {
    type: 'MATCH_STARTED',
    tick: 0,
    matchId: 'match-1',
    config: { ...MVP_CONFIG, ...config },
    players: PLAYER_IDS.map((id) => ({ id, name: `Player ${id}`, wallet: null })),
    impostorId: impostor.value,
    roleSeed,
  }
}

export function newMatch(config: Partial<MatchConfig> = {}): MatchState {
  const state = initialState(matchStarted(config))
  assertInvariants(null, state)
  return state
}

export function player(state: MatchState, id: PlayerId): PlayerState {
  const found = state.players[id]
  if (found === undefined) throw new Error(`No player ${id}`)
  return found
}

export function lane(state: MatchState, id: PlayerId): LaneState {
  const found = state.lanes[id]
  if (found === undefined) throw new Error(`No lane ${id}`)
  return found
}

export function crew(state: MatchState): [PlayerId, PlayerId, PlayerId] {
  const [a, b, c, ...rest] = PLAYER_IDS.filter((id) => id !== state.impostorId)
  if (a === undefined || b === undefined || c === undefined || rest.length > 0) throw new Error('Expected 3 crew')
  return [a, b, c]
}

// Fills a lane through a tier-1 tap fact, so credits, deltas and the log all stay consistent.
export function seedLane(state: MatchState, owner: PlayerId, units: number, tick: number): MatchState {
  return checkedCommit(state, {
    type: 'TAPS_APPLIED',
    tick,
    playerId: owner,
    lane: owner,
    requested: units,
    tokenDropped: 0,
    applied: units,
    units,
    cost: units,
    tokensAfter: player(state, owner).tapBucket.tokens,
    remainderAfter: null,
  })
}

export function disconnect(state: MatchState, id: PlayerId, tick: number): MatchState {
  return checkedCommit(state, { type: 'PLAYER_DISCONNECTED', tick, playerId: id })
}

export function ejectByGrace(state: MatchState, id: PlayerId, tick: number): MatchState {
  const expiresAt = tick + ticksFor(state.config.disconnectGraceSec)
  return checkedCommit(disconnect(state, id, tick), { type: 'GRACE_EXPIRED', tick: expiresAt, playerId: id })
}

export function advanceStage(state: MatchState, tick: number, round: number, stage: Stage): MatchState {
  const endsAtTick = tick + ticksFor(state.config.stageDurations[stage])
  return checkedCommit(state, { type: 'STAGE_ADVANCED', tick, round, stage, endsAtTick })
}

export const tap = (state: MatchState, playerId: PlayerId, count: number, tick: number, laneId?: PlayerId) =>
  decideTap(state, { kind: 'TAP_BATCH', playerId, count, lane: laneId }, tick)

export const setTier = (state: MatchState, playerId: PlayerId, tier: Tier, tick: number) =>
  decideSetTier(state, { kind: 'SET_TIER', playerId, tier }, tick)

export const siphon = (state: MatchState, playerId: PlayerId, source: PlayerId, sink: PlayerId, tick: number) =>
  decideSiphon(state, { kind: 'SIPHON', playerId, source, sink }, tick)

export const trace = (state: MatchState, playerId: PlayerId, target: PlayerId, tick: number) =>
  decideTrace(state, { kind: 'TRACE', playerId, target }, tick)

export const chat = (state: MatchState, playerId: PlayerId, text: string, tick: number) =>
  decideChat(state, { kind: 'CHAT', playerId, text }, tick)

export const vote = (state: MatchState, playerId: PlayerId, target: VoteTarget, tick: number) =>
  decideVote(state, { kind: 'VOTE', playerId, target }, tick)

export const roundStartTick = (state: MatchState, round: number): number => {
  const { tap: tapSec, chat: chatSec, vote: voteSec } = state.config.stageDurations
  return (round - 1) * ticksFor(tapSec + chatSec + voteSec)
}

export function startRound(state: MatchState, round: number): MatchState {
  return state.round === round ? state : advanceStage(state, roundStartTick(state, round), round, 'tap')
}

export function closeVote(state: MatchState, tick: number): MatchState {
  return checkedCommit(state, resolveVote(state, tick))
}

// Runs a round's vote stage in which every connected living player votes for `target`
// (or nobody votes, for `null`), then closes it.
export function runVote(state: MatchState, round: number, target: PlayerId | null): MatchState {
  const { tap: tapSec, chat: chatSec, vote: voteSec } = state.config.stageDurations
  const voteAt = roundStartTick(state, round) + ticksFor(tapSec + chatSec)
  let s = advanceStage(startRound(state, round), voteAt, round, 'vote')
  if (target !== null) {
    for (const p of Object.values(s.players)) {
      if (p.status === 'alive') s = accept(s, vote(s, p.id, target, voteAt)).state
    }
  }
  return closeVote(s, voteAt + ticksFor(voteSec))
}

export function logOf<T extends MatchEvent['type']>(state: MatchState, type: T): EventOf<T>[] {
  return state.eventLog.filter((event): event is EventOf<T> => event.type === type)
}

// Commits every grace expiry due at `tick`, stopping once the match resolves.
export function expireDue(state: MatchState, tick: number): MatchState {
  let s = state
  for (const event of dueGraceExpiries(state, tick)) {
    if (s.resolution !== null) break
    s = checkedCommit(s, event)
  }
  return s
}
