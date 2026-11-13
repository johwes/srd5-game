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
