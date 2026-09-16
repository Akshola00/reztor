import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MVP_CONFIG } from '../../src/engine/config.js'
import type { MatchEvent } from '../../src/engine/events.js'
import { computeSettlement, settlementBalances, type Settlement } from '../../src/engine/settlement.js'
import type { MatchState } from '../../src/engine/state.js'
import { PLAYER_IDS, ejectByGrace, matchStarted, newMatch, runVote, seedLane } from '../helpers/fixtures.js'

// p2 is the impostor for the fixture seed; p1, p3 and p4 are crew.
function settle(state: MatchState): Settlement {
  const result = computeSettlement(state.eventLog, state.config)
  if (!result.ok) throw new Error(`Expected a settlement, got ${result.error}`)
  expect(settlementBalances(result.value)).toBe(true)
  return result.value
}

const line = (playerId: string, spent: number, refund: number, payout: number) => ({ playerId, spent, refund, payout })

describe('computeSettlement', () => {
  it('spec §10.3 worked example: full spend, crew win, 5% rake → 1520 credits (15.2 SKR) per crewmate', () => {
    let s = newMatch({ laneCapacity: 1200, winTarget: 4800, rakeBps: 500 })
    for (const id of PLAYER_IDS) s = seedLane(s, id, 1200, 1)
    expect(settle(s)).toEqual({
      matchId: 'match-1',
      resolution: { kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 1 },
      escrowCredits: 4800,
      potCredits: 4800,
      rakeBps: 500,
      rakeCredits: 240,
      dustCredits: 0,
      winners: ['p1', 'p3', 'p4'],
      lines: [line('p1', 1200, 0, 1520), line('p2', 1200, 0, 0), line('p3', 1200, 0, 1520), line('p4', 1200, 0, 1520)],
    })
  })

  it('spec §10.3 worked example: full spend, impostor win, 5% rake → 4560 credits (45.6 SKR)', () => {
    let s = newMatch({ laneCapacity: 1200, winTarget: 4801, rakeBps: 500 })
    for (const id of PLAYER_IDS) s = seedLane(s, id, 1200, 1)
    s = runVote(runVote(runVote(s, 1, null), 2, null), 3, null)
    const result = settle(s)
    expect(result).toMatchObject({ potCredits: 4800, rakeCredits: 240, dustCredits: 0, winners: ['p2'] })
    expect(result.lines.map((l) => l.payout)).toEqual([0, 4560, 0, 0])
  })

  it('sends the indivisible remainder to dustCredits, not to any player', () => {
    const s = runVote(seedLane(newMatch(), 'p1', 100, 1), 1, 'p2')
    expect(settle(s)).toMatchObject({
      potCredits: 100,
      rakeCredits: 0,
      dustCredits: 1,
      lines: [line('p1', 100, 1100, 33), line('p2', 0, 1200, 0), line('p3', 0, 1200, 33), line('p4', 0, 1200, 33)],
    })
  })

  it('floors the rake, then splits what remains', () => {
    const s = runVote(seedLane(seedLane(newMatch({ rakeBps: 500 }), 'p1', 1000, 1), 'p3', 1, 1), 1, 'p2')
    expect(settle(s)).toMatchObject({ potCredits: 1001, rakeCredits: 50, dustCredits: 0 })
    expect(settle(s).lines.map((l) => l.payout)).toEqual([317, 0, 317, 317])
  })

  it('a pot smaller than the winner count is all dust', () => {
    const s = runVote(seedLane(newMatch(), 'p1', 2, 1), 1, 'p2')
    expect(settle(s)).toMatchObject({ potCredits: 2, dustCredits: 2 })
    expect(settle(s).lines.map((l) => l.payout)).toEqual([0, 0, 0, 0])
  })

  it('an ejected crew member is still a winner when the crew wins', () => {
    let s = seedLane(newMatch(), 'p3', 30, 1)
    s = runVote(runVote(s, 1, 'p1'), 2, 'p2')
    expect(s.players.p1?.status).toBe('ejected')
    expect(settle(s)).toMatchObject({ winners: ['p1', 'p3', 'p4'], dustCredits: 0 })
    expect(settle(s).lines.map((l) => l.payout)).toEqual([10, 0, 10, 10])
  })

  it('a voided match refunds the full escrow whatever was spent', () => {
    let s = seedLane(seedLane(newMatch({ rakeBps: 500 }), 'p1', 50, 1), 'p3', 20, 1)
    s = ejectByGrace(ejectByGrace(s, 'p1', 10), 'p3', 140)
    expect(settle(s)).toEqual({
      matchId: 'match-1',
      resolution: { kind: 'voided', reason: 'ABANDONED', tick: 260 },
      escrowCredits: 4800,
      potCredits: 0,
      rakeBps: 500,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [],
      lines: [line('p1', 50, 1200, 0), line('p2', 0, 1200, 0), line('p3', 20, 1200, 0), line('p4', 0, 1200, 0)],
    })
  })

  describe('refuses to settle', () => {
    const resolved = runVote(seedLane(newMatch(), 'p1', 30, 1), 1, 'p2')
    const log = resolved.eventLog

    it('an unresolved match', () => {
      const live = seedLane(newMatch(), 'p1', 30, 1)
      expect(computeSettlement(live.eventLog, live.config)).toEqual({ ok: false, error: 'UNRESOLVED' })
    })

    it('a log that does not open with MATCH_STARTED', () => {
      expect(computeSettlement([], MVP_CONFIG)).toEqual({ ok: false, error: 'NOT_STARTED' })
      expect(computeSettlement(log.slice(1), MVP_CONFIG)).toEqual({ ok: false, error: 'NOT_STARTED' })
    })

    it('under a config other than the one the match ran under', () => {
      expect(computeSettlement(log, { ...MVP_CONFIG, rakeBps: 1 })).toEqual({ ok: false, error: 'CONFIG_MISMATCH' })
    })

    it('with a rake outside 0–10000 basis points', () => {
      for (const rakeBps of [-1, 1.5, 10_001]) {
        const bad = runVote(newMatch({ rakeBps }), 1, 'p2')
        expect(computeSettlement(bad.eventLog, bad.config)).toEqual({ ok: false, error: 'INVALID_RAKE' })
      }
    })

    it('a log with events after its resolution', () => {
      const extra: MatchEvent = { type: 'TIER_SET', tick: 999, playerId: 'p1', tier: 2 }
      expect(computeSettlement([...log, extra], MVP_CONFIG)).toEqual({ ok: false, error: 'EVENTS_AFTER_RESOLUTION' })
    })

    it('a log charging an unknown player or overspending a buy-in', () => {
      const [started, ...rest] = log
      const charge = (playerId: string, cost: number): MatchEvent => ({
        type: 'TRACED',
        tick: 1,
        playerId,
        target: 'p1',
        result: 'natural',
        cost,
      })
      if (started === undefined) throw new Error('empty log')
      expect(computeSettlement([started, charge('ghost', 1), ...rest], MVP_CONFIG)).toEqual({ ok: false, error: 'CORRUPT_LOG' })
      expect(computeSettlement([started, charge('p4', 1201), ...rest], MVP_CONFIG)).toEqual({ ok: false, error: 'CORRUPT_LOG' })
    })
  })

  it('settlementBalances rejects a tampered payload', () => {
    const good = settle(runVote(seedLane(newMatch(), 'p1', 30, 1), 1, 'p2'))
    const [first, ...others] = good.lines
    if (first === undefined) throw new Error('no lines')
    expect(settlementBalances({ ...good, lines: [{ ...first, payout: first.payout + 1 }, ...others] })).toBe(false)
    expect(settlementBalances({ ...good, dustCredits: -1, rakeCredits: good.rakeCredits + 1 })).toBe(false)
  })

  it('balances to the credit for any spend, rake and outcome', () => {
    const outcome = fc.constantFrom(
      { type: 'MATCH_RESOLVED', winner: 'crew', reason: 'BOARD_TARGET' } as const,
      { type: 'MATCH_RESOLVED', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED' } as const,
      { type: 'MATCH_VOIDED', reason: 'ABANDONED' } as const,
    )
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1200 }), { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 0, max: 10_000 }),
        outcome,
        (spends, rakeBps, terminal) => {
          const started = matchStarted({ rakeBps })
          const charges: MatchEvent[] = PLAYER_IDS.map((playerId, i) => ({
            type: 'TRACED',
            tick: 1,
            playerId,
            target: playerId,
            result: 'natural',
            cost: spends[i] ?? 0,
          }))
          const result = computeSettlement([started, ...charges, { ...terminal, tick: 2 }], started.config)
          if (!result.ok) throw new Error(result.error)
          const s = result.value
          expect(settlementBalances(s)).toBe(true)
          const payouts = s.lines.filter((l) => s.winners.includes(l.playerId)).map((l) => l.payout)
          expect(new Set(payouts).size).toBeLessThanOrEqual(1)
          expect(s.dustCredits).toBeLessThan(Math.max(1, s.winners.length))
        },
      ),
      { seed: 42, numRuns: 500 },
    )
  })
})
