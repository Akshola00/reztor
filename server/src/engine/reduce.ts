import { siphonBucketParams, startingCredits, tapBucketParams, ticksFor } from './config.js'
import type { EventOf, MatchEvent } from './events.js'
import { assertNever } from './result.js'
import type { LaneState, MatchState, PlayerId, PlayerState, RoundDelta } from './state.js'

// Reduce only ever sees facts that decide() produced. A fact it cannot apply means the log is
// corrupt, which is not a rule outcome to return but a reason to void (CLAUDE.md §9).
export class InvalidLogError extends Error {
  override name = 'InvalidLogError'
}

const emptyDelta = (): RoundDelta => ({ natural: 0, foreign: 0, received: 0, drained: 0 })

export function initialState(started: EventOf<'MATCH_STARTED'>): MatchState {
  const { config } = started
  const players: Record<PlayerId, PlayerState> = {}
  const lanes: Record<PlayerId, LaneState> = {}

  for (const { id, name, wallet } of started.players) {
    players[id] = {
      id,
      name,
      wallet,
      credits: startingCredits(config),
      spent: 0,
      tier: 1,
      status: 'alive',
      disconnectedAtTick: null,
      traceUsed: false,
      tapsAccepted: 0,
      tapsDropped: 0,
      unitsTapped: 0,
      // Buckets start full so the opening burst of a match is not clamped.
      tapBucket: { tokens: tapBucketParams(config).capacity, updatedAtTick: started.tick },
      siphonBucket: { tokens: siphonBucketParams(config).capacity, updatedAtTick: started.tick },
      lastChatTick: null,
    }
    lanes[id] = {
      owner: id,
      units: 0,
      dormant: false,
      roundStartUnits: 0,
      roundDelta: emptyDelta(),
      prevRoundDelta: null,
      dormantRemainder: {},
    }
  }

  return {
    matchId: started.matchId,
    config,
    phase: 'IN_PROGRESS',
    round: 1,
    stage: 'tap',
    stageEndsAtTick: started.tick + ticksFor(config.stageDurations.tap),
    tick: started.tick,
    players,
    lanes,
    roleSeed: started.roleSeed,
    impostorId: started.impostorId,
    chat: [],
    votes: {},
    voteHistory: [],
    eventLog: [started],
    resolution: null,
  }
}

export function reduce(state: MatchState, event: MatchEvent): MatchState {
  // CLAUDE.md §0.7: the event is on the log before any state changes.
  const logged: MatchState = { ...state, tick: event.tick, eventLog: [...state.eventLog, event] }
  return apply(logged, event)
}

