import { describe, expect, it } from 'vitest'
import { TICK_MS } from '../../src/match/tick.js'
import type { Level, LogFields, Logger } from '../../src/log.js'
import { createGameServer } from '../../src/net/server.js'
import { createBot, type Bot } from '../../src/sim/bot.js'

// No fake clock anywhere in this file. The engine has been exercised at compressed durations
// everywhere else; this is the only place the 250ms interval is asked to hold for six minutes
// against four real sockets.
const BOT_RATE = 4
const MAX_WAIT_MS = 8 * 60 * 1000

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

describe('one full match at real duration', () => {
  it('holds its clock for 1440 ticks with four bots on real sockets', async () => {
    const warnings: { level: Level; message: string; fields: LogFields }[] = []
    const logger: Logger = (level, message, fields = {}) => {
      if (level !== 'info') warnings.push({ level, message, fields })
    }

    const server = createGameServer({ logger })
    const port = await server.listen(0)
    const url = `http://127.0.0.1:${port}`

    const bots: Bot[] = []
    let code: string | undefined
    for (let index = 0; index < 4; index++) {
      const bot = await createBot({
        url,
        name: `bot-${index + 1}`,
        strategy: 'masher',
        rate: BOT_RATE,
        jitter: 0.25,
        ...(code === undefined ? {} : { code }),
      })
      code = bot.code
      bots.push(bot)
    }

    let peakRss = process.memoryUsage().rss
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }, 2000)

    const startedAt = Date.now()
    const timeout = new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), MAX_WAIT_MS))
    const outcome = await Promise.race([bots[0]?.ended() ?? timeout, timeout])
    const elapsedMs = Date.now() - startedAt

    clearInterval(sampler)
    const stats = server.loop.stats()
    const metrics = server.metrics()
    const matchId = bots[0]?.code === undefined ? undefined : [...server.registry.active()][0]?.matchId
    const state = [...(matchId === undefined ? [] : [server.registry.get(matchId)])][0]?.state

    for (const bot of bots) bot.stop()
    await server.close()

    // Drift is the gap between wall clock and the game clock the loop actually advanced.
    const gameClockMs = stats.intervalsAdvanced * TICK_MS
    const driftMs = elapsedMs - gameClockMs
    const end = outcome as { reveal?: { resolution: { reason?: string; tick: number } } }

    console.log(
      [
        '',
        'SOAK — one match, four bots, real duration, no fake clock',
        `  outcome            ${end.reveal?.resolution.reason ?? String(outcome)} at tick ${end.reveal?.resolution.tick ?? '?'}`,
        `  wall clock         ${(elapsedMs / 1000).toFixed(1)}s`,
        `  ticks run          ${stats.ticks} (game clock advanced ${stats.intervalsAdvanced} intervals)`,
        `  drift              ${driftMs >= 0 ? '+' : ''}${driftMs} ms over ${(elapsedMs / 1000).toFixed(0)}s  (${((driftMs / elapsedMs) * 100).toFixed(3)}%)`,
        `  skipped intervals  ${stats.skippedIntervals}`,
        `  ticks over 250ms   ${stats.overruns}   slowest tick ${stats.maxDurationMs} ms`,
        `  broadcasts         ${metrics.roomBroadcasts} to rooms + ${metrics.privateSends} private = ${metrics.roomBroadcasts + metrics.privateSends}`,
        `  peak RSS           ${mb(peakRss)}`,
        `  bot activity       ${bots.map((bot) => `${bot.stats().taps}t/${bot.stats().siphons}s`).join('  ')}`,
        `  rejections         ${bots.reduce((sum, bot) => sum + bot.stats().rejections, 0)}`,
        `  warnings logged    ${warnings.length}${warnings.length === 0 ? '' : `  (${[...new Set(warnings.map((w) => w.message))].join('; ')})`}`,
        '',
      ].join('\n'),
    )

    expect(outcome, 'the match ended rather than hitting the wait cap').not.toBe('TIMED_OUT')
    expect(state?.resolution ?? end.reveal?.resolution).toBeTruthy()
    // A loop that drifts is a loop that will desync a client's countdown. Half a second over six
    // minutes is already generous for an interval that fires 1440 times.
    expect(Math.abs(driftMs)).toBeLessThan(500)
    expect(stats.overruns).toBe(0)
  })
})
