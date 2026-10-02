// Minimal client for the reztor program. Server-side: everything except buildJoinTx needs the
// authority keypair. buildJoinTx returns an unsigned tx for the player's wallet to sign.
import { AnchorProvider, BN, EventParser, Program, Wallet } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../target/idl/reztor.json";
import type { Reztor } from "../target/types/reztor";

// ---- program + PDAs ----

export function getProgram(connection: Connection, signer: Keypair = Keypair.generate()): Program<Reztor> {
  const provider = new AnchorProvider(connection, new Wallet(signer), { commitment: "confirmed" });
  return new Program<Reztor>(idl as Reztor, provider);
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function matchPda(programId: PublicKey, matchId: bigint | number): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(matchId));
  return PublicKey.findProgramAddressSync([Buffer.from("match"), id], programId)[0];
}

export function vaultPda(programId: PublicKey, matchAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), matchAccount.toBuffer()], programId)[0];
}

/** Seat indices (seat order = lane order) to the u8 mask settle_match takes. */
export function winnersMask(seats: number[]): number {
  return seats.reduce((mask, seat) => mask | (1 << seat), 0);
}

// ---- instructions ----

/** players must be in seat order (= lane order). The authority pays rent and gets it back on close. */
export async function createMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint | number,
  players: PublicKey[]
): Promise<string> {
  const config = await program.account.config.fetch(configPda(program.programId));
  const matchAccount = matchPda(program.programId, matchId);
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
    .rpc({ commitment: "confirmed" });
}

/** Unsigned legacy tx, base64, feePayer = player. The player's wallet signs and sends it. */
export async function buildJoinTx(
  program: Program<Reztor>,
  player: PublicKey,
  matchId: bigint | number
): Promise<string> {
  const connection = program.provider.connection;
  const matchAccount = matchPda(program.programId, matchId);
  const m = await program.account.match.fetch(matchAccount);
  const tokenProgram = await tokenProgramOf(connection, m.mint);
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
    .instruction();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: player, recentBlockhash: blockhash }).add(ix);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/**
 * unspentCredits in seat order; winners as a mask (see winnersMask). Prepends ATA creates for any
 * player/treasury ATA that doesn't exist. Returns the payouts from the MatchSettled event.
 */
export async function settleMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint | number,
  unspentCredits: number[],
  winners: number
): Promise<{ signature: string; payouts: bigint[]; treasuryAmount: bigint }> {
  const ctx = await matchContext(program, matchId);
  const seatAtas = ctx.players.map((p) => ctx.ata(p));
  const ix = await program.methods
    .settleMatch(new BN(matchId.toString()), unspentCredits, winners)
    .accountsPartial({ authority: authority.publicKey, ...ctx.accounts })
    .remainingAccounts(seatAtas.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })))
    .instruction();
  const signature = await send(program, authority, ctx, [...ctx.players, ctx.treasury], ix);
  const event = await eventOf(program, signature, "matchSettled");
  return {
    signature,
    payouts: event.payouts.map((p: BN) => BigInt(p.toString())),
    treasuryAmount: BigInt(event.treasuryAmount.toString()),
  };
}

/**
 * Authority void. Refunds every joined seat its snapshotted buy-in. MatchVoided carries only the
 * seat mask, so the refund amounts are derived from it and the match's buy_in snapshot.
 */
export async function voidMatch(
  program: Program<Reztor>,
  authority: Keypair,
  matchId: bigint | number
): Promise<{ signature: string; refunds: bigint[]; refundedSeatsMask: number }> {
  const ctx = await matchContext(program, matchId);
  const joined = ctx.players.filter((_, seat) => ctx.joinedMask & (1 << seat));
  const ix = await program.methods
    .voidMatch(new BN(matchId.toString()))
    .accountsPartial({ caller: authority.publicKey, authority: authority.publicKey, ...ctx.accounts })
    .remainingAccounts(joined.map((p) => ({ pubkey: ctx.ata(p), isWritable: true, isSigner: false })))
    .instruction();
  const signature = await send(program, authority, ctx, [...joined, ctx.treasury], ix);
  const event = await eventOf(program, signature, "matchVoided");
  const mask: number = event.refundedSeatsMask;
  return {
    signature,
    refundedSeatsMask: mask,
    refunds: [0, 1, 2, 3].map((seat) => (mask & (1 << seat) ? ctx.buyIn : 0n)),
  };
}

// ---- internals ----

async function tokenProgramOf(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
  return info.owner;
}

async function matchContext(program: Program<Reztor>, matchId: bigint | number) {
  const connection = program.provider.connection;
  const config = await program.account.config.fetch(configPda(program.programId));
  const matchAccount = matchPda(program.programId, matchId);
  const m = await program.account.match.fetch(matchAccount);
  const tokenProgram = await tokenProgramOf(connection, m.mint);
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(m.mint, owner, true, tokenProgram);
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
  };
}

type MatchContext = Awaited<ReturnType<typeof matchContext>>;

/** Sends [ATA creates for missing owners' ATAs] + ix, signed and paid by the authority. */
async function send(
  program: Program<Reztor>,
  authority: Keypair,
  ctx: MatchContext,
  ataOwners: PublicKey[],
  ix: TransactionInstruction
): Promise<string> {
  const connection = program.provider.connection;
  const atas = ataOwners.map((o) => ctx.ata(o));
  const infos = await connection.getMultipleAccountsInfo(atas, "confirmed");
  const tx = new Transaction();
  infos.forEach((info, i) => {
    if (!info) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey, atas[i], ataOwners[i], ctx.mint, ctx.tokenProgram
        )
      );
    }
  });
  tx.add(ix);
  return sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

async function eventOf(program: Program<Reztor>, signature: string, name: string): Promise<any> {
  const tx = await program.provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const parser = new EventParser(program.programId, program.coder);
  for (const event of parser.parseLogs(tx?.meta?.logMessages ?? [])) {
    if (event.name === name) return event.data;
  }
  throw new Error(`${name} event not found in ${signature}`);
}
