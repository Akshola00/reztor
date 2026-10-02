import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { MVP_CONFIG, type MatchConfig } from '../../src/engine/config.js'
import { ok } from '../../src/engine/result.js'
import type { Settlement } from '../../src/engine/settlement.js'
import type { LogFields, Logger } from '../../src/log.js'
import { inMemoryEscrow, type EscrowProvider } from '../../src/match/escrow.js'
import { TICK_MS } from '../../src/match/tick.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'

// After MATCH_END: the chain's receipt goes to the room as SETTLEMENT_CONFIRMED, and a chain that
// paid anything other than the server's numbers is logged loudly. The provider stands in for the
// chain's settle; funding is the fake's, so the match starts on the fourth seat.

const FAST: MatchConfig = {
  ...MVP_CONFIG,
  laneCapacity: 100,
  winTarget: 150,
  stageDurations: { tap: 2, chat: 1, vote: 1 },
  buyInSkr: 1,
  creditsPerSkr: 100,
}

const RATE = 10_000n

type Confirmed = { matchId: string; serverTick: number; signature: string; payouts: string[] }
type Line = { level: string; message: string; fields: LogFields }

let server: GameServer | null = null
const sockets: ClientSocket[] = []

afterEach(async () => {
  for (const socket of sockets) socket.disconnect()
  sockets.length = 0
  await server?.close()
  server = null
})

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function chainSettle(skew: bigint): { provider: EscrowProvider; settled: Settlement[] } {
  const settled: Settlement[] = []
  const provider: EscrowProvider = {
    ...inMemoryEscrow(),
    async settle(_matchId, settlement) {
      settled.push(settlement)
      const payouts = settlement.lines.map((line, seat) => BigInt(line.refund + line.payout) * RATE + (seat === 0 ? skew : 0n))
      return ok({ signature: 'settle-signature', payouts, baseUnitsPerCredit: RATE })
    },
  }
  return { provider, settled }
}

async function playToTheEnd(escrow: EscrowProvider, log: Line[]): Promise<{ ends: unknown[][]; confirmed: Confirmed[][] }> {
  let clock = 0
  const logger: Logger = (level, message, fields = {}) => void log.push({ level, message, fields })
  server = createGameServer({ config: FAST, escrow, logger, now: () => clock })
  const port = await server.listen(0)
  server.loop.stop()

  const ends: unknown[][] = []
  const confirmed: Confirmed[][] = []
  let code = ''
  let matchId = ''
  for (const [index, name] of ['Ada', 'Bo', 'Cy', 'Dee'].entries()) {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true })
    sockets.push(socket)
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    const inbox: { end: unknown[]; confirmed: Confirmed[] } = { end: [], confirmed: [] }
    socket.on('MATCH_END', (payload: unknown) => void inbox.end.push(payload))
    socket.on('SETTLEMENT_CONFIRMED', (payload: Confirmed) => void inbox.confirmed.push(payload))
    ends.push(inbox.end)
    confirmed.push(inbox.confirmed)
    const ack = (await socket.emitWithAck(index === 0 ? 'CREATE_LOBBY' : 'JOIN_LOBBY', index === 0 ? { name } : { code, name })) as {
      ticket: { code: string; matchId: string; sessionToken: string }
    }
    ;({ code, matchId } = ack.ticket)
    await socket.emitWithAck('JOIN', { matchId, sessionToken: ack.ticket.sessionToken })
  }

  for (let step = 0; step < 200; step++) {
    const match = server.registry.get(matchId)
    if (match === undefined || match.state.resolution !== null) break
    for (const socket of sockets) {
      if (match.state.stage === 'tap') socket.emit('TAP_BATCH', { tier: 1, count: 6, clientTs: 0 })
      else if (match.state.stage === 'vote') socket.emit('VOTE', { target: 'skip' })
    }
    await delay(10)
    clock += TICK_MS
    server.loop.runOnce(clock)
  }
  await delay(50)
  return { ends, confirmed }
}

describe('settlement confirmation', () => {
  it('sends MATCH_END, then SETTLEMENT_CONFIRMED with the chain signature and per-seat payouts', async () => {
    const chain = chainSettle(0n)
    const log: Line[] = []
    const { ends, confirmed } = await playToTheEnd(chain.provider, log)

    const [settlement] = chain.settled
    expect(settlement).toBeDefined()
    for (const [seat, received] of confirmed.entries()) {
      expect(ends[seat], 'MATCH_END first, as before').toHaveLength(1)
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({
        signature: 'settle-signature',
        payouts: settlement?.lines.map((line) => String(BigInt(line.refund + line.payout) * RATE)),
      })
    }
    expect(log.filter((line) => line.message.includes('DIFFER'))).toEqual([])
  }, 30_000)

  it('logs loudly when the chain paid something other than the server settlement', async () => {
    const log: Line[] = []
    await playToTheEnd(chainSettle(1n).provider, log)
    const loud = log.filter((line) => line.message === 'CHAIN PAYOUTS DIFFER FROM THE SERVER SETTLEMENT')
    expect(loud).toHaveLength(1)
    expect(loud[0]?.level).toBe('error')
    expect(loud[0]?.fields.signature).toBe('settle-signature')
  }, 30_000)

  it('sends no SETTLEMENT_CONFIRMED with the fake, which signs nothing', async () => {
    const { ends, confirmed } = await playToTheEnd(inMemoryEscrow(), [])
    for (const [seat, received] of confirmed.entries()) {
      expect(ends[seat]).toHaveLength(1)
      expect(received).toEqual([])
    }
  }, 30_000)
})
