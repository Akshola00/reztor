import { describe, expect, it } from 'vitest'
import { checkResolution } from '../../src/engine/rules.js'
import { checkedReduce } from '../helpers/checked.js'
import { crew, disconnect, expireDue, newMatch, runVote, seedLane } from '../helpers/fixtures.js'

function setup() {
  const s = newMatch()
  const [a, b, c] = crew(s)
  return { s, imp: s.impostorId, a, b, c }
}

describe('Q1 table: void triggers vs win conditions', () => {
  it('(a) two crew voted out → impostor wins, CREW_EJECTED', () => {
    const { s, a, b } = setup()
    const afterFirst = runVote(s, 1, a)
    expect(afterFirst.resolution).toBeNull()
    const final = runVote(afterFirst, 2, b)
    expect(final.resolution).toMatchObject({ kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED' })
  })

  it('(b) one crew voted out and one crew past grace → impostor wins, not a void', () => {
    const { s, a, b } = setup()
    const final = expireDue(disconnect(runVote(s, 1, a), b, 500), 620)
    expect(final.resolution).toMatchObject({ kind: 'won', winner: 'impostor', reason: 'CREW_EJECTED' })
  })

  it('(c) a crew member then the impostor past grace → crew wins, IMPOSTOR_TIMED_OUT, not a void', () => {
    const { s, imp, a } = setup()
    const bothDropped = disconnect(disconnect(s, a, 10), imp, 20)
    const crewExpired = expireDue(bothDropped, 130)
    expect(crewExpired.resolution).toBeNull()
    const final = expireDue(crewExpired, 140)
    expect(final.resolution).toMatchObject({ kind: 'won', winner: 'crew', reason: 'IMPOSTOR_TIMED_OUT' })
  })

  it('(d) two players disconnected but within grace → nothing resolves; wait for expiry', () => {
    const { s, a, b } = setup()
    const waiting = expireDue(disconnect(disconnect(s, a, 10), b, 10), 129)
    expect(waiting.resolution).toBeNull()
    expect(waiting.eventLog.at(-1)?.type).toBe('PLAYER_DISCONNECTED')
  })

  it('(e) two crew past grace → MATCH_VOIDED, ABANDONED — void by abandonment, above the crew-ejection win', () => {
    const { s, a, b } = setup()
    const final = expireDue(disconnect(disconnect(s, a, 10), b, 10), 130)
    expect(final.resolution).toEqual({ kind: 'voided', reason: 'ABANDONED', tick: 130 })
    expect(final.phase).toBe('VOIDING')
    expect(final.eventLog.slice(-3).map((e) => e.type)).toEqual(['GRACE_EXPIRED', 'GRACE_EXPIRED', 'MATCH_VOIDED'])
  })

  it('(e′) abandonments spread across rounds still void', () => {
    const { s, a, b } = setup()
    const firstGone = expireDue(disconnect(s, a, 10), 130)
    const final = expireDue(disconnect(runVote(firstGone, 1, null), b, 600), 720)
    expect(final.resolution).toMatchObject({ kind: 'voided', reason: 'ABANDONED' })
  })
})

describe('resolution order', () => {
  it('the impostor abandoning alone is a crew win', () => {
    const { s, imp } = setup()
    const final = expireDue(disconnect(s, imp, 10), 130)
    expect(final.resolution).toMatchObject({ winner: 'crew', reason: 'IMPOSTOR_TIMED_OUT' })
  })

  it('the impostor and a crew member expiring in the same tick is a crew win, whichever sorts first', () => {
    const { s, imp, a, b, c } = setup()
    for (const member of [a, b, c]) {
      const final = expireDue(disconnect(disconnect(s, member, 10), imp, 10), 130)
      expect(final.resolution).toMatchObject({ winner: 'crew', reason: 'IMPOSTOR_TIMED_OUT' })
    }
  })

  it('voting out the impostor is a crew win', () => {
    const { s, imp } = setup()
    expect(runVote(s, 1, imp).resolution).toMatchObject({ winner: 'crew', reason: 'IMPOSTOR_EJECTED' })
  })

  it('round 3’s vote closing below target is an impostor win, and not before', () => {
    const { s } = setup()
    const afterTwo = runVote(runVote(s, 1, null), 2, null)
    expect(afterTwo.resolution).toBeNull()
    const final = runVote(afterTwo, 3, null)
    expect(final.resolution).toMatchObject({ winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 })
  })

  it('ejecting the impostor in round 3 is IMPOSTOR_EJECTED, not ROUNDS_EXHAUSTED', () => {
    const { s, imp } = setup()
    const final = runVote(runVote(runVote(s, 1, null), 2, null), 3, imp)
    expect(final.resolution).toMatchObject({ winner: 'crew', reason: 'IMPOSTOR_EJECTED' })
  })

  it('ejecting a second crew member in round 3 is CREW_EJECTED, not ROUNDS_EXHAUSTED', () => {
    const { s, a, b } = setup()
    const final = runVote(runVote(runVote(s, 1, a), 2, null), 3, b)
    expect(final.resolution).toMatchObject({ winner: 'impostor', reason: 'CREW_EJECTED' })
  })

  it('the board target outranks an impostor timeout', () => {
    let { s, imp, a, b, c } = setup()
    s = seedLane(seedLane(s, a, 1000, 1), b, 1000, 1)
    s = checkedReduce(s, { type: 'GRACE_EXPIRED', tick: 2, playerId: imp })
    const final = seedLane(s, c, 400, 3)
    expect(final.resolution).toMatchObject({ winner: 'crew', reason: 'BOARD_TARGET' })
  })

  it('returns nothing once the match is resolved', () => {
    const { s, imp } = setup()
    expect(checkResolution(runVote(s, 1, imp))).toBeNull()
  })
})
