import { afterEach, describe, expect, it, vi } from 'vitest'
import { consoleLogger } from '../src/log.js'

afterEach(() => vi.restoreAllMocks())

describe('consoleLogger', () => {
  it('keeps the logger level and message when fields use reserved names', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})

    consoleLogger('info', 'actual message', {
      level: 'overridden level',
      message: 'overridden message',
      matchId: 'match-1',
    })

    const line = output.mock.calls[0]?.[0]
    expect(line).toBeDefined()
    expect(JSON.parse(line!)).toEqual({
      level: 'info',
      message: 'actual message',
      matchId: 'match-1',
    })
  })
})