import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  type Combatant,
  type OverworldPOI,
  RealmError,
  activateOverworldShrine,
  advanceRealmDelveFloor,
  canAdvanceRealmDelve,
  completeRealmDelve,
  computeDerivedCharacter,
  createCharacterCombatant,
  generateOverworldMap,
  getBiomeForDepth,
  getRealmDelveFloorCount,
  isLairFloorCleared,
  startRealmDelve,
} from '../index.js';

/**
 * SRD-806: Deep Descent fold-in as the Realm dungeon-delver (Spec 06 §4.3).
 * Bounded dungeon POI delves with run scoring, single-floor lair clears, and
 * ancient shrine blessings — all deterministic and non-mutating.
 */

function makeParty(): Combatant[] {
  return ['pregen-fighter', 'pregen-cleric', 'pregen-rogue', 'pregen-wizard'].map((id) => {
    const build = getPregenCharacter(id)!;
    const sheet = computeDerivedCharacter(build, defaultCompendium);
    return createCharacterCombatant(sheet, { x: 0, y: 0 }, {
      side: 'party',
      teamId: 'party',
      playerId: 'player-1',
      buildState: build,
    });
  });
}

function makeMap(seed = 806) {
  return generateOverworldMap({ seed, width: 48, height: 48 }).map;
}

function findPoi(map: ReturnType<typeof makeMap>, kind: OverworldPOI['kind']): OverworldPOI {
  const poi = Object.values(map.pois).find((p) => p.kind === kind);
  if (!poi) throw new Error(`No ${kind} POI on map`);
  return poi;
}

