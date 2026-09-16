import type { MatchEvent } from '../engine/events.js'
import { processTick, type TickResult } from '../engine/step.js'
import { consoleLogger, type Logger } from '../log.js'
import { drain, type MatchRegistry, type RuntimeMatch } from './registry.js'

export const TICK_MS = 250

export type TickHooks = {
  // Runs before the queue drains, so it can still enqueue intents for this tick — the heartbeat
  // sweep uses it to raise a DISCONNECT at the right moment (CLAUDE.md §8).
  beforeDrain?: (match: RuntimeMatch, nowMs: number) => void
  // Runs after the tick commits, with exactly the events it appended.
  afterTick?: (match: RuntimeMatch, result: TickResult, events: readonly MatchEvent[]) => void
  // Runs once per interval, after every match — lobby fill timeouts hang off this rather than
  // taking a second timer (CLAUDE.md §6: one interval for the whole process).
  onInterval?: (nowMs: number) => void
}

// What a soak run needs to answer "did the clock hold?" without instrumenting the loop from outside.
export type TickStats = {
  ticks: number
  // Intervals the match clocks were advanced by, which exceeds `ticks` whenever one was skipped.
  intervalsAdvanced: number
  skippedIntervals: number
  overruns: number
  maxDurationMs: number
  startedAtMs: number | null
}

export type TickLoop = {
  start(): void
  stop(): void
  // One iteration, driven by the caller. Tests use this instead of waiting on real time.
  runOnce(nowMs: number): void
  isRunning(): boolean
  stats(): TickStats
}

export type TickLoopOptions = {
  registry: MatchRegistry
  hooks?: TickHooks
  logger?: Logger
  now?: () => number
}

export function createTickLoop({
  registry,
  hooks = {},
  logger = consoleLogger,
  now = () => Date.now(),
}: TickLoopOptions): TickLoop {
  let timer: NodeJS.Timeout | null = null
  // CLAUDE.md §6: never let ticks overlap.
  let inTick = false
  let lastAtMs: number | null = null
  const stats: TickStats = {
    ticks: 0,
    intervalsAdvanced: 0,
    skippedIntervals: 0,
    overruns: 0,
    maxDurationMs: 0,
    startedAtMs: null,
  }

  const runOnce = (nowMs: number): void => {
    if (inTick) {
      logger('warn', 'tick skipped: previous tick still running')
      return
    }
    inTick = true
    const startedAt = now()

    try {
      // A tick that was skipped or delayed must not leave the game clock running slow, so the
      // match clock advances by however many intervals actually elapsed (CLAUDE.md §6).
      const elapsed = lastAtMs === null ? TICK_MS : nowMs - lastAtMs
      const intervals = Math.max(1, Math.round(elapsed / TICK_MS))
      if (stats.startedAtMs === null) stats.startedAtMs = nowMs
      lastAtMs = lastAtMs === null ? nowMs : lastAtMs + intervals * TICK_MS
      stats.ticks += 1
      stats.intervalsAdvanced += intervals
      stats.skippedIntervals += intervals - 1
      if (intervals > 1) {
        logger('warn', 'tick intervals skipped, advancing match clocks', { intervals })
      }

      for (const match of registry.active()) {
        hooks.beforeDrain?.(match, nowMs)
        match.tick += intervals

        const before = match.state
        const result = processTick(before, match.tick, drain(match))
        match.state = result.state

        const events = result.state.eventLog.slice(before.eventLog.length)
        hooks.afterTick?.(match, result, events)
      }

      hooks.onInterval?.(nowMs)
    } catch (error) {
      // One bad match must not stop the clock for every other match in the process.
      logger('error', 'tick failed', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      inTick = false
      const duration = now() - startedAt
      stats.maxDurationMs = Math.max(stats.maxDurationMs, duration)
      if (duration > TICK_MS) {
        stats.overruns += 1
        logger('warn', 'tick overran its interval', { durationMs: duration })
      }
    }
  }

  return {
    start() {
      if (timer !== null) return
      // CLAUDE.md §0.4: one interval for the whole process, never one per match.
      timer = setInterval(() => runOnce(now()), TICK_MS)
      timer.unref?.()
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
      lastAtMs = null
    },
    runOnce,
    isRunning: () => timer !== null,
    stats: () => ({ ...stats }),
  }
}
