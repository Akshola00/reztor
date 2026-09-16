import { describe, expect, it } from 'vitest'
import { matchEndView, privateView, publicView } from '../../src/engine/selectors.js'
import type { MatchState, PlayerId } from '../../src/engine/state.js'
import { accept } from '../helpers/checked.js'
import { assertSecretsHidden } from '../helpers/secrets.js'
import {
  SEED,
  advanceStage,
  closeVote,
  crew,
  disconnect,
  ejectByGrace,
  expireDue,
  newMatch,
  seedLane,
  siphon,
  startRound,
  trace,
  vote,
} from '../helpers/fixtures.js'

// Round 1: a taps 40; the impostor frames a→b twice and self-sinks a→imp once (12 destroyed).
// Round 2: b traces a. Round 2 vote stage is open with two votes cast.
function busyMatch() {
  let s = newMatch()
  const imp = s.impostorId
  const [a, b, c] = crew(s)
  s = seedLane(s, a, 40, 1)
  s = accept(s, siphon(s, imp, a, b, 2)).state
  s = accept(s, siphon(s, imp, a, imp, 2)).state
  s = accept(s, siphon(s, imp, a, b, 2)).state
  s = startRound(s, 2)
  s = accept(s, trace(s, b, a, 481)).state
  s = advanceStage(s, 900, 2, 'vote')
  s = accept(s, vote(s, a, imp, 901)).state
  s = accept(s, vote(s, b, c, 901)).state
  return { s, imp, a, b, c }
}

