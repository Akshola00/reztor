import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import type { MatchConfig } from '../engine/config.js'
import { computeSettlement } from '../engine/settlement.js'
import { consoleLogger, type Logger } from '../log.js'
import { inMemoryEscrow, type EscrowProvider } from '../match/escrow.js'
import { createLobbyService, type LobbyService } from '../match/lobby.js'
import { createRegistry, enqueue, type MatchRegistry, type RuntimeMatch } from '../match/registry.js'
import { createTickLoop, type TickLoop } from '../match/tick.js'
import { createConnections, type ConnectionRegistry } from './auth.js'
import {
  broadcastTick,
  sendMatchStarted,
  sendRejection,
  sendResume,
  type Emitter,
} from './broadcast.js'
import {
  CreateLobbySchema,
  GAME_EVENTS,
  JoinLobbySchema,
  handleGameMessage,
  handleJoin,
  type HandlerDeps,
} from './handlers.js'

export type GameServer = {
  io: Server
  registry: MatchRegistry
  lobby: LobbyService
  escrow: EscrowProvider
  loop: TickLoop
  listen(port?: number): Promise<number>
  close(): Promise<void>
}

export type ServerOptions = {
  config?: MatchConfig
  escrow?: EscrowProvider
  logger?: Logger
  now?: () => number
}

type Ack = (response: unknown) => void

const ack = (respond: unknown, response: unknown): void => {
  if (typeof respond === 'function') (respond as Ack)(response)
}

