import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  createDefaultCurrency,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { createInitialGameState, reduceGame } from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import {
  dropInventoryItem,
  getCarryingCapacityLb,
  getDungeonSellValueGp,
  getEncumbranceStatus,
  getInventoryWeightLb,
  getItemBasePriceGp,
  identifyInventoryItem,
  isArmorProficient,
  isWeaponProficient,
  sellInventoryItem,
  splitInventoryStack,
  transferInventoryItem,
  validateEquipLoadout,
} from '../dungeon/inventory-management.js';
import { type Combatant } from '../combat/types.js';

const compendium = defaultCompendium;

function makeHero(id: string, overrides?: Partial<CharacterBuildState>): Combatant {
  const base = getPregenCharacter('pregen-fighter')!;
  const build: CharacterBuildState = {
    ...structuredClone(base),
    id,
    inventory: overrides?.inventory ?? [],
    currency: overrides?.currency ?? createDefaultCurrency({ gp: 10 }),
    equippedSlots: overrides?.equippedSlots ?? {},
    attunedItemInstanceIds: overrides?.attunedItemInstanceIds ?? [],
    ...overrides,
  };
  return {
    id,
    name: id,
    side: 'party',
    size: 'medium',
    position: { x: 1, y: 1 },
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
    initiativeRollMode: 'normal',
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
    buildState: build,
  } as unknown as Combatant;
}

function twoHeroState() {
  const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
  const a = makeHero('hero-a', {
    inventory: [
      { instanceId: 'inst-sword-a', itemId: 'longsword', quantity: 1 },
      { instanceId: 'inst-pot-a', itemId: 'potion-of-healing', quantity: 3 },
      { instanceId: 'inst-cloak-u', itemId: 'cloak-of-protection', quantity: 1, isMagicItem: true, identified: false },
    ],
  });
  const b = makeHero('hero-b', { inventory: [] });
  return createInitialGameState({ grid, party: [a, b] });
}

describe('SRD-1306: weight display vs enforcement (display only)', () => {
  it('computes quantity-aware weight and STR×15 capacity without blocking', () => {
    const inv = [
      { instanceId: 'a', itemId: 'longsword', quantity: 1 },
      { instanceId: 'b', itemId: 'potion-of-healing', quantity: 2 },
    ];
    const total = getInventoryWeightLb(inv, compendium);
    expect(total).toBeGreaterThan(0);
    expect(getCarryingCapacityLb(16)).toBe(240);
    expect(getCarryingCapacityLb(8)).toBe(120);

    const base = getPregenCharacter('pregen-fighter')!;
    const status = getEncumbranceStatus(
      { ...base, inventory: [{ instanceId: 'x', itemId: 'chain-mail', quantity: 1 }] },
      compendium,
    );
    expect(status.capacityLb).toBe(status.strScore * 15);
    expect(status.encumbered).toBe(false);
    expect(status.variant).toBe('none');
  });

  it('flags over-capacity carries as display badges (no throw)', () => {
    const base = getPregenCharacter('pregen-fighter')!;
    // 20 suits of plate-equivalent weight guarantees over-capacity for any STR.
    const heavy = Array.from({ length: 20 }, (_, i) => ({
      instanceId: `plate-${i}`,
      itemId: 'plate-armor',
      quantity: 1,
    }));
    const status = getEncumbranceStatus({ ...base, inventory: heavy }, compendium);
    expect(status.encumbered).toBe(true);
    expect(status.overCapacityByLb).toBeGreaterThan(0);
    expect(status.variant).toBe('heavily_encumbered');
  });
});

