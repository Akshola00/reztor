import type { Program } from '@anchor-lang/core'
import { Connection, PublicKey, type Keypair } from '@solana/web3.js'
import { err, ok, type Result } from '../engine/result.js'
import type { Settlement } from '../engine/settlement.js'
import type { PlayerId } from '../engine/state.js'
import type { Logger } from '../log.js'
import { randomChainMatchId, type EscrowError, type EscrowProvider, type EscrowSeat } from '../match/escrow.js'
import type { WalletPolicy } from '../match/lobby.js'
import {
  baseUnitsPerCredit,
  buildJoinTx,
  closingEvent,
  createMatch,
  getProgram,
  joinedMaskOf,
  openMatches,
  programConfig,
  settleMatch,
  voidMatch,
  walletFunded,
} from './client.js'
import type { ChainConfig } from './config.js'
import type { Reztor } from './idl/reztor.js'

// settle and void are retried; open is not. A failed open has taken nobody's money, so the lobby
// just dissolves, while a settle or void that never lands leaves stakes sitting in a vault.
export const CHAIN_ATTEMPTS = 5
export const CHAIN_BACKOFF_MS = 1_000
export const FUNDING_POLL_MS = 2_000

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// A wallet that can sign: a valid key on the ed25519 curve. A PDA parses as a key but cannot sign.
export function isWalletAddress(wallet: string): boolean {
  try {
    const key = new PublicKey(wallet)
    return !key.equals(PublicKey.default) && PublicKey.isOnCurve(key.toBytes())
  } catch {
    return false
  }
}

// settle_match's arguments: unspent credits by seat and a winners mask, both in the seat order the
// match was opened with. Mapped by playerId rather than trusting the lines to be in that order.
export function settleArgs(
  settlement: Settlement,
  seats: readonly EscrowSeat[],
): Result<{ unspentCredits: number[]; winnersMask: number }, 'SEAT_MISMATCH'> {
  if (settlement.lines.length !== seats.length) return err('SEAT_MISMATCH')
  const unspentCredits: number[] = []
  let winnersMask = 0
  for (const [index, seat] of seats.entries()) {
    const line = settlement.lines.find((candidate) => candidate.playerId === seat.playerId)
    if (line === undefined) return err('SEAT_MISMATCH')
    unspentCredits.push(line.refund)
    if (settlement.winners.includes(seat.playerId)) winnersMask |= 1 << index
  }
  return ok({ unspentCredits, winnersMask })
}

type Opened = { chainMatchId: bigint; seats: readonly EscrowSeat[]; baseUnitsPerCredit: bigint }

// Thrown means "try again"; a returned error is final.
type Attempt<T> = (attempt: number) => Promise<Result<T, EscrowError>>

export type ChainEscrowOptions = {
  program: Program<Reztor>
  authority: Keypair
  logger: Logger
}

