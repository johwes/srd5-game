import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type DungeonFloorSpec,
  DungeonFloorSpecSchema,
  createDungeonGameState,
  generateDungeonFloor,
  getBiomeForDepth,
  getBiomeTheme,
  verifyDungeonConnectivity,
  findPathBfs,
} from '../index.js';

function makePartyMember(id: string, name: string): Combatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x: 0, y: 0 },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
  };
}

describe('SRD-508: Procedural DungeonGenerator & Guaranteed BFS Connectivity', () => {
  describe('Biome Tiers & Depth Mapping (Spec 06 Section 3.1)', () => {
    it('maps depths to canonical biomes correctly', () => {
      expect(getBiomeForDepth(1)).toBe('catacombs');
      expect(getBiomeForDepth(2)).toBe('catacombs');
      expect(getBiomeForDepth(3)).toBe('catacombs');

      expect(getBiomeForDepth(4)).toBe('sunken_tombs');
      expect(getBiomeForDepth(5)).toBe('sunken_tombs');
      expect(getBiomeForDepth(6)).toBe('sunken_tombs');

      expect(getBiomeForDepth(7)).toBe('magma_caverns');
      expect(getBiomeForDepth(8)).toBe('magma_caverns');
      expect(getBiomeForDepth(9)).toBe('magma_caverns');

      expect(getBiomeForDepth(10)).toBe('deep_vaults');
      expect(getBiomeForDepth(11)).toBe('deep_vaults');
      expect(getBiomeForDepth(12)).toBe('deep_vaults');

      expect(getBiomeForDepth(13)).toBe('abyssal_rift');
      expect(getBiomeForDepth(20)).toBe('abyssal_rift');
    });

    it('returns distinctive biome themes and aesthetics', () => {
      const catacombs = getBiomeTheme('catacombs');
      expect(catacombs.name).toBe('The Catacombs');
      expect(catacombs.defaultLight).toBe('dim');
      expect(catacombs.trapType.damageType).toBe('bludgeoning');

      const tombs = getBiomeTheme('sunken_tombs');
      expect(tombs.name).toBe('The Sunken Tombs');
      expect(tombs.hazardTerrain).toBe('water_shallow');
      expect(tombs.trapType.damageType).toBe('poison');

      const magma = getBiomeTheme('magma_caverns');
      expect(magma.hazardTerrain).toBe('lava');
      expect(magma.trapType.damageType).toBe('fire');

      const vaults = getBiomeTheme('deep_vaults');
      expect(vaults.trapType.damageType).toBe('lightning');

      const rift = getBiomeTheme('abyssal_rift');
      expect(rift.hazardTerrain).toBe('chasm');
      expect(rift.trapType.damageType).toBe('necrotic');
    });
  });

  describe('Deterministic Seeded PRNG Replay', () => {
    it('produces 100% bit-exact identical dungeons when given identical seed and config', () => {
      const config = {
        depth: 2,
        seed: 987654321,
        width: 36,
        height: 36,
        targetRoomCount: 5,
      };

      const run1 = generateDungeonFloor(config);
      const run2 = generateDungeonFloor(config);

      expect(JSON.stringify(run1.floor)).toBe(JSON.stringify(run2.floor));
      expect(run1.stairsUp).toEqual(run2.stairsUp);
      expect(run1.stairsDown).toEqual(run2.stairsDown);
      expect(run1.nextRngState).toBe(run2.nextRngState);
    });

    it('produces different layouts when seeds differ', () => {
      const config1 = { depth: 1, seed: 11111, width: 36, height: 36 };
      const config2 = { depth: 1, seed: 22222, width: 36, height: 36 };

      const run1 = generateDungeonFloor(config1);
      const run2 = generateDungeonFloor(config2);

      expect(JSON.stringify(run1.floor)).not.toBe(JSON.stringify(run2.floor));
    });
  });

  describe('BSP Room Generation & Non-Overlapping Layout', () => {
    it('subdivides grid and generates non-overlapping rooms within bounds', () => {
      const generated = generateDungeonFloor({
        depth: 1,
        seed: 42,
        width: 40,
        height: 40,
        targetRoomCount: 6,
      });

      const { floor } = generated;
      expect(DungeonFloorSpecSchema.safeParse(floor).success).toBe(true);
      expect(floor.rooms).toBeDefined();
      expect(floor.rooms!.length).toBeGreaterThanOrEqual(4);

      // Verify each room has valid bounds inside the grid
      for (const r of floor.rooms!) {
        expect(r.bounds).toBeDefined();
        const b = r.bounds!;
        expect(b.x).toBeGreaterThanOrEqual(1);
        expect(b.y).toBeGreaterThanOrEqual(1);
        expect(b.x + b.width).toBeLessThanOrEqual(floor.width - 1);
        expect(b.y + b.height).toBeLessThanOrEqual(floor.height - 1);
        expect(b.width).toBeGreaterThanOrEqual(5);
        expect(b.height).toBeGreaterThanOrEqual(5);
      }

      // Verify no two rooms overlap
      const rooms = floor.rooms!;
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const b1 = rooms[i].bounds!;
          const b2 = rooms[j].bounds!;
          const overlap =
            b1.x < b2.x + b2.width &&
            b1.x + b1.width > b2.x &&
            b1.y < b2.y + b2.height &&
            b1.y + b1.height > b2.y;
          expect(overlap).toBe(false);
        }
      }
    });
  });

  describe('Guaranteed BFS Path Connectivity', () => {
    it('guarantees 100% connectivity between stairs_up, stairs_down, and all rooms across multiple seeds', () => {
      const testSeeds = [123, 456, 789, 99999, 1337];

      for (const seed of testSeeds) {
        const generated = generateDungeonFloor({
          depth: 2,
          seed,
          width: 36,
          height: 36,
          targetRoomCount: 6,
        });

        const connectivity = verifyDungeonConnectivity(generated.floor);
        expect(connectivity.isFullyConnected).toBe(true);
        expect(connectivity.unreachableRooms).toHaveLength(0);
        expect(connectivity.stairsDownReachable).toBe(true);

        const path = findPathBfs(
          generated.floor,
          generated.stairsUp,
          generated.stairsDown,
        );
        expect(path).not.toBeNull();
        expect(path!.length).toBeGreaterThan(1);
      }
    });
  });

  describe('Portal & Topological Stairs Placement', () => {
    it('places stairs_up in Room 0 and stairs_down in the furthest topological room', () => {
      const generated = generateDungeonFloor({
        depth: 2,
        seed: 777,
        width: 40,
        height: 40,
        targetRoomCount: 6,
      });

      const { floor, stairsUp, stairsDown } = generated;
      const stairsUpProp = floor.props.find((p) => p.kind === 'stairs_up');
      const stairsDownProp = floor.props.find((p) => p.kind === 'stairs_down');

      expect(stairsUpProp).toBeDefined();
      expect(stairsDownProp).toBeDefined();

      expect(stairsUpProp!.x).toBe(stairsUp.x);
      expect(stairsUpProp!.y).toBe(stairsUp.y);

      expect(stairsDownProp!.x).toBe(stairsDown.x);
      expect(stairsDownProp!.y).toBe(stairsDown.y);

      // Room 0 is entrance
      const room0 = floor.rooms![0];
      expect(stairsUp.x).toBeGreaterThanOrEqual(room0.bounds!.x);
      expect(stairsUp.x).toBeLessThan(room0.bounds!.x + room0.bounds!.width);
      expect(stairsUp.y).toBeGreaterThanOrEqual(room0.bounds!.y);
      expect(stairsUp.y).toBeLessThan(room0.bounds!.y + room0.bounds!.height);

      // Party spawn cells must contain 4 distinct cells inside Room 0
      expect(floor.partySpawnCells.length).toBe(4);
      const uniqueSpawns = new Set(
        floor.partySpawnCells.map((p) => `${p.x},${p.y}`),
      );
      expect(uniqueSpawns.size).toBe(4);
      for (const sp of floor.partySpawnCells) {
        expect(sp.x).toBeGreaterThanOrEqual(room0.bounds!.x);
        expect(sp.x).toBeLessThan(room0.bounds!.x + room0.bounds!.width);
        expect(sp.y).toBeGreaterThanOrEqual(room0.bounds!.y);
        expect(sp.y).toBeLessThan(room0.bounds!.y + room0.bounds!.height);
      }
    });
  });

  describe('Key & Gate Mechanics (Spec 06 Section 3.1)', () => {
    it('does not lock stairs entrance at depth 1 or 2 by default', () => {
      const generated = generateDungeonFloor({
        depth: 1,
        seed: 1234,
        width: 36,
        height: 36,
      });

      const lockedDoor = generated.floor.props.find(
        (p) => p.kind === 'door' && p.state === 'locked',
      );
      expect(lockedDoor).toBeUndefined();
      expect(generated.keyLocation).toBeUndefined();
    });

    it('locks the door to stairs_down at depth >= 3 and places iron_dungeon_key in an intermediate chest', () => {
      const generated = generateDungeonFloor({
        depth: 3,
        seed: 8888,
        width: 40,
        height: 40,
        targetRoomCount: 6,
      });

      const lockedGate = generated.floor.props.find(
        (p) => p.kind === 'door' && p.state === 'locked',
      );
      expect(lockedGate).toBeDefined();
      expect(lockedGate!.lockDc).toBeGreaterThanOrEqual(15);

      expect(generated.keyLocation).toBeDefined();
      expect(generated.keyLocation!.keyItem).toBe('iron_dungeon_key');

      // Verify that the chest holding the key exists in props
      const keyChest = generated.floor.props.find(
        (p) => p.id === generated.keyLocation!.propId,
      );
      expect(keyChest).toBeDefined();
      expect(keyChest!.lootTable?.items).toContain('iron_dungeon_key');
    });
  });

  describe('Biome Theming, Props & Encounters', () => {
    it('populates themed monsters, hazards, chests, and traps for Sunken Tombs', () => {
      const generated = generateDungeonFloor({
        depth: 4, // Sunken Tombs
        seed: 4444,
        width: 36,
        height: 36,
      });

      expect(generated.biome).toBe('sunken_tombs');

      // Check shallow water hazards
      const waterCells = generated.floor.cells.filter(
        (c) => c.terrain === 'water_shallow',
      );
      expect(waterCells.length).toBeGreaterThan(0);

      // Check encounters
      expect(generated.floor.encounters.length).toBeGreaterThan(0);
      const allMonsterIds = generated.floor.encounters.flatMap((e) =>
        e.monsters.map((m) => m.monsterId),
      );
      const tombsMonsters = [
        'ghoul',
        'giant-spider',
        'cultist',
        'wight',
        'gelatinous-cube',
        'cult-fanatic',
      ];
      for (const id of allMonsterIds) {
        expect(tombsMonsters).toContain(id);
      }

      // Check poison traps
      const traps = generated.floor.props.filter((p) => p.kind === 'trap');
      if (traps.length > 0) {
        expect(traps[0].trapDamageType).toBe('poison');
        expect(traps[0].trapSaveAbility).toBe('con');
      }
    });

    it('populates magma caverns with lava and fire traps', () => {
      const generated = generateDungeonFloor({
        depth: 7, // Magma Caverns
        seed: 7777,
        width: 36,
        height: 36,
      });

      expect(generated.biome).toBe('magma_caverns');
      const lavaCells = generated.floor.cells.filter((c) => c.terrain === 'lava');
      expect(lavaCells.length).toBeGreaterThan(0);

      const traps = generated.floor.props.filter((p) => p.kind === 'trap');
      if (traps.length > 0) {
        expect(traps[0].trapDamageType).toBe('fire');
        expect(traps[0].trapSaveAbility).toBe('dex');
      }
    });
  });

  describe('Integration with createDungeonGameState()', () => {
    it('seamlessly initializes authoritative GameState from procedurally generated floor', () => {
      const generated = generateDungeonFloor({
        depth: 2,
        seed: 54321,
        width: 36,
        height: 36,
      });

      const party = [
        makePartyMember('hero_fighter', 'Fighter'),
        makePartyMember('hero_wizard', 'Wizard'),
        makePartyMember('hero_cleric', 'Cleric'),
        makePartyMember('hero_rogue', 'Rogue'),
      ];

      const gameState = createDungeonGameState({
        floor: generated.floor,
        party,
      });

      expect(gameState.mode).toBe('exploration');
      expect(gameState.grid.width).toBe(36);
      expect(gameState.grid.height).toBe(36);
      expect(gameState.dungeon).toBeDefined();
      expect(gameState.dungeon!.floorId).toBe(generated.floor.id);
      expect(gameState.props.length).toBe(generated.floor.props.length);

      // Verify heroes are placed at partySpawnCells
      expect(gameState.party['hero_fighter'].position).toEqual(
        generated.floor.partySpawnCells[0],
      );
      expect(gameState.party['hero_wizard'].position).toEqual(
        generated.floor.partySpawnCells[1],
      );
    });
  });
});
