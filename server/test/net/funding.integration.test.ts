import { Keypair } from '@solana/web3.js'
import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { isWalletAddress } from '../../src/chain/escrow.js'
import { err, ok, type Result } from '../../src/engine/result.js'
import type { PlayerId } from '../../src/engine/state.js'
import { silentLogger } from '../../src/log.js'
import type { EscrowError, EscrowProvider } from '../../src/match/escrow.js'
import { STAKE_TIMEOUT_MS } from '../../src/match/lobby.js'
import { createGameServer, type GameServer, type ServerOptions } from '../../src/net/server.js'

// The funding stage with a provider that, like the chain, needs every player to sign. The test is
// the chain: it decides when each stake lands, when funding ends, and when a void completes.

type StakeRequest = { matchId: string; serverTick: null; tx: string; expiresAt: number; serverNow: number }
type StakeUpdate = { matchId: string; serverTick: null; staked: number[] }
type Dissolved = { matchId: string; serverTick: null; code: string; reason: string }

type Signing = {
  provider: EscrowProvider
  calls: string[]
  // Reports these players as paid, as the chain's joined mask would.
  stake(...playerIds: PlayerId[]): void
  finish(result: Result<void, EscrowError>): void
  // Holds every void until released, so the test can see what happens before one completes.
  holdVoids(): () => void
}

function signingEscrow(overrides: Partial<EscrowProvider> = {}): Signing {
  const calls: string[] = []
  let built = 0
  let onStaked: ((staked: PlayerId[]) => void) | undefined
  let resolveFunded: ((result: Result<void, EscrowError>) => void) | undefined
  let gate: Promise<void> | null = null

  const provider: EscrowProvider = {
    async open() {
      calls.push('open')
      return ok({ chainMatchId: 42n })
    },
    async joinTxFor(_matchId, wallet) {
      built += 1
      calls.push(`joinTxFor ${wallet}`)
      return ok(`tx#${built}:${wallet}`)
    },
    awaitFunded(_matchId, timeoutMs, report) {
      calls.push(`awaitFunded ${timeoutMs}`)
      onStaked = report
      return new Promise((resolve) => (resolveFunded = resolve))
    },
    async settle() {
      return err('UNKNOWN_MATCH')
    },
    async void(_matchId, reason) {
      calls.push(`void ${reason}`)
      if (gate !== null) await gate
      calls.push('voided')
      return ok({ signature: 'void-signature' })
    },
    ...overrides,
  }

  return {
    provider,
    calls,
    stake: (...playerIds) => onStaked?.(playerIds),
    finish: (result) => resolveFunded?.(result),
    holdVoids: () => {
      let release = (): void => {}
      gate = new Promise((resolve) => (release = resolve))
      return () => {
        gate = null
        release()
      }
    },
  }
}

const EVENTS = ['LOBBY_UPDATE', 'LOBBY_DISSOLVED', 'STAKE_REQUEST', 'STAKE_UPDATE', 'MATCH_STARTED']

type Seat = {
  socket: ClientSocket
  wallet: string
  code: string
  matchId: string
  playerId: string
  sessionToken: string
  started: boolean
  inbox: Map<string, unknown[]>
}

let server: GameServer | null = null
const sockets: ClientSocket[] = []
let clock = 1_000_000

