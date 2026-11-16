import { describe, expect, it, vi } from 'vitest';
import {
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type Combatant,
  type OverworldMap,
  type OverworldPOI,
  GeneratedOverworldBattleSchema,
  OVERWORLD_TERRAIN_TYPES,
  OverworldBattleError,
  computeDerivedCharacter,
  createCharacterCombatant,
  createOverworldTravelState,
  generateBattleTerrainGrid,
  generateOverworldBattle,
  generatePoiBattle,
  generateWildernessBattle,
  getBattleTerrainTemplate,
  getGridCell,
  getMaxCrForBattleTier,
  getWildernessCrTier,
  hasWalkablePath,
  isCellPassable,
  mixBattleSeed,
  resolveOverworldBattle,
  startOverworldBattle,
} from '../index.js';

function makeParty(count: number): Combatant[] {
  const ids = ['pregen-fighter', 'pregen-cleric', 'pregen-rogue', 'pregen-wizard'];
  return ids.slice(0, count).map((id) => {
    const build = getPregenCharacter(id)!;
    const sheet = computeDerivedCharacter(build, defaultCompendium);
    return createCharacterCombatant(sheet, { x: 0, y: 0 }, {
      side: 'party',
      teamId: 'party',
      buildState: build,
    });
  });
}

function smallMap(): OverworldMap {
  const tiles: OverworldMap['tiles'] = {};
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 3; q++) {
      tiles[`${q},${r}`] = { q, r, terrain: 'plains', movementCost: 1, elevation: 0.5 };
    }
  }
  tiles['1,1'] = { q: 1, r: 1, terrain: 'forest', movementCost: 1.5, elevation: 0.5 };
  return {
    worldSeed: 1234,
    worldName: 'BattleRealm',
    width: 3,
    height: 3,
    tiles,
    pois: {},
    factions: {},
  };
}

