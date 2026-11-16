import type { RoomErrorCode } from './protocol.js';

/**
 * Error raised by room operations. Carries a stable wire code so the transport
 * layer can relay a useful `ERROR` message to the offending client.
 */
export class RoomServerError extends Error {
  public readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'RoomServerError';
    this.code = code;
  }
}
