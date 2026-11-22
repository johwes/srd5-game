import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  CharacterBuildStateSchema,
  defaultCompendium,
  getActiveWeaponSlotIds,
  getPregenCharacter,
  getWeaponSetSlotIds,
  normalizeEquippedSlots,
} from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import { createInitialGameState, reduceGame } from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import { validateEquipLoadout } from '../dungeon/inventory-management.js';
import { type Combatant } from '../combat/types.js';

const compendium = defaultCompendium;

function makeFighterHero(
  id: string,
  inventory: { instanceId: string; itemId: string; quantity: number }[],
  equippedSlots: CharacterBuildState['equippedSlots'],
): { hero: Combatant; state: ReturnType<typeof createInitialGameState> } {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const build: CharacterBuildState = {
    ...structuredClone(fighter),
    id,
    inventory: inventory as CharacterBuildState['inventory'],
    equippedSlots,
  };
  const hero = {
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
  const grid = createTacticalGrid(5, 5, 'floor_stone', 'bright');
  const state = createInitialGameState({ grid, party: [hero] });
  return { hero, state };
}

describe('SRD-1703: weapon-set schema & legacy migration', () => {
  it('legacy single-set saves parse and default to the primary set', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    // Pregens carry no discriminator — the legacy shape.
    expect(fighter.equippedSlots.activeWeaponSet).toBeUndefined();
    const parsed = CharacterBuildStateSchema.parse(structuredClone(fighter));
    const normalized = normalizeEquippedSlots(parsed.equippedSlots);
    expect(normalized.activeWeaponSet).toBe('primary');
    const active = getActiveWeaponSlotIds(parsed.equippedSlots);
    expect(active.mainHandInstanceId).toBe('fighter-longsword');
    expect(getWeaponSetSlotIds(parsed.equippedSlots, 'secondary')).toEqual({
      mainHandInstanceId: undefined,
      offHandInstanceId: undefined,
      rangedInstanceId: undefined,
    });
  });

  it('normalization never mutates its input', () => {
    const slots = { mainHandInstanceId: 'x' };
    const normalized = normalizeEquippedSlots(slots);
    expect(normalized.activeWeaponSet).toBe('primary');
    expect('activeWeaponSet' in slots).toBe(false);
  });
});

