import type { MatchEvent, Rejection } from '../engine/events.js'
import { matchEndPayload } from '../engine/match-end.js'
import { boardView, privateView } from '../engine/selectors.js'
import type { PlayerId } from '../engine/state.js'
import type { RuntimeMatch } from '../match/registry.js'
import type { ConnectionRegistry } from './auth.js'

// Socket.IO behind a two-method seam, so broadcasting is testable without a server and the
// engine-facing code never imports a socket.
export type Emitter = {
  toRoom(matchId: string, event: string, payload: unknown): void
  toSocket(socketId: string, event: string, payload: unknown): void
}

// CLAUDE.md §7: every outbound message carries matchId and serverTick.
type Envelope = { matchId: string; serverTick: number }

const envelope = (match: RuntimeMatch): Envelope => ({ matchId: match.matchId, serverTick: match.tick })

function sendTo(
  emitter: Emitter,
  connections: ConnectionRegistry,
  match: RuntimeMatch,
  playerId: PlayerId,
  event: string,
  payload: object,
): void {
  const socketId = connections.socketFor(match.matchId, playerId)
  if (socketId !== undefined) emitter.toSocket(socketId, event, { ...envelope(match), ...payload })
}

export function sendRejection(
  emitter: Emitter,
  match: RuntimeMatch,
  socketId: string,
  rejection: Rejection,
): void {
  emitter.toSocket(socketId, 'ACTION_REJECTED', {
    ...envelope(match),
    action: rejection.action,
    code: rejection.code,
    reason: rejection.reason,
  })
}

// CLAUDE.md §8: a reconnect gets the whole private view, never a replay of missed deltas.
export function sendResume(
  emitter: Emitter,
  match: RuntimeMatch,
  socketId: string,
  playerId: PlayerId,
): boolean {
  const view = privateView(match.state, playerId)
  if (view === null) return false
  emitter.toSocket(socketId, 'RESUME_STATE', { ...envelope(match), view })
  return true
}

// The per-tick fan-out of CLAUDE.md §6: the board to the room, then the private deltas that this
// tick's events earned, each to one socket. Built from the selectors so nothing can leak.
export function broadcastTick(
  emitter: Emitter,
  connections: ConnectionRegistry,
  match: RuntimeMatch,
  events: readonly MatchEvent[],
): void {
  emitter.toRoom(match.matchId, 'BOARD_UPDATE', { ...envelope(match), board: boardView(match.state, match.tick) })

  for (const event of events) {
    switch (event.type) {
      case 'CHAT_POSTED':
        // Pushed once, when it is posted. Clients accumulate their own history; only a reconnecting
        // player needs the backlog, and RESUME_STATE carries it.
        emitter.toRoom(match.matchId, 'CHAT_MESSAGE', {
          ...envelope(match),
          from: event.playerId,
          text: event.text,
          tick: event.tick,
        })
        break

      case 'TAPS_APPLIED':
        sendCredits(emitter, connections, match, event.playerId)
        break

      case 'SIPHONED':
        // Siphon results are the impostor's alone; the crew learn about it from the board.
        sendTo(emitter, connections, match, event.playerId, 'SIPHON_RESULT', {
          source: event.source,
          sink: event.sink,
          pulled: event.pulled,
          delivered: event.delivered,
          destroyed: event.destroyed,
        })
        sendCredits(emitter, connections, match, event.playerId)
        break

      case 'TRACED':
        // The result never names a counterparty (CLAUDE.md §5.3).
        sendTo(emitter, connections, match, event.playerId, 'TRACE_RESULT', {
          target: event.target,
          result: event.result,
        })
        sendCredits(emitter, connections, match, event.playerId)
        break

      case 'STAGE_ADVANCED':
        emitter.toRoom(match.matchId, 'STAGE_CHANGE', {
          ...envelope(match),
          round: event.round,
          stage: event.stage,
          endsAtTick: event.endsAtTick,
        })
        break

      case 'VOTE_RESOLVED':
        // Revealed simultaneously, and only now (CLAUDE.md §5.5). `cast` is what each player
        // chose; the tally used `counted`.
        emitter.toRoom(match.matchId, 'VOTE_RESULT', {
          ...envelope(match),
          round: event.round,
          votes: Object.fromEntries(Object.entries(event.votes).map(([voter, record]) => [voter, record.cast])),
          ejected: event.ejected,
        })
        break

      case 'MATCH_RESOLVED':
      case 'MATCH_VOIDED':
        sendMatchEnd(emitter, match)
        break

      default:
        break
    }
  }
}

function sendCredits(
  emitter: Emitter,
  connections: ConnectionRegistry,
  match: RuntimeMatch,
  playerId: PlayerId,
): void {
  const player = match.state.players[playerId]
  if (player === undefined) return
  sendTo(emitter, connections, match, playerId, 'CREDITS', {
    credits: player.credits,
    spent: player.spent,
    tier: player.tier,
  })
}

// Spec §15's reveal and §10's settlement, sent once, to the room.
export function sendMatchEnd(emitter: Emitter, match: RuntimeMatch): void {
  const payload = matchEndPayload(match.state, match.state.eventLog, match.state.config)
  if (!payload.ok) {
    emitter.toRoom(match.matchId, 'MATCH_END', { ...envelope(match), error: payload.error })
    return
  }
  emitter.toRoom(match.matchId, 'MATCH_END', { ...envelope(match), ...payload.value })
}

// The first thing a player receives after JOIN, and the only message that tells them their role.
// A later JOIN for the same player is a reconnect and gets RESUME_STATE instead (CLAUDE.md §8).
export function sendMatchStarted(
  emitter: Emitter,
  match: RuntimeMatch,
  socketId: string,
  playerId: PlayerId,
): boolean {
  const view = privateView(match.state, playerId)
  if (view === null) return false
  emitter.toSocket(socketId, 'MATCH_STARTED', { matchId: match.matchId, serverTick: match.tick, view })
  return true
}
