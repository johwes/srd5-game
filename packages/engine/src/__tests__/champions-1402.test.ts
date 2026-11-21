import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  CHAMPION_SPAWN_BASE_CHANCE,
  CHAMPION_SPAWN_CAP,
  CHAMPION_SPAWN_PER_DEPTH,
  applyChampionTemplate,
  championDamageMultiplier,
  championSpawnChanceForDepth,
  championTooltipLine,
  getChampionAttackBonus,
  getChampionDamageMultiplier,
  rollChampionForEncounter,
  scaleChampionDamage,
  createDungeonGameState,
  createMonsterCombatant,
  generateDungeonFloor,
  resolveCombatantAttackProfile,
  rollCorpseLoot,
  triggerDungeonEncounter,
  type Combatant,
  type DungeonFloorSpec,
} from '../index.js';

/**
 * SRD-1402: Champion packs — MoM guardian stacks (Spec 13 §4).
 * Acceptance: in-band spawn at stated rates (never depth 1), trait math
 * exact headless, skull badge + origin-tagged hoard visible in UI,
 * E2E kill flow clean (E2E smoke itself rides the SRD-1406 gate).
 */

function makeHero(id: string, x = 2, y = 2): Combatant {
  return {
    id,
    name: 'Fighter',
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 10,
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

function makeChampionFloor(trait: 'brutal' | 'swift' | 'warded'): DungeonFloorSpec {
  const cells: DungeonFloorSpec['cells'] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      cells.push({ x, y, terrain: 'floor_stone', baseLight: 'bright', elevationFeet: 0 });
    }
  }
  return {
    id: 'floor_champion_test',
    name: 'Champion Test Floor',
    width: 8,
    height: 8,
    partySpawnCells: [{ x: 1, y: 1 }],
    cells,
    props: [],
    encounters: [
      {
        id: 'enc_champion',
        roomId: 'room_arena',
        triggered: false,
        monsters: [{ monsterId: 'goblin', spawnX: 5, spawnY: 5, championTrait: trait }],
      },
    ],
    rooms: [{ id: 'room_arena', name: 'Arena', isSafeRoom: false }],
  };
}

