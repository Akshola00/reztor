// initialize_config on devnet. Signer = deployer (upgrade authority, becomes admin).
// authority = generated server key; also creates the treasury's ATA and funds the authority.
import { BN } from "@anchor-lang/core";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TREASURY, connection, deployer, explorer, mockMint, serverAuthority, writeDeployments } from "./common";
import { configPda, getProgram } from "./lib";

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PARAMS = { buyIn: 12_000_000, credits: 1200, rakeBps: 0, voidTimeout: 1800 };

async function main() {
  const admin = deployer();
  const authority = serverAuthority();
  const mint = mockMint();
  const program = getProgram(connection, admin);
  const config = configPda(program.programId);

  if (await connection.getAccountInfo(config)) {
    console.log(`config already initialized: ${config.toBase58()}`);
  } else {
    const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
    const sig = await program.methods
      .initializeConfig(
        authority.publicKey,
        mint,
        TREASURY,
        new BN(PARAMS.buyIn),
        PARAMS.credits,
        PARAMS.rakeBps,
        new BN(PARAMS.voidTimeout)
      )
      .accountsPartial({ admin: admin.publicKey, config, programData })
      .rpc({ commitment: "confirmed" });
    console.log(`initialize_config: ${explorer("tx", sig)}`);
  }

  const treasuryAta = getAssociatedTokenAddressSync(mint, TREASURY, true);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasuryAta, TREASURY, mint)
  );
  const balance = await connection.getBalance(authority.publicKey);
  if (balance < 2 * LAMPORTS_PER_SOL) {
    tx.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: authority.publicKey, lamports: 2 * LAMPORTS_PER_SOL - balance }));
  }
  const sig = await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });
  console.log(`treasury ATA ${treasuryAta.toBase58()} ensured; authority topped up to 2 SOL (${sig})`);

  const c = await program.account.config.fetch(config);
  writeDeployments({
    programId: program.programId.toBase58(),
    configPda: config.toBase58(),
    admin: c.admin.toBase58(),
    authority: c.authority.toBase58(),
    treasury: c.treasury.toBase58(),
    treasuryTokenAccount: treasuryAta.toBase58(),
  });
  console.log({
    admin: c.admin.toBase58(),
    authority: c.authority.toBase58(),
    mint: c.mint.toBase58(),
    treasury: c.treasury.toBase58(),
    buyIn: c.buyInAmount.toString(),
    credits: c.creditsPerBuyIn,
    rakeBps: c.rakeBps,
    voidTimeoutSecs: c.voidTimeoutSecs.toString(),
    paused: c.paused,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
