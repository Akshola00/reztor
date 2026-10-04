import { readFileSync } from 'node:fs'
// BN is the one export Node's ESM loader cannot see on this CommonJS package (it is re-exported
// through a getter), so it comes off the default export. Everything else imports by name.
import anchor, { AnchorProvider, EventParser, Program, Wallet, type IdlEvents } from '@anchor-lang/core'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from '@solana/web3.js'
import type { Reztor } from './idl/reztor.js'

// Ported from contract/scripts/lib.ts, the reference client the devnet smoke run passed with. The
// instruction builders are unchanged; what is added is what a server needs beyond a script: reading
// a match's joined seats, listing open matches, checking a wallet, and recovering a closing event.

const { BN } = anchor

// Read at runtime rather than imported: a JSON import would need resolveJsonModule and an import
// attribute, and the server's tsconfig has neither.
const IDL = JSON.parse(readFileSync(new URL('./idl/reztor.json', import.meta.url), 'utf8')) as Reztor

type Events = IdlEvents<Reztor>
export type MatchSettledEvent = Events['matchSettled']
export type MatchVoidedEvent = Events['matchVoided']

// ---- program + PDAs ----

// PROGRAM_ID wins over the address baked into the IDL, so a redeploy is an env change.
export function getProgram(connection: Connection, programId: PublicKey, signer: Keypair = Keypair.generate()): Program<Reztor> {
  const provider = new AnchorProvider(connection, new Wallet(signer), { commitment: 'confirmed' })
  return new Program<Reztor>({ ...IDL, address: programId.toBase58() }, provider)
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0]
}

export function matchPda(programId: PublicKey, matchId: bigint): PublicKey {
  const id = Buffer.alloc(8)
  id.writeBigUInt64LE(matchId)
  return PublicKey.findProgramAddressSync([Buffer.from('match'), id], programId)[0]
}

export function vaultPda(programId: PublicKey, matchAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), matchAccount.toBuffer()], programId)[0]
}

// Seat indices (seat order = lane order) to the u8 mask settle_match takes.
export function winnersMask(seats: number[]): number {
  return seats.reduce((mask, seat) => mask | (1 << seat), 0)
}

// ---- instructions ----

// players must be in seat order (= lane order). The authority pays rent and gets it back on close.
export async function createMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint,
  players: PublicKey[],
): Promise<string> {
  const config = await program.account.config.fetch(configPda(program.programId))
  const matchAccount = matchPda(program.programId, matchId)
  return program.methods
    .createMatch(new BN(matchId.toString()), players)
    .accountsPartial({
      authority: authority.publicKey,
      config: configPda(program.programId),
      mint: config.mint,
      matchAccount,
      vault: vaultPda(program.programId, matchAccount),
      tokenProgram: await tokenProgramOf(program.provider.connection, config.mint),
    })
    .signers([authority])
    .rpc({ commitment: 'confirmed' })
}

// Unsigned legacy tx, base64, feePayer = player. The player's wallet signs and sends it.
export async function buildJoinTx(program: Program<Reztor>, player: PublicKey, matchId: bigint): Promise<string> {
  const connection = program.provider.connection
  const matchAccount = matchPda(program.programId, matchId)
  const m = await program.account.match.fetch(matchAccount)
  const tokenProgram = await tokenProgramOf(connection, m.mint)
  const ix = await program.methods
    .joinMatch(new BN(matchId.toString()))
    .accountsPartial({
      player,
      config: configPda(program.programId),
      matchAccount,
      mint: m.mint,
      playerTokenAccount: getAssociatedTokenAddressSync(m.mint, player, false, tokenProgram),
      vault: vaultPda(program.programId, matchAccount),
      tokenProgram,
    })
    .instruction()
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  const tx = new Transaction({ feePayer: player, recentBlockhash: blockhash }).add(ix)
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}

export type SettleResult = { signature: string; payouts: bigint[]; treasuryAmount: bigint }

