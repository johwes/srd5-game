import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  createDefaultCurrency,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  createInitialGameState,
  reduceGame,
} from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import {
  awardLootToCharacter,
  claimPropLoot,
  createInventoryItemInstance,
  rollIndividualTreasure,
  rollTreasureHoard,
} from '../dungeon/loot.js';
import { type InteractiveProp } from '../state/types.js';

describe('SRD-505: Loot Tables and Treasure Distribution', () => {
  const compendium = defaultCompendium;

  describe('rollIndividualTreasure()', () => {
    it('generates deterministic coins for CR 0–4 based on PRNG seed', () => {
      const res1 = rollIndividualTreasure(1, 12345);
      const res2 = rollIndividualTreasure(1, 12345);

      expect(res1.loot).toEqual(res2.loot);
      expect(res1.nextRng).toBe(res2.nextRng);

      // Verify at least one currency is awarded
      const totalCoins =
        (res1.loot.cp ?? 0) +
        (res1.loot.sp ?? 0) +
        (res1.loot.ep ?? 0) +
        (res1.loot.gp ?? 0) +
        (res1.loot.pp ?? 0);
      expect(totalCoins).toBeGreaterThan(0);
    });

    it('scales coin rewards for higher CR brackets (CR 5–10, 11–16, 17+)', () => {
      const resLow = rollIndividualTreasure(2, 42);
      const resHigh = rollIndividualTreasure(18, 42);

      const lowValueGp =
        (resLow.loot.cp ?? 0) / 100 +
        (resLow.loot.sp ?? 0) / 10 +
        (resLow.loot.gp ?? 0) +
        (resLow.loot.pp ?? 0) * 10;

      const highValueGp =
        (resHigh.loot.cp ?? 0) / 100 +
        (resHigh.loot.sp ?? 0) / 10 +
        (resHigh.loot.ep ?? 0) / 2 +
        (resHigh.loot.gp ?? 0) +
        (resHigh.loot.pp ?? 0) * 10;

      expect(highValueGp).toBeGreaterThan(lowValueGp);
    });
  });

  describe('rollTreasureHoard()', () => {
    it('generates coins and magic items from tables for CR 0–4 hoard', () => {
      // Find a seed that produces magic items
      let seed = 1000;
      let hoard = rollTreasureHoard(3, seed, compendium);
      let foundItems = false;

      for (let i = 0; i < 20; i++) {
        hoard = rollTreasureHoard(3, seed + i * 37, compendium);
        if (hoard.loot.items && hoard.loot.items.length > 0) {
          foundItems = true;
          break;
        }
      }

      expect(foundItems).toBe(true);
      expect((hoard.loot.gp ?? 0) + (hoard.loot.sp ?? 0)).toBeGreaterThan(0);
      if (hoard.loot.items) {
        for (const it of hoard.loot.items) {
          expect(typeof it).toBe('string');
        }
      }
    });

    it('rolls higher-tier magic items on CR 11+ hoards', () => {
      const hoard = rollTreasureHoard(12, 99999, compendium);
      expect(hoard.loot.items).toBeDefined();
      expect(hoard.loot.items!.length).toBeGreaterThan(0);
      expect(hoard.loot.gp).toBeGreaterThan(1000);
    });
  });

  describe('createInventoryItemInstance()', () => {
    it('creates an identified inventory instance with correct magic flags', () => {
      const ring = createInventoryItemInstance('ring-of-protection', compendium);
      expect(ring.itemId).toBe('ring-of-protection');
      expect(ring.quantity).toBe(1);
      expect(ring.isMagicItem).toBe(true);
      expect(ring.identified).toBe(true);
      expect(ring.instanceId).toContain('inst-ring-of-protection');
    });

    it('creates mundane equipment instances with isMagicItem false', () => {
      const dagger = createInventoryItemInstance('dagger', compendium);
      expect(dagger.itemId).toBe('dagger');
      expect(dagger.isMagicItem).toBe(false);
    });
  });

  describe('awardLootToCharacter()', () => {
    it('adds coins and stacks consumable potions if already in inventory', () => {
      const baseHero = getPregenCharacter('pregen-fighter')!;
      const existingPotion = createInventoryItemInstance('potion-of-healing', compendium, {
        instanceId: 'existing-pot-1',
        quantity: 2,
      });

      const heroWithPot: CharacterBuildState = {
        ...baseHero,
        currency: createDefaultCurrency(),
        inventory: [existingPotion],
      };

      const loot = {
        gp: 50,
        sp: 20,
        items: ['potion-of-healing', 'ring-of-protection'],
      };

      const updated = awardLootToCharacter(heroWithPot, loot, compendium);

      expect(updated.currency.gp).toBe(50);
      expect(updated.currency.sp).toBe(20);

      // Potion of healing stacked from 2 to 3
      const pot = updated.inventory.find((i) => i.itemId === 'potion-of-healing');
      expect(pot).toBeDefined();
      expect(pot!.quantity).toBe(3);

      // Ring of protection added as a new item
      const ring = updated.inventory.find((i) => i.itemId === 'ring-of-protection');
      expect(ring).toBeDefined();
      expect(ring!.isMagicItem).toBe(true);
    });
  });

  describe('claimPropLoot()', () => {
    it('claims loot from an open chest and empties it so it cannot be claimed twice', () => {
      const baseHero = getPregenCharacter('pregen-fighter')!;
      const heroId = 'fighter-1';

      const chest: InteractiveProp = {
        id: 'chest-1',
        kind: 'chest',
        state: 'open',
        x: 3,
        y: 3,
        blocksMovement: true,
        blocksSight: false,
        lootTable: {
          gp: 100,
          items: ['cloak-of-protection'],
        },
      };

      const grid = createTacticalGrid(10, 10, 'floor_stone', 'bright');
      const partyHero = {
        id: heroId,
        name: 'Fighter',
        side: 'party' as const,
        size: 'medium' as const,
        position: { x: 2, y: 3 },
        speedFeet: 30,
        currentHp: 12,
        maxHp: 12,
        tempHp: 0,
        armorClass: 16,
        dexterityScore: 14,
        dexterityModifier: 2,
        strengthScore: 16,
        strengthModifier: 3,
        initiativeBonus: 2,
        initiativeRollMode: 'normal' as const,
        passivePerception: 10,
        stealthModifier: 2,
        isSurprised: false,
        isDodging: false,
        conditions: [],
        deathSaves: { successes: 0 as const, failures: 0 as const },
        isDead: false,
        isStable: false,
        attacksPerAction: 1,
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        buildState: baseHero,
      };

      const initialState = createInitialGameState({
        grid,
        party: [partyHero],
        props: [chest],
      });

      const res = claimPropLoot(initialState, 'chest-1', heroId, compendium);

      expect(res.loot.gp).toBe(100);
      expect(res.loot.items).toContain('cloak-of-protection');

      const lootEvent = res.events.find((e) => e.type === 'LOOT_ACQUIRED');
      expect(lootEvent).toBeDefined();

      // Chest on next state has empty loot table
      const updatedChest = res.nextState.props.find((p) => p.id === 'chest-1');
      expect(updatedChest?.lootTable).toBeUndefined();

      // Hero received 100 GP and cloak
      const updatedHero = res.nextState.party[heroId]!;
      expect(updatedHero.buildState?.currency.gp).toBe((baseHero.currency.gp ?? 0) + 100);
      expect(
        updatedHero.buildState?.inventory.some((i) => i.itemId === 'cloak-of-protection'),
      ).toBe(true);

      // Claiming again returns empty loot
      const secondClaim = claimPropLoot(res.nextState, 'chest-1', heroId, compendium);
      expect(secondClaim.loot).toEqual({});
      expect(secondClaim.events).toHaveLength(0);
    });

    it('rejects claiming loot from a closed or locked chest', () => {
      const baseHero = getPregenCharacter('pregen-fighter')!;
      const grid = createTacticalGrid(10, 10, 'floor_stone', 'bright');
      const partyHero = {
        id: 'h1',
        name: 'Hero',
        side: 'party' as const,
        size: 'medium' as const,
        position: { x: 2, y: 3 },
        speedFeet: 30,
        currentHp: 10,
        maxHp: 10,
        tempHp: 0,
        armorClass: 14,
        dexterityScore: 10,
        dexterityModifier: 0,
        strengthScore: 10,
        strengthModifier: 0,
        initiativeBonus: 0,
        initiativeRollMode: 'normal' as const,
        passivePerception: 10,
        stealthModifier: 0,
        isSurprised: false,
        isDodging: false,
        conditions: [],
        deathSaves: { successes: 0 as const, failures: 0 as const },
        isDead: false,
        isStable: false,
        attacksPerAction: 1,
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        buildState: baseHero,
      };

      const closedChest: InteractiveProp = {
        id: 'chest-locked',
        kind: 'chest',
        state: 'locked',
        x: 3,
        y: 3,
        blocksMovement: true,
        blocksSight: false,
        lootTable: { gp: 50 },
      };

      const state = createInitialGameState({
        grid,
        party: [partyHero],
        props: [closedChest],
      });

      expect(() => claimPropLoot(state, 'chest-locked', 'h1', compendium)).toThrow(
        /Cannot claim loot from prop in state 'locked'/,
      );
    });

    it('processes CLAIM_LOOT command via reduceGame()', () => {
      const baseHero = getPregenCharacter('pregen-fighter')!;
      const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
      const hero = {
        id: 'h1',
        name: 'Hero',
        side: 'party' as const,
        size: 'medium' as const,
        position: { x: 1, y: 1 },
        speedFeet: 30,
        currentHp: 10,
        maxHp: 10,
        tempHp: 0,
        armorClass: 14,
        dexterityScore: 10,
        dexterityModifier: 0,
        strengthScore: 10,
        strengthModifier: 0,
        initiativeBonus: 0,
        initiativeRollMode: 'normal' as const,
        passivePerception: 10,
        stealthModifier: 0,
        isSurprised: false,
        isDodging: false,
        conditions: [],
        deathSaves: { successes: 0 as const, failures: 0 as const },
        isDead: false,
        isStable: false,
        attacksPerAction: 1,
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        buildState: baseHero,
      };

      const chest: InteractiveProp = {
        id: 'chest-2',
        kind: 'chest',
        state: 'open',
        x: 1,
        y: 2,
        blocksMovement: false,
        blocksSight: false,
        lootTable: { gp: 75 },
      };

      const state = createInitialGameState({
        grid,
        party: [hero],
        props: [chest],
      });

      const { nextState, events } = reduceGame(state, {
        type: 'CLAIM_LOOT',
        characterId: 'h1',
        propId: 'chest-2',
      });

      expect(events.some((e) => e.type === 'LOOT_ACQUIRED')).toBe(true);
      expect(nextState.party['h1']?.buildState?.currency.gp).toBe((baseHero.currency.gp ?? 0) + 75);
    });
  });
});
