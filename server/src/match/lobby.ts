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

// How long the four players have to sign their stake once the lobby fills.
export const STAKE_TIMEOUT_MS = 90_000

export type LobbySeat = { playerId: PlayerId; name: string; wallet: string | null; seatedAtMs: number }

// Set once escrow is open and a seat has to sign before the match can start.
export type Funding = { staked: PlayerId[]; expiresAt: number }

export type Lobby = {
  code: string
  matchId: string
  seats: LobbySeat[]
  createdAtMs: number
  // Set while escrow opens and funds for the fourth seat. The seats are committed from then on,
  // so none may be vacated, and the fill timeout no longer applies.
  filling: boolean
  chainMatchId: bigint | null
  funding: Funding | null
}

export type DissolveReason = 'TIMEOUT' | 'ESCROW_FAILED' | 'STAKE_TIMEOUT'

// STAKE_REQUEST's payload. expiresAt is server epoch ms, sent with the server's clock for the same
// reason as LobbyView's.
export type StakeRequest = { tx: string; expiresAt: number; serverNow: number }

// Seat numbers, as LobbyView numbers them. A seat is public and paying reveals no role.
export function stakedSeats(lobby: Lobby): number[] {
  const staked = lobby.funding?.staked ?? []
  return lobby.seats.flatMap((seat, index) => (staked.includes(seat.playerId) ? [index + 1] : []))
}

// Chain mode's gate on who may sit down. Absent in fake mode, where wallets stay optional.
export type WalletPolicy = {
  isAddress(wallet: string): boolean
  // At least the buy-in in the mint and enough SOL for the join fee.
  isFunded(wallet: string): Promise<boolean>
}

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

export type LobbyError = 'UNKNOWN_CODE' | 'LOBBY_FULL' | 'ESCROW_FAILED' | 'WALLET_UNFUNDED' | 'WALLET_TAKEN'