describe('SRD-1306: equip restriction enforcement', () => {
  it('maps armor categories to proficiency grants', () => {
    expect(isArmorProficient(['light-armor', 'medium-armor', 'shields'], 'light')).toBe(true);
    expect(isArmorProficient(['light-armor'], 'heavy')).toBe(false);
    expect(isArmorProficient(['light-armor', 'shields'], 'shield')).toBe(true);
    expect(isArmorProficient([], 'shield')).toBe(false);
  });

  it('maps weapon categories and specific grants', () => {
    expect(isWeaponProficient(['simple-weapons', 'martial-weapons'], 'martial', 'longsword')).toBe(true);
    expect(isWeaponProficient(['simple-weapons'], 'martial', 'longsword')).toBe(false);
    // Druid-style specific grant covers the named weapon only.
    expect(isWeaponProficient(['scimitar'], 'martial', 'scimitar')).toBe(true);
    expect(isWeaponProficient(['scimitar'], 'martial', 'longsword')).toBe(false);
  });

  it('blocks armor/shield without proficiency, warns on STR and weapon gaps', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    const withPlate: CharacterBuildState = {
      ...structuredClone(wizard),
      inventory: [{ instanceId: 'inst-plate', itemId: 'plate-armor', quantity: 1 }],
    };
    const blocked = validateEquipLoadout(withPlate, { armorInstanceId: 'inst-plate' }, compendium);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((e) => e.code === 'armor_proficiency_missing')).toBe(true);

    // Fighter in chain mail passes (proficient, STR 16 meets req 13).
    const fighter = getPregenCharacter('pregen-fighter')!;
    const withChain: CharacterBuildState = {
      ...structuredClone(fighter),
      inventory: [{ instanceId: 'inst-chain', itemId: 'chain-mail', quantity: 1 }],
    };
    const allowed = validateEquipLoadout(withChain, { armorInstanceId: 'inst-chain' }, compendium);
    expect(allowed.errors).toHaveLength(0);

    // Missing instance + slot mismatch are blocking errors.
    const missing = validateEquipLoadout(withChain, { armorInstanceId: 'nope' }, compendium);
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]!.code).toBe('missing_item');
    const mismatch = validateEquipLoadout(withChain, { shieldInstanceId: 'inst-chain' } as never, compendium);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors[0]!.code).toBe('slot_mismatch');
  });

  it('rejects invalid EQUIP_LOADOUT through reduceGame', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
    const hero = makeHero('wiz-1', {
      inventory: [{ instanceId: 'inst-plate', itemId: 'plate-armor', quantity: 1 }],
    });
    hero.buildState = { ...structuredClone(wizard), id: 'wiz-1', inventory: hero.buildState!.inventory };
    const state = createInitialGameState({ grid, party: [hero] });
    expect(() =>
      reduceGame(state, {
        type: 'EQUIP_LOADOUT',
        characterId: 'wiz-1',
        equippedSlots: { armorInstanceId: 'inst-plate' },
      }),
    ).toThrow(/Invalid loadout/);
  });
});

describe('SRD-1306: stack splitting (deterministic)', () => {
  it('splits a partial quantity into a deterministic sibling instance', () => {
    const inv = [{ instanceId: 'inst-pot', itemId: 'potion-of-healing', quantity: 3 }];
    const first = splitInventoryStack(inv, 'inst-pot', 1);
    expect(first.splitInstance.instanceId).toBe('inst-pot-split-1');
    expect(first.splitInstance.quantity).toBe(1);
    expect(first.nextInventory.find((i) => i.instanceId === 'inst-pot')!.quantity).toBe(2);

    // De-duplication appends a numeric suffix instead of colliding.
    const again = splitInventoryStack(first.nextInventory, 'inst-pot', 1, 'inst-pot-split-1');
    expect(again.splitInstance.instanceId).toBe('inst-pot-split-1-2');
  });

  it('rejects invalid splits', () => {
    const inv = [{ instanceId: 's', itemId: 'potion-of-healing', quantity: 1 }];
    expect(() => splitInventoryStack(inv, 's', 1)).toThrow(/Cannot split/);
    expect(() => splitInventoryStack(inv, 'missing', 1)).toThrow(/not found/);
    const big = [{ instanceId: 'b', itemId: 'potion-of-healing', quantity: 2 }];
    expect(() => splitInventoryStack(big, 'b', 2)).toThrow(/must be less than/);
  });

  it('processes SPLIT_ITEM_STACK via reduceGame with events', () => {
    const state = twoHeroState();
    const { nextState, events } = reduceGame(state, {
      type: 'SPLIT_ITEM_STACK',
      characterId: 'hero-a',
      itemInstanceId: 'inst-pot-a',
      quantity: 1,
    });
    const inv = nextState.party['hero-a']!.buildState!.inventory;
    expect(inv.find((i) => i.instanceId === 'inst-pot-a')!.quantity).toBe(2);
    expect(inv.some((i) => i.instanceId === 'inst-pot-a-split-1')).toBe(true);
    expect(events.some((e) => e.type === 'ITEM_STACK_SPLIT')).toBe(true);
    expect(events.some((e) => e.type === 'INVENTORY_UPDATED')).toBe(true);
  });
});

