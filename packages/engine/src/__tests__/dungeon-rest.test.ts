import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type DungeonFloorSpec,
  type DerivedCharacterSheet,
  createDungeonGameState,
  reduceGame,
  resolveRest,
  resolveShortRest,
  resolveLongRest,
  getPartySongOfRestDie,
} from '../index.js';

function createMockSheet(options?: {
  totalLevel?: number;
  classes?: Array<{ classId: string; className: string; level: number; hitDie: 6 | 8 | 10 | 12 }>;
  hitDicePools?: Array<{ dieSize: 6 | 8 | 10 | 12; total: number; spent: number; available: number }>;
  conModifier?: number;
  resources?: Record<string, { resourceId: string; name: string; max: number; spent: number; available: number; recovery: 'short_rest' | 'long_rest' | 'dawn' }>;
  featureIds?: string[];
  preparedSpells?: string[];
  exhaustionLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  spellSlots?: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, { max: number; expended: number; available: number }>;
  pactMagic?: { slotLevel: number; maxSlots: number; expendedSlots: number; availableSlots: number };
}): DerivedCharacterSheet {
  const totalLevel = options?.totalLevel ?? 1;
  const classes = options?.classes ?? [
    { classId: 'fighter', className: 'Fighter', level: totalLevel, hitDie: 10 },
  ];
  const hitDicePools = options?.hitDicePools ?? [
    { dieSize: 10, total: totalLevel, spent: 0, available: totalLevel },
  ];
  const conMod = options?.conModifier ?? 2;

  const defaultSpellSlots: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, { max: number; expended: number; available: number }> = {
    1: { max: 0, expended: 0, available: 0 },
    2: { max: 0, expended: 0, available: 0 },
    3: { max: 0, expended: 0, available: 0 },
    4: { max: 0, expended: 0, available: 0 },
    5: { max: 0, expended: 0, available: 0 },
    6: { max: 0, expended: 0, available: 0 },
    7: { max: 0, expended: 0, available: 0 },
    8: { max: 0, expended: 0, available: 0 },
    9: { max: 0, expended: 0, available: 0 },
  };

  return {
    id: 'sheet-1',
    name: 'Hero',
    portraitId: 'p1',
    tokenSpriteId: 't1',
    raceId: 'human',
    raceName: 'Human',
    backgroundId: 'soldier',
    backgroundName: 'Soldier',
    alignment: 'neutral_good',
    size: 'medium',
    classes,
    totalLevel,
    xp: 0,
    proficiencyBonus: 2,
    abilities: {
      str: { score: 16, modifier: 3, pointBuyCost: 9, sourceBreakdown: [] },
      dex: { score: 14, modifier: 2, pointBuyCost: 7, sourceBreakdown: [] },
      con: { score: 10 + conMod * 2, modifier: conMod, pointBuyCost: 7, sourceBreakdown: [] },
      int: { score: 10, modifier: 0, pointBuyCost: 2, sourceBreakdown: [] },
      wis: { score: 12, modifier: 1, pointBuyCost: 4, sourceBreakdown: [] },
      cha: { score: 8, modifier: -1, pointBuyCost: 0, sourceBreakdown: [] },
    },
    activeModifiers: [],
    proficiencies: {
      armor: ['light', 'medium', 'heavy', 'shield'],
      weapons: ['simple', 'martial'],
      tools: [],
      savingThrows: ['str', 'con'],
      skills: ['athletics', 'survival'],
      expertise: [],
      languages: ['common'],
    },
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    traitIds: [],
    featureIds: options?.featureIds ?? [],
    featIds: [],
    savingThrows: {} as any,
    skills: {} as any,
    passivePerception: 11,
    passiveInvestigation: 10,
    passiveInsight: 11,
    maxHp: 20,
    currentHp: 20,
    tempHp: 0,
    hpBreakdown: [],
    hitDicePools,
    deathSaves: { successes: 0, failures: 0 },
    exhaustionLevel: options?.exhaustionLevel ?? 0,
    armorClass: {
      value: 16,
      formulaName: 'Chain Mail',
      baseAc: 16,
      dexCapped: false,
      shieldBonus: 0,
      magicBonus: 0,
      miscBonus: 0,
      breakdown: [],
      candidates: [],
    },
    speedFeet: 30,
    senses: { darkvisionFeet: 0, blindsightFeet: 0, truesightFeet: 0, tremorsenseFeet: 0 },
    initiative: { bonus: 2, rollMode: 'normal', breakdown: [] },
    weaponAttacks: [],
    spellcasting: {
      isSpellcaster: Boolean(options?.spellSlots || options?.pactMagic),
      effectiveCasterLevel: totalLevel,
      classes: [],
      spellSlots: { ...defaultSpellSlots, ...options?.spellSlots },
      pactMagic: options?.pactMagic,
      cantripIds: [],
      preparedOrKnownSpellIds: options?.preparedSpells ?? [],
      alwaysPreparedSpellIds: [],
      spellbookSpellIds: [],
    },
    attacksPerAction: 1,
    resources: options?.resources ?? {},
    activatedAbilities: [],
    activeConditions: [],
    activeEffects: [],
  };
}

