// Mock SKR on devnet: classic SPL Token, 6 decimals, no freeze authority. Mint authority = deployer.
import { TOKEN_PROGRAM_ID, createMint } from "@solana/spl-token";
import { DECIMALS, connection, deployer, explorer, readDeployments, writeDeployments } from "./common";

async function main() {
  const existing = readDeployments().mockMint;
  if (existing) {
    console.log(`mock mint already in deployments/devnet.json: ${existing}`);
    return;
  }
  const payer = deployer();
  const mint = await createMint(connection, payer, payer.publicKey, null, DECIMALS, undefined, { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  writeDeployments({ mockMint: mint.toBase58() });
  console.log(`mock mint: ${mint.toBase58()}\n${explorer("address", mint.toBase58())}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
