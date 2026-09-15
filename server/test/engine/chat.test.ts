import { describe, expect, it } from 'vitest'
import { accept, rejected } from '../helpers/checked.js'
import { advanceStage, chat, crew, ejectByGrace, newMatch } from '../helpers/fixtures.js'

describe('chat', () => {
  it('posts during the chat stage', () => {
    const s = advanceStage(newMatch(), 240, 1, 'chat')
    const [a] = crew(s)
    const { state } = accept(s, chat(s, a, 'b was draining me', 241))
    expect(state.chat).toEqual([{ from: a, text: 'b was draining me', tick: 241 }])
  })

  it('is closed during the tap and vote stages', () => {
    const s = newMatch()
    const [a] = crew(s)
    expect(rejected(chat(s, a, 'hi', 1))).toBe('WRONG_STAGE')
    expect(rejected(chat(advanceStage(s, 420, 1, 'vote'), a, 'hi', 421))).toBe('WRONG_STAGE')
  })

  it('allows one message per player every 8 ticks', () => {
    let s = advanceStage(newMatch(), 240, 1, 'chat')
    const [a, b] = crew(s)
    s = accept(s, chat(s, a, 'one', 241)).state
    expect(rejected(chat(s, a, 'two', 248))).toBe('CHAT_RATE_LIMITED')
    s = accept(s, chat(s, b, 'other player is unaffected', 248)).state
    s = accept(s, chat(s, a, 'two', 249)).state
    expect(s.chat).toHaveLength(3)
  })

  it('ejected players cannot chat', () => {
    const base = newMatch()
    const [a] = crew(base)
    const s = advanceStage(ejectByGrace(base, a, 1), 240, 1, 'chat')
    expect(rejected(chat(s, a, 'let me back in', 241))).toBe('NOT_ALIVE')
  })
})
