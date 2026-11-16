import {
  createWebSocketRoomServer,
  type WebSocketRoomServerOptions,
} from './websocket.js';

/**
 * Entry point: `pnpm --filter @srd5/server start`.
 * Rooms are created dynamically by clients via `CREATE_ROOM`, so no initial
 * game state is required here.
 */
export function main(): void {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  const options: WebSocketRoomServerOptions = {
    port: Number.isFinite(port) ? port : 8787,
    host: process.env.HOST,
  };

  const running = createWebSocketRoomServer({
    ...options,
    onListening: () => {
      // eslint-disable-next-line no-console
      console.log(`[srd5-server] authoritative room server listening on port ${options.port}`);
    },
    onError: (error) => {
      // eslint-disable-next-line no-console
      console.error('[srd5-server] websocket error:', error);
    },
  });

  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
