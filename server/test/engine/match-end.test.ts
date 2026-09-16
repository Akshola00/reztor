import { describe, expect, it } from 'vitest'
import { MVP_CONFIG } from '../../src/engine/config.js'
import { matchEndPayload } from '../../src/engine/match-end.js'
import { matchEndView } from '../../src/engine/selectors.js'
import { computeSettlement } from '../../src/engine/settlement.js'
import { newMatch, runVote, seedLane } from '../helpers/fixtures.js'

// p2 is the impostor for the fixture seed.
const resolved = runVote(seedLane(newMatch(), 'p1', 30, 1), 1, 'p2')

describe('matchEndPayload', () => {
  it('composes the reveal and the settlement without either knowing the other', () => {
    const payload = matchEndPayload(resolved, resolved.eventLog, resolved.config)
    expect(payload).toEqual({
      ok: true,
      value: {
        reveal: matchEndView(resolved),
        settlement: computeSettlement(resolved.eventLog, resolved.config).ok
          ? (computeSettlement(resolved.eventLog, resolved.config) as { ok: true; value: unknown }).value
          : null,
      },
    })
  })

  it('has no settlement fields in the reveal half', () => {
    const payload = matchEndPayload(resolved, resolved.eventLog, resolved.config)
    if (!payload.ok) throw new Error(payload.error)
    expect(Object.keys(payload.value.reveal)).not.toContain('settlement')
    expect(JSON.stringify(payload.value.reveal)).not.toMatch(/payout|refund|dustCredits|escrow/)
  })

  it('is UNRESOLVED while the match is live', () => {
    const live = seedLane(newMatch(), 'p1', 30, 1)
    expect(matchEndPayload(live, live.eventLog, live.config)).toEqual({ ok: false, error: 'UNRESOLVED' })
  })

  it('passes a settlement failure straight through', () => {
    expect(matchEndPayload(resolved, resolved.eventLog, { ...MVP_CONFIG, rakeBps: 1 })).toEqual({
      ok: false,
      error: 'CONFIG_MISMATCH',
    })
  })
})
