import { SRD_LEGAL_ATTRIBUTION, SRD_VERSION } from '@srd5/data';

export const ENGINE_VERSION = '0.1.0' as const;

export function getEngineMetadata() {
  return {
    engineVersion: ENGINE_VERSION,
    srdVersion: SRD_VERSION,
    attribution: SRD_LEGAL_ATTRIBUTION,
  };
}

export * from './dice/index.js';
export * from './character/index.js';
export * from './grid/index.js';
export * from './combat/index.js';
export * from './state/index.js';
export * from './dungeon/index.js';
export * from './overworld/index.js';
export * from './ai/index.js';
export * from './remix/index.js';
export * from './language/index.js';
