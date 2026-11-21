import {
  type SrdCompendium,
  type InventoryItemInstance,
  type CharacterBuildState,
  type CharacterCurrency,
  defaultCompendium,
} from '@srd5/data';
import { rollDie, rollMultipleDice } from '../dice/prng.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { type GameEvent, type GameState, type InteractiveProp } from '../state/types.js';
import { type LootBundleSpec } from './schemas.js';

// ============================================================================
// 1. SRD 5.1 Magic Item Tables & Curated Drop Pools
// ============================================================================

export const MAGIC_ITEM_TABLE_A = [
  'potion-of-healing',
  'potion-of-climbing',
  'scroll-of-fireball',
] as const;

export const MAGIC_ITEM_TABLE_B = [
  'potion-of-greater-healing',
  'bag-of-holding',
  'boots-of-elvenkind',
  'cloak-of-elvenkind',
  'periapt-of-wound-closure',
] as const;

export const MAGIC_ITEM_TABLE_C = [
  'potion-of-superior-healing',
  'wand-of-magic-missiles',
  'scroll-of-fireball',
] as const;

export const MAGIC_ITEM_TABLE_F = [
  'weapon-plus-1',
  'shield-plus-1',
  'longsword-plus-1',
  'cloak-of-protection',
  'gauntlets-of-ogre-power',
] as const;

export const MAGIC_ITEM_TABLE_G = [
  'weapon-plus-2',
  'shield-plus-2',
  'armor-plus-1',
  'ring-of-protection',
  'flame-tongue',
  'belt-of-hill-giant-strength',
  'amulet-of-health',
  'bracers-of-defense',
] as const;

export const MAGIC_ITEM_TABLE_H = [
  'weapon-plus-3',
  'shield-plus-3',
  'armor-plus-2',
  'potion-of-supreme-healing',
] as const;

export const MAGIC_ITEM_TABLE_I = [
  'armor-plus-3',
] as const;

/**
 * Creates an `InventoryItemInstance` from an SRD item or magic item ID.
 *
 * The fallback instance ID uses a process-local monotonic counter (never
 * `Math.random()` / `Date.now()`, per the deterministic-engine invariant).
 * Deterministic callers (loot claims, corpse drops) pass an explicit
 * `overrides.instanceId` so replays are bit-exact.
 */
let inventoryInstanceCounter = 0;

export function createInventoryItemInstance(
  itemId: string,
  compendium: SrdCompendium = defaultCompendium,
  overrides?: Partial<InventoryItemInstance>,
): InventoryItemInstance {
  const isMagic = Boolean(compendium.getMagicItem(itemId));
  inventoryInstanceCounter += 1;
  const instanceId =
    overrides?.instanceId ?? `inst-${itemId}-${inventoryInstanceCounter}`;

  return {
    instanceId,
    itemId,
    quantity: overrides?.quantity ?? 1,
    isMagicItem: overrides?.isMagicItem ?? isMagic,
    chargesRemaining: overrides?.chargesRemaining,
    identified: overrides?.identified ?? true,
    customName: overrides?.customName,
  };
}

// ============================================================================
// 2. Deterministic SRD 5.1 Treasure Rollers
// ============================================================================

/**
 * Sums an array of numbers.
 */
function sumDice(rolls: number[]): number {
  return rolls.reduce((acc, r) => acc + r, 0);
}

/**
 * Rolls Individual Treasure based on monster Challenge Rating (SRD 5.1).
 * CR 0–4, 5–10, 11–16, 17+.
 */
