import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MatchConfig } from '../../src/engine/config.js'
import type { Intent } from '../../src/engine/events.js'
import { initialState } from '../../src/engine/reduce.js'
import { computeSettlement, settlementBalances } from '../../src/engine/settlement.js'
import { processTick } from '../../src/engine/step.js'
import { replayLog } from '../../src/sim/replay.js'
import { verifyCommit } from '../helpers/checked.js'
import { PLAYER_IDS, matchStarted } from '../helpers/fixtures.js'
import { assertInvariants } from '../helpers/invariants.js'
import { assertSecretsHidden } from '../helpers/secrets.js'

// A compressed match: short stages, a small board and few credits, so random play actually reaches
// lane caps, empty wallets, ejections and grace expiries inside a run instead of drifting.
const CONFIG: Partial<MatchConfig> = {
  laneCapacity: 40,
  winTarget: 90,
  trace: { cost: 10, perPlayer: 1 },
  stageDurations: { tap: 5, chat: 2, vote: 2 },
  buyInSkr: 1,
  creditsPerSkr: 60,
  disconnectGraceSec: 3,
}
const TICKS = 3 * 4 * (5 + 2 + 2)

const id = fc.constantFrom(...PLAYER_IDS)
// Votes bunch on a target instead of scattering over four, so majorities actually form and
// ejection wins get exercised rather than every match timing out.
const target = fc.constantFrom<Intent['playerId'] | 'skip'>('p2', 'p2', 'p1', 'p3', 'p4', 'skip')
// p2 is the impostor for the fixture seed. Weighting them in means siphons are often legal, so the
// siphon rules are exercised rather than bounced at NOT_IMPOSTOR.
const siphoner = fc.constantFrom('p2', 'p2', 'p1', 'p3', 'p4')

const intent: fc.Arbitrary<Intent> = fc.oneof(
  { weight: 10, arbitrary: fc.record({ kind: fc.constant('TAP_BATCH' as const), playerId: id, count: fc.integer({ min: 1, max: 8 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('TAP_BATCH' as const), playerId: id, count: fc.integer({ min: 1, max: 8 }), lane: id }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('SET_TIER' as const), playerId: id, tier: fc.constantFrom(1 as const, 2 as const) }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('SIPHON' as const), playerId: siphoner, source: id, sink: id }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('TRACE' as const), playerId: id, target: id }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('CHAT' as const), playerId: id, text: fc.string({ minLength: 1, maxLength: 16 }) }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('VOTE' as const), playerId: id, target }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('DISCONNECT' as const), playerId: id }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('RECONNECT' as const), playerId: id }) },
)

// One queue per tick, so scripts are dense enough for lanes to fill, wallets to empty and votes to
// carry. A sparse list of (tick, intent) pairs shrinks toward doing nothing at all.
const script = fc.array(fc.array(intent, { maxLength: 3 }), { minLength: TICKS, maxLength: TICKS })

describe('invariants hold for any stream of intents', () => {
  it('every CLAUDE.md §13.2 invariant survives random play, replay and settlement', () => {
    fc.assert(
      fc.property(script, (queues) => {
        let state = initialState(matchStarted(CONFIG))
        assertInvariants(null, state)
        assertSecretsHidden(state)

        // Checked after every commit, not every tick, so nothing can be repaired before it is seen.
        for (let tick = 1; tick <= TICKS && state.resolution === null; tick++) {
          state = processTick(state, tick, queues[tick - 1] ?? [], verifyCommit).state
        }

        // The log alone rebuilds the match, byte for byte.
        const replayed = replayLog(state.eventLog, verifyCommit)
        if (!replayed.ok) throw new Error(`Replay failed at ${replayed.error.index}: ${replayed.error.reason}`)
        expect(replayed.value).toEqual(state)

        if (state.resolution !== null) {
          const settlement = computeSettlement(state.eventLog, state.config)
          if (!settlement.ok) throw new Error(`Settlement failed: ${settlement.error}`)
          expect(settlementBalances(settlement.value)).toBe(true)
        }
      }),
      // Fixed seed so CI is deterministic; PROPERTY_RUNS raises it for a deeper local sweep.
      { seed: 42, numRuns: Number(process.env.PROPERTY_RUNS ?? 500) },
    )
  }, 180_000)
})
