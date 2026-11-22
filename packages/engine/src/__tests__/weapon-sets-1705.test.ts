import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import { createInitialGameState, reduceGame } from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import { type Combatant } from '../combat/types.js';

const compendium = defaultCompendium;

function makeHero(
  id: string,
  inventory: { instanceId: string; itemId: string; quantity: number }[],
  equippedSlots: CharacterBuildState['equippedSlots'],
): { state: ReturnType<typeof createInitialGameState> } {
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
  return { state };
}

describe('SRD-1705: weapon-set verification gate (headless)', () => {
  it('equip set A -> swap -> attacks switch -> swap back (full gate flow)', () => {
    // Start bare-handed: nothing equipped in either set.
    const { state } = makeHero('gate-1', [
      { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
      { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
    ], { activeWeaponSet: 'primary' });

    // Equip Set A (primary melee) + Set B (secondary ranged) in one loadout.
    const equipped = reduceGame(state, {
      type: 'EQUIP_LOADOUT',
      characterId: 'gate-1',
      equippedSlots: {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      },
    });
    const sheetA = equipped.nextState.party['gate-1']!.characterSheet!;
    expect(sheetA.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(true);
    expect(sheetA.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(false);

    // Swap to Set II: attacks switch to the bow.
    const swapped = reduceGame(equipped.nextState, {
      type: 'SWAP_WEAPON_SET',
      characterId: 'gate-1',
    });
    expect(swapped.nextState.party['gate-1']!.buildState!.equippedSlots.activeWeaponSet).toBe('secondary');
    const sheetB = swapped.nextState.party['gate-1']!.characterSheet!;
    expect(sheetB.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(true);
    expect(sheetB.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(false);
    expect(swapped.events).toContainEqual({
      type: 'WEAPON_SET_SWAPPED',
      characterId: 'gate-1',
      activeWeaponSet: 'secondary',
    });

    // Swap back: primary attacks restore exactly.
    const back = reduceGame(swapped.nextState, {
      type: 'SWAP_WEAPON_SET',
      characterId: 'gate-1',
      weaponSet: 'primary',
    });
    const sheetBack = back.nextState.party['gate-1']!.characterSheet!;
    expect(sheetBack.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(true);
    expect(sheetBack.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(false);
    expect(back.nextState.party['gate-1']!.buildState!.equippedSlots.activeWeaponSet).toBe('primary');
  });

  it('swapping is free: no action/bonus/move cost, armor shared, unarmed always present', () => {
    const { state } = makeHero('gate-2', [
      { instanceId: 'inst-mail', itemId: 'chain-mail', quantity: 1 },
      { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
      { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
    ], {
      activeWeaponSet: 'primary',
      armorInstanceId: 'inst-mail',
      mainHandInstanceId: 'inst-sword',
      secondaryRangedInstanceId: 'inst-bow',
    });

    const before = computeDerivedCharacter(state.party['gate-2']!.buildState!, compendium);
    const swapped = reduceGame(state, { type: 'SWAP_WEAPON_SET', characterId: 'gate-2' });
    const afterSlots = swapped.nextState.party['gate-2']!.buildState!.equippedSlots;
    const after = swapped.nextState.party['gate-2']!.characterSheet!;

    // Free swap: reducer touches only the discriminator + recomputed sheet.
    expect(afterSlots.activeWeaponSet).toBe('secondary');
    expect(afterSlots.armorInstanceId).toBe('inst-mail');
    expect(after.armorClass.totalAc).toBe(before.armorClass.totalAc);

    // Unarmed strike survives on both sets; each set shows only its own weapons.
    expect(after.weaponAttacks.some((w) => w.slot === 'unarmed')).toBe(true);
    expect(before.weaponAttacks.some((w) => w.slot === 'unarmed')).toBe(true);
    expect(before.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(true);
    expect(after.weaponAttacks.some((w) => w.weaponId === 'shortbow')).toBe(true);
    expect(after.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(false);
  });

  it('empty secondary set derives unarmed-only (no crash, no stale primary weapons)', () => {
    const { state } = makeHero('gate-3', [
      { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
    ], {
      activeWeaponSet: 'primary',
      mainHandInstanceId: 'inst-sword',
    });
    const swapped = reduceGame(state, {
      type: 'SWAP_WEAPON_SET',
      characterId: 'gate-3',
      weaponSet: 'secondary',
    });
    const sheet = swapped.nextState.party['gate-3']!.characterSheet!;
    expect(sheet.weaponAttacks.some((w) => w.slot === 'unarmed')).toBe(true);
    expect(sheet.weaponAttacks.some((w) => w.weaponId === 'longsword')).toBe(false);
  });
});
