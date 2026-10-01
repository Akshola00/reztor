import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { Reztor } from "../target/types/reztor";

// Mirrors the real SKR mint: classic SPL Token, 6 decimals.
export const DECIMALS = 6;
export const BUY_IN = 12_000_000; // 12 tokens in base units
export const CREDITS_PER_BUY_IN = 1200;

export const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export function getProgram(): Program<Reztor> {
  return anchor.workspace.reztor as Program<Reztor>;
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  )[0];
}

export function programDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  )[0];
}

export async function fundWallet(
  connection: Connection,
  pubkey: PublicKey,
  sol = 10
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

export async function newFundedWallet(
  connection: Connection,
  sol = 10
): Promise<Keypair> {
  const kp = Keypair.generate();
  await fundWallet(connection, kp.publicKey, sol);
  return kp;
}

export async function createMockMint(
  connection: Connection,
  payer: Keypair
): Promise<PublicKey> {
  return createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    DECIMALS,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
}

/** Creates (or fetches) `owner`'s ATA for `mint` and mints `amount` base units into it. */
export async function createFundedAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: number | bigint = 0
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID
  );
  if (BigInt(amount) > 0n) {
    await mintTo(
      connection,
      payer,
      mint,
      ata.address,
      payer,
      amount,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );
  }
  return ata.address;
}

/** Asserts `promise` rejects with the given Anchor error code name. */
export async function expectAnchorError(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    const actual = err?.error?.errorCode?.code;
    expect(actual, `expected ${code}, got: ${err}`).to.equal(code);
    return;
  }
  expect.fail(`expected error ${code}, but the call succeeded`);
}

/** Asserts `promise` rejects at all (for runtime/system errors with no Anchor code). */
export async function expectFailure(
  promise: Promise<unknown>,
  logIncludes?: string
): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    if (logIncludes) {
      const logs: string[] = err?.logs ?? err?.transactionLogs ?? [];
      const text = `${err}\n${logs.join("\n")}`;
      expect(text, `error did not mention "${logIncludes}"`).to.include(
        logIncludes
      );
    }
    return;
  }
  expect.fail("expected the call to fail, but it succeeded");
}