describe('SRD-804: Seamless Overworld-to-Tactical battle generator (Spec 06 Section 4.2)', () => {
  describe('Terrain-to-tactical translation templates', () => {
    it('defines a resolvable SRD monster pool for every overworld terrain', () => {
      for (const terrain of OVERWORLD_TERRAIN_TYPES) {
        const template = getBattleTerrainTemplate(terrain);
        expect(template.monsterPool.length).toBeGreaterThan(0);
        expect(template.bossPool.length).toBeGreaterThan(0);
        for (const id of [...template.monsterPool, ...template.bossPool]) {
          expect(defaultCompendium.getMonster(id)).toBeDefined();
        }
      }
    });

    it('maps forest, mountains and swamp terrain to canonical tactical features', () => {
      const forest = getBattleTerrainTemplate('forest');
      expect(forest.obstacleTerrain).toBe('wall_solid'); // Trees: full cover.
      expect(forest.hazardTerrain).toBe('rubble'); // Bushes: difficult terrain / light cover.

      const mountains = getBattleTerrainTemplate('mountains');
      expect(mountains.hazardTerrain).toBe('chasm');
      expect(mountains.elevationPlateaus).toBe(true);

      const swamp = getBattleTerrainTemplate('swamp');
      expect(swamp.hazardTerrain).toBe('water_shallow');
      expect(swamp.defaultLight).toBe('dim'); // Mist / light obscurement.
    });

    it('emits a 24x24 grid with terrain obstacles, hazards, elevation and ambient light', () => {
      const { grid, partySpawnCells, monsterSpawnCells } = generateBattleTerrainGrid('mountains', 99);
      expect(grid.width).toBe(24);
      expect(grid.height).toBe(24);
      expect(grid.cells).toHaveLength(24 * 24);
      expect(partySpawnCells).toHaveLength(4);
      expect(monsterSpawnCells.length).toBeGreaterThanOrEqual(4);

      expect(grid.cells.some((c) => c.terrain === 'chasm')).toBe(true);
      expect(grid.cells.some((c) => c.terrain === 'wall_solid')).toBe(true);
      expect(grid.cells.some((c) => c.elevationFeet && c.elevationFeet > 0)).toBe(true);

      const swampGrid = generateBattleTerrainGrid('swamp', 99).grid;
      expect(swampGrid.cells.some((c) => c.terrain === 'water_shallow')).toBe(true);
      expect(getGridCell(swampGrid, 0, 12)?.baseLight).toBe('dim');
    });

    it('keeps every party and monster spawn cell mutually reachable', () => {
      for (const terrain of OVERWORLD_TERRAIN_TYPES) {
        for (const seed of [1, 7, 12345]) {
          const { grid, partySpawnCells, monsterSpawnCells } = generateBattleTerrainGrid(terrain, seed);
          for (const partySpawn of partySpawnCells) {
            expect(isCellPassable(getGridCell(grid, partySpawn.x, partySpawn.y)!)).toBe(true);
            for (const monsterSpawn of monsterSpawnCells) {
              expect(hasWalkablePath(grid, partySpawn, monsterSpawn)).toBe(true);
            }
          }
        }
      }
    });

    it('uses only the seeded PRNG (never Math.random)', () => {
      const spy = vi.spyOn(Math, 'random');
      generateBattleTerrainGrid('forest', 5);
      generateOverworldBattle({ seed: 5, terrain: 'forest' });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('Battle descriptor generation', () => {
    it('is bit-exact deterministic for a seed and varies with the seed', () => {
      const config = { seed: 42, terrain: 'forest' as const, origin: 'wilderness' as const };
      const first = generateOverworldBattle(config);
      const replay = generateOverworldBattle(config);
      expect(first).toEqual(replay);
      expect(GeneratedOverworldBattleSchema.safeParse(first).success).toBe(true);

      const different = generateOverworldBattle({ ...config, seed: 43 });
      expect(different.grid.cells).not.toEqual(first.grid.cells);
    });

    it('filters the monster pool by danger tier CR and validates all references', () => {
      expect(getMaxCrForBattleTier(1)).toBe(0.5);
      expect(getMaxCrForBattleTier(5)).toBe(5);

      const battle = generateOverworldBattle({
        seed: 7,
        terrain: 'plains',
        crTier: 1,
        monsterPool: ['adult-black-dragon', 'goblin', 'bandit'],
      });
      expect(battle.monsters.length).toBeGreaterThan(0);
      for (const spawn of battle.monsters) {
        expect(['goblin', 'bandit']).toContain(spawn.monsterId);
        expect(defaultCompendium.getMonster(spawn.monsterId)).toBeDefined();
        expect(battle.grid.cells[spawn.position.y * battle.grid.width + spawn.position.x]).toBeDefined();
      }
    });

    it('places a themed boss first for lair and dungeon-entry battles', () => {
      const bossPool = getBattleTerrainTemplate('forest').bossPool;
      const lair = generateOverworldBattle({
        seed: 9,
        terrain: 'forest',
        origin: 'monster_lair',
        crTier: 2,
      });
      expect(bossPool).toContain(lair.monsters[0]!.monsterId);

      const entry = generateOverworldBattle({
        seed: 9,
        terrain: 'forest',
        origin: 'dungeon_entrance',
        crTier: 2,
      });
      expect(bossPool).toContain(entry.monsters[0]!.monsterId);
    });
  });

  describe('Overworld context integration (SRD-802 / SRD-803)', () => {
    it('derives deterministic wilderness seeds from world seed, day and position', () => {
      const map = smallMap();
      const travel = createOverworldTravelState(map, {
        seed: 1234,
        start: { q: 1, r: 1 },
        weatherEnabled: false,
      });
      const battle = generateWildernessBattle(map, travel, 4);
      expect(battle.terrain).toBe('forest');
      expect(battle.origin).toBe('wilderness');
      expect(battle.seed).toBe(
        mixBattleSeed(1234, travel.currentDay, 1, 1, travel.rngState),
      );
      expect(battle).toEqual(generateWildernessBattle(map, travel, 4));

      const later = { ...travel, currentDay: travel.currentDay + 1 };
      expect(generateWildernessBattle(map, later, 4).seed).not.toBe(battle.seed);
      expect(getWildernessCrTier(4)).toBeGreaterThan(getWildernessCrTier(1));

      const oceanMap = smallMap();
      oceanMap.tiles['1,1'] = { q: 1, r: 1, terrain: 'ocean', movementCost: 99, elevation: 0 };
      expect(() =>
        generateWildernessBattle(oceanMap, travel, 4),
      ).toThrow(OverworldBattleError);
    });

    it('generates lair and dungeon POI entry battles from POI seeds and depth tiers', () => {
      const map = smallMap();
      const lair: OverworldPOI = {
        id: 'wolf-den',
        name: 'Wolf Den',
        kind: 'monster_lair',
        q: 1,
        r: 0,
        dungeonSeed: 77,
        depthTier: 2,
      };
      const lairBattle = generatePoiBattle(map, lair, 4);
      expect(lairBattle.origin).toBe('monster_lair');
      expect(lairBattle.seed).toBe(77);
      expect(lairBattle.poiId).toBe('wolf-den');
      expect(lairBattle.crTier).toBe(3);
      expect(lairBattle.monsters).toHaveLength(1);

      const dungeon: OverworldPOI = {
        ...lair,
        id: 'sunken-gate',
        kind: 'dungeon_entrance',
        dungeonSeed: 88,
        depthTier: 3,
      };
      const entryBattle = generatePoiBattle(map, dungeon, 4);
      expect(entryBattle.origin).toBe('dungeon_entrance');
      expect(entryBattle.seed).toBe(88);
      expect(entryBattle.crTier).toBe(3);
      expect(entryBattle.monsters).toHaveLength(2);

      expect(() => generatePoiBattle(map, { ...lair, kind: 'town' }, 4)).toThrow(
        OverworldBattleError,
      );
    });
  });

  describe('Seamless combat entry and victory reconciliation', () => {
    it('starts initiative-driven combat on the generated grid without mutating the party', () => {
      const battle = generateOverworldBattle({ seed: 101, terrain: 'forest', partySize: 2 });
      const party = makeParty(2);
      party[0]!.currentHp = 9;
      const snapshot = JSON.stringify(party);

      const session = startOverworldBattle({ battle, party });
      expect(session.gameState.mode).toBe('combat');
      expect(session.gameState.combat).not.toBeNull();
      expect(session.gameState.grid).toBe(battle.grid);
      expect(Object.keys(session.gameState.party)).toHaveLength(2);
      expect(Object.keys(session.gameState.monsters)).toHaveLength(battle.monsters.length);
      expect(JSON.stringify(party)).toBe(snapshot);

      const hero = party[0]!;
      expect(session.gameState.party[hero.id]!.currentHp).toBe(9);
      expect(session.gameState.party[hero.id]!.position).toEqual(battle.partySpawnCells[0]);
      for (const spawn of battle.monsters) {
        expect(session.gameState.monsters[spawn.instanceId]!.position).toEqual(spawn.position);
        expect(session.gameState.monsters[spawn.instanceId]!.teamId).toBe('monster');
      }
      expect(session.gameState.combat!.initiativeOrder).toHaveLength(2 + battle.monsters.length);
      expect(session.events.some((e) => e.type === 'MODE_CHANGED')).toBe(true);
      expect(session.events.some((e) => e.type === 'COMBAT_STARTED')).toBe(true);

      const replay = startOverworldBattle({ battle, party });
      expect(replay.gameState.combat!.initiativeOrder).toEqual(
        session.gameState.combat!.initiativeOrder,
      );
      expect(replay.gameState.rngState).toBe(session.gameState.rngState);
    });

    it('commits XP and gold back to the persistent party on victory', () => {
      const battle = generateOverworldBattle({ seed: 202, terrain: 'plains', partySize: 2 });
      const party = makeParty(2);
      const session = startOverworldBattle({ battle, party });

      const ended = structuredClone(session.gameState);
      for (const monster of Object.values(ended.monsters)) {
        monster.currentHp = 0;
        monster.isDead = true;
      }
      ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'party_victory' };
      const baseGold = party[0]!.buildState!.currency.gp;

      const resolution = resolveOverworldBattle(ended);
      expect(resolution.nextState.mode).toBe('exploration');
      expect(resolution.nextState.combat).toBeNull();
      expect(resolution.totalXp).toBeGreaterThan(0);
      expect(resolution.goldAwarded).toBe(Math.floor(resolution.totalXp * 0.1));
      expect(resolution.survivingHeroIds).toHaveLength(2);
      expect(resolution.events.some((e) => e.type === 'ENCOUNTER_VICTORY')).toBe(true);

      const heroId = party[0]!.id;
      expect(resolution.nextState.party[heroId]!.buildState!.currency.gp).toBeGreaterThanOrEqual(
        baseGold + Math.floor(resolution.goldAwarded / 2),
      );
      expect(ended.mode).toBe('combat'); // Input state is not mutated.

      expect(() => resolveOverworldBattle(session.gameState)).not.toThrow();
    });
  });
});