function makeHero(
  id: string,
  name: string,
  x = 2,
  y = 2,
  options?: {
    currentHp?: number;
    maxHp?: number;
    sheet?: DerivedCharacterSheet;
    conditions?: any[];
  },
): Combatant {
  const maxHp = options?.maxHp ?? 20;
  const currentHp = options?.currentHp ?? maxHp;
  const sheet = options?.sheet ?? createMockSheet();
  sheet.maxHp = maxHp;
  sheet.currentHp = currentHp;

  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp,
    maxHp,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 10,
    stealthModifier: 2,
    isSurprised: false,
    conditions: options?.conditions ?? [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    characterSheet: sheet,
    spellSlots: sheet.spellcasting?.spellSlots,
    pactMagic: sheet.spellcasting?.pactMagic,
    exhaustionLevel: sheet.exhaustionLevel,
  };
}

function createTestFloor(isSafeRoom = true): DungeonFloorSpec {
  const width = 10;
  const height = 10;
  const cells: DungeonFloorSpec['cells'] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      cells.push({
        x,
        y,
        roomId: 'room_rest',
        terrain: isWall ? 'wall_solid' : 'floor_stone',
        baseLight: 'bright',
      });
    }
  }

  return {
    id: 'floor_rest_test',
    name: 'Rest Testing Crypt',
    width,
    height,
    partySpawnCells: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ],
    cells,
    props: [],
    encounters: [],
    rooms: [
      {
        id: 'room_rest',
        name: isSafeRoom ? 'Sanctified Shrine' : 'Unsecured Hall',
        isSafeRoom,
      },
    ],
  };
}

