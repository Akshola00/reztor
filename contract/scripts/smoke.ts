// Devnet smoke test with the 4 test keys.
//   match 1: create, all 4 join, settle a crew win (seats 0, 2, 3) with partial spends.
//   match 2: create, seats 0 and 1 join, void.
// Joins go through buildJoinTx exactly as the app will: unsigned base64 tx, player signs.
import { Keypair, Transaction } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TREASURY, connection, explorer, mockMint, serverAuthority, testPlayers, writeDeployments } from "./common";
import { buildJoinTx, createMatch, getProgram, settleMatch, voidMatch, winnersMask } from "./lib";

const RATE = 10_000n; // base units per credit at buy_in 12_000_000 / 1200
const BUY_IN = 12_000_000n;

async function main() {
  const authority = serverAuthority();
  const players = testPlayers();
  const mint = mockMint();
  const program = getProgram(connection, authority);
  const treasury = getAssociatedTokenAddressSync(mint, TREASURY, true);
  const watched = [...players.map((p) => getAssociatedTokenAddressSync(mint, p.publicKey)), treasury];
  const balances = () => Promise.all(watched.map(async (a) => (await getAccount(connection, a, "confirmed")).amount));
  const report = (label: string, before: bigint[], after: bigint[], expected: bigint[]) => {
    const deltas = after.map((b, i) => b - before[i]);
    console.log(`${label} deltas (seat 0..3, treasury): ${deltas.join(", ")}`);
    const ok = deltas.every((d, i) => d === expected[i]);
    console.log(ok ? "  matches expected" : `  MISMATCH, expected ${expected.join(", ")}`);
    return ok;
  };

  async function join(matchId: bigint, player: Keypair) {
    const tx = Transaction.from(Buffer.from(await buildJoinTx(program, player.publicKey, matchId), "base64"));
    tx.sign(player);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, ...(await connection.getLatestBlockhash()) }, "confirmed");
    return sig;
  }

  const base = BigInt(Date.now()) * 10n; // unique, fresh match ids per run
  let allOk = true;

  // ---- match 1: settle ----
  const m1 = base + 1n;
  const unspent = [900, 600, 1000, 1100]; // spent 300+600+200+100 = 1200 credits, rake 0
  const crew = winnersMask([0, 2, 3]); // share 400 each; seat 1 is the impostor
  const expected1 = [900 + 400, 600, 1000 + 400, 1100 + 400].map((c) => BigInt(c) * RATE - BUY_IN).concat([0n]);

  const before1 = await balances();
  console.log(`match 1 (${m1}) create: ${explorer("tx", await createMatch(program, authority, m1, players.map((p) => p.publicKey)))}`);
  for (const [seat, p] of players.entries()) console.log(`  seat ${seat} join: ${await join(m1, p)}`);
  const settled = await settleMatch(program, authority, m1, unspent, crew);
  console.log(`match 1 settle: ${explorer("tx", settled.signature)}`);
  console.log(`  event payouts: ${settled.payouts.join(", ")}; treasury ${settled.treasuryAmount}`);
  allOk = report("match 1", before1, await balances(), expected1) && allOk;

  // ---- match 2: void ----
  const m2 = base + 2n;
  const before2 = await balances();
  console.log(`match 2 (${m2}) create: ${explorer("tx", await createMatch(program, authority, m2, players.map((p) => p.publicKey)))}`);
  for (const seat of [0, 1]) console.log(`  seat ${seat} join: ${await join(m2, players[seat])}`);
  const voided = await voidMatch(program, authority, m2);
  console.log(`match 2 void: ${explorer("tx", voided.signature)}`);
  console.log(`  refunded seats mask: ${voided.refundedSeatsMask.toString(2).padStart(4, "0")}; refunds ${voided.refunds.join(", ")}`);
  allOk = report("match 2", before2, await balances(), [0n, 0n, 0n, 0n, 0n]) && allOk;

  writeDeployments({
    smokeMatch1: m1.toString(),
    smokeMatch1Settle: settled.signature,
    smokeMatch2: m2.toString(),
    smokeMatch2Void: voided.signature,
  });
  if (!allOk) process.exit(1);
  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
