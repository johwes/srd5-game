/**
 * Minimal ambient typings for the `ws` package used by the room server adapter.
 *
 * The full `@types/ws` package is intentionally not required: the server only
 * depends on a small, stable subset of the `ws` API. This declaration keeps the
 * package buildable and typecheckable fully offline while still describing the
 * runtime surface that `@srd5/server` relies on.
 */
declare module 'ws' {
  export interface RawData {
    toString(): string;
  }

  export class WebSocket {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this;
    on(event: 'close', listener: (code: number, reason: RawData) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
  }

  export interface WebSocketServerOptions {
    port?: number;
    host?: string;
    server?: unknown;
    maxPayload?: number;
  }

  export interface AddressInfo {
    port: number;
    address: string;
  }

  export class WebSocketServer {
    constructor(options?: WebSocketServerOptions);
    on(event: 'connection', listener: (socket: WebSocket, request: unknown) => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    close(callback?: (error?: Error) => void): void;
    address(): AddressInfo | string | null;
  }
}
