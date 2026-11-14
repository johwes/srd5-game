import { ABILITY_IDS, SKILL_DEFAULT_ABILITY, SKILL_IDS } from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  CharacterBuildStateSchema,
  type DerivedCharacterSheet,
  DerivedCharacterSheetSchema,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultExpendedSpellSlots,
  createDefaultSpellcastingSelection,
  createUniformAbilities,
} from '../index.js';

function createSampleFighterBuildState(): CharacterBuildState {
  return {
    id: 'char-fighter-1',
    version: 1,
    name: 'Tordek Battlehammer',
    playerId: 'player-1',
    portraitId: 'portrait-dwarf-fighter',
    tokenSpriteId: 'token-dwarf-fighter',
    alignment: 'lawful_good',
    raceId: 'dwarf',
    subraceId: 'hill-dwarf',
    racialChoices: {
      'dwarf-tool-proficiency': ['smiths-tools'],
    },
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['elvish', 'giant'],
    },
    abilityMethod: 'standard_array',
    baseAbilities: {
      str: 15,
      dex: 12,
      con: 14,
      int: 8,
      wis: 13,
      cha: 10,
    },
    classes: [
      {
        classId: 'fighter',
        subclassId: 'champion',
        level: 4,
        hpRollsByLevel: [10, 6, 6, 6],
        choiceSelectionsByLevel: {
          1: {
            'fighter-skills': ['athletics', 'perception'],
            'fighter-fighting-style': ['defense'],
          },
        },
        asiOrFeatByLevel: {
          4: {
            type: 'asi',
            bonuses: { str: 2 },
          },
        },
      },
    ],
    currency: createDefaultCurrency({ gp: 15 }),
    inventory: [
      { instanceId: 'inv-chain-mail', itemId: 'chain-mail', quantity: 1 },
      { instanceId: 'inv-shield', itemId: 'shield', quantity: 1 },
      {
        instanceId: 'inv-battleaxe-plus-1',
        itemId: 'weapon-plus-1',
        quantity: 1,
        isMagicItem: true,
        customName: '+1 Battleaxe',
      },
      { instanceId: 'inv-handaxe', itemId: 'handaxe', quantity: 2 },
    ],
    equippedSlots: {
      armorInstanceId: 'inv-chain-mail',
      shieldInstanceId: 'inv-shield',
      mainHandInstanceId: 'inv-battleaxe-plus-1',
      rangedInstanceId: 'inv-handaxe',
    },
    attunedItemInstanceIds: [],
    spellcasting: createDefaultSpellcastingSelection(),
    runtime: createDefaultCharacterRuntimeState({
      xp: 2700,
      currentHp: 44,
      hitDiceSpent: { 10: 1 },
      resourceChargesSpent: { 'second-wind': 0, 'action-surge': 1 },
    }),
  };
}

