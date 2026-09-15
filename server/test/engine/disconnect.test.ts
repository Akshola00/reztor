import { describe, expect, it } from 'vitest'
import type { PlayerId } from '../../src/engine/state.js'
import type { MatchState } from '../../src/engine/state.js'
import { decideDisconnect, decideReconnect, dueGraceExpiries } from '../../src/engine/rules.js'
import { accept, rejected } from '../helpers/checked.js'
import { crew, ejectByGrace, expireDue, lane, newMatch, player, seedLane, tap } from '../helpers/fixtures.js'

const drop = (s: MatchState, playerId: PlayerId, tick: number) =>
  decideDisconnect(s, { kind: 'DISCONNECT', playerId }, tick)
const rejoin = (s: MatchState, playerId: PlayerId, tick: number) =>
  decideReconnect(s, { kind: 'RECONNECT', playerId }, tick)

describe('disconnect and reconnect', () => {
  it('a disconnect starts the grace clock and freezes the player', () => {
    const s = newMatch()
    const [a] = crew(s)
    const { state } = accept(s, drop(s, a, 10))
    expect(player(state, a)).toMatchObject({ status: 'disconnected', disconnectedAtTick: 10 })
    expect(rejected(tap(state, a, 1, 11))).toBe('NOT_ALIVE')
    expect(rejected(drop(state, a, 11))).toBe('NOT_ALIVE')
  })

  it('rejoining within grace resumes with credits and lane intact', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = seedLane(s, a, 40, 1)
    s = accept(s, drop(s, a, 10)).state
    s = accept(s, rejoin(s, a, 129)).state
    expect(player(s, a)).toMatchObject({ status: 'alive', disconnectedAtTick: null, credits: 1160 })
    expect(lane(s, a).units).toBe(40)
    expect(dueGraceExpiries(s, 500)).toEqual([])
    expect(accept(s, tap(s, a, 1, 130)).event.applied).toBe(1)
  })

  it('only a disconnected player can rejoin', () => {
    const s = newMatch()
    const [a, b] = crew(s)
    expect(rejected(rejoin(s, a, 1))).toBe('NOT_DISCONNECTED')
    const ejected = ejectByGrace(s, b, 1)
    expect(rejected(rejoin(ejected, b, 200))).toBe('NOT_DISCONNECTED')
    expect(rejected(drop(ejected, b, 200))).toBe('NOT_ALIVE')
  })

  it('grace expires exactly 120 ticks after the disconnect', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = accept(s, drop(s, a, 10)).state
    expect(dueGraceExpiries(s, 129)).toEqual([])
    expect(dueGraceExpiries(s, 130)).toEqual([{ type: 'GRACE_EXPIRED', tick: 130, playerId: a }])
    s = expireDue(s, 130)
    expect(player(s, a).status).toBe('ejected')
    expect(lane(s, a).dormant).toBe(true)
  })

  it('expiries due in the same tick come out in playerId order', () => {
    let s = newMatch()
    const [a, , c] = crew(s)
    s = accept(s, drop(s, c, 10)).state
    s = accept(s, drop(s, a, 10)).state
    expect(dueGraceExpiries(s, 130).map((e) => e.playerId)).toEqual([a, c].sort())
  })
})