export function rollIndividualTreasure(
  cr: number,
  rngState: number,
): { loot: LootBundleSpec; nextRng: number } {
  let currentRng = rngState;
  const { roll: d100, nextState: r1 } = rollDie(currentRng, 100);
  currentRng = r1;

  const loot: LootBundleSpec = {};

  if (cr < 5) {
    // Challenge 0–4
    if (d100 <= 30) {
      const { rolls, nextState } = rollMultipleDice(currentRng, 5, 6);
      currentRng = nextState;
      loot.cp = sumDice(rolls);
    } else if (d100 <= 60) {
      const { rolls, nextState } = rollMultipleDice(currentRng, 4, 6);
      currentRng = nextState;
      loot.sp = sumDice(rolls);
    } else if (d100 <= 70) {
      const { rolls, nextState } = rollMultipleDice(currentRng, 3, 6);
      currentRng = nextState;
      loot.ep = sumDice(rolls);
    } else if (d100 <= 95) {
      const { rolls, nextState } = rollMultipleDice(currentRng, 3, 6);
      currentRng = nextState;
      loot.gp = sumDice(rolls);
    } else {
      const { rolls, nextState } = rollMultipleDice(currentRng, 1, 6);
      currentRng = nextState;
      loot.pp = sumDice(rolls);
    }
  } else if (cr < 11) {
    // Challenge 5–10
    if (d100 <= 30) {
      const rCp = rollMultipleDice(currentRng, 4, 6);
      const rEp = rollMultipleDice(rCp.nextState, 1, 6);
      currentRng = rEp.nextState;
      loot.cp = sumDice(rCp.rolls) * 100;
      loot.ep = sumDice(rEp.rolls) * 10;
    } else if (d100 <= 60) {
      const rSp = rollMultipleDice(currentRng, 6, 6);
      const rGp = rollMultipleDice(rSp.nextState, 2, 6);
      currentRng = rGp.nextState;
      loot.sp = sumDice(rSp.rolls) * 10;
      loot.gp = sumDice(rGp.rolls) * 10;
    } else if (d100 <= 70) {
      const rEp = rollMultipleDice(currentRng, 3, 6);
      const rGp = rollMultipleDice(rEp.nextState, 2, 6);
      currentRng = rGp.nextState;
      loot.ep = sumDice(rEp.rolls) * 10;
      loot.gp = sumDice(rGp.rolls) * 10;
    } else if (d100 <= 95) {
      const rGp = rollMultipleDice(currentRng, 4, 6);
      currentRng = rGp.nextState;
      loot.gp = sumDice(rGp.rolls) * 10;
    } else {
      const rGp = rollMultipleDice(currentRng, 2, 6);
      const rPp = rollMultipleDice(rGp.nextState, 3, 6);
      currentRng = rPp.nextState;
      loot.gp = sumDice(rGp.rolls) * 10;
      loot.pp = sumDice(rPp.rolls);
    }
  } else if (cr < 17) {
    // Challenge 11–16
    if (d100 <= 20) {
      const rSp = rollMultipleDice(currentRng, 4, 6);
      const rGp = rollMultipleDice(rSp.nextState, 1, 6);
      currentRng = rGp.nextState;
      loot.sp = sumDice(rSp.rolls) * 100;
      loot.gp = sumDice(rGp.rolls) * 100;
    } else if (d100 <= 35) {
      const rEp = rollMultipleDice(currentRng, 1, 6);
      const rGp = rollMultipleDice(rEp.nextState, 1, 6);
      currentRng = rGp.nextState;
      loot.ep = sumDice(rEp.rolls) * 100;
      loot.gp = sumDice(rGp.rolls) * 100;
    } else if (d100 <= 75) {
      const rGp = rollMultipleDice(currentRng, 2, 6);
      const rPp = rollMultipleDice(rGp.nextState, 1, 6);
      currentRng = rPp.nextState;
      loot.gp = sumDice(rGp.rolls) * 100;
      loot.pp = sumDice(rPp.rolls) * 10;
    } else {
      const rGp = rollMultipleDice(currentRng, 2, 6);
      const rPp = rollMultipleDice(rGp.nextState, 2, 6);
      currentRng = rPp.nextState;
      loot.gp = sumDice(rGp.rolls) * 100;
      loot.pp = sumDice(rPp.rolls) * 10;
    }
  } else {
    // Challenge 17+
    if (d100 <= 15) {
      const rEp = rollMultipleDice(currentRng, 2, 6);
      const rGp = rollMultipleDice(rEp.nextState, 8, 6);
      currentRng = rGp.nextState;
      loot.ep = sumDice(rEp.rolls) * 1000;
      loot.gp = sumDice(rGp.rolls) * 100;
    } else if (d100 <= 55) {
      const rGp = rollMultipleDice(currentRng, 1, 6);
      const rPp = rollMultipleDice(rGp.nextState, 1, 6);
      currentRng = rPp.nextState;
      loot.gp = sumDice(rGp.rolls) * 1000;
      loot.pp = sumDice(rPp.rolls) * 100;
    } else {
      const rGp = rollMultipleDice(currentRng, 1, 6);
      const rPp = rollMultipleDice(rGp.nextState, 2, 6);
      currentRng = rPp.nextState;
      loot.gp = sumDice(rGp.rolls) * 1000;
      loot.pp = sumDice(rPp.rolls) * 100;
    }
  }

  return { loot, nextRng: currentRng };
}