describe('SRD-1306: trade/give commands', () => {
  it('moves a full stack preserving the instance id', () => {
    const state = twoHeroState();
    const { nextState, movedInstanceId } = transferInventoryItem(
      state,
      'hero-a',
      'hero-b',
      'inst-sword-a',
    );
    expect(movedInstanceId).toBe('inst-sword-a');
    expect(nextState.party['hero-a']!.buildState!.inventory.some((i) => i.instanceId === 'inst-sword-a')).toBe(false);
    expect(nextState.party['hero-b']!.buildState!.inventory.some((i) => i.itemId === 'longsword')).toBe(true);
  });

  it('partial transfers split deterministically and stack potions', () => {
    const state = twoHeroState();
    const { nextState } = transferInventoryItem(state, 'hero-a', 'hero-b', 'inst-pot-a', 1);
    expect(nextState.party['hero-a']!.buildState!.inventory.find((i) => i.instanceId === 'inst-pot-a')!.quantity).toBe(2);
    const recipient = nextState.party['hero-b']!.buildState!.inventory;
    expect(recipient.reduce((n, i) => n + (i.itemId === 'potion-of-healing' ? i.quantity : 0), 0)).toBe(1);
  });

  it('refuses equipped transfers and same-character gifts', () => {
    const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
    const a = makeHero('a', { inventory: [{ instanceId: 'sw', itemId: 'longsword', quantity: 1 }] });
    const b = makeHero('b', { inventory: [] });
    const equipped: CharacterBuildState = {
      ...a.buildState!,
      equippedSlots: { mainHandInstanceId: 'sw' },
    };
    const st = createInitialGameState({
      grid,
      party: [
        { ...a, buildState: equipped } as unknown as Combatant,
        b,
      ],
    });
    expect(() => transferInventoryItem(st, 'a', 'b', 'sw')).toThrow(/unequip/);
    expect(() => transferInventoryItem(twoHeroState(), 'hero-a', 'hero-a', 'inst-sword-a')).toThrow(/same character/);
  });

  it('processes TRANSFER_ITEM via reduceGame', () => {
    const state = twoHeroState();
    const { nextState, events } = reduceGame(state, {
      type: 'TRANSFER_ITEM',
      fromCharacterId: 'hero-a',
      toCharacterId: 'hero-b',
      itemInstanceId: 'inst-sword-a',
    });
    expect(events.some((e) => e.type === 'ITEM_TRANSFERRED')).toBe(true);
    expect(nextState.party['hero-b']!.buildState!.inventory.length).toBe(1);
  });
});

