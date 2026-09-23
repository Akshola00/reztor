import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/log.js'
import { HEARTBEAT_TIMEOUT_MS, LOBBY_SEAT_GRACE_MS } from '../../src/net/auth.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'

// Regression test for the gap the bot driver found: JOIN used to require a running match, so the
// first three players in a lobby had a valid session and nowhere to send it, and no signal for
// when the match began. A seated player now waits in the room and is told when it starts.

type Seat = { socket: ClientSocket; playerId: string; sessionToken: string; started: unknown[] }

let server: GameServer | null = null
const sockets: ClientSocket[] = []

afterEach(async () => {
  for (const socket of sockets) socket.disconnect()
  sockets.length = 0
  await server?.close()
  server = null
})

async function open(port: number): Promise<ClientSocket> {
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

describe('waiting in a lobby', () => {
  it('seats a player before the match exists and tells everyone when it starts', async () => {
    server = createGameServer({ logger: silentLogger })
    const port = await server.listen(0)
    server.loop.stop()

    const seats: Seat[] = []
    let code = ''
    let matchId = ''

    for (const [index, name] of ['Ada', 'Bo', 'Cy', 'Dee'].entries()) {
      const socket = await open(port)
      const lobby = (await socket.emitWithAck(index === 0 ? 'CREATE_LOBBY' : 'JOIN_LOBBY', {
        ...(index === 0 ? {} : { code }),
        name,
      })) as { ok: boolean; ticket: { code: string; matchId: string; playerId: string; sessionToken: string } }
      expect(lobby.ok, `${name} was seated`).toBe(true)
      code = lobby.ticket.code
      matchId = lobby.ticket.matchId

      const seat: Seat = {
        socket,
        playerId: lobby.ticket.playerId,
        sessionToken: lobby.ticket.sessionToken,
        started: [],
      }
      socket.on('MATCH_STARTED', (payload: unknown) => void seat.started.push(payload))
      seats.push(seat)

      const joined = (await socket.emitWithAck('JOIN', {
        matchId,
        sessionToken: seat.sessionToken,
      })) as { ok: boolean; waiting?: boolean }

      // The first three join a lobby that has not filled; only the fourth finds a live match.
      expect(joined.ok, `${name} could JOIN`).toBe(true)
      expect(joined.waiting ?? false, `${name} waiting flag`).toBe(index < 3)
    }

    await new Promise((resolve) => setTimeout(resolve, 50))

    // Everyone learns their role, including the three who joined before the match existed.
    const roles = seats.map((seat) => {
      expect(seat.started, `one MATCH_STARTED per player`).toHaveLength(1)
      return (seat.started[0] as { view: { you: { role: string } } }).view.you.role
    })
    expect(roles.filter((role) => role === 'impostor')).toHaveLength(1)

    const match = server.registry.get(matchId)
    expect(match?.state.phase).toBe('IN_PROGRESS')
    expect(Object.keys(match?.state.players ?? {})).toHaveLength(4)
  }, 30_000)

  it('refuses a JOIN whose session it never issued', async () => {
    server = createGameServer({ logger: silentLogger })
    const port = await server.listen(0)
    server.loop.stop()

    const socket = await open(port)
    const joined = (await socket.emitWithAck('JOIN', {
      matchId: 'nope',
      sessionToken: 'not-a-real-token',
    })) as { ok: boolean; error?: string }

    expect(joined).toEqual({ ok: false, error: 'UNKNOWN_SESSION' })
  }, 30_000)
})

// Lobby state on the wire: the roster as it fills, the deadline, the dissolve, and seats given up
// by players whose socket went away. The clock is faked and the tick loop is driven by hand.

type LobbyUpdate = {
  matchId: string
  serverTick: null
  code: string
  seated: number
  capacity: number
  players: { seated: number; id: string; name: string }[]
  expiresAt: number
  serverNow: number
}

type Waiter = {
  socket: ClientSocket
  playerId: string
  sessionToken: string
  matchId: string
  code: string
  inbox: Map<string, unknown[]>
}

const LOBBY_EVENTS = ['LOBBY_UPDATE', 'LOBBY_DISSOLVED', 'MATCH_STARTED']
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

function listen(socket: ClientSocket): Map<string, unknown[]> {
  const inbox = new Map<string, unknown[]>(LOBBY_EVENTS.map((event) => [event, []]))
  for (const event of LOBBY_EVENTS) socket.on(event, (payload: unknown) => void inbox.get(event)?.push(payload))
  return inbox
}

const updates = (waiter: Waiter): LobbyUpdate[] => (waiter.inbox.get('LOBBY_UPDATE') ?? []) as LobbyUpdate[]

async function sit(port: number, name: string, code?: string): Promise<Waiter> {
  const socket = await open(port)
  const inbox = listen(socket)
  const ack = (await socket.emitWithAck(code === undefined ? 'CREATE_LOBBY' : 'JOIN_LOBBY', {
    ...(code === undefined ? {} : { code }),
    name,
  })) as { ok: boolean; ticket: { code: string; matchId: string; playerId: string; sessionToken: string } }
  expect(ack.ok, `${name} was seated`).toBe(true)
  const { ticket } = ack
  await socket.emitWithAck('JOIN', { matchId: ticket.matchId, sessionToken: ticket.sessionToken })
  await settle()
  return { socket, inbox, ...ticket }
}

describe('lobby state on the wire', () => {
  let clock = 1_000_000

  const start = async (options: Parameters<typeof createGameServer>[0] = {}): Promise<number> => {
    clock = 1_000_000
    server = createGameServer({ logger: silentLogger, now: () => clock, ...options })
    const port = await server.listen(0)
    server.loop.stop()
    return port
  }

  const tickAt = async (ms: number): Promise<void> => {
    clock = ms
    server?.loop.runOnce(ms)
    await settle()
  }

  it('sends the roster to each player on JOIN and to the room as every seat fills', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    const bo = await sit(port, 'Bo', ada.code)
    const cy = await sit(port, 'Cy', ada.code)

    expect(updates(ada).map((update) => update.seated)).toEqual([1, 2, 3])
    expect(updates(bo).map((update) => update.seated)).toEqual([2, 3])
    expect(updates(cy).map((update) => update.seated)).toEqual([3])

    expect(updates(cy)[0]).toEqual({
      matchId: ada.matchId,
      serverTick: null,
      code: ada.code,
      seated: 3,
      capacity: 4,
      players: [
        { seated: 1, id: ada.playerId, name: 'Ada' },
        { seated: 2, id: bo.playerId, name: 'Bo' },
        { seated: 3, id: cy.playerId, name: 'Cy' },
      ],
      expiresAt: 1_000_000 + 60_000,
      serverNow: 1_000_000,
    })
    // Nothing that could bind a socket to someone else's seat.
    expect(JSON.stringify(updates(ada))).not.toContain(bo.sessionToken)

    // The fourth seat is announced to the room before the match starts.
    await sit(port, 'Dee', ada.code)
    expect(updates(ada).map((update) => update.seated)).toEqual([1, 2, 3, 4])
    expect(ada.inbox.get('MATCH_STARTED')).toHaveLength(1)
  }, 30_000)

  it('keeps one fixed deadline for the lobby and stamps each update with the server clock', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    clock += 20_000
    const bo = await sit(port, 'Bo', ada.code)

    const [latest] = updates(bo)
    expect(latest?.expiresAt).toBe(updates(ada)[0]?.expiresAt)
    expect(latest?.serverNow).toBe(1_020_000)
    expect((latest?.expiresAt ?? 0) - (latest?.serverNow ?? 0)).toBe(40_000)
  }, 30_000)

  it('tells the room when a lobby dissolves on the fill timeout, and its code stops working', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    const bo = await sit(port, 'Bo', ada.code)

    await tickAt(1_000_000 + 59_750)
    expect(ada.inbox.get('LOBBY_DISSOLVED')).toEqual([])

    await tickAt(1_000_000 + 60_000)
    for (const waiter of [ada, bo]) {
      expect(waiter.inbox.get('LOBBY_DISSOLVED')).toEqual([
        { matchId: ada.matchId, serverTick: null, code: ada.code, reason: 'TIMEOUT' },
      ])
    }
    const late = await open(port)
    expect(await late.emitWithAck('JOIN_LOBBY', { code: ada.code, name: 'Cy' })).toEqual({
      ok: false,
      error: 'UNKNOWN_CODE',
    })
  }, 30_000)

  it('tells the room when escrow refuses the fourth seat', async () => {
    const refusing = {
      lock: async () => ({ ok: false as const, error: 'ALREADY_LOCKED' as const }),
      settle: async () => ({ ok: false as const, error: 'UNKNOWN_MATCH' as const }),
      void: async () => ({ ok: false as const, error: 'UNKNOWN_MATCH' as const }),
    }
    const port = await start({ escrow: refusing })
    const ada = await sit(port, 'Ada')
    await sit(port, 'Bo', ada.code)
    await sit(port, 'Cy', ada.code)

    const dee = await open(port)
    expect(await dee.emitWithAck('JOIN_LOBBY', { code: ada.code, name: 'Dee' })).toEqual({
      ok: false,
      error: 'ESCROW_FAILED',
    })
    await settle()
    expect(ada.inbox.get('LOBBY_DISSOLVED')).toMatchObject([{ code: ada.code, reason: 'ESCROW_FAILED' }])
    expect(ada.inbox.get('MATCH_STARTED')).toEqual([])
  }, 30_000)

  it('frees the seat of a player whose socket closed once the grace runs out, so the lobby can still fill', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    const bo = await sit(port, 'Bo', ada.code)
    const cy = await sit(port, 'Cy', ada.code)

    bo.socket.disconnect()
    await settle()
    // Gone at close, but the seat is held for the heartbeat window plus the lobby grace.
    await tickAt(1_000_000 + HEARTBEAT_TIMEOUT_MS + LOBBY_SEAT_GRACE_MS - 250)
    expect(updates(ada).at(-1)?.seated).toBe(3)

    await tickAt(1_000_000 + HEARTBEAT_TIMEOUT_MS + LOBBY_SEAT_GRACE_MS)
    expect(updates(ada).at(-1)).toMatchObject({
      seated: 2,
      players: [
        { seated: 1, id: ada.playerId, name: 'Ada' },
        { seated: 2, id: cy.playerId, name: 'Cy' },
      ],
    })
    // The vacated seat's session is gone with it.
    const back = await open(port)
    expect(await back.emitWithAck('JOIN', { matchId: bo.matchId, sessionToken: bo.sessionToken })).toEqual({
      ok: false,
      error: 'UNKNOWN_SESSION',
    })

    await sit(port, 'Dee', ada.code)
    await sit(port, 'Eve', ada.code)
    expect(ada.inbox.get('MATCH_STARTED')).toHaveLength(1)
    expect(Object.values(server?.registry.get(ada.matchId)?.state.players ?? {}).map((p) => p.name)).toEqual([
      'Ada',
      'Cy',
      'Dee',
      'Eve',
    ])
  }, 30_000)

  it('keeps the seat of a player who comes back inside the grace', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    const bo = await sit(port, 'Bo', ada.code)

    bo.socket.disconnect()
    await settle()
    await tickAt(1_000_000 + 10_000)

    const again = await open(port)
    const inbox = listen(again)
    expect(await again.emitWithAck('JOIN', { matchId: bo.matchId, sessionToken: bo.sessionToken })).toMatchObject({
      ok: true,
      waiting: true,
    })
    await tickAt(1_000_000 + 55_000)
    await settle()

    expect(updates(ada).at(-1)?.seated).toBe(2)
    expect((inbox.get('LOBBY_UPDATE') as LobbyUpdate[]).map((update) => update.seated)).toEqual([2])
  }, 30_000)

  it('frees a seat whose ticket was issued but never followed by JOIN', async () => {
    const port = await start()
    const ada = await sit(port, 'Ada')
    const silent = await open(port)
    await silent.emitWithAck('JOIN_LOBBY', { code: ada.code, name: 'Ghost' })
    await settle()
    expect(updates(ada).at(-1)?.seated).toBe(2)

    await tickAt(1_000_000 + HEARTBEAT_TIMEOUT_MS + LOBBY_SEAT_GRACE_MS)
    expect(updates(ada).at(-1)?.players.map((p) => p.name)).toEqual(['Ada'])
  }, 30_000)
})
