import { createCompendium } from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  applyDuplicateProficiencyReplacement,
  classifyProficiencyId,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultSpellcastingSelection,
  getDuplicateReplacementChoiceId,
  normalizeFeatureOptionId,
  parseDuplicateReplacementChoiceId,
  resolveProficienciesAndDuplicates,
  validateBackgroundChoices,
  validateCharacterChoices,
  validateChoiceSpecSelection,
  validateClassChoices,
  validateOriginChoices,
} from '../index.js';

const compendium = createCompendium();

function createBaseCharacterState(): CharacterBuildState {
  return {
    id: 'char-test-1',
    version: 1,
    name: 'Test Hero',
    portraitId: 'portrait-1',
    tokenSpriteId: 'token-1',
    alignment: 'neutral_good',
    raceId: 'dwarf',
    subraceId: 'hill-dwarf',
    racialChoices: {
      'dwarf-tool-proficiency': ['smiths-tools'],
    },
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['elvish', 'celestial'],
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
    currency: createDefaultCurrency({ gp: 15 }),
    inventory: [],
    equippedSlots: {},
    attunedItemInstanceIds: [],
    spellcasting: createDefaultSpellcastingSelection(),
    runtime: createDefaultCharacterRuntimeState({ currentHp: 12 }),
  };
}

