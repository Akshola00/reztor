import { describe, expect, it } from 'vitest'
import { checkedCommit } from '../helpers/checked.js'
import { crew, newMatch } from '../helpers/fixtures.js'

describe('commit', () => {
  it('appends exactly one event when nothing resolves', () => {
    const s = newMatch()
    const [a] = crew(s)
    const next = checkedCommit(s, { type: 'TIER_SET', tick: 1, playerId: a, tier: 2 })
    expect(next.eventLog).toHaveLength(s.eventLog.length + 1)
    expect(next.resolution).toBeNull()
  })

  it('logs a resolution in the same step as the event that caused it', () => {
    const s = newMatch()
    const imp = s.impostorId
    const next = checkedCommit(s, { type: 'VOTE_RESOLVED', tick: 480, round: 1, votes: {}, ejected: imp })
    expect(next.eventLog.slice(-2).map((e) => e.type)).toEqual(['VOTE_RESOLVED', 'MATCH_RESOLVED'])
    expect(next.resolution).toEqual({ kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 480 })
    expect(next.phase).toBe('SETTLING')
  })
})
