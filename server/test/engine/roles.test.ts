import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveImpostor } from '../../src/engine/rules.js'

const ids = ['p3', 'p1', 'p4', 'p2']

describe('deriveImpostor', () => {
  it('is sha256(seed) as a big-endian uint32, mod n, over players sorted by playerId', () => {
    const seed = 'ab'.repeat(32)
    const index = createHash('sha256').update(seed, 'hex').digest().readUInt32BE(0) % 4
    expect(deriveImpostor(seed, ids)).toEqual({ ok: true, value: ['p1', 'p2', 'p3', 'p4'][index] })
  })

  it('does not depend on the order players are listed in', () => {
    const seed = '5eed'.repeat(16)
    expect(deriveImpostor(seed, ids)).toEqual(deriveImpostor(seed, [...ids].reverse()))
  })

  it('can select every player', () => {
    const chosen = new Set<string>()
    for (let i = 0; i < 64; i++) {
      const result = deriveImpostor(i.toString(16).padStart(64, '0'), ids)
      if (result.ok) chosen.add(result.value)
    }
    expect([...chosen].sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it.each(['', 'xyz', 'ab'.repeat(31), 'AB'.repeat(32)])('rejects a non-canonical seed %j', (seed) => {
    expect(deriveImpostor(seed, ids)).toEqual({ ok: false, error: 'INVALID_SEED' })
  })

  it('rejects an empty player list', () => {
    expect(deriveImpostor('ab'.repeat(32), [])).toEqual({ ok: false, error: 'NO_PLAYERS' })
  })
})
