// Creates scripts/keys/authority.json and player-0..3.json. Never overwrites an existing key.
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { KEYS_DIR } from "./common";

fs.mkdirSync(KEYS_DIR, { recursive: true });
for (const name of ["authority", "player-0", "player-1", "player-2", "player-3"]) {
  const file = path.join(KEYS_DIR, `${name}.json`);
  if (fs.existsSync(file)) {
    console.log(`${name}: exists, kept`);
    continue;
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`${name}: ${kp.publicKey.toBase58()}`);
}