/**
 * Rolls a random magic item from a table array.
 */
function pickFromTable(
  table: readonly string[],
  rngState: number,
): { item: string; nextRng: number } {
  const { roll, nextState } = rollDie(rngState, table.length);
  return { item: table[roll - 1]!, nextRng: nextState };
}

/**
 * Rolls a Treasure Hoard based on Challenge Rating (SRD 5.1).
 * Yields bulk coins, gems converted to gold, and magic items.
 */
export function rollTreasureHoard(
  cr: number,
  rngState: number,
  compendium: SrdCompendium = defaultCompendium,
): { loot: LootBundleSpec; nextRng: number } {
  let currentRng = rngState;
  const items: string[] = [];

  const loot: LootBundleSpec = {};

  if (cr < 5) {
    // Challenge 0–4 Hoard
    const rCp = rollMultipleDice(currentRng, 6, 6);
    const rSp = rollMultipleDice(rCp.nextState, 3, 6);
    const rGp = rollMultipleDice(rSp.nextState, 2, 6);
    currentRng = rGp.nextState;

    loot.cp = sumDice(rCp.rolls) * 100;
    loot.sp = sumDice(rSp.rolls) * 100;
    loot.gp = sumDice(rGp.rolls) * 10;

    const { roll: d100, nextState: rD100 } = rollDie(currentRng, 100);
    currentRng = rD100;

    if (d100 >= 37 && d100 <= 60) {
      // 2d6 gems (10 gp each)
      const rGems = rollMultipleDice(currentRng, 2, 6);
      currentRng = rGems.nextState;
      loot.gp = (loot.gp ?? 0) + sumDice(rGems.rolls) * 10;
    } else if (d100 >= 61 && d100 <= 75) {
      // 1d6 Table A magic items
      const rCount = rollDie(currentRng, 6);
      currentRng = rCount.nextState;
      for (let i = 0; i < Math.min(rCount.roll, 2); i++) {
        const picked = pickFromTable(MAGIC_ITEM_TABLE_A, currentRng);
        items.push(picked.item);
        currentRng = picked.nextRng;
      }
    } else if (d100 >= 76 && d100 <= 85) {
      // 1d4 Table B magic items
      const rCount = rollDie(currentRng, 4);
      currentRng = rCount.nextState;
      for (let i = 0; i < Math.min(rCount.roll, 2); i++) {
        const picked = pickFromTable(MAGIC_ITEM_TABLE_B, currentRng);
        items.push(picked.item);
        currentRng = picked.nextRng;
      }
    } else if (d100 >= 86 && d100 <= 92) {
      // 1d4 Table C magic items
      const rCount = rollDie(currentRng, 4);
      currentRng = rCount.nextState;
      for (let i = 0; i < Math.min(rCount.roll, 2); i++) {
        const picked = pickFromTable(MAGIC_ITEM_TABLE_C, currentRng);
        items.push(picked.item);
        currentRng = picked.nextRng;
      }
    } else if (d100 >= 93 && d100 <= 97) {
      // 1d4 Table F magic items
      const rCount = rollDie(currentRng, 4);
      currentRng = rCount.nextState;
      for (let i = 0; i < Math.min(rCount.roll, 2); i++) {
        const picked = pickFromTable(MAGIC_ITEM_TABLE_F, currentRng);
        items.push(picked.item);
        currentRng = picked.nextRng;
      }
    } else if (d100 >= 98) {
      // 1d4 Table G magic items
      const rCount = rollDie(currentRng, 4);
      currentRng = rCount.nextState;
      for (let i = 0; i < Math.min(rCount.roll, 1); i++) {
        const picked = pickFromTable(MAGIC_ITEM_TABLE_G, currentRng);
        items.push(picked.item);
        currentRng = picked.nextRng;
      }
    }
  } else if (cr < 11) {
    // Challenge 5–10 Hoard
    const rCp = rollMultipleDice(currentRng, 2, 6);
    const rSp = rollMultipleDice(rCp.nextState, 2, 6);
    const rGp = rollMultipleDice(rSp.nextState, 6, 6);
    const rPp = rollMultipleDice(rGp.nextState, 3, 6);
    currentRng = rPp.nextState;

    loot.cp = sumDice(rCp.rolls) * 100;
    loot.sp = sumDice(rSp.rolls) * 1000;
    loot.gp = sumDice(rGp.rolls) * 100;
    loot.pp = sumDice(rPp.rolls) * 10;

    const { roll: d100, nextState: rD100 } = rollDie(currentRng, 100);
    currentRng = rD100;

    if (d100 >= 29 && d100 <= 44) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_A, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    } else if (d100 >= 45 && d100 <= 63) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_B, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    } else if (d100 >= 64 && d100 <= 80) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_C, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    } else if (d100 >= 81 && d100 <= 94) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_F, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    } else if (d100 >= 95 && d100 <= 98) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_G, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    } else if (d100 >= 99) {
      const picked = pickFromTable(MAGIC_ITEM_TABLE_H, currentRng);
      items.push(picked.item);
      currentRng = picked.nextRng;
    }
  } else {
    // Challenge 11+ Hoard
    const rGp = rollMultipleDice(currentRng, 4, 6);
    const rPp = rollMultipleDice(rGp.nextState, 5, 6);
    currentRng = rPp.nextState;
    loot.gp = sumDice(rGp.rolls) * 1000;
    loot.pp = sumDice(rPp.rolls) * 100;

    const picked1 = pickFromTable(MAGIC_ITEM_TABLE_G, currentRng);
    items.push(picked1.item);
    const picked2 = pickFromTable(MAGIC_ITEM_TABLE_H, picked1.nextRng);
    items.push(picked2.item);
    currentRng = picked2.nextRng;
  }

  if (items.length > 0) {
    loot.items = items;
  }

  return { loot, nextRng: currentRng };
}