function createSampleDerivedSheet(): DerivedCharacterSheet {
  const abilities = Object.fromEntries(
    ABILITY_IDS.map((ability) => [
      ability,
      {
        ability,
        base: 14,
        racialBonus: ability === 'con' ? 2 : 0,
        asiBonus: ability === 'str' ? 2 : 0,
        featBonus: 0,
        maxCap: 20,
        score: ability === 'str' || ability === 'con' ? 16 : 14,
        modifier: ability === 'str' || ability === 'con' ? 3 : 2,
        breakdown: [{ sourceId: 'base', sourceName: 'Base Score', value: 14 }],
      },
    ]),
  ) as DerivedCharacterSheet['abilities'];

  const savingThrows = Object.fromEntries(
    ABILITY_IDS.map((ability) => {
      const proficient = ability === 'str' || ability === 'con';
      const mod = abilities[ability].modifier;
      const prof = proficient ? 2 : 0;
      return [
        ability,
        {
          ability,
          proficient,
          abilityModifier: mod,
          proficiencyBonus: prof,
          flatBonus: 0,
          totalBonus: mod + prof,
          rollMode: 'normal' as const,
          breakdown: [
            { sourceId: 'ability', sourceName: ability.toUpperCase(), value: mod },
          ],
        },
      ];
    }),
  ) as DerivedCharacterSheet['savingThrows'];

  const skills = Object.fromEntries(
    SKILL_IDS.map((skill) => {
      const ability = SKILL_DEFAULT_ABILITY[skill];
      const mod = abilities[ability].modifier;
      const proficient = skill === 'athletics' || skill === 'perception';
      const prof = proficient ? 2 : 0;
      const total = mod + prof;
      return [
        skill,
        {
          skill,
          ability,
          proficiencyLevel: proficient ? ('proficient' as const) : ('none' as const),
          abilityModifier: mod,
          proficiencyBonus: prof,
          flatBonus: 0,
          totalBonus: total,
          passiveScore: 10 + total,
          rollMode: 'normal' as const,
          breakdown: [{ sourceId: 'ability', sourceName: ability.toUpperCase(), value: mod }],
        },
      ];
    }),
  ) as DerivedCharacterSheet['skills'];

  const emptyPool = { max: 0, expended: 0, available: 0 };

  return {
    id: 'char-fighter-1',
    name: 'Tordek Battlehammer',
    playerId: 'player-1',
    portraitId: 'portrait-dwarf-fighter',
    tokenSpriteId: 'token-dwarf-fighter',
    raceId: 'dwarf',
    raceName: 'Dwarf',
    subraceId: 'hill-dwarf',
    subraceName: 'Hill Dwarf',
    backgroundId: 'acolyte',
    backgroundName: 'Acolyte',
    alignment: 'lawful_good',
    size: 'medium',
    classes: [
      {
        classId: 'fighter',
        className: 'Fighter',
        subclassId: 'champion',
        subclassName: 'Champion',
        level: 4,
        hitDie: 10,
      },
    ],
    totalLevel: 4,
    xp: 2700,
    proficiencyBonus: 2,
    abilities,
    activeModifiers: [
      {
        sourceId: 'fighting-style-defense',
        sourceName: 'Fighting Style: Defense',
        sourceCategory: 'class_feature',
        modifier: {
          type: 'flat_bonus',
          target: 'ac',
          value: 1,
          condition: 'wearing_armor',
        },
      },
    ],
    proficiencies: {
      armor: ['light-armor', 'medium-armor', 'heavy-armor', 'shields'],
      weapons: ['simple-weapons', 'martial-weapons'],
      tools: ['smiths-tools'],
      savingThrows: ['str', 'con'],
      skills: ['athletics', 'insight', 'perception', 'religion'],
      expertise: [],
      languages: ['common', 'dwarvish', 'elvish', 'giant'],
    },
    damageResistances: ['poison'],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    traitIds: ['dwarven-resilience', 'dwarven-toughness'],
    featureIds: ['fighting-style', 'second-wind', 'action-surge', 'improved-critical'],
    featIds: [],
    savingThrows,
    skills,
    passivePerception: 14,
    passiveInvestigation: 12,
    passiveInsight: 12,
    maxHp: 44,
    currentHp: 44,
    tempHp: 0,
    hpBreakdown: [
      { sourceId: 'fighter-hd', sourceName: 'Fighter Hit Dice (4d10)', value: 28 },
      { sourceId: 'con-mod', sourceName: 'Constitution Modifier (+3 x 4)', value: 12 },
      { sourceId: 'dwarven-toughness', sourceName: 'Dwarven Toughness (+1 x 4)', value: 4 },
    ],
    hitDicePools: [{ dieSize: 10, total: 4, spent: 1, available: 3 }],
    deathSaves: { successes: 0, failures: 0 },
    exhaustionLevel: 0,
    armorClass: {
      totalAc: 19,
      selectedFormulaId: 'armor:chain-mail',
      selectedFormulaName: 'Chain Mail',
      baseAc: 16,
      shieldBonus: 2,
      additiveBonuses: [
        { sourceId: 'fighting-style-defense', sourceName: 'Fighting Style: Defense', value: 1 },
      ],
      stealthDisadvantage: true,
      candidateFormulas: [
        {
          id: 'unarmored',
          name: 'Unarmored',
          formula: '10 + @dexMod',
          baseAc: 12,
          allowsShield: true,
          valid: false,
          invalidReason: 'Wearing armor',
        },
        {
          id: 'armor:chain-mail',
          name: 'Chain Mail',
          formula: '16',
          baseAc: 16,
          allowsShield: true,
          valid: true,
        },
      ],
      formulaTooltip: 'Chain Mail (16) + Shield (+2) + Defense (+1) = 19',
    },
    speedFeet: 25,
    senses: {
      darkvisionFeet: 60,
    },
    initiative: {
      bonus: 2,
      rollMode: 'normal',
      breakdown: [{ sourceId: 'dex', sourceName: 'Dexterity Modifier', value: 2 }],
    },
    weaponAttacks: [
      {
        id: 'inv-battleaxe-plus-1',
        weaponId: 'battleaxe',
        name: '+1 Battleaxe',
        slot: 'main_hand',
        rangeType: 'melee',
        abilityUsed: 'str',
        proficient: true,
        toHitBonus: 6,
        toHitBreakdown: [
          { sourceId: 'str', sourceName: 'Strength', value: 3 },
          { sourceId: 'prof', sourceName: 'Proficiency', value: 2 },
          { sourceId: 'magic', sourceName: '+1 Magic Bonus', value: 1 },
        ],
        damageDice: '1d8',
        versatileDamageDice: '1d10',
        damageBonus: 4,
        damageBreakdown: [
          { sourceId: 'str', sourceName: 'Strength', value: 3 },
          { sourceId: 'magic', sourceName: '+1 Magic Bonus', value: 1 },
        ],
        damageFormula: '1d8+4',
        versatileDamageFormula: '1d10+4',
        damageType: 'slashing',
        properties: ['versatile'],
        reachFeet: 5,
        critRange: 19,
        isMagical: true,
        actionCost: 'action',
      },
    ],
    spellcasting: {
      isSpellcaster: false,
      effectiveCasterLevel: 0,
      classes: [],
      spellSlots: {
        1: emptyPool,
        2: emptyPool,
        3: emptyPool,
        4: emptyPool,
        5: emptyPool,
        6: emptyPool,
        7: emptyPool,
        8: emptyPool,
        9: emptyPool,
      },
      cantripIds: [],
      preparedOrKnownSpellIds: [],
      alwaysPreparedSpellIds: [],
      spellbookSpellIds: [],
    },
    attacksPerAction: 1,
    resources: {
      'second-wind': {
        resourceId: 'second-wind',
        name: 'Second Wind',
        max: 1,
        spent: 0,
        available: 1,
        recovery: 'short_rest',
        sourceId: 'second-wind',
      },
      'action-surge': {
        resourceId: 'action-surge',
        name: 'Action Surge',
        max: 1,
        spent: 1,
        available: 0,
        recovery: 'short_rest',
        sourceId: 'action-surge',
      },
    },
    activatedAbilities: [
      {
        id: 'second-wind',
        name: 'Second Wind',
        description: 'Regain 1d10 + fighter level HP as a bonus action.',
        actionCost: 'bonus_action',
        resourceCost: { resourceId: 'second-wind', amount: 1 },
        effects: [{ step: 'heal', diceFormula: '1d10 + @classLevel' }],
      },
    ],
    activeConditions: [],
    activeEffects: [],
  };
}

