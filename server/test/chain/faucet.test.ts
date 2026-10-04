import { Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  DEVNET_GENESIS_HASH,
  GRANT_LAMPORTS,
  GRANT_WINDOW_MS,
  GRANTS_PER_IP,
  REAL_SKR_MINT,
  openFaucet,
  type Faucet,
  type FaucetChain,
} from '../../src/chain/faucet.js'
import { silentLogger } from '../../src/log.js'

// The faucet's guards and limits against a stub chain. Nothing here opens a connection.

const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const MOCK_MINT = new PublicKey('Ds5SeZQyNdFHQ15v6R2UUqj756u8MWFGE4pf1kwSMWt2')
const BUY_IN = 12_000_000n
const GRANT_TOKENS = 240_000_000n
const FAUCET_KEY = Keypair.generate()

type Stub = FaucetChain & { sent: string[]; balances: Map<string, bigint>; connected: boolean }

function stubChain(overrides: Partial<FaucetChain> = {}): Stub {
  const sent: string[] = []
  const balances = new Map<string, bigint>([[FAUCET_KEY.publicKey.toBase58(), 1_000_000_000_000n]])
  return {
    sent,
    balances,
    connected: false,
    address: FAUCET_KEY.publicKey,
    genesisHash: async () => DEVNET_GENESIS_HASH,
    mintDecimals: async () => 6,
    lamports: async () => 3_000_000_000,
    tokenBalance: async (owner) => balances.get(owner.toBase58()) ?? 0n,
    async send(owner, lamports, tokens) {
      expect(lamports).toBe(GRANT_LAMPORTS)
      expect(tokens).toBe(GRANT_TOKENS)
      sent.push(owner.toBase58())
      return `sig-${sent.length}`
    },
    ...overrides,
  }
}

const ENV = { FAUCET_ENABLED: 'true', FAUCET_SECRET_KEY: JSON.stringify([...FAUCET_KEY.secretKey]) }

async function open(chain: Stub, env: NodeJS.ProcessEnv = ENV, mint = MOCK_MINT, clock = { now: 0 }) {
  return openFaucet({
    env,
    mint,
    buyIn: BUY_IN,
    connect: (key) => {
      expect(key.publicKey.equals(FAUCET_KEY.publicKey)).toBe(true)
      chain.connected = true
      return chain
    },
    logger: silentLogger,
    now: () => clock.now,
  })
}

async function opened(chain: Stub, clock = { now: 0 }): Promise<Faucet> {
  const faucet = await open(chain, ENV, MOCK_MINT, clock)
  if (!faucet.ok) throw new Error(faucet.error)
  return faucet.value
}

const wallet = (): string => Keypair.generate().publicKey.toBase58()