describe('SRD-203: Choice Tree Validator & Duplicate Proficiency Replacement Rule', () => {
  describe('Single ChoiceSpec Validator (validateChoiceSpecSelection)', () => {
    it('validates explicit and category skill, tool, and language choices', () => {
      const fighter = compendium.requireClass('fighter');
      const validSkillRes = validateChoiceSpecSelection(
        fighter.skillChoices,
        ['athletics', 'perception'],
        { compendium },
      );
      expect(validSkillRes.valid).toBe(true);
      expect(validSkillRes.normalizedSelected).toEqual(['athletics', 'perception']);

      const wrongCountRes = validateChoiceSpecSelection(
        fighter.skillChoices,
        ['athletics'],
        { compendium },
      );
      expect(wrongCountRes.valid).toBe(false);
      expect(wrongCountRes.missingCount).toBe(1);

      const dupSkillRes = validateChoiceSpecSelection(
        fighter.skillChoices,
        ['athletics', 'athletics'],
        { compendium },
      );
      expect(dupSkillRes.valid).toBe(false);
      expect(dupSkillRes.duplicateOptions).toEqual(['athletics']);

      const disallowedSkillRes = validateChoiceSpecSelection(
        fighter.skillChoices,
        ['athletics', 'arcana'],
        { compendium },
      );
      expect(disallowedSkillRes.valid).toBe(false);
      expect(disallowedSkillRes.invalidOptions).toEqual(['arcana']);
    });

    it('validates Half-Elf ability_score_bonus choices (distinct and excluding CHA)', () => {
      const halfElf = compendium.requireRace('half-elf');
      const bonusChoice = halfElf.choices.find(
        (c) => c.id === 'half-elf-ability-bonuses',
      )!;

      const validRes = validateChoiceSpecSelection(bonusChoice, ['dex', 'con'], {
        compendium,
      });
      expect(validRes.valid).toBe(true);

      const excludedChaRes = validateChoiceSpecSelection(bonusChoice, ['cha', 'dex'], {
        compendium,
      });
      expect(excludedChaRes.valid).toBe(false);
      expect(excludedChaRes.invalidOptions).toEqual(['cha']);
      expect(excludedChaRes.errors[0]).toMatch(/excludes ability 'cha'/i);

      const nonDistinctRes = validateChoiceSpecSelection(bonusChoice, ['dex', 'dex'], {
        compendium,
      });
      expect(nonDistinctRes.valid).toBe(false);
      expect(nonDistinctRes.duplicateOptions).toEqual(['dex']);
    });

    it('validates spell ChoiceSpec (High Elf Wizard cantrip)', () => {
      const highElf = compendium.requireSubrace('high-elf');
      const cantripChoice = highElf.choices.find((c) => c.id === 'high-elf-cantrip')!;

      const validRes = validateChoiceSpecSelection(cantripChoice, ['fire-bolt'], {
        compendium,
      });
      expect(validRes.valid).toBe(true);

      // Level 1 Wizard spell is rejected when maxSpellLevel === 0
      const level1SpellRes = validateChoiceSpecSelection(
        cantripChoice,
        ['magic-missile'],
        { compendium },
      );
      expect(level1SpellRes.valid).toBe(false);
      expect(level1SpellRes.invalidOptions).toEqual(['magic-missile']);

      // Cleric-only cantrip is rejected for classList === 'wizard'
      const wrongClassRes = validateChoiceSpecSelection(
        cantripChoice,
        ['sacred-flame'],
        { compendium },
      );
      expect(wrongClassRes.valid).toBe(false);
    });

    it('normalizes feature_option selections and enforces cross-feature uniqueness', () => {
      const fightingStyleFeature = compendium.requireFeature('fighting-style-fighter');
      const styleChoice = fightingStyleFeature.choices![0]!;
      if (styleChoice.type !== 'feature_option') {
        throw new Error('Expected feature_option choice');
      }

      expect(normalizeFeatureOptionId('defense', styleChoice)).toBe(
        'fighting-style-defense',
      );
      expect(normalizeFeatureOptionId('fighting-style-archery', styleChoice)).toBe(
        'fighting-style-archery',
      );

      const validShort = validateChoiceSpecSelection(styleChoice, ['dueling'], {
        compendium,
      });
      expect(validShort.valid).toBe(true);
      expect(validShort.normalizedSelected).toEqual(['fighting-style-dueling']);

      // Rejects selecting an already chosen option in the same featureGroup
      const alreadyChosen = validateChoiceSpecSelection(styleChoice, ['dueling'], {
        compendium,
        alreadyChosenFeatureOptions: new Set(['fighting-style-dueling']),
      });
      expect(alreadyChosen.valid).toBe(false);
      expect(alreadyChosen.errors[0]).toMatch(/already been selected/i);
    });

    it('validates equipment_bundle choices and nested category_choice sub-selections', () => {
      const barbarian = compendium.requireClass('barbarian');
      const mainWeaponChoice = barbarian.startingEquipmentChoices.find(
        (c) => c.id === 'barbarian-main-weapon',
      )!;

      const validSubChoice = validateChoiceSpecSelection(
        mainWeaponChoice,
        ['martial-melee'],
        {
          compendium,
          subChoiceSelections: {
            'barbarian-main-weapon:martial-melee': ['longsword'],
          },
        },
      );
      expect(validSubChoice.valid).toBe(true);

      // Ranged weapon ('longbow') is invalid for 'martial_melee_weapons'
      const invalidSubChoice = validateChoiceSpecSelection(
        mainWeaponChoice,
        ['martial-melee'],
        {
          compendium,
          subChoiceSelections: {
            'barbarian-main-weapon:martial-melee': ['longbow'],
          },
        },
      );
      expect(invalidSubChoice.valid).toBe(false);
      expect(invalidSubChoice.invalidOptions).toEqual(['longbow']);
    });
  });

  describe('Step 1: Origin (Race & Subrace) Validation', () => {
    it('requires subrace for Dwarf, Elf, Halfling, and Gnome and rejects missing or mismatched subraces', () => {
      const missingSubrace = validateOriginChoices(
        {
          raceId: 'dwarf',
          subraceId: undefined,
          racialChoices: { 'dwarf-tool-proficiency': ['smiths-tools'] },
        },
        compendium,
      );
      expect(missingSubrace.valid).toBe(false);
      expect(missingSubrace.subraceRequired).toBe(true);
      expect(missingSubrace.errors[0]).toMatch(/requires selecting a subrace/i);

      const mismatchedSubrace = validateOriginChoices(
        {
          raceId: 'dwarf',
          subraceId: 'high-elf',
          racialChoices: { 'dwarf-tool-proficiency': ['smiths-tools'] },
        },
        compendium,
      );
      expect(mismatchedSubrace.valid).toBe(false);
      expect(mismatchedSubrace.errors[0]).toMatch(/not a valid subrace/i);
    });

    it('rejects subraceId on races without subraces (Dragonborn, Human, Half-Elf, Half-Orc, Tiefling)', () => {
      const res = validateOriginChoices(
        {
          raceId: 'dragonborn',
          subraceId: 'hill-dwarf',
          racialChoices: { 'draconic-ancestry': ['red'] },
        },
        compendium,
      );
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toMatch(/does not have subraces/i);
    });

    it('validates High Elf, Half-Elf, and Dragonborn racial choices and rejects unexpected choice keys', () => {
      const highElfValid = validateOriginChoices(
        {
          raceId: 'elf',
          subraceId: 'high-elf',
          racialChoices: {
            'high-elf-cantrip': ['prestidigitation'],
            'high-elf-extra-language': ['draconic'],
          },
        },
        compendium,
      );
      expect(highElfValid.valid).toBe(true);

      const halfElfValid = validateOriginChoices(
        {
          raceId: 'half-elf',
          racialChoices: {
            'half-elf-ability-bonuses': ['dex', 'wis'],
            'half-elf-skill-versatility': ['stealth', 'persuasion'],
            'half-elf-extra-language': ['sylvan'],
          },
        },
        compendium,
      );
      expect(halfElfValid.valid).toBe(true);

      const unexpectedKey = validateOriginChoices(
        {
          raceId: 'human',
          racialChoices: {
            'human-extra-language': ['elvish'],
            'bogus-choice-key': ['foo'],
          },
        },
        compendium,
      );
      expect(unexpectedKey.valid).toBe(false);
      expect(unexpectedKey.unexpectedChoiceKeys).toEqual(['bogus-choice-key']);
    });
  });

  describe('Step 2: Class, Subclass, Feature, ASI/Feat, and Expertise Validation', () => {
    it('enforces subclass unlock levels (L1 Cleric/Sorcerer/Warlock, L2 Wizard/Druid, L3 Fighter/Rogue)', () => {
      const state = createBaseCharacterState();
      // Level 1 Cleric must choose 'life' domain
      state.classes = [
        {
          classId: 'cleric',
          level: 1,
          hpRollsByLevel: [8],
          choiceSelectionsByLevel: {
            1: { 'cleric-skills': ['history', 'medicine'] },
          },
          asiOrFeatByLevel: {},
        },
      ];
      const missingClericDomain = validateClassChoices(state, compendium);
      expect(missingClericDomain.valid).toBe(false);
      expect(missingClericDomain.errors[0]).toMatch(/Divine Domain/i);

      state.classes[0]!.subclassId = 'life';
      expect(validateClassChoices(state, compendium).valid).toBe(true);

      // Level 1 Fighter cannot select 'champion' before Level 3
      const prematureFighter = createBaseCharacterState();
      prematureFighter.classes[0]!.subclassId = 'champion';
      const prematureRes = validateClassChoices(prematureFighter, compendium);
      expect(prematureRes.valid).toBe(false);
      expect(prematureRes.errors[0]).toMatch(/until level 3/i);
    });

    it('prevents Champion Fighter at L10 from selecting the same Fighting Style chosen at L1', () => {
      const state = createBaseCharacterState();
      state.classes = [
        {
          classId: 'fighter',
          subclassId: 'champion',
          level: 10,
          hpRollsByLevel: [10, 6, 6, 6, 6, 6, 6, 6, 6, 6],
          choiceSelectionsByLevel: {
            1: {
              'fighter-skills': ['athletics', 'perception'],
              'fighter-fighting-style': ['defense'],
            },
            10: {
              'champion-additional-fighting-style': ['defense'],
            },
          },
          asiOrFeatByLevel: {
            4: { type: 'asi', bonuses: { str: 2 } },
            6: { type: 'asi', bonuses: { con: 2 } },
            8: { type: 'asi', bonuses: { con: 2 } },
          },
        },
      ];

      const duplicateStyleRes = validateClassChoices(state, compendium);
      expect(duplicateStyleRes.valid).toBe(false);
      expect(duplicateStyleRes.errors.some((e) => /already been selected/i.test(e))).toBe(
        true,
      );

      state.classes[0]!.choiceSelectionsByLevel[10] = {
        'champion-additional-fighting-style': ['archery'],
      };
      const validStyleRes = validateClassChoices(state, compendium);
      expect(validStyleRes.valid).toBe(true);
    });

    it('validates ASI selections and Feat prerequisites (Grappler STR >= 13)', () => {
      const state = createBaseCharacterState();
      state.baseAbilities.str = 10; // Below Grappler minimum of 13
      state.classes = [
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
            4: { type: 'feat', featId: 'grappler' },
          },
        },
      ];

      const lowStrRes = validateClassChoices(state, compendium);
      expect(lowStrRes.valid).toBe(false);
      expect(lowStrRes.errors.some((e) => /requires STR 13/i.test(e))).toBe(true);

      // With STR 15, Grappler prerequisite is satisfied
      state.baseAbilities.str = 15;
      expect(validateClassChoices(state, compendium).valid).toBe(true);
    });

    it('validates Rogue Expertise selections against proficient skills and thieves-tools', () => {
      const state = createBaseCharacterState();
      state.classes = [
        {
          classId: 'rogue',
          level: 1,
          hpRollsByLevel: [8],
          choiceSelectionsByLevel: {
            1: {
              'rogue-skills': ['stealth', 'acrobatics', 'sleight-of-hand', 'perception'],
              'expertise-rogue': ['stealth', 'thieves-tools'],
            },
          },
          asiOrFeatByLevel: {},
        },
      ];

      const validRes = validateCharacterChoices(state, compendium, {
        requireExpertiseChoices: true,
      });
      expect(validRes.valid).toBe(true);
      expect(validRes.resolvedProficiencies.expertise).toEqual([
        'stealth',
        'thieves-tools',
      ]);

      // Selecting a skill the Rogue is NOT proficient in ('arcana') fails validation
      state.classes[0]!.choiceSelectionsByLevel[1]!['expertise-rogue'] = [
        'stealth',
        'arcana',
      ];
      const nonProficientRes = validateCharacterChoices(state, compendium, {
        requireExpertiseChoices: true,
      });
      expect(nonProficientRes.valid).toBe(false);
      expect(
        nonProficientRes.errors.some((e) => /requires existing proficiency/i.test(e)),
      ).toBe(true);
    });
  });

  describe('Step 4: Background & Custom SRD Background Validation', () => {
    it('validates standard Acolyte background and Custom SRD Background (2 skills + 2 tools/languages)', () => {
      const state = createBaseCharacterState();
      expect(validateBackgroundChoices(state, compendium).valid).toBe(true);

      const customState = createBaseCharacterState();
      customState.backgroundId = 'custom';
      customState.backgroundChoices = {};
      customState.customBackground = {
        name: 'Outlander Scout',
        skillProficiencies: ['survival', 'nature'],
        toolProficiencies: ['herbalism-kit'],
        languages: ['sylvan'],
      };
      expect(validateBackgroundChoices(customState, compendium).valid).toBe(true);

      // Invalid custom background with only 1 tool/language total instead of 2
      customState.customBackground = {
        name: 'Incomplete Custom',
        skillProficiencies: ['survival', 'nature'],
        toolProficiencies: ['herbalism-kit'],
        languages: [],
      };
      const badCustom = validateBackgroundChoices(customState, compendium);
      expect(badCustom.valid).toBe(false);
      expect(badCustom.errors[0]).toMatch(/combined total of 2/i);
    });
  });

  describe('SRD 5.1 Duplicate Proficiency Replacement Rule', () => {
    it('detects duplicate skill proficiencies (e.g. Elf Keen Senses + Fighter Perception) and resolves via replacement', () => {
      const state = createBaseCharacterState();
      state.raceId = 'elf';
      state.subraceId = 'high-elf';
      state.racialChoices = {
        'high-elf-cantrip': ['fire-bolt'],
        'high-elf-extra-language': ['draconic'],
      };
      // Elf grants fixed 'perception' and 'elvish', so update acolyte-languages to avoid language collision
      state.backgroundChoices = {
        'acolyte-languages': ['celestial', 'abyssal'],
      };
      // Fighter also selects 'perception' -> duplicate skill collision on 'perception'!
      state.classes[0]!.choiceSelectionsByLevel[1] = {
        'fighter-skills': ['athletics', 'perception'],
        'fighter-fighting-style': ['defense'],
      };

      const initialResult = validateCharacterChoices(state, compendium);
      expect(initialResult.valid).toBe(false);
      expect(initialResult.duplicateProficiencies).toHaveLength(1);
      expect(initialResult.unresolvedDuplicates).toHaveLength(1);

      const collision = initialResult.duplicateProficiencies[0]!;
      expect(collision.category).toBe('skill');
      expect(collision.proficiencyId).toBe('perception');
      expect(collision.duplicateCount).toBe(1);
      expect(collision.replacementChoiceId).toBe('replace:skill:perception');
      // Available replacements exclude already known skills (athletics, insight, perception, religion)
      expect(collision.availableReplacementOptions).not.toContain('perception');
      expect(collision.availableReplacementOptions).not.toContain('athletics');
      expect(collision.availableReplacementOptions).not.toContain('insight');
      expect(collision.availableReplacementOptions).not.toContain('religion');
      expect(collision.availableReplacementOptions).toContain('stealth');

      // Attempting to replace 'perception' with an already-known skill ('insight' from Acolyte) fails
      const badReplacementState = applyDuplicateProficiencyReplacement(
        state,
        'skill',
        'perception',
        ['insight'],
      );
      const badRes = validateCharacterChoices(badReplacementState, compendium);
      expect(badRes.valid).toBe(false);
      expect(badRes.errors.some((e) => /already possessed/i.test(e))).toBe(true);

      // Replacing duplicate 'perception' with any other skill ('stealth' — even outside Fighter's class list!) succeeds per SRD 5.1
      const resolvedState = applyDuplicateProficiencyReplacement(
        state,
        'skill',
        'perception',
        ['stealth'],
      );
      const resolvedResult = validateCharacterChoices(resolvedState, compendium);
      expect(resolvedResult.valid).toBe(true);
      expect(resolvedResult.unresolvedDuplicates).toHaveLength(0);
      expect(resolvedResult.resolvedProficiencies.skills).toEqual([
        'athletics',
        'insight',
        'perception',
        'religion',
        'stealth',
      ]);
    });

    it('detects and resolves duplicate tool and language proficiencies (Rock Gnome + Custom Background)', () => {
      const state = createBaseCharacterState();
      state.raceId = 'gnome';
      state.subraceId = 'rock-gnome'; // Grants fixed 'tinkers-tools', 'common', 'gnomish'
      state.racialChoices = {};
      state.backgroundId = 'custom';
      state.backgroundChoices = {};
      state.customBackground = {
        name: 'Guild Tinker',
        skillProficiencies: ['investigation', 'history'],
        toolProficiencies: ['tinkers-tools'], // Collides with Rock Gnome 'tinkers-tools'
        languages: ['gnomish'], // Collides with Gnome 'gnomish'
      };

      const unresolved = resolveProficienciesAndDuplicates(state, compendium);
      expect(unresolved.unresolvedDuplicates).toHaveLength(2);
      expect(
        unresolved.unresolvedDuplicates.map((d) => d.replacementChoiceId).sort(),
      ).toEqual(['replace:language:gnomish', 'replace:tool:tinkers-tools']);

      let nextState = applyDuplicateProficiencyReplacement(
        state,
        'tool',
        'tinkers-tools',
        ['alchemists-supplies'],
      );
      nextState = applyDuplicateProficiencyReplacement(
        nextState,
        'language',
        'gnomish',
        ['dwarvish'],
      );

      const resolved = validateCharacterChoices(nextState, compendium);
      expect(resolved.valid).toBe(true);
      expect(resolved.resolvedProficiencies.tools).toEqual([
        'tinkers-tools',
        'alchemists-supplies',
      ]);
      expect(resolved.resolvedProficiencies.languages).toEqual([
        'common',
        'gnomish',
        'dwarvish',
      ]);
    });

    it('prevents two separate duplicate collisions in the same category from selecting the same replacement', () => {
      const state = createBaseCharacterState();
      state.raceId = 'half-elf';
      state.subraceId = undefined;
      state.racialChoices = {
        'half-elf-ability-bonuses': ['dex', 'con'],
        // Both 'insight' and 'religion' collide with Acolyte background
        'half-elf-skill-versatility': ['insight', 'religion'],
        'half-elf-extra-language': ['sylvan'],
      };
      state.backgroundChoices = {
        'acolyte-languages': ['celestial', 'draconic'],
      };

      // Both replacements pick 'stealth' -> should fail
      let collidingRep = applyDuplicateProficiencyReplacement(
        state,
        'skill',
        'insight',
        ['stealth'],
      );
      collidingRep = applyDuplicateProficiencyReplacement(
        collidingRep,
        'skill',
        'religion',
        ['stealth'],
      );
      const collidingRes = validateCharacterChoices(collidingRep, compendium);
      expect(collidingRes.valid).toBe(false);
      expect(
        collidingRes.errors.some((e) => /selected more than once/i.test(e)),
      ).toBe(true);

      // Distinct replacements ('stealth' and 'persuasion') -> succeeds
      const validRep = applyDuplicateProficiencyReplacement(
        collidingRep,
        'skill',
        'religion',
        ['persuasion'],
      );
      const validRes = validateCharacterChoices(validRep, compendium);
      expect(validRes.valid).toBe(true);
      expect(validRes.resolvedProficiencies.skills).toEqual([
        'athletics',
        'insight',
        'perception',
        'persuasion',
        'religion',
        'stealth',
      ]);
    });

    it('rejects stale replacement choice keys when no duplicate proficiency exists', () => {
      const state = createBaseCharacterState();
      state.backgroundChoices['replace:skill:arcana'] = ['stealth'];

      const res = validateCharacterChoices(state, compendium);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => /Stale duplicate replacement/i.test(e))).toBe(
        true,
      );
    });

    it('extracts resolved ability bonuses, bonus cantrips, and feature options from the Choice Tree', () => {
      const state = createBaseCharacterState();
      state.raceId = 'elf';
      state.subraceId = 'high-elf';
      state.racialChoices = {
        'high-elf-cantrip': ['mage-hand'],
        'high-elf-extra-language': ['sylvan'],
      };
      state.backgroundChoices = {
        'acolyte-languages': ['celestial', 'draconic'],
      };
      // Elf grants fixed 'perception', so Fighter selects 'athletics' and 'survival'
      state.classes[0]!.choiceSelectionsByLevel[1] = {
        'fighter-skills': ['athletics', 'survival'],
        'fighter-fighting-style': ['dueling'],
      };

      const res = validateCharacterChoices(state, compendium);
      expect(res.valid).toBe(true);
      expect(res.bonusSpellIdsFromChoices.cantripIds).toEqual(['mage-hand']);
      expect(res.selectedFeatureOptionIdsByGroup['fighting-style']).toEqual([
        'fighting-style-dueling',
      ]);
    });

    it('correctly classifies proficiencies and parses replacement choice IDs', () => {
      expect(classifyProficiencyId('stealth', compendium)).toBe('skill');
      expect(classifyProficiencyId('common', compendium)).toBe('language');
      expect(classifyProficiencyId('thieves-tools', compendium)).toBe('tool');
      expect(classifyProficiencyId('longsword', compendium)).toBe('weapon');
      expect(classifyProficiencyId('chain-mail', compendium)).toBe('armor');
      expect(classifyProficiencyId('heavy-armor', compendium)).toBe('armor');
      expect(classifyProficiencyId('unknown-thing', compendium)).toBeUndefined();

      const id = getDuplicateReplacementChoiceId('skill', 'insight');
      expect(id).toBe('replace:skill:insight');
      expect(parseDuplicateReplacementChoiceId(id)).toEqual({
        category: 'skill',
        proficiencyId: 'insight',
      });
      expect(parseDuplicateReplacementChoiceId('not-a-replacement')).toBeUndefined();
    });
  });
});
