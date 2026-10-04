// LOCAL USE ONLY. Creates the devnet faucet's keypair and fills it from the deployer.
//
//   RPC_URL=... MINT=<mock mint> pnpm seed:faucet
//
// Reads the deployer key (~/.config/solana/id.json, or DEPLOYER_KEYPAIR), which is the mock mint's
// authority. That key never goes near the server: the server only ever sees FAUCET_SECRET_KEY.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { DEVNET_GENESIS_HASH, REAL_SKR_MINT } from '../src/chain/faucet.js'

const MINT_WHOLE_TOKENS = 1_000_000n
const SOL = 3

const KEYS_DIR = new URL('../keys/', import.meta.url)
const FAUCET_FILE = new URL('faucet.json', KEYS_DIR)

const explorer = (signature: string): string => `https://explorer.solana.com/tx/${signature}?cluster=devnet`
const load = (file: string | URL): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[]))

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
  if (process.env.MINT === undefined) throw new Error('MINT is required: the mock SKR mint')
  const mint = new PublicKey(process.env.MINT)
  if (mint.toBase58() === REAL_SKR_MINT) throw new Error('MINT is the real SKR mint; refusing')

  const connection = new Connection(rpcUrl, 'confirmed')
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS_HASH) throw new Error('RPC_URL is not devnet; refusing')

  if (!existsSync(FAUCET_FILE)) {
    mkdirSync(KEYS_DIR, { recursive: true })
    writeFileSync(FAUCET_FILE, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 })
    console.log('faucet keypair: created server/keys/faucet.json')
  } else {
    console.log('faucet keypair: exists, kept')
  }
  const faucet = load(FAUCET_FILE)
  const deployer = load(process.env.DEPLOYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`)

  const mintInfo = await connection.getAccountInfo(mint)
  if (mintInfo === null) throw new Error(`mint ${mint.toBase58()} not found`)
  const tokenProgram = mintInfo.owner
  const { decimals, mintAuthority } = await getMint(connection, mint, 'confirmed', tokenProgram)
  if (mintAuthority === null || !mintAuthority.equals(deployer.publicKey)) {
    throw new Error(`the deployer ${deployer.publicKey.toBase58()} is not the mint authority`)
  }

  const ata = getAssociatedTokenAddressSync(mint, faucet.publicKey, false, tokenProgram)
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: faucet.publicKey, lamports: SOL * LAMPORTS_PER_SOL }),
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, ata, faucet.publicKey, mint, tokenProgram),
    createMintToCheckedInstruction(mint, ata, deployer.publicKey, MINT_WHOLE_TOKENS * 10n ** BigInt(decimals), decimals, [], tokenProgram),
  )
  const signature = await sendAndConfirmTransaction(connection, tx, [deployer], { commitment: 'confirmed' })
  console.log(`seeded: +${SOL} SOL, +${MINT_WHOLE_TOKENS} mock SKR  ${explorer(signature)}`)

  const [lamports, tokens] = await Promise.all([
    connection.getBalance(faucet.publicKey, 'confirmed'),
    connection.getTokenAccountBalance(ata, 'confirmed'),
  ])
  console.log(`faucet balance: ${lamports / LAMPORTS_PER_SOL} SOL, ${tokens.value.uiAmountString} mock SKR`)
  console.log(`faucet pubkey: ${faucet.publicKey.toBase58()}`)
  console.log('FAUCET_SECRET_KEY for Render (one line, keep it secret):')
  console.log(readFileSync(FAUCET_FILE, 'utf8').trim())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