describe('faucet guards', () => {
  it('opens on devnet with the flag on, a mock mint and a faucet key', async () => {
    const faucet = await open(stubChain())
    expect(faucet.ok).toBe(true)
    if (faucet.ok) expect(faucet.value.address).toBe(FAUCET_KEY.publicKey.toBase58())
  })

  it('stays off unless FAUCET_ENABLED is exactly "true", without touching the chain', async () => {
    for (const flag of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      const chain = stubChain()
      const env = { ...ENV, FAUCET_ENABLED: flag }
      const faucet = await open(chain, env)
      expect(faucet, String(flag)).toEqual({ ok: false, error: 'FAUCET_ENABLED is not "true"' })
      expect(chain.connected).toBe(false)
    }
  })

  it('refuses the real SKR mint, without touching the chain', async () => {
    const chain = stubChain()
    expect(await open(chain, ENV, new PublicKey(REAL_SKR_MINT))).toEqual({ ok: false, error: 'MINT is the real SKR mint' })
    expect(chain.connected).toBe(false)
  })

  it('refuses any cluster whose genesis hash is not devnet’s', async () => {
    const faucet = await open(stubChain({ genesisHash: async () => MAINNET_GENESIS_HASH }))
    expect(faucet).toEqual({ ok: false, error: `RPC_URL is not devnet (genesis hash ${MAINNET_GENESIS_HASH})` })
  })

  it('refuses when the genesis hash cannot be read', async () => {
    const faucet = await open(stubChain({ genesisHash: async () => Promise.reject(new Error('429')) }))
    expect(faucet.ok).toBe(false)
    if (!faucet.ok) expect(faucet.error).toContain('429')
  })

  it('refuses a missing or malformed key without echoing it', async () => {
    expect(await open(stubChain(), { FAUCET_ENABLED: 'true' })).toEqual({ ok: false, error: 'FAUCET_SECRET_KEY is missing' })
    const bad = await open(stubChain(), { FAUCET_ENABLED: 'true', FAUCET_SECRET_KEY: '[1,2,3]' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('FAUCET_SECRET_KEY')
  })
})

describe('faucet grants', () => {
  it('grants once and answers with the signature', async () => {
    const chain = stubChain()
    const faucet = await opened(chain)
    const to = wallet()
    expect(await faucet.grant(to, '1.1.1.1')).toEqual({ ok: true, signature: 'sig-1' })
    expect(chain.sent).toEqual([to])
  })

  it('refuses an address that cannot sign, before asking the chain anything', async () => {
    const chain = stubChain({ tokenBalance: async () => Promise.reject(new Error('must not be read')) })
    const faucet = await opened(chain)
    for (const bad of ['', 'nope', '11111111111111111111111111111111', 'GKBdrUgc3VXHeCEkYSS7NzJZyT3yDc7o8QRmykcF5kzM']) {
      expect(await faucet.grant(bad, '1.1.1.1'), bad).toEqual({ ok: false, error: 'INVALID_WALLET' })
    }
    expect(chain.sent).toEqual([])
  })

  it('skips a wallet already holding two buy-ins, and does not count it against any limit', async () => {
    const chain = stubChain()
    const faucet = await opened(chain)
    const rich = wallet()
    const almost = wallet()
    chain.balances.set(rich, 2n * BUY_IN)
    chain.balances.set(almost, 2n * BUY_IN - 1n)
    expect(await faucet.grant(rich, '1.1.1.1')).toEqual({ ok: false, error: 'ALREADY_FUNDED' })
    expect(await faucet.grant(almost, '1.1.1.1')).toEqual({ ok: true, signature: 'sig-1' })
    chain.balances.set(rich, 0n)
    expect((await faucet.grant(rich, '1.1.1.1')).ok).toBe(true)
  })

  it('grants a wallet once per 24 hours', async () => {
    const clock = { now: 0 }
    const faucet = await opened(stubChain(), clock)
    const to = wallet()
    expect((await faucet.grant(to, '1.1.1.1')).ok).toBe(true)
    clock.now = GRANT_WINDOW_MS - 1
    expect(await faucet.grant(to, '2.2.2.2')).toEqual({ ok: false, error: 'RATE_LIMITED' })
    clock.now = GRANT_WINDOW_MS
    expect((await faucet.grant(to, '2.2.2.2')).ok).toBe(true)
  })

  it('limits grants per IP per 24 hours, other IPs unaffected', async () => {
    const clock = { now: 0 }
    const faucet = await opened(stubChain(), clock)
    for (let n = 0; n < GRANTS_PER_IP; n++) expect((await faucet.grant(wallet(), '1.1.1.1')).ok).toBe(true)
    expect(await faucet.grant(wallet(), '1.1.1.1')).toEqual({ ok: false, error: 'RATE_LIMITED' })
    expect((await faucet.grant(wallet(), '2.2.2.2')).ok).toBe(true)
    clock.now = GRANT_WINDOW_MS
    expect((await faucet.grant(wallet(), '1.1.1.1')).ok).toBe(true)
  })

  it('grants a wallet once when two requests race for it', async () => {
    const chain = stubChain()
    const faucet = await opened(chain)
    const to = wallet()
    const results = await Promise.all([faucet.grant(to, '1.1.1.1'), faucet.grant(to, '2.2.2.2')])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results).toContainEqual({ ok: false, error: 'RATE_LIMITED' })
    expect(chain.sent).toEqual([to])
  })

  it('reports FAUCET_EMPTY when it is short of SOL or tokens', async () => {
    const poor = await opened(stubChain({ lamports: async () => GRANT_LAMPORTS }))
    expect(await poor.grant(wallet(), '1.1.1.1')).toEqual({ ok: false, error: 'FAUCET_EMPTY' })
    const chain = stubChain()
    chain.balances.set(FAUCET_KEY.publicKey.toBase58(), GRANT_TOKENS - 1n)
    const dry = await opened(chain)
    expect(await dry.grant(wallet(), '1.1.1.1')).toEqual({ ok: false, error: 'FAUCET_EMPTY' })
    expect(chain.sent).toEqual([])
  })

  it('reports CHAIN_ERROR when the send fails, and lets the wallet retry', async () => {
    let failing = true
    const chain = stubChain()
    const send = chain.send
    chain.send = async (owner, lamports, tokens) => (failing ? Promise.reject(new Error('blockhash not found')) : send(owner, lamports, tokens))
    const faucet = await opened(chain)
    const to = wallet()
    expect(await faucet.grant(to, '1.1.1.1')).toEqual({ ok: false, error: 'CHAIN_ERROR' })
    failing = false
    expect(await faucet.grant(to, '1.1.1.1')).toEqual({ ok: true, signature: 'sig-1' })
  })
})
