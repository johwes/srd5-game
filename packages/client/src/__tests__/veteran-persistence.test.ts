import { describe, expect, it } from 'vitest';
import { getPregenCharacter, type CharacterBuildState } from '@srd5/data';
import type { VeteranRosterEntry } from '@srd5/engine';
import {
  VETERAN_ROSTER_STORAGE_KEY,
  clearVeteranRoster,
  createInMemoryRosterStorageAdapter,
  loadVeteranRoster,
  saveVeteranRoster,
} from '../persistence/veteranPersistence.js';

/**
 * SRD-1405: Veteran Roster persistence (Spec 13 §7).
 * Acceptance: snapshots persist across reloads; invalid records are dropped;
 * the roster caps at 8.
 */

function makeHero(id: string, level: number): CharacterBuildState {
  const base = structuredClone(getPregenCharacter('pregen-fighter')!);
  base.id = id;
  base.name = `Hero ${id}`;
  base.classes = base.classes.map((c) => ({
    ...c,
    level,
    hpRollsByLevel: Array.from({ length: level }, () => c.hpRollsByLevel[0] ?? 8),
  }));
  base.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  return base;
}

function makeEntry(id: string, level: number): VeteranRosterEntry {
  return {
    veteranId: id,
    hero: makeHero(id, level),
    level,
    retiredAt: '2026-11-21T00:00:00.000Z',
    runId: 'run-1',
    source: 'descent',
  };
}

describe('SRD-1405: Veteran Roster persistence', () => {
  it('round-trips snapshots through an isolated store (survives reloads)', async () => {
    const adapter = createInMemoryRosterStorageAdapter();
    const roster = [makeEntry('v1', 4), makeEntry('v2', 9)];
    await saveVeteranRoster(roster, adapter);

    const raw = await adapter.getItem(VETERAN_ROSTER_STORAGE_KEY);
    expect(Array.isArray(raw)).toBe(true);

    const loaded = await loadVeteranRoster(adapter);
    expect(loaded.map((v) => v.veteranId)).toEqual(['v1', 'v2']);
    expect(loaded[0]!.level).toBe(4);
    expect(loaded[0]!.hero.name).toBe('Hero v1');
    expect(loaded[1]!.source).toBe('descent');
  });

  it('drops invalid records on load', async () => {
    const adapter = createInMemoryRosterStorageAdapter();
    await adapter.setItem(VETERAN_ROSTER_STORAGE_KEY, [
      makeEntry('ok', 5),
      // Level-1 hero is below the retirement band.
      { ...makeEntry('low', 5), hero: makeHero('low', 1), level: 1 },
      // Epic heroes cannot retire.
      { ...makeEntry('epic', 5), hero: makeHero('epic', 15), level: 15 },
      // Corrupt hero payload.
      { veteranId: 'bad', hero: { nope: true }, level: 5, retiredAt: 'x', source: 'descent' },
      // Unknown source.
      { ...makeEntry('weird', 5), veteranId: 'weird', source: 'arena' },
      // Duplicate id keeps the first record.
      makeEntry('ok', 6),
      'not-an-object',
    ]);

    const loaded = await loadVeteranRoster(adapter);
    expect(loaded.map((v) => v.veteranId)).toEqual(['ok']);
    expect(loaded[0]!.level).toBe(5);
  });

  it('returns an empty roster when nothing is stored', async () => {
    expect(await loadVeteranRoster(createInMemoryRosterStorageAdapter())).toEqual([]);
  });

  it('trims an oversized store to the newest 8 entries', async () => {
    const adapter = createInMemoryRosterStorageAdapter();
    const ten = Array.from({ length: 10 }, (_, i) => makeEntry(`v${i}`, 3 + (i % 5)));
    await adapter.setItem(VETERAN_ROSTER_STORAGE_KEY, ten);

    const loaded = await loadVeteranRoster(adapter);
    expect(loaded).toHaveLength(8);
    expect(loaded.map((v) => v.veteranId)).toEqual([
      'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9',
    ]);
  });

  it('clears the roster', async () => {
    const adapter = createInMemoryRosterStorageAdapter();
    await saveVeteranRoster([makeEntry('v1', 4)], adapter);
    expect(await loadVeteranRoster(adapter)).toHaveLength(1);
    await clearVeteranRoster(adapter);
    expect(await loadVeteranRoster(adapter)).toEqual([]);
  });
});