describe('SRD-1306: drop command', () => {
  it('drops a partial stack and clears equip/attune on full drop', () => {
    const state = twoHeroState();
    const partial = dropInventoryItem(state, 'hero-a', 'inst-pot-a', 1);
    expect(partial.droppedQuantity).toBe(1);
    expect(partial.nextState.party['hero-a']!.buildState!.inventory.find((i) => i.instanceId === 'inst-pot-a')!.quantity).toBe(2);

    const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
    const geared = makeHero('g', {
      inventory: [{ instanceId: 'clk', itemId: 'cloak-of-protection', quantity: 1, isMagicItem: true, identified: true }],
      equippedSlots: {},
      attunedItemInstanceIds: ['clk'],
    });
    const st = createInitialGameState({ grid, party: [geared] });
    const full = dropInventoryItem(st, 'g', 'clk');
    expect(full.nextState.party['g']!.buildState!.inventory).toHaveLength(0);
    expect(full.nextState.party['g']!.buildState!.attunedItemInstanceIds).toHaveLength(0);
  });

  it('processes DROP_ITEM via reduceGame', () => {
    const state = twoHeroState();
    const { events } = reduceGame(state, {
      type: 'DROP_ITEM',
      characterId: 'hero-a',
      itemInstanceId: 'inst-sword-a',
    });
    expect(events.some((e) => e.type === 'ITEM_DROPPED')).toBe(true);
  });
});

describe('SRD-1306: identification flow (free dungeon handling)', () => {
  it('identifies an unidentified find and rejects double-identifies', () => {
    const state = twoHeroState();
    const { nextState, events } = identifyInventoryItem(state, 'hero-a', 'inst-cloak-u');
    expect(nextState.party['hero-a']!.buildState!.inventory.find((i) => i.instanceId === 'inst-cloak-u')!.identified).toBe(true);
    expect(events.some((e) => e.type === 'INVENTORY_UPDATED')).toBe(true);
    expect(() => identifyInventoryItem(nextState, 'hero-a', 'inst-cloak-u')).toThrow(/already identified/);
  });

  it('processes IDENTIFY_ITEM via reduceGame', () => {
    const state = twoHeroState();
    const { events } = reduceGame(state, {
      type: 'IDENTIFY_ITEM',
      characterId: 'hero-a',
      itemInstanceId: 'inst-cloak-u',
    });
    expect(events.some((e) => e.type === 'ITEM_IDENTIFIED')).toBe(true);
  });
});

describe('SRD-1306: dungeon sell-back (half value)', () => {
  it('prices mundane gear at half cost and magic items by rarity fallback', () => {
    expect(getItemBasePriceGp('longsword', compendium)).toBeCloseTo(15, 5);
    expect(getDungeonSellValueGp('longsword', compendium)).toBe(7);
    expect(getDungeonSellValueGp('cloak-of-protection', compendium)).toBeGreaterThanOrEqual(1);
    expect(() => getDungeonSellValueGp('not-a-real-item', compendium)).toThrow(/no sellable value/);
  });

  it('sells into the purse and removes the instance', () => {
    const state = twoHeroState();
    const before = state.party['hero-a']!.buildState!.currency.gp;
    const { nextState, goldEarned } = sellInventoryItem(state, 'hero-a', 'inst-sword-a');
    expect(goldEarned).toBe(7);
    expect(nextState.party['hero-a']!.buildState!.currency.gp).toBe(before + 7);
    expect(nextState.party['hero-a']!.buildState!.inventory.some((i) => i.instanceId === 'inst-sword-a')).toBe(false);
  });

  it('refuses equipped sales and processes SELL_ITEM via reduceGame', () => {
    const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
    const geared = makeHero('g', {
      inventory: [{ instanceId: 'sw', itemId: 'longsword', quantity: 1 }],
      equippedSlots: { mainHandInstanceId: 'sw' },
    });
    const st = createInitialGameState({ grid, party: [geared] });
    expect(() => sellInventoryItem(st, 'g', 'sw')).toThrow(/unequip/);

    const { events } = reduceGame(twoHeroState(), {
      type: 'SELL_ITEM',
      characterId: 'hero-a',
      itemInstanceId: 'inst-sword-a',
    });
    expect(events.some((e) => e.type === 'ITEM_SOLD')).toBe(true);
  });
});
