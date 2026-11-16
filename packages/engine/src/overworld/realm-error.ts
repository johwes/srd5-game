/**
 * Error raised by the Realm (Overworld) economy subsystem: faction reputation,
 * settlements, shops, and quest boards (SRD-803).
 */
export class RealmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealmError';
  }
}