// unspentCredits in seat order; winners as a mask (see winnersMask). Prepends ATA creates for any
// player/treasury ATA that doesn't exist. Returns the payouts from the MatchSettled event.
export async function settleMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint,
  unspentCredits: number[],
  winners: number,
): Promise<SettleResult> {
  const ctx = await matchContext(program, matchId)
  const seatAtas = ctx.players.map((p) => ctx.ata(p))
  const ix = await program.methods
    .settleMatch(new BN(matchId.toString()), unspentCredits, winners)
    .accountsPartial({ authority: authority.publicKey, ...ctx.accounts })
    .remainingAccounts(seatAtas.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
    .instruction()
  const signature = await send(program, authority, ctx, [...ctx.players, ctx.treasury], ix)
  const event = await eventOf<MatchSettledEvent>(program, signature, 'matchSettled')
  return {
    signature,
    payouts: event.payouts.map((p) => BigInt(p.toString())),
    treasuryAmount: BigInt(event.treasuryAmount.toString()),
  }
}

// Authority void. Refunds every joined seat its snapshotted buy-in. MatchVoided carries only the
// seat mask, so the refund amounts are derived from it and the match's buy_in snapshot.
export async function voidMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint,
): Promise<{ signature: string; refunds: bigint[]; refundedSeatsMask: number }> {
  const ctx = await matchContext(program, matchId)
  const joined = ctx.players.filter((_, seat) => ctx.joinedMask & (1 << seat))
  const ix = await program.methods
    .voidMatch(new BN(matchId.toString()))
    .accountsPartial({ caller: authority.publicKey, authority: authority.publicKey, ...ctx.accounts })
    .remainingAccounts(joined.map((p) => ({ pubkey: ctx.ata(p), isWritable: true, isSigner: false })))
    .instruction()
  const signature = await send(program, authority, ctx, [...joined, ctx.treasury], ix)
  const event = await eventOf<MatchVoidedEvent>(program, signature, 'matchVoided')
  const mask = event.refundedSeatsMask
  return {
    signature,
    refundedSeatsMask: mask,
    refunds: [0, 1, 2, 3].map((seat) => (mask & (1 << seat) ? ctx.buyIn : 0n)),
  }
}

// ---- reads the server adds ----

// null once the account is closed, which happens on settle and on void.
export async function joinedMaskOf(program: Program<Reztor>, matchId: bigint): Promise<number | null> {
  const m = await program.account.match.fetchNullable(matchPda(program.programId, matchId))
  return m === null ? null : m.joinedMask
}

// Base units per credit, from the match's own snapshot of the config. Exact: the program requires
// buy_in_amount to divide by credits_per_buy_in.
export async function baseUnitsPerCredit(program: Program<Reztor>, matchId: bigint): Promise<bigint> {
  const m = await program.account.match.fetch(matchPda(program.programId, matchId))
  return BigInt(m.buyInAmount.toString()) / BigInt(m.creditsPerBuyIn)
}

// Every Match account that still exists. Settle and void close theirs, so these are all unfinished.
export async function openMatches(program: Program<Reztor>): Promise<{ matchId: bigint; joinedMask: number }[]> {
  const all = await program.account.match.all()
  return all.map(({ account }) => ({ matchId: BigInt(account.matchId.toString()), joinedMask: account.joinedMask }))
}

export type ProgramConfig = { authority: PublicKey; mint: PublicKey; buyIn: bigint; rakeBps: number }

export async function programConfig(program: Program<Reztor>): Promise<ProgramConfig> {
  const config = await program.account.config.fetch(configPda(program.programId))
  return {
    authority: config.authority,
    mint: config.mint,
    buyIn: BigInt(config.buyInAmount.toString()),
    rakeBps: config.rakeBps,
  }
}

// Enough to pay the join fee from: 0.01 SOL.
export const MIN_LAMPORTS = LAMPORTS_PER_SOL / 100

