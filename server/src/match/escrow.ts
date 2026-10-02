import { randomBytes } from 'node:crypto'
import { err, ok, type Result } from '../engine/result.js'
import { settlementBalances, type Settlement } from '../engine/settlement.js'
import type { PlayerId } from '../engine/state.js'
import type { Logger } from '../log.js'

// In seat order, which is lane order and the order the chain stores the players in.
export type EscrowSeat = { playerId: PlayerId; wallet: string | null }

export type OpenReceipt = { chainMatchId: bigint }

export type SettleReceipt = {
  // null when there is no chain to have signed anything: the fake.
  signature: string | null
  // What each seat was paid, refund included, in seat order and in the token's base units.
  payouts: bigint[]
  // Converts the server's credits into those base units, so payouts can be checked against them.
  baseUnitsPerCredit: bigint
}

export type VoidReceipt = { signature: string | null }

export type EscrowError =
  | 'ALREADY_OPEN'
  | 'UNKNOWN_MATCH'
  | 'ALREADY_CLOSED'
  | 'UNBALANCED'
  | 'FUNDING_TIMEOUT'
  | 'CHAIN_ERROR'
  | 'PROVIDER_ERROR'

// CLAUDE.md §10's four instructions as a funding flow. The match layer only ever sees this
// interface, so neither the lobby nor the tick loop learns what a transaction is.
export interface EscrowProvider {
  open(matchId: string, seats: readonly EscrowSeat[]): Promise<Result<OpenReceipt, EscrowError>>
  // A base64 unsigned transaction for this wallet to sign, or null when nobody needs to sign.
  joinTxFor(matchId: string, wallet: string | null): Promise<Result<string | null, EscrowError>>
  // Resolves ok once every seat has paid. onStaked reports the seats paid so far whenever that changes.
  awaitFunded(
    matchId: string,
    timeoutMs: number,
    onStaked?: (staked: PlayerId[]) => void,
  ): Promise<Result<void, EscrowError>>
  settle(matchId: string, settlement: Settlement): Promise<Result<SettleReceipt, EscrowError>>
  void(matchId: string, reason: string): Promise<Result<VoidReceipt, EscrowError>>
}

// u64, the chain's match id type. Random rather than counted so a restarted server cannot reuse one.
export const randomChainMatchId = (): bigint => randomBytes(8).readBigUInt64LE()

type Account = {
  matchId: string
  chainMatchId: bigint
  status: 'open' | 'settled' | 'voided'
  seats: readonly EscrowSeat[]
  settled: SettleReceipt | null
}

// The in-memory fake. Nobody signs and funding is instant, so a lobby fills exactly as it did
// before there was a chain. Idempotent in the way §10 demands: closing an already-closed match
// returns the receipt it already issued rather than making a second one.
export function inMemoryEscrow(): EscrowProvider & {
  accounts(): { matchId: string; chainMatchId: bigint; status: Account['status'] }[]
} {
  const accounts = new Map<string, Account>()

  return {
    async open(matchId, seats) {
      if (accounts.has(matchId)) return err('ALREADY_OPEN')
      const chainMatchId = randomChainMatchId()
      accounts.set(matchId, { matchId, chainMatchId, status: 'open', seats, settled: null })
      return ok({ chainMatchId })
    },

    async joinTxFor() {
      return ok(null)
    },

    async awaitFunded(matchId) {
      return accounts.has(matchId) ? ok(undefined) : err('UNKNOWN_MATCH')
    },

    async settle(matchId, settlement) {
      // CLAUDE.md §11: the reconciliation check runs before every settlement, and a payload that
      // does not balance to the credit is refused here rather than sent.
      if (!settlementBalances(settlement)) return err('UNBALANCED')
      const account = accounts.get(matchId)
      if (account === undefined) return err('UNKNOWN_MATCH')
      if (account.status === 'settled' && account.settled !== null) return ok(account.settled)
      if (account.status !== 'open') return err('ALREADY_CLOSED')
      const receipt: SettleReceipt = {
        signature: null,
        payouts: settlement.lines.map((line) => BigInt(line.refund + line.payout)),
        baseUnitsPerCredit: 1n,
      }
      accounts.set(matchId, { ...account, status: 'settled', settled: receipt })
      return ok(receipt)
    },

    async void(matchId) {
      const account = accounts.get(matchId)
      if (account === undefined) return err('UNKNOWN_MATCH')
      if (account.status === 'settled') return err('ALREADY_CLOSED')
      accounts.set(matchId, { ...account, status: 'voided' })
      return ok({ signature: null })
    },

    accounts() {
      return [...accounts.values()].map(({ matchId, chainMatchId, status }) => ({ matchId, chainMatchId, status }))
    },
  }
}

// How long past its own timeout awaitFunded may run before the guard gives up on it.
export const FUNDING_GRACE_MS = 10_000

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function withDeadline<T>(
  pending: Promise<Result<T, EscrowError>>,
  deadlineMs: number,
): Promise<Result<T, EscrowError>> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<Result<T, EscrowError>>((resolve) => {
    timer = setTimeout(() => resolve(err('FUNDING_TIMEOUT')), deadlineMs)
    timer.unref?.()
  })
  return Promise.race([pending, expired]).finally(() => clearTimeout(timer))
}

// A provider that throws, or never answers, must not strand a lobby: a throwing lock once left one
// hung for good. Every call comes back as a Result, and awaitFunded has a hard deadline of its own
// whatever the provider does with the one it was given.
export function guardEscrow(provider: EscrowProvider, logger: Logger): EscrowProvider {
  const guard = async <T>(
    call: string,
    matchId: string,
    run: () => Promise<Result<T, EscrowError>>,
  ): Promise<Result<T, EscrowError>> => {
    try {
      return await run()
    } catch (error) {
      logger('error', 'escrow provider threw', { matchId, call, error: message(error) })
      return err('PROVIDER_ERROR')
    }
  }

  return {
    open: (matchId, seats) => guard('open', matchId, () => provider.open(matchId, seats)),
    joinTxFor: (matchId, wallet) => guard('joinTxFor', matchId, () => provider.joinTxFor(matchId, wallet)),
    awaitFunded: (matchId, timeoutMs, onStaked) =>
      guard('awaitFunded', matchId, () =>
        withDeadline(provider.awaitFunded(matchId, timeoutMs, onStaked), timeoutMs + FUNDING_GRACE_MS),
      ),
    settle: (matchId, settlement) => guard('settle', matchId, () => provider.settle(matchId, settlement)),
    void: (matchId, reason) => guard('void', matchId, () => provider.void(matchId, reason)),
  }
}
