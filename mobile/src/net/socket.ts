import { io, type Socket } from 'socket.io-client'

import type { ClientEvent, ClientMessages, JoinAck, LobbyAck, ServerEvent, ServerMessages } from './messages'

// A typed Socket.IO client for PROTOCOL.md. Every type comes from protocol/generated.ts through
// net/messages.ts; nothing here redefines one.
//
// Logging rules, because this is the one file that sees every inbound payload:
//   - an unknown message type logs its *name* and is ignored — it never throws;
//   - nothing here logs a payload. MATCH_STARTED and RESUME_STATE carry a PrivateView with the
//     player's role in it (hard rule 4), and SIPHON_RESULT carries a pairing (hard rule 1).

/** The three request/response messages (PROTOCOL.md §1). Everything else is fire-and-forget. */
type AckEvent = 'CREATE_LOBBY' | 'JOIN_LOBBY' | 'JOIN'
type FireEvent = Exclude<ClientEvent, AckEvent>

type AckFor<E extends AckEvent> = E extends 'JOIN' ? JoinAck : LobbyAck

type ServerToClient = { [E in ServerEvent]: (payload: ServerMessages[E]) => void }
type ClientToServer = {
  [E in ClientEvent]: E extends AckEvent
    ? (payload: ClientMessages[E], ack: (response: AckFor<E>) => void) => void
    : (payload: ClientMessages[E]) => void
}

// Every server event, as a runtime list, so `onAny` can tell a known message from an unknown one.
// The assertion below fails to compile if protocol/generated.ts gains an event this list lacks.
const SERVER_EVENTS = [
  'LOBBY_UPDATE',
  'LOBBY_DISSOLVED',
  'MATCH_STARTED',
  'RESUME_STATE',
  'BOARD_UPDATE',
  'CHAT_MESSAGE',
  'STAGE_CHANGE',
  'CREDITS',
  'SIPHON_RESULT',
  'TRACE_RESULT',
  'VOTE_RESULT',
  'MATCH_END',
  'ACTION_REJECTED',
] as const satisfies readonly ServerEvent[]
const everyEventListed: Exclude<ServerEvent, (typeof SERVER_EVENTS)[number]> extends never ? true : false = true
void everyEventListed

const KNOWN = new Set<string>(SERVER_EVENTS)

// Socket.IO's typed overloads cannot follow a generic event name through on/off/emit. The mapped
// types above are what pin each handler and payload to its event; this is the narrow untyped
// surface the implementation calls through.
type Untyped = {
  on: (event: string, handler: (payload: never) => void) => unknown
  off: (event: string, handler: (payload: never) => void) => unknown
  emit: (event: string, payload: unknown) => unknown
  timeout: (ms: number) => { emitWithAck: (event: string, payload: unknown) => Promise<unknown> }
}

/** How long a request/response message waits for its ack before failing. */
const ACK_TIMEOUT_MS = 5000

export type ReztorClient = {
  connected: () => boolean
  connect: () => void
  disconnect: () => void
  onConnect: (handler: () => void) => () => void
  onDisconnect: (handler: () => void) => () => void
  on: <E extends ServerEvent>(event: E, handler: (payload: ServerMessages[E]) => void) => () => void
  /** Rejects on timeout or a dropped connection; the ack itself carries `ok: false` for refusals. */
  request: <E extends AckEvent>(event: E, payload: ClientMessages[E]) => Promise<AckFor<E>>
  send: <E extends FireEvent>(event: E, payload: ClientMessages[E]) => void
}

export function createClient(url: string): ReztorClient {
  // Websocket only, as the reference client does. autoConnect off: the session decides when.
  const socket: Socket<ServerToClient, ClientToServer> = io(url, { transports: ['websocket'], autoConnect: false })

  const untyped = socket as unknown as Untyped

  // The error's message only: it names the transport failure and carries no game state.
  socket.on('connect_error', (error) => console.warn('[net] connect_error', url, error.message))

  socket.onAny((event: string) => {
    if (!KNOWN.has(event)) console.warn('[net] ignoring unknown message type', event)
  })

  return {
    connected: () => socket.connected,
    connect: () => {
      socket.connect()
    },
    disconnect: () => {
      socket.disconnect()
    },

    onConnect(handler) {
      socket.on('connect', handler)
      return () => {
        socket.off('connect', handler)
      }
    },

    onDisconnect(handler) {
      socket.on('disconnect', handler)
      return () => {
        socket.off('disconnect', handler)
      }
    },

    on(event, handler) {
      untyped.on(event, handler)
      return () => {
        untyped.off(event, handler)
      }
    },

    request<E extends AckEvent>(event: E, payload: ClientMessages[E]) {
      return untyped.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload) as Promise<AckFor<E>>
    },

    send(event, payload) {
      untyped.emit(event, payload)
    },
  }
}