describe('publicView', () => {
  it('shows lanes, the board total, and each player’s name and status, in playerId order', () => {
    const { s, imp, a, b } = busyMatch()
    const view = publicView(s)
    expect(view.lanes.map((l) => l.owner)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(view.lanes.find((l) => l.owner === a)).toEqual({ owner: a, units: 10, dormant: false })
    expect(view.lanes.find((l) => l.owner === imp)).toEqual({ owner: imp, units: 6, dormant: false })
    expect(view.boardTotal).toBe(10 + 12 + 6)
    expect(view.players.find((p) => p.id === b)).toEqual({ id: b, name: `Player ${b}`, status: 'alive' })
  })

  it('carries none of the hidden state', () => {
    const { s } = busyMatch()
    expect(() => assertSecretsHidden(s)).not.toThrow()
    expect(JSON.stringify(publicView(s))).not.toMatch(/"(credits|spent|tier|traceUsed|impostorId|roleSeed)"/)
  })

  it('open votes are invisible to everyone but their voter until the stage closes', () => {
    const { s, imp, a, c } = busyMatch()
    expect(publicView(s)).toEqual(publicView({ ...s, votes: {} }))
    expect(privateView(s, a)?.currentVote).toBe(imp)
    expect(privateView(s, c)?.currentVote).toBeNull()
    expect(privateView(s, c)).toEqual(privateView({ ...s, votes: {} }, c))
  })

  it('once the vote closes, the reveal shows each vote as cast — even one that did not count', () => {
    let s = newMatch()
    const imp = s.impostorId
    const [a, b, c] = crew(s)
    s = advanceStage(disconnect(s, c, 330), 420, 1, 'vote')
    s = accept(s, vote(s, a, b, 421)).state
    s = accept(s, vote(s, b, c, 421)).state
    s = closeVote(expireDue(s, 450), 480)
    expect(s.voteHistory[0]?.votes[b]).toEqual({ cast: c, counted: 'skip' })
    expect(publicView(s).voteHistory).toEqual([{ round: 1, votes: { [a]: b, [b]: c, [imp]: 'skip' }, ejected: null }])
  })
})

describe('privateView', () => {
  it('shows the viewer their own role, credits, tier and trace results, and nobody else’s', () => {
    const { s, a, b } = busyMatch()
    const mine = privateView(s, b)
    expect(mine?.you).toEqual({ id: b, role: 'crew', credits: 1000, spent: 200, tier: 1, traceUsed: true })
    expect(mine?.traces).toEqual([{ tick: 481, target: a, result: 'natural' }])
    expect(privateView(s, a)?.traces).toEqual([])
  })

  it('reveals siphon activity only to the impostor', () => {
    const { s, imp, a, b, c } = busyMatch()
    expect(privateView(s, imp)?.you.role).toBe('impostor')
    expect(privateView(s, imp)?.siphonActivity).toEqual({ siphons: 3, selfSinks: 1, destroyed: 12 })
    for (const member of [a, b, c]) {
      expect(privateView(s, member)?.siphonActivity).toBeNull()
      const withoutSiphons = { ...s, eventLog: s.eventLog.filter((e) => e.type !== 'SIPHONED') }
      expect(privateView(s, member)).toEqual(privateView(withoutSiphons, member))
    }
  })

  it('returns null for an unknown player', () => {
    expect(privateView(newMatch(), 'ghost')).toBeNull()
  })
})

describe('matchEndView', () => {
  it('is null while the match is live', () => {
    expect(matchEndView(newMatch())).toBeNull()
    expect(matchEndView(busyMatch().s)).toBeNull()
  })

  it('reveals everything in spec §15 once the match resolves', () => {
    // p2 is the impostor for the fixture seed.
    let s = newMatch()
    s = seedLane(s, 'p1', 40, 1)
    s = accept(s, siphon(s, 'p2', 'p1', 'p3', 2)).state
    s = accept(s, siphon(s, 'p2', 'p1', 'p2', 2)).state
    s = accept(s, siphon(s, 'p2', 'p1', 'p3', 2)).state
    s = startRound(s, 2)
    s = accept(s, trace(s, 'p3', 'p1', 481)).state
    s = advanceStage(s, 900, 2, 'vote')
    s = accept(s, vote(s, 'p1', 'p2', 901)).state
    s = accept(s, vote(s, 'p3', 'p4', 901)).state
    s = accept(s, vote(s, 'p4', 'p2', 902)).state
    s = accept(s, vote(s, 'p3', 'p2', 903)).state
    s = closeVote(s, 960)

    expect(matchEndView(s)).toEqual({
      matchId: 'match-1',
      resolution: { kind: 'won', winner: 'crew', reason: 'IMPOSTOR_EJECTED', tick: 960 },
      impostorId: 'p2',
      roleSeed: SEED,
      board: { total: 28, capacity: 4000, winTarget: 2400, basisPoints: 70 },
      players: [
        { id: 'p1', name: 'Player p1', role: 'crew', status: 'alive', creditsSpent: 40, unitsContributed: 40, finalLane: 10 },
        { id: 'p2', name: 'Player p2', role: 'impostor', status: 'ejected', creditsSpent: 24, unitsContributed: 0, finalLane: 6 },
        { id: 'p3', name: 'Player p3', role: 'crew', status: 'alive', creditsSpent: 200, unitsContributed: 0, finalLane: 12 },
        { id: 'p4', name: 'Player p4', role: 'crew', status: 'alive', creditsSpent: 0, unitsContributed: 0, finalLane: 0 },
      ],
      impostor: { unitsDestroyed: 12, siphons: 3, selfSinks: 1 },
      traces: [{ round: 2, tick: 481, purchaser: 'p3', target: 'p1', result: 'natural' }],
      voteHistory: [{ round: 2, votes: { p1: 'p2', p2: 'skip', p3: 'p2', p4: 'p2' }, ejected: 'p2' }],
    })
  })

  it('reveals a voided match too, with the vote shown as cast', () => {
    let s = newMatch()
    s = advanceStage(disconnect(s, 'p4', 330), 420, 1, 'vote')
    s = accept(s, vote(s, 'p1', 'p4', 421)).state
    s = closeVote(expireDue(s, 450), 480)
    s = ejectByGrace(s, 'p3', 500)
    const view = matchEndView(s)
    expect(view?.resolution).toEqual({ kind: 'voided', reason: 'ABANDONED', tick: 620 })
    expect(view?.voteHistory).toEqual([{ round: 1, votes: { p1: 'p4', p2: 'skip', p3: 'skip' }, ejected: null }])
  })
})

describe('assertSecretsHidden catches leaky selectors', () => {
  const { s } = busyMatch()

  it('a public credits field', () => {
    const leaky = (state: MatchState) => ({ ...publicView(state), credits: 1 })
    expect(() => assertSecretsHidden(s, { publicView: leaky, privateView })).toThrow(/publicView exposes credits/)
  })

  it('an impostor flag under an innocent name, which no key list could catch', () => {
    const leaky = (state: MatchState) => {
      const view = publicView(state)
      return { ...view, players: view.players.map((p) => ({ ...p, suspicious: p.id === state.impostorId })) }
    }
    expect(() => assertSecretsHidden(s, { publicView: leaky, privateView })).toThrow(/publicView depends on hidden state/)
  })

  it('a "votes in" counter during the vote stage', () => {
    const leaky = (state: MatchState) => ({ ...publicView(state), votesIn: Object.keys(state.votes).length })
    expect(() => assertSecretsHidden(s, { publicView: leaky, privateView })).toThrow(/publicView depends on hidden state/)
  })

  it('siphon activity in a crew member’s view', () => {
    const leaky = (state: MatchState, id: PlayerId) => {
      const view = privateView(state, id)
      return view === null || id === state.impostorId ? view : { ...view, siphonActivity: { siphons: 0, selfSinks: 0, destroyed: 0 } }
    }
    expect(() => assertSecretsHidden(s, { publicView, privateView: leaky })).toThrow(/shows siphon activity to crew/)
  })

  it('another player’s credits in a private view', () => {
    const leaky = (state: MatchState, id: PlayerId) => {
      const view = privateView(state, id)
      return view && { ...view, table: Object.values(state.players).map((p) => p.credits) }
    }
    expect(() => assertSecretsHidden(s, { publicView, privateView: leaky })).toThrow(/privateView\(p\d\) depends on hidden state/)
  })
})
