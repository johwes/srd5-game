import { createCompendium } from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  CharacterBuildStateSchema,
  DerivedCharacterSheetSchema,
  MAX_CHARACTER_LEVEL,
  XP_THRESHOLDS_BY_LEVEL,
  applyClassEntryLevelUp,
  applyLevelUp,
  awardCharacterXp,
  canLevelUpByXp,
  checkMulticlassEligibility,
  computeDerivedCharacter,
  computeMulticlassSpellSlots,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultSpellcastingSelection,
  getCharacterLevelForXp,
  getFixedHpRollForHitDie,
  getLevelUpRequirements,
  getMaxSpellLevelForClassAtLevel,
  getXpProgress,
  getXpThresholdForLevel,
  rollLevelUpHitDie,
  tryApplyLevelUp,
  validateLevelUp,
} from '../index.js';

const compendium = createCompendium();

function createBaseLevel1Fighter(
  overrides?: Partial<CharacterBuildState>,
): CharacterBuildState {
  return {
    id: 'char-fighter-1',
    version: 1,
    name: 'Kaelen the Bold',
    portraitId: 'portrait-fighter',
    tokenSpriteId: 'token-fighter',
    alignment: 'lawful_good',
    raceId: 'human',
    racialChoices: {
      'human-extra-language': ['dwarvish'],
    },
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['elvish', 'celestial'],
    },
    abilityMethod: 'standard_array',
    baseAbilities: {
      str: 15, // +1 human = 16 (+3)
      dex: 13, // +1 human = 14 (+2)
      con: 14, // +1 human = 15 (+2)
      int: 10, // +1 human = 11 (+0)
      wis: 12, // +1 human = 13 (+1)
      cha: 8, // +1 human = 9 (-1)
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
    runtime: createDefaultCharacterRuntimeState({
      xp: 0,
      currentHp: 12, // 10 + 2 CON
    }),
    ...overrides,
  };
}

