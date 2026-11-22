import { createCompendium } from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  DerivedCharacterSheetSchema,
  computeDerivedCharacter,
  computeProficiencyBonus,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultSpellcastingSelection,
} from '../index.js';

const compendium = createCompendium();

function createBaseCharacterState(
  overrides?: Partial<CharacterBuildState>,
): CharacterBuildState {
  return {
    id: 'char-test-1',
    version: 1,
    name: 'Test Hero',
    portraitId: 'portrait-default',
    tokenSpriteId: 'token-default',
    alignment: 'neutral_good',
    raceId: 'human',
    racialChoices: {
      'human-extra-language': ['elvish'],
    },
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['dwarvish', 'celestial'],
    },
    abilityMethod: 'standard_array',
    baseAbilities: {
      str: 15,
      dex: 14,
      con: 13,
      int: 12,
      wis: 10,
      cha: 8,
    },
    classes: [
      {
        classId: 'fighter',
        level: 1,
        hpRollsByLevel: [10],
        choiceSelectionsByLevel: {
          1: {
            'fighter-skills': ['athletics', 'perception'],
          },
        },
        asiOrFeatByLevel: {},
      },
    ],
    currency: createDefaultCurrency({ gp: 10 }),
    inventory: [],
    equippedSlots: {},
    attunedItemInstanceIds: [],
    spellcasting: createDefaultSpellcastingSelection(),
    runtime: createDefaultCharacterRuntimeState({
      currentHp: 12,
    }),
    ...overrides,
  };
}

