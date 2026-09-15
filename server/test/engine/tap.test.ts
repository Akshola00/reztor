import { describe, expect, it } from 'vitest'
import { accept, rejected } from '../helpers/checked.js'
import { advanceStage, crew, disconnect, lane, newMatch, player, seedLane, setTier, tap } from '../helpers/fixtures.js'

describe('tap batch', () => {
  it('applies tier-1 taps to the sender’s own lane', () => {
    const s = newMatch()
    const [a] = crew(s)
    const { state, event } = accept(s, tap(s, a, 6, 1))
    expect(event).toMatchObject({ applied: 6, units: 6, cost: 6, tokenDropped: 0, tokensAfter: 0, remainderAfter: null })
    expect(lane(state, a)).toMatchObject({ units: 6, roundDelta: { natural: 6, foreign: 0 } })
    expect(player(state, a)).toMatchObject({ credits: 1194, spent: 6, tapsAccepted: 6, tapsDropped: 0, unitsTapped: 6 })
  })

  it('prices and yields by the stored tier, which only affects later batches', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = accept(s, tap(s, a, 1, 1)).state
    s = accept(s, setTier(s, a, 2, 1)).state
    const { event } = accept(s, tap(s, a, 2, 2))
    expect(event).toMatchObject({ applied: 2, units: 6, cost: 8 })
  })

  it('drops taps beyond the token bucket silently and counts them in tapsDropped', () => {
    const s = newMatch()
    const [a] = crew(s)
    const { state, event } = accept(s, tap(s, a, 10, 1))
    expect(event).toMatchObject({ requested: 10, applied: 6, tokenDropped: 4 })
    expect(player(state, a).tapsDropped).toBe(4)
  })

  it('accepts a batch entirely over the rate clamp as a silent drop, not a rejection', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = accept(s, tap(s, a, 6, 1)).state
    const { state, event } = accept(s, tap(s, a, 3, 1))
    expect(event).toMatchObject({ applied: 0, tokenDropped: 3, cost: 0 })
    expect(player(state, a)).toMatchObject({ tapsDropped: 3, credits: 1194 })
  })

  it('refills lazily at 6 quarter-tokens per tick, sustaining exactly 6 taps per second', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = accept(s, tap(s, a, 6, 1)).state
    const perTick: number[] = []
    for (let tick = 2; tick <= 41; tick++) {
      const step = accept(s, tap(s, a, 6, tick))
      s = step.state
      perTick.push(step.event.applied)
    }
    expect(perTick.slice(0, 4)).toEqual([1, 2, 1, 2])
    expect(perTick.reduce((sum, n) => sum + n, 0)).toBe(60)
  })

  it('never refills past capacity however long the player idles', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = accept(s, tap(s, a, 6, 1)).state
    const { event } = accept(s, tap(s, a, 10, 200))
    expect(event).toMatchObject({ applied: 6, tokenDropped: 4, tokensAfter: 0 })
  })

  it('applies what the player can afford, spending tokens for every tap that cleared the clamp', () => {
    let s = newMatch({ buyInSkr: 1, creditsPerSkr: 10 })
    const [a] = crew(s)
    s = accept(s, setTier(s, a, 2, 1)).state
    const { state, event } = accept(s, tap(s, a, 6, 1))
    expect(event).toMatchObject({ applied: 2, units: 6, cost: 8, tokenDropped: 0, tokensAfter: 0 })
    expect(player(state, a)).toMatchObject({ credits: 2, tapsDropped: 0 })
  })

  it('stops a tier-1 batch exactly at the lane cap without charging past it', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = seedLane(s, a, 998, 1)
    const { state, event } = accept(s, tap(s, a, 5, 1))
    expect(event).toMatchObject({ applied: 2, cost: 2, tokensAfter: 4 })
    expect(lane(state, a).units).toBe(1000)
    expect(player(state, a).tapsDropped).toBe(0)
  })

  it('drops a tier-2 tap that does not fully fit instead of clipping it', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = seedLane(s, a, 997, 1)
    s = accept(s, setTier(s, a, 2, 1)).state
    const { state, event } = accept(s, tap(s, a, 2, 1))
    expect(event).toMatchObject({ applied: 1, units: 3, cost: 4 })
    expect(lane(state, a).units).toBe(1000)

    let t = seedLane(newMatch(), a, 998, 1)
    t = accept(t, setTier(t, a, 2, 1)).state
    expect(rejected(tap(t, a, 1, 1))).toBe('LANE_FULL')
  })

  it('batch that exceeds credits, clamp, and lane cap simultaneously', () => {
    let s = newMatch({ buyInSkr: 1, creditsPerSkr: 12, laneCapacity: 10 })
    const [a] = crew(s)
    s = seedLane(s, a, 7, 1)
    const { state, event } = accept(s, tap(s, a, 10, 1))
    expect(event).toMatchObject({ requested: 10, tokenDropped: 4, applied: 3, units: 3, cost: 3, tokensAfter: 0 })
    expect(lane(state, a).units).toBe(10)
    expect(player(state, a)).toMatchObject({ credits: 2, tapsDropped: 4, tapsAccepted: 10 })
  })

  it('rejects a batch that applies nothing because the player is out of credits', () => {
    let s = newMatch({ buyInSkr: 1, creditsPerSkr: 12 })
    const [a] = crew(s)
    s = seedLane(s, a, 12, 1)
    expect(rejected(tap(s, a, 1, 2))).toBe('INSUFFICIENT_CREDITS')
  })

  it('rejects a batch into a full lane', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = seedLane(s, a, 1000, 1)
    expect(rejected(tap(s, a, 1, 2))).toBe('LANE_FULL')
  })

  it('rejects taps and tier changes outside the tap stage', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = advanceStage(s, 240, 1, 'chat')
    expect(rejected(tap(s, a, 1, 241))).toBe('WRONG_STAGE')
    expect(rejected(setTier(s, a, 2, 241))).toBe('WRONG_STAGE')
  })

  it('rejects unknown senders and unknown lanes', () => {
    const s = newMatch()
    const [a] = crew(s)
    expect(rejected(tap(s, 'ghost', 1, 1))).toBe('UNKNOWN_PLAYER')
    expect(rejected(tap(s, a, 1, 1, 'ghost'))).toBe('UNKNOWN_PLAYER')
  })

  it('rejects taps from a disconnected player', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = disconnect(s, a, 1)
    expect(rejected(tap(s, a, 1, 2))).toBe('NOT_ALIVE')
  })

  it('rejects tapping another living player’s lane', () => {
    const s = newMatch()
    const [a, b] = crew(s)
    expect(rejected(tap(s, a, 1, 1, b))).toBe('NOT_DORMANT')
  })

  it('crossing the win target latches a crew win, after which every tap is rejected', () => {
    let s = newMatch()
    const [a, b, c] = crew(s)
    s = seedLane(s, a, 1000, 1)
    s = seedLane(s, b, 1000, 1)
    s = seedLane(s, c, 399, 1)
    const { state } = accept(s, tap(s, c, 1, 2))
    expect(state.resolution).toEqual({ kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 2 })
    expect(state.eventLog.at(-1)?.type).toBe('MATCH_RESOLVED')
    expect(rejected(tap(state, c, 1, 3))).toBe('MATCH_OVER')
  })
})
