import { isDeepStrictEqual } from 'node:util'
import { startingCredits, type MatchConfig } from './config.js'
import type { MatchEvent } from './events.js'
import { err, ok, type Result } from './result.js'
import type { PlayerId, Resolution } from './state.js'

const BASIS_POINTS = 10_000

export type SettlementLine = { playerId: PlayerId; spent: number; refund: number; payout: number }

export type Settlement = {
  matchId: string
  resolution: Resolution
  escrowCredits: number
  potCredits: number
  rakeBps: number
  rakeCredits: number
  dustCredits: number
  winners: PlayerId[]
  lines: SettlementLine[]
}

export type SettlementError =
  | 'NOT_STARTED'
  | 'CONFIG_MISMATCH'
  | 'INVALID_RAKE'
  | 'CORRUPT_LOG'
  | 'UNRESOLVED'
  | 'EVENTS_AFTER_RESOLUTION'
  | 'UNBALANCED'

// CLAUDE.md §11: run before every settlement. Anything that does not reconcile to the credit voids.
export function settlementBalances(settlement: Settlement): boolean {
  const amounts = [
    settlement.rakeCredits,
    settlement.dustCredits,
    ...settlement.lines.flatMap((line) => [line.refund, line.payout]),
  ]
  if (!amounts.every((amount) => Number.isInteger(amount) && amount >= 0)) return false
  const out = amounts.reduce((sum, amount) => sum + amount, 0)
  return settlement.escrowCredits === out
}

// CLAUDE.md §10. Computed from the log alone, so the same log always settles the same way.
export function computeSettlement(
  log: readonly MatchEvent[],
  config: MatchConfig,
): Result<Settlement, SettlementError> {
  const [started, ...rest] = log
  if (started?.type !== 'MATCH_STARTED') return err('NOT_STARTED')
  // CLAUDE.md §12: a match settles under the config it was played under, never a live one.
  if (!isDeepStrictEqual(started.config, config)) return err('CONFIG_MISMATCH')
  if (!Number.isInteger(config.rakeBps) || config.rakeBps < 0 || config.rakeBps > BASIS_POINTS) {
    return err('INVALID_RAKE')
  }

  const buyIn = startingCredits(config)
  const spent = new Map<PlayerId, number>(started.players.map((p) => [p.id, 0]))
  if (!spent.has(started.impostorId)) return err('CORRUPT_LOG')

  let resolution: Resolution | null = null
  for (const event of rest) {
    if (resolution !== null) return err('EVENTS_AFTER_RESOLUTION')
    if (event.type === 'TAPS_APPLIED' || event.type === 'SIPHONED' || event.type === 'TRACED') {
      const before = spent.get(event.playerId)
      if (before === undefined) return err('CORRUPT_LOG')
      spent.set(event.playerId, before + event.cost)
    } else if (event.type === 'MATCH_RESOLVED') {
      resolution = { kind: 'won', winner: event.winner, reason: event.reason, tick: event.tick }
    } else if (event.type === 'MATCH_VOIDED') {
      resolution = { kind: 'voided', reason: event.reason, tick: event.tick }
    }
  }
  if (resolution === null) return err('UNRESOLVED')

  // Seat order, as MATCH_STARTED listed the players, so the settlement lines read in the same order
  // as the board and the reveal. No amount depends on it: every winner takes an equal share and the
  // remainder goes to the rake as dust.
  const ids = started.players.map((p) => p.id)
  if (ids.length !== spent.size) return err('CORRUPT_LOG')
  const spentOf = (id: PlayerId): number => spent.get(id) ?? 0
  if (!ids.every((id) => Number.isInteger(spentOf(id)) && spentOf(id) >= 0 && spentOf(id) <= buyIn)) {
    return err('CORRUPT_LOG')
  }
  const escrowCredits = buyIn * ids.length

  let settlement: Settlement
  if (resolution.kind === 'voided') {
    // Spec §12: a voided match refunds the whole escrow, whatever was spent.
    settlement = {
      matchId: started.matchId,
      resolution,
      escrowCredits,
      potCredits: 0,
      rakeBps: config.rakeBps,
      rakeCredits: 0,
      dustCredits: 0,
      winners: [],
      lines: ids.map((id) => ({ playerId: id, spent: spentOf(id), refund: buyIn, payout: 0 })),
    }
  } else {
    // CLAUDE.md §10: winners come from roles, not survival, so an ejected crew member shares a crew win.
    const impostorWon = resolution.winner === 'impostor'
    const winners = ids.filter((id) => (id === started.impostorId) === impostorWon)
    const potCredits = ids.reduce((sum, id) => sum + spentOf(id), 0)
    const rakeCredits = Math.floor((potCredits * config.rakeBps) / BASIS_POINTS)
    const distributable = potCredits - rakeCredits
    const share = Math.floor(distributable / winners.length)
    settlement = {
      matchId: started.matchId,
      resolution,
      escrowCredits,
      potCredits,
      rakeBps: config.rakeBps,
      rakeCredits,
      // CLAUDE.md §10: the indivisible remainder goes to the rake, reported on its own line.
      dustCredits: distributable - share * winners.length,
      winners,
      lines: ids.map((id) => ({
        playerId: id,
        spent: spentOf(id),
        refund: buyIn - spentOf(id),
        payout: winners.includes(id) ? share : 0,
      })),
    }
  }

  return settlementBalances(settlement) ? ok(settlement) : err('UNBALANCED')
}