describe('SRD-205: Level-Up Progression Engine (Levels 1–20, Subclasses, ASI/Feat, Multiclass Spell Slots)', () => {
  describe('1. XP Thresholds & Level Eligibility (Levels 1–20)', () => {
    it('matches the exact SRD 5.1 XP threshold table across levels 1 to 20', () => {
      expect(XP_THRESHOLDS_BY_LEVEL[1]).toBe(0);
      expect(XP_THRESHOLDS_BY_LEVEL[2]).toBe(300);
      expect(XP_THRESHOLDS_BY_LEVEL[3]).toBe(900);
      expect(XP_THRESHOLDS_BY_LEVEL[4]).toBe(2700);
      expect(XP_THRESHOLDS_BY_LEVEL[5]).toBe(6500);
      expect(XP_THRESHOLDS_BY_LEVEL[10]).toBe(64000);
      expect(XP_THRESHOLDS_BY_LEVEL[15]).toBe(165000);
      expect(XP_THRESHOLDS_BY_LEVEL[20]).toBe(355000);

      expect(getXpThresholdForLevel(1)).toBe(0);
      expect(getXpThresholdForLevel(5)).toBe(6500);
      expect(getXpThresholdForLevel(20)).toBe(355000);
      expect(getCharacterLevelForXp(0)).toBe(1);
      expect(getCharacterLevelForXp(299)).toBe(1);
      expect(getCharacterLevelForXp(300)).toBe(2);
      expect(getCharacterLevelForXp(899)).toBe(2);
      expect(getCharacterLevelForXp(900)).toBe(3);
      expect(getCharacterLevelForXp(355000)).toBe(20);
      expect(getCharacterLevelForXp(999999)).toBe(20);
    });

    it('tracks XP progress, awards XP, and enforces XP requirements when requested', () => {
      const state = createBaseLevel1Fighter();
      const initialProgress = getXpProgress(state);
      expect(initialProgress).toEqual({
        totalLevel: 1,
        currentXp: 0,
        currentLevelFloorXp: 0,
        nextLevelThresholdXp: 300,
        xpToNextLevel: 300,
        eligibleLevelForXp: 1,
        canLevelUp: false,
        maxLevelReached: false,
      });

      // When enforceXpRequirement is true, leveling up at 0 XP is rejected
      const blockedValidation = validateLevelUp(
        state,
        {
          hpMethod: 'fixed',
          enforceXpRequirement: true,
        },
        compendium,
      );
      expect(blockedValidation.valid).toBe(false);
      expect(blockedValidation.errors[0]).toMatch(/insufficient xp/i);

      // Award 1000 XP (unlocks Level 2 and Level 3)
      const awarded = awardCharacterXp(state, 1000);
      expect(awarded.previousXp).toBe(0);
      expect(awarded.newXp).toBe(1000);
      expect(awarded.eligibleLevelForXp).toBe(3);
      expect(awarded.canLevelUp).toBe(true);
      expect(awarded.levelsAvailableToGain).toBe(2);
      expect(canLevelUpByXp(1, 1000)).toBe(true);
      expect(canLevelUpByXp(20, 500000)).toBe(false);

      const allowedValidation = validateLevelUp(
        awarded.state,
        {
          hpMethod: 'fixed',
          enforceXpRequirement: true,
        },
        compendium,
      );
      expect(allowedValidation.valid).toBe(true);
    });
  });

  describe('2. Hit Point (HP) Gain Modes & Retroactive CON Modifier Scaling', () => {
    it('computes fixed average Hit Die values (d6=4, d8=5, d10=6, d12=7) and deterministic seeded PRNG rolls', () => {
      expect(getFixedHpRollForHitDie(6)).toBe(4);
      expect(getFixedHpRollForHitDie(8)).toBe(5);
      expect(getFixedHpRollForHitDie(10)).toBe(6);
      expect(getFixedHpRollForHitDie(12)).toBe(7);

      const r1 = rollLevelUpHitDie(10, 42);
      const r2 = rollLevelUpHitDie(10, 42);
      expect(r1).toEqual(r2);
      expect(r1.roll).toBeGreaterThanOrEqual(1);
      expect(r1.roll).toBeLessThanOrEqual(10);

      const state = createBaseLevel1Fighter();
      const missingSeed = validateLevelUp(state, { hpMethod: 'roll' }, compendium);
      expect(missingSeed.valid).toBe(false);
      expect(missingSeed.errors[0]).toMatch(/requires a finite seeded 'rngState'/i);

      const outOfBoundsManual = validateLevelUp(
        state,
        { hpMethod: 'manual', hpRoll: 11 },
        compendium,
      );
      expect(outOfBoundsManual.valid).toBe(false);
      expect(outOfBoundsManual.errors[0]).toMatch(/between 1 and 10/i);

      const rolledLvl2 = applyLevelUp(
        state,
        { hpMethod: 'roll', rngState: 42 },
        compendium,
      );
      expect(rolledLvl2.summary.hpRoll).toBe(r1.roll);
      expect(rolledLvl2.nextRngState).toBe(r1.nextRngState);
      expect(rolledLvl2.sheet.maxHp).toBe(12 + r1.roll + 2);
      expect(rolledLvl2.state.runtime.currentHp).toBe(12 + r1.roll + 2);
    });

    it('retroactively increases Max HP and Current HP across all levels when an ASI increases CON modifier', () => {
      // Base Fighter: CON is 14 + 1 (Human) = 15 (+2 mod).
      // Advance to Level 3 first:
      let state = createBaseLevel1Fighter();
      state = applyLevelUp(state, { hpMethod: 'fixed' }, compendium).state; // L2: 12 + (6+2) = 20 HP
      state = applyLevelUp(
        state,
        { hpMethod: 'fixed', subclassId: 'champion' },
        compendium,
      ).state; // L3: 20 + (6+2) = 28 HP

      // Simulate taking 5 damage before leveling to L4 (currentHp = 23 / 28)
      state = {
        ...state,
        runtime: {
          ...state.runtime,
          currentHp: 23,
        },
      };

      // At Level 4, apply ASI +1 CON (15 -> 16, mod +2 -> +3) and +1 STR (16 -> 17)
      // New Max HP at L4 with CON +3:
      // L1: 10 + 3 = 13; L2: 6 + 3 = 9; L3: 6 + 3 = 9; L4: 6 + 3 = 9 -> Total 40 Max HP!
      // Net Max HP gain = 40 - 28 = +12 HP (6 base roll + 3 L4 CON mod + 3 retroactive HP for L1..L3).
      const lvl4Res = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { con: 1, str: 1 } },
        },
        compendium,
      );

      expect(lvl4Res.sheet.abilities.con.score).toBe(16);
      expect(lvl4Res.sheet.abilities.con.modifier).toBe(3);
      expect(lvl4Res.summary.previousMaxHp).toBe(28);
      expect(lvl4Res.summary.newMaxHp).toBe(40);
      expect(lvl4Res.summary.hpGained).toBe(12);
      expect(lvl4Res.state.runtime.currentHp).toBe(23 + 12); // 35 / 40
      expect(lvl4Res.sheet.currentHp).toBe(35);
    });
  });

  describe('3. Full Single-Class Progression L1 -> L20 (Fighter, Subclass, 7 ASIs/Feats, Extra Attack)', () => {
    it('advances a Fighter from Level 1 to Level 20, validating subclass unlock, Feats, ASIs, Champion Additional Fighting Style, and L20 cap', () => {
      let state = createBaseLevel1Fighter();

      // Level 2: Action Surge unlocked; providing a subclass early at L2 is rejected
      const prematureSubclass = tryApplyLevelUp(
        state,
        { hpMethod: 'fixed', subclassId: 'champion' },
        compendium,
      );
      expect(prematureSubclass.ok).toBe(false);
      if (!prematureSubclass.ok) {
        expect(prematureSubclass.validation.errors[0]).toMatch(/does not unlock/i);
      }

      const l2 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l2.state;
      expect(l2.sheet.totalLevel).toBe(2);
      expect(l2.summary.unlockedFeatureIds).toContain('action-surge');

      // Level 3: Requires Martial Archetype (Champion)
      const l3Reqs = getLevelUpRequirements(state, 'fighter', compendium);
      expect(l3Reqs.subclassUnlock.required).toBe(true);
      expect(l3Reqs.subclassUnlock.availableSubclasses.map((s) => s.id)).toEqual([
        'champion',
      ]);

      const missingSubclassAtL3 = tryApplyLevelUp(
        state,
        { hpMethod: 'fixed' },
        compendium,
      );
      expect(missingSubclassAtL3.ok).toBe(false);

      const l3 = applyLevelUp(
        state,
        { hpMethod: 'fixed', subclassId: 'champion' },
        compendium,
      );
      state = l3.state;
      expect(l3.summary.subclassUnlockedId).toBe('champion');
      expect(l3.summary.unlockedFeatureIds).toContain('improved-critical');
      expect(l3.sheet.weaponAttacks[0]?.critRange).toBe(19);

      // Level 4: ASI/Feat required -> Pick 'grappler' Feat (requires STR 13+, character has STR 16)
      const l4Reqs = getLevelUpRequirements(state, 'fighter', compendium);
      expect(l4Reqs.requiresAsiOrFeat).toBe(true);
      expect(l4Reqs.availableFeats.find((f) => f.feat.id === 'grappler')?.eligible).toBe(
        true,
      );

      const l4 = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'feat', featId: 'grappler' },
        },
        compendium,
      );
      state = l4.state;
      expect(l4.summary.unlockedFeatId).toBe('grappler');
      expect(l4.sheet.featIds).toContain('grappler');

      // Level 5: Proficiency Bonus +3, Extra Attack (2 attacks per action)
      const l5 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l5.state;
      expect(l5.summary.previousProficiencyBonus).toBe(2);
      expect(l5.summary.newProficiencyBonus).toBe(3);
      expect(l5.sheet.attacksPerAction).toBe(2);

      // Level 6 (Fighter bonus ASI): Selecting 'grappler' a second time is rejected; apply +2 STR (16 -> 18)
      const duplicateFeatAttempt = tryApplyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'feat', featId: 'grappler' },
        },
        compendium,
      );
      expect(duplicateFeatAttempt.ok).toBe(false);

      const l6 = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { str: 2 } },
        },
        compendium,
      );
      state = l6.state;
      expect(l6.sheet.abilities.str.score).toBe(18);

      // Level 7: Champion Remarkable Athlete
      state = applyLevelUp(state, { hpMethod: 'fixed' }, compendium).state;

      // Level 8 (ASI): +2 STR (18 -> 20)
      const l8 = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { str: 2 } },
        },
        compendium,
      );
      state = l8.state;
      expect(l8.sheet.abilities.str.score).toBe(20);

      // Level 9: Indomitable, Proficiency Bonus +4
      state = applyLevelUp(state, { hpMethod: 'fixed' }, compendium).state;

      // Level 10: Champion Additional Fighting Style (must pick a style other than 'defense')
      const l10Reqs = getLevelUpRequirements(state, 'fighter', compendium);
      expect(l10Reqs.featureChoices.map((c) => c.id)).toContain(
        'champion-additional-fighting-style',
      );

      // Picking 'defense' again is rejected
      const dupStyleAttempt = tryApplyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          choiceSelections: {
            'champion-additional-fighting-style': ['defense'],
          },
        },
        compendium,
      );
      expect(dupStyleAttempt.ok).toBe(false);

      const l10 = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          choiceSelections: {
            'champion-additional-fighting-style': ['dueling'],
          },
        },
        compendium,
      );
      state = l10.state;
      expect(l10.sheet.featureIds).toContain('fighting-style-defense');
      expect(l10.sheet.featureIds).toContain('fighting-style-dueling');

      // Level 11: Extra Attack (2) -> 3 attacks per action
      const l11 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l11.state;
      expect(l11.sheet.attacksPerAction).toBe(3);

      // Level 12 (ASI): Trying to add +2 STR when STR is already 20 is rejected by cap validation
      const exceedCapAttempt = tryApplyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { str: 2 } },
        },
        compendium,
      );
      expect(exceedCapAttempt.ok).toBe(false);
      if (!exceedCapAttempt.ok) {
        expect(exceedCapAttempt.validation.errors[0]).toMatch(/above the maximum score of 20/i);
      }

      // Apply +1 CON (15 -> 16), +1 WIS (13 -> 14) at L12
      state = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { con: 1, wis: 1 } },
        },
        compendium,
      ).state;

      // Level 13 (Prof +5)
      state = applyLevelUp(state, { hpMethod: 'fixed' }, compendium).state;
      // Level 14 (Fighter bonus ASI): +2 CON (16 -> 18)
      state = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { con: 2 } },
        },
        compendium,
      ).state;
      // Level 15 (Champion Superior Critical -> critRange 18)
      const l15 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l15.state;
      expect(l15.sheet.weaponAttacks[0]?.critRange).toBe(18);

      // Level 16 (ASI): +2 CON (18 -> 20)
      state = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { con: 2 } },
        },
        compendium,
      ).state;
      // Level 17 (Action Surge 2 uses, Prof +6)
      const l17 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l17.state;
      expect(l17.sheet.proficiencyBonus).toBe(6);
      expect(l17.sheet.resources['action_surge']?.max).toBe(2);

      // Level 18 (Champion Survivor)
      state = applyLevelUp(state, { hpMethod: 'fixed' }, compendium).state;
      // Level 19 (ASI): +2 DEX (14 -> 16)
      state = applyLevelUp(
        state,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { dex: 2 } },
        },
        compendium,
      ).state;
      // Level 20 (Extra Attack 3 -> 4 attacks per action)
      const l20 = applyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      state = l20.state;

      CharacterBuildStateSchema.parse(state);
      DerivedCharacterSheetSchema.parse(l20.sheet);
      expect(l20.sheet.totalLevel).toBe(MAX_CHARACTER_LEVEL);
      expect(l20.sheet.attacksPerAction).toBe(4);
      expect(l20.sheet.abilities.str.score).toBe(20);
      expect(l20.sheet.abilities.con.score).toBe(20);
      expect(l20.sheet.maxHp).toBe(10 + 19 * 6 + 20 * 5); // 224 HP

      // Attempting to level up past Level 20 is rejected
      const past20 = tryApplyLevelUp(state, { hpMethod: 'fixed' }, compendium);
      expect(past20.ok).toBe(false);
      if (!past20.ok) {
        expect(past20.validation.errors[0]).toMatch(/maximum level 20/i);
      }
    });
  });

  describe('4. Spellcaster Progression (Wizard Spellbook, Known Casters, Subclass Spells, Warlock Pact Magic & Invocations)', () => {
    it('handles Wizard L1 -> L5 progression (Evocation subclass at L2, 2 spellbook spells per level, cantrip scaling at L4, L3 spell slots at L5)', () => {
      let wizardState = createBaseLevel1Fighter({
        name: 'Lyra Starweaver',
        baseAbilities: {
          str: 8,
          dex: 14,
          con: 13,
          int: 15, // +1 human = 16 (+3)
          wis: 12,
          cha: 10,
        },
        classes: [
          {
            classId: 'wizard',
            level: 1,
            hpRollsByLevel: [6],
            choiceSelectionsByLevel: {
              1: { 'wizard-skills': ['arcana', 'history'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
        spellcasting: createDefaultSpellcastingSelection({
          knownCantripIds: ['fire-bolt', 'mage-hand', 'prestidigitation'],
          spellbookSpellIds: [
            'magic-missile',
            'shield',
            'mage-armor',
            'detect-magic',
            'sleep',
            'burning-hands',
          ],
          preparedSpellIds: ['magic-missile', 'shield', 'mage-armor', 'burning-hands'],
        }),
        runtime: createDefaultCharacterRuntimeState({ currentHp: 8 }),
      });

      // Level 2 Wizard: Requires Arcane Tradition ('evocation'), allows 2 new L1 spells in spellbook
      const l2Reqs = getLevelUpRequirements(wizardState, 'wizard', compendium);
      expect(l2Reqs.subclassUnlock.required).toBe(true);
      expect(l2Reqs.spellcasting.newSpellbookSpellsAllowed).toBe(2);
      expect(l2Reqs.spellcasting.maxLearnableSpellLevel).toBe(1);

      // Adding a 2nd-level spell ('misty-step') at Wizard L2 is rejected
      const invalidL2Spell = tryApplyLevelUp(
        wizardState,
        {
          hpMethod: 'fixed',
          subclassId: 'evocation',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['misty-step', 'identify'],
          },
        },
        compendium,
      );
      expect(invalidL2Spell.ok).toBe(false);

      const l2 = applyLevelUp(
        wizardState,
        {
          hpMethod: 'fixed',
          subclassId: 'evocation',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['identify', 'thunderwave'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      wizardState = l2.state;
      expect(l2.summary.subclassUnlockedId).toBe('evocation');
      expect(l2.summary.addedSpellbookSpellIds).toEqual(['identify', 'thunderwave']);
      expect(l2.sheet.spellcasting.spellSlots[1].max).toBe(3);

      // Level 3 Wizard: Unlocks 2nd-level spell slots (4 L1, 2 L2) -> can add 'misty-step' and 'scorching-ray'
      const l3 = applyLevelUp(
        wizardState,
        {
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['misty-step', 'scorching-ray'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      wizardState = l3.state;
      expect(l3.sheet.spellcasting.spellSlots[2].max).toBe(2);

      // Level 4 Wizard: Unlocks 1 new cantrip (3 -> 4), ASI (+2 INT -> 18), and 2 spellbook spells
      const l4Reqs = getLevelUpRequirements(wizardState, 'wizard', compendium);
      expect(l4Reqs.spellcasting.newCantripsRequired).toBe(1);
      expect(l4Reqs.requiresAsiOrFeat).toBe(true);

      const l4 = applyLevelUp(
        wizardState,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { int: 2 } },
          spellcastingUpdates: {
            addedCantripIds: ['light'],
            addedSpellbookSpellIds: ['mirror-image', 'web'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      wizardState = l4.state;
      expect(l4.sheet.abilities.int.score).toBe(18);
      expect(l4.sheet.spellcasting.primarySpellSaveDc).toBe(8 + 2 + 4); // 14

      // Level 5 Wizard: Unlocks 3rd-level spell slots (4/3/2) & Prof +3 -> DC becomes 8 + 3 + 4 = 15
      const l5 = applyLevelUp(
        wizardState,
        {
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['fireball', 'counterspell'],
            preparedSpellIds: [
              'magic-missile',
              'shield',
              'mage-armor',
              'misty-step',
              'scorching-ray',
              'web',
              'fireball',
              'counterspell',
              'detect-magic',
            ],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      expect(l5.sheet.spellcasting.spellSlots[3].max).toBe(2);
      expect(l5.sheet.spellcasting.primarySpellSaveDc).toBe(15);
      expect(l5.sheet.spellcasting.spellbookSpellIds).toContain('fireball');
      expect(l5.sheet.spellcasting.spellbookSpellIds).toContain('counterspell');
    });

    it('handles Known Casters (Warlock Fiend Patron expanded spell list, spell swapping, Pact Boon, and L5 Invocation scaling)', () => {
      let warlockState = createBaseLevel1Fighter({
        name: 'Malakor',
        baseAbilities: {
          str: 8,
          dex: 14,
          con: 14,
          int: 10,
          wis: 12,
          cha: 15, // +1 human = 16 (+3)
        },
        classes: [
          {
            classId: 'warlock',
            subclassId: 'fiend',
            level: 1,
            hpRollsByLevel: [8],
            choiceSelectionsByLevel: {
              1: { 'warlock-skills': ['arcana', 'deception'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
        spellcasting: createDefaultSpellcastingSelection({
          knownCantripIds: ['eldritch-blast', 'minor-illusion'],
          knownSpellIds: ['hex', 'burning-hands'], // burning-hands is from Fiend expanded list
        }),
        runtime: createDefaultCharacterRuntimeState({ currentHp: 10 }),
      });

      // Level 2 Warlock: Requires 2 Eldritch Invocations, 1 new known spell, and Pact Slots increase 1 -> 2
      const l2Reqs = getLevelUpRequirements(warlockState, 'warlock', compendium);
      expect(l2Reqs.featureChoices.map((c) => c.id)).toContain('warlock-invocations');
      expect(l2Reqs.spellcasting.newSpellsKnownRequired).toBe(1);
      expect(l2Reqs.spellcasting.canSwapKnownSpell).toBe(true);

      const l2 = applyLevelUp(
        warlockState,
        {
          hpMethod: 'fixed',
          choiceSelections: {
            'warlock-invocations': ['agonizing-blast', 'devils-sight'],
          },
          spellcastingUpdates: {
            addedKnownSpellIds: ['hellish-rebuke'],
            replaceKnownSpell: {
              removeSpellId: 'burning-hands',
              addSpellId: 'command', // also on Fiend expanded spell list
            },
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      warlockState = l2.state;
      expect(l2.sheet.spellcasting.pactMagic?.maxSlots).toBe(2);
      expect(l2.sheet.spellcasting.pactMagic?.slotLevel).toBe(1);
      expect(l2.sheet.senses.darkvisionFeet).toBe(120);
      expect(warlockState.spellcasting.knownSpellIds).toEqual([
        'hex',
        'command',
        'hellish-rebuke',
      ]);

      // Level 3 Warlock: Requires Pact Boon ('pact-of-the-tome') and Pact Slot Level becomes 2
      const l3 = applyLevelUp(
        warlockState,
        {
          hpMethod: 'fixed',
          choiceSelections: {
            'warlock-pact-boon': ['pact-of-the-tome'],
          },
          spellcastingUpdates: {
            addedKnownSpellIds: ['scorching-ray'], // Fiend L3 expanded spell
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      warlockState = l3.state;
      expect(l3.sheet.spellcasting.pactMagic?.slotLevel).toBe(2);
      expect(l3.sheet.featureIds).toContain('pact-of-the-tome');

      // Level 4 Warlock: ASI (+2 CHA) + 1 new cantrip + 1 new spell
      warlockState = applyLevelUp(
        warlockState,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { cha: 2 } },
          spellcastingUpdates: {
            addedCantripIds: ['mage-hand'],
            addedSpellbookSpellIds: [],
            addedKnownSpellIds: ['hold-person'],
          },
          requireSpellSelections: true,
        },
        compendium,
      ).state;

      // Level 5 Warlock: Pact Slot Level becomes 3, unlocks 1 additional Eldritch Invocation (total 3), and can learn 'fireball' (Fiend L5 expanded spell)
      const l5Reqs = getLevelUpRequirements(warlockState, 'warlock', compendium);
      expect(l5Reqs.featureChoices.map((c) => c.id)).toContain('warlock-invocations');
      expect(l5Reqs.spellcasting.allowedSpellIds).toContain('fireball');

      const l5 = applyLevelUp(
        warlockState,
        {
          hpMethod: 'fixed',
          choiceSelections: {
            'warlock-invocations': ['repelling-blast'],
          },
          spellcastingUpdates: {
            addedKnownSpellIds: ['fireball'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      expect(l5.sheet.spellcasting.pactMagic?.slotLevel).toBe(3);
      expect(l5.sheet.featureIds).toContain('agonizing-blast');
      expect(l5.sheet.featureIds).toContain('devils-sight');
      expect(l5.sheet.featureIds).toContain('repelling-blast');
      expect(l5.sheet.spellcasting.preparedOrKnownSpellIds).toContain('fireball');
    });

    it('supports College of Lore Bard L3 Bonus Skills (with duplicate replacement) and L6 Additional Magical Secrets (any-class spells)', () => {
      let bardState = createBaseLevel1Fighter({
        name: 'Tariel Songweaver',
        baseAbilities: {
          str: 8,
          dex: 14,
          con: 13,
          int: 12,
          wis: 10,
          cha: 15,
        },
        classes: [
          {
            classId: 'bard',
            level: 2,
            hpRollsByLevel: [8, 5],
            choiceSelectionsByLevel: {
              1: {
                'bard-skills': ['persuasion', 'performance', 'deception'],
                'bard-musical-instruments': ['lute', 'flute', 'lyre'],
              },
            },
            asiOrFeatByLevel: {},
          },
        ],
        spellcasting: createDefaultSpellcastingSelection({
          knownCantripIds: ['vicious-mockery', 'minor-illusion'],
          knownSpellIds: [
            'healing-word',
            'faerie-fire',
            'thunderwave',
            'sleep',
            'charm-person',
          ],
        }),
        runtime: createDefaultCharacterRuntimeState({ currentHp: 17 }),
      });

      // Level 3 Bard: Unlocks College of Lore (3 bonus skills) AND Bard Expertise (2 proficient skills)
      const l3 = applyLevelUp(
        bardState,
        {
          hpMethod: 'fixed',
          subclassId: 'lore',
          choiceSelections: {
            'lore-bonus-skills': ['arcana', 'stealth', 'acrobatics'],
            'expertise-bard': ['persuasion', 'deception'],
          },
          spellcastingUpdates: {
            addedKnownSpellIds: ['hold-person'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      bardState = l3.state;
      expect(l3.sheet.proficiencies.expertise).toEqual(['persuasion', 'deception']);
      expect(l3.sheet.proficiencies.skills).toContain('arcana');

      // Advance through L4 and L5
      bardState = applyLevelUp(
        bardState,
        {
          hpMethod: 'fixed',
          asiOrFeat: { type: 'asi', bonuses: { cha: 2 } },
          spellcastingUpdates: {
            addedCantripIds: ['mage-hand'],
            addedKnownSpellIds: ['invisibility'],
          },
        },
        compendium,
      ).state;
      bardState = applyLevelUp(
        bardState,
        {
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedKnownSpellIds: ['hypnotic-pattern'],
          },
        },
        compendium,
      ).state;

      // Level 6 Lore Bard: 1 normal Bard spell + 2 Additional Magical Secrets from ANY class (e.g. 'fireball' and 'counterspell')
      const l6Reqs = getLevelUpRequirements(bardState, 'bard', compendium);
      expect(l6Reqs.spellcasting.newSpellsKnownRequired).toBe(3);
      expect(l6Reqs.spellcasting.allowsAnyClassSpellsCount).toBe(2);

      const l6 = applyLevelUp(
        bardState,
        {
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedKnownSpellIds: ['dispel-magic', 'fireball', 'counterspell'],
          },
          requireSpellSelections: true,
        },
        compendium,
      );
      expect(l6.sheet.spellcasting.preparedOrKnownSpellIds).toContain('fireball');
      expect(l6.sheet.spellcasting.preparedOrKnownSpellIds).toContain('counterspell');
    });
  });

  describe('5. Multiclassing Prerequisites, Secondary Class Proficiencies & Multiclass Spell Slots', () => {
    it('enforces SRD 5.1 multiclass ability score prerequisites for both current and target classes', () => {
      // Base Fighter has STR 16, DEX 14, CON 15, INT 11, WIS 13, CHA 9 (after +1 Human to all)
      const fighter = createBaseLevel1Fighter();

      // Eligible to multiclass into Cleric (WIS 13 >= 13, and Fighter STR 16 >= 13)
      const clericElig = checkMulticlassEligibility(fighter, 'cleric', compendium);
      expect(clericElig.eligible).toBe(true);

      // Eligible to multiclass into Rogue (DEX 14 >= 13)
      const rogueElig = checkMulticlassEligibility(fighter, 'rogue', compendium);
      expect(rogueElig.eligible).toBe(true);

      // Eligible to multiclass into Monk (DEX 14 >= 13 AND WIS 13 >= 13)
      const monkElig = checkMulticlassEligibility(fighter, 'monk', compendium);
      expect(monkElig.eligible).toBe(true);

      // Ineligible to multiclass into Wizard (INT 11 < 13) or Paladin (CHA 9 < 13)
      const wizardElig = checkMulticlassEligibility(fighter, 'wizard', compendium);
      expect(wizardElig.eligible).toBe(false);
      expect(wizardElig.unmetPrerequisites[0]).toMatch(/Intelligence 13/i);

      const paladinElig = checkMulticlassEligibility(fighter, 'paladin', compendium);
      expect(paladinElig.eligible).toBe(false);
      expect(paladinElig.unmetPrerequisites[0]).toMatch(/Strength 13 and Charisma 13/i);

      // Attempting to applyLevelUp into Wizard fails prerequisite check
      const failedWizardMulticlass = tryApplyLevelUp(
        fighter,
        { classId: 'wizard', hpMethod: 'fixed' },
        compendium,
      );
      expect(failedWizardMulticlass.ok).toBe(false);

      // If current class prerequisite is not met (e.g. a Paladin with STR 10 trying to multiclass into Sorcerer), it is also blocked
      const lowStrPaladin = createBaseLevel1Fighter({
        baseAbilities: {
          str: 9, // +1 human = 10 (< 13 required to multiclass out of Paladin)
          dex: 12,
          con: 14,
          int: 10,
          wis: 12,
          cha: 15, // +1 human = 16
        },
        classes: [
          {
            classId: 'paladin',
            level: 1,
            hpRollsByLevel: [10],
            choiceSelectionsByLevel: {
              1: { 'paladin-skills': ['athletics', 'persuasion'] },
            },
            asiOrFeatByLevel: {},
          },
        ],
      });
      const paladinOutCheck = checkMulticlassEligibility(
        lowStrPaladin,
        'sorcerer',
        compendium,
      );
      expect(paladinOutCheck.eligible).toBe(false);
      expect(paladinOutCheck.unmetPrerequisites[0]).toMatch(/paladin.*Strength 13/i);

      // Advancing in the same class (Paladin L1 -> L2) is still allowed even with STR 10!
      const paladinSameClassCheck = checkMulticlassEligibility(
        lowStrPaladin,
        'paladin',
        compendium,
      );
      expect(paladinSameClassCheck.eligible).toBe(true);
    });

    it('supports multiclassing into Rogue at Level 2 (1 multiclass skill + Expertise) and Cleric at Level 3', () => {
      const fighter1 = createBaseLevel1Fighter();

      // Multiclass into Rogue 1 (Total Level 2)
      const rogueReqs = getLevelUpRequirements(fighter1, 'rogue', compendium);
      expect(rogueReqs.isNewMulticlass).toBe(true);
      expect(rogueReqs.hitDie).toBe(8);
      expect(rogueReqs.fixedHpRoll).toBe(5);
      expect(rogueReqs.requiresExpertise).toBe(true);

      const fighter1Rogue1 = applyLevelUp(
        fighter1,
        {
          classId: 'rogue',
          hpMethod: 'fixed',
          choiceSelections: {
            'rogue-skills': ['stealth'],
            'expertise-rogue': ['stealth', 'athletics'],
          },
        },
        compendium,
      );

      expect(fighter1Rogue1.sheet.totalLevel).toBe(2);
      expect(fighter1Rogue1.sheet.classes).toHaveLength(2);
      expect(fighter1Rogue1.sheet.proficiencies.skills).toContain('stealth');
      expect(fighter1Rogue1.sheet.proficiencies.expertise).toEqual([
        'stealth',
        'athletics',
      ]);
      // Saving throw proficiencies remain Fighter's (STR, CON) and do NOT include Rogue's (DEX, INT)
      expect(fighter1Rogue1.sheet.proficiencies.savingThrows).toEqual(['str', 'con']);
    });

    it('computes SRD 5.1 Multiclass Spell Slots and enforces per-class individual spell learning caps', () => {
      // 1. Single Half-Caster + Non-Caster (Paladin 3 / Fighter 2) -> uses Paladin L3 table (3 L1 slots), NOT Multiclass table
      const pal3Fighter2 = computeMulticlassSpellSlots(
        [
          { classId: 'paladin', level: 3 },
          { classId: 'fighter', level: 2 },
        ],
        compendium,
      );
      expect(pal3Fighter2.isMulticlassSpellcaster).toBe(false);
      expect(pal3Fighter2.spellSlots[1]).toBe(3);
      expect(pal3Fighter2.spellSlots[2]).toBe(0);

      // 2. Full Caster + Full Caster (Cleric 3 / Wizard 2) -> Effective Caster Level 5 (4 L1, 3 L2, 2 L3 slots)
      // Individual max spell level: Cleric 3 -> L2, Wizard 2 -> L1
      const cleric3Wizard2 = computeMulticlassSpellSlots(
        [
          { classId: 'cleric', level: 3 },
          { classId: 'wizard', level: 2 },
        ],
        compendium,
      );
      expect(cleric3Wizard2.isMulticlassSpellcaster).toBe(true);
      expect(cleric3Wizard2.effectiveCasterLevel).toBe(5);
      expect(cleric3Wizard2.spellSlots[1]).toBe(4);
      expect(cleric3Wizard2.spellSlots[2]).toBe(3);
      expect(cleric3Wizard2.spellSlots[3]).toBe(2);
      expect(cleric3Wizard2.maxIndividuallyCastableSlotLevelByClass).toEqual({
        cleric: 2,
        wizard: 1,
      });

      // Verify that when Cleric 3 / Wizard 1 levels up Wizard to L2, they get 3rd-level multiclass spell slots,
      // but can only add 1st-level Wizard spells to their spellbook (NOT 3rd-level 'fireball')!
      const cleric3Wizard1State = createBaseLevel1Fighter({
        baseAbilities: {
          str: 10,
          dex: 12,
          con: 13,
          int: 15, // +1 human = 16
          wis: 14, // +1 human = 15
          cha: 8,
        },
        classes: [
          {
            classId: 'cleric',
            subclassId: 'life',
            level: 3,
            hpRollsByLevel: [8, 5, 5],
            choiceSelectionsByLevel: {
              1: { 'cleric-skills': ['history', 'medicine'] },
            },
            asiOrFeatByLevel: {},
          },
          {
            classId: 'wizard',
            level: 1,
            hpRollsByLevel: [4],
            choiceSelectionsByLevel: {},
            asiOrFeatByLevel: {},
          },
        ],
        spellcasting: createDefaultSpellcastingSelection({
          knownCantripIds: ['sacred-flame', 'guidance', 'light', 'fire-bolt', 'mage-hand', 'prestidigitation'],
          spellbookSpellIds: ['magic-missile', 'shield', 'mage-armor', 'sleep', 'detect-magic', 'identify'],
          preparedSpellIds: ['cure-wounds', 'bless', 'magic-missile', 'shield'],
        }),
      });

      // Trying to add 'fireball' (L3) when advancing Wizard from L1 -> L2 is rejected even though total Effective Caster Level is 5
      const invalidMulticlassWizardSpell = tryApplyLevelUp(
        cleric3Wizard1State,
        {
          classId: 'wizard',
          subclassId: 'evocation',
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['fireball', 'burning-hands'],
          },
        },
        compendium,
      );
      expect(invalidMulticlassWizardSpell.ok).toBe(false);
      if (!invalidMulticlassWizardSpell.ok) {
        expect(invalidMulticlassWizardSpell.validation.errors[0]).toMatch(
          /exceeds the maximum spell level \(1\)/i,
        );
      }

      // Adding two 1st-level Wizard spells succeeds and grants 4/3/2 multiclass spell slots
      const validMulticlassWizard = applyLevelUp(
        cleric3Wizard1State,
        {
          classId: 'wizard',
          subclassId: 'evocation',
          hpMethod: 'fixed',
          spellcastingUpdates: {
            addedSpellbookSpellIds: ['burning-hands', 'thunderwave'],
          },
        },
        compendium,
      );
      expect(validMulticlassWizard.sheet.spellcasting.effectiveCasterLevel).toBe(5);
      expect(validMulticlassWizard.sheet.spellcasting.spellSlots[1].max).toBe(4);
      expect(validMulticlassWizard.sheet.spellcasting.spellSlots[2].max).toBe(3);
      expect(validMulticlassWizard.sheet.spellcasting.spellSlots[3].max).toBe(2);

      // 3. Half Caster + Half Caster + Pact Magic (Paladin 5 / Ranger 4 / Warlock 3)
      // Effective Caster Level = floor(5/2) + floor(4/2) = 2 + 2 = 4 (4 L1, 3 L2 slots) + 2 L2 Pact Magic slots
      const pal5Ran4War3 = computeMulticlassSpellSlots(
        [
          { classId: 'paladin', level: 5 },
          { classId: 'ranger', level: 4 },
          { classId: 'warlock', level: 3 },
        ],
        compendium,
      );
      expect(pal5Ran4War3.effectiveCasterLevel).toBe(4);
      expect(pal5Ran4War3.spellSlots[1]).toBe(4);
      expect(pal5Ran4War3.spellSlots[2]).toBe(3);
      expect(pal5Ran4War3.spellSlots[3]).toBe(0);
      expect(pal5Ran4War3.pactMagic).toEqual({
        slotLevel: 2,
        maxSlots: 2,
      });
      expect(
        getMaxSpellLevelForClassAtLevel(compendium.requireClass('warlock'), 11, {
          includeMysticArcanum: true,
        }),
      ).toBe(6);
    });
  });

  describe('6. Direct LEVEL_UP_CHARACTER Transport Command Helper (applyClassEntryLevelUp)', () => {
    it('applies a valid CharacterClassEntry update and rejects level skipping or mutated historical HP rolls', () => {
      const state = createBaseLevel1Fighter();

      // Skipping from L1 -> L3 directly is rejected
      expect(() =>
        applyClassEntryLevelUp(
          state,
          {
            ...state.classes[0]!,
            level: 3,
            subclassId: 'champion',
            hpRollsByLevel: [10, 6, 6],
          },
          compendium,
        ),
      ).toThrow(/expected level 2, got 3/i);

      // Mutating L1 HP roll from 10 to 8 is rejected
      expect(() =>
        applyClassEntryLevelUp(
          state,
          {
            ...state.classes[0]!,
            level: 2,
            hpRollsByLevel: [8, 6],
          },
          compendium,
        ),
      ).toThrow(/cannot alter previous HP roll/i);

      // Valid L1 -> L2 update
      const updated = applyClassEntryLevelUp(
        state,
        {
          ...state.classes[0]!,
          level: 2,
          hpRollsByLevel: [10, 8],
        },
        compendium,
      );
      expect(updated.sheet.totalLevel).toBe(2);
      expect(updated.sheet.maxHp).toBe(12 + 8 + 2); // 22
      expect(updated.state.runtime.currentHp).toBe(22);
    });
  });
});
