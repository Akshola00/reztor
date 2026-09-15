import type { Intent, MatchEvent, Rejection, RejectionCode } from '../../src/engine/events.js'
import { reduce } from '../../src/engine/reduce.js'
import type { Result } from '../../src/engine/result.js'
import type { MatchState } from '../../src/engine/state.js'
import { commit, processTick, type TickResult } from '../../src/engine/step.js'
import { assertInvariants } from './invariants.js'

// Freezing the input turns any accidental mutation inside the engine into a thrown TypeError.
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function checkedReduce(state: MatchState, event: MatchEvent): MatchState {
  deepFreeze(state)
  deepFreeze(event)
  const next = reduce(state, event)
  assertInvariants(state, next)
  return next
}

export function checkedCommit(state: MatchState, event: MatchEvent): MatchState {
  deepFreeze(state)
  deepFreeze(event)
  const next = commit(state, event)
  assertInvariants(state, next)
  return next
}

export function checkedTick(state: MatchState, tick: number, intents: Intent[] = []): TickResult {
  deepFreeze(state)
  const result = processTick(state, tick, intents)
  if (result.state !== state) assertInvariants(state, result.state)
  return result
}

export function runTicks(
  state: MatchState,
  from: number,
  to: number,
  intentsAt: (tick: number) => Intent[] = () => [],
): MatchState {
  let current = state
  for (let tick = from; tick <= to; tick++) current = checkedTick(current, tick, intentsAt(tick)).state
  return current
}

export function accept<E extends MatchEvent>(state: MatchState, result: Result<E, Rejection>): { state: MatchState; event: E } {
  if (!result.ok) throw new Error(`Expected the action to be accepted, got ${result.error.code}: ${result.error.reason}`)
  return { state: checkedCommit(state, result.value), event: result.value }
}

export function rejected(result: Result<unknown, Rejection>): RejectionCode {
  if (result.ok) throw new Error('Expected the action to be rejected, but it was accepted')
  return result.error.code
}
