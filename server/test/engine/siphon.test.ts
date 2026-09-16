import { describe, expect, it } from 'vitest'
import { accept, rejected } from '../helpers/checked.js'
import { advanceStage, crew, disconnect, ejectByGrace, lane, newMatch, player, seedLane, siphon } from '../helpers/fixtures.js'

function setup() {
  const s = newMatch()
  const [a, b, c] = crew(s)
  return { s, imp: s.impostorId, a, b, c }
}

describe('siphon', () => {
  it('frames another player: pulls 10, delivers 6, destroys 4, costs 6', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)
    const { state, event } = accept(s, siphon(s, imp, a, b, 2))
    expect(event).toMatchObject({ pulled: 10, delivered: 6, destroyed: 4, cost: 6, tokensAfter: 12 })
    expect(lane(state, a)).toMatchObject({ units: 10, roundDelta: { drained: 10 } })
    expect(lane(state, b)).toMatchObject({ units: 6, roundDelta: { received: 6 } })
    expect(player(state, imp)).toMatchObject({ credits: 1194, spent: 6 })
  })

  it('self-sinking costs 12', () => {
    let { s, imp, a } = setup()
    s = seedLane(s, a, 20, 1)
    const { state, event } = accept(s, siphon(s, imp, a, imp, 2))
    expect(event).toMatchObject({ delivered: 6, cost: 12 })
    expect(lane(state, imp).units).toBe(6)
  })

  it('the impostor’s own lane may be the source, at the framing price', () => {
    let { s, imp, a } = setup()
    s = seedLane(s, imp, 20, 1)
    const { state, event } = accept(s, siphon(s, imp, imp, a, 2))
    expect(event.cost).toBe(6)
    expect(lane(state, imp).units).toBe(10)
  })

  it('siphon from a lane with exactly 10 units', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 10, 1)
    const { state, event } = accept(s, siphon(s, imp, a, b, 2))
    expect(event).toMatchObject({ pulled: 10, delivered: 6 })
    expect(lane(state, a).units).toBe(0)
    expect(rejected(siphon(state, imp, a, b, 3))).toBe('SOURCE_TOO_LOW')

    const nine = seedLane(setup().s, a, 9, 1)
    expect(rejected(siphon(nine, imp, a, b, 2))).toBe('SOURCE_TOO_LOW')
  })

  it('siphon into a lane at 998', () => {
    // 998 leaves 2 units of headroom and a delivery is 6, so the siphon does not execute:
    // clipping would pay 2.5x the usual net destruction per credit and erase the sink's surge.
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)
    const nearFull = seedLane(s, b, 998, 1)
    expect(rejected(siphon(nearFull, imp, a, b, 2))).toBe('SINK_FULL')
    expect(lane(nearFull, a).units).toBe(20)

    const full = seedLane(s, b, 1000, 1)
    expect(rejected(siphon(full, imp, a, b, 2))).toBe('SINK_FULL')
  })

  it('accepts a sink with exactly 6 units of headroom and rejects one with 5', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)

    const exact = seedLane(s, b, 994, 1)
    const { state, event } = accept(exact, siphon(exact, imp, a, b, 2))
    expect(event).toMatchObject({ pulled: 10, delivered: 6, destroyed: 4 })
    expect(lane(state, b)).toMatchObject({ units: 1000, roundDelta: { received: 6 } })

    const tooFull = seedLane(s, b, 995, 1)
    expect(rejected(siphon(tooFull, imp, a, b, 2))).toBe('SINK_FULL')
  })

  it('rejects a siphon from a lane into itself', () => {
    let { s, imp, a } = setup()
    s = seedLane(s, a, 20, 1)
    expect(rejected(siphon(s, imp, a, a, 2))).toBe('SAME_LANE')
  })

  it('rejects a siphon from anyone but the impostor', () => {
    let { s, a, b, c } = setup()
    s = seedLane(s, b, 20, 1)
    expect(rejected(siphon(s, a, b, c, 2))).toBe('NOT_IMPOSTOR')
  })

  it('rejects a siphon out of or into a disconnected player’s frozen lane', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)
    expect(rejected(siphon(disconnect(s, a, 2), imp, a, b, 3))).toBe('LANE_FROZEN')
    expect(rejected(siphon(disconnect(s, b, 2), imp, a, b, 3))).toBe('LANE_FROZEN')
  })

  it('dormant lanes can be siphoned as a source and as a sink', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)
    s = seedLane(s, b, 20, 1)
    s = ejectByGrace(s, a, 1)
    s = accept(s, siphon(s, imp, a, b, 122)).state
    const { state } = accept(s, siphon(s, imp, b, a, 123))
    expect(lane(state, a)).toMatchObject({ units: 16, dormant: true, roundDelta: { drained: 10, received: 6 } })
  })

  it('rate-limits to a burst of 4 and a sustained 4 per second', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 1000, 1)
    for (let i = 0; i < 4; i++) s = accept(s, siphon(s, imp, a, b, 1)).state
    expect(rejected(siphon(s, imp, a, b, 1))).toBe('RATE_LIMITED')

    let sustained = 0
    for (let tick = 2; tick <= 9; tick++) {
      s = accept(s, siphon(s, imp, a, b, tick)).state
      sustained++
      expect(rejected(siphon(s, imp, a, b, tick))).toBe('RATE_LIMITED')
    }
    expect(sustained).toBe(8)
    expect(lane(s, a).units).toBe(1000 - 12 * 10)
  })

  it('a rejected siphon spends no token', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 100, 1)
    for (let i = 0; i < 5; i++) expect(rejected(siphon(s, imp, a, a, 1))).toBe('SAME_LANE')
    for (let i = 0; i < 4; i++) s = accept(s, siphon(s, imp, a, b, 1)).state
    expect(player(s, imp).siphonBucket.tokens).toBe(0)
  })

  it('checks credits against the sink-dependent price', () => {
    let s = newMatch({ buyInSkr: 1, creditsPerSkr: 11 })
    const imp = s.impostorId
    const [a, b] = crew(s)
    s = seedLane(s, a, 11, 1)
    expect(rejected(siphon(s, imp, a, imp, 2))).toBe('INSUFFICIENT_CREDITS')
    expect(accept(s, siphon(s, imp, a, b, 2)).event.cost).toBe(6)
  })

  it('reports the first failing check in the documented precedence', () => {
    let { s, imp, a, b, c } = setup()
    expect(rejected(siphon(s, a, b, b, 1))).toBe('NOT_IMPOSTOR')
    expect(rejected(siphon(s, imp, 'ghost', a, 1))).toBe('UNKNOWN_PLAYER')
    expect(rejected(siphon(s, imp, a, a, 1))).toBe('SAME_LANE')

    s = seedLane(seedLane(s, b, 1000, 1), c, 1000, 1)
    // An empty source into a full sink reports the source first.
    expect(rejected(siphon(s, imp, a, c, 1))).toBe('SOURCE_TOO_LOW')
    // Drain the bucket, then a full sink still outranks the rate limit.
    for (let i = 0; i < 4; i++) s = accept(s, siphon(s, imp, b, imp, 1)).state
    expect(rejected(siphon(s, imp, b, c, 1))).toBe('SINK_FULL')
    expect(rejected(siphon(s, imp, b, imp, 1))).toBe('RATE_LIMITED')
  })

  it('rejects siphons outside the tap stage', () => {
    let { s, imp, a, b } = setup()
    s = seedLane(s, a, 20, 1)
    s = advanceStage(s, 240, 1, 'chat')
    expect(rejected(siphon(s, imp, a, b, 241))).toBe('WRONG_STAGE')
  })
})
