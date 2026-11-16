import { ENGINE_VERSION } from '@srd5/engine';
import { TRANSPORT_VERSION } from '@srd5/transport';

export const SERVER_VERSION = '0.1.0' as const;

export function getServerInfo() {
  return {
    serverVersion: SERVER_VERSION,
    engineVersion: ENGINE_VERSION,
    transportVersion: TRANSPORT_VERSION,
  };
}

export * from './errors.js';
export * from './protocol.js';
export * from './room.js';
export * from './room-server.js';
export * from './websocket.js';
