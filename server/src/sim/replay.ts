import { isDeepStrictEqual } from 'node:util'
import type { EventOf, Intent, MatchEvent, Rejection } from '../engine/events.js'
import { InvalidLogError, initialState, reduce } from '../engine/reduce.js'
import { err, ok, type Result } from '../engine/result.js'
import { checkResolution } from '../engine/rules.js'
import type { MatchState } from '../engine/state.js'
import { processTick, type CommitHook } from '../engine/step.js'

// A scripted match. `intentsAt` sees the state as it stands before `tick` is processed, which is
// exactly what a client would have seen when it sent them.
export type Scenario = {
  name: string
  started: EventOf<'MATCH_STARTED'>
  lastTick: number
  intentsAt: (tick: number, state: MatchState) => Intent[]
}

export type ScenarioRun = { state: MatchState; rejections: { tick: number; rejection: Rejection }[] }

// Drives a scenario through the same processTick the server runs, until it resolves or runs out.
export function runScenario(scenario: Scenario, onCommit?: CommitHook): ScenarioRun {
  let state = initialState(scenario.started)
  const rejections: ScenarioRun['rejections'] = []
  for (let tick = state.tick + 1; tick <= scenario.lastTick && state.resolution === null; tick++) {
    const result = processTick(state, tick, scenario.intentsAt(tick, state), onCommit)
    state = result.state
    for (const rejection of result.rejections) rejections.push({ tick, rejection })
  }
  return { state, rejections }
}

export type ReplayError = { index: number; reason: string }

// Rebuilds a match from its log with reduce alone. Resolutions are facts in the log, so replay runs
// no rules, except to confirm that each resolution is exactly the one the rules demand, where they
// demand it. A log that skips, invents, or alters a resolution does not replay (CLAUDE.md §9).
export function replayLog(log: readonly MatchEvent[], onStep?: CommitHook): Result<MatchState, ReplayError> {
  const [started, ...rest] = log
  if (started?.type !== 'MATCH_STARTED') return err({ index: 0, reason: 'The log must open with MATCH_STARTED' })

  let state = initialState(started)
  let owed: MatchEvent | null = null
  for (const [offset, event] of rest.entries()) {
    const index = offset + 1
    if (owed !== null && !isDeepStrictEqual(event, owed)) {
      return err({ index, reason: `Expected ${JSON.stringify(owed)}, found ${event.type}` })
    }
    if (owed === null && (event.type === 'MATCH_RESOLVED' || event.type === 'MATCH_VOIDED')) {
      return err({ index, reason: `${event.type} where the rules resolve nothing` })
    }

    const prev = state
    try {
      state = reduce(state, event)
    } catch (error) {
      if (error instanceof InvalidLogError) return err({ index, reason: error.message })
      throw error
    }
    onStep?.(prev, state, event)
    owed = checkResolution(state)
  }

  if (owed !== null) return err({ index: log.length, reason: `The log ends before its ${owed.type}` })
  return ok(state)
}
