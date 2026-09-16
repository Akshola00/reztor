import { describe, it } from 'vitest'
import { MVP_CONFIG, ticksFor } from '../../src/engine/config.js'
import type { Intent } from '../../src/engine/events.js'
import { initialState } from '../../src/engine/reduce.js'
import { processTick } from '../../src/engine/step.js'
import type { MatchState } from '../../src/engine/state.js'
import { matchStarted } from '../helpers/fixtures.js'

// Spec §11's balance assumption: sustained 4 taps per second at ~85% of theoretical, three crew,
// tier 1, no impostor activity. This probe prints what the engine actually produces. It asserts
// nothing and swallows its own errors, so it can never fail CI.
const CREW = ['p1', 'p3', 'p4']
const EFFICIENCY_NUM = 17 // 85% as 17/20, applied to one tap per tick (4 taps per second)
const EFFICIENCY_DEN = 20

const tapsThisTick = (tickInStage: number): boolean =>
  Math.floor((EFFICIENCY_NUM * tickInStage) / EFFICIENCY_DEN) >
  Math.floor((EFFICIENCY_NUM * (tickInStage - 1)) / EFFICIENCY_DEN)

const lanesOf = (state: MatchState) => CREW.map((id) => state.lanes[id]?.units ?? 0)
const boardOf = (state: MatchState) => Object.values(state.lanes).reduce((sum, lane) => sum + lane.units, 0)

describe('balance probe (prints, never asserts)', () => {
  it('three crew tapping at 4/sec × 85%, tier 1, no impostor', () => {
    const lines: string[] = []
    try {
      const roundTicks = ticksFor(
        MVP_CONFIG.stageDurations.tap + MVP_CONFIG.stageDurations.chat + MVP_CONFIG.stageDurations.vote,
      )
      const lastTick = MVP_CONFIG.rounds * roundTicks
      let state = initialState(matchStarted())

      for (let tick = 1; tick <= lastTick && state.resolution === null; tick++) {
        const tickInStage = tick - (state.round - 1) * roundTicks
        const intents: Intent[] =
          state.stage === 'tap' && tapsThisTick(tickInStage)
            ? CREW.map((playerId) => ({ kind: 'TAP_BATCH', playerId, count: 1 }))
            : []
        const before = state
        state = processTick(state, tick, intents).state

        if (before.stage === 'tap' && state.stage === 'chat') {
          const [a, b, c] = lanesOf(state)
          lines.push(
            `  round ${before.round} tap stage ends: lanes ${a} / ${b} / ${c}  board ${boardOf(state)} / ${MVP_CONFIG.winTarget}`,
          )
        }
      }

      const board = boardOf(state)
      const perLane = Math.round(board / CREW.length)
      const spent = CREW.map((id) => state.players[id]?.spent ?? 0)
      lines.push(
        `  final: board ${board}, about ${perLane} per lane, target ${MVP_CONFIG.winTarget}`,
        `  spec §11 predicts ~850 per lane and ~2550 board`,
        `  gap: ${MVP_CONFIG.winTarget - board} units short of the target, ${2550 - board} short of the spec's estimate`,
        `  credits spent per crewmate: ${spent.join(' / ')} of ${MVP_CONFIG.buyInSkr * MVP_CONFIG.creditsPerSkr}`,
        `  to reach the target on tier 1, each lane needs ${Math.ceil(MVP_CONFIG.winTarget / CREW.length)} units`,
        `  that is ${((MVP_CONFIG.winTarget / CREW.length / (MVP_CONFIG.rounds * ticksFor(MVP_CONFIG.stageDurations.tap))) * 4).toFixed(2)} taps/sec sustained at 100% efficiency`,
        `  match outcome: ${state.resolution === null ? 'unresolved' : JSON.stringify(state.resolution)}`,
      )
    } catch (error) {
      lines.push(`  probe could not finish: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log(['', 'BALANCE PROBE — 4 taps/sec at 85%, three crew, tier 1, no impostor', ...lines, ''].join('\n'))
  })
})
