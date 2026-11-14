import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  attuneMagicItem,
  canAttuneMagicItem,
  MAX_ATTUNED_ITEMS,
  toggleMagicItemAttunement,
  unattuneMagicItem,
} from '../character/attunement.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { createInventoryItemInstance } from '../dungeon/loot.js';
import {
  createInitialGameState,
  reduceGame,
} from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';

describe('SRD-505: Magic Item Attunement (Max 3, Restrictions, and Rest Integration)', () => {
  const compendium = defaultCompendium;

  function createTestFighterWithItems(): {
    fighter: CharacterBuildState;
    ringInstance: string;
    cloakInstance: string;
    amuletInstance: string;
    gauntletsInstance: string;
    bagInstance: string;
  } {
    const base = getPregenCharacter('pregen-fighter')!;

    const ring = createInventoryItemInstance('ring-of-protection', compendium, {
      instanceId: 'ring-1',
    });
    const cloak = createInventoryItemInstance('cloak-of-protection', compendium, {
      instanceId: 'cloak-1',
    });
    const amulet = createInventoryItemInstance('amulet-of-health', compendium, {
      instanceId: 'amulet-1',
    });
    const gauntlets = createInventoryItemInstance('gauntlets-of-ogre-power', compendium, {
      instanceId: 'gauntlets-1',
    });
    const bag = createInventoryItemInstance('bag-of-holding', compendium, {
      instanceId: 'bag-1',
    });

    const fighter: CharacterBuildState = {
      ...base,
      inventory: [...base.inventory, ring, cloak, amulet, gauntlets, bag],
      attunedItemInstanceIds: [],
    };

    return {
      fighter,
      ringInstance: ring.instanceId,
      cloakInstance: cloak.instanceId,
      amuletInstance: amulet.instanceId,
      gauntletsInstance: gauntlets.instanceId,
      bagInstance: bag.instanceId,
    };
  }

  describe('canAttuneMagicItem() validation rules', () => {
    it('allows attuning to a valid magic item in inventory requiring attunement', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();
      const res = canAttuneMagicItem(fighter, ringInstance, compendium);
      expect(res.canAttune).toBe(true);
    });

    it('rejects attunement if item is not in character inventory', () => {
      const { fighter } = createTestFighterWithItems();
      const res = canAttuneMagicItem(fighter, 'non-existent-instance', compendium);
      expect(res.canAttune).toBe(false);
      expect(res.reason).toContain('not in character inventory');
    });

    it('rejects attunement if item does not require attunement (e.g. bag of holding)', () => {
      const { fighter, bagInstance } = createTestFighterWithItems();
      const res = canAttuneMagicItem(fighter, bagInstance, compendium);
      expect(res.canAttune).toBe(false);
      expect(res.reason).toContain('does not require attunement');
    });

    it('rejects attunement if already attuned to that item instance', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();
      const attunedFighter = attuneMagicItem(fighter, ringInstance, compendium);
      const res = canAttuneMagicItem(attunedFighter, ringInstance, compendium);
      expect(res.canAttune).toBe(false);
      expect(res.reason).toContain('already attuned');
    });

    it('strictly enforces the SRD 5.1 limit of 3 attuned magic items', () => {
      const { fighter, ringInstance, cloakInstance, amuletInstance, gauntletsInstance } =
        createTestFighterWithItems();

      let current = attuneMagicItem(fighter, ringInstance, compendium);
      current = attuneMagicItem(current, cloakInstance, compendium);
      current = attuneMagicItem(current, amuletInstance, compendium);

      expect(current.attunedItemInstanceIds).toHaveLength(MAX_ATTUNED_ITEMS);

      // Attempting 4th attunement fails
      const check4th = canAttuneMagicItem(current, gauntletsInstance, compendium);
      expect(check4th.canAttune).toBe(false);
      expect(check4th.reason).toContain('Cannot exceed maximum of 3 attuned magic items');

      expect(() => attuneMagicItem(current, gauntletsInstance, compendium)).toThrow(
        /Cannot exceed maximum of 3/,
      );
    });
  });

  describe('attuneMagicItem() and unattuneMagicItem()', () => {
    it('adds and removes attuned item instance IDs cleanly', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();

      const attuned = attuneMagicItem(fighter, ringInstance, compendium);
      expect(attuned.attunedItemInstanceIds).toEqual([ringInstance]);

      const unattuned = unattuneMagicItem(attuned, ringInstance);
      expect(unattuned.attunedItemInstanceIds).toEqual([]);
    });

    it('toggles attunement state with toggleMagicItemAttunement()', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();

      const toggledOn = toggleMagicItemAttunement(fighter, ringInstance, compendium);
      expect(toggledOn.attunedItemInstanceIds).toContain(ringInstance);

      const toggledOff = toggleMagicItemAttunement(toggledOn, ringInstance, compendium);
      expect(toggledOff.attunedItemInstanceIds).not.toContain(ringInstance);
    });
  });

  describe('DerivedCharacterSheet stat integration with Attunement', () => {
    it('applies Ring of Protection AC and saving throw bonuses ONLY when attuned', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();

      // Before attunement
      const sheetUnattuned = computeDerivedCharacter(fighter, compendium);
      const baseAc = sheetUnattuned.armorClass.totalAc;
      const baseStrSave = sheetUnattuned.savingThrows.str.totalBonus;

      // Attune to Ring of Protection (+1 AC, +1 Saves)
      const attunedFighter = attuneMagicItem(fighter, ringInstance, compendium);
      const sheetAttuned = computeDerivedCharacter(attunedFighter, compendium);

      expect(sheetAttuned.armorClass.totalAc).toBe(baseAc + 1);
      expect(sheetAttuned.savingThrows.str.totalBonus).toBe(baseStrSave + 1);
      expect(sheetAttuned.savingThrows.dex.totalBonus).toBe(
        sheetUnattuned.savingThrows.dex.totalBonus + 1,
      );

      // Unattune and verify bonuses disappear
      const unattunedFighter = unattuneMagicItem(attunedFighter, ringInstance);
      const sheetReverted = computeDerivedCharacter(unattunedFighter, compendium);

      expect(sheetReverted.armorClass.totalAc).toBe(baseAc);
      expect(sheetReverted.savingThrows.str.totalBonus).toBe(baseStrSave);
    });
  });

  describe('Attunement through reduceGame() commands', () => {
    it('handles ATTUNE_ITEM and UNATTUNE_ITEM commands and updates hero AC in state', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();
      const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
      const baseSheet = computeDerivedCharacter(fighter, compendium);

      const hero = {
        id: 'fighter-hero',
        name: 'Fighter',
        side: 'party' as const,
        size: 'medium' as const,
        position: { x: 1, y: 1 },
        speedFeet: 30,
        currentHp: baseSheet.maxHp,
        maxHp: baseSheet.maxHp,
        tempHp: 0,
        armorClass: baseSheet.armorClass.totalAc,
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
        deathSaves: { successes: 0, failures: 0 },
        isDead: false,
        isStable: false,
        attacksPerAction: 1,
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        buildState: fighter,
        characterSheet: baseSheet,
      };

      const state = createInitialGameState({
        grid,
        party: [hero],
      });

      // Dispatch ATTUNE_ITEM
      const attuneRes = reduceGame(state, {
        type: 'ATTUNE_ITEM',
        characterId: 'fighter-hero',
        itemInstanceId: ringInstance,
      });

      const updatedHero = attuneRes.nextState.party['fighter-hero']!;
      expect(updatedHero.buildState?.attunedItemInstanceIds).toContain(ringInstance);
      expect(updatedHero.armorClass).toBe(baseSheet.armorClass.totalAc + 1);

      const attuneEvent = attuneRes.events.find((e) => e.type === 'ATTUNEMENT_CHANGED');
      expect(attuneEvent).toBeDefined();

      // Dispatch UNATTUNE_ITEM
      const unattuneRes = reduceGame(attuneRes.nextState, {
        type: 'UNATTUNE_ITEM',
        characterId: 'fighter-hero',
        itemInstanceId: ringInstance,
      });

      const restoredHero = unattuneRes.nextState.party['fighter-hero']!;
      expect(restoredHero.buildState?.attunedItemInstanceIds).not.toContain(ringInstance);
      expect(restoredHero.armorClass).toBe(baseSheet.armorClass.totalAc);
    });
  });

  describe('Rest integration with Attunement', () => {
    it('applies attunement changes during Short Rest via command.attunements', () => {
      const { fighter, ringInstance } = createTestFighterWithItems();
      const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
      const baseSheet = computeDerivedCharacter(fighter, compendium);

      const hero = {
        id: 'fighter-hero',
        name: 'Fighter',
        side: 'party' as const,
        size: 'medium' as const,
        position: { x: 2, y: 2 },
        speedFeet: 30,
        currentHp: baseSheet.maxHp - 5,
        maxHp: baseSheet.maxHp,
        tempHp: 0,
        armorClass: baseSheet.armorClass.totalAc,
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
        deathSaves: { successes: 0, failures: 0 },
        isDead: false,
        isStable: false,
        attacksPerAction: 1,
        damageResistances: [],
        damageImmunities: [],
        damageVulnerabilities: [],
        conditionImmunities: [],
        buildState: fighter,
        characterSheet: baseSheet,
      };

      const state = createInitialGameState({
        grid,
        party: [hero],
      });

      const { nextState, events } = reduceGame(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'fighter-hero': 1 },
        attunements: {
          'fighter-hero': { attune: [ringInstance] },
        },
      });

      expect(events.some((e) => e.type === 'REST_COMPLETED')).toBe(true);
      expect(events.some((e) => e.type === 'ATTUNEMENT_CHANGED')).toBe(true);

      const restedHero = nextState.party['fighter-hero']!;
      expect(restedHero.buildState?.attunedItemInstanceIds).toContain(ringInstance);
      expect(restedHero.armorClass).toBe(baseSheet.armorClass.totalAc + 1);
    });
  });
});