describe('SRD-201: CharacterBuildState & DerivedCharacterSheet Schemas', () => {
  describe('CharacterBuildStateSchema', () => {
    it('validates a complete single-class CharacterBuildState and round-trips through JSON', () => {
      const state = createSampleFighterBuildState();
      const parsed = CharacterBuildStateSchema.parse(state);
      expect(parsed.id).toBe('char-fighter-1');
      expect(parsed.classes[0]?.level).toBe(4);

      const roundTripped = CharacterBuildStateSchema.parse(JSON.parse(JSON.stringify(parsed)));
      expect(roundTripped).toEqual(parsed);
    });

    it('validates multiclass builds with split +1/+1 ASI and feat selections', () => {
      const state = createSampleFighterBuildState();
      state.classes = [
        {
          classId: 'fighter',
          level: 2,
          hpRollsByLevel: [10, 6],
          choiceSelectionsByLevel: {
            1: { 'fighter-fighting-style': ['defense'] },
          },
          asiOrFeatByLevel: {},
        },
        {
          classId: 'wizard',
          subclassId: 'evocation',
          level: 8,
          hpRollsByLevel: [6, 4, 4, 4, 4, 4, 4, 4],
          choiceSelectionsByLevel: {},
          asiOrFeatByLevel: {
            4: {
              type: 'asi',
              bonuses: { int: 1, con: 1 },
            },
            8: {
              type: 'feat',
              featId: 'grappler',
            },
          },
        },
      ];
      state.spellcasting = createDefaultSpellcastingSelection({
        knownCantripIds: ['fire-bolt', 'mage-hand', 'prestidigitation', 'light'],
        spellbookSpellIds: ['shield', 'mage-armor', 'magic-missile', 'fireball'],
        preparedSpellIds: ['shield', 'mage-armor', 'fireball'],
      });
      state.runtime.concentratingOn = {
        sourceId: 'haste',
        targetEntityIds: ['char-fighter-1'],
        remainingRounds: 8,
      };

      const parsed = CharacterBuildStateSchema.parse(state);
      expect(parsed.classes).toHaveLength(2);
      expect(parsed.runtime.concentratingOn?.sourceId).toBe('haste');
    });

    it('rejects total character level exceeding 20', () => {
      const state = createSampleFighterBuildState();
      state.classes = [
        {
          classId: 'fighter',
          level: 12,
          hpRollsByLevel: Array.from({ length: 12 }, () => 6),
          choiceSelectionsByLevel: {},
          asiOrFeatByLevel: {},
        },
        {
          classId: 'cleric',
          subclassId: 'life',
          level: 9,
          hpRollsByLevel: Array.from({ length: 9 }, () => 5),
          choiceSelectionsByLevel: {},
          asiOrFeatByLevel: {},
        },
      ];

      const result = CharacterBuildStateSchema.safeParse(state);
      expect(result.success).toBe(false);
    });

    it('rejects ASI bonuses that do not sum to exactly +2', () => {
      const state = createSampleFighterBuildState();
      state.classes[0]!.asiOrFeatByLevel = {
        4: {
          type: 'asi',
          bonuses: { str: 1 },
        },
      };
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);

      state.classes[0]!.asiOrFeatByLevel = {
        4: {
          type: 'asi',
          bonuses: { str: 2, con: 1 },
        },
      };
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);
    });

    it('rejects mismatched hpRollsByLevel length or level keys exceeding class level', () => {
      const state = createSampleFighterBuildState();
      state.classes[0]!.hpRollsByLevel = [10, 6]; // level is 4
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);

      const state2 = createSampleFighterBuildState();
      state2.classes[0]!.asiOrFeatByLevel = {
        8: { type: 'asi', bonuses: { str: 2 } }, // level is 4
      };
      expect(CharacterBuildStateSchema.safeParse(state2).success).toBe(false);
    });

    it('enforces max 3 attuned items and unique inventory/attunement IDs', () => {
      const state = createSampleFighterBuildState();
      state.attunedItemInstanceIds = ['a', 'b', 'c', 'd'];
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);

      state.attunedItemInstanceIds = ['a', 'a'];
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);

      const dupInv = createSampleFighterBuildState();
      dupInv.inventory.push({
        instanceId: 'inv-shield',
        itemId: 'shield',
        quantity: 1,
      });
      expect(CharacterBuildStateSchema.safeParse(dupInv).success).toBe(false);
    });

    it('rejects invalid hit die sizes in runtime.hitDiceSpent', () => {
      const state = createSampleFighterBuildState();
      (state.runtime.hitDiceSpent as Record<number, number>)[7] = 1;
      expect(CharacterBuildStateSchema.safeParse(state).success).toBe(false);
    });
  });

  describe('DerivedCharacterSheetSchema', () => {
    it('validates a complete 10-stage DerivedCharacterSheet and round-trips through JSON', () => {
      const sheet = createSampleDerivedSheet();
      const parsed = DerivedCharacterSheetSchema.parse(sheet);
      expect(parsed.totalLevel).toBe(4);
      expect(parsed.armorClass.totalAc).toBe(19);
      expect(parsed.weaponAttacks[0]?.toHitBonus).toBe(6);

      const roundTripped = DerivedCharacterSheetSchema.parse(JSON.parse(JSON.stringify(parsed)));
      expect(roundTripped).toEqual(parsed);
    });

    it('validates spellcaster DerivedCharacterSheet with Pact Magic and class spellcasting', () => {
      const sheet = createSampleDerivedSheet();
      sheet.spellcasting = {
        isSpellcaster: true,
        effectiveCasterLevel: 3,
        classes: [
          {
            classId: 'warlock',
            ability: 'cha',
            abilityModifier: 3,
            spellSaveDc: 13,
            spellAttackBonus: 5,
            preparationMode: 'known',
            cantripsKnownCount: 2,
            spellsKnownCount: 4,
            ritualCasting: false,
            alwaysPreparedSpellIds: [],
          },
        ],
        primaryAbility: 'cha',
        primarySpellSaveDc: 13,
        primarySpellAttackBonus: 5,
        spellSlots: sheet.spellcasting.spellSlots,
        pactMagic: {
          slotLevel: 2,
          maxSlots: 2,
          expendedSlots: 1,
          availableSlots: 1,
        },
        cantripIds: ['eldritch-blast', 'mage-hand'],
        preparedOrKnownSpellIds: ['hex', 'hellish-rebuke', 'scorching-ray', 'misty-step'],
        alwaysPreparedSpellIds: [],
        spellbookSpellIds: [],
      };

      const parsed = DerivedCharacterSheetSchema.parse(sheet);
      expect(parsed.spellcasting.isSpellcaster).toBe(true);
      expect(parsed.spellcasting.pactMagic?.slotLevel).toBe(2);
    });
  });

  describe('Deterministic Default Helpers', () => {
    it('creates uniform ability maps and zeroed spell slots', () => {
      const abilities = createUniformAbilities(8);
      expect(abilities).toEqual({
        str: 8,
        dex: 8,
        con: 8,
        int: 8,
        wis: 8,
        cha: 8,
      });

      const slots = createDefaultExpendedSpellSlots();
      expect(Object.keys(slots)).toHaveLength(9);
      expect(Object.values(slots).every((v) => v === 0)).toBe(true);
    });
  });
});
