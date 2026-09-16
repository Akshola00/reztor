import { io as connect, type Socket as ClientSocket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { MVP_CONFIG, type MatchConfig } from '../../src/engine/config.js'
import { settlementBalances } from '../../src/engine/settlement.js'
import type { Level, LogFields, Logger } from '../../src/log.js'
import { HEARTBEAT_TIMEOUT_MS } from '../../src/net/auth.js'
import { createGameServer, type GameServer } from '../../src/net/server.js'
import { TICK_MS } from '../../src/match/tick.js'

// Real sockets, real Socket.IO, a fake clock. The clock is the only thing faked: a match at the
// MVP's 60/45/15 second stages takes six real minutes, which is not a test.
const FAST: Partial<MatchConfig> = {
  laneCapacity: 100,
  winTarget: 150,
  stageDurations: { tap: 2, chat: 1, vote: 1 },
  buyInSkr: 1,
  creditsPerSkr: 100,
  disconnectGraceSec: 2,
}

// Long tap stages so a disconnect test is not overtaken by the match ending.
const SLOW: Partial<MatchConfig> = { ...FAST, winTarget: 10_000, stageDurations: { tap: 60, chat: 1, vote: 1 } }

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(() => resolve(), ms))

type LogLine = { level: Level; message: string; fields: LogFields }

type Client = {
  socket: ClientSocket
  name: string
  playerId: string
  sessionToken: string
  inbox: Map<string, unknown[]>
}

type Harness = {
  server: GameServer
  clients: Client[]
  log: LogLine[]
  matchId: string
  tick(count?: number): Promise<void>
  flush(): Promise<void>
  reconnect(client: Client): Promise<Client>
  stop(): Promise<void>
}

const RECORDED = [
  'MATCH_STARTED',
  'RESUME_STATE',
  'BOARD_UPDATE',
  'STAGE_CHANGE',
  'CREDITS',
  'SIPHON_RESULT',
  'TRACE_RESULT',
  'VOTE_RESULT',
  'MATCH_END',
  'ACTION_REJECTED',
]

const record = (socket: ClientSocket, inbox: Map<string, unknown[]>): void => {
  for (const event of RECORDED) {
    socket.on(event, (payload: unknown) => {
      const seen = inbox.get(event) ?? []
      seen.push(payload)
      inbox.set(event, seen)
    })
  }
}

const last = <T>(client: Client, event: string): T | undefined => client.inbox.get(event)?.at(-1) as T | undefined
const all = (client: Client, event: string): unknown[] => client.inbox.get(event) ?? []

async function open(port: number): Promise<ClientSocket> {
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return socket
}

async function start(config: Partial<MatchConfig>): Promise<Harness> {
  const log: LogLine[] = []
  const logger: Logger = (level, message, fields = {}) => void log.push({ level, message, fields })

  let clock = 0
  const server = createGameServer({ config: { ...MVP_CONFIG, ...config }, logger, now: () => clock })
  const port = await server.listen(0)
  // The real interval is replaced by explicit steps so each tick lands where the test wants it.
  server.loop.stop()

  const flush = () => delay(25)

  const tick = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      clock += TICK_MS
      server.loop.runOnce(clock)
    }
    await flush()
  }

  const names = ['Ada', 'Bo', 'Cy', 'Dee']
  const clients: Client[] = []
  let code = ''
  let matchId = ''

  for (const [index, name] of names.entries()) {
    const socket = await open(port)
    const response = (await socket.emitWithAck(
      index === 0 ? 'CREATE_LOBBY' : 'JOIN_LOBBY',
      index === 0 ? { name } : { code, name },
    )) as { ok: boolean; ticket?: { code: string; matchId: string; playerId: string; sessionToken: string } }

    if (!response.ok || response.ticket === undefined) throw new Error(`Lobby join failed for ${name}`)
    code = response.ticket.code
    matchId = response.ticket.matchId

    const client: Client = {
      socket,
      name,
      playerId: response.ticket.playerId,
      sessionToken: response.ticket.sessionToken,
      inbox: new Map(),
    }
    record(socket, client.inbox)
    clients.push(client)
  }

  for (const client of clients) {
    const joined = (await client.socket.emitWithAck('JOIN', {
      matchId,
      sessionToken: client.sessionToken,
    })) as { ok: boolean; error?: string }
    if (!joined.ok) throw new Error(`JOIN failed for ${client.name}: ${joined.error}`)
  }
  await flush()

  const reconnect = async (client: Client): Promise<Client> => {
    const socket = await open(port)
    const fresh: Client = { ...client, socket, inbox: new Map() }
    record(socket, fresh.inbox)
    const joined = (await socket.emitWithAck('JOIN', {
      matchId,
      sessionToken: client.sessionToken,
    })) as { ok: boolean; reconnected?: boolean }
    if (!joined.ok) throw new Error(`Reconnect failed for ${client.name}`)
    await flush()
    const index = clients.indexOf(client)
    if (index >= 0) clients[index] = fresh
    return fresh
  }

  return {
    server,
    clients,
    log,
    matchId,
    tick,
    flush,
    reconnect,
    stop: async () => {
      for (const client of clients) client.socket.disconnect()
      await server.close()
    },
  }
}

