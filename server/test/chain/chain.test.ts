import { Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { chainConfigFrom, escrowModeFrom } from '../../src/chain/config.js'
import { isWalletAddress, settleArgs } from '../../src/chain/escrow.js'
import type { Settlement } from '../../src/engine/settlement.js'

// The chain module's pure parts. Nothing here opens a connection.

describe('ESCROW_MODE', () => {
  it('defaults to the fake and accepts only fake or chain', () => {
    expect(escrowModeFrom({})).toEqual({ ok: true, value: 'fake' })
    expect(escrowModeFrom({ ESCROW_MODE: 'chain' })).toEqual({ ok: true, value: 'chain' })
    expect(escrowModeFrom({ ESCROW_MODE: 'devnet' }).ok).toBe(false)
  })
})

describe('chain config from the environment', () => {
  const authority = Keypair.generate()
  const valid = {
    RPC_URL: 'https://api.devnet.solana.com',
    PROGRAM_ID: '4hAFR3JFKmE5GkJFDSVUHB1LwcsZkQBszCq9kwFu5MHZ',
    MINT: 'Ds5SeZQyNdFHQ15v6R2UUqj756u8MWFGE4pf1kwSMWt2',
    AUTHORITY_SECRET_KEY: JSON.stringify([...authority.secretKey]),
  }

  it('parses a complete config, keypair included', () => {
    const config = chainConfigFrom(valid)
    expect(config.ok).toBe(true)
    if (config.ok) {
      expect(config.value.authority.publicKey.equals(authority.publicKey)).toBe(true)
      expect(config.value.programId.toBase58()).toBe(valid.PROGRAM_ID)
    }
  })

  it('reports every missing variable at once', () => {
    expect(chainConfigFrom({})).toEqual({
      ok: false,
      error: ['RPC_URL is missing', 'PROGRAM_ID is missing', 'MINT is missing', 'AUTHORITY_SECRET_KEY is missing'],
    })
  })

  it('refuses malformed values without echoing the secret key', () => {
    for (const [field, value] of [
      ['RPC_URL', 'devnet'],
      ['PROGRAM_ID', 'not-a-key'],
      ['MINT', '123'],
      ['AUTHORITY_SECRET_KEY', 'not json'],
      ['AUTHORITY_SECRET_KEY', '[1,2,3]'],
      ['AUTHORITY_SECRET_KEY', JSON.stringify(Array(64).fill(256))],
      ['AUTHORITY_SECRET_KEY', JSON.stringify({ key: [...authority.secretKey] })],
    ] as const) {
      const config = chainConfigFrom({ ...valid, [field]: value })
      expect(config.ok, `${field}=${value}`).toBe(false)
      if (!config.ok) {
        expect(config.error).toHaveLength(1)
        expect(config.error[0]).toContain(field)
        expect(config.error.join()).not.toContain(String(authority.secretKey[0]) + ',')
      }
    }
  })
})

describe('wallet addresses', () => {
  it('accepts a signing key and refuses anything that cannot sign', () => {
    expect(isWalletAddress(Keypair.generate().publicKey.toBase58())).toBe(true)
    expect(isWalletAddress('11111111111111111111111111111111')).toBe(false)
    expect(isWalletAddress('GKBdrUgc3VXHeCEkYSS7NzJZyT3yDc7o8QRmykcF5kzM')).toBe(false) // the config PDA
    expect(isWalletAddress('nope')).toBe(false)
  })
})

describe('settle_match arguments', () => {
  const seats = ['p_a', 'p_b', 'p_c', 'p_d'].map((playerId) => ({ playerId, wallet: null }))
  const settlement = (order: string[], winners: string[]): Settlement => ({
    matchId: 'm',
    resolution: { kind: 'won', winner: 'crew', reason: 'BOARD_TARGET', tick: 10 },
    escrowCredits: 4800,
    potCredits: 1200,
    rakeBps: 0,
    rakeCredits: 0,
    dustCredits: 0,
    winners,
    lines: order.map((playerId, index) => ({ playerId, spent: 100 * (index + 1), refund: 1200 - 100 * (index + 1), payout: 0 })),
  })

  it('maps unspent credits and winners into seat order, whatever order the lines are in', () => {
    // Lines deliberately not in seat order: p_c spent 100, p_a 200, p_d 300, p_b 400.
    const result = settleArgs(settlement(['p_c', 'p_a', 'p_d', 'p_b'], ['p_a', 'p_c', 'p_d']), seats)
    expect(result).toEqual({ ok: true, value: { unspentCredits: [1000, 800, 1100, 900], winnersMask: 0b1101 } })
  })

  it('refuses a settlement whose players are not the seats the match was opened with', () => {
    expect(settleArgs(settlement(['p_a', 'p_b', 'p_c', 'p_x'], ['p_a']), seats)).toEqual({ ok: false, error: 'SEAT_MISMATCH' })
    expect(settleArgs(settlement(['p_a', 'p_b', 'p_c'], ['p_a']), seats)).toEqual({ ok: false, error: 'SEAT_MISMATCH' })
  })
})