// ============================================================================
// 3. Loot Distribution & Character Inventory Assignment
// ============================================================================

/**
 * Applies a `LootBundleSpec` directly to a character's currency and inventory.
 * Stacks consumable potions/scrolls if an identical identified item is in inventory;
 * otherwise adds new `InventoryItemInstance`s.
 *
 * SRD-1307: pass `instanceIdPrefix` for deterministic instance ids
 * (`<prefix>-<itemId>-<n>`) instead of clock/random ids (corpse drops, sweeps).
 */
export function awardLootToCharacter(
  character: CharacterBuildState,
  loot: LootBundleSpec,
  compendium: SrdCompendium = defaultCompendium,
  instanceIdPrefix?: string,
): CharacterBuildState {
  const nextCurrency: CharacterCurrency = {
    cp: character.currency.cp + (loot.cp ?? 0),
    sp: character.currency.sp + (loot.sp ?? 0),
    ep: character.currency.ep + (loot.ep ?? 0),
    gp: character.currency.gp + (loot.gp ?? 0),
    pp: character.currency.pp + (loot.pp ?? 0),
  };

  const nextInventory = [...character.inventory];

  if (loot.items && loot.items.length > 0) {
    const lootItems: string[] = loot.items;
    for (let itemIndex = 0; itemIndex < lootItems.length; itemIndex++) {
      const itemId: string = lootItems[itemIndex]!;
      // If item is a potion or stackable consumable and already in inventory, stack quantity
      const isConsumable = itemId.startsWith('potion-') || itemId.startsWith('scroll-');
      const existingIdx = isConsumable
        ? nextInventory.findIndex((i) => i.itemId === itemId && i.identified !== false)
        : -1;

      if (existingIdx >= 0) {
        const existing = nextInventory[existingIdx]!;
        nextInventory[existingIdx] = {
          ...existing,
          quantity: existing.quantity + 1,
        };
      } else {
        nextInventory.push(
          createInventoryItemInstance(
            itemId,
            compendium,
            instanceIdPrefix
              ? { instanceId: `${instanceIdPrefix}-${itemId}-${itemIndex}` }
              : undefined,
          ),
        );
      }
    }
  }

  return {
    ...character,
    currency: nextCurrency,
    inventory: nextInventory,
  };
}

