import {
  ABILITY_IDS,
  type AbilityId,
  type ChoiceSpec,
  type ClassData,
  type FeatData,
  type FeatureData,
  type HitDieSize,
  type SpellLevel,
  type SpellPreparationMode,
  type SrdCompendium,
  type SubclassData,
  createCompendium,
} from '@srd5/data';
import { rollDie } from '../dice/prng.js';
import {
  resolveProficienciesAndDuplicates,
  validateCharacterChoices,
  validateChoiceSpecSelection,
} from './choices.js';
import {
  ABILITY_NAMES,
  MULTICLASS_SPELL_SLOTS_TABLE,
  computeDerivedCharacter,
  computeProficiencyBonus,
} from './derived.js';
import type {
  AsiOrFeatSelection,
  CharacterBuildState,
  CharacterClassEntry,
  DerivedCharacterSheet,
} from './schemas.js';

// ============================================================================
// 1. SRD 5.1 Experience Points (XP) & Level Thresholds (Levels 1–20)
// ============================================================================

export const MAX_CHARACTER_LEVEL = 20 as const;

/**
 * Standard SRD 5.1 Character Advancement XP Threshold Table (`docs/spec/04-dungeon-and-ai.md` Section 4.3).
 */
export const XP_THRESHOLDS_BY_LEVEL: Readonly<Record<number, number>> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

/**
 * Returns the cumulative XP required to reach `level` (`1..20`).
 */
export function getXpThresholdForLevel(level: number): number {
  const clamped = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, Math.floor(level)));
  return XP_THRESHOLDS_BY_LEVEL[clamped] ?? 0;
}

/**
 * Computes the highest character level (`1..20`) unlocked by a given cumulative XP total.
 */
export function getCharacterLevelForXp(xp: number): number {
  const safeXp = Math.max(0, Math.floor(xp));
  let eligibleLevel = 1;
  for (let lvl = 2; lvl <= MAX_CHARACTER_LEVEL; lvl++) {
    if (safeXp >= XP_THRESHOLDS_BY_LEVEL[lvl]!) {
      eligibleLevel = lvl;
    } else {
      break;
    }
  }
  return eligibleLevel;
}

/**
 * Checks whether a character at `currentTotalLevel` has enough XP to advance to `currentTotalLevel + 1`.
 */
export function canLevelUpByXp(currentTotalLevel: number, xp: number): boolean {
  if (currentTotalLevel < 1 || currentTotalLevel >= MAX_CHARACTER_LEVEL) {
    return false;
  }
  const nextThreshold = getXpThresholdForLevel(currentTotalLevel + 1);
  return xp >= nextThreshold;
}

export interface XpProgressSummary {
  totalLevel: number;
  currentXp: number;
  currentLevelFloorXp: number;
  nextLevelThresholdXp: number | null;
  xpToNextLevel: number;
  eligibleLevelForXp: number;
  canLevelUp: boolean;
  maxLevelReached: boolean;
}

/**
 * Computes a complete XP and level-up eligibility summary for a character.
 */
export function getXpProgress(
  state: Pick<CharacterBuildState, 'classes' | 'runtime'>,
): XpProgressSummary {
  const rawTotalLevel = state.classes.reduce((sum, c) => sum + c.level, 0);
  const totalLevel = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, rawTotalLevel));
  const currentXp = Math.max(0, state.runtime.xp);
  const currentLevelFloorXp = getXpThresholdForLevel(totalLevel);
  const maxLevelReached = totalLevel >= MAX_CHARACTER_LEVEL;
  const nextLevelThresholdXp = maxLevelReached
    ? null
    : getXpThresholdForLevel(totalLevel + 1);
  const xpToNextLevel =
    nextLevelThresholdXp === null ? 0 : Math.max(0, nextLevelThresholdXp - currentXp);
  const eligibleLevelForXp = getCharacterLevelForXp(currentXp);
  const canLevelUp = !maxLevelReached && currentXp >= (nextLevelThresholdXp ?? Infinity);

  return {
    totalLevel,
    currentXp,
    currentLevelFloorXp,
    nextLevelThresholdXp,
    xpToNextLevel,
    eligibleLevelForXp,
    canLevelUp,
    maxLevelReached,
  };
}

export interface AwardXpResult {
  state: CharacterBuildState;
  previousXp: number;
  newXp: number;
  xpAwarded: number;
  totalLevel: number;
  eligibleLevelForXp: number;
  canLevelUp: boolean;
  levelsAvailableToGain: number;
}

/**
 * Awards XP to a character's runtime state and computes whether one or more level-ups are unlocked.
 */
export function awardCharacterXp(
  state: CharacterBuildState,
  xpAwarded: number,
): AwardXpResult {
  const delta = Math.max(0, Math.floor(xpAwarded));
  const previousXp = state.runtime.xp;
  const newXp = previousXp + delta;
  const nextState: CharacterBuildState = {
    ...state,
    runtime: {
      ...state.runtime,
      xp: newXp,
    },
  };
  const progress = getXpProgress(nextState);
  const levelsAvailableToGain = Math.max(0, progress.eligibleLevelForXp - progress.totalLevel);

  return {
    state: nextState,
    previousXp,
    newXp,
    xpAwarded: delta,
    totalLevel: progress.totalLevel,
    eligibleLevelForXp: progress.eligibleLevelForXp,
    canLevelUp: progress.canLevelUp,
    levelsAvailableToGain,
  };
}

// ============================================================================
// 2. SRD 5.1 Multiclassing Prerequisites & Proficiencies
// ============================================================================

export interface MulticlassAbilityPrerequisite {
  abilities: readonly AbilityId[];
  minimum: number;
  /** `'all'` requires all listed abilities >= minimum; `'any'` requires at least one >= minimum (e.g. Fighter STR 13 or DEX 13). */
  mode: 'all' | 'any';
  description: string;
}

/**
 * SRD 5.1 Multiclassing Prerequisites table.
 * To qualify for a new class, a character must meet the ability score prerequisites
 * for both their current class(es) and their new one.
 */
export const MULTICLASS_ABILITY_PREREQUISITES: Readonly<
  Record<string, MulticlassAbilityPrerequisite>
> = {
  barbarian: {
    abilities: ['str'],
    minimum: 13,
    mode: 'all',
    description: 'Strength 13',
  },
  bard: {
    abilities: ['cha'],
    minimum: 13,
    mode: 'all',
    description: 'Charisma 13',
  },
  cleric: {
    abilities: ['wis'],
    minimum: 13,
    mode: 'all',
    description: 'Wisdom 13',
  },
  druid: {
    abilities: ['wis'],
    minimum: 13,
    mode: 'all',
    description: 'Wisdom 13',
  },
  fighter: {
    abilities: ['str', 'dex'],
    minimum: 13,
    mode: 'any',
    description: 'Strength 13 or Dexterity 13',
  },
  monk: {
    abilities: ['dex', 'wis'],
    minimum: 13,
    mode: 'all',
    description: 'Dexterity 13 and Wisdom 13',
  },
  paladin: {
    abilities: ['str', 'cha'],
    minimum: 13,
    mode: 'all',
    description: 'Strength 13 and Charisma 13',
  },
  ranger: {
    abilities: ['dex', 'wis'],
    minimum: 13,
    mode: 'all',
    description: 'Dexterity 13 and Wisdom 13',
  },
  rogue: {
    abilities: ['dex'],
    minimum: 13,
    mode: 'all',
    description: 'Dexterity 13',
  },
  sorcerer: {
    abilities: ['cha'],
    minimum: 13,
    mode: 'all',
    description: 'Charisma 13',
  },
  warlock: {
    abilities: ['cha'],
    minimum: 13,
    mode: 'all',
    description: 'Charisma 13',
  },
  wizard: {
    abilities: ['int'],
    minimum: 13,
    mode: 'all',
    description: 'Intelligence 13',
  },
};

export interface MulticlassProficiencySpec {
  armor: readonly string[];
  weapons: readonly string[];
  tools: readonly string[];
  skillChoiceCount: number;
  toolChoiceCount: number;
}

/**
 * SRD 5.1 Multiclassing Proficiencies table granted when taking Level 1 in a secondary class.
 */
export const MULTICLASS_PROFICIENCIES_BY_CLASS: Readonly<
  Record<string, MulticlassProficiencySpec>
