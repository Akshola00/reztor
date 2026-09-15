import type { MatchEvent } from './events.js'
import { reduce } from './reduce.js'
import { checkResolution } from './rules.js'
import type { MatchState } from './state.js'

// The single place engine state changes. Every reduce is followed by the win and void check
// (CLAUDE.md §5.6, §11), and a resolution is itself logged so replay needs no rule code.
export function commit(state: MatchState, event: MatchEvent): MatchState {
  const next = reduce(state, event)
  const resolution = checkResolution(next)
  return resolution === null ? next : reduce(next, resolution)
}