function apply(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case 'MATCH_STARTED':
      throw new InvalidLogError('MATCH_STARTED may only open a log; build state with initialState')

    case 'TIER_SET':
      return updatePlayer(state, event.playerId, (p) => ({ ...p, tier: event.tier }))

    case 'TAPS_APPLIED': {
      const charged = updatePlayer(state, event.playerId, (p) => ({
        ...p,
        credits: p.credits - event.cost,
        spent: p.spent + event.cost,
        tapsAccepted: p.tapsAccepted + event.applied,
        tapsDropped: p.tapsDropped + event.tokenDropped,
        unitsTapped: p.unitsTapped + event.units,
        tapBucket: { tokens: event.tokensAfter, updatedAtTick: event.tick },
      }))
      return updateLane(charged, event.lane, (lane) => {
        const own = lane.owner === event.playerId
        return {
          ...lane,
          units: lane.units + event.units,
          roundDelta: own
            ? { ...lane.roundDelta, natural: lane.roundDelta.natural + event.units }
            : { ...lane.roundDelta, foreign: lane.roundDelta.foreign + event.units },
          dormantRemainder:
            event.remainderAfter === null
              ? lane.dormantRemainder
              : { ...lane.dormantRemainder, [event.playerId]: event.remainderAfter },
        }
      })
    }

    case 'SIPHONED': {
      const charged = updatePlayer(state, event.playerId, (p) => ({
        ...p,
        credits: p.credits - event.cost,
        spent: p.spent + event.cost,
        siphonBucket: { tokens: event.tokensAfter, updatedAtTick: event.tick },
      }))
      const drained = updateLane(charged, event.source, (lane) => ({
        ...lane,
        units: lane.units - event.pulled,
        roundDelta: { ...lane.roundDelta, drained: lane.roundDelta.drained + event.pulled },
      }))
      return updateLane(drained, event.sink, (lane) => ({
        ...lane,
        units: lane.units + event.delivered,
        roundDelta: { ...lane.roundDelta, received: lane.roundDelta.received + event.delivered },
      }))
    }

    case 'TRACED':
      return updatePlayer(state, event.playerId, (p) => ({
        ...p,
        credits: p.credits - event.cost,
        spent: p.spent + event.cost,
        traceUsed: true,
      }))

    case 'CHAT_POSTED': {
      const posted = updatePlayer(state, event.playerId, (p) => ({ ...p, lastChatTick: event.tick }))
      return { ...posted, chat: [...posted.chat, { from: event.playerId, text: event.text, tick: event.tick }] }
    }

    case 'VOTE_CAST':
      return { ...state, votes: { ...state.votes, [event.playerId]: event.target } }

    case 'PLAYER_DISCONNECTED':
      return updatePlayer(state, event.playerId, (p) => ({
        ...p,
        status: 'disconnected',
        disconnectedAtTick: event.tick,
      }))

    case 'PLAYER_RECONNECTED':
      return updatePlayer(state, event.playerId, (p) => ({ ...p, status: 'alive', disconnectedAtTick: null }))

    case 'GRACE_EXPIRED':
      return eject(state, event.playerId)

    case 'VOTE_RESOLVED': {
      const recorded: MatchState = {
        ...state,
        voteHistory: [...state.voteHistory, { round: event.round, votes: event.votes, ejected: event.ejected }],
      }
      return event.ejected === null ? recorded : eject(recorded, event.ejected)
    }

    case 'STAGE_ADVANCED': {
      const newRound = event.round !== state.round
      return {
        ...state,
        round: event.round,
        stage: event.stage,
        stageEndsAtTick: event.endsAtTick,
        votes: event.stage === 'vote' ? {} : state.votes,
        lanes: newRound
          ? mapValues(state.lanes, (lane) => ({
              ...lane,
              roundStartUnits: lane.units,
              prevRoundDelta: lane.roundDelta,
              roundDelta: emptyDelta(),
            }))
          : state.lanes,
      }
    }

    case 'MATCH_RESOLVED':
      return {
        ...state,
        phase: 'SETTLING',
        resolution: { kind: 'won', winner: event.winner, reason: event.reason, tick: event.tick },
      }

    case 'MATCH_VOIDED':
      return { ...state, phase: 'VOIDING', resolution: { kind: 'voided', reason: event.reason, tick: event.tick } }

    default:
      return assertNever(event)
  }
}

function eject(state: MatchState, id: PlayerId): MatchState {
  const ejected = updatePlayer(state, id, (p) => ({ ...p, status: 'ejected', disconnectedAtTick: null }))
  return updateLane(ejected, id, (lane) => ({ ...lane, dormant: true }))
}

function updatePlayer(state: MatchState, id: PlayerId, update: (p: PlayerState) => PlayerState): MatchState {
  const player = state.players[id]
  if (player === undefined) throw new InvalidLogError(`Event references unknown player ${id}`)
  return { ...state, players: { ...state.players, [id]: update(player) } }
}

function updateLane(state: MatchState, id: PlayerId, update: (lane: LaneState) => LaneState): MatchState {
  const lane = state.lanes[id]
  if (lane === undefined) throw new InvalidLogError(`Event references unknown lane ${id}`)
  return { ...state, lanes: { ...state.lanes, [id]: update(lane) } }
}

function mapValues<T>(record: Record<string, T>, f: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, f(value)]))
}
