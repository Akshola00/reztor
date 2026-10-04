import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  unpackAccount,
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
import { err, ok, type Result } from '../engine/result.js'
import type { Logger } from '../log.js'
import { tokenProgramOf } from './client.js'
import { keypair } from './config.js'
import { isWalletAddress } from './escrow.js'

// Devnet only. A grant of devnet SOL and mock SKR so a playtester can sit down without asking
// anyone for tokens. Everything here exists to make sure it can never hand out anything real.

export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const REAL_SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'

export const GRANT_LAMPORTS = LAMPORTS_PER_SOL / 20
export const GRANT_WHOLE_TOKENS = 240n
// Above the grant: the faucet also pays the fee and, for a new wallet, the ATA's rent.
const LAMPORT_MARGIN = LAMPORTS_PER_SOL / 100

export const GRANT_WINDOW_MS = 24 * 60 * 60 * 1000
// Generous, because a playtest is four phones on one Wi-Fi behind one address.
export const GRANTS_PER_IP = 10

export type FaucetError =
  | 'FAUCET_DISABLED'
  | 'RATE_LIMITED'
  | 'ALREADY_FUNDED'
  | 'INVALID_WALLET'
  | 'FAUCET_EMPTY'
  | 'CHAIN_ERROR'

export type FaucetResponse = { ok: true; signature: string } | { ok: false; error: FaucetError }

// What the faucet needs from the chain, so the guards and limits are tested without one.
export type FaucetChain = {
  address: PublicKey
  genesisHash(): Promise<string>
  mintDecimals(): Promise<number>
  lamports(owner: PublicKey): Promise<number>
  // In the mint's base units; 0 when the owner has no associated token account.
  tokenBalance(owner: PublicKey): Promise<bigint>
  // SOL, the owner's ATA if it is missing, and the tokens, in one transaction.
  send(owner: PublicKey, lamports: number, tokens: bigint): Promise<string>
}

export type Faucet = {
  address: string
  grant(wallet: string, ip: string): Promise<FaucetResponse>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export type FaucetOptions = {
  env: NodeJS.ProcessEnv
  mint: PublicKey
  buyIn: bigint
  connect(faucet: Keypair): FaucetChain
  logger: Logger
  now?: () => number
}

// The guards, cheapest first. Any one failing leaves the server running with no faucet, so
// /faucet answers FAUCET_DISABLED.
export async function openFaucet(options: FaucetOptions): Promise<Result<Faucet, string>> {
  const { env, mint } = options
  if (env.FAUCET_ENABLED !== 'true') return err('FAUCET_ENABLED is not "true"')
  if (mint.toBase58() === REAL_SKR_MINT) return err('MINT is the real SKR mint')

  const problems: string[] = []
  const key = keypair('FAUCET_SECRET_KEY', env.FAUCET_SECRET_KEY, problems)
  if (key === null) return err(problems.join('; '))

  const chain = options.connect(key)
  let genesis: string
  let decimals: number
  try {
    genesis = await chain.genesisHash()
    decimals = await chain.mintDecimals()
  } catch (error) {
    return err(`could not read the cluster or the mint: ${message(error)}`)
  }
  if (genesis !== DEVNET_GENESIS_HASH) return err(`RPC_URL is not devnet (genesis hash ${genesis})`)

  return ok(createFaucet(chain, options.buyIn, GRANT_WHOLE_TOKENS * 10n ** BigInt(decimals), options.logger, options.now))
}

function createFaucet(chain: FaucetChain, buyIn: bigint, grantTokens: bigint, logger: Logger, now = () => Date.now()): Faucet {
  // In memory: a restart forgets every grant, which on devnet costs nothing worth a table.
  const lastGrant = new Map<string, number>()
  const grantsByIp = new Map<string, number[]>()

  const attempt = async (owner: PublicKey): Promise<FaucetResponse> => {
    const fields = { wallet: owner.toBase58() }
    try {
      if ((await chain.tokenBalance(owner)) >= 2n * buyIn) return { ok: false, error: 'ALREADY_FUNDED' }
      const [lamports, tokens] = await Promise.all([chain.lamports(chain.address), chain.tokenBalance(chain.address)])
      if (lamports < GRANT_LAMPORTS + LAMPORT_MARGIN || tokens < grantTokens) {
        logger('error', 'faucet is empty', { ...fields, faucet: chain.address.toBase58(), lamports, tokens: String(tokens) })
        return { ok: false, error: 'FAUCET_EMPTY' }
      }
      const signature = await chain.send(owner, GRANT_LAMPORTS, grantTokens)
      logger('info', 'faucet grant', { ...fields, signature })
      return { ok: true, signature }
    } catch (error) {
      logger('warn', 'faucet grant failed', { ...fields, error: message(error) })
      return { ok: false, error: 'CHAIN_ERROR' }
    }
  }

  return {
    address: chain.address.toBase58(),

    async grant(wallet, ip) {
      if (!isWalletAddress(wallet)) return { ok: false, error: 'INVALID_WALLET' }
      const at = now()
      const fresh = (time: number): boolean => at - time < GRANT_WINDOW_MS
      const previous = lastGrant.get(wallet)
      const fromIp = (grantsByIp.get(ip) ?? []).filter(fresh)
      if ((previous !== undefined && fresh(previous)) || fromIp.length >= GRANTS_PER_IP) {
        return { ok: false, error: 'RATE_LIMITED' }
      }

      // Reserved before the chain is asked anything, so two requests racing for one wallet cannot
      // both be granted. Handed back on any refusal: a grant that failed yet landed is caught by
      // ALREADY_FUNDED on the retry, since one grant is far more than two buy-ins.
      lastGrant.set(wallet, at)
      grantsByIp.set(ip, [...fromIp, at])
      const result = await attempt(new PublicKey(wallet))
      if (!result.ok) {
        if (previous === undefined) lastGrant.delete(wallet)
        else lastGrant.set(wallet, previous)
        const reserved = grantsByIp.get(ip) ?? []
        reserved.splice(reserved.indexOf(at), 1)
      }
      return result
    },
  }
}

export function chainFaucet(connection: Connection, faucet: Keypair, mint: PublicKey): FaucetChain {
  const tokenProgram = (): Promise<PublicKey> => tokenProgramOf(connection, mint)
  const ataOf = async (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, await tokenProgram())

  return {
    address: faucet.publicKey,
    genesisHash: () => connection.getGenesisHash(),
    mintDecimals: async () => (await getMint(connection, mint, 'confirmed', await tokenProgram())).decimals,
    lamports: (owner) => connection.getBalance(owner, 'confirmed'),
    async tokenBalance(owner) {
      const ata = await ataOf(owner)
      const info = await connection.getAccountInfo(ata, 'confirmed')
      return info === null ? 0n : unpackAccount(ata, info, info.owner).amount
    },
    async send(owner, lamports, tokens) {
      const program = await tokenProgram()
      const source = getAssociatedTokenAddressSync(mint, faucet.publicKey, false, program)
      const destination = getAssociatedTokenAddressSync(mint, owner, false, program)
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: owner, lamports }),
        createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, destination, owner, mint, program),
        createTransferInstruction(source, destination, faucet.publicKey, tokens, [], program),
      )
      return sendAndConfirmTransaction(connection, tx, [faucet], { commitment: 'confirmed' })
    },
  }
}