// join_match pays from the wallet's ATA and nothing else, so that is the only balance that counts.
export async function walletFunded(connection: Connection, mint: PublicKey, buyIn: bigint, wallet: PublicKey): Promise<boolean> {
  const tokenProgram = await tokenProgramOf(connection, mint)
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram)
  const [lamports, info] = await Promise.all([
    connection.getBalance(wallet, 'confirmed'),
    connection.getAccountInfo(ata, 'confirmed'),
  ])
  if (lamports < MIN_LAMPORTS || info === null) return false
  return unpackAccount(ata, info, tokenProgram).amount >= buyIn
}

// After an attempt whose outcome is unknown (it threw after sending), the closing transaction may
// have landed anyway. The match account is gone then, and its last transactions say how it closed.
export async function closingEvent<E extends 'matchSettled' | 'matchVoided'>(
  program: Program<Reztor>,
  matchId: bigint,
  name: E,
): Promise<{ signature: string; data: Events[E] } | null> {
  const connection = program.provider.connection
  const signatures = await connection.getSignaturesForAddress(matchPda(program.programId, matchId), { limit: 10 }, 'confirmed')
  for (const { signature, err: failed } of signatures) {
    if (failed !== null) continue
    const data = await eventIn<Events[E]>(program, signature, name)
    if (data !== null && BigInt(data.matchId.toString()) === matchId) return { signature, data }
  }
  return null
}

// ---- internals ----

export async function tokenProgramOf(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint)
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`)
  return info.owner
}

async function matchContext(program: Program<Reztor>, matchId: bigint) {
  const connection = program.provider.connection
  const config = await program.account.config.fetch(configPda(program.programId))
  const matchAccount = matchPda(program.programId, matchId)
  const m = await program.account.match.fetch(matchAccount)
  const tokenProgram = await tokenProgramOf(connection, m.mint)
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(m.mint, owner, true, tokenProgram)
  return {
    mint: m.mint,
    tokenProgram,
    players: m.players,
    joinedMask: m.joinedMask,
    buyIn: BigInt(m.buyInAmount.toString()),
    treasury: config.treasury,
    ata,
    accounts: {
      config: configPda(program.programId),
      matchAccount,
      mint: m.mint,
      vault: vaultPda(program.programId, matchAccount),
      treasuryTokenAccount: ata(config.treasury),
      tokenProgram,
    },
  }
}

type MatchContext = Awaited<ReturnType<typeof matchContext>>

// Sends [ATA creates for missing owners' ATAs] + ix, signed and paid by the authority.
async function send(
  program: Program<Reztor>,
  authority: Keypair,
  ctx: MatchContext,
  ataOwners: PublicKey[],
  ix: TransactionInstruction,
): Promise<string> {
  const connection = program.provider.connection
  const atas = ataOwners.map((o) => ctx.ata(o))
  const infos = await connection.getMultipleAccountsInfo(atas, 'confirmed')
  const tx = new Transaction()
  infos.forEach((info, i) => {
    const ata = atas[i]
    const owner = ataOwners[i]
    if (!info && ata !== undefined && owner !== undefined) {
      tx.add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, ctx.mint, ctx.tokenProgram))
    }
  })
  tx.add(ix)
  return sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' })
}

async function eventIn<T>(program: Program<Reztor>, signature: string, name: string): Promise<T | null> {
  const tx = await program.provider.connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  const parser = new EventParser(program.programId, program.coder)
  for (const event of parser.parseLogs(tx?.meta?.logMessages ?? [])) {
    if (event.name === name) return event.data as T
  }
  return null
}

async function eventOf<T>(program: Program<Reztor>, signature: string, name: string): Promise<T> {
  const data = await eventIn<T>(program, signature, name)
  if (data === null) throw new Error(`${name} event not found in ${signature}`)
  return data
}