export function chainEscrow({ program, authority, logger }: ChainEscrowOptions): EscrowProvider {
  const opened = new Map<string, Opened>()

  const retrying = async <T>(call: string, fields: Record<string, unknown>, attempt: Attempt<T>) => {
    for (let n = 1; ; n++) {
      try {
        return await attempt(n)
      } catch (error) {
        if (n >= CHAIN_ATTEMPTS) {
          // The one line an operator needs to finish this by hand: which match, and what it was doing.
          logger('error', `chain ${call} failed after ${n} attempts`, { ...fields, error: message(error) })
          return err<EscrowError>('CHAIN_ERROR')
        }
        logger('warn', `chain ${call} failed, retrying`, { ...fields, attempt: n, error: message(error) })
        await sleep(CHAIN_BACKOFF_MS * 2 ** (n - 1))
      }
    }
  }

  return {
    async open(matchId, seats) {
      if (opened.has(matchId)) return err('ALREADY_OPEN')
      const players = seats.map((seat) => (seat.wallet !== null && isWalletAddress(seat.wallet) ? new PublicKey(seat.wallet) : null))
      if (!players.every((player) => player !== null)) {
        logger('error', 'chain open needs a wallet for every seat', { matchId })
        return err('CHAIN_ERROR')
      }
      const chainMatchId = randomChainMatchId()
      const fields = { matchId, chainMatchId: String(chainMatchId) }
      try {
        const signature = await createMatch(program, authority, chainMatchId, players)
        opened.set(matchId, { chainMatchId, seats, baseUnitsPerCredit: await baseUnitsPerCredit(program, chainMatchId) })
        logger('info', 'chain match created', { ...fields, signature })
        return ok({ chainMatchId })
      } catch (error) {
        logger('error', 'chain create_match failed', { ...fields, error: message(error) })
        return err('CHAIN_ERROR')
      }
    },

    async joinTxFor(matchId, wallet) {
      const match = opened.get(matchId)
      if (match === undefined) return err('UNKNOWN_MATCH')
      if (wallet === null || !isWalletAddress(wallet)) return err('CHAIN_ERROR')
      try {
        return ok(await buildJoinTx(program, new PublicKey(wallet), match.chainMatchId))
      } catch (error) {
        logger('error', 'chain join tx could not be built', {
          matchId,
          chainMatchId: String(match.chainMatchId),
          error: message(error),
        })
        return err('CHAIN_ERROR')
      }
    },

    // Polled rather than subscribed: the public devnet websocket drops subscriptions, and a missed
    // notification would hang the stage until its timeout. One read every two seconds is cheap.
    async awaitFunded(matchId, timeoutMs, onStaked) {
      const match = opened.get(matchId)
      if (match === undefined) return err('UNKNOWN_MATCH')
      const fields = { matchId, chainMatchId: String(match.chainMatchId) }
      const full = (1 << match.seats.length) - 1
      const deadline = Date.now() + timeoutMs
      let seen = 0
      for (;;) {
        try {
          const mask = await joinedMaskOf(program, match.chainMatchId)
          if (mask === null) return err('UNKNOWN_MATCH')
          if (mask !== seen) {
            seen = mask
            const staked: PlayerId[] = match.seats.flatMap((seat, index) => (mask & (1 << index) ? [seat.playerId] : []))
            logger('info', 'stakes landed', { ...fields, joinedMask: mask })
            onStaked?.(staked)
          }
          if ((mask & full) === full) return ok(undefined)
        } catch (error) {
          logger('warn', 'joined-seat read failed, polling on', { ...fields, error: message(error) })
        }
        if (Date.now() >= deadline) return err('FUNDING_TIMEOUT')
        await sleep(Math.min(FUNDING_POLL_MS, Math.max(0, deadline - Date.now())))
      }
    },

    async settle(matchId, settlement) {
      const match = opened.get(matchId)
      if (match === undefined) return err('UNKNOWN_MATCH')
      const args = settleArgs(settlement, match.seats)
      if (!args.ok) return err('UNBALANCED')
      const fields = { matchId, chainMatchId: String(match.chainMatchId) }

      // CLAUDE.md §10: a retry sends the same payload, never a recomputed one. It first checks
      // whether an earlier attempt landed after all, since the account closes when one does.
      const result = await retrying('settle', fields, async (attempt) => {
        if (attempt > 1 && (await joinedMaskOf(program, match.chainMatchId)) === null) {
          const landed = await closingEvent(program, match.chainMatchId, 'matchSettled')
          if (landed === null) return err<EscrowError>('ALREADY_CLOSED')
          return ok({ signature: landed.signature, payouts: landed.data.payouts.map((p) => BigInt(p.toString())) })
        }
        const settled = await settleMatch(program, authority, match.chainMatchId, args.value.unspentCredits, args.value.winnersMask)
        return ok({ signature: settled.signature, payouts: settled.payouts })
      })
      if (!result.ok) return result
      opened.delete(matchId)
      logger('info', 'chain match settled', { ...fields, signature: result.value.signature })
      return ok({ ...result.value, baseUnitsPerCredit: match.baseUnitsPerCredit })
    },

    async void(matchId, reason) {
      const match = opened.get(matchId)
      if (match === undefined) return err('UNKNOWN_MATCH')
      const fields = { matchId, chainMatchId: String(match.chainMatchId), reason }
      const result = await retrying('void', fields, async (attempt) => {
        if (attempt > 1 && (await joinedMaskOf(program, match.chainMatchId)) === null) {
          const landed = await closingEvent(program, match.chainMatchId, 'matchVoided')
          return landed === null ? err<EscrowError>('ALREADY_CLOSED') : ok({ signature: landed.signature })
        }
        const voided = await voidMatch(program, authority, match.chainMatchId)
        return ok({ signature: voided.signature })
      })
      if (!result.ok) return result
      opened.delete(matchId)
      logger('info', 'chain match voided', { ...fields, signature: result.value.signature })
      return result
    },
  }
}

// Startup recovery. A restart loses every lobby and match in memory, so any Match account still on
// chain belongs to a game that no longer exists: void it, refunding whoever paid.
//
// It voids every one the program owns, so two servers sharing one authority must never both run in
// chain mode: each boot would void the other's live matches.
export async function voidOrphanedMatches(program: Program<Reztor>, authority: Keypair, logger: Logger): Promise<number> {
  const orphans = await openMatches(program)
  let voided = 0
  for (const { matchId, joinedMask } of orphans) {
    const fields = { chainMatchId: String(matchId), joinedMask }
    for (let n = 1; n <= CHAIN_ATTEMPTS; n++) {
      try {
        const result = await voidMatch(program, authority, matchId)
        logger('info', 'voided orphaned chain match', {
          ...fields,
          signature: result.signature,
          refundedSeatsMask: result.refundedSeatsMask,
        })
        voided += 1
        break
      } catch (error) {
        const level = n === CHAIN_ATTEMPTS ? 'error' : 'warn'
        logger(level, 'orphaned chain match void failed', { ...fields, attempt: n, error: message(error) })
        if (n < CHAIN_ATTEMPTS) await sleep(CHAIN_BACKOFF_MS * 2 ** (n - 1))
      }
    }
  }
  logger('info', 'startup recovery done', { found: orphans.length, voided })
  return voided
}

export type Chain = {
  escrow: EscrowProvider
  wallets: WalletPolicy
  recover(): Promise<number>
}

// Fails fast on a config the program would refuse later: a key that is not the program's authority
// would have every settle and void rejected, and a different mint every join.
export async function connectChain(config: ChainConfig, logger: Logger): Promise<Result<Chain, string>> {
  const connection = new Connection(config.rpcUrl, 'confirmed')
  const program = getProgram(connection, config.programId, config.authority)

  let onChain
  try {
    onChain = await programConfig(program)
  } catch (error) {
    return err(`could not read the program's config account: ${message(error)}`)
  }
  if (!onChain.authority.equals(config.authority.publicKey)) {
    return err(
      `AUTHORITY_SECRET_KEY is ${config.authority.publicKey.toBase58()}, but the program's authority is ${onChain.authority.toBase58()}`,
    )
  }
  if (!onChain.mint.equals(config.mint)) {
    return err(`MINT is ${config.mint.toBase58()}, but the program's mint is ${onChain.mint.toBase58()}`)
  }

  return ok({
    escrow: chainEscrow({ program, authority: config.authority, logger }),
    wallets: {
      isAddress: isWalletAddress,
      isFunded: (wallet) => walletFunded(connection, config.mint, onChain.buyIn, new PublicKey(wallet)),
    },
    recover: () => voidOrphanedMatches(program, config.authority, logger),
  })
}
