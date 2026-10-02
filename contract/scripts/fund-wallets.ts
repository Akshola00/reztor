// Usage: tsx scripts/fund-wallets.ts <pubkey...>
// Sends each 0.5 devnet SOL and 240 mock SKR (minted to their ATA), paid by the deployer.
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DECIMALS, connection, deployer, mockMint } from "./common";

const SOL = 0.5;
const SKR = 240n;

async function main() {
  const owners = process.argv.slice(2).map((k) => new PublicKey(k));
  if (owners.length === 0) throw new Error("usage: fund-wallets.ts <pubkey...>");
  const payer = deployer();
  const mint = mockMint();
  for (const owner of owners) {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner, lamports: SOL * LAMPORTS_PER_SOL }),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint),
      createMintToCheckedInstruction(mint, ata, payer.publicKey, SKR * 10n ** BigInt(DECIMALS), DECIMALS)
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    console.log(`${owner.toBase58()}: +${SOL} SOL, +${SKR} SKR (${sig})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
