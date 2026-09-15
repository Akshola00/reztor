import { describe, expect, it } from 'vitest'
import type { Intent } from '../../src/engine/events.js'
import type { PlayerId, VoteTarget } from '../../src/engine/state.js'
import { processTick } from '../../src/engine/step.js'
import { checkedTick, runTicks } from '../helpers/checked.js'
import { crew, lane, logOf, newMatch, player, seedLane } from '../helpers/fixtures.js'

const tapOnce = (playerId: PlayerId): Intent => ({ kind: 'TAP_BATCH', playerId, count: 1 })
const castVote = (playerId: PlayerId, target: VoteTarget): Intent => ({ kind: 'VOTE', playerId, target })
const drop = (playerId: PlayerId): Intent => ({ kind: 'DISCONNECT', playerId })

describe('processTick order of operations', () => {
  it('applies intents in queue order', () => {
    const s = newMatch()
    const [a] = crew(s)
    const setTier: Intent = { kind: 'SET_TIER', playerId: a, tier: 2 }
    expect(logOf(checkedTick(s, 1, [setTier, tapOnce(a)]).state, 'TAPS_APPLIED')).toMatchObject([{ units: 3, cost: 4 }])
    expect(logOf(checkedTick(s, 1, [tapOnce(a), setTier]).state, 'TAPS_APPLIED')).toMatchObject([{ units: 1, cost: 1 }])
  })

  it('collects a rejection with its reason and keeps draining the queue', () => {
    const s = newMatch()
    const [a] = crew(s)
    const { state, rejections } = checkedTick(s, 1, [
      tapOnce('ghost'),
      { kind: 'RECONNECT', playerId: a },
      tapOnce(a),
    ])
    expect(rejections.map((r) => [r.action, r.code])).toEqual([
      ['TAP_BATCH', 'UNKNOWN_PLAYER'],
      ['RECONNECT', 'NOT_DISCONNECTED'],
    ])
    expect(lane(state, a).units).toBe(1)
  })

  it('a tick with nothing accepted and nothing due returns the very same state', () => {
    const s = newMatch()
    const [a] = crew(s)
    expect(checkedTick(s, 1, [castVote(a, 'skip')]).state).toBe(s)
    expect(checkedTick(s, 2).state).toBe(s)
  })

  it('intents drain before grace expiries, so a reconnect on the expiry tick keeps the player', () => {
    let s = newMatch()
    const [a] = crew(s)
    s = checkedTick(s, 10, [drop(a)]).state

    const rejoined = checkedTick(s, 130, [{ kind: 'RECONNECT', playerId: a }]).state
    expect(player(rejoined, a).status).toBe('alive')
    expect(logOf(rejoined, 'GRACE_EXPIRED')).toEqual([])

    const expired = checkedTick(s, 130).state
    expect(logOf(expired, 'GRACE_EXPIRED')).toEqual([{ type: 'GRACE_EXPIRED', tick: 130, playerId: a }])
  })

  it('within one tick: intents, then grace expiries, then the stage clock', () => {
    let s = newMatch()
    const [a, b] = crew(s)
    s = checkedTick(s, 120, [drop(a)]).state
    const { state } = checkedTick(s, 240, [tapOnce(b)])
    expect(state.eventLog.slice(-3).map((e) => e.type)).toEqual(['TAPS_APPLIED', 'GRACE_EXPIRED', 'STAGE_ADVANCED'])
    expect(state.stage).toBe('chat')
  })

  it('an intent on a stage’s closing tick lands in that stage; one tick later it is rejected', () => {
    const s = newMatch()
    const [a] = crew(s)
    const closing = checkedTick(s, 240, [tapOnce(a)])
    expect(closing.rejections).toEqual([])
    expect(lane(closing.state, a).units).toBe(1)
    expect(closing.state.stage).toBe('chat')
    expect(checkedTick(closing.state, 241, [tapOnce(a)]).rejections.map((r) => r.code)).toEqual(['WRONG_STAGE'])
  })

  it('a vote on the tick the chat stage closes is rejected, because the vote stage opens after the drain', () => {
    const s = runTicks(newMatch(), 1, 419)
    const [a, b] = crew(s)
    const { state, rejections } = checkedTick(s, 420, [castVote(a, b)])
    expect(rejections.map((r) => r.code)).toEqual(['WRONG_STAGE'])
    expect(state.stage).toBe('vote')
  })

  it('vote change in the final tick, through the tick loop', () => {
    let s = runTicks(newMatch(), 1, 420)
    const imp = s.impostorId
    const [a, b, c] = crew(s)
    s = checkedTick(s, 421, [castVote(b, c), castVote(imp, c), castVote(a, b)]).state
    const { state } = checkedTick(s, 480, [castVote(a, c)])
    expect(logOf(state, 'VOTE_RESOLVED')).toMatchObject([
      { tick: 480, ejected: c, votes: { [a]: { cast: c, counted: c } } },
    ])
    expect(state.eventLog.slice(-2).map((e) => e.type)).toEqual(['VOTE_RESOLVED', 'STAGE_ADVANCED'])
    expect(state).toMatchObject({ round: 2, stage: 'tap', stageEndsAtTick: 720 })
  })

  it('runs the stage clock on schedule, closing the vote before opening the next round', () => {
    const s = runTicks(newMatch(), 1, 720)
    expect(logOf(s, 'STAGE_ADVANCED').map(({ tick, round, stage, endsAtTick }) => ({ tick, round, stage, endsAtTick }))).toEqual([
      { tick: 240, round: 1, stage: 'chat', endsAtTick: 420 },
      { tick: 420, round: 1, stage: 'vote', endsAtTick: 480 },
      { tick: 480, round: 2, stage: 'tap', endsAtTick: 720 },
      { tick: 720, round: 2, stage: 'chat', endsAtTick: 900 },
    ])
    const closedAt = s.eventLog.findIndex((e) => e.type === 'VOTE_RESOLVED')
    expect(s.eventLog[closedAt + 1]).toMatchObject({ type: 'STAGE_ADVANCED', tick: 480, round: 2, stage: 'tap' })
  })

  it('round 3’s vote close resolves ROUNDS_EXHAUSTED and opens no round 4', () => {
    const s = runTicks(newMatch(), 1, 1440)
    expect(s.resolution).toEqual({ kind: 'won', winner: 'impostor', reason: 'ROUNDS_EXHAUSTED', tick: 1440 })
    expect(s.eventLog.slice(-2).map((e) => e.type)).toEqual(['VOTE_RESOLVED', 'MATCH_RESOLVED'])
    expect(s).toMatchObject({ round: 3, stage: 'vote', phase: 'SETTLING' })
    expect(checkedTick(s, 1441).state).toBe(s)
  })

  it('a resolution mid-drain rejects the rest of the queue and skips expiries and the stage clock', () => {
    let s = newMatch()
    const imp = s.impostorId
    const [a, b, c] = crew(s)
    s = seedLane(seedLane(seedLane(s, a, 1000, 1), b, 1000, 1), imp, 399, 1)
    s = checkedTick(s, 120, [drop(c)]).state

    const { state, rejections } = checkedTick(s, 240, [tapOnce(imp), { kind: 'SET_TIER', playerId: a, tier: 2 }])
    expect(state.resolution).toMatchObject({ winner: 'crew', reason: 'BOARD_TARGET', tick: 240 })
    expect(rejections.map((r) => r.code)).toEqual(['MATCH_OVER'])
    expect(logOf(state, 'GRACE_EXPIRED')).toEqual([])
    expect(state.stage).toBe('tap')
    expect(state.eventLog.at(-1)?.type).toBe('MATCH_RESOLVED')
  })

  it('a resolved match accepts nothing and changes nothing', () => {
    const s = runTicks(newMatch(), 1, 1440)
    const [a] = crew(s)
    const { state, rejections } = checkedTick(s, 1441, [tapOnce(a), drop(a)])
    expect(state).toBe(s)
    expect(rejections.map((r) => r.code)).toEqual(['MATCH_OVER', 'MATCH_OVER'])
  })

  it('a grace expiry that resolves the match stops later expiries in the same tick', () => {
    const s = newMatch()
    const imp = s.impostorId
    for (const member of crew(s)) {
      let t = checkedTick(s, 10, [drop(member), drop(imp)]).state
      t = checkedTick(t, 130).state
      expect(t.resolution).toMatchObject({ winner: 'crew', reason: 'IMPOSTOR_TIMED_OUT' })
      expect(logOf(t, 'GRACE_EXPIRED').map((e) => e.playerId)).toEqual(member < imp ? [member, imp] : [imp])
    }
  })

  it('refuses a tick behind the match clock', () => {
    const s = newMatch()
    const [a] = crew(s)
    const later = checkedTick(s, 10, [drop(a)]).state
    expect(() => processTick(later, 9, [])).toThrow(RangeError)
  })
})
