// Script-only plumbing: connection, key files, deployments/devnet.json. Not part of lib.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

export const KEYS_DIR = path.join(__dirname, "keys");
export const DEPLOYMENTS = path.join(__dirname, "..", "deployments", "devnet.json");

export const TREASURY = new PublicKey("8FkaeCdqZmNUjFSLejZQpDgv5f1bzryAVoz7ZTqD7Ddw");
export const DECIMALS = 6;

export function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

/** The deployer: upgrade authority, config admin, mock-mint authority. */
export const deployer = () =>
  loadKeypair(process.env.DEPLOYER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"));
export const serverAuthority = () => loadKeypair(path.join(KEYS_DIR, "authority.json"));
export const testPlayers = () => [0, 1, 2, 3].map((i) => loadKeypair(path.join(KEYS_DIR, `player-${i}.json`)));

export function readDeployments(): Record<string, string> {
  return fs.existsSync(DEPLOYMENTS) ? JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8")) : {};
}

export function writeDeployments(update: Record<string, string>): void {
  const next = { ...readDeployments(), ...update };
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(next, null, 2) + "\n");
}

export function mockMint(): PublicKey {
  const mint = readDeployments().mockMint;
  if (!mint) throw new Error("no mockMint in deployments/devnet.json; run create-mock-mint.ts first");
  return new PublicKey(mint);
}

export const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