/**
 * Claims loot from an interactive prop (e.g. chest, defeated container, corpse).
 * Requires prop to be open or destroyed.
 * Emits LOOT_ACQUIRED and updates hero's inventory and state.
 */
export function claimPropLoot(
  state: GameState,
  propId: string,
  actorId: string,
  compendium: SrdCompendium = defaultCompendium,
  instanceIdPrefix?: string,
): { nextState: GameState; events: GameEvent[]; loot: LootBundleSpec } {
  const prop = state.props.find((p) => p.id === propId);
  if (!prop) {
    throw new Error(`Interactive prop with id ${propId} not found`);
  }

  if (prop.state !== 'open' && prop.state !== 'destroyed') {
    throw new Error(`Cannot claim loot from prop in state '${prop.state}'. Must be 'open' or 'destroyed'.`);
  }

  if (!prop.lootTable) {
    return {
      nextState: state,
      events: [],
      loot: {},
    };
  }

  const lootToClaim = structuredClone(prop.lootTable);
  const hero = state.party[actorId];
  if (!hero) {
    throw new Error(`Actor ${actorId} not found in party`);
  }

  // Update prop: clear its loot table so it cannot be claimed twice
  const nextProps = state.props.map((p) =>
    p.id === propId ? { ...p, lootTable: undefined } : p,
  );

  let nextParty = { ...state.party };

  if (hero.buildState) {
    const updatedBuild = awardLootToCharacter(hero.buildState, lootToClaim, compendium, instanceIdPrefix);
    const updatedSheet = computeDerivedCharacter(updatedBuild, compendium);
    nextParty[actorId] = {
      ...hero,
      buildState: updatedBuild,
      characterSheet: updatedSheet,
    };
  }

  const events: GameEvent[] = [
    {
      type: 'LOOT_ACQUIRED',
      actorId,
      propId,
      loot: lootToClaim,
    },
  ];

  if (hero.buildState) {
    events.push({
      type: 'INVENTORY_UPDATED',
      characterId: actorId,
      inventory: nextParty[actorId]!.buildState!.inventory,
      currency: nextParty[actorId]!.buildState!.currency,
    });
  }

  const nextState: GameState = {
    ...state,
    props: nextProps,
    party: nextParty,
  };

  return {
    nextState,
    events,
    loot: lootToClaim,
  };
}
