import { describe, expect, it } from 'vitest'
import { reduce } from '../../src/engine/reduce.js'
import type { MatchState, PlayerId } from '../../src/engine/state.js'
import { assertInvariants } from '../helpers/invariants.js'
import { crew, lane, newMatch, player, seedLane } from '../helpers/fixtures.js'

function seeded(): { s: MatchState; a: PlayerId } {
  const s = newMatch()
  const [a] = crew(s)
  return { s: seedLane(s, a, 50, 1), a }
}

describe('assertInvariants catches corruption', () => {
  it('credits + spent must equal the buy-in', () => {
    const { s, a } = seeded()
    const bad = { ...s, players: { ...s.players, [a]: { ...player(s, a), credits: player(s, a).credits + 1 } } }
    expect(() => assertInvariants(null, bad)).toThrow(/credits \+ spent/)
  })

  it('lane units must match the round-delta identity', () => {
    const { s, a } = seeded()
    const bad = { ...s, lanes: { ...s.lanes, [a]: { ...lane(s, a), units: lane(s, a).units + 1 } } }
    expect(() => assertInvariants(null, bad)).toThrow(/roundStartUnits/)
  })

  it('the board must reconcile with units tapped and destroyed in the log', () => {
    const { s, a } = seeded()
    const l = lane(s, a)
    const bad = {
      ...s,
      lanes: { ...s.lanes, [a]: { ...l, units: l.units + 1, roundDelta: { ...l.roundDelta, natural: l.roundDelta.natural + 1 } } },
    }
    expect(() => assertInvariants(null, bad)).toThrow(/unit conservation/)
  })

  it('spent must reconcile with costs in the log', () => {
    const { s, a } = seeded()
    const p = player(s, a)
    const bad = { ...s, players: { ...s.players, [a]: { ...p, credits: p.credits - 1, spent: p.spent + 1 } } }
    expect(() => assertInvariants(null, bad)).toThrow(/credit conservation/)
  })

  it('impostorId must match the role seed', () => {
    const { s, a } = seeded()
    expect(() => assertInvariants(null, { ...s, impostorId: a })).toThrow(/roleSeed/)
  })

  it('nothing may follow a resolution', () => {
    const { s, a } = seeded()
    const resolved: MatchState = { ...s, resolution: { kind: 'voided', reason: 'ABANDONED', tick: 1 } }
    const next = reduce(resolved, { type: 'TIER_SET', tick: 2, playerId: a, tier: 2 })
    expect(() => assertInvariants(resolved, next)).toThrow(/follow a resolution/)
  })
})
