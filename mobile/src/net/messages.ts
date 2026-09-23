// Re-exports the wire unions from protocol/generated.ts. Never defines a protocol type of its own:
// the generated file is emitted from the server and is the only source.
export type {
  ActionRejectedMessage,
  ClientEvent,
  ClientMessages,
  JoinAck,
  JoinTicket,
  LobbyAck,
  ServerEvent,
  ServerMessages,
} from '../../protocol/generated'
