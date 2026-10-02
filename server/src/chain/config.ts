import { Keypair, PublicKey } from '@solana/web3.js'
import { err, ok, type Result } from '../engine/result.js'

export type EscrowMode = 'fake' | 'chain'

export type ChainConfig = {
  rpcUrl: string
  programId: PublicKey
  mint: PublicKey
  authority: Keypair
}

// ESCROW_MODE defaults to the fake, so a server started with no environment behaves as it always has.
export function escrowModeFrom(env: NodeJS.ProcessEnv): Result<EscrowMode, string> {
  const mode = env.ESCROW_MODE ?? 'fake'
  return mode === 'fake' || mode === 'chain' ? ok(mode) : err(`ESCROW_MODE must be "fake" or "chain", got "${mode}"`)
}

const publicKey = (name: string, value: string | undefined, problems: string[]): PublicKey | null => {
  if (value === undefined || value === '') {
    problems.push(`${name} is missing`)
    return null
  }
  try {
    return new PublicKey(value)
  } catch {
    problems.push(`${name} is not a valid public key`)
    return null
  }
}

// A JSON array of numbers, the shape `solana-keygen` writes, so it pastes straight into a Render
// secret. The problem messages never echo the value: it is the authority's private key.
const keypair = (name: string, value: string | undefined, problems: string[]): Keypair | null => {
  if (value === undefined || value === '') {
    problems.push(`${name} is missing`)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    problems.push(`${name} is not JSON`)
    return null
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    problems.push(`${name} must be a JSON array of 64 integers from 0 to 255`)
    return null
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]))
  } catch {
    problems.push(`${name} is not a valid ed25519 secret key`)
    return null
  }
}

// Every problem at once rather than the first, so a deploy is fixed in one round trip.
export function chainConfigFrom(env: NodeJS.ProcessEnv): Result<ChainConfig, string[]> {
  const problems: string[] = []

  const rpcUrl = env.RPC_URL
  if (rpcUrl === undefined || rpcUrl === '') problems.push('RPC_URL is missing')
  else if (!/^https?:\/\//.test(rpcUrl) || !URL.canParse(rpcUrl)) problems.push('RPC_URL must be an http(s) URL')

  const programId = publicKey('PROGRAM_ID', env.PROGRAM_ID, problems)
  const mint = publicKey('MINT', env.MINT, problems)
  const authority = keypair('AUTHORITY_SECRET_KEY', env.AUTHORITY_SECRET_KEY, problems)

  if (problems.length > 0 || rpcUrl === undefined || programId === null || mint === null || authority === null) {
    return err(problems)
  }
  return ok({ rpcUrl, programId, mint, authority })
}