afterEach(async () => {
  for (const socket of sockets) socket.disconnect()
  sockets.length = 0
  await server?.close()
  server = null
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

const funded: ServerOptions['wallets'] = { isAddress: isWalletAddress, isFunded: async () => true }

async function start(escrow: EscrowProvider | undefined, wallets = funded): Promise<number> {
  clock = 1_000_000
  server = createGameServer({
    logger: silentLogger,
    now: () => clock,
    ...(escrow === undefined ? {} : { escrow }),
    ...(wallets === undefined ? {} : { wallets }),
  })
  const port = await server.listen(0)
  server.loop.stop()
  return port
}

async function open(port: number): Promise<{ socket: ClientSocket; inbox: Map<string, unknown[]> }> {
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  const inbox = new Map<string, unknown[]>(EVENTS.map((event) => [event, []]))
  for (const event of EVENTS) socket.on(event, (payload: unknown) => void inbox.get(event)?.push(payload))
  return { socket, inbox }
}

async function sit(port: number, name: string, code?: string): Promise<Seat> {
  const { socket, inbox } = await open(port)
  const wallet = Keypair.generate().publicKey.toBase58()
  const ack = (await socket.emitWithAck(code === undefined ? 'CREATE_LOBBY' : 'JOIN_LOBBY', {
    ...(code === undefined ? {} : { code }),
    name,
    wallet,
  })) as { ok: boolean; error?: string; ticket: Omit<Seat, 'socket' | 'wallet' | 'inbox'> }
  expect(ack, `${name} was seated`).toMatchObject({ ok: true })
  await socket.emitWithAck('JOIN', { matchId: ack.ticket.matchId, sessionToken: ack.ticket.sessionToken })
  await settle()
  return { socket, wallet, inbox, ...ack.ticket }
}

async function fill(port: number): Promise<Seat[]> {
  const ada = await sit(port, 'Ada')
  return [ada, await sit(port, 'Bo', ada.code), await sit(port, 'Cy', ada.code), await sit(port, 'Dee', ada.code)]
}

const of = <T>(seat: Seat, event: string): T[] => (seat.inbox.get(event) ?? []) as T[]

describe('funding stage, with a provider that needs every seat to sign', () => {
  it('sends each seat its own STAKE_REQUEST, and starts the match only once all four have staked', async () => {
    const chain = signingEscrow()
    const seats = await fill(await start(chain.provider))

    // The fourth ack no longer means the match started: it means funding began.
    expect(seats.map((seat) => seat.started)).toEqual([false, false, false, false])

    for (const seat of seats) {
      const requests = of<StakeRequest>(seat, 'STAKE_REQUEST')
      expect(requests, 'one STAKE_REQUEST per seat').toHaveLength(1)
      const [request] = requests
      // Private: each seat's transaction names its own wallet and nobody else's.
      expect(request?.tx).toContain(seat.wallet)
      for (const other of seats) if (other !== seat) expect(request?.tx).not.toContain(other.wallet)
      expect(request).toMatchObject({ matchId: seat.matchId, serverTick: null })
      expect((request?.expiresAt ?? 0) - (request?.serverNow ?? 0)).toBe(STAKE_TIMEOUT_MS)
    }
    expect(chain.calls).toContain(`awaitFunded ${STAKE_TIMEOUT_MS}`)

    const [ada, bo, cy] = seats as [Seat, Seat, Seat, Seat]
    chain.stake(ada.playerId)
    await settle()
    chain.stake(ada.playerId, bo.playerId, cy.playerId)
    await settle()

    for (const [index, seat] of seats.entries()) {
      // The fourth player JOINed after funding began, so they also got the state of play then.
      const snapshot = index === 3 ? [[]] : []
      expect(of<StakeUpdate>(seat, 'STAKE_UPDATE').map((update) => update.staked)).toEqual([...snapshot, [1], [1, 2, 3]])
      expect(of(seat, 'MATCH_STARTED'), 'no match before the fourth stake').toEqual([])
    }
    expect(server?.registry.get(ada.matchId)).toBeUndefined()

    chain.finish(ok(undefined))
    await settle()

    for (const seat of seats) expect(of(seat, 'MATCH_STARTED')).toHaveLength(1)
    expect(server?.registry.get(ada.matchId)?.state.phase).toBe('IN_PROGRESS')
    expect(chain.calls.filter((call) => call.startsWith('void'))).toEqual([])
  }, 30_000)

  it('gives a player who JOINs mid-funding a fresh transaction, and none once their seat has paid', async () => {
    const chain = signingEscrow()
    const port = await start(chain.provider)
    const seats = await fill(port)
    const bo = seats[1] as Seat
    chain.stake((seats[0] as Seat).playerId)
    await settle()

    const again = await open(port)
    await again.socket.emitWithAck('JOIN', { matchId: bo.matchId, sessionToken: bo.sessionToken })
    await settle()
    const [fresh] = again.inbox.get('STAKE_REQUEST') as StakeRequest[]
    const [first] = of<StakeRequest>(bo, 'STAKE_REQUEST')
    expect(fresh?.tx).toContain(bo.wallet)
    expect(fresh?.tx).not.toBe(first?.tx)
    expect(fresh?.expiresAt).toBe(first?.expiresAt)
    expect(again.inbox.get('STAKE_UPDATE')).toMatchObject([{ staked: [1] }])

    chain.stake((seats[0] as Seat).playerId, bo.playerId)
    await settle()
    const paid = await open(port)
    await paid.socket.emitWithAck('JOIN', { matchId: bo.matchId, sessionToken: bo.sessionToken })
    await settle()
    expect(paid.inbox.get('STAKE_REQUEST')).toEqual([])
    expect(paid.inbox.get('STAKE_UPDATE')).toMatchObject([{ staked: [1, 2] }])
  }, 30_000)

  it('on a funding timeout voids on chain first, then dissolves with STAKE_TIMEOUT', async () => {
    const chain = signingEscrow()
    const port = await start(chain.provider)
    const seats = await fill(port)
    chain.stake((seats[0] as Seat).playerId, (seats[1] as Seat).playerId)
    await settle()

    const release = chain.holdVoids()
    chain.finish(err('FUNDING_TIMEOUT'))
    await settle()
    // The refund is under way and nobody has been told the lobby is gone yet.
    expect(chain.calls).toContain('void STAKE_TIMEOUT')
    expect(chain.calls).not.toContain('voided')
    for (const seat of seats) expect(of(seat, 'LOBBY_DISSOLVED')).toEqual([])

    release()
    await settle()
    for (const seat of seats) {
      expect(of<Dissolved>(seat, 'LOBBY_DISSOLVED')).toEqual([
        { matchId: seat.matchId, serverTick: null, code: seat.code, reason: 'STAKE_TIMEOUT' },
      ])
      expect(of(seat, 'MATCH_STARTED')).toEqual([])
    }
    const ada = seats[0] as Seat
    const late = await open(port)
    expect(await late.socket.emitWithAck('JOIN', { matchId: ada.matchId, sessionToken: ada.sessionToken })).toEqual({
      ok: false,
      error: 'UNKNOWN_SESSION',
    })
  }, 30_000)

  it('does not dissolve a funding lobby on the fill timeout', async () => {
    const chain = signingEscrow()
    const port = await start(chain.provider)
    const ada = await sit(port, 'Ada')
    clock += 55_000
    await sit(port, 'Bo', ada.code)
    await sit(port, 'Cy', ada.code)
    await sit(port, 'Dee', ada.code)

    clock += 10_000
    server?.loop.runOnce(clock)
    await settle()
    expect(of(ada, 'LOBBY_DISSOLVED')).toEqual([])
    expect(chain.calls.filter((call) => call.startsWith('void'))).toEqual([])
  }, 30_000)

  it('does not hang the lobby when the provider throws while funding', async () => {
    const chain = signingEscrow({
      awaitFunded: async () => {
        throw new Error('rpc exploded')
      },
    })
    const seats = await fill(await start(chain.provider))
    await settle()
    // Funding failed before the fourth player's JOIN, so the three already in the room are told and
    // the fourth finds their session gone, which sends them back to the entry screen just the same.
    for (const seat of seats.slice(0, 3)) {
      expect(of(seat, 'LOBBY_DISSOLVED')).toMatchObject([{ reason: 'STAKE_TIMEOUT' }])
    }
    expect(chain.calls).toContain('void STAKE_TIMEOUT')
    const dee = seats[3] as Seat
    expect(await dee.socket.emitWithAck('JOIN', { matchId: dee.matchId, sessionToken: dee.sessionToken })).toEqual({
      ok: false,
      error: 'UNKNOWN_SESSION',
    })
  }, 30_000)

  it('refuses the fourth seat and dissolves when the provider throws on open', async () => {
    const chain = signingEscrow({
      open: async () => {
        throw new Error('rpc exploded')
      },
    })
    const port = await start(chain.provider)
    const ada = await sit(port, 'Ada')
    await sit(port, 'Bo', ada.code)
    await sit(port, 'Cy', ada.code)

    const dee = await open(port)
    expect(
      await dee.socket.emitWithAck('JOIN_LOBBY', { code: ada.code, name: 'Dee', wallet: Keypair.generate().publicKey.toBase58() }),
    ).toEqual({ ok: false, error: 'ESCROW_FAILED' })
    await settle()
    expect(of(ada, 'LOBBY_DISSOLVED')).toMatchObject([{ reason: 'ESCROW_FAILED' }])
  }, 30_000)
})

describe('the fake escrow', () => {
  it('starts the match on the fourth seat and sends no funding messages', async () => {
    const seats = await fill(await start(undefined, undefined))
    expect(seats.map((seat) => seat.started)).toEqual([false, false, false, true])
    for (const seat of seats) {
      expect(of(seat, 'STAKE_REQUEST')).toEqual([])
      expect(of(seat, 'STAKE_UPDATE')).toEqual([])
      expect(of(seat, 'MATCH_STARTED')).toHaveLength(1)
    }
  }, 30_000)
})