export function createGameServer(options: ServerOptions = {}): GameServer {
  const { config, escrow = inMemoryEscrow(), logger = consoleLogger, now = () => Date.now() } = options

  const http: HttpServer = createHttpServer()
  const io = new Server(http, { cors: { origin: '*' } })

  const registry = createRegistry()
  const connections = createConnections()
  const emitter: Emitter = {
    toRoom: (matchId, event, payload) => void io.to(matchId).emit(event, payload),
    toSocket: (socketId, event, payload) => void io.to(socketId).emit(event, payload),
  }

  const lobby = createLobbyService({
    registry,
    escrow,
    ...(config === undefined ? {} : { config }),
    logger,
    now,
  })

  const deps: HandlerDeps = { registry, connections, lobby, emitter, logger, now }

  // A player receives MATCH_STARTED once; every later JOIN for them is a reconnect.
  const greeted = new Set<string>()
  const settled = new Set<string>()

  const settle = (match: RuntimeMatch): void => {
    if (settled.has(match.matchId)) return
    settled.add(match.matchId)
    const { resolution, eventLog } = match.state
    if (resolution === null) return

    const fields = { matchId: match.matchId, tick: match.tick }
    if (resolution.kind === 'voided') {
      void escrow.void(match.matchId, resolution.reason).then((result) => {
        logger(result.ok ? 'info' : 'error', 'match voided', { ...fields, reason: resolution.reason })
      })
      return
    }

    const settlement = computeSettlement(eventLog, match.state.config)
    if (!settlement.ok) {
      // CLAUDE.md §11: never send a settlement you cannot reconcile — void instead.
      logger('error', 'settlement could not be computed, voiding', { ...fields, error: settlement.error })
      void escrow.void(match.matchId, `SETTLEMENT_${settlement.error}`)
      return
    }

    void escrow.settle(match.matchId, settlement.value).then((result) => {
      if (result.ok) {
        logger('info', 'match settled', {
          ...fields,
          winner: resolution.winner,
          reason: resolution.reason,
          rake: settlement.value.rakeCredits,
          dust: settlement.value.dustCredits,
        })
      } else {
        logger('error', 'escrow refused the settlement, voiding', { ...fields, error: result.error })
        void escrow.void(match.matchId, `ESCROW_${result.error}`)
      }
    })
  }

  const loop = createTickLoop({
    registry,
    logger,
    now,
    hooks: {
      // CLAUDE.md §8: a grace clock starts only once the socket is closed *and* the heartbeat has
      // lapsed. Queued as an intent like any other, so the disconnect lands in the event log.
      beforeDrain(match, nowMs) {
        for (const playerId of connections.timedOut(match.matchId, nowMs)) {
          if (match.state.players[playerId]?.status !== 'alive') continue
          logger('info', 'player timed out, starting grace', { matchId: match.matchId, tick: match.tick, playerId })
          enqueue(match, { kind: 'DISCONNECT', playerId })
        }
      },

      afterTick(match, result, events) {
        for (const rejection of result.rejections) {
          if (rejection.playerId === undefined) continue
          const socketId = connections.socketFor(match.matchId, rejection.playerId)
          // Rate-clamp drops are silent by design (spec §5.1); everything else is told.
          if (socketId !== undefined) sendRejection(emitter, match, socketId, rejection)
        }
        for (const event of events) {
          const fields = { matchId: match.matchId, tick: match.tick }
          if (event.type === 'STAGE_ADVANCED') {
            logger('info', 'stage advanced', { ...fields, round: event.round, stage: event.stage })
          } else if (event.type === 'VOTE_RESOLVED') {
            logger('info', 'vote resolved', { ...fields, round: event.round, ejected: event.ejected ?? 'nobody' })
          }
        }

        broadcastTick(emitter, connections, match, events)
        if (match.state.resolution !== null) settle(match)
      },

      onInterval: (nowMs) => void lobby.sweep(nowMs),
    },
  })

  io.on('connection', (socket: Socket) => {
    socket.on('CREATE_LOBBY', (payload: unknown, respond: unknown) => {
      const parsed = CreateLobbySchema.safeParse(payload)
      if (!parsed.success) return ack(respond, { ok: false, error: 'INVALID_PAYLOAD' })
      void lobby.create(parsed.data.name, parsed.data.wallet ?? null).then((result) => {
        ack(respond, result.ok ? { ok: true, ticket: result.value } : { ok: false, error: result.error })
      })
    })

    socket.on('JOIN_LOBBY', (payload: unknown, respond: unknown) => {
      const parsed = JoinLobbySchema.safeParse(payload)
      if (!parsed.success) return ack(respond, { ok: false, error: 'INVALID_PAYLOAD' })
      void lobby.join(parsed.data.code, parsed.data.name, parsed.data.wallet ?? null).then((result) => {
        ack(respond, result.ok ? { ok: true, ticket: result.value } : { ok: false, error: result.error })
      })
    })

    socket.on('JOIN', (payload: unknown, respond: unknown) => {
      const result = handleJoin(deps, socket.id, payload)
      if (typeof result === 'string') {
        logger('info', 'join refused', { error: result })
        return ack(respond, { ok: false, error: result })
      }

      const match = registry.get(result.matchId)
      if (match === undefined) return ack(respond, { ok: false, error: 'NO_MATCH' })

      void socket.join(result.matchId)
      const key = `${result.matchId}:${result.playerId}`
      const reconnecting = greeted.has(key)
      greeted.add(key)

      // A player whose grace clock was running is back; the engine learns through an intent.
      if (reconnecting && match.state.players[result.playerId]?.status === 'disconnected') {
        enqueue(match, { kind: 'RECONNECT', playerId: result.playerId })
      }

      logger('info', reconnecting ? 'player reconnected' : 'player joined', {
        matchId: match.matchId,
        tick: match.tick,
        playerId: result.playerId,
      })

      if (reconnecting) sendResume(emitter, match, socket.id, result.playerId)
      else sendMatchStarted(emitter, match, socket.id, result.playerId)
      ack(respond, { ok: true, playerId: result.playerId, reconnected: reconnecting })
    })

    socket.on('HEARTBEAT', () => connections.touch(socket.id, now()))

    for (const event of GAME_EVENTS) {
      socket.on(event, (payload: unknown) => handleGameMessage(deps, socket.id, event, payload))
    }

    socket.on('disconnect', () => {
      // Only the close time is recorded. Whether that becomes a game disconnect is decided by the
      // tick loop once the heartbeat has also lapsed (CLAUDE.md §8).
      connections.close(socket.id, now())
    })
  })

  return {
    io,
    registry,
    lobby,
    escrow,
    loop,
    listen: (port = 0) =>
      new Promise<number>((resolve) => {
        http.listen(port, () => {
          const address = http.address()
          loop.start()
          resolve(typeof address === 'object' && address !== null ? address.port : port)
        })
      }),
    close: async () => {
      loop.stop()
      await io.close()
    },
  }
}
