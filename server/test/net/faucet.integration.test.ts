import { Keypair } from '@solana/web3.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { Faucet } from '../../src/chain/faucet.js'
import { silentLogger } from '../../src/log.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'

// The HTTP wiring only: the guards and limits are covered in test/chain/faucet.test.ts.

let server: GameServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start(faucet?: Faucet): Promise<string> {
  server = createGameServer({ logger: silentLogger, ...(faucet === undefined ? {} : { faucet }) })
  return `http://127.0.0.1:${await server.listen(0)}/faucet`
}

const post = async (url: string, body: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
  return { status: response.status, body: (await response.json()) as unknown }
}

describe('POST /faucet', () => {
  it('answers FAUCET_DISABLED when no faucet is running', async () => {
    const url = await start()
    expect(await post(url, JSON.stringify({ wallet: Keypair.generate().publicKey.toBase58() }))).toEqual({
      status: 503,
      body: { ok: false, error: 'FAUCET_DISABLED' },
    })
  })

  it('passes the wallet and the proxy-appended client IP to the faucet', async () => {
    const calls: [string, string][] = []
    const url = await start({
      address: 'faucet',
      grant: async (wallet, ip) => {
        calls.push([wallet, ip])
        return calls.length === 1 ? { ok: true, signature: 'sig' } : { ok: false, error: 'RATE_LIMITED' }
      },
    })
    const to = Keypair.generate().publicKey.toBase58()
    expect(await post(url, JSON.stringify({ wallet: to }), { 'x-forwarded-for': '6.6.6.6, 9.9.9.9' })).toEqual({
      status: 200,
      body: { ok: true, signature: 'sig' },
    })
    expect(await post(url, JSON.stringify({ wallet: to }))).toEqual({ status: 429, body: { ok: false, error: 'RATE_LIMITED' } })
    expect(calls[0]).toEqual([to, '9.9.9.9'])
    expect(calls[1]?.[1]).toMatch(/127\.0\.0\.1/)
  })

  it('refuses a malformed body as INVALID_WALLET without reaching the faucet', async () => {
    const url = await start({ address: 'faucet', grant: () => Promise.reject(new Error('must not be called')) })
    for (const body of ['not json', '{}', JSON.stringify({ wallet: 7 }), JSON.stringify({ wallet: 'a', extra: 1 }), 'x'.repeat(2000)]) {
      expect(await post(url, body), body.slice(0, 20)).toEqual({ status: 400, body: { ok: false, error: 'INVALID_WALLET' } })
    }
  })
})
