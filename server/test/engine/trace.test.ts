import { describe, expect, it } from 'vitest'
import type { MatchConfig } from '../../src/engine/config.js'
import { traceResult } from '../../src/engine/rules.js'
import { accept, rejected } from '../helpers/checked.js'
import {
  advanceStage,
  crew,
  disconnect,
  ejectByGrace,
  newMatch,
  player,
  seedLane,
  siphon,
  startRound,
  tap,
  trace,
} from '../helpers/fixtures.js'

describe('traceResult tie-break table', () => {
  it.each([
    [0, 0, 0, 0, 'natural', 'an idle lane is natural, never drained'],
    [5, 0, 0, 0, 'natural', 'only own taps'],
    [0, 0, 5, 0, 'received', 'only deliveries'],
    [0, 0, 0, 5, 'drained', 'only pulls'],
    [5, 0, 5, 0, 'received', 'received beats natural on a tie'],
    [5, 0, 0, 5, 'drained', 'drained beats natural on a tie'],
    [0, 0, 5, 5, 'drained', 'drained beats received on a tie'],
    [5, 0, 5, 5, 'drained', 'drained wins a three-way tie'],
    [3, 3, 5, 0, 'natural', 'foreign taps count toward natural'],
    [3, 2, 5, 0, 'received', 'natural + foreign tying received loses'],
    [9, 0, 6, 10, 'drained', 'largest component wins'],
    [12, 0, 6, 10, 'natural', 'largest component wins'],
    [0, 0, 7, 6, 'received', 'largest component wins'],
  ] as const)(
    'natural %i + foreign %i, received %i, drained %i → %s (%s)',
    (natural, foreign, received, drained, expected, _why) => {
      expect(traceResult({ natural, foreign, received, drained })).toBe(expected)
    },
  )
})

// Round 1: a taps 30 and is drained 30 into b. c and the impostor do nothing. Round 2 opens at 480.
function roundTwo(config: Partial<MatchConfig> = {}) {
  let s = newMatch(config)
  const imp = s.impostorId
  const [a, b, c] = crew(s)
  s = seedLane(s, a, 30, 1)
  for (let i = 0; i < 3; i++) s = accept(s, siphon(s, imp, a, b, 2)).state
  return { s: startRound(s, 2), imp, a, b, c }
}

describe('trace', () => {
  it('is unavailable in round 1', () => {
    const s = newMatch()
    const [a, b] = crew(s)
    expect(rejected(trace(s, a, b, 1))).toBe('NO_PREVIOUS_ROUND')
  })

  it('reads the previous round, ignoring this round’s activity, and charges 200 once', () => {
    let { s, a, b } = roundTwo()
    s = accept(s, tap(s, a, 6, 481)).state
    const { state, event } = accept(s, trace(s, b, a, 482))
    expect(event).toMatchObject({ target: a, result: 'drained', cost: 200 })
    expect(player(state, b)).toMatchObject({ traceUsed: true, spent: 200 })
    expect(rejected(trace(state, b, a, 483))).toBe('TRACE_USED')
  })

  it('reports received for a siphon sink', () => {
    const { s, a, b } = roundTwo()
    expect(accept(s, trace(s, a, b, 481)).event.result).toBe('received')
  })

  it('reports natural for a lane that did not move last round', () => {
    const { s, a, c } = roundTwo()
    expect(accept(s, trace(s, a, c, 481)).event.result).toBe('natural')
  })

  it('allows tracing your own lane', () => {
    const { s, a } = roundTwo()
    expect(accept(s, trace(s, a, a, 481)).event.result).toBe('drained')
  })

  it('allows tracing a dormant lane and a disconnected player’s frozen lane', () => {
    const { s, a, b, c } = roundTwo()
    const dormant = ejectByGrace(s, a, 481)
    expect(accept(dormant, trace(dormant, b, a, 602)).event.result).toBe('drained')
    const frozen = disconnect(s, a, 481)
    expect(accept(frozen, trace(frozen, c, a, 482)).event.result).toBe('drained')
  })

  it('rejects a trace the player cannot afford', () => {
    const { s, a, b } = roundTwo({ buyInSkr: 1, creditsPerSkr: 100 })
    expect(rejected(trace(s, a, b, 481))).toBe('INSUFFICIENT_CREDITS')
  })

  it('rejects a trace outside the tap stage or against an unknown lane', () => {
    const { s, a, b } = roundTwo()
    expect(rejected(trace(s, a, 'ghost', 481))).toBe('UNKNOWN_PLAYER')
    const chatting = advanceStage(s, 720, 2, 'chat')
    expect(rejected(trace(chatting, a, b, 721))).toBe('WRONG_STAGE')
  })
})
