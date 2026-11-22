import { describe, expect, it } from 'vitest';
import {
  SUNKEN_CRYPT_OF_KAELEN,
  defaultCompendium,
  getCampaignFloor,
  getSunkenCryptModule,
} from '@srd5/data';
import {
  type Combatant,
  claimPropLoot,
  createDungeonGameState,
  isCellDifficultTerrain,
  resolveActiveSearch,
  resolveLongRest,
  resolvePropInteraction,
} from '../index.js';
import { checkDungeonEncounterTriggers } from '../dungeon/encounters.js';

function makePartyMember(
  id: string,
  name: string,
  x = 2,
  y = 2,
  perceptionBonus = 5,
  passivePerception = 15,
): Combatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 25,
    maxHp: 25,
    tempHp: 0,
    armorClass: 16,
    dexterityScore: 14,
    dexterityModifier: 2,
    strengthScore: 16,
    strengthModifier: 3,
    initiativeBonus: 2,
    initiativeRollMode: 'normal' as const,
    passivePerception,
    stealthModifier: 2,
    isSurprised: false,
    isDodging: false,
    conditions: [],
    deathSaves: { successes: 0 as const, failures: 0 as const },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    characterSheet: {
      id,
      name,
      buildStateId: id,
      level: 2,
      hitDice: {
        total: 2,
        current: 2,
        dieType: 'd10',
      },
      hp: {
        max: 25,
        current: 25,
        temp: 0,
      },
      abilities: {
        str: { score: 16, modifier: 3, savingThrow: 5 },
        dex: { score: 14, modifier: 2, savingThrow: 2 },
        con: { score: 14, modifier: 2, savingThrow: 4 },
        int: { score: 10, modifier: 0, savingThrow: 0 },
        wis: { score: 14, modifier: 2, savingThrow: 2 },
        cha: { score: 10, modifier: 0, savingThrow: 0 },
      },
      proficiencyBonus: 2,
      proficiencies: {
        tools: ['thieves_tools'],
        expertise: ['thieves_tools'],
      },
      skills: {
        perception: { totalBonus: perceptionBonus, proficient: true },
        investigation: { totalBonus: 2, proficient: true },
        athletics: { totalBonus: 5, proficient: true },
      },
      armorClass: { base: 16, total: 16, shieldBonus: 0, otherBonus: 0 },
      inventory: [],
      activeConditions: [],
      attunement: { maxSlots: 3, attunedItemIds: [] },
      spellcasting: { spellSlots: {}, spellsPrepared: [] },
      xp: 300,
    } as any,
  };
}

