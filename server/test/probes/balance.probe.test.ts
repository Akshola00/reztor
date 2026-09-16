import { describe, it } from 'vitest'
import { MVP_CONFIG, ticksFor } from '../../src/engine/config.js'
import type { Intent } from '../../src/engine/events.js'
import { initialState } from '../../src/engine/reduce.js'
import { processTick } from '../../src/engine/step.js'
import type { MatchState } from '../../src/engine/state.js'
import { matchStarted } from '../helpers/fixtures.js'

// Spec §11's assumption: three crew, sustained 4 taps per second at ~85%, no impostor activity.
// That is 204 taps per tap stage and 612 across the match. This probe prints two lines under that
// same cadence — tier 1 throughout, and the mixed-tier optimum of CLAUDE.md §12.1 — and compares
// them with the target. It asserts nothing and swallows its own errors, so it can never fail CI.
const CREW = ['p1', 'p3', 'p4']
const EFFICIENCY_NUM = 17
const EFFICIENCY_DEN = 20
const TIER_2_TAPS = 196 // t2 in the §12.1 optimum: 196 tier-2 then 416 tier-1 spends exactly 1200

const tapsThisTick = (tickInStage: number): boolean =>
  Math.floor((EFFICIENCY_NUM * tickInStage) / EFFICIENCY_DEN) >
  Math.floor((EFFICIENCY_NUM * (tickInStage - 1)) / EFFICIENCY_DEN)

const boardOf = (state: MatchState) => Object.values(state.lanes).reduce((sum, lane) => sum + lane.units, 0)
const lanesOf = (state: MatchState) => CREW.map((id) => state.lanes[id]?.units ?? 0).join(' / ')

const roundTicks = ticksFor(
  MVP_CONFIG.stageDurations.tap + MVP_CONFIG.stageDurations.chat + MVP_CONFIG.stageDurations.vote,
)

function run(label: string, mixedTiers: boolean): string[] {
  const lines = [`  ${label}`]
  let state = initialState(matchStarted())

  for (let tick = 1; tick <= MVP_CONFIG.rounds * roundTicks && state.resolution === null; tick++) {
    const intents: Intent[] = []
    if (state.stage === 'tap') {
      for (const playerId of CREW) {
        const player = state.players[playerId]
        if (player === undefined) continue
        // Start on tier 2, drop to tier 1 once the optimum's 196 tier-2 taps are spent.
        if (mixedTiers) {
          const wanted = player.tapsAccepted < TIER_2_TAPS ? 2 : 1
          if (player.tier !== wanted) intents.push({ kind: 'SET_TIER', playerId, tier: wanted })
        }
        if (tapsThisTick(tick - (state.round - 1) * roundTicks)) intents.push({ kind: 'TAP_BATCH', playerId, count: 1 })
      }
    }

    const before = state
    state = processTick(state, tick, intents).state
    if (before.stage === 'tap' && state.stage === 'chat') {
      lines.push(`    round ${before.round} taps end: lanes ${lanesOf(state)}  board ${boardOf(state)} / ${MVP_CONFIG.winTarget}`)
    }
  }

  const spent = CREW.map((id) => state.players[id]?.spent ?? 0)
  lines.push(
    `    final board ${boardOf(state)} of ${MVP_CONFIG.winTarget}; lanes ${lanesOf(state)}`,
    `    credits spent ${spent.join(' / ')} of ${MVP_CONFIG.buyInSkr * MVP_CONFIG.creditsPerSkr} each`,
    `    outcome: ${state.resolution === null ? 'unresolved at the final vote' : `${state.resolution.kind === 'voided' ? 'voided' : `${state.resolution.winner} win (${state.resolution.reason})`} at tick ${state.resolution.tick}`}`,
  )
  return lines
}

describe('balance probe (prints, never asserts)', () => {
  it('tier-1-only against the mixed-tier optimum, three crew at 4/sec × 85%', () => {
    const lines: string[] = []
    try {
      lines.push(...run('tier 1 throughout — leaves credits unspent, so not a baseline:', false))
      lines.push('', ...run('mixed tiers, the CLAUDE.md §12.1 optimum (196 tier-2 then tier-1):', true))
    } catch (error) {
      lines.push(`  probe could not finish: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log(['', 'BALANCE PROBE — spec §11 assumption: 4 taps/sec at 85%, three crew, no impostor', ...lines, ''].join('\n'))
  })
})