describe('SRD-806: Realm dungeon-delver (Spec 06 Section 4.3)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  describe('Floor count & seeds', () => {
    it('lairs are a single floor; dungeon entrances roll a bounded 2–4 floors', () => {
      expect(getRealmDelveFloorCount(1, 'lair_clear')).toBe(1);
      for (let seed = 0; seed < 50; seed++) {
        const count = getRealmDelveFloorCount(seed, 'bounded_delve');
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(4);
      }
      expect(getRealmDelveFloorCount(42, 'bounded_delve')).toBe(
        getRealmDelveFloorCount(42, 'bounded_delve'),
      );
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe('Bounded dungeon delves', () => {
    it('entering a dungeon_entrance generates a bounded delve with run scoring', () => {
      const map = makeMap();
      const poi = findPoi(map, 'dungeon_entrance');
      const party = makeParty();
      const hero = party[0]!;
      const wounded = { ...hero, currentHp: Math.max(1, hero.maxHp - 6) };
      const session = startRealmDelve({
        map,
        poi,
        party: [wounded, ...party.slice(1)],
        startingRations: 10,
      });

      expect(session.delve.kind).toBe('bounded_delve');
      expect(session.delve.poiId).toBe(poi.id);
      expect(session.delve.startDepth).toBe(poi.depthTier ?? 1);
      const floors = session.delve.finalDepth - session.delve.startDepth + 1;
      expect(floors).toBeGreaterThanOrEqual(2);
      expect(floors).toBeLessThanOrEqual(4);
      expect(session.delve.score).toBeGreaterThan(0);
      expect(session.delve.suppliesRemaining).toBe(10);
      expect(session.gameState.mode).toBe('exploration');
      expect(session.gameState.dungeon).toBeDefined();
      // Biome matches the POI depth tier.
      expect(session.generatedFloor.biome).toBe(getBiomeForDepth(session.delve.startDepth));
      // Persistent party state (HP + buildState) is preserved into the delve.
      expect(session.gameState.party[wounded.id]!.currentHp).toBe(wounded.currentHp);
      for (const c of Object.values(session.gameState.party)) {
        expect(c.buildState).toBeDefined();
        expect(c.teamId).toBe('party');
      }
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('is bit-exact deterministic for identical seeds and non-mutating', () => {
      const map = makeMap(99);
      const poi = findPoi(map, 'dungeon_entrance');
      const party = makeParty();
      const before = JSON.stringify(party);
      const a = startRealmDelve({ map, poi, party });
      const b = startRealmDelve({ map, poi, party });
      expect(JSON.stringify(a.delve)).toBe(JSON.stringify(b.delve));
      expect(JSON.stringify(a.gameState.grid)).toBe(JSON.stringify(b.gameState.grid));
      expect(JSON.stringify(party)).toBe(before);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('advances through bounded floors preserving the party, then refuses past the final floor', () => {
      const map = makeMap(7);
      const poi = findPoi(map, 'dungeon_entrance');
      let session = startRealmDelve({ map, poi, party: makeParty() });
      const startDepth = session.delve.startDepth;
      let steps = 0;
      while (canAdvanceRealmDelve(session.delve)) {
        session = advanceRealmDelveFloor(session.delve, session.gameState);
        steps++;
        expect(session.delve.currentDepth).toBe(startDepth + steps);
        expect(Object.keys(session.gameState.party)).toHaveLength(4);
        expect(session.delve.poiId).toBe(poi.id);
      }
      expect(session.delve.currentDepth).toBe(session.delve.finalDepth);
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(() => advanceRealmDelveFloor(session.delve, session.gameState)).toThrow(RealmError);
    });

    it('clearing the delve produces a final score and a graveyard entry', () => {
      const map = makeMap();
      const poi = findPoi(map, 'dungeon_entrance');
      const session = startRealmDelve({ map, poi, party: makeParty() });
      const completed = completeRealmDelve(session.delve, session.gameState, { cleared: true });
      expect(completed.isComplete).toBe(true);
      expect(completed.cleared).toBe(true);
      expect(completed.score).toBeGreaterThan(0);
      expect(completed.graveyardEntry).toBeDefined();
      expect(completed.graveyardEntry!.runId).toBe(completed.runId);
      expect(completed.poiId).toBe(poi.id);
    });

    it('a party wipe marks the delve uncleared', () => {
      const map = makeMap();
      const poi = findPoi(map, 'dungeon_entrance');
      const session = startRealmDelve({ map, poi, party: makeParty() });
      const wiped = structuredClone(session.gameState);
      for (const hero of Object.values(wiped.party)) {
        hero.isDead = true;
        hero.currentHp = 0;
      }
      const completed = completeRealmDelve(session.delve, wiped, { cleared: true });
      expect(completed.cleared).toBe(false);
      expect(completed.isComplete).toBe(true);
    });
  });

  describe('Single-floor lair clears', () => {
    it('monster_lair POIs resolve as one floor with no run scoring', () => {
      const map = makeMap();
      const poi = findPoi(map, 'monster_lair');
      const session = startRealmDelve({ map, poi, party: makeParty() });
      expect(session.delve.kind).toBe('lair_clear');
      expect(session.delve.finalDepth).toBe(session.delve.startDepth);
      expect(session.delve.score).toBe(0);
      expect(canAdvanceRealmDelve(session.delve)).toBe(false);
      expect(() => advanceRealmDelveFloor(session.delve, session.gameState)).toThrow(RealmError);
    });

    it('isLairFloorCleared requires every encounter triggered and defeated', () => {
      const map = makeMap();
      const poi = findPoi(map, 'monster_lair');
      const session = startRealmDelve({ map, poi, party: makeParty() });
      expect(isLairFloorCleared(session.gameState)).toBe(false);

      const cleared = structuredClone(session.gameState);
      cleared.mode = 'exploration';
      cleared.dungeon!.encounters = cleared.dungeon!.encounters.map((e) => ({
        ...e,
        triggered: true,
      }));
      // Spawn a defeated boss monster for each encounter.
      cleared.dungeon!.encounters.forEach((e, i) => {
        cleared.monsters[`boss_${i}`] = {
          ...Object.values(cleared.party)[0]!,
          id: `boss_${i}`,
          side: 'monster',
          teamId: 'monster',
          isDead: true,
          currentHp: 0,
        };
      });
      expect(isLairFloorCleared(cleared)).toBe(true);

      const completed = completeRealmDelve(session.delve, cleared, { cleared: true });
      expect(completed.cleared).toBe(true);
      expect(completed.score).toBe(0);
      expect(completed.graveyardEntry).toBeUndefined();
    });
  });

  describe('Ancient shrine POIs', () => {
    it('rejects non-shrine POIs and applies a deterministic blessing without a delve', () => {
      const map = makeMap();
      const dungeon = findPoi(map, 'dungeon_entrance');
      const party = makeParty();
      const partyRecord: Record<string, Combatant> = {};
      for (const c of party) partyRecord[c.id] = c;
      expect(() => activateOverworldShrine(map, dungeon, partyRecord)).toThrow(RealmError);

      const shrine = findPoi(map, 'ancient_shrine');
      const a = activateOverworldShrine(map, shrine, partyRecord);
      const b = activateOverworldShrine(map, shrine, partyRecord);
      expect(a.shrineType).toBe(b.shrineType);
      expect(a.blessing).toBe(b.blessing);
      expect(a.events.some((e) => e.type === 'SHRINE_ACTIVATED')).toBe(true);
      // Input party untouched.
      expect(partyRecord[party[0]!.id]!.currentHp).toBe(party[0]!.currentHp);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('the Fountain of Restoration fully heals and cleanses the party', () => {
      const map = makeMap();
      const shrine = findPoi(map, 'ancient_shrine');
      const party = makeParty();
      const partyRecord: Record<string, Combatant> = {};
      for (const c of party) {
        partyRecord[c.id] = { ...c, currentHp: 1, conditions: ['poisoned'], exhaustionLevel: 2 };
      }
      const result = activateOverworldShrine(map, shrine, partyRecord, { seed: 2 });
      // seed 2 selects a deterministic shrine; force the fountain via search.
      let fountain = result;
      for (let seed = 0; seed < 12 && fountain.shrineType !== 'fountain_restoration'; seed++) {
        fountain = activateOverworldShrine(map, shrine, partyRecord, { seed });
      }
      expect(fountain.shrineType).toBe('fountain_restoration');
      for (const hero of Object.values(fountain.party)) {
        expect(hero.currentHp).toBe(hero.maxHp);
        expect(hero.conditions).toHaveLength(0);
        expect(hero.exhaustionLevel).toBe(0);
      }
    });
  });

  it('rejects entering a delve with an empty party or a settlement POI', () => {
    const map = makeMap();
    const poi = findPoi(map, 'dungeon_entrance');
    expect(() => startRealmDelve({ map, poi, party: [] })).toThrow(RealmError);
    const shrine = findPoi(map, 'ancient_shrine');
    expect(() => startRealmDelve({ map, poi: shrine, party: makeParty() })).toThrow(RealmError);
  });
});