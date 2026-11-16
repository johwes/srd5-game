/**
 * Wire protocol definitions live in `@srd5/transport` so the browser client
 * and the authoritative server share a single source of truth. Re-exported
 * here to preserve the `@srd5/server` public API and internal import paths.
 */
export {
  ClientMessageSchema,
  PlayerIdentitySchema,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_ERROR_CODES,
  ROOM_SERVER_PROTOCOL_VERSION,
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  serializeServerMessage,
} from '@srd5/transport';
export type {
  ClientMessage,
  ParseClientMessageResult,
  PlayerIdentity,
  RoomErrorCode,
  RoomSocket,
  ServerMessage,
} from '@srd5/transport';
