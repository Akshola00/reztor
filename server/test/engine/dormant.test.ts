import { describe, expect, it } from 'vitest'
import type { MatchState, PlayerId } from '../../src/engine/state.js'
import { accept, rejected } from '../helpers/checked.js'
import { advanceStage, crew, disconnect, ejectByGrace, lane, newMatch, player, seedLane, setTier, tap } from '../helpers/fixtures.js'

// Crew member `a` is ejected by grace expiry at tick 121, leaving their lane dormant.
function dormantLane(ownerUnits: number): { s: MatchState; a: PlayerId; b: PlayerId; c: PlayerId } {
  let s = newMatch()
  const [a, b, c] = crew(s)
  if (ownerUnits > 0) s = seedLane(s, a, ownerUnits, 1)
  return { s: ejectByGrace(s, a, 1), a, b, c }
}

describe('dormant lanes', () => {
  it('tier-1 tap into a dormant lane eventually yields units', () => {
    let { s, a, b } = dormantLane(100)
    const units: number[] = []
    const remainders: (number | null)[] = []
    for (let tick = 122; tick <= 125; tick++) {
      const step = accept(s, tap(s, b, 1, tick, a))
      s = step.state
      units.push(step.event.units)
      remainders.push(step.event.remainderAfter)
    }
    expect(units).toEqual([0, 1, 0, 1])
    expect(remainders).toEqual([50, 0, 50, 0])
    expect(lane(s, a)).toMatchObject({ units: 102, roundDelta: { natural: 100, foreign: 2 } })
    expect(player(s, b)).toMatchObject({ unitsTapped: 2, spent: 4 })
  })

  it('a tier-2 tap yields 1.5 units, carrying the half into the next batch', () => {
    let { s, a, b } = dormantLane(0)
    s = accept(s, setTier(s, b, 2, 122)).state
    const first = accept(s, tap(s, b, 1, 122, a))
    expect(first.event).toMatchObject({ units: 1, cost: 4, remainderAfter: 50 })
    const second = accept(first.state, tap(first.state, b, 1, 123, a))
    expect(second.event).toMatchObject({ units: 2, remainderAfter: 0 })
  })

  it('keeps a separate remainder for each tapper', () => {
    let { s, a, b, c } = dormantLane(0)
    s = accept(s, tap(s, b, 1, 122, a)).state
    s = accept(s, tap(s, c, 1, 122, a)).state
    expect(lane(s, a)).toMatchObject({ units: 0, dormantRemainder: { [b]: 50, [c]: 50 } })
    const { event } = accept(s, tap(s, b, 1, 123, a))
    expect(event.units).toBe(1)
  })

  it('carries a remainder across rounds', () => {
    let { s, a, b } = dormantLane(0)
    s = accept(s, tap(s, b, 1, 122, a)).state
    s = advanceStage(s, 480, 2, 'tap')
    const { state, event } = accept(s, tap(s, b, 1, 481, a))
    expect(event).toMatchObject({ units: 1, remainderAfter: 0 })
    expect(lane(state, a).prevRoundDelta).toMatchObject({ foreign: 0 })
  })

  it('the ejected owner cannot tap their own lane', () => {
    const { s, a } = dormantLane(0)
    expect(rejected(tap(s, a, 1, 122))).toBe('NOT_ALIVE')
  })

  it('a disconnected player’s frozen lane is not dormant and cannot be tapped', () => {
    let s = newMatch()
    const [, b, c] = crew(s)
    s = disconnect(s, c, 1)
    expect(rejected(tap(s, b, 1, 2, c))).toBe('NOT_DORMANT')
  })

  it('stops at the cap without charging for a half-unit that could not land', () => {
    const { s, a, b } = dormantLane(999)
    const { state, event } = accept(s, tap(s, b, 3, 122, a))
    expect(event).toMatchObject({ applied: 2, units: 1, cost: 2, remainderAfter: 0, tokensAfter: 12 })
    expect(lane(state, a).units).toBe(1000)
  })

  it('drops a tier-2 dormant tap whose 1.5 units do not fit', () => {
    let { s, a, b } = dormantLane(999)
    s = accept(s, setTier(s, b, 2, 122)).state
    expect(rejected(tap(s, b, 1, 122, a))).toBe('LANE_FULL')
  })

  it('rejects a tap into a full dormant lane', () => {
    const { s, a, b } = dormantLane(1000)
    expect(rejected(tap(s, b, 1, 122, a))).toBe('LANE_FULL')
  })

  it('a pending remainder larger than the remaining headroom yields no tap, never negative units', () => {
    let { s, a, b, c } = dormantLane(999)
    s = accept(s, tap(s, b, 1, 122, a)).state
    s = accept(s, tap(s, c, 2, 123, a)).state
    expect(lane(s, a)).toMatchObject({ units: 1000, dormantRemainder: { [b]: 50, [c]: 0 } })
    expect(rejected(tap(s, b, 1, 124, a))).toBe('LANE_FULL')
  })
})
