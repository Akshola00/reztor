import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '../../src/engine/events.js'
import { replayLog } from '../../src/sim/replay.js'
import { newMatch, runVote, seedLane } from '../helpers/fixtures.js'

// p2 is the impostor for the fixture seed.
const resolved = runVote(seedLane(newMatch(), 'p1', 30, 1), 1, 'p2')
const log = resolved.eventLog

describe('replayLog', () => {
  it('rebuilds the exact state from a valid log', () => {
    expect(replayLog(log)).toEqual({ ok: true, value: resolved })
  })

  it('rejects a log that does not open with MATCH_STARTED', () => {
    expect(replayLog(log.slice(1))).toMatchObject({ ok: false, error: { index: 0 } })
  })

  it('rejects a log that drops the resolution its rules demand', () => {
    expect(replayLog(log.slice(0, -1))).toMatchObject({ ok: false, error: { index: log.length - 1 } })
  })

  it('rejects a log that alters a resolution', () => {
    const last = log.at(-1)
    if (last?.type !== 'MATCH_RESOLVED') throw new Error('expected a resolution')
    const forged: MatchEvent = { ...last, winner: 'impostor', reason: 'ROUNDS_EXHAUSTED' }
    expect(replayLog([...log.slice(0, -1), forged])).toMatchObject({ ok: false, error: { index: log.length - 1 } })
  })

  it('rejects a log that invents a resolution', () => {
    const live = seedLane(newMatch(), 'p1', 30, 1).eventLog
    const invented: MatchEvent = { type: 'MATCH_VOIDED', tick: 2, reason: 'ABANDONED' }
    expect(replayLog([...live, invented])).toMatchObject({ ok: false, error: { index: live.length } })
  })

  it('rejects a log referencing an unknown player instead of throwing', () => {
    const bad: MatchEvent = { type: 'TIER_SET', tick: 1, playerId: 'ghost', tier: 2 }
    expect(replayLog([log[0] as MatchEvent, bad])).toMatchObject({ ok: false, error: { index: 1 } })
  })
})
