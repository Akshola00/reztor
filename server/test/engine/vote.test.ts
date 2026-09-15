import { describe, expect, it } from 'vitest'
import { decideDisconnect, resolveVote } from '../../src/engine/rules.js'
import type { MatchState } from '../../src/engine/state.js'
import { accept, rejected } from '../helpers/checked.js'
import { advanceStage, crew, disconnect, ejectByGrace, expireDue, newMatch, runVote, vote } from '../helpers/fixtures.js'

// Round 1 vote stage opens at 420 and closes at 480.
function inVote(base: MatchState = newMatch()) {
  const [a, b, c] = crew(base)
  return { s: advanceStage(base, 420, 1, 'vote'), imp: base.impostorId, a, b, c }
}

describe('casting votes', () => {
  it('is only possible during the vote stage', () => {
    const s = newMatch()
    const [a, b] = crew(s)
    expect(rejected(vote(s, a, b, 1))).toBe('WRONG_STAGE')
    expect(rejected(vote(advanceStage(s, 240, 1, 'chat'), a, b, 241))).toBe('WRONG_STAGE')
  })

  it('allows self-votes and votes for a disconnected player', () => {
    let { s, a, b } = inVote()
    s = accept(s, vote(s, a, a, 421)).state
    s = disconnect(s, b, 422)
    s = accept(s, vote(s, a, b, 423)).state
    expect(s.votes[a]).toBe(b)
  })

  it('rejects votes for an ejected or unknown player', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = advanceStage(ejectByGrace(s, b, 1), 420, 1, 'vote')
    expect(rejected(vote(s, a, b, 421))).toBe('INVALID_VOTE_TARGET')
    expect(rejected(vote(s, a, 'ghost', 421))).toBe('UNKNOWN_PLAYER')
  })

  it('rejects votes from ejected and disconnected players', () => {
    let s = newMatch()
    const [a, b, c] = crew(s)
    s = advanceStage(disconnect(ejectByGrace(s, a, 1), b, 200), 420, 1, 'vote')
    expect(rejected(vote(s, a, c, 421))).toBe('NOT_ALIVE')
    expect(rejected(vote(s, b, c, 421))).toBe('NOT_ALIVE')
  })

  it('vote change in the final tick', () => {
    let { s, imp, a, b, c } = inVote()
    expect(s.stageEndsAtTick).toBe(480)
    s = accept(s, vote(s, b, c, 421)).state
    s = accept(s, vote(s, imp, c, 421)).state
    s = accept(s, vote(s, a, b, 421)).state
    s = accept(s, vote(s, a, c, 480)).state
    const result = resolveVote(s, 480)
    expect(result.votes[a]).toBe(c)
    expect(result.ejected).toBe(c)
  })
})

describe('resolving votes', () => {
  it('with 4 living, 2 votes eject nobody and 3 votes eject', () => {
    let { s, imp, a, b, c } = inVote()
    s = accept(s, vote(s, a, b, 421)).state
    s = accept(s, vote(s, c, b, 421)).state
    expect(resolveVote(s, 480).ejected).toBeNull()
    s = accept(s, vote(s, imp, b, 422)).state
    expect(resolveVote(s, 480).ejected).toBe(b)
  })

  it('with 3 living, 2 votes eject', () => {
    const [a, b, c] = crew(newMatch())
    let s = runVote(newMatch(), 1, a)
    s = advanceStage(s, 900, 2, 'vote')
    s = accept(s, vote(s, b, c, 901)).state
    s = accept(s, vote(s, s.impostorId, c, 901)).state
    expect(resolveVote(s, 960)).toMatchObject({ round: 2, ejected: c })
  })

  it('a disconnected player still counts toward the threshold, so 2 of 3 connected is not enough', () => {
    const base = newMatch()
    const [, , c] = crew(base)
    let { s, imp, a, b } = inVote(disconnect(base, c, 300))
    s = accept(s, vote(s, a, b, 421)).state
    s = accept(s, vote(s, imp, b, 421)).state
    expect(resolveVote(s, 480).ejected).toBeNull()
    s = accept(s, vote(s, b, b, 422)).state
    expect(resolveVote(s, 480).ejected).toBe(b)
  })

  it('a 2–2 tie ejects nobody', () => {
    let { s, imp, a, b, c } = inVote()
    s = accept(s, vote(s, a, c, 421)).state
    s = accept(s, vote(s, b, c, 421)).state
    s = accept(s, vote(s, c, a, 421)).state
    s = accept(s, vote(s, imp, a, 421)).state
    expect(resolveVote(s, 480).ejected).toBeNull()
  })

  it('a majority skip ejects nobody', () => {
    let { s, imp, a, b, c } = inVote()
    for (const voter of [a, b, imp]) s = accept(s, vote(s, voter, 'skip', 421)).state
    s = accept(s, vote(s, c, a, 421)).state
    expect(resolveVote(s, 480).ejected).toBeNull()
  })

  it('reveals every living player’s vote, recording non-voters as skip', () => {
    let { s, imp, a, b, c } = inVote()
    s = accept(s, vote(s, a, b, 421)).state
    expect(resolveVote(s, 480).votes).toEqual({ [a]: b, [b]: 'skip', [c]: 'skip', [imp]: 'skip' })
  })

  it('disconnect during the vote stage', () => {
    let { s, imp, a, b, c } = inVote()
    for (const voter of [a, b, imp]) s = accept(s, vote(s, voter, c, 421)).state
    s = accept(s, decideDisconnect(s, { kind: 'DISCONNECT', playerId: a }, 430)).state
    expect(rejected(vote(s, a, b, 440))).toBe('NOT_ALIVE')
    const result = resolveVote(s, 480)
    expect(result.votes[a]).toBe(c)
    expect(result.ejected).toBe(c)
  })

  it('judges targets and the threshold at close: a vote for a player ejected since counts as skip', () => {
    const base = newMatch()
    const [, , c] = crew(base)
    let { s, imp, a, b } = inVote(disconnect(base, c, 330))
    for (const voter of [a, b, imp]) s = accept(s, vote(s, voter, c, 421)).state
    s = expireDue(s, 450)
    const result = resolveVote(s, 480)
    expect(result).toMatchObject({ ejected: null, votes: { [a]: 'skip', [b]: 'skip', [imp]: 'skip' } })
    expect(Object.keys(result.votes)).toHaveLength(3)
  })
})
