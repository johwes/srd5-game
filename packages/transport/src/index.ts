import { getEngineMetadata } from '@srd5/engine';

export const TRANSPORT_VERSION = '0.1.0' as const;

export function getTransportInfo() {
  return {
    transportVersion: TRANSPORT_VERSION,
    engine: getEngineMetadata(),
  };
}

export * from './types.js';
export * from './protocol.js';
export * from './fog.js';
export * from './ownership.js';
export * from './local.js';
export * from './websocket.js';
