import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { MVP_CONFIG, type MatchConfig } from '../engine/config.js'
import type { EventOf } from '../engine/events.js'
import { err, ok, type Result } from '../engine/result.js'
import { deriveImpostor } from '../engine/rules.js'
import type { PlayerId } from '../engine/state.js'
import { consoleLogger, type Logger } from '../log.js'
import type { EscrowProvider } from './escrow.js'
import type { MatchRegistry, RuntimeMatch } from './registry.js'

export const LOBBY_SIZE = 4

// No I, O, 0 or 1: an invite code gets read aloud and typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 4

export type LobbySeat = { playerId: PlayerId; name: string; wallet: string | null; seatedAtMs: number }

export type Lobby = {
  code: string
  matchId: string
  seats: LobbySeat[]
  createdAtMs: number
  // Set while escrow locks for the fourth seat. The seats are committed from then on, so none
  // may be vacated underneath the lock.
  filling: boolean
}

export type DissolveReason = 'TIMEOUT' | 'ESCROW_FAILED'

// LOBBY_UPDATE's payload. Names and public player ids only: an id is already on every
// BOARD_UPDATE and cannot impersonate anyone (CLAUDE.md §8), and it is how a client finds its
// own row. No wallets, no session tokens.
export type LobbyView = {
  code: string
  seated: number
  capacity: number
  players: { seated: number; id: PlayerId; name: string }[]
  // Server epoch ms. Sent with the server's clock rather than as a bare deadline, because an
  // absolute time compared with the phone's clock is exactly as wrong as the clock skew.
  expiresAt: number
  serverNow: number
}

export function lobbyView(lobby: Lobby, config: MatchConfig, nowMs: number): LobbyView {
  return {
    code: lobby.code,
    seated: lobby.seats.length,
    capacity: LOBBY_SIZE,
    players: lobby.seats.map(({ playerId, name }, index) => ({ seated: index + 1, id: playerId, name })),
    expiresAt: lobby.createdAtMs + config.lobbyFillTimeoutSec * 1000,
    serverNow: nowMs,
  }
}

// Binds a socket to a player (CLAUDE.md §8). playerId is never read from a message payload.
export type Session = { matchId: string; playerId: PlayerId }

export type JoinTicket = {
  code: string
  matchId: string
  playerId: PlayerId
  sessionToken: string
  seated: number
  started: boolean
}

export type LobbyError = 'UNKNOWN_CODE' | 'LOBBY_FULL' | 'ESCROW_FAILED'

export type LobbyService = {
  create(name: string, wallet?: string | null): Promise<Result<JoinTicket, LobbyError>>
  join(code: string, name: string, wallet?: string | null): Promise<Result<JoinTicket, LobbyError>>
  resolveSession(sessionToken: string): Session | undefined
  byMatch(matchId: string): Lobby | undefined
  // Gives up a seat before the match starts. Its session goes with it.
  vacate(matchId: string, playerId: PlayerId): boolean
  // Dissolves lobbies past the fill timeout; returns the codes that went. Driven by the tick loop.
  sweep(nowMs: number): string[]
  open(): Lobby[]
}

export type LobbyOptions = {
  registry: MatchRegistry
  escrow: EscrowProvider
  config?: MatchConfig
  logger?: Logger
  now?: () => number
  onMatchStart?: (match: RuntimeMatch) => void
  // A seat was taken or given up.
  onChange?: (lobby: Lobby) => void
  // Called before the lobby is discarded, so the room can still be told.
  onDissolve?: (lobby: Lobby, reason: DissolveReason) => void
}