describe('SRD-1402: Champion packs', () => {
  describe('spawn chance', () => {
    it('never spawns on depth 1 (fair onboarding fight)', () => {
      expect(championSpawnChanceForDepth(1)).toBe(0);
      expect(championSpawnChanceForDepth(0)).toBe(0);
      for (let seed = 1; seed <= 200; seed++) {
        expect(rollChampionForEncounter(seed, 1).isChampion).toBe(false);
      }
    });

    it('charges 8% + 2% per depth, capped at 25%', () => {
      expect(CHAMPION_SPAWN_BASE_CHANCE).toBe(0.08);
      expect(CHAMPION_SPAWN_PER_DEPTH).toBe(0.02);
      expect(CHAMPION_SPAWN_CAP).toBe(0.25);
      expect(championSpawnChanceForDepth(2)).toBeCloseTo(0.12, 10);
      expect(championSpawnChanceForDepth(5)).toBeCloseTo(0.18, 10);
      expect(championSpawnChanceForDepth(9)).toBeCloseTo(0.25, 10);
      expect(championSpawnChanceForDepth(20)).toBe(0.25);
      expect(championSpawnChanceForDepth(100)).toBe(0.25);
    });

    it('is deterministic per seed and observes the stated rate in bounds', () => {
      const a = rollChampionForEncounter(12345, 5);
      const b = rollChampionForEncounter(12345, 5);
      expect(a).toEqual(b);

      let hits = 0;
      const N = 3000;
      for (let seed = 1; seed <= N; seed++) {
        if (rollChampionForEncounter(seed, 5).isChampion) hits++;
      }
      const rate = hits / N;
      // Stated rate at depth 5 is 18%; assert a generous statistical band.
      expect(rate).toBeGreaterThan(0.1);
      expect(rate).toBeLessThan(0.27);
    });

    it('rolls all three traits across seeds', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 3000 && seen.size < 3; seed++) {
        const roll = rollChampionForEncounter(seed, 6);
        if (roll.isChampion && roll.trait) seen.add(roll.trait);
      }
      expect([...seen].sort()).toEqual(['brutal', 'swift', 'warded']);
    });
  });

  describe('template math (existing mechanics recombined)', () => {
    it('scales HP ×1.5 rounded and flags the combatant', () => {
      const goblin = defaultCompendium.requireMonster('goblin');
      // Goblin average 7 → Math.round(10.5) = 11.
      expect(goblin.hitPoints.average).toBe(7);
      const base = createMonsterCombatant(goblin, 'goblin-base', { x: 0, y: 0 });
      for (const trait of ['brutal', 'swift', 'warded'] as const) {
        const champ = applyChampionTemplate(base, trait);
        expect(champ.maxHp).toBe(11);
        expect(champ.currentHp).toBe(11);
        expect(champ.isChampion).toBe(true);
        expect(champ.championTrait).toBe(trait);
        expect(champ.name).toBe('Champion Goblin');
      }
    });

    it('grants +2 to hit to every champion', () => {
      const plain = { isChampion: false } as Combatant;
      const champ = { isChampion: true, championTrait: 'brutal' } as Combatant;
      expect(getChampionAttackBonus(plain)).toBe(0);
      expect(getChampionAttackBonus(champ)).toBe(2);
    });

    it('scales damage +25% (+50% brutal), rounded down', () => {
      expect(championDamageMultiplier('brutal')).toBe(1.5);
      expect(championDamageMultiplier('swift')).toBe(1.25);
      expect(championDamageMultiplier('warded')).toBe(1.25);
      const brutal = { isChampion: true, championTrait: 'brutal' } as Combatant;
      const swift = { isChampion: true, championTrait: 'swift' } as Combatant;
      const plain = { isChampion: false } as Combatant;
      expect(getChampionDamageMultiplier(brutal)).toBe(1.5);
      expect(getChampionDamageMultiplier(swift)).toBe(1.25);
      expect(getChampionDamageMultiplier(plain)).toBe(1);
      expect(scaleChampionDamage(7, brutal)).toBe(10);
      expect(scaleChampionDamage(7, swift)).toBe(8);
      expect(scaleChampionDamage(7, plain)).toBe(7);
      expect(scaleChampionDamage(1, swift)).toBe(1);
    });

    it('applies the single trait effect (warded +2 AC, swift +10 ft + advantage)', () => {
      const goblin = defaultCompendium.requireMonster('goblin');
      const base = createMonsterCombatant(goblin, 'goblin-base', { x: 0, y: 0 });
      const warded = applyChampionTemplate(base, 'warded');
      expect(warded.armorClass).toBe(base.armorClass + 2);
      expect(warded.speedFeet).toBe(base.speedFeet);
      expect(warded.initiativeRollMode).toBe('normal');

      const swift = applyChampionTemplate(base, 'swift');
      expect(swift.speedFeet).toBe(base.speedFeet + 10);
      expect(swift.initiativeRollMode).toBe('advantage');
      expect(swift.armorClass).toBe(base.armorClass);

      const brutal = applyChampionTemplate(base, 'brutal');
      expect(brutal.armorClass).toBe(base.armorClass);
      expect(brutal.speedFeet).toBe(base.speedFeet);
    });

    it('writes the badge tooltip lines (skull badge copy)', () => {
      expect(championTooltipLine('brutal')).toBe('Champion · brutal — +50% damage');
      expect(championTooltipLine('swift')).toBe('Champion · swift — +10 ft, advantage on initiative');
      expect(championTooltipLine('warded')).toBe('Champion · warded — +2 AC');
    });

    it('bakes the template into createMonsterCombatant (spawn path)', () => {
      const goblin = defaultCompendium.requireMonster('goblin');
      const champ = createMonsterCombatant(goblin, 'champ-1', { x: 0, y: 0 }, { championTrait: 'warded' });
      expect(champ.isChampion).toBe(true);
      expect(champ.championTrait).toBe('warded');
      expect(champ.maxHp).toBe(11);
      expect(champ.armorClass).toBe(goblin.armorClass.value + 2);
      expect(champ.name).toBe('Champion Goblin');
    });

    it('adds +2 to resolved monster attack profiles', () => {
      const goblin = defaultCompendium.requireMonster('goblin');
      const plain = createMonsterCombatant(goblin, 'plain-1', { x: 0, y: 0 });
      const champ = createMonsterCombatant(goblin, 'champ-1', { x: 0, y: 0 }, { championTrait: 'brutal' });
      const plainProfile = resolveCombatantAttackProfile(plain, { monsterActionId: 'scimitar' });
      const champProfile = resolveCombatantAttackProfile(champ, { monsterActionId: 'scimitar' });
      expect(plainProfile.toHitBonus).toBe(4);
      expect(champProfile.toHitBonus).toBe(6);
    });
  });

  describe('trigger integration (spawn → initiative with ELITE_SPAWNED)', () => {
    it.each(['brutal', 'swift', 'warded'] as const)('spawns a %s champion with headline event', (trait) => {
      const floor = makeChampionFloor(trait);
      const state = createDungeonGameState({ floor, party: [makeHero('hero-1')] });
      const res = triggerDungeonEncounter(state, 'enc_champion');
      expect(res.nextState.mode).toBe('combat');
      const champ = res.nextState.monsters['enc_champion-goblin-1']!;
      expect(champ.isChampion).toBe(true);
      expect(champ.championTrait).toBe(trait);
      expect(champ.maxHp).toBe(11);
      const elite = res.events.find((e) => e.type === 'ELITE_SPAWNED');
      expect(elite).toBeDefined();
      expect(elite).toMatchObject({ entityId: 'enc_champion-goblin-1', trait });
    });
  });

  describe('rewards hook into the SRD-1307 elite hoard path', () => {
    it('low-CR champions roll the hoard table (extra RNG consumed, origin-tagged)', () => {
      const goblin = defaultCompendium.requireMonster('goblin');
      const plain = createMonsterCombatant(goblin, 'goblin-1', { x: 0, y: 0 });
      const champ = createMonsterCombatant(goblin, 'goblin-1', { x: 0, y: 0 }, { championTrait: 'brutal' });
      const plainRoll = rollCorpseLoot({ ...plain, isDead: true, currentHp: 0 }, 4242, defaultCompendium);
      const champRoll = rollCorpseLoot({ ...champ, isDead: true, currentHp: 0 }, 4242, defaultCompendium);
      // The hoard roll consumes additional seeded RNG beyond individual treasure.
      expect(champRoll.nextRng).not.toBe(plainRoll.nextRng);
      // Provenance stays on the monster_drop path (no war-award double-dip).
      if (champRoll.loot && (champRoll.loot.gp || champRoll.loot.items?.length)) {
        expect(champRoll.loot.origin).toBe('monster_drop');
        expect(champRoll.loot.sourceName).toMatch(/^Champion /);
      }
      // Deterministic replay.
      const again = rollCorpseLoot({ ...champ, isDead: true, currentHp: 0 }, 4242, defaultCompendium);
      expect(again.loot).toEqual(champRoll.loot);
      expect(again.nextRng).toBe(champRoll.nextRng);
    });
  });

  describe('generator wiring (max 1 per encounter, never depth 1)', () => {
    it('marks no champions on depth 1 across seeds', () => {
      for (const seed of [11, 22, 33, 44, 55, 66, 77, 88]) {
        const gen = generateDungeonFloor({ depth: 1, seed, width: 36, height: 36 });
        for (const enc of gen.floor.encounters) {
          for (const m of enc.monsters) {
            expect((m as { championTrait?: string }).championTrait).toBeUndefined();
          }
        }
      }
    });

    it('marks at most one champion per encounter and stays deterministic', () => {
      let observedChampions = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const gen = generateDungeonFloor({ depth: 5, seed, width: 36, height: 36 });
        for (const enc of gen.floor.encounters) {
          const champs = enc.monsters.filter(
            (m) => (m as { championTrait?: string }).championTrait !== undefined,
          );
          expect(champs.length).toBeLessThanOrEqual(1);
          for (const c of champs) {
            expect(['brutal', 'swift', 'warded']).toContain(
              (c as { championTrait?: string }).championTrait,
            );
            // Champions stay in-band (regular encounters draw from CR bands).
            observedChampions++;
          }
        }
        const again = generateDungeonFloor({ depth: 5, seed, width: 36, height: 36 });
        expect(JSON.stringify(again.floor)).toBe(JSON.stringify(gen.floor));
      }
      // Depth 5 charges 18%/encounter over 30 floors — must observe guardians.
      expect(observedChampions).toBeGreaterThan(0);
    });
  });
});
