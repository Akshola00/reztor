import { ticksFor } from './config.js'
import type { Intent, MatchEvent, Rejection } from './events.js'
import { reduce } from './reduce.js'
import { assertNever } from './result.js'
import { checkResolution, decide, dueGraceExpiries, resolveVote } from './rules.js'
import type { MatchState, Stage } from './state.js'

// The single place engine state changes. Every reduce is followed by the win and void check
// (CLAUDE.md §5.6), and a resolution is itself logged so replay needs no rule code.
export function commit(state: MatchState, event: MatchEvent): MatchState {
  const next = reduce(state, event)
  const resolution = checkResolution(next)
  return resolution === null ? next : reduce(next, resolution)
}

// Observes every commit inside a tick. `next` includes any resolution that `event` triggered.
export type CommitHook = (prev: MatchState, next: MatchState, event: MatchEvent) => void

export type TickResult = { state: MatchState; rejections: Rejection[] }

// One tick of CLAUDE.md §6 for one match: drain intents in queue order, then grace expiries,
// then the stage clock. Intents therefore land in the stage that is closing on this tick, and a
// reconnect on the expiry tick beats the expiry. Every commit checks resolution, so a match that
// resolves part-way through a tick rejects the rest of its queue and advances nothing further.
export function processTick(
  state: MatchState,
  tick: number,
  intents: readonly Intent[],
  onCommit?: CommitHook,
): TickResult {
  // The runtime owns the clock; a tick behind the last logged event is a caller bug, not a rule outcome.
  if (tick < state.tick) throw new RangeError(`Tick ${tick} is behind the match clock at ${state.tick}`)

  const apply = (prev: MatchState, event: MatchEvent): MatchState => {
    const next = commit(prev, event)
    onCommit?.(prev, next, event)
    return next
  }

  let current = state
  const rejections: Rejection[] = []

  for (const intent of intents) {
    const decided = decide(current, intent, tick)
    if (decided.ok) current = apply(current, decided.value)
    else rejections.push(decided.error)
  }

  for (const expiry of dueGraceExpiries(current, tick)) {
    if (current.resolution !== null) break
    current = apply(current, expiry)
  }

  if (current.resolution === null && tick >= current.stageEndsAtTick) {
    current = advanceClock(current, tick, apply)
  }

  return { state: current, rejections }
}

function advanceClock(
  state: MatchState,
  tick: number,
  apply: (prev: MatchState, event: MatchEvent) => MatchState,
): MatchState {
  const { stageDurations, rounds } = state.config
  const open = (round: number, stage: Stage): MatchEvent => ({
    type: 'STAGE_ADVANCED',
    tick,
    round,
    stage,
    // Scheduled from the previous boundary rather than from `tick`, so the stage clock cannot drift.
    endsAtTick: state.stageEndsAtTick + ticksFor(stageDurations[stage]),
  })

  switch (state.stage) {
    case 'tap':
      return apply(state, open(state.round, 'chat'))
    case 'chat':
      return apply(state, open(state.round, 'vote'))
    case 'vote': {
      const closed = apply(state, resolveVote(state, tick))
      return closed.resolution === null && state.round < rounds ? apply(closed, open(state.round + 1, 'tap')) : closed
    }
    default:
      return assertNever(state.stage)
  }
}