export function createLobbyService({
  registry,
  escrow,
  config = MVP_CONFIG,
  logger = consoleLogger,
  now = () => Date.now(),
  onMatchStart,
  onChange,
  onDissolve,
}: LobbyOptions): LobbyService {
  const lobbies = new Map<string, Lobby>()
  const sessions = new Map<string, Session>()

  const newCode = (): string => {
    for (;;) {
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
      if (!lobbies.has(code)) return code
    }
  }

  const dissolve = (code: string, reason: DissolveReason): void => {
    const lobby = lobbies.get(code)
    if (lobby === undefined) return
    onDissolve?.(lobby, reason)
    for (const [token, session] of sessions) {
      if (session.matchId === lobby.matchId) sessions.delete(token)
    }
    lobbies.delete(code)
  }

  // The 4th seat fills the lobby: escrow locks, roles are assigned, and only then does the match
  // start (CLAUDE.md §3 — nothing before ESCROWED has any on-chain effect).
  const fill = async (lobby: Lobby): Promise<Result<RuntimeMatch, LobbyError>> => {
    const locked = await escrow.lock(
      lobby.matchId,
      lobby.seats.map(({ playerId, wallet }) => ({ playerId, wallet })),
      config.buyInSkr,
    )
    if (!locked.ok) {
      logger('error', 'escrow lock failed, dissolving lobby', { matchId: lobby.matchId, error: locked.error })
      dissolve(lobby.code, 'ESCROW_FAILED')
      return err('ESCROW_FAILED')
    }

    const roleSeed = randomBytes(32).toString('hex')
    const impostor = deriveImpostor(
      roleSeed,
      lobby.seats.map((seat) => seat.playerId),
    )
    // deriveImpostor only fails on a malformed seed or an empty lobby, neither of which can
    // happen here; treating it as fatal beats inventing a fallback role assignment.
    if (!impostor.ok) throw new Error(`Role assignment failed: ${impostor.error}`)

    const started: EventOf<'MATCH_STARTED'> = {
      type: 'MATCH_STARTED',
      tick: 0,
      matchId: lobby.matchId,
      config,
      players: lobby.seats.map(({ playerId, name, wallet }) => ({ id: playerId, name, wallet })),
      impostorId: impostor.value,
      roleSeed,
    }

    const match = registry.start(started)
    lobbies.delete(lobby.code)
    logger('info', 'match started', { matchId: lobby.matchId, tick: 0, players: lobby.seats.length })
    onMatchStart?.(match)
    return ok(match)
  }

  const seat = async (lobby: Lobby, name: string, wallet: string | null): Promise<Result<JoinTicket, LobbyError>> => {
    const playerId = `p_${randomUUID().slice(0, 8)}`
    const sessionToken = randomBytes(24).toString('hex')
    lobby.seats.push({ playerId, name, wallet, seatedAtMs: now() })
    sessions.set(sessionToken, { matchId: lobby.matchId, playerId })

    const ticket: JoinTicket = {
      code: lobby.code,
      matchId: lobby.matchId,
      playerId,
      sessionToken,
      seated: lobby.seats.length,
      started: false,
    }

    onChange?.(lobby)
    if (lobby.seats.length < LOBBY_SIZE) return ok(ticket)

    lobby.filling = true
    const filled = await fill(lobby)
    return filled.ok ? ok({ ...ticket, started: true }) : err(filled.error)
  }

  return {
    async create(name, wallet = null) {
      const lobby: Lobby = { code: newCode(), matchId: randomUUID(), seats: [], createdAtMs: now(), filling: false }
      lobbies.set(lobby.code, lobby)
      logger('info', 'lobby created', { matchId: lobby.matchId, code: lobby.code })
      return seat(lobby, name, wallet)
    },

    async join(code, name, wallet = null) {
      const lobby = lobbies.get(code.toUpperCase())
      if (lobby === undefined) return err('UNKNOWN_CODE')
      if (lobby.filling || lobby.seats.length >= LOBBY_SIZE) return err('LOBBY_FULL')
      return seat(lobby, name, wallet)
    },

    resolveSession: (sessionToken) => sessions.get(sessionToken),

    byMatch: (matchId) => [...lobbies.values()].find((lobby) => lobby.matchId === matchId),

    // An emptied lobby is left for the fill timeout rather than discarded: its code still works,
    // and whoever joins next simply takes the first seat.
    vacate(matchId, playerId) {
      const lobby = [...lobbies.values()].find((candidate) => candidate.matchId === matchId)
      if (lobby === undefined || lobby.filling) return false
      const index = lobby.seats.findIndex((seat) => seat.playerId === playerId)
      if (index === -1) return false
      lobby.seats.splice(index, 1)
      for (const [token, session] of sessions) {
        if (session.matchId === matchId && session.playerId === playerId) sessions.delete(token)
      }
      logger('info', 'lobby seat vacated', { matchId, playerId, code: lobby.code })
      onChange?.(lobby)
      return true
    },

    // CLAUDE.md §3: on timeout the lobby dissolves. No escrow was taken, so there is nothing to
    // refund and nothing on chain to undo; the room is told so it does not find out from a failed JOIN.
    sweep(nowMs) {
      const deadline = config.lobbyFillTimeoutSec * 1000
      const expired = [...lobbies.values()].filter((lobby) => nowMs - lobby.createdAtMs >= deadline)
      for (const lobby of expired) {
        logger('info', 'lobby fill timed out', { matchId: lobby.matchId, code: lobby.code })
        dissolve(lobby.code, 'TIMEOUT')
      }
      return expired.map((lobby) => lobby.code)
    },

    open: () => [...lobbies.values()],
  }
}
