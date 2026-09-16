import type { MatchConfig } from './config.js'
import type { MatchEvent } from './events.js'
import { err, ok, type Result } from './result.js'
import { matchEndView, type MatchEndView } from './selectors.js'
import { computeSettlement, type Settlement, type SettlementError } from './settlement.js'
import type { MatchState } from './state.js'

export type MatchEndPayload = { reveal: MatchEndView; settlement: Settlement }

export type MatchEndPayloadError = 'UNRESOLVED' | SettlementError

// What the server sends when a match ends: spec §15's reveal and CLAUDE.md §10's settlement in one
// object. Composed here so the reveal stays a pure view of state and the settlement stays a pure
// fold of the log, neither knowing about the other.
export function matchEndPayload(
  state: MatchState,
  log: readonly MatchEvent[],
  config: MatchConfig,
): Result<MatchEndPayload, MatchEndPayloadError> {
  const reveal = matchEndView(state)
  if (reveal === null) return err('UNRESOLVED')
  const settlement = computeSettlement(log, config)
  if (!settlement.ok) return err(settlement.error)
  return ok({ reveal, settlement: settlement.value })
}