> = {
  barbarian: {
    armor: ['shields'],
    weapons: ['simple-weapons', 'martial-weapons'],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  bard: {
    armor: ['light-armor'],
    weapons: [],
    tools: [],
    skillChoiceCount: 1,
    toolChoiceCount: 1,
  },
  cleric: {
    armor: ['light-armor', 'medium-armor', 'shields'],
    weapons: [],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  druid: {
    armor: ['light-armor', 'medium-armor', 'shields'],
    weapons: [],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  fighter: {
    armor: ['light-armor', 'medium-armor', 'shields'],
    weapons: ['simple-weapons', 'martial-weapons'],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  monk: {
    armor: [],
    weapons: ['simple-weapons', 'shortsword'],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  paladin: {
    armor: ['light-armor', 'medium-armor', 'shields'],
    weapons: ['simple-weapons', 'martial-weapons'],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  ranger: {
    armor: ['light-armor', 'medium-armor', 'shields'],
    weapons: ['simple-weapons', 'martial-weapons'],
    tools: [],
    skillChoiceCount: 1,
    toolChoiceCount: 0,
  },
  rogue: {
    armor: ['light-armor'],
    weapons: [],
    tools: ['thieves-tools'],
    skillChoiceCount: 1,
    toolChoiceCount: 0,
  },
  sorcerer: {
    armor: [],
    weapons: [],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  warlock: {
    armor: ['light-armor'],
    weapons: ['simple-weapons'],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
  wizard: {
    armor: [],
    weapons: [],
    tools: [],
    skillChoiceCount: 0,
    toolChoiceCount: 0,
  },
};

/**
 * Checks whether a single class's multiclassing ability prerequisite is satisfied by `abilityScores`.
 */
export function checkClassMulticlassPrerequisite(
  classId: string,
  abilityScores: Readonly<Record<AbilityId, number>>,
): { met: boolean; reason?: string } {
  const prereq = MULTICLASS_ABILITY_PREREQUISITES[classId];
  if (!prereq) {
    return { met: true };
  }

  if (prereq.mode === 'any') {
    const anyMet = prereq.abilities.some((ab) => abilityScores[ab] >= prereq.minimum);
    if (!anyMet) {
      const currentDesc = prereq.abilities
        .map((ab) => `${ab.toUpperCase()} ${abilityScores[ab]}`)
        .join(', ');
      return {
        met: false,
        reason: `Class '${classId}' requires ${prereq.description} for multiclassing (character has ${currentDesc}).`,
      };
    }
    return { met: true };
  }

  for (const ab of prereq.abilities) {
    if (abilityScores[ab] < prereq.minimum) {
      return {
        met: false,
        reason: `Class '${classId}' requires ${prereq.description} for multiclassing (character has ${ab.toUpperCase()} ${abilityScores[ab]}).`,
      };
    }
  }

  return { met: true };
}

export interface MulticlassEligibilityResult {
  eligible: boolean;
  isNewClass: boolean;
  targetClassId: string;
  abilityScores: Record<AbilityId, number>;
  unmetPrerequisites: string[];
}

/**
 * Computes a character's effective ability scores (base + racial + subracial + ASI/Feat bonuses, capped at 20/24)
 * for prerequisite checking.
 */
export function computeAbilityScoresForPrerequisites(
  state: Pick<
    CharacterBuildState,
    'raceId' | 'subraceId' | 'racialChoices' | 'baseAbilities' | 'classes'
  >,
  compendium: SrdCompendium = createCompendium(),
): Record<AbilityId, number> {
  const scores: Record<AbilityId, number> = { ...state.baseAbilities };

  const race = compendium.getRace(state.raceId);
  if (race) {
    for (const ab of ABILITY_IDS) {
      scores[ab] += race.abilityBonuses[ab] ?? 0;
    }
    for (const choice of race.choices) {
      if (choice.type === 'ability_score_bonus') {
        const picked = state.racialChoices[choice.id] ?? [];
        const seen = new Set<string>();
        const excluded = new Set(choice.excludeAbilities ?? []);
        for (const ab of picked) {
          if (
            (ABILITY_IDS as readonly string[]).includes(ab) &&
            !excluded.has(ab as AbilityId) &&
            (!choice.distinct || !seen.has(ab))
          ) {
            seen.add(ab);
            scores[ab as AbilityId] += choice.bonus;
          }
        }
      }
    }
  }

  const subrace = state.subraceId ? compendium.getSubrace(state.subraceId) : undefined;
  if (subrace && (!race || race.subraceIds.includes(subrace.id))) {
    for (const ab of ABILITY_IDS) {
      scores[ab] += subrace.abilityBonuses[ab] ?? 0;
    }
  }

  const hasPrimalChampion = state.classes.some(
    (c) => c.classId === 'barbarian' && c.level >= 20,
  );

  for (const entry of state.classes) {
    for (const [lvlKey, sel] of Object.entries(entry.asiOrFeatByLevel)) {
      if (Number(lvlKey) > entry.level) continue;
      if (sel.type === 'asi') {
        for (const ab of ABILITY_IDS) {
          scores[ab] += sel.bonuses[ab] ?? 0;
        }
      } else {
        const feat =
          (state as any).customFeats?.find((f: any) => f.id === sel.featId) ??
          compendium.getFeat(sel.featId);
        if (feat?.abilityBonuses) {
          for (const ab of ABILITY_IDS) {
            scores[ab] += feat.abilityBonuses[ab] ?? 0;
          }
        }
      }
    }
  }

  for (const ab of ABILITY_IDS) {
    const cap = hasPrimalChampion && (ab === 'str' || ab === 'con') ? 24 : 20;
    scores[ab] = Math.min(cap, scores[ab]);
  }

  if (hasPrimalChampion) {
    scores.str = Math.min(24, scores.str + 4);
    scores.con = Math.min(24, scores.con + 4);
  }

  return scores;
}

/**
 * Evaluates SRD 5.1 Multiclassing eligibility for advancing or adding `targetClassId`.
 * Advancing an already-taken class in a single-class character does not require multiclass prerequisites;
 * adding a new class requires meeting the prerequisites for all existing classes AND `targetClassId`.
 */
export function checkMulticlassEligibility(
  state: Pick<
    CharacterBuildState,
    'raceId' | 'subraceId' | 'racialChoices' | 'baseAbilities' | 'classes'
  >,
  targetClassId: string,
  compendium: SrdCompendium = createCompendium(),
): MulticlassEligibilityResult {
  const abilityScores = computeAbilityScoresForPrerequisites(state, compendium);
  const existingClassIds = state.classes.map((c) => c.classId);
  const isNewClass = !existingClassIds.includes(targetClassId);
  const unmetPrerequisites: string[] = [];

  if (!compendium.getClass(targetClassId)) {
    unmetPrerequisites.push(`Unknown SRD 5.1 Class ID '${targetClassId}'.`);
    return {
      eligible: false,
      isNewClass,
      targetClassId,
      abilityScores,
      unmetPrerequisites,
    };
  }

  // Single-class character advancing in their existing class has no multiclass prerequisite
  if (!isNewClass) {
    return {
      eligible: true,
      isNewClass: false,
      targetClassId,
      abilityScores,
      unmetPrerequisites,
    };
  }

  // Check all current classes + target class per SRD 5.1 Multiclassing rules
  for (const currentClassId of existingClassIds) {
    const check = checkClassMulticlassPrerequisite(currentClassId, abilityScores);
    if (!check.met && check.reason) {
      unmetPrerequisites.push(check.reason);
    }
  }

  const targetCheck = checkClassMulticlassPrerequisite(targetClassId, abilityScores);
  if (!targetCheck.met && targetCheck.reason) {
    unmetPrerequisites.push(targetCheck.reason);
  }

  return {
    eligible: unmetPrerequisites.length === 0,
    isNewClass,
    targetClassId,
    abilityScores,
    unmetPrerequisites,
  };
}

// ============================================================================
// 3. Multiclass Spell Slots & Per-Class Spell Level Caps
// ============================================================================

export type SpellSlotCountsByLevel = Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number>;

export interface MulticlassSpellSlotsResult {
  effectiveCasterLevel: number;
  nonPactEffectiveCasterLevel: number;
  isMulticlassSpellcaster: boolean;
  spellSlots: SpellSlotCountsByLevel;
  pactMagic?: {
    slotLevel: number;
    maxSlots: number;
  };
  /**
   * Highest spell level (`0..9`) a character can learn or prepare for each class individually,
   * per SRD 5.1 Multiclassing rule: "You determine what spells you know and can prepare for each
   * class individually, as if you were a single-classed member of that class."
   */
  maxIndividuallyCastableSlotLevelByClass: Record<string, number>;
}

/**
 * Returns the highest spell level (`0..9`) a single-classed member of `classData` at `classLevel`
 * has spell slots for (or Pact Magic + Mystic Arcanum for Warlock).
 */
export function getMaxSpellLevelForClassAtLevel(
  classData: ClassData,
  classLevel: number,
  options?: { includeMysticArcanum?: boolean },
): number {
  if (!classData.spellcasting || classLevel < 1) {
    return 0;
  }

  const clampedLevel = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, Math.floor(classLevel)));
  const lvlSlots = classData.levels[clampedLevel - 1]?.spellSlots;
  if (!lvlSlots) {
    return 0;
  }

  if (classData.spellcasting.progression === 'pact') {
    const pactLvl = lvlSlots.pactSlotLevel ?? 0;
    if (options?.includeMysticArcanum) {
      if (clampedLevel >= 17) return 9;
      if (clampedLevel >= 15) return 8;
      if (clampedLevel >= 13) return 7;
      if (clampedLevel >= 11) return 6;
    }
    return pactLvl;
  }

  for (let sLvl = 9; sLvl >= 1; sLvl--) {
    const count = lvlSlots[`level${sLvl}` as keyof typeof lvlSlots];
    if (typeof count === 'number' && count > 0) {
      return sLvl;
    }
  }

  return 0;
}

/**
 * Computes SRD 5.1 Single-Class or Multiclass Spell Slots (levels 1–9) and Warlock Pact Magic
 * across a character's class entries.
 *
 * Per SRD 5.1:
 * - If a character has the Spellcasting feature from only 1 non-Pact class, they use that class's
 *   own spell slot table (e.g., a Paladin 3 or Paladin 3 / Fighter 2 has 3 1st-level slots).
 * - If a character has the Spellcasting feature from > 1 non-Pact class (or combines casters),
 *   Effective Caster Level is:
 *     `sum(FullCasterLevels) + floor(sum(HalfCasterLevels) / 2) + floor(sum(ThirdCasterLevels) / 3)`
 *   and spell slots are looked up in `MULTICLASS_SPELL_SLOTS_TABLE`.
 * - Warlock Pact Magic slots are tracked separately in `pactMagic`.
 */
export function computeMulticlassSpellSlots(
  classes: readonly Pick<CharacterClassEntry, 'classId' | 'level'>[],
  compendium: SrdCompendium = createCompendium(),
): MulticlassSpellSlotsResult {
  const spellSlots: SpellSlotCountsByLevel = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
  };
  const maxIndividuallyCastableSlotLevelByClass: Record<string, number> = {};

  const nonPactActiveCasters: Array<{
    classData: ClassData;
    level: number;
  }> = [];
  let allNonPactSpellcastingClassesCount = 0;
  let fullCasterLevels = 0;
  let halfCasterLevels = 0;
  let thirdCasterLevels = 0;
  let warlockEntry: { classData: ClassData; level: number } | undefined;

  for (const entry of classes) {
    const classData = compendium.getClass(entry.classId);
    if (!classData) continue;

    maxIndividuallyCastableSlotLevelByClass[entry.classId] =
      getMaxSpellLevelForClassAtLevel(classData, entry.level);

    if (!classData.spellcasting) continue;

    const { progression } = classData.spellcasting;
    if (progression === 'pact') {
      if (entry.level >= 1) {
        warlockEntry = { classData, level: entry.level };
      }
      continue;
    }

    allNonPactSpellcastingClassesCount += 1;

    if (progression === 'full') {
      fullCasterLevels += entry.level;
      if (entry.level >= 1) {
        nonPactActiveCasters.push({ classData, level: entry.level });
      }
    } else if (progression === 'half') {
      halfCasterLevels += Math.floor(entry.level / 2);
      if (entry.level >= 2) {
        nonPactActiveCasters.push({ classData, level: entry.level });
      }
    } else if (progression === 'third') {
      thirdCasterLevels += Math.floor(entry.level / 3);
      if (entry.level >= 3) {
        nonPactActiveCasters.push({ classData, level: entry.level });
      }
    }
  }

  const nonPactEffectiveCasterLevel = Math.min(
    MAX_CHARACTER_LEVEL,
    Math.max(0, fullCasterLevels + halfCasterLevels + thirdCasterLevels),
  );

  // Use the Multiclass Spellcaster Table when combining multiple non-Pact spellcasting classes
  const isMulticlassSpellcaster =
    nonPactActiveCasters.length > 1 ||
    (allNonPactSpellcastingClassesCount > 1 && nonPactEffectiveCasterLevel >= 1);

  if (!isMulticlassSpellcaster && nonPactActiveCasters.length === 1) {
    const { classData, level } = nonPactActiveCasters[0]!;
    const lvlSlots = classData.levels[level - 1]?.spellSlots;
    if (lvlSlots) {
      spellSlots[1] = lvlSlots.level1;
      spellSlots[2] = lvlSlots.level2;
      spellSlots[3] = lvlSlots.level3;
      spellSlots[4] = lvlSlots.level4;
      spellSlots[5] = lvlSlots.level5;
      spellSlots[6] = lvlSlots.level6;
      spellSlots[7] = lvlSlots.level7;
      spellSlots[8] = lvlSlots.level8;
      spellSlots[9] = lvlSlots.level9;
    }
  } else if (isMulticlassSpellcaster && nonPactEffectiveCasterLevel >= 1) {
    const mcRow = MULTICLASS_SPELL_SLOTS_TABLE[nonPactEffectiveCasterLevel];
    if (mcRow) {
      for (let sLvl = 1; sLvl <= 9; sLvl++) {
        spellSlots[sLvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9] = mcRow[sLvl - 1]!;
      }
    }
  }

  let pactMagic: { slotLevel: number; maxSlots: number } | undefined;
  if (warlockEntry) {
    const wSlots = warlockEntry.classData.levels[warlockEntry.level - 1]?.spellSlots;
    pactMagic = {
      slotLevel: wSlots?.pactSlotLevel ?? 1,
      maxSlots: wSlots?.pactSlots ?? 1,
    };
  }

  const effectiveCasterLevel =
    nonPactEffectiveCasterLevel > 0
      ? nonPactEffectiveCasterLevel
      : warlockEntry
        ? warlockEntry.level
        : 0;

  return {
    effectiveCasterLevel,
    nonPactEffectiveCasterLevel,
    isMulticlassSpellcaster,
    spellSlots,
    ...(pactMagic ? { pactMagic } : {}),
    maxIndividuallyCastableSlotLevelByClass,
  };
}

// ============================================================================
// 4. Hit Point (HP) Roll & Fixed Average Helpers
// ============================================================================

/**
 * Returns the SRD 5.1 fixed average Hit Die roll for levels 2+ (`HitDie / 2 + 1`):
 * - `d6` -> `4`
 * - `d8` -> `5`
 * - `d10` -> `6`
 * - `d12` -> `7`
 */
export function getFixedHpRollForHitDie(hitDie: HitDieSize): number {
  return hitDie / 2 + 1;
}

/**
 * Rolls a character's Hit Die (`1..hitDie`) deterministically using the seeded PRNG (`Mulberry32`).
 */
export function rollLevelUpHitDie(
  hitDie: HitDieSize,
  rngState: number,
): { roll: number; nextRngState: number } {
  const { roll, nextState } = rollDie(rngState, hitDie);
  return {
    roll,
    nextRngState: nextState,
  };
}

/**
 * Resolves the raw Hit Die value (`hpRollsByLevel` entry) for a level-up.
 * At Total Character Level 1 (`isFirstCharacterLevel === true`), SRD 5.1 always grants maximum Hit Die.
 */
export function resolveLevelUpHpRoll(
  hitDie: HitDieSize,
  isFirstCharacterLevel: boolean,
  options: {
    hpMethod: 'fixed' | 'roll' | 'manual';
    hpRoll?: number | undefined;
    rngState?: number | undefined;
  },
): { roll: number; nextRngState?: number | undefined; error?: string | undefined } {
  if (isFirstCharacterLevel) {
    return { roll: hitDie, nextRngState: options.rngState };
  }

  switch (options.hpMethod) {
    case 'fixed':
      return {
        roll: getFixedHpRollForHitDie(hitDie),
        nextRngState: options.rngState,
      };
    case 'roll': {
      if (options.rngState === undefined || !Number.isFinite(options.rngState)) {
        return {
          roll: getFixedHpRollForHitDie(hitDie),
          error: "hpMethod 'roll' requires a finite seeded 'rngState'.",
        };
      }
      const { roll, nextRngState } = rollLevelUpHitDie(hitDie, options.rngState);
      return { roll, nextRngState };
    }
    case 'manual': {
      const manual = options.hpRoll;
      if (
        manual === undefined ||
        !Number.isInteger(manual) ||
        manual < 1 ||
        manual > hitDie
      ) {
        return {
          roll: getFixedHpRollForHitDie(hitDie),
          error: `hpMethod 'manual' requires an integer 'hpRoll' between 1 and ${hitDie} (got ${String(manual)}).`,
        };
      }
      return { roll: manual, nextRngState: options.rngState };
    }
  }
}

// ============================================================================
// 5. Level-Up Requirements & Unlocks Inspection (`getLevelUpRequirements`)
// ============================================================================

export interface FeatEligibilityInfo {
  feat: FeatData;
  eligible: boolean;
  alreadySelected: boolean;
  unmetPrerequisites: string[];
}

export interface LevelUpSpellcastingRequirements {
  isSpellcastingClass: boolean;
  unlocksSpellcastingAtThisLevel: boolean;
  preparationMode?: SpellPreparationMode | undefined;
  newCantripsRequired: number;
  newSpellsKnownRequired: number;
  /** Number of new known spells at this level that may be chosen from ANY class's spell list (Bard Magical Secrets at L10/14/18, College of Lore L6 Additional Magical Secrets). */
  allowsAnyClassSpellsCount: number;
  /** Number of free Wizard spells added to the spellbook at this level (`6` at Wizard L1, `2` at Wizard L2..20). */
  newSpellbookSpellsAllowed: number;
  /** True for `known` casters (`bard`, `ranger`, `sorcerer`, `warlock`) advancing past their first spellcasting level. */
  canSwapKnownSpell: boolean;
  /** Highest spell slot level (`0..9`) learnable/preparable for this class at `targetClassLevel`. */
  maxLearnableSpellLevel: number;
  /** For Warlock levels 11, 13, 15, 17: Mystic Arcanum spell level (`6 | 7 | 8 | 9`) unlocked at this level. */
  mysticArcanumSpellLevel?: 6 | 7 | 8 | 9 | undefined;
  allowedCantripIds: string[];
  allowedSpellIds: string[];
  newlyAlwaysPreparedSpellIds: string[];
  previousSpellSlots: SpellSlotCountsByLevel;
  newSpellSlots: SpellSlotCountsByLevel;
  previousPactMagic?: { slotLevel: number; maxSlots: number } | undefined;
  newPactMagic?: { slotLevel: number; maxSlots: number } | undefined;
}

export interface LevelUpRequirements {
  canAdvance: boolean;
  cannotAdvanceReasons: string[];
  classId: string;
  className: string;
  isNewMulticlass: boolean;
  multiclassEligibility: MulticlassEligibilityResult;
  previousClassLevel: number;
  targetClassLevel: number;
  previousTotalLevel: number;
  targetTotalLevel: number;
  previousProficiencyBonus: number;
  newProficiencyBonus: number;
  hitDie: HitDieSize;
  fixedHpRoll: number;
  subclassUnlock: {
    required: boolean;
    alreadyChosen: boolean;
    currentSubclassId?: string | undefined;
    subclassTitle: string;
    availableSubclasses: SubclassData[];
  };
  unlockedClassFeatures: FeatureData[];
  unlockedSubclassFeatures: FeatureData[];
  requiresAsiOrFeat: boolean;
  availableFeats: FeatEligibilityInfo[];
  featureChoices: ChoiceSpec[];
  requiresExpertise: boolean;
  expertiseChoiceKey?: string | undefined;
  expertiseEligibleOptions: string[];
  spellcasting: LevelUpSpellcastingRequirements;
}

/**
 * Evaluates all SRD 5.1 Feats in the compendium for eligibility at a given level-up step.
 */
export function evaluateFeatEligibility(
  state: Pick<
    CharacterBuildState,
    | 'raceId'
    | 'subraceId'
    | 'racialChoices'
    | 'backgroundId'
    | 'backgroundChoices'
    | 'customBackground'
    | 'baseAbilities'
    | 'classes'
    | 'spellcasting'
  >,
  targetTotalLevel: number,
  compendium: SrdCompendium = createCompendium(),
): FeatEligibilityInfo[] {
  const abilityScores = computeAbilityScoresForPrerequisites(state, compendium);
  const profResolution = resolveProficienciesAndDuplicates(state, compendium);
  const { resolvedProficiencies } = profResolution;

  const allPossessedProficiencies = new Set<string>([
    ...resolvedProficiencies.armor,
    ...resolvedProficiencies.weapons,
    ...resolvedProficiencies.tools,
    ...resolvedProficiencies.skills,
    ...resolvedProficiencies.savingThrows,
    ...resolvedProficiencies.languages,
  ]);

  const alreadySelectedFeatIds = new Set<string>();
  for (const entry of state.classes) {
    for (const [lvlKey, sel] of Object.entries(entry.asiOrFeatByLevel)) {
      if (Number(lvlKey) <= entry.level && sel.type === 'feat') {
        alreadySelectedFeatIds.add(sel.featId);
      }
    }
  }

  const race = compendium.getRace(state.raceId);
  const subrace = state.subraceId ? compendium.getSubrace(state.subraceId) : undefined;
  const hasRacialInnateSpells =
    (race?.traits.some((t) => (t.innateSpells?.length ?? 0) > 0) ?? false) ||
    (subrace?.traits.some((t) => (t.innateSpells?.length ?? 0) > 0) ?? false) ||
    state.subraceId === 'high-elf';

  const hasSpellcastingClass = state.classes.some((c) => {
    const cls = compendium.getClass(c.classId);
    if (!cls?.spellcasting) return false;
    const minLvl =
      cls.spellcasting.progression === 'half'
        ? 2
        : cls.spellcasting.progression === 'third'
          ? 3
          : 1;
    return c.level >= minLvl;
  });

  const canCastAtLeastOneSpell =
    hasSpellcastingClass ||
    hasRacialInnateSpells ||
    state.spellcasting.knownCantripIds.length > 0 ||
    state.spellcasting.knownSpellIds.length > 0 ||
    state.spellcasting.preparedSpellIds.length > 0;

  const allFeats = [...compendium.feats];
  for (const cf of (state as any).customFeats ?? []) {
    if (!allFeats.some((f) => f.id === cf.id)) {
      allFeats.push(cf);
    }
  }

  return allFeats.map((feat) => {
    const alreadySelected = alreadySelectedFeatIds.has(feat.id);
    const unmetPrerequisites: string[] = [];

    if (alreadySelected) {
      unmetPrerequisites.push(
        `Feat '${feat.name}' (${feat.id}) has already been selected.`,
      );
    }

    for (const prereq of feat.prerequisites) {
      if (prereq.type === 'ability_minimum') {
        const currentScore = abilityScores[prereq.ability];
        if (currentScore < prereq.minimum) {
          unmetPrerequisites.push(
            `Requires ${ABILITY_NAMES[prereq.ability]} ${prereq.minimum} or higher (character has ${currentScore}).`,
          );
        }
      } else if (prereq.type === 'level') {
        if (targetTotalLevel < prereq.minimumLevel) {
          unmetPrerequisites.push(
            `Requires character level ${prereq.minimumLevel} or higher (target level is ${targetTotalLevel}).`,
          );
        }
      } else if (prereq.type === 'spellcasting') {
        if (!canCastAtLeastOneSpell) {
          unmetPrerequisites.push('Requires the ability to cast at least one spell.');
        }
      } else if (prereq.type === 'proficiency') {
        if (!allPossessedProficiencies.has(prereq.proficiencyId)) {
          unmetPrerequisites.push(
            `Requires proficiency with '${prereq.proficiencyId}'.`,
          );
        }
      }
    }

    return {
      feat,
      eligible: unmetPrerequisites.length === 0,
      alreadySelected,
      unmetPrerequisites,
    };
  });
}

/**
 * Inspects a character's current build state and returns all unlocked features, subclass requirements,
 * ASI/Feat eligibility, feature choices, expertise requirements, and spellcasting progression for
 * advancing `targetClassId` by 1 level.
 */
export function getLevelUpRequirements(
  state: CharacterBuildState,
  targetClassId?: string,
  compendium: SrdCompendium = createCompendium(),
  selectedSubclassId?: string,
): LevelUpRequirements {
  const effectiveClassId = targetClassId ?? state.classes[0]?.classId ?? 'fighter';
  const classData = compendium.getClass(effectiveClassId);
  const existingEntry = state.classes.find((c) => c.classId === effectiveClassId);
  const isNewMulticlass = existingEntry === undefined;

  const previousTotalLevel = state.classes.reduce((sum, c) => sum + c.level, 0);
  const targetTotalLevel = previousTotalLevel + 1;
  const previousClassLevel = existingEntry?.level ?? 0;
  const targetClassLevel = previousClassLevel + 1;

  const previousProficiencyBonus = computeProficiencyBonus(previousTotalLevel);
  const newProficiencyBonus = computeProficiencyBonus(
    Math.min(MAX_CHARACTER_LEVEL, targetTotalLevel),
  );

  const cannotAdvanceReasons: string[] = [];
  if (previousTotalLevel >= MAX_CHARACTER_LEVEL) {
    cannotAdvanceReasons.push(
      `Character has already reached the maximum total level of ${MAX_CHARACTER_LEVEL}.`,
    );
  }
  if (!classData) {
    cannotAdvanceReasons.push(`Unknown SRD 5.1 Class ID '${effectiveClassId}'.`);
  }

  const multiclassEligibility = checkMulticlassEligibility(
    state,
    effectiveClassId,
    compendium,
  );
  if (isNewMulticlass && !multiclassEligibility.eligible) {
    cannotAdvanceReasons.push(...multiclassEligibility.unmetPrerequisites);
  }

  const hitDie: HitDieSize = classData?.hitDie ?? 8;
  const fixedHpRoll =
    previousTotalLevel === 0 ? hitDie : getFixedHpRollForHitDie(hitDie);

  // Subclass unlock inspection
  const availableSubclasses = classData
    ? compendium.getSubclassesForClass(classData.id)
    : [];
  const currentSubclassId = existingEntry?.subclassId;
  const effectiveSubclassId = selectedSubclassId ?? currentSubclassId;
  const subclassUnlockRequired = Boolean(
    classData &&
      targetClassLevel >= classData.subclassLevel &&
      targetClassLevel <= MAX_CHARACTER_LEVEL &&
      !currentSubclassId,
  );

  // Unlocked Class & Subclass Features + ASI check + Feature Choices
  const unlockedClassFeatures: FeatureData[] = [];
  const unlockedSubclassFeatures: FeatureData[] = [];
  const featureChoices: ChoiceSpec[] = [];
  let requiresAsiOrFeat = false;

  if (classData && targetClassLevel >= 1 && targetClassLevel <= MAX_CHARACTER_LEVEL) {
    // If multiclassing into Bard, Ranger, or Rogue at L1 of that secondary class, offer the multiclass skill/tool choice
    if (isNewMulticlass && targetClassLevel === 1) {
      const mcProf = MULTICLASS_PROFICIENCIES_BY_CLASS[classData.id];
      if (
        mcProf &&
        mcProf.skillChoiceCount > 0 &&
        classData.skillChoices.type === 'skill'
      ) {
        featureChoices.push({
          ...classData.skillChoices,
          count: mcProf.skillChoiceCount,
          label: `Choose ${mcProf.skillChoiceCount} ${classData.name} multiclass skill proficiency`,
          from:
            classData.id === 'bard'
              ? { mode: 'category', category: 'all_skills' }
              : classData.skillChoices.from,
        });
      }
      if (mcProf && mcProf.toolChoiceCount > 0 && classData.toolChoices?.[0]) {
        featureChoices.push({
          ...classData.toolChoices[0],
          count: mcProf.toolChoiceCount,
          label: 'Choose 1 musical instrument proficiency (Multiclass Bard)',
        });
      }
    }

    const lvlProg = classData.levels[targetClassLevel - 1];
    if (lvlProg) {
      for (const featureId of lvlProg.featureIds) {
        if (featureId.startsWith('asi-')) {
          requiresAsiOrFeat = true;
          continue;
        }
        const feature = compendium.getFeature(featureId);
        if (!feature) continue;
        unlockedClassFeatures.push(feature);

        for (const choice of feature.choices ?? []) {
          if (feature.id === 'metamagic' && targetClassLevel > 3) {
            featureChoices.push({
              ...choice,
              count: 1,
              label: 'Choose one additional Metamagic option',
            });
          } else {
            featureChoices.push(choice);
          }
        }
      }

      // Check Warlock additional Eldritch Invocations at L5, L7, L9, L12, L15, L18
      if (classData.id === 'warlock' && targetClassLevel > 2) {
        const prevInv = Number(
          classData.levels[targetClassLevel - 2]?.classSpecific['invocations_known'] ?? 0,
        );
        const currInv = Number(lvlProg.classSpecific['invocations_known'] ?? 0);
        const deltaInv = currInv - prevInv;
        const invFeature = compendium.getFeature('eldritch-invocations');
        const baseInvChoice = invFeature?.choices?.[0];
        if (deltaInv > 0 && baseInvChoice) {
          featureChoices.push({
            ...baseInvChoice,
            count: deltaInv,
            label: `Choose ${deltaInv} additional Eldritch Invocation(s)`,
          });
        }
      }
    }

    const subclassData =
      effectiveSubclassId && targetClassLevel >= classData.subclassLevel
        ? compendium.getSubclass(effectiveSubclassId)
        : undefined;

    if (subclassData && subclassData.classId === classData.id) {
      const subLvlProg = subclassData.levels.find((l) => l.level === targetClassLevel);
      for (const featureId of subLvlProg?.featureIds ?? []) {
        const feature = compendium.getFeature(featureId);
        if (!feature) continue;
        unlockedSubclassFeatures.push(feature);
        for (const choice of feature.choices ?? []) {
          featureChoices.push(choice);
        }
      }
    }
  }

  // Expertise inspection (Rogue L1/L6, Bard L3/L10)
  const lvlProgAtTarget =
    classData && targetClassLevel <= MAX_CHARACTER_LEVEL
      ? classData.levels[targetClassLevel - 1]
      : undefined;
  const hasRogueExpertiseAtLevel =
    lvlProgAtTarget?.featureIds.includes('expertise-rogue') ?? false;
  const hasBardExpertiseAtLevel =
    (lvlProgAtTarget?.featureIds.includes('expertise-bard') ?? false) ||
    (classData?.id === 'bard' && targetClassLevel === 10);
  const requiresExpertise = hasRogueExpertiseAtLevel || hasBardExpertiseAtLevel;
  const expertiseChoiceKey = hasRogueExpertiseAtLevel
    ? 'expertise-rogue'
    : hasBardExpertiseAtLevel
      ? 'expertise-bard'
      : undefined;

  const profResolution = resolveProficienciesAndDuplicates(state, compendium);
  const currentExpertiseSet = new Set(profResolution.resolvedProficiencies.expertise);
  const expertiseEligibleOptions: string[] = profResolution.resolvedProficiencies.skills.filter(
    (sk) => !currentExpertiseSet.has(sk),
  );
  if (
    hasRogueExpertiseAtLevel &&
    (profResolution.resolvedProficiencies.tools.includes('thieves-tools') ||
      (isNewMulticlass && classData?.id === 'rogue')) &&
    !currentExpertiseSet.has('thieves-tools')
  ) {
    expertiseEligibleOptions.push('thieves-tools');
  }

  // Spellcasting progression inspection
  const prevClasses = state.classes.map((c) => ({ classId: c.classId, level: c.level }));
  const nextClasses = isNewMulticlass
    ? [...prevClasses, { classId: effectiveClassId, level: 1 }]
    : prevClasses.map((c) =>
        c.classId === effectiveClassId ? { ...c, level: targetClassLevel } : c,
      );

  const prevSlotCalc = computeMulticlassSpellSlots(prevClasses, compendium);
  const nextSlotCalc = computeMulticlassSpellSlots(
    targetTotalLevel <= MAX_CHARACTER_LEVEL ? nextClasses : prevClasses,
    compendium,
  );

  let spellcastingReqs: LevelUpSpellcastingRequirements = {
    isSpellcastingClass: false,
    unlocksSpellcastingAtThisLevel: false,
    newCantripsRequired: 0,
    newSpellsKnownRequired: 0,
    allowsAnyClassSpellsCount: 0,
    newSpellbookSpellsAllowed: 0,
    canSwapKnownSpell: false,
    maxLearnableSpellLevel: 0,
    allowedCantripIds: [],
    allowedSpellIds: [],
    newlyAlwaysPreparedSpellIds: [],
    previousSpellSlots: prevSlotCalc.spellSlots,
    newSpellSlots: nextSlotCalc.spellSlots,
    ...(prevSlotCalc.pactMagic ? { previousPactMagic: prevSlotCalc.pactMagic } : {}),
    ...(nextSlotCalc.pactMagic ? { newPactMagic: nextSlotCalc.pactMagic } : {}),
  };

  if (
    classData?.spellcasting &&
    targetClassLevel >= 1 &&
    targetClassLevel <= MAX_CHARACTER_LEVEL
  ) {
    const { spellcasting } = classData;
    const minSpellcastingLevel =
      spellcasting.progression === 'half'
        ? 2
        : spellcasting.progression === 'third'
          ? 3
          : 1;
    const isSpellcastingActive = targetClassLevel >= minSpellcastingLevel;
    const unlocksSpellcastingAtThisLevel = targetClassLevel === minSpellcastingLevel;

    const prevCantrips =
      previousClassLevel >= 1
        ? (spellcasting.cantripsKnownByLevel[previousClassLevel - 1] ?? 0)
        : 0;
    const currCantrips = spellcasting.cantripsKnownByLevel[targetClassLevel - 1] ?? 0;
    const newCantripsRequired = Math.max(0, currCantrips - prevCantrips);

    const prevKnown =
      previousClassLevel >= 1 && spellcasting.spellsKnownByLevel
        ? (spellcasting.spellsKnownByLevel[previousClassLevel - 1] ?? 0)
        : 0;
    const currKnown = spellcasting.spellsKnownByLevel
      ? (spellcasting.spellsKnownByLevel[targetClassLevel - 1] ?? 0)
      : 0;
    let newSpellsKnownRequired = Math.max(0, currKnown - prevKnown);

    // College of Lore Bard at L6 gains Additional Magical Secrets (2 spells from any class that don't count against table)
    let allowsAnyClassSpellsCount = 0;
    if (
      classData.id === 'bard' &&
      effectiveSubclassId === 'lore' &&
      targetClassLevel === 6
    ) {
      newSpellsKnownRequired += 2;
      allowsAnyClassSpellsCount = 2;
    } else if (
      classData.id === 'bard' &&
      (targetClassLevel === 10 || targetClassLevel === 14 || targetClassLevel === 18)
    ) {
      // Bard Magical Secrets at L10, L14, L18 are already included in Bard's spellsKnownByLevel (+2 jump)
      allowsAnyClassSpellsCount = 2;
    }

    const newSpellbookSpellsAllowed =
      spellcasting.preparationMode === 'spellbook'
        ? targetClassLevel === 1
          ? 6
          : 2
        : 0;

    const maxLearnableSpellLevel = getMaxSpellLevelForClassAtLevel(
      classData,
      targetClassLevel,
    );
    const prevMaxLearnableSpellLevel =
      previousClassLevel >= 1
        ? getMaxSpellLevelForClassAtLevel(classData, previousClassLevel)
        : 0;

    const canSwapKnownSpell =
      spellcasting.preparationMode === 'known' &&
      previousClassLevel >= minSpellcastingLevel &&
      prevMaxLearnableSpellLevel >= 1;

    let mysticArcanumSpellLevel: 6 | 7 | 8 | 9 | undefined;
    if (classData.id === 'warlock') {
      if (targetClassLevel === 11) mysticArcanumSpellLevel = 6;
      else if (targetClassLevel === 13) mysticArcanumSpellLevel = 7;
      else if (targetClassLevel === 15) mysticArcanumSpellLevel = 8;
      else if (targetClassLevel === 17) mysticArcanumSpellLevel = 9;
    }

    // Collect newly unlocked always-prepared subclass spells and expanded spell list spells
    const newlyAlwaysPreparedSpellIds: string[] = [];
    const expandedSpellSet = new Set<string>();
    const subclassData =
      effectiveSubclassId && targetClassLevel >= classData.subclassLevel
        ? compendium.getSubclass(effectiveSubclassId)
        : undefined;

    if (subclassData?.spells) {
      for (const grant of subclassData.spells) {
        if (grant.mode === 'always_prepared' && grant.classLevel === targetClassLevel) {
          for (const sId of grant.spellIds) {
            if (!newlyAlwaysPreparedSpellIds.includes(sId)) {
              newlyAlwaysPreparedSpellIds.push(sId);
            }
          }
        } else if (
          grant.mode === 'expanded_spell_list' &&
          grant.classLevel <= targetClassLevel
        ) {
          for (const sId of grant.spellIds) {
            expandedSpellSet.add(sId);
          }
        }
      }
    }

    const existingCantrips = new Set(state.spellcasting.knownCantripIds);
    const existingKnownOrBook = new Set([
      ...state.spellcasting.knownSpellIds,
      ...state.spellcasting.spellbookSpellIds,
    ]);

    const allowedCantripIds = compendium
      .getSpellsForClass(classData.id, { level: 0 })
      .map((s) => s.id)
      .filter((id) => !existingCantrips.has(id));

    const classSpellsUpToMax =
      maxLearnableSpellLevel >= 1
        ? compendium
            .getSpellsForClass(classData.id, {
              minLevel: 1,
              maxLevel: maxLearnableSpellLevel as SpellLevel,
            })
            .map((s) => s.id)
        : [];

    for (const expId of expandedSpellSet) {
      const sp = compendium.getSpell(expId);
      if (sp && sp.level >= 1 && sp.level <= maxLearnableSpellLevel) {
        if (!classSpellsUpToMax.includes(sp.id)) {
          classSpellsUpToMax.push(sp.id);
        }
      }
    }

    const allowedSpellIds = classSpellsUpToMax.filter(
      (id) => !existingKnownOrBook.has(id),
    );

    spellcastingReqs = {
      isSpellcastingClass: isSpellcastingActive,
      unlocksSpellcastingAtThisLevel,
      preparationMode: spellcasting.preparationMode,
      newCantripsRequired,
      newSpellsKnownRequired,
      allowsAnyClassSpellsCount,
      newSpellbookSpellsAllowed,
      canSwapKnownSpell,
      maxLearnableSpellLevel,
      ...(mysticArcanumSpellLevel !== undefined ? { mysticArcanumSpellLevel } : {}),
      allowedCantripIds,
      allowedSpellIds,
      newlyAlwaysPreparedSpellIds,
      previousSpellSlots: prevSlotCalc.spellSlots,
      newSpellSlots: nextSlotCalc.spellSlots,
      ...(prevSlotCalc.pactMagic ? { previousPactMagic: prevSlotCalc.pactMagic } : {}),
      ...(nextSlotCalc.pactMagic ? { newPactMagic: nextSlotCalc.pactMagic } : {}),
    };
  }

  const availableFeats = evaluateFeatEligibility(
    state,
    Math.min(MAX_CHARACTER_LEVEL, targetTotalLevel),
    compendium,
  );

  return {
    canAdvance: cannotAdvanceReasons.length === 0,
    cannotAdvanceReasons,
    classId: effectiveClassId,
    className: classData?.name ?? effectiveClassId,
    isNewMulticlass,
    multiclassEligibility,
    previousClassLevel,
    targetClassLevel,
    previousTotalLevel,
    targetTotalLevel,
    previousProficiencyBonus,
    newProficiencyBonus,
    hitDie,
    fixedHpRoll,
    subclassUnlock: {
      required: subclassUnlockRequired,
      alreadyChosen: Boolean(currentSubclassId),
      currentSubclassId,
      subclassTitle: classData?.subclassTitle ?? 'Subclass',
      availableSubclasses: [...availableSubclasses],
    },
    unlockedClassFeatures,
    unlockedSubclassFeatures,
    requiresAsiOrFeat,
    availableFeats,
    featureChoices,
    requiresExpertise,
    ...(expertiseChoiceKey ? { expertiseChoiceKey } : {}),
    expertiseEligibleOptions,
    spellcasting: spellcastingReqs,
  };
}

// ============================================================================
// 6. Level-Up Request, Validation & Execution (`validateLevelUp`, `applyLevelUp`)
// ============================================================================

export interface LevelUpSpellcastingUpdates {
  /** New cantrips learned at this level. */
  addedCantripIds?: readonly string[] | undefined;
  /** New spells learned by a `known` caster (`bard`, `ranger`, `sorcerer`, `warlock`) at this level. */
  addedKnownSpellIds?: readonly string[] | undefined;
  /** Optional 1-for-1 spell replacement allowed when a `known` caster gains a level in their class. */
  replaceKnownSpell?:
    | {
        removeSpellId: string;
        addSpellId: string;
      }
    | undefined;
  /** Free spells added to a Wizard's spellbook at this level (up to 2 per Wizard level, or 6 at Wizard L1). */
  addedSpellbookSpellIds?: readonly string[] | undefined;
  /** Optional Warlock Mystic Arcanum spell (L11: 6th, L13: 7th, L15: 8th, L17: 9th). */
  mysticArcanumSpellId?: string | undefined;
  /** Optional updated prepared spells list. */
  preparedSpellIds?: readonly string[] | undefined;
}

export interface LevelUpRequest {
  /** Target class to advance (or multiclass into). Defaults to `state.classes[0].classId`. */
  classId?: string | undefined;
  /** Subclass selection (required when reaching `classData.subclassLevel`). */
  subclassId?: string | undefined;
  /** HP gain mode: `'fixed'` (SRD average: `hitDie / 2 + 1`), `'roll'` (seeded PRNG), or `'manual'` (explicit `hpRoll`). */
  hpMethod: 'fixed' | 'roll' | 'manual';
  /** Explicit HP die roll (`1..hitDie`) when `hpMethod === 'manual'`. */
  hpRoll?: number | undefined;
  /** Seeded PRNG state required when `hpMethod === 'roll'`. */
  rngState?: number | undefined;
  /** Feature, expertise, and class choices made at the new class level (`choiceId -> selected option IDs`). */
  choiceSelections?: Readonly<Record<string, readonly string[]>> | undefined;
  /** ASI or Feat selection (required when the new class level unlocks an ASI). */
  asiOrFeat?: AsiOrFeatSelection | undefined;
  /** Spellcasting additions/updates on level-up. */
  spellcastingUpdates?: LevelUpSpellcastingUpdates | undefined;
  /** Optional duplicate proficiency replacements (`"replace:<category>:<proficiencyId>" -> [replacementId]`). */
  duplicateReplacements?: Readonly<Record<string, readonly string[]>> | undefined;
  /** If true, requires `state.runtime.xp >= getXpThresholdForLevel(targetTotalLevel)`. Defaults to `false`. */
  enforceXpRequirement?: boolean | undefined;
  /** If true (default), enforces SRD 5.1 multiclass ability score prerequisites when adding a new class. */
  enforceMulticlassPrerequisites?: boolean | undefined;
  /** If true (default), enforces that ASI bonuses cannot push an ability score above its cap (20, or 24 for L20 Barbarian). */
  enforceAbilityScoreCapOnAsi?: boolean | undefined;
  /** If true, requires `spellcastingUpdates` to provide exact counts for new cantrips, known spells, and Wizard spellbook spells. Defaults to `false` (always validates any provided spells). */
  requireSpellSelections?: boolean | undefined;
}

export interface LevelUpSummary {
  classId: string;
  className: string;
  isNewMulticlass: boolean;
  previousClassLevel: number;
  newClassLevel: number;
  previousTotalLevel: number;
  newTotalLevel: number;
  previousProficiencyBonus: number;
  newProficiencyBonus: number;
  hpRoll: number;
  conModifierContribution: number;
  previousMaxHp: number;
  newMaxHp: number;
  hpGained: number;
  subclassUnlockedId?: string | undefined;
  subclassUnlockedName?: string | undefined;
  asiOrFeatApplied?: AsiOrFeatSelection | undefined;
  abilityScoreChanges: Array<{
    ability: AbilityId;
    previousScore: number;
    newScore: number;
    previousModifier: number;
    newModifier: number;
  }>;
  unlockedFeatureIds: string[];
  unlockedFeatId?: string | undefined;
  addedCantripIds: string[];
  addedKnownSpellIds: string[];
  replacedKnownSpell?: { removeSpellId: string; addSpellId: string } | undefined;
  addedSpellbookSpellIds: string[];
  newlyAlwaysPreparedSpellIds: string[];
  previousSpellSlots: SpellSlotCountsByLevel;
  newSpellSlots: SpellSlotCountsByLevel;
  previousPactMagic?: { slotLevel: number; maxSlots: number } | undefined;
  newPactMagic?: { slotLevel: number; maxSlots: number } | undefined;
}

export interface LevelUpValidationResult {
  valid: boolean;
  requirements: LevelUpRequirements;
  resolvedHpRoll: number;
  nextRngState?: number | undefined;
  candidateState?: CharacterBuildState | undefined;
  errors: string[];
}

export interface LevelUpExecutionResult {
  state: CharacterBuildState;
  sheet: DerivedCharacterSheet;
  summary: LevelUpSummary;
  nextRngState?: number | undefined;
}

function buildUpdatedStateForLevelUp(
  state: CharacterBuildState,
  requirements: LevelUpRequirements,
  request: LevelUpRequest,
  resolvedHpRoll: number,
  compendium: SrdCompendium,
): CharacterBuildState {
  const { classId, targetClassLevel, isNewMulticlass } = requirements;
  const classData = compendium.getClass(classId);

  const normalizedLevelSelections: Record<string, string[]> = {};
  if (request.choiceSelections) {
    for (const [key, vals] of Object.entries(request.choiceSelections)) {
      normalizedLevelSelections[key] = [...vals];
    }
  }

  const nextClasses: CharacterClassEntry[] = [];
  if (isNewMulticlass) {
    for (const entry of state.classes) {
      nextClasses.push(entry);
    }
    const newSubclassId =
      classData && targetClassLevel >= classData.subclassLevel
        ? request.subclassId
        : request.subclassId;

    const newEntry: CharacterClassEntry = {
      classId,
      ...(newSubclassId ? { subclassId: newSubclassId } : {}),
      level: 1,
      hpRollsByLevel: [resolvedHpRoll],
      choiceSelectionsByLevel:
        Object.keys(normalizedLevelSelections).length > 0
          ? { 1: normalizedLevelSelections }
          : {},
      asiOrFeatByLevel: request.asiOrFeat ? { 1: request.asiOrFeat } : {},
    };
    nextClasses.push(newEntry);
  } else {
    for (const entry of state.classes) {
      if (entry.classId !== classId) {
        nextClasses.push(entry);
        continue;
      }

      const nextChoiceSelectionsByLevel: Record<number, Record<string, string[]>> = {
        ...entry.choiceSelectionsByLevel,
      };
      if (Object.keys(normalizedLevelSelections).length > 0) {
        nextChoiceSelectionsByLevel[targetClassLevel] = {
          ...(nextChoiceSelectionsByLevel[targetClassLevel] ?? {}),
          ...normalizedLevelSelections,
        };
      }

      const nextAsiOrFeatByLevel: Record<number, AsiOrFeatSelection> = {
        ...entry.asiOrFeatByLevel,
      };
      if (request.asiOrFeat) {
        nextAsiOrFeatByLevel[targetClassLevel] = request.asiOrFeat;
      }

      const resolvedSubclassId = entry.subclassId ?? request.subclassId;

      nextClasses.push({
        ...entry,
        ...(resolvedSubclassId ? { subclassId: resolvedSubclassId } : {}),
        level: targetClassLevel,
        hpRollsByLevel: [...entry.hpRollsByLevel, resolvedHpRoll],
        choiceSelectionsByLevel: nextChoiceSelectionsByLevel,
        asiOrFeatByLevel: nextAsiOrFeatByLevel,
      });
    }
  }

  // Apply duplicate proficiency replacements if provided
  let nextBackgroundChoices = { ...state.backgroundChoices };
  if (request.duplicateReplacements) {
    for (const [key, vals] of Object.entries(request.duplicateReplacements)) {
      nextBackgroundChoices[key] = [...vals];
    }
  }

  // Apply spellcasting updates
  const spUpdates = request.spellcastingUpdates;
  const cantripList = [...state.spellcasting.knownCantripIds];
  for (const cId of spUpdates?.addedCantripIds ?? []) {
    if (!cantripList.includes(cId)) {
      cantripList.push(cId);
    }
  }

  let knownSpellList = [...state.spellcasting.knownSpellIds];
  if (spUpdates?.replaceKnownSpell) {
    const { removeSpellId, addSpellId } = spUpdates.replaceKnownSpell;
    knownSpellList = knownSpellList.filter((id) => id !== removeSpellId);
    if (!knownSpellList.includes(addSpellId)) {
      knownSpellList.push(addSpellId);
    }
  }
  for (const sId of spUpdates?.addedKnownSpellIds ?? []) {
    if (!knownSpellList.includes(sId)) {
      knownSpellList.push(sId);
    }
  }
  if (spUpdates?.mysticArcanumSpellId) {
    if (!knownSpellList.includes(spUpdates.mysticArcanumSpellId)) {
      knownSpellList.push(spUpdates.mysticArcanumSpellId);
    }
  }

  const spellbookList = [...state.spellcasting.spellbookSpellIds];
  for (const sId of spUpdates?.addedSpellbookSpellIds ?? []) {
    if (!spellbookList.includes(sId)) {
      spellbookList.push(sId);
    }
  }

  const preparedList = spUpdates?.preparedSpellIds
    ? [...spUpdates.preparedSpellIds]
    : [...state.spellcasting.preparedSpellIds];

  return {
    ...state,
    backgroundChoices: nextBackgroundChoices,
    classes: nextClasses,
    spellcasting: {
      knownCantripIds: cantripList,
      knownSpellIds: knownSpellList,
      spellbookSpellIds: spellbookList,
      preparedSpellIds: preparedList,
    },
  };
}

/**
 * Validates a `LevelUpRequest` against all SRD 5.1 character progression rules
 * (XP threshold, total level cap 20, multiclassing ability prerequisites, HP roll bounds,
 * Subclass unlocks, ASI/Feat selection & prerequisites, class/subclass feature choices,
 * Expertise, Duplicate Proficiency replacements, and Spellcasting learning/swapping rules).
 */
export function validateLevelUp(
  state: CharacterBuildState,
  request: LevelUpRequest,
  compendium: SrdCompendium = createCompendium(),
): LevelUpValidationResult {
  const effectiveClassId = request.classId ?? state.classes[0]?.classId ?? 'fighter';
  const requirements = getLevelUpRequirements(
    state,
    effectiveClassId,
    compendium,
    request.subclassId,
  );
  const errors: string[] = [];

  if (requirements.previousTotalLevel >= MAX_CHARACTER_LEVEL) {
    errors.push(
      `Character is already at maximum level ${MAX_CHARACTER_LEVEL} and cannot level up further.`,
    );
  }

  if (request.enforceXpRequirement) {
    const requiredXp = getXpThresholdForLevel(requirements.targetTotalLevel);
    if (state.runtime.xp < requiredXp) {
      errors.push(
        `Insufficient XP to reach level ${requirements.targetTotalLevel}: requires ${requiredXp} XP, but character has ${state.runtime.xp} XP.`,
      );
    }
  }

  const classData = compendium.getClass(effectiveClassId);
  if (!classData) {
    errors.push(`Unknown SRD 5.1 Class ID '${effectiveClassId}'.`);
    return {
      valid: false,
      requirements,
      resolvedHpRoll: requirements.fixedHpRoll,
      errors,
    };
  }

  const enforceMulticlassPrereqs = request.enforceMulticlassPrerequisites ?? true;
  if (
    requirements.isNewMulticlass &&
    enforceMulticlassPrereqs &&
    !requirements.multiclassEligibility.eligible
  ) {
    errors.push(...requirements.multiclassEligibility.unmetPrerequisites);
  }

  // 1. Validate HP roll method
  const isFirstCharacterLevel = requirements.previousTotalLevel === 0;
  const hpResolution = resolveLevelUpHpRoll(classData.hitDie, isFirstCharacterLevel, {
    hpMethod: request.hpMethod,
    hpRoll: request.hpRoll,
    rngState: request.rngState,
  });
  if (hpResolution.error) {
    errors.push(hpResolution.error);
  }

  // 2. Validate Subclass selection
  const existingEntry = state.classes.find((c) => c.classId === effectiveClassId);
  const existingSubclassId = existingEntry?.subclassId;

  if (requirements.targetClassLevel < classData.subclassLevel) {
    if (request.subclassId !== undefined) {
      errors.push(
        `Class '${classData.name}' does not unlock ${classData.subclassTitle} until level ${classData.subclassLevel}, but subclassId '${request.subclassId}' was provided at level ${requirements.targetClassLevel}.`,
      );
    }
  } else {
    if (existingSubclassId) {
      if (request.subclassId !== undefined && request.subclassId !== existingSubclassId) {
        errors.push(
          `Class '${classData.name}' already has subclass '${existingSubclassId}' and cannot change it to '${request.subclassId}' on level-up.`,
        );
      }
    } else {
      if (!request.subclassId) {
        errors.push(
          `Class '${classData.name}' at level ${requirements.targetClassLevel} requires selecting a ${classData.subclassTitle} subclass.`,
        );
      } else {
        const subData = compendium.getSubclass(request.subclassId);
        if (!subData || subData.classId !== classData.id) {
          errors.push(
            `Subclass '${request.subclassId}' is not a valid ${classData.subclassTitle} for class '${classData.name}'.`,
          );
        }
      }
    }
  }

  // 3. Validate ASI / Feat selection
  const enforceAsiCap = request.enforceAbilityScoreCapOnAsi ?? true;
  if (requirements.requiresAsiOrFeat) {
    if (!request.asiOrFeat) {
      errors.push(
        `Class '${classData.name}' level ${requirements.targetClassLevel} requires an Ability Score Improvement (ASI) or Feat selection.`,
      );
    } else if (request.asiOrFeat.type === 'asi') {
      const bonusEntries = Object.entries(request.asiOrFeat.bonuses).filter(
        (pair): pair is [AbilityId, 1 | 2] => pair[1] !== undefined,
      );
      const bonusSum = bonusEntries.reduce((sum, [, val]) => sum + val, 0);
      const validValues = bonusEntries.every(([, val]) => val === 1 || val === 2);
      if (!validValues || bonusSum !== 2) {
        errors.push(
          `ASI at '${classData.name}' level ${requirements.targetClassLevel} must total +2 (+2 to one ability or +1 to two abilities), got +${bonusSum}.`,
        );
      } else if (enforceAsiCap) {
        const currentScores = computeAbilityScoresForPrerequisites(state, compendium);
        const isBarbarianReaching20 =
          classData.id === 'barbarian' && requirements.targetClassLevel === 20;
        for (const [ab, bonus] of bonusEntries) {
          const cap =
            isBarbarianReaching20 && (ab === 'str' || ab === 'con') ? 24 : 20;
          if (currentScores[ab] + bonus > cap) {
            errors.push(
              `ASI cannot increase ${ABILITY_NAMES[ab]} (${currentScores[ab]} + ${bonus} = ${currentScores[ab] + bonus}) above the maximum score of ${cap}.`,
            );
          }
        }
      }
    } else {
      const featId = request.asiOrFeat.featId;
      const featInfo = requirements.availableFeats.find((f) => f.feat.id === featId);
      if (!featInfo) {
        errors.push(
          `Unknown SRD 5.1 Feat ID '${featId}' at '${classData.name}' level ${requirements.targetClassLevel}.`,
        );
      } else {
        if (!featInfo.eligible) {
          errors.push(...featInfo.unmetPrerequisites);
        }
        for (const choice of featInfo.feat.choices ?? []) {
          const res = validateChoiceSpecSelection(
            choice,
            request.asiOrFeat.choices?.[choice.id],
            {
              compendium,
              subChoiceSelections: request.asiOrFeat.choices,
            },
          );
          errors.push(...res.errors);
        }
      }
    }
  } else if (request.asiOrFeat !== undefined) {
    errors.push(
      `Class '${classData.name}' does not grant an Ability Score Improvement or Feat at level ${requirements.targetClassLevel}.`,
    );
  }

  // 4. Validate Spellcasting Updates
  const spReqs = requirements.spellcasting;
  const spUpdates = request.spellcastingUpdates;
  const requireSpells = request.requireSpellSelections ?? false;

  if (spUpdates || requireSpells) {
    const addedCantrips = spUpdates?.addedCantripIds ?? [];
    const addedKnown = spUpdates?.addedKnownSpellIds ?? [];
    const addedBook = spUpdates?.addedSpellbookSpellIds ?? [];
    const replaceSwap = spUpdates?.replaceKnownSpell;

    if (requireSpells && addedCantrips.length !== spReqs.newCantripsRequired) {
      errors.push(
        `Level-up to '${classData.name}' level ${requirements.targetClassLevel} requires selecting ${spReqs.newCantripsRequired} new cantrip(s), got ${addedCantrips.length}.`,
      );
    } else if (addedCantrips.length > spReqs.newCantripsRequired) {
      errors.push(
        `Level-up to '${classData.name}' level ${requirements.targetClassLevel} allows at most ${spReqs.newCantripsRequired} new cantrip(s), got ${addedCantrips.length}.`,
      );
    }

    const allowedCantripSet = new Set(spReqs.allowedCantripIds);
    const seenCantrips = new Set<string>();
    for (const cId of addedCantrips) {
      const spell = compendium.getSpell(cId);
      if (!spell || spell.level !== 0) {
        errors.push(`Selected cantrip '${cId}' is not a valid SRD 5.1 cantrip (level 0).`);
      } else if (state.spellcasting.knownCantripIds.includes(cId)) {
        errors.push(`Cantrip '${cId}' is already known by this character.`);
      } else if (seenCantrips.has(cId)) {
        errors.push(`Cantrip '${cId}' was selected more than once.`);
      } else if (!allowedCantripSet.has(cId)) {
        errors.push(
          `Cantrip '${cId}' is not on the '${classData.name}' cantrip list.`,
        );
      }
      seenCantrips.add(cId);
    }

    // Known spells validation
    if (spReqs.preparationMode === 'known') {
      if (requireSpells && addedKnown.length !== spReqs.newSpellsKnownRequired) {
        errors.push(
          `Level-up to '${classData.name}' level ${requirements.targetClassLevel} requires selecting ${spReqs.newSpellsKnownRequired} new known spell(s), got ${addedKnown.length}.`,
        );
      } else if (addedKnown.length > spReqs.newSpellsKnownRequired) {
        errors.push(
          `Level-up to '${classData.name}' level ${requirements.targetClassLevel} allows at most ${spReqs.newSpellsKnownRequired} new known spell(s), got ${addedKnown.length}.`,
        );
      }

      const allowedClassSpellSet = new Set(spReqs.allowedSpellIds);
      const seenKnown = new Set<string>();
      let offClassSpellsUsed = 0;

      for (const sId of addedKnown) {
        const spell = compendium.getSpell(sId);
        if (!spell) {
          errors.push(`Unknown SRD 5.1 Spell ID '${sId}'.`);
          continue;
        }
        if (spell.level < 1 || spell.level > spReqs.maxLearnableSpellLevel) {
          errors.push(
            `Spell '${spell.name}' (level ${spell.level}) exceeds the maximum spell level (${spReqs.maxLearnableSpellLevel}) learnable by a level ${requirements.targetClassLevel} ${classData.name}.`,
          );
          continue;
        }
        if (state.spellcasting.knownSpellIds.includes(sId)) {
          errors.push(`Spell '${spell.name}' (${sId}) is already known.`);
          continue;
        }
        if (seenKnown.has(sId)) {
          errors.push(`Spell '${spell.name}' (${sId}) was selected more than once.`);
          continue;
        }
        seenKnown.add(sId);

        if (!allowedClassSpellSet.has(sId)) {
          if (offClassSpellsUsed < spReqs.allowsAnyClassSpellsCount) {
            offClassSpellsUsed += 1;
          } else {
            errors.push(
              `Spell '${spell.name}' (${sId}) is not on the '${classData.name}' spell list.`,
            );
          }
        }
      }
    } else if (addedKnown.length > 0) {
      errors.push(
        `Class '${classData.name}' does not use spells known (preparation mode: '${spReqs.preparationMode ?? 'none'}'), but addedKnownSpellIds was provided.`,
      );
    }

    // Known spell 1-for-1 swap validation
    if (replaceSwap) {
      if (!spReqs.canSwapKnownSpell) {
        errors.push(
          `Class '${classData.name}' at level ${requirements.targetClassLevel} cannot swap a known spell.`,
        );
      } else {
        if (!state.spellcasting.knownSpellIds.includes(replaceSwap.removeSpellId)) {
          errors.push(
            `Cannot replace spell '${replaceSwap.removeSpellId}' because it is not currently in knownSpellIds.`,
          );
        }
        const addSpell = compendium.getSpell(replaceSwap.addSpellId);
        if (!addSpell) {
          errors.push(`Unknown replacement spell ID '${replaceSwap.addSpellId}'.`);
        } else if (
          addSpell.level < 1 ||
          addSpell.level > spReqs.maxLearnableSpellLevel
        ) {
          errors.push(
            `Replacement spell '${addSpell.name}' (level ${addSpell.level}) must be between level 1 and ${spReqs.maxLearnableSpellLevel}.`,
          );
        } else if (
          !spReqs.allowedSpellIds.includes(replaceSwap.addSpellId) &&
          !addSpell.classes.includes(classData.id)
        ) {
          errors.push(
            `Replacement spell '${addSpell.name}' is not on the '${classData.name}' spell list.`,
          );
        } else if (
          state.spellcasting.knownSpellIds.includes(replaceSwap.addSpellId) &&
          replaceSwap.addSpellId !== replaceSwap.removeSpellId
        ) {
          errors.push(
            `Replacement spell '${addSpell.name}' is already known.`,
          );
        }
      }
    }

    // Wizard spellbook additions validation
    if (spReqs.preparationMode === 'spellbook') {
      if (requireSpells && addedBook.length !== spReqs.newSpellbookSpellsAllowed) {
        errors.push(
          `Wizard level ${requirements.targetClassLevel} requires adding ${spReqs.newSpellbookSpellsAllowed} spell(s) to the spellbook, got ${addedBook.length}.`,
        );
      } else if (addedBook.length > spReqs.newSpellbookSpellsAllowed) {
        errors.push(
          `Wizard level ${requirements.targetClassLevel} allows adding at most ${spReqs.newSpellbookSpellsAllowed} free spell(s) to the spellbook, got ${addedBook.length}.`,
        );
      }

      const seenBook = new Set<string>();
      for (const sId of addedBook) {
        const spell = compendium.getSpell(sId);
        if (!spell) {
          errors.push(`Unknown SRD 5.1 Spell ID '${sId}' for Wizard spellbook.`);
          continue;
        }
        if (!spell.classes.includes('wizard')) {
          errors.push(
            `Spell '${spell.name}' (${sId}) is not on the Wizard spell list.`,
          );
        } else if (spell.level < 1 || spell.level > spReqs.maxLearnableSpellLevel) {
          errors.push(
            `Spell '${spell.name}' (level ${spell.level}) exceeds the maximum spell level (${spReqs.maxLearnableSpellLevel}) a level ${requirements.targetClassLevel} Wizard can add to their spellbook.`,
          );
        } else if (state.spellcasting.spellbookSpellIds.includes(sId)) {
          errors.push(
            `Spell '${spell.name}' (${sId}) is already in the Wizard's spellbook.`,
          );
        } else if (seenBook.has(sId)) {
          errors.push(
            `Spell '${spell.name}' (${sId}) was selected more than once for the spellbook.`,
          );
        }
        seenBook.add(sId);
      }
    } else if (addedBook.length > 0) {
      errors.push(
        `Class '${classData.name}' does not use a Wizard spellbook, but addedSpellbookSpellIds was provided.`,
      );
    }

    // Warlock Mystic Arcanum validation (L11/13/15/17)
    if (spUpdates?.mysticArcanumSpellId) {
      if (!spReqs.mysticArcanumSpellLevel) {
        errors.push(
          `Class '${classData.name}' level ${requirements.targetClassLevel} does not unlock a Mystic Arcanum spell.`,
        );
      } else {
        const arcanumSpell = compendium.getSpell(spUpdates.mysticArcanumSpellId);
        if (!arcanumSpell) {
          errors.push(
            `Unknown Mystic Arcanum spell ID '${spUpdates.mysticArcanumSpellId}'.`,
          );
        } else if (
          !arcanumSpell.classes.includes('warlock') ||
          arcanumSpell.level !== spReqs.mysticArcanumSpellLevel
        ) {
          errors.push(
            `Mystic Arcanum at Warlock level ${requirements.targetClassLevel} requires a level ${spReqs.mysticArcanumSpellLevel} Warlock spell (got '${arcanumSpell.name}', level ${arcanumSpell.level}).`,
          );
        }
      }
    }
  }

  // 5. Build candidate state and run full Choice Tree & Duplicate Proficiency validation
  if (requirements.targetTotalLevel <= MAX_CHARACTER_LEVEL) {
    const candidateState = buildUpdatedStateForLevelUp(
      state,
      requirements,
      request,
      hpResolution.roll,
      compendium,
    );

    // Check required featureChoices at targetClassLevel
    const levelSelections = request.choiceSelections ?? {};
    for (const fChoice of requirements.featureChoices) {
      // Multiclass skill/tool choices at secondary L1 and Warlock additional invocations are validated if required or present
      const isSecondaryClassProfChoice =
        requirements.isNewMulticlass &&
        (fChoice.id === classData.skillChoices.id ||
          classData.toolChoices?.some((tc) => tc.id === fChoice.id));
      const isScalingInvocationOrMetamagic =
        (classData.id === 'warlock' &&
          requirements.targetClassLevel > 2 &&
          fChoice.id === 'warlock-invocations') ||
        (classData.id === 'sorcerer' &&
          requirements.targetClassLevel > 3 &&
          fChoice.id === 'sorcerer-metamagic');

      if (
        (isSecondaryClassProfChoice || isScalingInvocationOrMetamagic) &&
        !(fChoice.id in levelSelections)
      ) {
        continue;
      }

      if (!(fChoice.id in levelSelections)) {
        errors.push(
          `Level-up to '${classData.name}' level ${requirements.targetClassLevel} requires choice '${fChoice.id}' (${fChoice.label}).`,
        );
      }
    }

    const choiceValidation = validateCharacterChoices(candidateState, compendium, {
      requireStartingEquipmentChoices: false,
      requireAsiSelections: false,
      requireExpertiseChoices: false,
    });

    // Collect any errors from the updated class entry or duplicate proficiencies
    const updatedClassResult = choiceValidation.classes.entries.find(
      (e) => e.classId === effectiveClassId,
    );
    if (updatedClassResult) {
      for (const err of updatedClassResult.errors) {
        if (!errors.includes(err)) {
          errors.push(err);
        }
      }
    }
    for (const dupErr of choiceValidation.unresolvedDuplicates.flatMap((d) => d.errors)) {
      if (!errors.includes(dupErr)) {
        errors.push(dupErr);
      }
    }

    return {
      valid: errors.length === 0,
      requirements,
      resolvedHpRoll: hpResolution.roll,
      nextRngState: hpResolution.nextRngState,
      candidateState,
      errors,
    };
  }

  return {
    valid: false,
    requirements,
    resolvedHpRoll: hpResolution.roll,
    nextRngState: hpResolution.nextRngState,
    errors,
  };
}

function buildLevelUpSummary(
  previousState: CharacterBuildState,
  previousSheet: DerivedCharacterSheet,
  nextState: CharacterBuildState,
  nextSheet: DerivedCharacterSheet,
  classId: string,
  resolvedHpRoll: number,
  request?: LevelUpRequest,
  compendium: SrdCompendium = createCompendium(),
): LevelUpSummary {
  const prevClassEntry = previousState.classes.find((c) => c.classId === classId);
  const nextClassEntry = nextState.classes.find((c) => c.classId === classId)!;
  const classData = compendium.getClass(classId);

  const isNewMulticlass = prevClassEntry === undefined;
  const previousClassLevel = prevClassEntry?.level ?? 0;
  const newClassLevel = nextClassEntry.level;

  const subclassUnlockedId =
    !prevClassEntry?.subclassId && nextClassEntry.subclassId
      ? nextClassEntry.subclassId
      : undefined;
  const subclassUnlockedName = subclassUnlockedId
    ? compendium.getSubclass(subclassUnlockedId)?.name
    : undefined;

  const asiOrFeatApplied = nextClassEntry.asiOrFeatByLevel[newClassLevel];

  const abilityScoreChanges: LevelUpSummary['abilityScoreChanges'] = [];
  for (const ab of ABILITY_IDS) {
    const prevAb = previousSheet.abilities[ab];
    const nextAb = nextSheet.abilities[ab];
    if (prevAb.score !== nextAb.score || prevAb.modifier !== nextAb.modifier) {
      abilityScoreChanges.push({
        ability: ab,
        previousScore: prevAb.score,
        newScore: nextAb.score,
        previousModifier: prevAb.modifier,
        newModifier: nextAb.modifier,
      });
    }
  }

  const prevFeatureSet = new Set(previousSheet.featureIds);
  const unlockedFeatureIds = nextSheet.featureIds.filter((id) => !prevFeatureSet.has(id));

  const prevFeatSet = new Set(previousSheet.featIds);
  const unlockedFeatId = nextSheet.featIds.find((id) => !prevFeatSet.has(id));

  const prevCantripSet = new Set(previousState.spellcasting.knownCantripIds);
  const addedCantripIds = nextState.spellcasting.knownCantripIds.filter(
    (id) => !prevCantripSet.has(id),
  );

  const prevKnownSet = new Set(previousState.spellcasting.knownSpellIds);
  const addedKnownSpellIds = nextState.spellcasting.knownSpellIds.filter(
    (id) => !prevKnownSet.has(id) && id !== request?.spellcastingUpdates?.replaceKnownSpell?.addSpellId,
  );

  const prevBookSet = new Set(previousState.spellcasting.spellbookSpellIds);
  const addedSpellbookSpellIds = nextState.spellcasting.spellbookSpellIds.filter(
    (id) => !prevBookSet.has(id),
  );

  const prevAlwaysPrepSet = new Set(previousSheet.spellcasting.alwaysPreparedSpellIds);
  const newlyAlwaysPreparedSpellIds = nextSheet.spellcasting.alwaysPreparedSpellIds.filter(
    (id) => !prevAlwaysPrepSet.has(id),
  );

  const previousSpellSlots: SpellSlotCountsByLevel = {
    1: previousSheet.spellcasting.spellSlots[1].max,
    2: previousSheet.spellcasting.spellSlots[2].max,
    3: previousSheet.spellcasting.spellSlots[3].max,
    4: previousSheet.spellcasting.spellSlots[4].max,
    5: previousSheet.spellcasting.spellSlots[5].max,
    6: previousSheet.spellcasting.spellSlots[6].max,
    7: previousSheet.spellcasting.spellSlots[7].max,
    8: previousSheet.spellcasting.spellSlots[8].max,
    9: previousSheet.spellcasting.spellSlots[9].max,
  };
  const newSpellSlots: SpellSlotCountsByLevel = {
    1: nextSheet.spellcasting.spellSlots[1].max,
    2: nextSheet.spellcasting.spellSlots[2].max,
    3: nextSheet.spellcasting.spellSlots[3].max,
    4: nextSheet.spellcasting.spellSlots[4].max,
    5: nextSheet.spellcasting.spellSlots[5].max,
    6: nextSheet.spellcasting.spellSlots[6].max,
    7: nextSheet.spellcasting.spellSlots[7].max,
    8: nextSheet.spellcasting.spellSlots[8].max,
    9: nextSheet.spellcasting.spellSlots[9].max,
  };

  const previousPactMagic = previousSheet.spellcasting.pactMagic
    ? {
        slotLevel: previousSheet.spellcasting.pactMagic.slotLevel,
        maxSlots: previousSheet.spellcasting.pactMagic.maxSlots,
      }
    : undefined;
  const newPactMagic = nextSheet.spellcasting.pactMagic
    ? {
        slotLevel: nextSheet.spellcasting.pactMagic.slotLevel,
        maxSlots: nextSheet.spellcasting.pactMagic.maxSlots,
      }
    : undefined;

  const hpGained = Math.max(0, nextSheet.maxHp - previousSheet.maxHp);

  return {
    classId,
    className: classData?.name ?? classId,
    isNewMulticlass,
    previousClassLevel,
    newClassLevel,
    previousTotalLevel: previousSheet.totalLevel,
    newTotalLevel: nextSheet.totalLevel,
    previousProficiencyBonus: previousSheet.proficiencyBonus,
    newProficiencyBonus: nextSheet.proficiencyBonus,
    hpRoll: resolvedHpRoll,
    conModifierContribution: nextSheet.abilities.con.modifier,
    previousMaxHp: previousSheet.maxHp,
    newMaxHp: nextSheet.maxHp,
    hpGained,
    ...(subclassUnlockedId ? { subclassUnlockedId } : {}),
    ...(subclassUnlockedName ? { subclassUnlockedName } : {}),
    ...(asiOrFeatApplied ? { asiOrFeatApplied } : {}),
    abilityScoreChanges,
    unlockedFeatureIds,
    ...(unlockedFeatId ? { unlockedFeatId } : {}),
    addedCantripIds,
    addedKnownSpellIds,
    ...(request?.spellcastingUpdates?.replaceKnownSpell
      ? { replacedKnownSpell: request.spellcastingUpdates.replaceKnownSpell }
      : {}),
    addedSpellbookSpellIds,
    newlyAlwaysPreparedSpellIds,
    previousSpellSlots,
    newSpellSlots,
    ...(previousPactMagic ? { previousPactMagic } : {}),
    ...(newPactMagic ? { newPactMagic } : {}),
  };
}

/**
 * Validates and applies a single character level-up (`L -> L+1`), updating class progression,
 * subclass unlock, ASI/Feat, feature choices, spellcasting selections, and `runtime.currentHp`,
 * and returning the new `CharacterBuildState`, `DerivedCharacterSheet`, and `LevelUpSummary`.
 *
 * Throws an `Error` if validation fails. Use `tryApplyLevelUp()` for non-throwing result handling.
 */
export function applyLevelUp(
  state: CharacterBuildState,
  request: LevelUpRequest,
  compendium: SrdCompendium = createCompendium(),
): LevelUpExecutionResult {
  const validation = validateLevelUp(state, request, compendium);
  if (!validation.valid || !validation.candidateState) {
    throw new Error(
      `Invalid character level-up for '${state.name}': ${validation.errors.join(' ')}`,
    );
  }

  const previousSheet = computeDerivedCharacter(state, compendium);
  const prelimNextSheet = computeDerivedCharacter(validation.candidateState, compendium);
  const hpGain = Math.max(0, prelimNextSheet.maxHp - previousSheet.maxHp);
  const updatedCurrentHp = Math.min(
    prelimNextSheet.maxHp,
    Math.max(0, state.runtime.currentHp + hpGain),
  );

  const finalState: CharacterBuildState = {
    ...validation.candidateState,
    runtime: {
      ...validation.candidateState.runtime,
      currentHp: updatedCurrentHp,
    },
  };

  const finalSheet = computeDerivedCharacter(finalState, compendium);
  const summary = buildLevelUpSummary(
    state,
    previousSheet,
    finalState,
    finalSheet,
    validation.requirements.classId,
    validation.resolvedHpRoll,
    request,
    compendium,
  );

  return {
    state: finalState,
    sheet: finalSheet,
    summary,
    nextRngState: validation.nextRngState,
  };
}

/**
 * Non-throwing wrapper around `applyLevelUp()` that returns `{ ok: true, result }` or `{ ok: false, validation }`.
 */
export function tryApplyLevelUp(
  state: CharacterBuildState,
  request: LevelUpRequest,
  compendium: SrdCompendium = createCompendium(),
):
  | { ok: true; result: LevelUpExecutionResult; validation: LevelUpValidationResult }
  | { ok: false; validation: LevelUpValidationResult } {
  const validation = validateLevelUp(state, request, compendium);
  if (!validation.valid || !validation.candidateState) {
    return { ok: false, validation };
  }
  const result = applyLevelUp(state, request, compendium);
  return { ok: true, result, validation };
}

/**
 * Applies a direct `CharacterClassEntry` update from a `LEVEL_UP_CHARACTER` transport command
 * (`{ type: 'LEVEL_UP_CHARACTER', characterId, classEntryUpdate }`), verifying that the update
 * advances the target class by exactly 1 level (or adds a new level 1 multiclass entry) and
 * satisfies all SRD 5.1 progression rules.
 */
export function applyClassEntryLevelUp(
  state: CharacterBuildState,
  classEntryUpdate: CharacterClassEntry,
  compendium: SrdCompendium = createCompendium(),
  options?: {
    enforceXpRequirement?: boolean | undefined;
    enforceMulticlassPrerequisites?: boolean | undefined;
    enforceAbilityScoreCapOnAsi?: boolean | undefined;
    spellcastingUpdates?: LevelUpSpellcastingUpdates | undefined;
    duplicateReplacements?: Readonly<Record<string, readonly string[]>> | undefined;
  },
): LevelUpExecutionResult {
  const existingEntry = state.classes.find((c) => c.classId === classEntryUpdate.classId);
  const expectedNewLevel = (existingEntry?.level ?? 0) + 1;

  if (classEntryUpdate.level !== expectedNewLevel) {
    throw new Error(
      `Invalid classEntryUpdate for '${classEntryUpdate.classId}': expected level ${expectedNewLevel}, got ${classEntryUpdate.level}.`,
    );
  }

  if (classEntryUpdate.hpRollsByLevel.length !== expectedNewLevel) {
    throw new Error(
      `Invalid classEntryUpdate for '${classEntryUpdate.classId}': hpRollsByLevel length (${classEntryUpdate.hpRollsByLevel.length}) must match level (${expectedNewLevel}).`,
    );
  }

  if (existingEntry) {
    for (let i = 0; i < existingEntry.hpRollsByLevel.length; i++) {
      if (classEntryUpdate.hpRollsByLevel[i] !== existingEntry.hpRollsByLevel[i]) {
        throw new Error(
          `Invalid classEntryUpdate for '${classEntryUpdate.classId}': cannot alter previous HP roll at level ${i + 1}.`,
        );
      }
    }
  }

  const newHpRoll = classEntryUpdate.hpRollsByLevel[expectedNewLevel - 1]!;
  const newChoiceSelections = classEntryUpdate.choiceSelectionsByLevel[expectedNewLevel];
  const newAsiOrFeat = classEntryUpdate.asiOrFeatByLevel[expectedNewLevel];

  return applyLevelUp(
    state,
    {
      classId: classEntryUpdate.classId,
      subclassId: classEntryUpdate.subclassId,
      hpMethod: 'manual',
      hpRoll: newHpRoll,
      choiceSelections: newChoiceSelections,
      asiOrFeat: newAsiOrFeat,
      spellcastingUpdates: options?.spellcastingUpdates,
      duplicateReplacements: options?.duplicateReplacements,
      enforceXpRequirement: options?.enforceXpRequirement,
      enforceMulticlassPrerequisites: options?.enforceMulticlassPrerequisites,
      enforceAbilityScoreCapOnAsi: options?.enforceAbilityScoreCapOnAsi,
    },
    compendium,
  );
}
