import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, getEngineMetadata } from '../index.js';

describe('@srd5/engine package setup', () => {
  it('resolves @srd5/data workspace dependency and returns engine metadata', () => {
    const meta = getEngineMetadata();
    expect(meta.engineVersion).toBe(ENGINE_VERSION);
    expect(meta.srdVersion).toBe('5.1');
    expect(meta.attribution).toContain('System Reference Document 5.1');
  });
});