describe('SRD-204: 10-Stage computeDerivedCharacter() Pipeline', () => {
  describe('Stage 1 & 2: Total Level, Proficiency Bonus & Ability Scores', () => {
    it('computes proficiency bonus across levels 1 to 20', () => {
      expect(computeProficiencyBonus(1)).toBe(2);
      expect(computeProficiencyBonus(4)).toBe(2);
      expect(computeProficiencyBonus(5)).toBe(3);
      expect(computeProficiencyBonus(8)).toBe(3);
      expect(computeProficiencyBonus(9)).toBe(4);
      expect(computeProficiencyBonus(12)).toBe(4);
      expect(computeProficiencyBonus(13)).toBe(5);
      expect(computeProficiencyBonus(16)).toBe(5);
      expect(computeProficiencyBonus(17)).toBe(6);
      expect(computeProficiencyBonus(20)).toBe(6);
    });

    it('aggregates base abilities, racial/subracial bonuses, racial choice bonuses, and ASIs with a cap of 20', () => {
      const state = createBaseCharacterState({
        raceId: 'half-elf',
        racialChoices: {
          'half-elf-ability-bonuses': ['dex', 'con'],
          'half-elf-skill-versatility': ['stealth', 'acrobatics'],
          'half-elf-extra-language': ['sylvan'],
        },
        baseAbilities: {
          str: 10,
          dex: 15,
          con: 13,
          int: 12,
          wis: 8,
          cha: 15,
        },
        classes: [
          {
            classId: 'bard',
            subclassId: 'lore',
            level: 8,
            hpRollsByLevel: [8, 5, 5, 5, 5, 5, 5, 5],
            choiceSelectionsByLevel: {
              1: { 'bard-skills': ['persuasion', 'performance', 'deception'] },
            },
            asiOrFeatByLevel: {
              4: { type: 'asi', bonuses: { cha: 2 } },
              8: { type: 'asi', bonuses: { cha: 2 } }, // 15 + 2 (race) + 4 (ASI) = 21 -> capped at 20
            },
          },
        ],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      expect(sheet.totalLevel).toBe(8);
      expect(sheet.proficiencyBonus).toBe(3);
      expect(sheet.abilities.cha.base).toBe(15);
      expect(sheet.abilities.cha.racialBonus).toBe(2);
      expect(sheet.abilities.cha.asiBonus).toBe(4);
      expect(sheet.abilities.cha.maxCap).toBe(20);
      expect(sheet.abilities.cha.score).toBe(20);
      expect(sheet.abilities.cha.modifier).toBe(5);

      expect(sheet.abilities.dex.score).toBe(16); // 15 + 1 choice
      expect(sheet.abilities.dex.modifier).toBe(3);
      expect(sheet.abilities.con.score).toBe(14); // 13 + 1 choice
      expect(sheet.abilities.con.modifier).toBe(2);
    });

    it('applies Level 20 Barbarian Primal Champion (+4 STR, +4 CON, cap 24)', () => {
      const state = createBaseCharacterState({
        raceId: 'half-orc',
        racialChoices: {},
        baseAbilities: {
          str: 15,
          dex: 14,
          con: 14,
          int: 8,
          wis: 12,
          cha: 10,
        },
        classes: [
          {
            classId: 'barbarian',
            subclassId: 'berserker',
            level: 20,
            hpRollsByLevel: [12, ...Array.from({ length: 19 }, () => 7)],
            choiceSelectionsByLevel: {
              1: { 'barbarian-skills': ['athletics', 'survival'] },
            },
            asiOrFeatByLevel: {
              4: { type: 'asi', bonuses: { str: 2 } },
              8: { type: 'asi', bonuses: { str: 1, con: 1 } },
              12: { type: 'asi', bonuses: { con: 2 } },
              16: { type: 'asi', bonuses: { con: 2 } },
              19: { type: 'asi', bonuses: { dex: 2 } },
            },
          },
        ],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      // STR: 15 + 2 (Half-Orc) + 3 (ASI) + 4 (Primal Champion) = 24 (cap 24)
      expect(sheet.abilities.str.maxCap).toBe(24);
      expect(sheet.abilities.str.score).toBe(24);
      expect(sheet.abilities.str.modifier).toBe(7);

      // CON: 14 + 1 (Half-Orc) + 5 (ASI) + 4 (Primal Champion) = 24 (cap 24)
      expect(sheet.abilities.con.maxCap).toBe(24);
      expect(sheet.abilities.con.score).toBe(24);
      expect(sheet.abilities.con.modifier).toBe(7);
    });

    it('applies set_ability_minimum magic items (Gauntlets of Ogre Power, Amulet of Health, Belt of Hill Giant Strength) when attuned', () => {
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 10,
          dex: 14,
          con: 12,
          int: 13,
          wis: 15,
          cha: 8,
        },
        inventory: [
          {
            instanceId: 'inv-gauntlets',
            itemId: 'gauntlets-of-ogre-power',
            quantity: 1,
            isMagicItem: true,
          },
          {
            instanceId: 'inv-amulet',
            itemId: 'amulet-of-health',
            quantity: 1,
            isMagicItem: true,
          },
          {
            instanceId: 'inv-belt',
            itemId: 'belt-of-hill-giant-strength',
            quantity: 1,
            isMagicItem: true,
          },
        ],
        // Only attune gauntlets and amulet first
        attunedItemInstanceIds: ['inv-gauntlets', 'inv-amulet'],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      expect(sheet.abilities.str.itemMinimum).toBe(19);
      expect(sheet.abilities.str.score).toBe(19);
      expect(sheet.abilities.str.modifier).toBe(4);
      expect(sheet.abilities.con.itemMinimum).toBe(19);
      expect(sheet.abilities.con.score).toBe(19);
      expect(sheet.abilities.con.modifier).toBe(4);

      // Attune the Belt of Hill Giant Strength as well -> STR minimum becomes 21 (even above normal 20 cap)
      state.attunedItemInstanceIds = ['inv-gauntlets', 'inv-amulet', 'inv-belt'];
      const sheetWithBelt = computeDerivedCharacter(state, compendium);
      expect(sheetWithBelt.abilities.str.itemMinimum).toBe(21);
      expect(sheetWithBelt.abilities.str.score).toBe(21);
      expect(sheetWithBelt.abilities.str.modifier).toBe(5);
    });
  });

  describe('Stage 3 & 4: Saving Throws, Skills, Expertise, Jack of All Trades & Passive Scores', () => {
    it('computes Paladin Aura of Protection and Cloak/Ring of Protection saving throw bonuses', () => {
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 15,
          dex: 10,
          con: 13,
          int: 8,
          wis: 12,
          cha: 15, // +1 human = 16 (+3 mod)
        },
        classes: [
          {
            classId: 'paladin',
            subclassId: 'devotion',
            level: 6,
            hpRollsByLevel: [10, 6, 6, 6, 6, 6],
            choiceSelectionsByLevel: {
              1: { 'paladin-skills': ['athletics', 'persuasion'] },
              2: { 'paladin-fighting-style': ['defense'] },
            },
            asiOrFeatByLevel: {
              4: { type: 'asi', bonuses: { cha: 2 } }, // CHA 18 (+4 mod)
            },
          },
        ],
        inventory: [
          {
            instanceId: 'inv-cloak',
            itemId: 'cloak-of-protection',
            quantity: 1,
            isMagicItem: true,
          },
        ],
        attunedItemInstanceIds: ['inv-cloak'],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      // Paladin is proficient in WIS and CHA saves (proficiencyBonus = +3 at L6)
      // Aura of Protection adds +4 (CHA mod), Cloak of Protection adds +1 -> +5 flatBonus on all saves
      expect(sheet.savingThrows.wis.proficient).toBe(true);
      expect(sheet.savingThrows.wis.abilityModifier).toBe(1); // WIS 13
      expect(sheet.savingThrows.wis.proficiencyBonus).toBe(3);
      expect(sheet.savingThrows.wis.flatBonus).toBe(5); // +4 Aura + 1 Cloak
      expect(sheet.savingThrows.wis.totalBonus).toBe(9);

      expect(sheet.savingThrows.dex.proficient).toBe(false);
      expect(sheet.savingThrows.dex.abilityModifier).toBe(0); // DEX 11
      expect(sheet.savingThrows.dex.flatBonus).toBe(5);
      expect(sheet.savingThrows.dex.totalBonus).toBe(5);
    });

    it('computes Expertise (2x prof), Jack of All Trades (floor(prof/2)), and Passive Perception with Advantage/Disadvantage', () => {
      const state = createBaseCharacterState({
        raceId: 'elf',
        subraceId: 'high-elf',
        racialChoices: {
          'high-elf-cantrip': ['mage-hand'],
          'high-elf-extra-language': ['draconic'],
        },
        baseAbilities: {
          str: 8,
          dex: 15, // +2 elf = 17 (+3)
          con: 12,
          int: 13, // +1 high-elf = 14 (+2)
          wis: 14, // +2
          cha: 10,
        },
        classes: [
          {
            classId: 'rogue',
            level: 1,
            hpRollsByLevel: [8],
            choiceSelectionsByLevel: {
              1: {
                'rogue-skills': ['stealth', 'investigation', 'acrobatics', 'sleight-of-hand'],
                'expertise-rogue': ['stealth', 'perception'], // Keen Senses grants perception
              },
            },
            asiOrFeatByLevel: {},
          },
          {
            classId: 'bard',
            level: 4, // Total level 5 -> prof +3; Bard L2 grants Jack of All Trades (+1)
            hpRollsByLevel: [5, 5, 5, 5],
            choiceSelectionsByLevel: {},
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [
          {
            instanceId: 'inv-boots',
            itemId: 'boots-of-elvenkind',
            quantity: 1,
            isMagicItem: true,
          },
        ],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      expect(sheet.totalLevel).toBe(5);
      expect(sheet.proficiencyBonus).toBe(3);

      // Stealth: Expertise (2 * 3 = 6) + DEX (+3) = +9, Advantage from Boots of Elvenkind -> Passive 24
      expect(sheet.skills.stealth.proficiencyLevel).toBe('expertise');
      expect(sheet.skills.stealth.totalBonus).toBe(9);
      expect(sheet.skills.stealth.rollMode).toBe('advantage');
      expect(sheet.skills.stealth.passiveScore).toBe(24);

      // Perception: Expertise (2 * 3 = 6) + WIS (+2) = +8 -> Passive Perception 18
      expect(sheet.skills.perception.proficiencyLevel).toBe('expertise');
      expect(sheet.skills.perception.totalBonus).toBe(8);
      expect(sheet.passivePerception).toBe(18);

      // Athletics: Not proficient, Jack of All Trades ('half', floor(3/2) = 1) + STR (-1) = 0
      expect(sheet.skills.athletics.proficiencyLevel).toBe('half');
      expect(sheet.skills.athletics.proficiencyBonus).toBe(1);
      expect(sheet.skills.athletics.totalBonus).toBe(0);
    });
  });

  describe('Stage 5: Maximum Hit Points & Hit Dice Pool', () => {
    it('computes max HP with Hill Dwarf Dwarven Toughness and Sorcerer Draconic Resilience', () => {
      const state = createBaseCharacterState({
        raceId: 'dwarf',
        subraceId: 'hill-dwarf',
        racialChoices: {
          'dwarf-tool-proficiency': ['smiths-tools'],
        },
        baseAbilities: {
          str: 10,
          dex: 14,
          con: 14, // +2 dwarf = 16 (+3 mod)
          int: 10,
          wis: 12,
          cha: 15,
        },
        classes: [
          {
            classId: 'fighter',
            level: 2,
            hpRollsByLevel: [10, 6],
            choiceSelectionsByLevel: {
              1: { 'fighter-skills': ['athletics', 'perception'] },
            },
            asiOrFeatByLevel: {},
          },
          {
            classId: 'sorcerer',
            subclassId: 'draconic',
            level: 3,
            hpRollsByLevel: [4, 4, 4],
            choiceSelectionsByLevel: {},
            asiOrFeatByLevel: {},
          },
        ],
        runtime: createDefaultCharacterRuntimeState({
          currentHp: 999, // Should clamp to maxHp
          hitDiceSpent: { 10: 1, 6: 2 },
        }),
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      // Total level = 5
      // Rolls: Fighter (10 + 6 = 16) + Sorcerer (4 + 4 + 4 = 12) = 28
      // CON (+3 * 5 levels) = 15
      // Dwarven Toughness (+1 * 5 total levels) = 5
      // Draconic Resilience (+1 * 3 sorcerer levels) = 3
      // Total Max HP = 28 + 15 + 5 + 3 = 51
      expect(sheet.maxHp).toBe(51);
      expect(sheet.currentHp).toBe(51);
      expect(sheet.hitDicePools).toEqual([
        { dieSize: 10, total: 2, spent: 1, available: 1 },
        { dieSize: 6, total: 3, spent: 2, available: 1 },
      ]);
    });
  });

  describe('Stage 6: Competing AC Calculation Formulas (Epic 2 Acceptance Criteria)', () => {
    it('evaluates Barbarian Unarmored Defense (10 + DEX + CON) with Shield and invalidates it when wearing armor', () => {
      // DEX 14 (+2), CON 16 (+3) -> Unarmored Barbarian = 15 (+2 Shield = 17)
      const state = createBaseCharacterState({
        raceId: 'dwarf',
        subraceId: 'hill-dwarf',
        racialChoices: { 'dwarf-tool-proficiency': ['smiths-tools'] },
        baseAbilities: {
          str: 15,
          dex: 14,
          con: 14, // +2 dwarf = 16 (+3)
          int: 8,
          wis: 12,
          cha: 10,
        },
        classes: [
          {
            classId: 'barbarian',
            level: 1,
            hpRollsByLevel: [12],
            choiceSelectionsByLevel: {
              1: { 'barbarian-skills': ['athletics', 'survival'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [
          { instanceId: 'inv-shield', itemId: 'shield', quantity: 1 },
          { instanceId: 'inv-leather', itemId: 'leather-armor', quantity: 1 },
        ],
        equippedSlots: {
          shieldInstanceId: 'inv-shield',
        },
      });

      const unarmoredSheet = computeDerivedCharacter(state, compendium);
      expect(unarmoredSheet.armorClass.selectedFormulaId).toBe('unarmored_barbarian');
      expect(unarmoredSheet.armorClass.baseAc).toBe(15);
      expect(unarmoredSheet.armorClass.shieldBonus).toBe(2);
      expect(unarmoredSheet.armorClass.totalAc).toBe(17);

      // Now equip Leather Armor (11 + DEX 2 = 13 + Shield 2 = 15): Unarmored Defense is invalidated by wearing armor!
      state.equippedSlots.armorInstanceId = 'inv-leather';
      const armoredSheet = computeDerivedCharacter(state, compendium);
      expect(armoredSheet.armorClass.selectedFormulaId).toBe('armor:leather-armor');
      expect(armoredSheet.armorClass.baseAc).toBe(13);
      expect(armoredSheet.armorClass.shieldBonus).toBe(2);
      expect(armoredSheet.armorClass.totalAc).toBe(15);

      const barbCandidate = armoredSheet.armorClass.candidateFormulas.find(
        (c) => c.id === 'unarmored_barbarian',
      );
      expect(barbCandidate?.valid).toBe(false);
      expect(barbCandidate?.invalidReason).toBe('Wearing armor');
    });

    it('evaluates Monk Unarmored Defense (10 + DEX + WIS) and invalidates it when wielding a shield', () => {
      // DEX 16 (+3), WIS 16 (+3) -> Monk Unarmored Defense = 16
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 10,
          dex: 15, // +1 human = 16 (+3)
          con: 12,
          int: 10,
          wis: 15, // +1 human = 16 (+3)
          cha: 8,
        },
        classes: [
          {
            classId: 'monk',
            level: 1,
            hpRollsByLevel: [8],
            choiceSelectionsByLevel: {
              1: { 'monk-skills': ['acrobatics', 'stealth'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [{ instanceId: 'inv-shield', itemId: 'shield', quantity: 1 }],
        equippedSlots: {},
      });

      const monkSheet = computeDerivedCharacter(state, compendium);
      expect(monkSheet.armorClass.selectedFormulaId).toBe('unarmored_monk');
      expect(monkSheet.armorClass.baseAc).toBe(16);
      expect(monkSheet.armorClass.shieldBonus).toBe(0);
      expect(monkSheet.armorClass.totalAc).toBe(16);

      // Equipping a shield invalidates Monk Unarmored Defense; falls back to Unarmored (10 + 3 = 13) + Shield (+2) = 15
      state.equippedSlots.shieldInstanceId = 'inv-shield';
      const shieldedMonkSheet = computeDerivedCharacter(state, compendium);
      expect(shieldedMonkSheet.armorClass.selectedFormulaId).toBe('unarmored');
      expect(shieldedMonkSheet.armorClass.baseAc).toBe(13);
      expect(shieldedMonkSheet.armorClass.shieldBonus).toBe(2);
      expect(shieldedMonkSheet.armorClass.totalAc).toBe(15);

      const monkCandidate = shieldedMonkSheet.armorClass.candidateFormulas.find(
        (c) => c.id === 'unarmored_monk',
      );
      expect(monkCandidate?.valid).toBe(false);
      expect(monkCandidate?.invalidReason).toBe('Wielding a shield');
    });

    it('compares competing unarmored formulas (Barbarian vs Monk vs Draconic Resilience vs Mage Armor) and selects the highest', () => {
      // DEX 14 (+2), CON 12 (+1), WIS 12 (+1)
      // Unarmored: 12 | Barbarian: 13 | Monk: 13 | Mage Armor: 15 -> selects Mage Armor (15)!
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 13,
          dex: 13, // +1 human = 14 (+2)
          con: 11, // +1 human = 12 (+1)
          int: 10,
          wis: 11, // +1 human = 12 (+1)
          cha: 13,
        },
        classes: [
          {
            classId: 'barbarian',
            level: 1,
            hpRollsByLevel: [12],
            choiceSelectionsByLevel: {
              1: { 'barbarian-skills': ['athletics', 'survival'] },
            },
            asiOrFeatByLevel: {},
          },
          {
            classId: 'monk',
            level: 1,
            hpRollsByLevel: [5],
            choiceSelectionsByLevel: {},
            asiOrFeatByLevel: {},
          },
        ],
        runtime: createDefaultCharacterRuntimeState({
          activeEffects: [
            {
              effectId: 'mage-armor',
              name: 'Mage Armor',
              requiresConcentration: false,
              modifiers: [
                {
                  type: 'ac_calculation',
                  id: 'mage_armor',
                  formula: '13 + @dexMod',
                  allowsShield: true,
                  requiresNoArmor: true,
                },
              ],
            },
          ],
        }),
      });

      const sheet = computeDerivedCharacter(state, compendium);
      expect(sheet.armorClass.selectedFormulaId).toBe('mage_armor');
      expect(sheet.armorClass.baseAc).toBe(15);
      expect(sheet.armorClass.totalAc).toBe(15);

      // Now increase WIS to 18 (+4) -> Monk Unarmored Defense is 10 + 2 + 4 = 16 > Mage Armor (15)!
      state.baseAbilities.wis = 17; // +1 human = 18 (+4)
      const highWisSheet = computeDerivedCharacter(state, compendium);
      expect(highWisSheet.armorClass.selectedFormulaId).toBe('unarmored_monk');
      expect(highWisSheet.armorClass.baseAc).toBe(16);
      expect(highWisSheet.armorClass.totalAc).toBe(16);
    });

    it('calculates Light, Medium (max +2 DEX), and Heavy Armor + Shield + Defense Fighting Style + Shield spell + Barkskin', () => {
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 15, // +1 human = 16
          dex: 15, // +1 human = 16 (+3)
          con: 14,
          int: 10,
          wis: 12,
          cha: 8,
        },
        classes: [
          {
            classId: 'fighter',
            level: 1,
            hpRollsByLevel: [10],
            choiceSelectionsByLevel: {
              1: {
                'fighter-skills': ['athletics', 'perception'],
                'fighter-fighting-style': ['defense'],
              },
            },
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [
          { instanceId: 'inv-studded', itemId: 'studded-leather-armor', quantity: 1 },
          { instanceId: 'inv-half-plate', itemId: 'half-plate', quantity: 1 },
          { instanceId: 'inv-plate', itemId: 'plate-armor', quantity: 1 },
          { instanceId: 'inv-shield', itemId: 'shield', quantity: 1 },
        ],
        equippedSlots: {
          armorInstanceId: 'inv-studded',
          shieldInstanceId: 'inv-shield',
        },
      });

      // 1. Light Armor: Studded Leather (12 + DEX 3 = 15) + Shield (+2) + Defense (+1) = 18
      const lightSheet = computeDerivedCharacter(state, compendium);
      expect(lightSheet.armorClass.selectedFormulaId).toBe('armor:studded-leather-armor');
      expect(lightSheet.armorClass.baseAc).toBe(15);
      expect(lightSheet.armorClass.shieldBonus).toBe(2);
      expect(lightSheet.armorClass.additiveBonuses).toEqual([
        { sourceId: 'fighting-style-defense', sourceName: 'Fighting Style: Defense', value: 1 },
      ]);
      expect(lightSheet.armorClass.totalAc).toBe(18);
      expect(lightSheet.armorClass.stealthDisadvantage).toBe(false);

      // 2. Medium Armor: Half Plate (15 + min(2, DEX 3) = 17) + Shield (+2) + Defense (+1) = 20
      state.equippedSlots.armorInstanceId = 'inv-half-plate';
      const mediumSheet = computeDerivedCharacter(state, compendium);
      expect(mediumSheet.armorClass.selectedFormulaId).toBe('armor:half-plate');
      expect(mediumSheet.armorClass.baseAc).toBe(17);
      expect(mediumSheet.armorClass.totalAc).toBe(20);
      expect(mediumSheet.armorClass.stealthDisadvantage).toBe(true);

      // 3. Heavy Armor: Plate (18) + Shield (+2) + Defense (+1) + Shield Spell (+5) = 26
      state.equippedSlots.armorInstanceId = 'inv-plate';
      state.runtime.activeEffects = [
        {
          effectId: 'shield-ac-bonus',
          name: 'Shield (+5 AC)',
          requiresConcentration: false,
          modifiers: [{ type: 'flat_bonus', target: 'ac', value: 5 }],
        },
      ];
      const heavySheet = computeDerivedCharacter(state, compendium);
      expect(heavySheet.armorClass.selectedFormulaId).toBe('armor:plate-armor');
      expect(heavySheet.armorClass.baseAc).toBe(18);
      expect(heavySheet.armorClass.totalAc).toBe(26);

      // 4. Unarmored with Barkskin active: Unarmored is 10 + 3 = 13 (Defense does NOT apply when unarmored), Barkskin raises to 16
      state.equippedSlots = {};
      state.runtime.activeEffects = [
        {
          effectId: 'barkskin',
          name: 'Barkskin',
          requiresConcentration: true,
          modifiers: [],
        },
      ];
      const barkskinSheet = computeDerivedCharacter(state, compendium);
      expect(barkskinSheet.armorClass.baseAc).toBe(13);
      expect(barkskinSheet.armorClass.additiveBonuses).toHaveLength(0);
      expect(barkskinSheet.armorClass.minimumAcOverride).toBe(16);
      expect(barkskinSheet.armorClass.totalAc).toBe(16);
    });
  });

  describe('Stage 7: Speed, Senses & Initiative', () => {
    it('enforces Heavy Armor Strength penalty for non-Dwarves and exempts Dwarves', () => {
      const humanWeakState = createBaseCharacterState({
        raceId: 'human',
        baseAbilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
        inventory: [{ instanceId: 'inv-plate', itemId: 'plate-armor', quantity: 1 }],
        equippedSlots: { armorInstanceId: 'inv-plate' }, // Requires STR 15
      });

      const humanSheet = computeDerivedCharacter(humanWeakState, compendium);
      expect(humanSheet.speedFeet).toBe(20); // 30 - 10

      const dwarfWeakState = createBaseCharacterState({
        raceId: 'dwarf',
        subraceId: 'hill-dwarf',
        racialChoices: { 'dwarf-tool-proficiency': ['smiths-tools'] },
        baseAbilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
        inventory: [{ instanceId: 'inv-plate', itemId: 'plate-armor', quantity: 1 }],
        equippedSlots: { armorInstanceId: 'inv-plate' },
      });

      const dwarfSheet = computeDerivedCharacter(dwarfWeakState, compendium);
      expect(dwarfSheet.speedFeet).toBe(25); // Dwarf speed is never reduced by heavy armor
    });
  });

  describe('Stage 8: Weapon Attack Profiles (Epic 2 Acceptance Criteria)', () => {
    it('uses max(STR, DEX) for Finesse weapons and omits/includes off-hand Two-Weapon Fighting damage modifier', () => {
      // STR 10 (+0), DEX 18 (+4), Proficiency +2
      const state = createBaseCharacterState({
        raceId: 'elf',
        subraceId: 'high-elf',
        racialChoices: {
          'high-elf-cantrip': ['fire-bolt'],
          'high-elf-extra-language': ['sylvan'],
        },
        baseAbilities: {
          str: 10,
          dex: 16, // +2 elf = 18 (+4)
          con: 14,
          int: 12,
          wis: 12,
          cha: 8,
        },
        classes: [
          {
            classId: 'fighter',
            level: 1,
            hpRollsByLevel: [10],
            choiceSelectionsByLevel: {
              1: {
                'fighter-skills': ['acrobatics', 'perception'],
                'fighter-fighting-style': ['defense'], // Not two-weapon-fighting yet
              },
            },
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [
          { instanceId: 'inv-main-short', itemId: 'shortsword', quantity: 1 },
          { instanceId: 'inv-off-dagger', itemId: 'dagger', quantity: 1 },
        ],
        equippedSlots: {
          mainHandInstanceId: 'inv-main-short',
          offHandInstanceId: 'inv-off-dagger',
        },
      });

      const sheetWithoutTwf = computeDerivedCharacter(state, compendium);
      const mainProfile = sheetWithoutTwf.weaponAttacks.find((w) => w.slot === 'main_hand')!;
      const offProfile = sheetWithoutTwf.weaponAttacks.find((w) => w.slot === 'off_hand')!;

      // Main-hand Shortsword (Finesse): uses DEX (+4), To-Hit +6, Damage 1d6+4
      expect(mainProfile.abilityUsed).toBe('dex');
      expect(mainProfile.toHitBonus).toBe(6);
      expect(mainProfile.damageBonus).toBe(4);
      expect(mainProfile.damageFormula).toBe('1d6+4');
      expect(mainProfile.actionCost).toBe('action');

      // Off-hand Dagger (without Two-Weapon Fighting style): uses DEX (+4) for To-Hit (+6),
      // but OMITS positive ability modifier from damage (1d4, damageBonus = 0)!
      expect(offProfile.abilityUsed).toBe('dex');
      expect(offProfile.toHitBonus).toBe(6);
      expect(offProfile.damageBonus).toBe(0);
      expect(offProfile.damageFormula).toBe('1d4');
      expect(offProfile.actionCost).toBe('bonus_action');

      // Now switch Fighting Style to Two-Weapon Fighting -> Off-hand Dagger INCLUDES +4 DEX on damage (1d4+4)!
      state.classes[0]!.choiceSelectionsByLevel[1]!['fighter-fighting-style'] = [
        'two-weapon-fighting',
      ];
      const sheetWithTwf = computeDerivedCharacter(state, compendium);
      const offProfileWithTwf = sheetWithTwf.weaponAttacks.find(
        (w) => w.slot === 'off_hand',
      )!;
      expect(offProfileWithTwf.damageBonus).toBe(4);
      expect(offProfileWithTwf.damageFormula).toBe('1d4+4');
    });

    it('omits the off-hand profile unless BOTH hands hold light melee weapons (quarterstaff + dagger has no BA)', () => {
      // Xorda-like: quarterstaff main (versatile, NOT light) + dagger off (light).
      const nonLight = createBaseCharacterState({
        inventory: [
          { instanceId: 'inv-staff', itemId: 'quarterstaff', quantity: 1 },
          { instanceId: 'inv-dagger', itemId: 'dagger', quantity: 1 },
        ],
        equippedSlots: {
          mainHandInstanceId: 'inv-staff',
          offHandInstanceId: 'inv-dagger',
        },
      });
      const nonLightSheet = computeDerivedCharacter(nonLight, compendium);
      expect(nonLightSheet.weaponAttacks.some((w) => w.slot === 'main_hand')).toBe(true);
      expect(nonLightSheet.weaponAttacks.some((w) => w.slot === 'off_hand')).toBe(false);

      // Light + light (dagger + dagger) qualifies for the BA off-hand.
      const lightPair = createBaseCharacterState({
        inventory: [
          { instanceId: 'inv-d1', itemId: 'dagger', quantity: 1 },
          { instanceId: 'inv-d2', itemId: 'dagger', quantity: 1 },
        ],
        equippedSlots: {
          mainHandInstanceId: 'inv-d1',
          offHandInstanceId: 'inv-d2',
        },
      });
      const lightSheet = computeDerivedCharacter(lightPair, compendium);
      expect(lightSheet.weaponAttacks.some((w) => w.slot === 'off_hand')).toBe(true);
    });

    it('applies Archery (+2 to ranged weapon attack rolls) and Dueling (+2 to one-handed melee damage with no other weapon)', () => {
      // Fighter with STR 16 (+3), DEX 16 (+3), Proficiency +2
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 15, // +1 human = 16 (+3)
          dex: 15, // +1 human = 16 (+3)
          con: 14,
          int: 10,
          wis: 12,
          cha: 8,
        },
        classes: [
          {
            classId: 'fighter',
            subclassId: 'champion',
            level: 3, // Champion L3 -> Improved Critical (critRange 19)
            hpRollsByLevel: [10, 6, 6],
            choiceSelectionsByLevel: {
              1: {
                'fighter-skills': ['athletics', 'perception'],
                'fighter-fighting-style': ['dueling'],
              },
            },
            asiOrFeatByLevel: {},
          },
        ],
        inventory: [
          { instanceId: 'inv-longsword', itemId: 'longsword', quantity: 1 },
          { instanceId: 'inv-shield', itemId: 'shield', quantity: 1 },
          { instanceId: 'inv-longbow', itemId: 'longbow', quantity: 1 },
          { instanceId: 'inv-greatsword', itemId: 'greatsword', quantity: 1 },
        ],
        equippedSlots: {
          mainHandInstanceId: 'inv-longsword',
          shieldInstanceId: 'inv-shield', // Shield is allowed with Dueling!
          rangedInstanceId: 'inv-longbow',
        },
      });

      // 1. Test Dueling with Longsword + Shield
      const duelingSheet = computeDerivedCharacter(state, compendium);
      const longswordAtk = duelingSheet.weaponAttacks.find((w) => w.slot === 'main_hand')!;
      const longbowAtk = duelingSheet.weaponAttacks.find((w) => w.slot === 'ranged')!;

      // Longsword: To-Hit = +3 STR + 2 Prof = +5; Damage = +3 STR + 2 Dueling = +5 (1d8+5)
      expect(longswordAtk.toHitBonus).toBe(5);
      expect(longswordAtk.damageBonus).toBe(5);
      expect(longswordAtk.damageFormula).toBe('1d8+5');
      expect(longswordAtk.critRange).toBe(19);

      // Longbow does NOT get Dueling damage bonus
      expect(longbowAtk.toHitBonus).toBe(5);
      expect(longbowAtk.damageBonus).toBe(3);
      expect(longbowAtk.damageFormula).toBe('1d8+3');

      // 2. Equipping a Two-Handed Greatsword disables Dueling (+2 damage)
      state.equippedSlots.mainHandInstanceId = 'inv-greatsword';
      const greatswordSheet = computeDerivedCharacter(state, compendium);
      const greatswordAtk = greatswordSheet.weaponAttacks.find((w) => w.slot === 'main_hand')!;
      expect(greatswordAtk.damageBonus).toBe(3); // Only +3 STR, no Dueling
      expect(greatswordAtk.damageFormula).toBe('2d6+3');

      // 3. Switch Fighting Style to Archery -> Longbow gets +2 To-Hit (+3 DEX + 2 Prof + 2 Archery = +7), melee does not
      state.classes[0]!.choiceSelectionsByLevel[1]!['fighter-fighting-style'] = ['archery'];
      state.equippedSlots.mainHandInstanceId = 'inv-longsword';
      const archerySheet = computeDerivedCharacter(state, compendium);
      const archeryLongbow = archerySheet.weaponAttacks.find((w) => w.slot === 'ranged')!;
      const archeryLongsword = archerySheet.weaponAttacks.find((w) => w.slot === 'main_hand')!;

      expect(archeryLongbow.toHitBonus).toBe(7);
      expect(archeryLongbow.damageBonus).toBe(3);
      expect(archeryLongsword.toHitBonus).toBe(5);
    });
  });

  describe('Stage 9 & 10: Multiclass Spellcasting, Pact Magic, Extra Attack & Resources', () => {
    it('computes Multiclass Spellcaster slots, separate Warlock Pact Magic slots, and Extra Attack', () => {
      // Paladin 6 (half caster -> 3) + Sorcerer 3 (full caster -> 3) + Warlock 2 (pact magic -> 2 L1 pact slots)
      // Total Level = 11 (Proficiency +4), Effective Caster Level = 6 (4/3/3 level 1/2/3 slots)
      const state = createBaseCharacterState({
        baseAbilities: {
          str: 15, // +1 human = 16 (+3)
          dex: 10,
          con: 13, // +1 human = 14 (+2)
          int: 8,
          wis: 12,
          cha: 15, // +1 human = 16 (+3)
        },
        classes: [
          {
            classId: 'paladin',
            subclassId: 'devotion',
            level: 6, // Extra Attack (2), Lay on Hands (30), Aura of Protection (+3)
            hpRollsByLevel: [10, 6, 6, 6, 6, 6],
            choiceSelectionsByLevel: {
              1: { 'paladin-skills': ['athletics', 'persuasion'] },
              2: { 'paladin-fighting-style': ['dueling'] },
            },
            asiOrFeatByLevel: {
              4: { type: 'asi', bonuses: { cha: 2 } }, // CHA 18 (+4)
            },
          },
          {
            classId: 'sorcerer',
            subclassId: 'draconic',
            level: 3, // Font of Magic (3 sorcery points)
            hpRollsByLevel: [4, 4, 4],
            choiceSelectionsByLevel: {
              3: { 'sorcerer-metamagic': ['quickened', 'twinned'] },
            },
            asiOrFeatByLevel: {},
          },
          {
            classId: 'warlock',
            subclassId: 'fiend',
            level: 2, // 2 Pact Slots at Level 1
            hpRollsByLevel: [5, 5],
            choiceSelectionsByLevel: {
              2: {
                'warlock-invocations': ['agonizing-blast', 'devils-sight'],
              },
            },
            asiOrFeatByLevel: {},
          },
        ],
        spellcasting: createDefaultSpellcastingSelection({
          knownCantripIds: ['eldritch-blast', 'fire-bolt', 'mage-hand'],
          knownSpellIds: ['shield', 'magic-missile', 'hex', 'hellish-rebuke'],
          preparedSpellIds: ['cure-wounds', 'bless'],
        }),
        runtime: createDefaultCharacterRuntimeState({
          expendedSpellSlots: {
            1: 1,
            2: 0,
            3: 2,
            4: 0,
            5: 0,
            6: 0,
            7: 0,
            8: 0,
            9: 0,
          },
          expendedPactSlots: 1,
          resourceChargesSpent: {
            lay_on_hands: 10,
            sorcery_points: 1,
          },
        }),
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      expect(sheet.totalLevel).toBe(11);
      expect(sheet.proficiencyBonus).toBe(4);
      expect(sheet.attacksPerAction).toBe(2);

      // Devil's Sight grants 120 ft darkvision
      expect(sheet.senses.darkvisionFeet).toBe(120);

      // Spellcasting
      expect(sheet.spellcasting.isSpellcaster).toBe(true);
      expect(sheet.spellcasting.effectiveCasterLevel).toBe(6);
      expect(sheet.spellcasting.primaryAbility).toBe('cha');
      // DC = 8 + 4 (prof) + 4 (CHA) = 16; Spell Attack = +8
      expect(sheet.spellcasting.primarySpellSaveDc).toBe(16);
      expect(sheet.spellcasting.primarySpellAttackBonus).toBe(8);

      // Multiclass L6 slots: L1=4 (1 spent -> 3 avail), L2=3, L3=3 (2 spent -> 1 avail), L4+=0
      expect(sheet.spellcasting.spellSlots[1]).toEqual({
        max: 4,
        expended: 1,
        available: 3,
      });
      expect(sheet.spellcasting.spellSlots[2]).toEqual({
        max: 3,
        expended: 0,
        available: 3,
      });
      expect(sheet.spellcasting.spellSlots[3]).toEqual({
        max: 3,
        expended: 2,
        available: 1,
      });
      expect(sheet.spellcasting.spellSlots[4].max).toBe(0);

      // Pact Magic tracked separately
      expect(sheet.spellcasting.pactMagic).toEqual({
        slotLevel: 1,
        maxSlots: 2,
        expendedSlots: 1,
        availableSlots: 1,
      });

      // Oath of Devotion L3/L5 always-prepared spells included
      expect(sheet.spellcasting.alwaysPreparedSpellIds).toEqual(
        expect.arrayContaining([
          'protection-from-evil-and-good',
          'sanctuary',
          'lesser-restoration',
          'zone-of-truth',
        ]),
      );

      // Resources scaled by class level, not total character level
      expect(sheet.resources['lay_on_hands']).toEqual({
        resourceId: 'lay_on_hands',
        name: 'Lay on Hands Pool',
        max: 30, // 5 * 6 Paladin levels
        spent: 10,
        available: 20,
        recovery: 'long_rest',
        sourceId: 'lay-on-hands',
      });
      expect(sheet.resources['sorcery_points']).toEqual({
        resourceId: 'sorcery_points',
        name: 'Sorcery Points',
        max: 3, // 3 Sorcerer levels
        spent: 1,
        available: 2,
        recovery: 'long_rest',
        sourceId: 'font-of-magic',
      });
    });

    it('customizes Dragonborn Breath Weapon and Damage Resistance to match chosen Draconic Ancestry', () => {
      const state = createBaseCharacterState({
        raceId: 'dragonborn',
        racialChoices: {
          'draconic-ancestry': ['blue'], // Blue Dragon -> Lightning, 5x30 ft line, DEX save
        },
        classes: [
          {
            classId: 'fighter',
            level: 6, // Level 6 -> Breath Weapon scales to 3d6
            hpRollsByLevel: [10, 6, 6, 6, 6, 6],
            choiceSelectionsByLevel: {
              1: { 'fighter-skills': ['athletics', 'intimidation'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
      });

      const sheet = computeDerivedCharacter(state, compendium);
      DerivedCharacterSheetSchema.parse(sheet);

      expect(sheet.damageResistances).toContain('lightning');
      const breath = sheet.activatedAbilities.find(
        (a) => a.id === 'dragonborn-breath-weapon',
      );
      expect(breath).toBeDefined();
      expect(breath?.name).toBe('Breath Weapon (Blue)');
      expect(breath?.targeting?.aoe).toEqual({
        shape: 'line',
        sizeFeet: 30,
        widthFeet: 5,
      });
      expect(breath?.effects[0]).toEqual({
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '8 + @conMod + @prof',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '3d6',
            damageType: 'lightning',
            halfOnSaveSuccess: true,
          },
        ],
      });
    });
  });
});
