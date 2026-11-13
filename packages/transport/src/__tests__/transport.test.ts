import { describe, expect, it } from 'vitest';
import { getTransportInfo, TRANSPORT_VERSION } from '../index.js';

describe('@srd5/transport package setup', () => {
  it('resolves @srd5/engine and @srd5/data workspace dependencies', () => {
    const info = getTransportInfo();
    expect(info.transportVersion).toBe(TRANSPORT_VERSION);
    expect(info.engine.srdVersion).toBe('5.1');
  });
});
