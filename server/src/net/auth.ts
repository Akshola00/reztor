import type { PlayerId } from '../engine/state.js'
import type { Session } from '../match/lobby.js'

export const HEARTBEAT_INTERVAL_MS = 2000
// CLAUDE.md §8: three missed heartbeats at 2s.
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3

// A plain per-socket message allowance, deliberately separate from the game's token buckets
// (§5.1, §5.2). Those clamp play; this one stops a player with zero credits flooding the socket
// with batches that only ever come back rejected.
export const MESSAGE_BURST = 40
export const MESSAGE_PER_SEC = 20

export type Connection = {
  socketId: string
  matchId: string
  playerId: PlayerId
  // Any inbound message counts as a sign of life, not just HEARTBEAT.
  lastSeenAtMs: number
  closedAtMs: number | null
  tokens: number
  tokensAtMs: number
}

export type ConnectionRegistry = {
  bind(socketId: string, session: Session, nowMs: number): Connection
  bySocket(socketId: string): Connection | undefined
  byPlayer(matchId: string, playerId: PlayerId): Connection | undefined
  socketFor(matchId: string, playerId: PlayerId): string | undefined
  touch(socketId: string, nowMs: number): void
  close(socketId: string, nowMs: number): void
  forget(socketId: string): void
  allow(socketId: string, nowMs: number): boolean
  // Players whose disconnect grace should now start (CLAUDE.md §8).
  timedOut(matchId: string, nowMs: number): PlayerId[]
}

export function createConnections(): ConnectionRegistry {
  const bySocketId = new Map<string, Connection>()

  const find = (matchId: string, playerId: PlayerId): Connection | undefined => {
    for (const connection of bySocketId.values()) {
      if (connection.matchId === matchId && connection.playerId === playerId) return connection
    }
    return undefined
  }

  return {
    bind(socketId, session, nowMs) {
      // A reconnect replaces the old binding outright, so a player never holds two live sockets.
      const existing = find(session.matchId, session.playerId)
      if (existing !== undefined) bySocketId.delete(existing.socketId)

      const connection: Connection = {
        socketId,
        matchId: session.matchId,
        playerId: session.playerId,
        lastSeenAtMs: nowMs,
        closedAtMs: null,
        tokens: MESSAGE_BURST,
        tokensAtMs: nowMs,
      }
      bySocketId.set(socketId, connection)
      return connection
    },

    bySocket: (socketId) => bySocketId.get(socketId),

    byPlayer: find,

    socketFor: (matchId, playerId) => {
      const connection = find(matchId, playerId)
      return connection === undefined || connection.closedAtMs !== null ? undefined : connection.socketId
    },

    touch(socketId, nowMs) {
      const connection = bySocketId.get(socketId)
      if (connection === undefined) return
      connection.lastSeenAtMs = nowMs
      connection.closedAtMs = null
    },

    close(socketId, nowMs) {
      const connection = bySocketId.get(socketId)
      if (connection !== undefined && connection.closedAtMs === null) connection.closedAtMs = nowMs
    },

    forget: (socketId) => void bySocketId.delete(socketId),

    allow(socketId, nowMs) {
      const connection = bySocketId.get(socketId)
      if (connection === undefined) return false
      const refill = ((nowMs - connection.tokensAtMs) * MESSAGE_PER_SEC) / 1000
      connection.tokens = Math.min(MESSAGE_BURST, connection.tokens + refill)
      connection.tokensAtMs = nowMs
      if (connection.tokens < 1) return false
      connection.tokens -= 1
      return true
    },

    // CLAUDE.md §8: grace starts on the *later* of socket close and heartbeat timeout. A mobile
    // client that backgrounds and returns inside the heartbeat window never starts a grace clock.
    timedOut(matchId, nowMs) {
      const due: PlayerId[] = []
      for (const connection of bySocketId.values()) {
        if (connection.matchId !== matchId || connection.closedAtMs === null) continue
        const startsAt = Math.max(connection.closedAtMs, connection.lastSeenAtMs + HEARTBEAT_TIMEOUT_MS)
        if (nowMs >= startsAt) due.push(connection.playerId)
      }
      return due.sort()
    },
  }
}