let harness: Harness | null = null
afterEach(async () => {
  await harness?.stop()
  harness = null
})

const stageOf = (client: Client): string | undefined =>
  (last<{ board: { stage: string } }>(client, 'BOARD_UPDATE'))?.board.stage

describe('four clients play a full match over real sockets', () => {
  it('runs lobby to settlement and every client sees the same ending', async () => {
    harness = await start(FAST)
    const { clients, server, matchId } = harness

    // Everyone learns their role privately, and exactly one of them is the impostor.
    const roles = clients.map((client) => last<{ view: { you: { role: string } } }>(client, 'MATCH_STARTED')?.view.you.role)
    expect(roles.filter((role) => role === 'impostor')).toHaveLength(1)
    expect(roles.filter((role) => role === 'crew')).toHaveLength(3)

    // Play until the match ends: tap while tapping, talk while talking, vote while voting.
    for (let step = 0; step < 80; step++) {
      const match = server.registry.get(matchId)
      if (match?.state.resolution != null) break

      const stage = stageOf(clients[0] as Client)
      for (const client of clients) {
        if (stage === 'tap') client.socket.emit('TAP_BATCH', { tier: 1, count: 6, clientTs: 0 })
        else if (stage === 'chat') client.socket.emit('CHAT', { text: `${client.name} saw nothing` })
        else if (stage === 'vote') client.socket.emit('VOTE', { target: 'skip' })
      }
      await harness.flush()
      await harness.tick()
    }

    const match = server.registry.get(matchId)
    expect(match?.state.resolution).not.toBeNull()

    // Every client received the same ending, with the reveal and a settlement that reconciles.
    for (const client of clients) {
      const end = last<{ reveal: { impostorId: string }; settlement: Parameters<typeof settlementBalances>[0] }>(
        client,
        'MATCH_END',
      )
      expect(end, `${client.name} received MATCH_END`).toBeDefined()
      expect(end?.reveal.impostorId).toBe(match?.state.impostorId)
      expect(settlementBalances(end!.settlement)).toBe(true)
    }

    // The board moved, votes were revealed, and private credit deltas stayed private.
    expect(all(clients[0] as Client, 'VOTE_RESULT').length).toBeGreaterThan(0)
    for (const client of clients) expect(all(client, 'CREDITS').length).toBeGreaterThan(0)

    // Escrow closed exactly once, for the one match.
    const settlements = harness.log.filter((line) => line.message === 'match settled' || line.message === 'match voided')
    expect(settlements).toHaveLength(1)

    printLog(harness)
  }, 60_000)
})

describe('disconnect and reconnect', () => {
  it('starts grace only after the heartbeat lapses, and a reconnect restores the player', async () => {
    harness = await start(SLOW)
    const { clients, server, matchId } = harness
    const leaver = clients[2] as Client

    leaver.socket.disconnect()
    await harness.flush()

    // A closed socket alone is not evidence of leaving (CLAUDE.md §8): still alive here.
    await harness.tick(2)
    expect(server.registry.get(matchId)?.state.players[leaver.playerId]?.status).toBe('alive')

    // Once the heartbeat has also lapsed, the grace clock starts.
    await harness.tick(Math.ceil(HEARTBEAT_TIMEOUT_MS / TICK_MS) + 1)
    expect(server.registry.get(matchId)?.state.players[leaver.playerId]?.status).toBe('disconnected')

    const back = await harness.reconnect(leaver)
    await harness.tick()

    // RESUME_STATE, not a replay of missed deltas, and the player is alive again.
    const resume = last<{ view: { you: { id: string }; lanes: unknown[] } }>(back, 'RESUME_STATE')
    expect(resume?.view.you.id).toBe(leaver.playerId)
    expect(resume?.view.lanes).toHaveLength(4)
    expect(all(back, 'MATCH_STARTED')).toHaveLength(0)
    expect(server.registry.get(matchId)?.state.players[leaver.playerId]?.status).toBe('alive')
  }, 60_000)
})

describe('grace expiry', () => {
  it('ejects a player who never comes back and makes their lane dormant', async () => {
    harness = await start(SLOW)
    const { clients, server, matchId } = harness
    const leaver = clients[3] as Client

    leaver.socket.disconnect()
    await harness.flush()

    const graceTicks = (SLOW.disconnectGraceSec ?? 2) * (1000 / TICK_MS)
    await harness.tick(Math.ceil(HEARTBEAT_TIMEOUT_MS / TICK_MS) + graceTicks + 2)

    const state = server.registry.get(matchId)?.state
    expect(state?.players[leaver.playerId]?.status).toBe('ejected')
    expect(state?.lanes[leaver.playerId]?.dormant).toBe(true)
    expect(state?.eventLog.some((event) => event.type === 'GRACE_EXPIRED')).toBe(true)
  }, 60_000)
})

// The server log of one full match, printed so it can be read rather than inferred.
function printLog({ log }: Harness): void {
  const lines = log.map(({ level, message, fields }) => {
    const rest = Object.entries(fields)
      .filter(([key]) => key !== 'matchId')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ')
    return `  ${level.padEnd(5)} ${message}${rest === '' ? '' : `  ${rest}`}`
  })
  console.log(['', 'SERVER LOG — one full match, four clients', ...lines, ''].join('\n'))
}
