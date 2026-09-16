import type { Intent } from '../engine/events.js'
import { initialState } from '../engine/reduce.js'
import type { EventOf } from '../engine/events.js'
import type { MatchState } from '../engine/state.js'

// `tick` is the match clock and is deliberately not `state.tick`, which is the tick of the last
// logged event (CLAUDE.md §4, §6). A match with an idle queue still advances its clock.
export type RuntimeMatch = {
  readonly matchId: string
  state: MatchState
  tick: number
  pendingIntents: Intent[]
}

export type MatchRegistry = {
  start(started: EventOf<'MATCH_STARTED'>): RuntimeMatch
  get(matchId: string): RuntimeMatch | undefined
  active(): RuntimeMatch[]
  remove(matchId: string): void
  size(): number
}

export function createRegistry(): MatchRegistry {
  const matches = new Map<string, RuntimeMatch>()

  return {
    start(started) {
      if (matches.has(started.matchId)) throw new Error(`Match ${started.matchId} is already running`)
      const match: RuntimeMatch = {
        matchId: started.matchId,
        state: initialState(started),
        tick: started.tick,
        pendingIntents: [],
      }
      matches.set(started.matchId, match)
      return match
    },

    get: (matchId) => matches.get(matchId),

    // Only IN_PROGRESS matches are ticked (CLAUDE.md §6); a resolved one stays for its final
    // broadcast and is removed by the owner.
    active: () => [...matches.values()].filter((match) => match.state.phase === 'IN_PROGRESS'),

    remove: (matchId) => void matches.delete(matchId),

    size: () => matches.size,
  }
}

// The only way an intent reaches the engine: handlers queue, the tick drains (CLAUDE.md §6).
export function enqueue(match: RuntimeMatch, intent: Intent): void {
  match.pendingIntents.push(intent)
}

export function drain(match: RuntimeMatch): Intent[] {
  const queued = match.pendingIntents
  match.pendingIntents = []
  return queued
}
