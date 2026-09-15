import { describe, expect, it } from 'vitest'
import { MVP_CONFIG } from '../../src/engine/config.js'
import { InvalidLogError, initialState, reduce } from '../../src/engine/reduce.js'
import { checkedReduce } from '../helpers/checked.js'
import { crew, lane, matchStarted, newMatch, player, seedLane } from '../helpers/fixtures.js'

describe('initialState', () => {
  it('opens a match in round 1 tap with full buckets and the buy-in as credits', () => {
    const started = matchStarted()
    const s = initialState(started)
    expect(s).toMatchObject({ phase: 'IN_PROGRESS', round: 1, stage: 'tap', stageEndsAtTick: 240, tick: 0 })
    expect(s.eventLog).toEqual([started])
    expect(s.resolution).toBeNull()
    for (const id of Object.keys(s.players)) {
      expect(player(s, id)).toMatchObject({
        credits: 1200,
        spent: 0,
        tier: 1,
        status: 'alive',
        wallet: null,
        tapBucket: { tokens: 24, updatedAtTick: 0 },
        siphonBucket: { tokens: 16, updatedAtTick: 0 },
      })
      expect(lane(s, id)).toMatchObject({ units: 0, dormant: false, prevRoundDelta: null })
    }
  })
})

describe('reduce', () => {
  it('appends the event, sets tick, and leaves the input untouched', () => {
    const s = newMatch()
    const [a] = crew(s)
    const before = structuredClone(s)
    const next = checkedReduce(s, { type: 'TIER_SET', tick: 5, playerId: a, tier: 2 })
    expect(s).toEqual(before)
    expect(next.tick).toBe(5)
    expect(next.eventLog.at(-1)).toMatchObject({ type: 'TIER_SET' })
    expect(player(next, a).tier).toBe(2)
  })

  it('TAPS_APPLIED into an own lane charges the player and credits natural', () => {
    const s = newMatch()
    const [a] = crew(s)
    const next = seedLane(s, a, 40, 3)
    expect(player(next, a)).toMatchObject({ credits: 1160, spent: 40, tapsAccepted: 40, unitsTapped: 40 })
    expect(lane(next, a)).toMatchObject({ units: 40, roundDelta: { natural: 40, foreign: 0 } })
    expect(player(next, a).tapBucket.updatedAtTick).toBe(3)
  })

  it('TAPS_APPLIED into a dormant lane credits foreign and stores the tapper remainder', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = checkedReduce(s, { type: 'GRACE_EXPIRED', tick: 1, playerId: a })
    s = checkedReduce(s, {
      type: 'TAPS_APPLIED',
      tick: 2,
      playerId: b,
      lane: a,
      requested: 3,
      tokenDropped: 0,
      applied: 3,
      units: 1,
      cost: 3,
      tokensAfter: 12,
      remainderAfter: 50,
    })
    expect(lane(s, a)).toMatchObject({ units: 1, roundDelta: { natural: 0, foreign: 1 }, dormantRemainder: { [b]: 50 } })
    expect(player(s, b)).toMatchObject({ unitsTapped: 1, spent: 3 })
  })

  it('SIPHONED moves units, records drained and received, and charges the impostor', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    const imp = s.impostorId
    s = seedLane(s, a, 20, 1)
    s = checkedReduce(s, {
      type: 'SIPHONED',
      tick: 2,
      playerId: imp,
      source: a,
      sink: b,
      pulled: 10,
      delivered: 6,
      destroyed: 4,
      cost: 6,
      tokensAfter: 12,
    })
    expect(lane(s, a)).toMatchObject({ units: 10, roundDelta: { drained: 10 } })
    expect(lane(s, b)).toMatchObject({ units: 6, roundDelta: { received: 6 } })
    expect(player(s, imp)).toMatchObject({ credits: 1194, siphonBucket: { tokens: 12, updatedAtTick: 2 } })
  })

  it('SIPHONED into a near-full sink records only what landed as received', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = seedLane(s, a, 20, 1)
    s = seedLane(s, b, 997, 1)
    s = checkedReduce(s, {
      type: 'SIPHONED',
      tick: 2,
      playerId: s.impostorId,
      source: a,
      sink: b,
      pulled: 10,
      delivered: 3,
      destroyed: 7,
      cost: 6,
      tokensAfter: 12,
    })
    expect(lane(s, b)).toMatchObject({ units: 1000, roundDelta: { received: 3 } })
  })

  it('TRACED charges the purchaser and marks the trace used', () => {
    const s = newMatch()
    const [a, b] = crew(s)
    const next = checkedReduce(s, { type: 'TRACED', tick: 500, playerId: a, target: b, result: 'natural', cost: 200 })
    expect(player(next, a)).toMatchObject({ credits: 1000, spent: 200, traceUsed: true })
  })

  it('CHAT_POSTED appends to chat and records the sender’s last chat tick', () => {
    const s = newMatch()
    const [a] = crew(s)
    const next = checkedReduce(s, { type: 'CHAT_POSTED', tick: 250, playerId: a, text: 'hi' })
    expect(next.chat).toEqual([{ from: a, text: 'hi', tick: 250 }])
    expect(player(next, a).lastChatTick).toBe(250)
  })

  it('VOTE_CAST keeps only the last vote per player', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = checkedReduce(s, { type: 'VOTE_CAST', tick: 421, playerId: a, target: b })
    s = checkedReduce(s, { type: 'VOTE_CAST', tick: 422, playerId: a, target: 'skip' })
    expect(s.votes).toEqual({ [a]: 'skip' })
  })

  it('PLAYER_DISCONNECTED and PLAYER_RECONNECTED toggle status and the grace clock', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = checkedReduce(s, { type: 'PLAYER_DISCONNECTED', tick: 10, playerId: a })
    expect(player(s, a)).toMatchObject({ status: 'disconnected', disconnectedAtTick: 10 })
    s = checkedReduce(s, { type: 'PLAYER_RECONNECTED', tick: 20, playerId: a })
    expect(player(s, a)).toMatchObject({ status: 'alive', disconnectedAtTick: null })
  })

  it('GRACE_EXPIRED ejects the player and makes their lane dormant', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = checkedReduce(s, { type: 'PLAYER_DISCONNECTED', tick: 10, playerId: a })
    s = checkedReduce(s, { type: 'GRACE_EXPIRED', tick: 130, playerId: a })
    expect(player(s, a)).toMatchObject({ status: 'ejected', disconnectedAtTick: null })
    expect(lane(s, a).dormant).toBe(true)
  })

  it('VOTE_RESOLVED records the round and ejects the chosen player', () => {
    const s = newMatch()
    const [a, b, c] = crew(s)
    const votes = { [a]: b, [c]: b, [s.impostorId]: b, [b]: 'skip' }
    const next = checkedReduce(s, { type: 'VOTE_RESOLVED', tick: 480, round: 1, votes, ejected: b })
    expect(next.voteHistory).toEqual([{ round: 1, votes, ejected: b }])
    expect(player(next, b).status).toBe('ejected')
    expect(lane(next, b).dormant).toBe(true)
  })

  it('VOTE_RESOLVED with nobody ejected changes no player', () => {
    const s = newMatch()
    const next = checkedReduce(s, { type: 'VOTE_RESOLVED', tick: 480, round: 1, votes: {}, ejected: null })
    expect(next.players).toBe(s.players)
    expect(next.voteHistory).toHaveLength(1)
  })

  it('STAGE_ADVANCED into vote clears votes', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = checkedReduce(s, { type: 'VOTE_CAST', tick: 300, playerId: a, target: b })
    s = checkedReduce(s, { type: 'STAGE_ADVANCED', tick: 420, round: 1, stage: 'vote', endsAtTick: 480 })
    expect(s).toMatchObject({ stage: 'vote', stageEndsAtTick: 480, votes: {} })
  })

  it('STAGE_ADVANCED into a new round snapshots units and rotates round deltas', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = seedLane(s, a, 30, 1)
    s = checkedReduce(s, { type: 'STAGE_ADVANCED', tick: 480, round: 2, stage: 'tap', endsAtTick: 720 })
    expect(s).toMatchObject({ round: 2, stage: 'tap' })
    expect(lane(s, a)).toMatchObject({
      units: 30,
      roundStartUnits: 30,
      prevRoundDelta: { natural: 30, foreign: 0, received: 0, drained: 0 },
      roundDelta: { natural: 0, foreign: 0, received: 0, drained: 0 },
    })
  })

  it('MATCH_RESOLVED and MATCH_VOIDED set the terminal phase', () => {
    const s = newMatch()
    const won = checkedReduce(s, { type: 'MATCH_RESOLVED', tick: 9, winner: 'crew', reason: 'BOARD_TARGET' })
    expect(won).toMatchObject({ phase: 'SETTLING', resolution: { kind: 'won', winner: 'crew', tick: 9 } })
    const voided = checkedReduce(s, { type: 'MATCH_VOIDED', tick: 9, reason: 'ABANDONED' })
    expect(voided).toMatchObject({ phase: 'VOIDING', resolution: { kind: 'voided', reason: 'ABANDONED' } })
  })

  it('throws InvalidLogError for a second MATCH_STARTED or an unknown player', () => {
    const s = newMatch()
    expect(() => reduce(s, matchStarted())).toThrow(InvalidLogError)
    expect(() => reduce(s, { type: 'TIER_SET', tick: 1, playerId: 'ghost', tier: 2 })).toThrow(InvalidLogError)
  })

  it('uses the config frozen into the match, not the live defaults', () => {
    const s = newMatch({ buyInSkr: 1, creditsPerSkr: 10 })
    expect(player(s, crew(s)[0]).credits).toBe(10)
    expect(MVP_CONFIG.buyInSkr).toBe(12)
  })
})
