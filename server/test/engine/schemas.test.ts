import { describe, expect, it } from 'vitest'
import { PayloadSchemas } from '../../src/engine/events.js'

const valid = {
  TAP_BATCH: { tier: 1, count: 6, clientTs: 1_726_000_000_000 },
  SET_TIER: { tier: 2 },
  SIPHON: { source: 'p1', sink: 'p2' },
  TRACE: { target: 'p3' },
  CHAT: { text: 'p2 was draining me' },
  VOTE: { target: 'skip' },
} as const

describe('inbound payload schemas', () => {
  for (const name of Object.keys(valid) as (keyof typeof valid)[]) {
    it(`${name} accepts a valid payload and rejects unknown fields such as playerId`, () => {
      const schema = PayloadSchemas[name]
      expect(schema.safeParse(valid[name]).success).toBe(true)
      expect(schema.safeParse({ ...valid[name], playerId: 'p1' }).success).toBe(false)
    })
  }

  it('TAP_BATCH accepts an optional lane', () => {
    expect(PayloadSchemas.TAP_BATCH.safeParse({ ...valid.TAP_BATCH, lane: 'p4' }).success).toBe(true)
    expect(PayloadSchemas.TAP_BATCH.safeParse({ ...valid.TAP_BATCH, lane: '' }).success).toBe(false)
  })

  it.each([0, -1, 1.5, 61])('TAP_BATCH rejects count %s', (count) => {
    expect(PayloadSchemas.TAP_BATCH.safeParse({ ...valid.TAP_BATCH, count }).success).toBe(false)
  })

  it('TAP_BATCH accepts the maximum count and rejects an unknown tier', () => {
    expect(PayloadSchemas.TAP_BATCH.safeParse({ ...valid.TAP_BATCH, count: 60 }).success).toBe(true)
    expect(PayloadSchemas.TAP_BATCH.safeParse({ ...valid.TAP_BATCH, tier: 3 }).success).toBe(false)
  })

  it('CHAT allows up to 240 characters and rejects empty text', () => {
    expect(PayloadSchemas.CHAT.safeParse({ text: 'x'.repeat(240) }).success).toBe(true)
    expect(PayloadSchemas.CHAT.safeParse({ text: 'x'.repeat(241) }).success).toBe(false)
    expect(PayloadSchemas.CHAT.safeParse({ text: '' }).success).toBe(false)
  })

  it('VOTE accepts a player id or skip, nothing else', () => {
    expect(PayloadSchemas.VOTE.safeParse({ target: 'p2' }).success).toBe(true)
    expect(PayloadSchemas.VOTE.safeParse({ target: 42 }).success).toBe(false)
  })
})
