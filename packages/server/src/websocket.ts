import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { RoomSocket } from './protocol.js';
import { RoomServer, type RoomServerOptions } from './room-server.js';

/** Adapts a `ws` connection to the transport-agnostic `RoomSocket` interface. */
export function toRoomSocket(ws: WsSocket): RoomSocket {
  return {
    send(raw: string): void {
      ws.send(raw);
    },
    onMessage(handler: (raw: string) => void): () => void {
      const listener = (data: { toString(): string }) => handler(data.toString());
      ws.on('message', listener);
      return () => ws.off('message', listener);
    },
    onClose(handler: () => void): () => void {
      const listener = () => handler();
      ws.on('close', listener);
      return () => ws.off('close', listener);
    },
  };
}

/** A `ws.WebSocketServer`-shaped object accepted by `attachRoomServer`. */
export interface WebSocketServerLike {
  on(event: 'connection', listener: (socket: WsSocket, request: unknown) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Wires every incoming `ws` connection to an authoritative `RoomServer`.
 * Returns a detach function that stops accepting new connections.
 */
export function attachRoomServer(
  wss: WebSocketServerLike,
  roomServer: RoomServer,
): () => void {
  const detachConnections = new Set<() => void>();

  const onConnection = (ws: WsSocket): void => {
    detachConnections.add(roomServer.attachSocket(toRoomSocket(ws)));
  };
  wss.on('connection', onConnection);

  return () => {
    wss.off('connection', onConnection);
    for (const detach of detachConnections) detach();
    detachConnections.clear();
  };
}

export interface WebSocketRoomServerOptions extends RoomServerOptions {
  port: number;
  host?: string;
  onListening?: () => void;
  onError?: (error: Error) => void;
}

export interface RunningRoomServer {
  roomServer: RoomServer;
  wss: WebSocketServer;
  detach: () => void;
  close: () => Promise<void>;
}

/**
 * Starts an authoritative WebSocket room server on the given TCP port.
 * Each room hosts an isolated `@srd5/engine` GameState and broadcasts
 * per-player Fog-of-War projections to its connected clients.
 */
export function createWebSocketRoomServer(
  options: WebSocketRoomServerOptions,
): RunningRoomServer {
  const roomServer = new RoomServer(options);
  const wss = new WebSocketServer({ port: options.port, host: options.host });
  if (options.onListening) wss.on('listening', options.onListening);
  if (options.onError) wss.on('error', options.onError);

  const detach = attachRoomServer(wss, roomServer);

  return {
    roomServer,
    wss,
    detach,
    close: () =>
      new Promise<void>((resolve, reject) => {
        detach();
        wss.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