describe('SRD-506: Kaelen Campaign Engine Integration Tests', () => {
  const module = getSunkenCryptModule();

  it('Floor 1: loads into exploration state, supports door interaction, trap disarming, and armory looting', () => {
    const floor1 = getCampaignFloor(module, 'kaelen-floor-1')!;
    expect(floor1).toBeDefined();

    const party = [
      makePartyMember('hero-fighter', 'Sir Donald'),
      makePartyMember('hero-cleric', 'Brother Donald'),
      makePartyMember('hero-rogue', 'Donald the Shadow', 2, 2, 20),
      makePartyMember('hero-wizard', 'Archmage Donald', 2, 2, 20),
    ];

    const state = createDungeonGameState({
      floor: floor1,
      party,
      leadExplorerId: 'hero-fighter',
    });

    expect(state.mode).toBe('exploration');
    expect(state.dungeon?.floorId).toBe('kaelen-floor-1');
    expect(state.dungeon?.rooms['f1_courtyard']).toBeDefined();

    // 1. Position fighter at (5, 3) adjacent to courtyard door at (6, 3) and open it
    const atDoorState = {
      ...state,
      party: {
        ...state.party,
        'hero-fighter': { ...state.party['hero-fighter']!, position: { x: 5, y: 3 } },
      },
    };

    const doorRes = resolvePropInteraction({
      state: atDoorState,
      actorId: 'hero-fighter',
      propId: 'door_f1_courtyard_barracks',
      interaction: 'open',
    });
    expect(doorRes.events.some((e) => e.type === 'PROP_STATE_CHANGED')).toBe(true);

    // 2. Position rogue at (8, 12) adjacent to armory chest at (8, 13) and pick the lock
    const atChestState = {
      ...state,
      party: {
        ...state.party,
        'hero-rogue': { ...state.party['hero-rogue']!, position: { x: 8, y: 12 } },
      },
    };

    const pickRes = resolvePropInteraction({
      state: atChestState,
      actorId: 'hero-rogue',
      propId: 'chest_f1_armory',
      interaction: 'pick_lock',
    });
    expect(pickRes.events.some((e) => e.type === 'PROP_STATE_CHANGED')).toBe(true);

    // Open the unlocked chest
    const openChestRes = resolvePropInteraction({
      state: pickRes.nextState,
      actorId: 'hero-rogue',
      propId: 'chest_f1_armory',
      interaction: 'open',
    });

    // 3. Claim the loot from the opened armory chest
    const lootRes = claimPropLoot(openChestRes.nextState, 'chest_f1_armory', 'hero-rogue', defaultCompendium);
    expect(lootRes.loot.gp).toBe(43);
    expect(lootRes.loot.items).toContain('potion-of-greater-healing');
    expect(lootRes.events.some((e) => e.type === 'LOOT_ACQUIRED')).toBe(true);

    // 4. Position wizard at (14, 3) adjacent to dart trap at (14, 4), search to discover it, then disarm it
    const atTrapState = {
      ...state,
      party: {
        ...state.party,
        'hero-wizard': { ...state.party['hero-wizard']!, position: { x: 14, y: 3 } },
      },
    };

    const searchTrapRes = resolveActiveSearch({
      state: atTrapState,
      actorId: 'hero-wizard',
      propId: 'trap_f1_dart',
    });
    expect(searchTrapRes.events.some((e) => e.type === 'SECRET_DISCOVERED')).toBe(true);

    const disarmRes = resolvePropInteraction({
      state: searchTrapRes.nextState,
      actorId: 'hero-wizard',
      propId: 'trap_f1_dart',
      interaction: 'disarm_trap',
    });
    expect(disarmRes.events.some((e) => e.type === 'PROP_STATE_CHANGED')).toBe(true);

    // 5. Verify stairs down exists and points to kaelen-floor-2
    const stairs = state.props.find((p) => p.kind === 'stairs_down');
    expect(stairs).toBeDefined();
    expect(stairs?.id).toBe('stairs_f1_down');
  });

  it('Floor 2: supports resting in Sanctified Safe Room without ambush and reveals secret reliquary door', () => {
    const floor2 = getCampaignFloor(module, 'kaelen-floor-2')!;
    expect(floor2).toBeDefined();

    const party = [
      makePartyMember('hero-fighter', 'Sir Donald'),
      makePartyMember('hero-cleric', 'Brother Donald'),
      makePartyMember('hero-rogue', 'Donald the Shadow', 2, 2, 20),
      makePartyMember('hero-wizard', 'Archmage Donald', 2, 2, 20),
    ];

    const state = createDungeonGameState({
      floor: floor2,
      party,
      leadExplorerId: 'hero-fighter',
    });

    // 1. Verify Sanctified Shrine is marked as safe room
    expect(state.dungeon?.rooms['f2_shrine']?.isSafeRoom).toBe(true);

    // Position party in the Sanctified Shrine at (3, 8)
    const inShrineState = {
      ...state,
      party: {
        ...state.party,
        'hero-fighter': { ...state.party['hero-fighter']!, position: { x: 3, y: 8 } },
        'hero-cleric': { ...state.party['hero-cleric']!, position: { x: 3, y: 9 } },
      },
    };

    // Long rest inside safe room guarantees NO ambush
    const restRes = resolveLongRest(inShrineState, { type: 'START_REST', restType: 'long' });
    expect(restRes.events.some((e) => e.type === 'REST_INTERRUPTED')).toBe(false);
    expect(restRes.events.some((e) => e.type === 'REST_COMPLETED')).toBe(true);

    // 2. Secret Door Search: Searching secret door at (14, 6) reveals it
    const searchRes = resolveActiveSearch({
      state,
      actorId: 'hero-rogue',
      propId: 'door_f2_secret',
    });
    expect(searchRes.events.some((e) => e.type === 'SECRET_DISCOVERED')).toBe(true);

    // Position wizard adjacent to reliquary chest at (14, 2)
    const atReliquaryState = {
      ...searchRes.nextState,
      party: {
        ...searchRes.nextState.party,
        'hero-wizard': { ...searchRes.nextState.party['hero-wizard']!, position: { x: 14, y: 3 } },
      },
    };

    // Open the chest in reliquary
    const openChestRes = resolvePropInteraction({
      state: atReliquaryState,
      actorId: 'hero-wizard',
      propId: 'chest_f2_reliquary',
      interaction: 'open',
    });

    // 3. Reliquary chest loot contains +1 Longsword and Scroll of Fireball
    const reliquaryLoot = claimPropLoot(openChestRes.nextState, 'chest_f2_reliquary', 'hero-wizard', defaultCompendium);
    expect(reliquaryLoot.loot.items).toContain('longsword-plus-1');
    expect(reliquaryLoot.loot.items).toContain('scroll-of-fireball');
    expect(reliquaryLoot.loot.gp).toBe(120);
  });

  it('Floor 3: shallow water tiles are difficult terrain, Gelatinous Cube and Dragon encounters spawn properly', () => {
    const floor3 = getCampaignFloor(module, 'kaelen-floor-3')!;
    expect(floor3).toBeDefined();

    const party = [
      makePartyMember('hero-fighter', 'Sir Donald'),
      makePartyMember('hero-cleric', 'Brother Donald'),
      makePartyMember('hero-rogue', 'Donald the Shadow', 2, 2, 20),
      makePartyMember('hero-wizard', 'Archmage Donald', 2, 2, 20),
    ];

    const state = createDungeonGameState({
      floor: floor3,
      party,
      leadExplorerId: 'hero-fighter',
    });

    // 1. Grid shallow water cells count as difficult terrain
    const waterCell = state.grid.cells.find((c) => c.terrain === 'water_shallow');
    expect(waterCell).toBeDefined();
    expect(isCellDifficultTerrain(waterCell!)).toBe(true);

    // 2. Position fighter at (7, 3) facing cube at (8, 3) with LoS
    const inGalleryState = {
      ...state,
      party: {
        ...state.party,
        'hero-fighter': { ...state.party['hero-fighter']!, position: { x: 7, y: 3 } },
      },
    };

    const encRes = checkDungeonEncounterTriggers(inGalleryState, { compendium: defaultCompendium });
    expect(encRes.triggered).toBe(true);
    expect(encRes.encounterId).toBe('enc_f3_cube');
    expect(encRes.nextState.mode).toBe('combat');
    expect(
      Object.values(encRes.nextState.monsters).some((c) =>
        c.name.toLowerCase().includes('gelatinous cube'),
      ),
    ).toBe(true);

    // Position wizard adjacent to Dragon Hoard chest at (3, 12)
    const atHoardState = {
      ...state,
      party: {
        ...state.party,
        'hero-wizard': { ...state.party['hero-wizard']!, position: { x: 3, y: 11 } },
      },
    };

    // Open Dragon Hoard chest
    const openHoardRes = resolvePropInteraction({
      state: atHoardState,
      actorId: 'hero-wizard',
      propId: 'chest_f3_dragon_hoard',
      interaction: 'open',
    });

    // 3. Dragon Hoard chest loot verification
    const hoardRes = claimPropLoot(openHoardRes.nextState, 'chest_f3_dragon_hoard', 'hero-wizard', defaultCompendium);
    expect(hoardRes.loot.items).toContain('ring-of-protection');
    expect(hoardRes.loot.items).toContain('cloak-of-protection');
    expect(hoardRes.loot.items).toContain('potion-of-greater-healing');
    expect(hoardRes.loot.gp).toBe(775);
  });
});