describe('SRD-504: Short Rest & Long Rest Engine', () => {
  describe('Short Rest: Hit Dice Spending', () => {
    it('spends hit dice and restores 1d(die) + CON mod HP (capped at maxHp)', () => {
      const sheet = createMockSheet({
        totalLevel: 3,
        conModifier: 2,
        hitDicePools: [{ dieSize: 10, total: 3, spent: 0, available: 3 }],
      });
      const hero = makeHero('hero-fighter', 'Fighter', 2, 2, {
        currentHp: 5,
        maxHp: 30,
        sheet,
      });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero], rngState: 12345 });

      // Spend 1 hit die
      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'hero-fighter': 1 },
      });

      const updatedHero = res.nextState.party['hero-fighter']!;
      expect(updatedHero.currentHp).toBeGreaterThan(5);
      expect(updatedHero.currentHp).toBeLessThanOrEqual(30);

      // Hit die pool is decremented
      const pool = updatedHero.characterSheet?.hitDicePools[0]!;
      expect(pool.spent).toBe(1);
      expect(pool.available).toBe(2);

      // Event emitted
      expect(res.events[0]).toMatchObject({
        type: 'REST_COMPLETED',
        restType: 'short',
        hitDiceSpent: { 'hero-fighter': 1 },
      });
    });

    it('clamps HP recovery to maxHp and does not allow negative healing', () => {
      const sheet = createMockSheet({
        totalLevel: 2,
        conModifier: -4, // Extreme negative CON mod
        hitDicePools: [{ dieSize: 6, total: 2, spent: 0, available: 2 }],
      });
      const hero = makeHero('hero-fragile', 'Fragile', 2, 2, {
        currentHp: 18,
        maxHp: 20,
        sheet,
      });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero], rngState: 9999 });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'hero-fragile': 2 },
      });

      const updatedHero = res.nextState.party['hero-fragile']!;
      // HP cannot decrease below 18, and cannot exceed 20
      expect(updatedHero.currentHp).toBeGreaterThanOrEqual(18);
      expect(updatedHero.currentHp).toBeLessThanOrEqual(20);
      expect(updatedHero.characterSheet?.hitDicePools[0]!.spent).toBe(2);
    });

    it('supports spending from specific multiclass pools', () => {
      const sheet = createMockSheet({
        totalLevel: 4,
        classes: [
          { classId: 'fighter', className: 'Fighter', level: 2, hitDie: 10 },
          { classId: 'wizard', className: 'Wizard', level: 2, hitDie: 6 },
        ],
        hitDicePools: [
          { dieSize: 10, total: 2, spent: 0, available: 2 },
          { dieSize: 6, total: 2, spent: 0, available: 2 },
        ],
      });
      const hero = makeHero('hero-multi', 'Multi', 2, 2, {
        currentHp: 5,
        maxHp: 30,
        sheet,
      });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero], rngState: 42 });

      // Spend 1 d6 die specifically
      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'hero-multi': { 6: 1 } },
      });

      const updatedHero = res.nextState.party['hero-multi']!;
      const pools = updatedHero.characterSheet?.hitDicePools!;
      const d10Pool = pools.find((p) => p.dieSize === 10)!;
      const d6Pool = pools.find((p) => p.dieSize === 6)!;

      expect(d10Pool.spent).toBe(0);
      expect(d6Pool.spent).toBe(1);
      expect(d6Pool.available).toBe(1);
    });

    it('wakes up unconscious stable hero when HP restored above 0', () => {
      const sheet = createMockSheet({
        totalLevel: 2,
        hitDicePools: [{ dieSize: 10, total: 2, spent: 0, available: 2 }],
      });
      const hero = makeHero('hero-down', 'Downed', 2, 2, {
        currentHp: 0,
        maxHp: 20,
        sheet,
        conditions: ['unconscious'],
      });
      hero.isStable = true;

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero], rngState: 100 });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'hero-down': 1 },
      });

      const updated = res.nextState.party['hero-down']!;
      expect(updated.currentHp).toBeGreaterThan(0);
      expect(updated.isStable).toBe(false);
      expect(updated.conditions).not.includes('unconscious');
    });
  });

  describe('Short Rest: Song of Rest (Bard L2+)', () => {
    it('detects Song of Rest die scaling correctly', () => {
      const makeBardParty = (level: number): Record<string, Combatant> => {
        const bardSheet = createMockSheet({
          totalLevel: level,
          classes: [{ classId: 'bard', className: 'Bard', level, hitDie: 8 }],
          featureIds: ['song-of-rest'],
        });
        const bard = makeHero('bard', 'Bard', 2, 2, { sheet: bardSheet });
        return { bard };
      };

      expect(getPartySongOfRestDie(makeBardParty(1))).toBeNull();
      expect(getPartySongOfRestDie(makeBardParty(2))).toBe(6);
      expect(getPartySongOfRestDie(makeBardParty(8))).toBe(6);
      expect(getPartySongOfRestDie(makeBardParty(9))).toBe(8);
      expect(getPartySongOfRestDie(makeBardParty(12))).toBe(8);
      expect(getPartySongOfRestDie(makeBardParty(13))).toBe(10);
      expect(getPartySongOfRestDie(makeBardParty(16))).toBe(10);
      expect(getPartySongOfRestDie(makeBardParty(17))).toBe(12);
      expect(getPartySongOfRestDie(makeBardParty(20))).toBe(12);
    });

    it('adds Song of Rest extra healing to any ally who spends hit dice', () => {
      const bardSheet = createMockSheet({
        totalLevel: 3,
        classes: [{ classId: 'bard', className: 'Bard', level: 3, hitDie: 8 }],
        featureIds: ['song-of-rest'],
      });
      const fighterSheet = createMockSheet({
        totalLevel: 3,
        hitDicePools: [{ dieSize: 10, total: 3, spent: 0, available: 3 }],
      });

      const bard = makeHero('bard', 'Bard', 2, 2, { currentHp: 20, maxHp: 20, sheet: bardSheet });
      const fighter = makeHero('fighter', 'Fighter', 3, 2, {
        currentHp: 5,
        maxHp: 30,
        sheet: fighterSheet,
      });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [bard, fighter], rngState: 777 });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { fighter: 1 },
      });

      const event = res.events.find((e) => e.type === 'REST_COMPLETED') as any;
      expect(event).toBeDefined();
      expect(event.songOfRestHp?.fighter).toBeGreaterThan(0);
      expect(res.nextState.party.fighter!.currentHp).toBeGreaterThan(5);
    });

    it('does not apply Song of Rest to allies who spent 0 hit dice', () => {
      const bardSheet = createMockSheet({
        totalLevel: 3,
        classes: [{ classId: 'bard', className: 'Bard', level: 3, hitDie: 8 }],
        featureIds: ['song-of-rest'],
      });
      const fighterSheet = createMockSheet({
        totalLevel: 3,
        hitDicePools: [{ dieSize: 10, total: 3, spent: 0, available: 3 }],
      });

      const bard = makeHero('bard', 'Bard', 2, 2, { sheet: bardSheet });
      const fighter = makeHero('fighter', 'Fighter', 3, 2, {
        currentHp: 10,
        maxHp: 30,
        sheet: fighterSheet,
      });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [bard, fighter], rngState: 777 });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { fighter: 0 },
      });

      const event = res.events.find((e) => e.type === 'REST_COMPLETED') as any;
      expect(event.songOfRestHp).toBeUndefined();
      expect(res.nextState.party.fighter!.currentHp).toBe(10);
    });
  });

  describe('Short Rest: Feature & Pact Magic Recharge', () => {
    it('recharges short_rest resources and Pact Magic spell slots', () => {
      const sheet = createMockSheet({
        totalLevel: 2,
        resources: {
          second_wind: {
            resourceId: 'second_wind',
            name: 'Second Wind',
            max: 1,
            spent: 1,
            available: 0,
            recovery: 'short_rest',
          },
          action_surge: {
            resourceId: 'action_surge',
            name: 'Action Surge',
            max: 1,
            spent: 1,
            available: 0,
            recovery: 'short_rest',
          },
          rage: {
            resourceId: 'rage',
            name: 'Rage',
            max: 2,
            spent: 2,
            available: 0,
            recovery: 'long_rest',
          },
        },
        pactMagic: {
          slotLevel: 1,
          maxSlots: 2,
          expendedSlots: 2,
          availableSlots: 0,
        },
      });

      const hero = makeHero('hero-warlock-fighter', 'Hexblade Fighter', 2, 2, { sheet });
      hero.pactMagic = {
        slotLevel: 1,
        maxSlots: 2,
        expendedSlots: 2,
        availableSlots: 0,
      };

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero] });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
      });

      const updated = res.nextState.party['hero-warlock-fighter']!;
      // Short rest resources recharged
      expect(updated.characterSheet?.resources.second_wind.available).toBe(1);
      expect(updated.characterSheet?.resources.action_surge.available).toBe(1);

      // Long rest resource NOT recharged
      expect(updated.characterSheet?.resources.rage.available).toBe(0);

      // Pact magic slots recharged
      expect(updated.pactMagic?.availableSlots).toBe(2);
      expect(updated.pactMagic?.expendedSlots).toBe(0);
      expect(updated.characterSheet?.spellcasting?.pactMagic?.availableSlots).toBe(2);
    });
  });

  describe('Short Rest: Arcane Recovery (Wizard)', () => {
    it('allows a Wizard to recover spell slots up to ceil(level/2) (none >= 6)', () => {
      const sheet = createMockSheet({
        totalLevel: 3,
        classes: [{ classId: 'wizard', className: 'Wizard', level: 3, hitDie: 6 }],
        featureIds: ['arcane-recovery'],
        resources: {
          arcane_recovery: {
            resourceId: 'arcane_recovery',
            name: 'Arcane Recovery',
            max: 1,
            spent: 0,
            available: 1,
            recovery: 'long_rest',
          },
        },
        spellSlots: {
          1: { max: 4, expended: 2, available: 2 },
          2: { max: 2, expended: 1, available: 1 },
          3: { max: 0, expended: 0, available: 0 },
          4: { max: 0, expended: 0, available: 0 },
          5: { max: 0, expended: 0, available: 0 },
          6: { max: 0, expended: 0, available: 0 },
          7: { max: 0, expended: 0, available: 0 },
          8: { max: 0, expended: 0, available: 0 },
          9: { max: 0, expended: 0, available: 0 },
        },
      });

      const wizard = makeHero('wizard', 'Wizard', 2, 2, { sheet });
      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [wizard] });

      // Level 3 wizard has capacity ceil(3/2) = 2. Recovers one 2nd-level slot
      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        arcaneRecovery: { wizard: [2] },
      });

      const updated = res.nextState.party.wizard!;
      expect(updated.spellSlots?.[2]?.available).toBe(2);
      expect(updated.spellSlots?.[2]?.expended).toBe(0);
      expect(updated.characterSheet?.resources.arcane_recovery.available).toBe(0);

      // Event logs slots recovered
      const event = res.events[0] as any;
      expect(event.slotsRecovered?.wizard).toEqual([2]);
    });

    it('rejects slot levels >= 6 and excess slot recovery', () => {
      const sheet = createMockSheet({
        totalLevel: 11,
        classes: [{ classId: 'wizard', className: 'Wizard', level: 11, hitDie: 6 }],
        featureIds: ['arcane-recovery'],
        resources: {
          arcane_recovery: {
            resourceId: 'arcane_recovery',
            name: 'Arcane Recovery',
            max: 1,
            spent: 0,
            available: 1,
            recovery: 'long_rest',
          },
        },
        spellSlots: {
          1: { max: 4, expended: 2, available: 2 },
          2: { max: 3, expended: 0, available: 3 },
          3: { max: 3, expended: 0, available: 3 },
          4: { max: 3, expended: 0, available: 3 },
          5: { max: 2, expended: 1, available: 1 },
          6: { max: 1, expended: 1, available: 0 },
          7: { max: 0, expended: 0, available: 0 },
          8: { max: 0, expended: 0, available: 0 },
          9: { max: 0, expended: 0, available: 0 },
        },
      });

      const wizard = makeHero('wizard', 'Wizard', 2, 2, { sheet });
      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [wizard] });

      // Requesting 6th level slot (forbidden by SRD)
      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        arcaneRecovery: { wizard: [6] },
      });

      const updated = res.nextState.party.wizard!;
      expect(updated.spellSlots?.[6]?.available).toBe(0); // Level 6 not recovered
    });

    it('enforces once per day limit on Arcane Recovery', () => {
      const sheet = createMockSheet({
        totalLevel: 3,
        classes: [{ classId: 'wizard', className: 'Wizard', level: 3, hitDie: 6 }],
        featureIds: ['arcane-recovery'],
        resources: {
          arcane_recovery: {
            resourceId: 'arcane_recovery',
            name: 'Arcane Recovery',
            max: 1,
            spent: 1, // Already spent
            available: 0,
            recovery: 'long_rest',
          },
        },
        spellSlots: {
          1: { max: 4, expended: 2, available: 2 },
          2: { max: 2, expended: 1, available: 1 },
          3: { max: 0, expended: 0, available: 0 },
          4: { max: 0, expended: 0, available: 0 },
          5: { max: 0, expended: 0, available: 0 },
          6: { max: 0, expended: 0, available: 0 },
          7: { max: 0, expended: 0, available: 0 },
          8: { max: 0, expended: 0, available: 0 },
          9: { max: 0, expended: 0, available: 0 },
        },
      });

      const wizard = makeHero('wizard', 'Wizard', 2, 2, { sheet });
      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [wizard] });

      const res = resolveShortRest(state, {
        type: 'START_REST',
        restType: 'short',
        arcaneRecovery: { wizard: [1] },
      });

      const updated = res.nextState.party.wizard!;
      expect(updated.spellSlots?.[1]?.available).toBe(2); // No recovery
    });
  });

  describe('Long Rest: Safe Room Execution', () => {
    it('restores full HP, spell slots, resources, and resets death saves', () => {
      const sheet = createMockSheet({
        totalLevel: 4,
        exhaustionLevel: 2,
        preparedSpells: ['magic_missile'],
        resources: {
          rage: { resourceId: 'rage', name: 'Rage', max: 3, spent: 3, available: 0, recovery: 'long_rest' },
          second_wind: { resourceId: 'second_wind', name: 'Second Wind', max: 1, spent: 1, available: 0, recovery: 'short_rest' },
        },
        spellSlots: {
          1: { max: 4, expended: 4, available: 0 },
          2: { max: 3, expended: 3, available: 0 },
          3: { max: 0, expended: 0, available: 0 },
          4: { max: 0, expended: 0, available: 0 },
          5: { max: 0, expended: 0, available: 0 },
          6: { max: 0, expended: 0, available: 0 },
          7: { max: 0, expended: 0, available: 0 },
          8: { max: 0, expended: 0, available: 0 },
          9: { max: 0, expended: 0, available: 0 },
        },
        hitDicePools: [{ dieSize: 10, total: 4, spent: 4, available: 0 }],
      });

      const hero = makeHero('hero-1', 'Paladin', 2, 2, {
        currentHp: 1,
        maxHp: 36,
        sheet,
      });
      hero.deathSaves = { successes: 2, failures: 1 };
      hero.reactionAvailable = false;
      hero.exhaustionLevel = 2;

      const floor = createTestFloor(true); // Safe Room
      const state = createDungeonGameState({ floor, party: [hero] });

      const res = resolveLongRest(state, {
        type: 'START_REST',
        restType: 'long',
        preparedSpellUpdates: { 'hero-1': ['shield', 'cure_wounds'] },
      });

      const updated = res.nextState.party['hero-1']!;
      expect(updated.currentHp).toBe(36);
      expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
      expect(updated.reactionAvailable).toBe(true);

      // Spell slots restored
      expect(updated.spellSlots?.[1]?.available).toBe(4);
      expect(updated.spellSlots?.[1]?.expended).toBe(0);

      // Resources restored
      expect(updated.characterSheet?.resources.rage.available).toBe(3);
      expect(updated.characterSheet?.resources.second_wind.available).toBe(1);

      // Exhaustion reduced by 1
      expect(updated.exhaustionLevel).toBe(1);
      expect(updated.characterSheet?.exhaustionLevel).toBe(1);

      // Hit dice recovered: max(1, floor(4/2)) = 2
      const pool = updated.characterSheet?.hitDicePools[0]!;
      expect(pool.spent).toBe(2);
      expect(pool.available).toBe(2);

      // Prepared spells updated
      expect(updated.characterSheet?.spellcasting?.preparedOrKnownSpellIds).toEqual([
        'shield',
        'cure_wounds',
      ]);
    });

    it('recovers hit dice according to SRD formula max(1, floor(totalLevel / 2))', () => {
      // Level 1 hero recovering 1 hit die
      const sheetL1 = createMockSheet({
        totalLevel: 1,
        hitDicePools: [{ dieSize: 10, total: 1, spent: 1, available: 0 }],
      });
      const heroL1 = makeHero('h1', 'L1', 2, 2, { sheet: sheetL1 });

      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [heroL1] });

      const res = resolveLongRest(state, {
        type: 'START_REST',
        restType: 'long',
      });

      expect(res.nextState.party.h1!.characterSheet?.hitDicePools[0]!.available).toBe(1);
    });
  });

  describe('Long Rest: Ambush Check in Unsecured Room', () => {
    it('succeeds long rest when ambush d20 roll is >= 5', () => {
      const hero = makeHero('hero-1', 'Hero', 2, 2, { currentHp: 5, maxHp: 20 });
      const floor = createTestFloor(false); // Unsecured Room!

      // Find an rng seed that yields d20 >= 5
      // 12345: rollDie(12345, 20) yields roll: 14
      const state = createDungeonGameState({ floor, party: [hero], rngState: 12345 });

      const res = resolveLongRest(state, {
        type: 'START_REST',
        restType: 'long',
      });

      expect(res.events[0]?.type).toBe('REST_COMPLETED');
      expect(res.nextState.party['hero-1']!.currentHp).toBe(20);
      expect(res.nextState.mode).toBe('exploration');
    });

    it('interrupts long rest and triggers combat encounter when ambush d20 roll is 1–4', () => {
      const hero = makeHero('hero-1', 'Hero', 2, 2, { currentHp: 5, maxHp: 20 });
      const floor = createTestFloor(false); // Unsecured Room

      // Test seed where roll <= 4
      let targetSeed = 0;
      for (let s = 1; s < 1000; s++) {
        const testState = createDungeonGameState({ floor, party: [hero], rngState: s });
        const res = resolveLongRest(testState, {
          type: 'START_REST',
          restType: 'long',
        });
        if (res.events[0]?.type === 'REST_INTERRUPTED') {
          targetSeed = s;
          break;
        }
      }

      expect(targetSeed).toBeGreaterThan(0);

      const ambushState = createDungeonGameState({ floor, party: [hero], rngState: targetSeed });
      const res = resolveLongRest(ambushState, {
        type: 'START_REST',
        restType: 'long',
      });

      // Rest was interrupted by ambush
      expect(res.events[0]).toMatchObject({
        type: 'REST_INTERRUPTED',
        restType: 'long',
        reason: 'ambush',
      });
      // HP was NOT recovered
      expect(res.nextState.party['hero-1']!.currentHp).toBe(5);
      // Mode transitioned to combat
      expect(res.nextState.mode).toBe('combat');
      expect(res.nextState.combat).not.toBeNull();
    });
  });

  describe('Integration with reduceGame', () => {
    it('dispatches START_REST command through reduceGame', () => {
      const sheet = createMockSheet({
        totalLevel: 2,
        hitDicePools: [{ dieSize: 10, total: 2, spent: 0, available: 2 }],
      });
      const hero = makeHero('hero-1', 'Hero', 2, 2, { currentHp: 5, maxHp: 20, sheet });
      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero] });

      const res = reduceGame(state, {
        type: 'START_REST',
        restType: 'short',
        hitDiceToSpend: { 'hero-1': 1 },
      });

      expect(res.events[0]?.type).toBe('REST_COMPLETED');
      expect(res.nextState.party['hero-1']!.currentHp).toBeGreaterThan(5);
    });

    it('dispatches UPDATE_PREPARED_SPELLS command through reduceGame', () => {
      const sheet = createMockSheet({
        preparedSpells: ['magic_missile'],
      });
      const hero = makeHero('hero-1', 'Hero', 2, 2, { sheet });
      const floor = createTestFloor(true);
      const state = createDungeonGameState({ floor, party: [hero] });

      const res = reduceGame(state, {
        type: 'UPDATE_PREPARED_SPELLS',
        characterId: 'hero-1',
        preparedSpellIds: ['fireball', 'shield'],
      });

      expect(res.events[0]).toEqual({
        type: 'PREPARED_SPELLS_UPDATED',
        characterId: 'hero-1',
        preparedSpellIds: ['fireball', 'shield'],
      });
      expect(
        res.nextState.party['hero-1']!.characterSheet?.spellcasting?.preparedOrKnownSpellIds,
      ).toEqual(['fireball', 'shield']);
    });
  });
});