describe('SRD-1703: derivation filters to the active set only', () => {
  it('primary set derives longsword; secondary set derives shortbow', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const build: CharacterBuildState = {
      ...structuredClone(fighter),
      inventory: [
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
      equippedSlots: {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
    };
    const primarySheet = computeDerivedCharacter(build, compendium);
    expect(primarySheet.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(true);
    expect(primarySheet.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(false);

    const secondarySheet = computeDerivedCharacter(
      { ...build, equippedSlots: { ...build.equippedSlots, activeWeaponSet: 'secondary' } },
      compendium,
    );
    expect(secondarySheet.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(true);
    expect(secondarySheet.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(false);
    // Unarmed strike is always present regardless of set.
    expect(secondarySheet.weaponAttacks.some((w) => w.slot === 'unarmed')).toBe(true);
  });

  it('armor class is shared across sets', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const build: CharacterBuildState = {
      ...structuredClone(fighter),
      inventory: [
        { instanceId: 'inst-mail', itemId: 'chain-mail', quantity: 1 },
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
      equippedSlots: {
        armorInstanceId: 'inst-mail',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
    };
    const primary = computeDerivedCharacter(build, compendium);
    const secondary = computeDerivedCharacter(
      { ...build, equippedSlots: { ...build.equippedSlots, activeWeaponSet: 'secondary' } },
      compendium,
    );
    expect(secondary.armorClass.totalAc).toBe(primary.armorClass.totalAc);
  });
});

describe('SRD-1703: SWAP_WEAPON_SET command (free swap)', () => {
  it('toggles sets, emits WEAPON_SET_SWAPPED, and swaps derived attacks', () => {
    const { state } = makeFighterHero(
      'fig-1',
      [
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
      {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
    );
    const before = computeDerivedCharacter(
      state.party['fig-1']!.buildState!,
      compendium,
    );
    expect(before.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(true);

    const swapped = reduceGame(state, { type: 'SWAP_WEAPON_SET', characterId: 'fig-1' });
    const afterSlots = swapped.nextState.party['fig-1']!.buildState!.equippedSlots;
    expect(afterSlots.activeWeaponSet).toBe('secondary');
    const after = swapped.nextState.party['fig-1']!.characterSheet!;
    expect(after.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(true);
    expect(after.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(false);
    expect(swapped.events).toContainEqual({
      type: 'WEAPON_SET_SWAPPED',
      characterId: 'fig-1',
      activeWeaponSet: 'secondary',
    });

    // Swap back restores the primary attacks.
    const back = reduceGame(swapped.nextState, { type: 'SWAP_WEAPON_SET', characterId: 'fig-1' });
    expect(back.nextState.party['fig-1']!.buildState!.equippedSlots.activeWeaponSet).toBe('primary');
    expect(
      back.nextState.party['fig-1']!.characterSheet!.weaponAttacks.some((w) => w.weaponId === 'longsword'),
    ).toBe(true);
  });

  it('honors an explicit target set and no-ops when already active', () => {
    const { state } = makeFighterHero(
      'fig-2',
      [
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
      {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
    );
    const explicit = reduceGame(state, {
      type: 'SWAP_WEAPON_SET',
      characterId: 'fig-2',
      weaponSet: 'secondary',
    });
    expect(explicit.nextState.party['fig-2']!.buildState!.equippedSlots.activeWeaponSet).toBe('secondary');

    // Already on secondary: no event, state sheet unchanged.
    const noop = reduceGame(explicit.nextState, {
      type: 'SWAP_WEAPON_SET',
      characterId: 'fig-2',
      weaponSet: 'secondary',
    });
    expect(noop.events.some((e) => e.type === 'WEAPON_SET_SWAPPED')).toBe(false);
  });

  it('EQUIP_LOADOUT can populate the secondary set and dedupes across sets', () => {
    const { state } = makeFighterHero(
      'fig-3',
      [{ instanceId: 'inst-dagger', itemId: 'dagger', quantity: 1 }],
      { mainHandInstanceId: 'inst-dagger' },
    );
    const res = reduceGame(state, {
      type: 'EQUIP_LOADOUT',
      characterId: 'fig-3',
      equippedSlots: {
        mainHandInstanceId: 'inst-dagger',
        secondaryMainHandInstanceId: 'inst-dagger',
      },
    });
    const slots = res.nextState.party['fig-3']!.buildState!.equippedSlots;
    // One physical instance cannot occupy two sets: the changed (secondary) slot wins.
    expect(slots.secondaryMainHandInstanceId).toBe('inst-dagger');
    expect(slots.mainHandInstanceId).toBeUndefined();
  });
});

describe('SRD-1703: loadout validation covers both sets', () => {
  it('rejects slot mismatches in the secondary set with set-prefixed labels', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const build: CharacterBuildState = {
      ...structuredClone(fighter),
      inventory: [{ instanceId: 'inst-mail', itemId: 'chain-mail', quantity: 1 }],
    };
    const bad = validateEquipLoadout(
      build,
      { secondaryMainHandInstanceId: 'inst-mail' },
      compendium,
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]!.code).toBe('slot_mismatch');
    expect(bad.errors[0]!.slot).toBe('secondary:mainHand');
  });

  it('rejects secondary references to inventory the hero does not carry', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const bad = validateEquipLoadout(
      fighter,
      { secondaryRangedInstanceId: 'ghost-bow' },
      compendium,
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]!.code).toBe('missing_item');
    expect(bad.errors[0]!.slot).toBe('secondary:ranged');
  });

  it('accepts a valid two-set loadout', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const build: CharacterBuildState = {
      ...structuredClone(fighter),
      inventory: [
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
    };
    const ok = validateEquipLoadout(
      build,
      {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
      compendium,
    );
    expect(ok.ok).toBe(true);
  });
});
