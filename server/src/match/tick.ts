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

export type TickLoop = {
  start(): void
  stop(): void
  // One iteration, driven by the caller. Tests use this instead of waiting on real time.
  runOnce(nowMs: number): void
  isRunning(): boolean
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
      lastAtMs = lastAtMs === null ? nowMs : lastAtMs + intervals * TICK_MS
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
      if (duration > TICK_MS) logger('warn', 'tick overran its interval', { durationMs: duration })
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
  }
}
