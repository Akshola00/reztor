import { describe, expect, it } from 'vitest'
import { createRegistry, drain, enqueue } from '../../src/match/registry.js'
import { matchStarted } from '../helpers/fixtures.js'

describe('match registry', () => {
  it('starts a match with its clock at the start tick and an empty queue', () => {
    const registry = createRegistry()
    const match = registry.start({ ...matchStarted(), tick: 7 })
    expect(match.matchId).toBe('match-1')
    expect(match.tick).toBe(7)
    expect(match.pendingIntents).toEqual([])
    expect(registry.get('match-1')).toBe(match)
    expect(registry.size()).toBe(1)
  })

  it('refuses to start the same match twice', () => {
    const registry = createRegistry()
    registry.start(matchStarted())
    expect(() => registry.start(matchStarted())).toThrow(/already running/)
    expect(registry.size()).toBe(1)
  })

  it('ticks only matches that are still in progress', () => {
    const registry = createRegistry()
    const live = registry.start({ ...matchStarted(), matchId: 'live' })
    const done = registry.start({ ...matchStarted(), matchId: 'done' })
    done.state = { ...done.state, phase: 'SETTLING' }
    expect(registry.active()).toEqual([live])
  })

  it('forgets a removed match', () => {
    const registry = createRegistry()
    registry.start(matchStarted())
    registry.remove('match-1')
    expect(registry.get('match-1')).toBeUndefined()
    expect(registry.size()).toBe(0)
    expect(() => registry.remove('match-1')).not.toThrow()
  })
})

describe('intent queue', () => {
  it('drains intents in arrival order and leaves the queue empty', () => {
    const match = createRegistry().start(matchStarted())
    enqueue(match, { kind: 'TAP_BATCH', playerId: 'p1', count: 3 })
    enqueue(match, { kind: 'VOTE', playerId: 'p2', target: 'p3' })
    expect(drain(match).map((intent) => intent.kind)).toEqual(['TAP_BATCH', 'VOTE'])
    expect(drain(match)).toEqual([])
  })
})
