import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import type { Faucet } from '../chain/faucet.js'
import { MVP_CONFIG, type MatchConfig } from '../engine/config.js'
import { computeSettlement, type Settlement } from '../engine/settlement.js'
import { consoleLogger, type Logger } from '../log.js'
import { guardEscrow, inMemoryEscrow, type EscrowProvider, type SettleReceipt } from '../match/escrow.js'
import {
  createLobbyService,
  lobbyView,
  stakedSeats,
  type Lobby,
  type LobbyService,
  type StakeRequest,
  type WalletPolicy,
} from '../match/lobby.js'
import { createRegistry, enqueue, type MatchRegistry, type RuntimeMatch } from '../match/registry.js'
import { createTickLoop, type TickLoop } from '../match/tick.js'
import { createConnections, type ConnectionRegistry } from './auth.js'
import { faucetRoute } from './faucet.js'
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

// Counted at the emitter, so one number covers both room broadcasts and private sends.
export type ServerMetrics = { roomBroadcasts: number; privateSends: number }

export type GameServer = {
  io: Server
  registry: MatchRegistry
  lobby: LobbyService
  escrow: EscrowProvider
  loop: TickLoop
  metrics(): ServerMetrics
  listen(port?: number): Promise<number>
  close(): Promise<void>
}

export type ServerOptions = {
  config?: MatchConfig
  escrow?: EscrowProvider
  // Chain mode: lobby messages must carry a funded wallet. Absent, wallets stay optional.
  wallets?: WalletPolicy
  // Devnet only, and only once its guards have passed (chain/faucet.ts). Absent, /faucet refuses.
  faucet?: Faucet
  logger?: Logger
  now?: () => number
}

type Ack = (response: unknown) => void

const ack = (respond: unknown, response: unknown): void => {
  if (typeof respond === 'function') (respond as Ack)(response)
}