export type LobbyService = {
  create(name: string, wallet?: string | null): Promise<Result<JoinTicket, LobbyError>>
  join(code: string, name: string, wallet?: string | null): Promise<Result<JoinTicket, LobbyError>>
  resolveSession(sessionToken: string): Session | undefined
  byMatch(matchId: string): Lobby | undefined
  // A fresh STAKE_REQUEST for a seat that has yet to pay, or null when there is nothing to sign.
  stakeRequest(matchId: string, playerId: PlayerId): Promise<StakeRequest | null>
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
  // One seat's transaction to sign, for that player only.
  onStakeRequest?: (lobby: Lobby, playerId: PlayerId, request: StakeRequest) => void
  // The seats that have paid so far, whenever that changes.
  onStakeUpdate?: (lobby: Lobby, staked: number[]) => void
  wallets?: WalletPolicy
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
  onStakeRequest,
  onStakeUpdate,
  wallets,
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

  // Escrow is open by now, so a lobby that goes has to give the money back first. Void before telling
  // the room: LOBBY_DISSOLVED must never arrive while a stake is still held.
  const abandon = async (lobby: Lobby, reason: DissolveReason): Promise<void> => {
    const voided = await escrow.void(lobby.matchId, reason)
    if (!voided.ok) {
      logger('error', 'escrow void failed for a dissolving lobby', {
        matchId: lobby.matchId,
        chainMatchId: String(lobby.chainMatchId),
        error: voided.error,
      })
    }
    dissolve(lobby.code, reason)
  }

  // Roles are assigned only now, once every seat has paid (CLAUDE.md §3: ESCROWED comes first).
  const start = (lobby: Lobby): RuntimeMatch => {
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
    return match
  }

  // The funding stage, run in the background so the fourth seat's ack does not wait on it. The
  // guarded provider always answers, so this always ends in a start or a dissolve.
  const fund = async (lobby: Lobby): Promise<void> => {
    const funded = await escrow.awaitFunded(lobby.matchId, STAKE_TIMEOUT_MS, (staked) => {
      if (lobby.funding === null || !lobbies.has(lobby.code)) return
      lobby.funding.staked = [...staked]
      onStakeUpdate?.(lobby, stakedSeats(lobby))
    })
    if (funded.ok) {
      start(lobby)
      return
    }
    logger('warn', 'stakes not funded, voiding', {
      matchId: lobby.matchId,
      chainMatchId: String(lobby.chainMatchId),
      staked: stakedSeats(lobby),
      error: funded.error,
    })
    await abandon(lobby, 'STAKE_TIMEOUT')
  }

  // The 4th seat fills the lobby and escrow opens. When nobody has to sign (the fake) the lobby
  // funds and starts before this returns, exactly as it always has; otherwise each player is asked
  // to sign and the match starts later, once all four have paid. Resolves to whether it started.
  const fill = async (lobby: Lobby): Promise<Result<boolean, LobbyError>> => {
    const opened = await escrow.open(
      lobby.matchId,
      lobby.seats.map(({ playerId, wallet }) => ({ playerId, wallet })),
    )
    if (!opened.ok) {
      logger('error', 'escrow open failed, dissolving lobby', { matchId: lobby.matchId, error: opened.error })
      dissolve(lobby.code, 'ESCROW_FAILED')
      return err('ESCROW_FAILED')
    }
    lobby.chainMatchId = opened.value.chainMatchId

    const txs: (string | null)[] = []
    for (const built of await Promise.all(lobby.seats.map((seat) => escrow.joinTxFor(lobby.matchId, seat.wallet)))) {
      if (!built.ok) {
        logger('error', 'join transaction could not be built, dissolving lobby', {
          matchId: lobby.matchId,
          error: built.error,
        })
        await abandon(lobby, 'ESCROW_FAILED')
        return err('ESCROW_FAILED')
      }
      txs.push(built.value)
    }

    if (txs.every((tx) => tx === null)) {
      const funded = await escrow.awaitFunded(lobby.matchId, STAKE_TIMEOUT_MS)
      if (!funded.ok) {
        logger('error', 'escrow did not fund, dissolving lobby', { matchId: lobby.matchId, error: funded.error })
        await abandon(lobby, 'ESCROW_FAILED')
        return err('ESCROW_FAILED')
      }
      start(lobby)
      return ok(true)
    }

    const nowMs = now()
    lobby.funding = { staked: [], expiresAt: nowMs + STAKE_TIMEOUT_MS }
    logger('info', 'funding stage started', { matchId: lobby.matchId, chainMatchId: String(lobby.chainMatchId) })
    lobby.seats.forEach((seat, index) => {
      const tx = txs[index]
      if (tx === null || tx === undefined || lobby.funding === null) return
      onStakeRequest?.(lobby, seat.playerId, { tx, expiresAt: lobby.funding.expiresAt, serverNow: nowMs })
    })
    void fund(lobby).catch((error: unknown) => {
      logger('error', 'funding stage failed', {
        matchId: lobby.matchId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return ok(false)
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
    return filled.ok ? ok({ ...ticket, started: filled.value }) : err(filled.error)
  }

  // Chain mode only. Checked before the lobby is even looked up, so the await cannot race a seat.
  const walletRefusal = async (wallet: string | null): Promise<LobbyError | null> => {
    if (wallets === undefined || wallet === null) return null
    try {
      return (await wallets.isFunded(wallet)) ? null : 'WALLET_UNFUNDED'
    } catch (error) {
      // The balance could not be read, which says nothing about the wallet. Refuse as an escrow
      // failure, and never leave the ack unanswered.
      logger('error', 'wallet balance check failed', { error: error instanceof Error ? error.message : String(error) })
      return 'ESCROW_FAILED'
    }
  }

  // The chain allowlists four distinct wallets, so a repeat would only fail later, at create_match,
  // and take the other three seats down with it.
  const walletTaken = (lobby: Lobby, wallet: string | null): boolean =>
    wallets !== undefined && wallet !== null && lobby.seats.some((seat) => seat.wallet === wallet)

  return {
    async create(name, wallet = null) {
      const refused = await walletRefusal(wallet)
      if (refused !== null) return err(refused)
      const lobby: Lobby = {
        code: newCode(),
        matchId: randomUUID(),
        seats: [],
        createdAtMs: now(),
        filling: false,
        chainMatchId: null,
        funding: null,
      }
      lobbies.set(lobby.code, lobby)
      logger('info', 'lobby created', { matchId: lobby.matchId, code: lobby.code })
      return seat(lobby, name, wallet)
    },

    async join(code, name, wallet = null) {
      const refused = await walletRefusal(wallet)
      if (refused !== null) return err(refused)
      const lobby = lobbies.get(code.toUpperCase())
      if (lobby === undefined) return err('UNKNOWN_CODE')
      if (lobby.filling || lobby.seats.length >= LOBBY_SIZE) return err('LOBBY_FULL')
      if (walletTaken(lobby, wallet)) return err('WALLET_TAKEN')
      return seat(lobby, name, wallet)
    },

    resolveSession: (sessionToken) => sessions.get(sessionToken),

    byMatch: (matchId) => [...lobbies.values()].find((lobby) => lobby.matchId === matchId),

    // Built fresh rather than replayed: a transaction's blockhash lasts about as long as the whole
    // funding stage, so a player who reconnects late needs one that can still land.
    async stakeRequest(matchId, playerId) {
      const lobby = [...lobbies.values()].find((candidate) => candidate.matchId === matchId)
      const funding = lobby?.funding
      if (lobby === undefined || funding == null || funding.staked.includes(playerId)) return null
      const seated = lobby.seats.find((candidate) => candidate.playerId === playerId)
      if (seated === undefined) return null
      const built = await escrow.joinTxFor(matchId, seated.wallet)
      if (!built.ok || built.value === null) return null
      return { tx: built.value, expiresAt: funding.expiresAt, serverNow: now() }
    },

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

    // CLAUDE.md §3: on timeout the lobby dissolves. Escrow opens only once the fourth seat fills,
    // so there is nothing to refund and nothing on chain to undo; the room is told so it does not
    // find out from a failed JOIN. A filling lobby is past the fill timeout's reach: the funding
    // stage has its own deadline, and dissolving here would strand whatever was already staked.
    sweep(nowMs) {
      const deadline = config.lobbyFillTimeoutSec * 1000
      const expired = [...lobbies.values()].filter(
        (lobby) => !lobby.filling && nowMs - lobby.createdAtMs >= deadline,
      )
      for (const lobby of expired) {
        logger('info', 'lobby fill timed out', { matchId: lobby.matchId, code: lobby.code })
        dissolve(lobby.code, 'TIMEOUT')
      }
      return expired.map((lobby) => lobby.code)
    },

    open: () => [...lobbies.values()],
  }
}
