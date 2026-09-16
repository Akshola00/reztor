import { err, ok, type Result } from '../engine/result.js'
import { settlementBalances, type Settlement } from '../engine/settlement.js'
import type { PlayerId } from '../engine/state.js'

export type EscrowSeat = { playerId: PlayerId; wallet: string | null }

export type EscrowStatus = 'locked' | 'settled' | 'voided'

export type EscrowReceipt = {
  matchId: string
  status: EscrowStatus
  escrowSkr: number
  // Stands in for a transaction signature. The fake makes one up; a chain provider returns a real one.
  reference: string
}

export type EscrowError = 'ALREADY_LOCKED' | 'UNKNOWN_MATCH' | 'ALREADY_CLOSED' | 'UNBALANCED'

// CLAUDE.md §10's four instructions, minus the chain. The match layer only ever sees this
// interface, so the Solana client can be dropped in later without the lobby or the tick loop
// learning what a transaction is.
export interface EscrowProvider {
  lock(matchId: string, seats: readonly EscrowSeat[], buyInSkr: number): Promise<Result<EscrowReceipt, EscrowError>>
  settle(matchId: string, settlement: Settlement): Promise<Result<EscrowReceipt, EscrowError>>
  void(matchId: string, reason: string): Promise<Result<EscrowReceipt, EscrowError>>
}

type Account = EscrowReceipt & { seats: readonly EscrowSeat[] }

// The in-memory fake. Idempotent in the way §10 demands: closing an already-closed match returns
// the receipt it already issued rather than making a second one.
export function inMemoryEscrow(): EscrowProvider & { accounts(): EscrowReceipt[] } {
  const accounts = new Map<string, Account>()
  let counter = 0
  const reference = (verb: string) => `${verb}-${(counter += 1)}`

  const close = (
    matchId: string,
    status: Exclude<EscrowStatus, 'locked'>,
  ): Result<EscrowReceipt, EscrowError> => {
    const account = accounts.get(matchId)
    if (account === undefined) return err('UNKNOWN_MATCH')
    if (account.status !== 'locked') {
      return account.status === status ? ok(account) : err('ALREADY_CLOSED')
    }
    const closed: Account = { ...account, status, reference: reference(status) }
    accounts.set(matchId, closed)
    return ok(closed)
  }

  return {
    async lock(matchId, seats, buyInSkr) {
      if (accounts.has(matchId)) return err('ALREADY_LOCKED')
      const account: Account = {
        matchId,
        status: 'locked',
        escrowSkr: buyInSkr * seats.length,
        reference: reference('lock'),
        seats,
      }
      accounts.set(matchId, account)
      return ok(account)
    },

    async settle(matchId, settlement) {
      // CLAUDE.md §11: the reconciliation check runs before every settlement, and a payload that
      // does not balance to the credit is refused here rather than sent.
      if (!settlementBalances(settlement)) return err('UNBALANCED')
      return close(matchId, 'settled')
    },

    async void(matchId, _reason) {
      return close(matchId, 'voided')
    },

    accounts() {
      return [...accounts.values()].map(({ seats: _seats, ...receipt }) => receipt)
    },
  }
}