export function createGameServer(options: ServerOptions = {}): GameServer {
  const { config, wallets, faucet, logger = consoleLogger, now = () => Date.now() } = options
  const escrow = guardEscrow(options.escrow ?? inMemoryEscrow(), logger)

  // The throwaway browser client, served as one file with no build step. Socket.IO installs its
  // own handler for /socket.io/ ahead of this one and passes everything else through.
  const http: HttpServer = createHttpServer((request, response) => {
    if (request.method === 'GET' && (request.url === '/dev' || request.url === '/dev/')) {
      try {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(readFileSync(new URL('../../dev/client.html', import.meta.url)))
      } catch {
        response.writeHead(500, { 'content-type': 'text/plain' }).end('dev/client.html is missing')
      }
      return
    }
    if (request.method === 'POST' && request.url === '/faucet') {
      void faucetRoute(faucet, request, response)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  })
  const io = new Server(http, { cors: { origin: '*' } })

  const registry = createRegistry()
  const connections = createConnections()
  const metrics: ServerMetrics = { roomBroadcasts: 0, privateSends: 0 }
  const emitter: Emitter = {
    toRoom: (matchId, event, payload) => {
      metrics.roomBroadcasts += 1
      io.to(matchId).emit(event, payload)
    },
    toSocket: (socketId, event, payload) => {
      metrics.privateSends += 1
      io.to(socketId).emit(event, payload)
    },
  }

  // A lobby has a matchId from the moment it is created, but no match clock until it fills, so
  // lobby messages carry a null serverTick rather than a tick that means nothing.
  const sendLobby = (target: Lobby, socketId?: string): void => {
    const payload = { matchId: target.matchId, serverTick: null, ...lobbyView(target, config ?? MVP_CONFIG, now()) }
    if (socketId === undefined) emitter.toRoom(target.matchId, 'LOBBY_UPDATE', payload)
    else emitter.toSocket(socketId, 'LOBBY_UPDATE', payload)
  }

  // Private: the transaction is only ever useful to the wallet it names.
  const sendStakeRequest = (target: Lobby, socketId: string, request: StakeRequest): void =>
    emitter.toSocket(socketId, 'STAKE_REQUEST', { matchId: target.matchId, serverTick: null, ...request })

  const stakeUpdate = (target: Lobby) => ({ matchId: target.matchId, serverTick: null, staked: stakedSeats(target) })

  const lobby = createLobbyService({
    registry,
    escrow,
    ...(config === undefined ? {} : { config }),
    logger,
    now,
    // Everyone already waiting in the room learns their role the moment the lobby fills.
    onMatchStart: (match) => {
      for (const playerId of Object.keys(match.state.players)) {
        const socketId = connections.socketFor(match.matchId, playerId)
        if (socketId === undefined) continue
        greeted.add(`${match.matchId}:${playerId}`)
        sendMatchStarted(emitter, match, socketId, playerId)
      }
    },
    onChange: (changed) => sendLobby(changed),
    // A player not connected right now gets theirs, freshly built, when their JOIN arrives.
    onStakeRequest: (funding, playerId, request) => {
      const socketId = connections.socketFor(funding.matchId, playerId)
      if (socketId !== undefined) sendStakeRequest(funding, socketId, request)
    },
    onStakeUpdate: (funding) => emitter.toRoom(funding.matchId, 'STAKE_UPDATE', stakeUpdate(funding)),
    ...(wallets === undefined ? {} : { wallets }),
    onDissolve: (dissolved, reason) =>
      emitter.toRoom(dissolved.matchId, 'LOBBY_DISSOLVED', {
        matchId: dissolved.matchId,
        serverTick: null,
        code: dissolved.code,
        reason,
      }),
  })

  const deps: HandlerDeps = { registry, connections, lobby, emitter, logger, now }

  // A player receives MATCH_STARTED once; every later JOIN for them is a reconnect.
  const greeted = new Set<string>()
  const settled = new Set<string>()

  // Chain mode only: the fake signs nothing. MATCH_END has already gone out with the server's numbers;
  // this confirms them, and says so loudly if the chain paid anything else.
  const confirmSettlement = (match: RuntimeMatch, settlement: Settlement, receipt: SettleReceipt): void => {
    if (receipt.signature === null) return
    const expected = settlement.lines.map((line) => BigInt(line.refund + line.payout) * receipt.baseUnitsPerCredit)
    const payouts = receipt.payouts.map(String)
    if (expected.length !== receipt.payouts.length || expected.some((amount, seat) => amount !== receipt.payouts[seat])) {
      logger('error', 'CHAIN PAYOUTS DIFFER FROM THE SERVER SETTLEMENT', {
        matchId: match.matchId,
        tick: match.tick,
        signature: receipt.signature,
        expected: expected.map(String),
        paid: payouts,
      })
    }
    emitter.toRoom(match.matchId, 'SETTLEMENT_CONFIRMED', {
      matchId: match.matchId,
      serverTick: match.tick,
      signature: receipt.signature,
      payouts,
    })
  }

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

    // A chain provider retries before it answers, so this runs once the chain has confirmed or the
    // last retry has failed — never while a settlement might still land.
    void escrow.settle(match.matchId, settlement.value).then((result) => {
      if (result.ok) {
        logger('info', 'match settled', {
          ...fields,
          winner: resolution.winner,
          reason: resolution.reason,
          rake: settlement.value.rakeCredits,
          dust: settlement.value.dustCredits,
        })
        confirmSettlement(match, settlement.value, result.value)
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

      onInterval: (nowMs) => {
        // Before the sweep, so a lobby that is both expiring and losing a seat says it dissolved.
        for (const open of lobby.open()) {
          for (const { playerId, seatedAtMs } of [...open.seats]) {
            if (connections.seatAbandoned(open.matchId, playerId, seatedAtMs, nowMs)) {
              lobby.vacate(open.matchId, playerId)
            }
          }
        }
        lobby.sweep(nowMs)
      },
    },
  })

  // Chain mode requires a wallet that can sign. Checked with the payload, so a missing or malformed
  // one is refused the same way as any other bad field.
  const walletInvalid = (wallet: string | null | undefined): boolean =>
    wallets !== undefined && (wallet == null || !wallets.isAddress(wallet))

  io.on('connection', (socket: Socket) => {
    socket.on('CREATE_LOBBY', (payload: unknown, respond: unknown) => {
      const parsed = CreateLobbySchema.safeParse(payload)
      if (!parsed.success || walletInvalid(parsed.data.wallet)) return ack(respond, { ok: false, error: 'INVALID_PAYLOAD' })
      void lobby.create(parsed.data.name, parsed.data.wallet ?? null).then((result) => {
        ack(respond, result.ok ? { ok: true, ticket: result.value } : { ok: false, error: result.error })
      })
    })

    socket.on('JOIN_LOBBY', (payload: unknown, respond: unknown) => {
      const parsed = JoinLobbySchema.safeParse(payload)
      if (!parsed.success || walletInvalid(parsed.data.wallet)) return ack(respond, { ok: false, error: 'INVALID_PAYLOAD' })
      void lobby.join(parsed.data.code, parsed.data.name, parsed.data.wallet ?? null).then((result) => {
        ack(respond, result.ok ? { ok: true, ticket: result.value } : { ok: false, error: result.error })
      })
    })

    socket.on('JOIN', (payload: unknown, respond: unknown) => {
      const previous = connections.bySocket(socket.id)
      const result = handleJoin(deps, socket.id, payload)
      if (typeof result === 'string') {
        logger('info', 'join refused', { error: result })
        return ack(respond, { ok: false, error: result })
      }

      // A socket rebinding to another lobby stops hearing the one it left.
      if (previous !== undefined && previous.matchId !== result.matchId) void socket.leave(previous.matchId)
      void socket.join(result.matchId)

      const match = registry.get(result.matchId)
      if (match === undefined) {
        // Seated but the lobby has not filled. The socket waits in the room and MATCH_STARTED
        // arrives when the fourth player does.
        logger('info', 'player waiting in lobby', { matchId: result.matchId, playerId: result.playerId })
        ack(respond, { ok: true, playerId: result.playerId, waiting: true, reconnected: false })
        // The roster so far, once, to this socket; the room hears every change after this.
        const waitingIn = lobby.byMatch(result.matchId)
        if (waitingIn !== undefined) sendLobby(waitingIn, socket.id)
        // Joining, or rejoining, mid-funding: where the stakes stand, and this seat's transaction
        // if it has yet to pay.
        if (waitingIn?.funding != null) {
          emitter.toSocket(socket.id, 'STAKE_UPDATE', stakeUpdate(waitingIn))
          void lobby.stakeRequest(result.matchId, result.playerId).then((request) => {
            if (request !== null) sendStakeRequest(waitingIn, socket.id, request)
          })
        }
        return
      }

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
    metrics: () => ({ ...metrics }),
    listen: (port = 0) =>
      // A listen that never rejects hides the commonest dev failure of all, a port already in use,
      // as an unhandled 'error' event and a stack trace.
      new Promise<number>((resolve, reject) => {
        http.once('error', reject)
        http.listen(port, () => {
          http.removeListener('error', reject)
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
