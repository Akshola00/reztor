import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../../src/log.js'
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
