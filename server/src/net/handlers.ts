import { z } from 'zod'
import { PayloadSchemas, type Intent } from '../engine/events.js'
import type { Logger } from '../log.js'
import type { LobbyService, Session } from '../match/lobby.js'
import { enqueue, type MatchRegistry } from '../match/registry.js'
import type { ConnectionRegistry } from './auth.js'
import type { Emitter } from './broadcast.js'

export const JoinSchema = z.strictObject({ matchId: z.string().min(1), sessionToken: z.string().min(1) })
export const CreateLobbySchema = z.strictObject({
  name: z.string().min(1).max(32),
  wallet: z.string().min(1).max(64).nullish(),
})
export const JoinLobbySchema = CreateLobbySchema.extend({ code: z.string().length(4) })

// Game messages, all of which require a bound session. Lobby and JOIN are handled separately
// because they are what establishes one.
export const GAME_EVENTS = ['TAP_BATCH', 'SET_TIER', 'SIPHON', 'TRACE', 'CHAT', 'VOTE'] as const
export type GameEvent = (typeof GAME_EVENTS)[number]

export type HandlerDeps = {
  registry: MatchRegistry
  connections: ConnectionRegistry
  lobby: LobbyService
  emitter: Emitter
  logger: Logger
  now: () => number
}

export type JoinError = 'INVALID_PAYLOAD' | 'UNKNOWN_SESSION' | 'WRONG_MATCH' | 'NO_MATCH'

// A transport-level refusal. Distinct from the engine's Rejection, which is a rule outcome —
// these never reach the engine at all. matchId/serverTick are null when the socket has no match.
function refuse(
  { emitter, logger }: HandlerDeps,
  socketId: string,
  action: string,
  code: string,
  reason: string,
  matchId: string | null = null,
  serverTick: number | null = null,
): void {
  emitter.toSocket(socketId, 'ACTION_REJECTED', { matchId, serverTick, action, code, reason })
  logger('info', 'action refused at the transport', { matchId: matchId ?? undefined, action, code })
}

// CLAUDE.md §8: the socket is bound to a playerId here and nowhere else. Until this succeeds the
// socket is in no room and every game message is rejected.
export function handleJoin(deps: HandlerDeps, socketId: string, payload: unknown): Session | JoinError {
  const parsed = JoinSchema.safeParse(payload)
  if (!parsed.success) return 'INVALID_PAYLOAD'

  const session = deps.lobby.resolveSession(parsed.data.sessionToken)
  if (session === undefined) return 'UNKNOWN_SESSION'
  if (session.matchId !== parsed.data.matchId) return 'WRONG_MATCH'
  if (deps.registry.get(session.matchId) === undefined) return 'NO_MATCH'

  deps.connections.bind(socketId, session, deps.now())
  return session
}

// Validate, turn into an intent, queue it. No state is touched here: the tick drains the queue
// (CLAUDE.md §6), which is what keeps ordering deterministic and the match reproducible.
export function handleGameMessage(deps: HandlerDeps, socketId: string, event: GameEvent, payload: unknown): void {
  const connection = deps.connections.bySocket(socketId)
  if (connection === undefined) {
    refuse(deps, socketId, event, 'NOT_JOINED', 'Send JOIN before any game message')
    return
  }

  const nowMs = deps.now()
  // The plain per-socket allowance, checked before anything else so a flood costs nothing to
  // refuse. A player with no credits left can still send, but not without limit.
  if (!deps.connections.allow(socketId, nowMs)) {
    refuse(deps, socketId, event, 'TOO_MANY_MESSAGES', 'Slow down', connection.matchId)
    return
  }
  deps.connections.touch(socketId, nowMs)

  const match = deps.registry.get(connection.matchId)
  if (match === undefined) {
    refuse(deps, socketId, event, 'NO_MATCH', 'That match is no longer running', connection.matchId)
    return
  }

  const parsed = PayloadSchemas[event].safeParse(payload)
  if (!parsed.success) {
    refuse(deps, socketId, event, 'INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? 'Invalid payload', match.matchId, match.tick)
    return
  }

  const { playerId } = connection
  const data = parsed.data
  let intent: Intent
  switch (event) {
    case 'TAP_BATCH': {
      // `tier` is advisory and `clientTs` is ignored (CLAUDE.md §5.1, §0.1), so neither is
      // carried into the intent — the engine uses the tier it stored for this player.
      const tap = data as z.infer<(typeof PayloadSchemas)['TAP_BATCH']>
      intent = { kind: 'TAP_BATCH', playerId, count: tap.count, ...(tap.lane === undefined ? {} : { lane: tap.lane }) }
      break
    }
    case 'SET_TIER':
      intent = { kind: 'SET_TIER', playerId, tier: (data as z.infer<(typeof PayloadSchemas)['SET_TIER']>).tier }
      break
    case 'SIPHON': {
      const siphon = data as z.infer<(typeof PayloadSchemas)['SIPHON']>
      intent = { kind: 'SIPHON', playerId, source: siphon.source, sink: siphon.sink }
      break
    }
    case 'TRACE':
      intent = { kind: 'TRACE', playerId, target: (data as z.infer<(typeof PayloadSchemas)['TRACE']>).target }
      break
    case 'CHAT':
      intent = { kind: 'CHAT', playerId, text: (data as z.infer<(typeof PayloadSchemas)['CHAT']>).text }
      break
    case 'VOTE':
      intent = { kind: 'VOTE', playerId, target: (data as z.infer<(typeof PayloadSchemas)['VOTE']>).target }
      break
  }

  enqueue(match, intent)
}
