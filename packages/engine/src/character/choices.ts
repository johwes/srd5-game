import {
  ABILITY_IDS,
  type AbilityId,
  type ChoiceSpec,
  type EquipmentOptionBranch,
  type FeatureOptionChoiceSpec,
  type ProficiencyChoiceSpec,
  SKILL_IDS,
  type SkillId,
  type SrdCompendium,
  createCompendium,
  screenHomebrewRecord,
} from '@srd5/data';
import type {
  CharacterBuildState,
  CharacterClassEntry,
  CustomBackgroundSpec,
  DerivedProficiencies,
} from './schemas.js';

// ============================================================================
// 1. Constants & Core Types
// ============================================================================

/**
 * Proficiency categories subject to the SRD 5.1 Duplicate Proficiency Replacement Rule.
 */
export const DUPLICATE_PROFICIENCY_CATEGORIES = ['skill', 'tool', 'language'] as const;
export type DuplicateProficiencyCategory = (typeof DUPLICATE_PROFICIENCY_CATEGORIES)[number];

/**
 * Source category of a `ChoiceSpec` node in the character's Choice Tree.
 */
export type ChoiceOriginKind =
  | 'race'
  | 'subrace'
  | 'background'
  | 'class'
  | 'subclass'
  | 'feature'
  | 'feat'
  | 'duplicate_replacement';

/**
 * Canonical SRD 5.1 Ranger Favored Enemy options (for optional `favored-enemy` choices).
 */
export const SRD_FAVORED_ENEMY_OPTIONS = [
  'aberrations',
  'beasts',
  'celestials',
  'constructs',
  'dragons',
  'elementals',
  'fey',
  'fiends',
  'giants',
  'monstrosities',
  'oozes',
  'plants',
  'undead',
  'humanoids',
] as const;

/**
 * Canonical SRD 5.1 Ranger Natural Explorer terrain options (for optional `natural-explorer` choices).
 */
export const SRD_NATURAL_EXPLORER_OPTIONS = [
  'arctic',
  'coast',
  'desert',
  'forest',
  'grassland',
  'mountain',
  'swamp',
  'underdark',
] as const;

const SKILL_ID_SET: ReadonlySet<string> = new Set(SKILL_IDS);
const ABILITY_ID_SET: ReadonlySet<string> = new Set(ABILITY_IDS);

/**
 * Returns the canonical `ChoiceSpec.id` used to replace a duplicate proficiency
 * under the SRD 5.1 Duplicate Proficiency Rule (`"replace:<category>:<proficiencyId>"`).
 */
export function getDuplicateReplacementChoiceId(
  category: DuplicateProficiencyCategory,
  proficiencyId: string,
): string {
  return `replace:${category}:${proficiencyId}`;
}

/**
 * Parses a `"replace:<category>:<proficiencyId>"` choice key if it matches the canonical format.
 */
export function parseDuplicateReplacementChoiceId(choiceId: string):
  | {
      category: DuplicateProficiencyCategory;
      proficiencyId: string;
    }
  | undefined {
  const match = /^replace:(skill|tool|language):([a-z0-9-]+)$/.exec(choiceId);
  if (!match) {
    return undefined;
  }
  return {
    category: match[1] as DuplicateProficiencyCategory,
    proficiencyId: match[2]!,
  };
}

/**
 * Returns a new `CharacterBuildState` with the given duplicate proficiency replacement
 * stored in `backgroundChoices` under its canonical replacement choice ID.
 */
export function applyDuplicateProficiencyReplacement(
  state: CharacterBuildState,
  category: DuplicateProficiencyCategory,
  duplicateProficiencyId: string,
  replacementProficiencyIds: readonly string[],
): CharacterBuildState {
  const choiceId = getDuplicateReplacementChoiceId(category, duplicateProficiencyId);
  return {
    ...state,
    backgroundChoices: {
      ...state.backgroundChoices,
      [choiceId]: [...replacementProficiencyIds],
    },
  };
}

// ============================================================================
// 2. Validation Result Interfaces
// ============================================================================

export interface ChoiceValidationContext {
  compendium: SrdCompendium;
  /** Feature option IDs already chosen in the same `featureGroup` at earlier levels. */
  alreadyChosenFeatureOptions?: ReadonlySet<string> | undefined;
  /** Sub-selections for `equipment_bundle` branches that contain `category_choice` entries. */
  subChoiceSelections?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface SingleChoiceValidationResult {
  valid: boolean;
  choiceId: string;
  choiceType: ChoiceSpec['type'];
  expectedCount: number;
  selected: string[];
  normalizedSelected: string[];
  allowedOptions: string[];
  missingCount: number;
  extraCount: number;
  duplicateOptions: string[];
  invalidOptions: string[];
  errors: string[];
}

export interface ChoiceNode {
  choice: ChoiceSpec;
  originKind: ChoiceOriginKind;
  originId: string;
  originName: string;
  classId?: string | undefined;
  classLevel?: number | undefined;
  selected: string[];
  normalizedSelected: string[];
  allowedOptions: string[];
  valid: boolean;
  errors: string[];
}

export interface ProficiencyGrantRecord {
  category: 'armor' | 'weapon' | 'tool' | 'saving_throw' | 'skill' | 'language';
  proficiencyId: string;
  sourceKind:
    | 'race'
    | 'subrace'
    | 'background'
    | 'custom_background'
    | 'class'
    | 'subclass'
    | 'feature'
    | 'feat'
    | 'replacement';
  sourceId: string;
  sourceName: string;
  isFixed: boolean;
  choiceId?: string | undefined;
}

export interface DuplicateProficiencyCollision {
  category: DuplicateProficiencyCategory;
  proficiencyId: string;
  duplicateCount: number;
  grants: ProficiencyGrantRecord[];
  replacementChoiceId: string;
  replacementChoiceSpec: ProficiencyChoiceSpec;
  availableReplacementOptions: string[];
  selectedReplacements: string[];
  resolved: boolean;
  errors: string[];
}

export interface OriginChoiceValidationResult {
  valid: boolean;
  raceId: string;
  subraceId?: string | undefined;
  subraceRequired: boolean;
  choiceNodes: ChoiceNode[];
  unexpectedChoiceKeys: string[];
  errors: string[];
}

export interface ClassEntryChoiceValidationResult {
  valid: boolean;
  classId: string;
  subclassId?: string | undefined;
  level: number;
  subclassRequired: boolean;
  choiceNodes: ChoiceNode[];
  unexpectedChoiceKeysByLevel: Record<number, string[]>;
  errors: string[];
}

export interface ClassChoiceValidationResult {
  valid: boolean;
  totalLevel: number;
  entries: ClassEntryChoiceValidationResult[];
  choiceNodes: ChoiceNode[];
  errors: string[];
}

export interface BackgroundChoiceValidationResult {
  valid: boolean;
  backgroundId: string;
  isCustom: boolean;
  choiceNodes: ChoiceNode[];
  unexpectedChoiceKeys: string[];
  errors: string[];
}

export interface ValidateCharacterChoicesOptions {
  /**
   * Whether `classData.startingEquipmentChoices` must be present in `choiceSelectionsByLevel[1]`
   * for the primary class. Defaults to `false` (validated only if any starting equipment choice is present,
   * since equipment can also be purchased with starting gold in Step 5).
   */
  requireStartingEquipmentChoices?: boolean | undefined;
  /**
   * Whether unlocked ASI levels (`asi-<classId>`) must have an entry in `asiOrFeatByLevel`.
   * Defaults to `true`.
   */
  requireAsiSelections?: boolean | undefined;
  /**
   * Whether Rogue (`expertise-rogue`) and Bard (`expertise-bard`) Expertise selections are
   * required at their unlocked levels even if omitted from `choiceSelectionsByLevel`.
   * Defaults to `false` (always validated when present; required when `true`).
   */
  requireExpertiseChoices?: boolean | undefined;
}

export interface CharacterChoiceTreeValidationResult {
  valid: boolean;
  origin: OriginChoiceValidationResult;
  classes: ClassChoiceValidationResult;
  background: BackgroundChoiceValidationResult;
  choiceNodes: ChoiceNode[];
  proficiencyGrants: ProficiencyGrantRecord[];
  duplicateProficiencies: DuplicateProficiencyCollision[];
  unresolvedDuplicates: DuplicateProficiencyCollision[];
  resolvedProficiencies: DerivedProficiencies;
  abilityBonusesFromChoices: Record<AbilityId, number>;
  bonusSpellIdsFromChoices: {
    cantripIds: string[];
    spellIds: string[];
  };
  selectedFeatureOptionIdsByGroup: Record<string, string[]>;
  errors: string[];
}

// ============================================================================
// 3. Single `ChoiceSpec` Validator
// ============================================================================

/**
 * Normalizes a selected option for a `feature_option` choice so both short names
 * (e.g., `"defense"` for `featureGroup: "fighting-style"`) and prefixed feature IDs
 * (e.g., `"fighting-style-defense"`) resolve to the canonical option in `choice.options`.
 */
export function normalizeFeatureOptionId(
  rawOption: string,
  choice: FeatureOptionChoiceSpec,
): string {
  const trimmed = rawOption.trim();
  if (choice.options.includes(trimmed)) {
    return trimmed;
  }

  const prefixed = `${choice.featureGroup}-${trimmed}`;
  if (choice.options.includes(prefixed)) {
    return prefixed;
  }

  const prefixWithDash = `${choice.featureGroup}-`;
  if (trimmed.startsWith(prefixWithDash)) {
    const stripped = trimmed.slice(prefixWithDash.length);
    if (choice.options.includes(stripped)) {
      return stripped;
    }
  }

  return trimmed;
}

/**
 * Validates a player's selection array against a single `ChoiceSpec` and `SrdCompendium`.
 */
export function validateChoiceSpecSelection(
  choice: ChoiceSpec,
  selectedInput: readonly string[] | undefined,
  context: ChoiceValidationContext,
): SingleChoiceValidationResult {
  const { compendium } = context;
  const selected = selectedInput ? [...selectedInput] : [];
  const allowedOptions = [...compendium.resolveChoiceOptions(choice)];
  const allowedSet = new Set(allowedOptions);
  const errors: string[] = [];

  const normalizedSelected = selected.map((opt) =>
    choice.type === 'feature_option' ? normalizeFeatureOptionId(opt, choice) : opt.trim(),
  );

  let missingCount = 0;
  let extraCount = 0;

  if (normalizedSelected.length < choice.count) {
    missingCount = choice.count - normalizedSelected.length;
    errors.push(
      `Choice '${choice.id}' (${choice.label}) requires ${choice.count} selection(s), but got ${normalizedSelected.length}.`,
    );
  } else if (normalizedSelected.length > choice.count) {
    extraCount = normalizedSelected.length - choice.count;
    errors.push(
      `Choice '${choice.id}' (${choice.label}) allows at most ${choice.count} selection(s), but got ${normalizedSelected.length}.`,
    );
  }

  // Check distinctness within the choice
  const requiresDistinct =
    choice.type !== 'ability_score_bonus' || choice.distinct !== false;
  const duplicateOptions: string[] = [];
  if (requiresDistinct && normalizedSelected.length > 1) {
    const seen = new Set<string>();
    for (const opt of normalizedSelected) {
      if (seen.has(opt)) {
        if (!duplicateOptions.includes(opt)) {
          duplicateOptions.push(opt);
        }
      } else {
        seen.add(opt);
      }
    }
    if (duplicateOptions.length > 0) {
      errors.push(
        `Choice '${choice.id}' requires distinct selections, but found duplicate option(s): [${duplicateOptions.join(', ')}].`,
      );
    }
  }

  // Check membership in allowed options and type-specific constraints
  const invalidOptions: string[] = [];
  for (const opt of normalizedSelected) {
    if (!allowedSet.has(opt)) {
      invalidOptions.push(opt);
      if (
        choice.type === 'ability_score_bonus' &&
        choice.excludeAbilities?.includes(opt as AbilityId)
      ) {
        errors.push(
          `Choice '${choice.id}' excludes ability '${opt}' from receiving this bonus.`,
        );
      } else {
        errors.push(
          `Choice '${choice.id}' does not allow option '${opt}'. Allowed options: [${allowedOptions.join(', ')}].`,
        );
      }
      continue;
    }

    if (
      choice.type === 'feature_option' &&
      context.alreadyChosenFeatureOptions?.has(opt)
    ) {
      invalidOptions.push(opt);
      errors.push(
        `Feature option '${opt}' in group '${choice.featureGroup}' has already been selected by an earlier feature choice.`,
      );
    }
  }

  // If equipment_bundle branch has category_choice items and subChoiceSelections are provided, validate them
  if (choice.type === 'equipment_bundle' && context.subChoiceSelections) {
    for (const branchId of normalizedSelected) {
      const branch = choice.options.find((b) => b.id === branchId);
      if (!branch) continue;
      validateEquipmentBundleBranchSubChoices(
        choice.id,
        branch,
        context.subChoiceSelections,
        compendium,
        errors,
        invalidOptions,
      );
    }
  }

  return {
    valid: errors.length === 0,
    choiceId: choice.id,
    choiceType: choice.type,
    expectedCount: choice.count,
    selected,
    normalizedSelected,
    allowedOptions,
    missingCount,
    extraCount,
    duplicateOptions,
    invalidOptions,
    errors,
  };
}

function validateEquipmentBundleBranchSubChoices(
  choiceId: string,
  branch: EquipmentOptionBranch,
  subChoiceSelections: Readonly<Record<string, readonly string[]>>,
  compendium: SrdCompendium,
  errors: string[],
  invalidOptions: string[],
): void {
  const categoryItems = branch.items.filter(
    (item): item is Extract<typeof item, { kind: 'category_choice' }> =>
      item.kind === 'category_choice',
  );
  if (categoryItems.length === 0) {
    return;
  }

  const subKey = `${choiceId}:${branch.id}`;
  const subSelected = subChoiceSelections[subKey];
  if (!subSelected) {
    return;
  }

  const totalExpected = categoryItems.reduce((sum, c) => sum + c.count, 0);
  if (subSelected.length !== totalExpected) {
    errors.push(
      `Equipment bundle sub-choice '${subKey}' requires ${totalExpected} item(s), but got ${subSelected.length}.`,
    );
    return;
  }

  let offset = 0;
  for (const catItem of categoryItems) {
    const allowedEqIds = new Set(
      compendium.resolveEquipmentCategory(catItem.category).map((e) => e.id),
    );
    const slice = subSelected.slice(offset, offset + catItem.count);
    offset += catItem.count;
    for (const eqId of slice) {
      if (!allowedEqIds.has(eqId)) {
        invalidOptions.push(eqId);
        errors.push(
          `Equipment bundle sub-choice '${subKey}' item '${eqId}' is not a valid '${catItem.category}' item.`,
        );
      }
    }
  }
}

// ============================================================================
// 4. Proficiency Classification Helper
// ============================================================================

/**
 * Classifies a proficiency or item identifier into its canonical proficiency category.
 */
export function classifyProficiencyId(
  id: string,
  compendium: SrdCompendium,
): 'armor' | 'weapon' | 'tool' | 'saving_throw' | 'skill' | 'language' | undefined {
  if (SKILL_ID_SET.has(id)) {
    return 'skill';
  }
  if (compendium.getLanguage(id)) {
    return 'language';
  }
  if (compendium.getTool(id)) {
    return 'tool';
  }
  if (compendium.getWeapon(id)) {
    return 'weapon';
  }
  if (compendium.getArmor(id)) {
    return 'armor';
  }
  const profDef = compendium.getProficiency(id);
  if (profDef && profDef.category !== 'other') {
    return profDef.category;
  }
  return undefined;
}

// ============================================================================
// 5. Step 1: Origin (Race & Subrace) Choice Validator
// ============================================================================

/**
 * Validates Step 1 (Race, Subrace, and racial `ChoiceSpec` selections) of a `CharacterBuildState`.
 */
export function validateOriginChoices(
  state: Pick<CharacterBuildState, 'raceId' | 'subraceId' | 'racialChoices'>,
  compendium: SrdCompendium = createCompendium(),
): OriginChoiceValidationResult {
  const errors: string[] = [];
  const choiceNodes: ChoiceNode[] = [];
  const expectedChoiceIds = new Set<string>();

  const race = compendium.getRace(state.raceId);
  if (!race) {
    errors.push(`Unknown SRD 5.1 Race ID '${state.raceId}'.`);
    return {
      valid: false,
      raceId: state.raceId,
      subraceId: state.subraceId,
      subraceRequired: false,
      choiceNodes,
      unexpectedChoiceKeys: Object.keys(state.racialChoices),
      errors,
    };
  }

  const subraceRequired = race.subraceIds.length > 0;
  const subrace = state.subraceId ? compendium.getSubrace(state.subraceId) : undefined;

  if (subraceRequired) {
    if (!state.subraceId) {
      errors.push(
        `Race '${race.name}' (${race.id}) requires selecting a subrace (${race.subraceIds.join(', ')}).`,
      );
    } else if (!subrace || !race.subraceIds.includes(state.subraceId)) {
      errors.push(
        `Subrace '${state.subraceId}' is not a valid subrace for '${race.name}' (valid: ${race.subraceIds.join(', ')}).`,
      );
    }
  } else if (state.subraceId !== undefined) {
    errors.push(
      `Race '${race.name}' (${race.id}) does not have subraces, but subraceId '${state.subraceId}' was provided.`,
    );
  }

  const evaluateOriginChoice = (
    choice: ChoiceSpec,
    originKind: 'race' | 'subrace',
    originId: string,
    originName: string,
  ): void => {
    expectedChoiceIds.add(choice.id);
    const res = validateChoiceSpecSelection(choice, state.racialChoices[choice.id], {
      compendium,
      subChoiceSelections: state.racialChoices,
    });
    choiceNodes.push({
      choice,
      originKind,
      originId,
      originName,
      selected: res.selected,
      normalizedSelected: res.normalizedSelected,
      allowedOptions: res.allowedOptions,
      valid: res.valid,
      errors: res.errors,
    });
    errors.push(...res.errors);
  };

  for (const choice of race.choices) {
    evaluateOriginChoice(choice, 'race', race.id, race.name);
  }
  for (const trait of race.traits) {
    for (const choice of trait.choices ?? []) {
      evaluateOriginChoice(choice, 'race', trait.id, `${race.name}: ${trait.name}`);
    }
  }

  if (subrace && race.subraceIds.includes(subrace.id)) {
    for (const choice of subrace.choices) {
      evaluateOriginChoice(choice, 'subrace', subrace.id, subrace.name);
    }
    for (const trait of subrace.traits) {
      for (const choice of trait.choices ?? []) {
        evaluateOriginChoice(
          choice,
          'subrace',
          trait.id,
          `${subrace.name}: ${trait.name}`,
        );
      }
    }
  }

  const unexpectedChoiceKeys: string[] = [];
  for (const key of Object.keys(state.racialChoices)) {
    if (expectedChoiceIds.has(key)) continue;
    if (parseDuplicateReplacementChoiceId(key)) continue;
    unexpectedChoiceKeys.push(key);
    errors.push(`Unexpected racial choice key '${key}' for race '${race.id}'.`);
  }

  return {
    valid: errors.length === 0,
    raceId: state.raceId,
    subraceId: state.subraceId,
    subraceRequired,
    choiceNodes,
    unexpectedChoiceKeys,
    errors,
  };
}

// ============================================================================
// 6. Step 4: Background Choice Validator
// ============================================================================

function validateCustomBackground(
  customBg: CustomBackgroundSpec,
  compendium: SrdCompendium,
): string[] {
  const errors: string[] = [];

  const piResult = screenHomebrewRecord({
    name: customBg.name,
    description: customBg.description,
    source: customBg.source,
    humanReviewed: customBg.humanReviewed,
    feature: customBg.feature,
  });
  if (!piResult.valid) {
    for (const v of piResult.violations) {
      errors.push(`Custom background Product Identity violation: ${v}`);
    }
  }

  const [skillA, skillB] = customBg.skillProficiencies;
  if (!SKILL_ID_SET.has(skillA)) {
    errors.push(`Custom background skill '${skillA}' is not a valid SRD skill.`);
  }
  if (!SKILL_ID_SET.has(skillB)) {
    errors.push(`Custom background skill '${skillB}' is not a valid SRD skill.`);
  }
  if (skillA === skillB) {
    errors.push(
      `Custom background must select 2 distinct skill proficiencies, but '${skillA}' was selected twice.`,
    );
  }

  const seenTools = new Set<string>();
  for (const toolId of customBg.toolProficiencies) {
    if (!compendium.getTool(toolId)) {
      errors.push(`Custom background tool '${toolId}' is not a valid SRD tool.`);
    }
    if (seenTools.has(toolId)) {
      errors.push(`Custom background contains duplicate tool proficiency '${toolId}'.`);
    }
    seenTools.add(toolId);
  }

  const seenLanguages = new Set<string>();
  for (const langId of customBg.languages) {
    if (!compendium.getLanguage(langId)) {
      errors.push(`Custom background language '${langId}' is not a valid SRD language.`);
    }
    if (seenLanguages.has(langId)) {
      errors.push(`Custom background contains duplicate language '${langId}'.`);
    }
    seenLanguages.add(langId);
  }

  const totalToolsAndLanguages =
    customBg.toolProficiencies.length + customBg.languages.length;
  if (totalToolsAndLanguages !== 2) {
    errors.push(
      `Custom SRD background must grant a combined total of 2 tool proficiencies or languages, but got ${totalToolsAndLanguages}.`,
    );
  }

  return errors;
}

/**
 * Validates Step 4 (Background or Custom SRD Background and `backgroundChoices`) of a `CharacterBuildState`.
 */
export function validateBackgroundChoices(
  state: Pick<
    CharacterBuildState,
    'backgroundId' | 'backgroundChoices' | 'customBackground'
  >,
  compendium: SrdCompendium = createCompendium(),
): BackgroundChoiceValidationResult {
  const errors: string[] = [];
  const choiceNodes: ChoiceNode[] = [];
  const expectedChoiceIds = new Set<string>();

  const isCustom = state.customBackground !== undefined || state.backgroundId === 'custom';

  if (isCustom) {
    if (!state.customBackground) {
      errors.push(
        "Background ID 'custom' requires a 'customBackground' specification (2 skills + 2 tools/languages).",
      );
    } else {
      errors.push(...validateCustomBackground(state.customBackground, compendium));
    }
  } else {
    const background = compendium.getBackground(state.backgroundId);
    if (!background) {
      errors.push(`Unknown SRD 5.1 Background ID '${state.backgroundId}'.`);
      return {
        valid: false,
        backgroundId: state.backgroundId,
        isCustom: false,
        choiceNodes,
        unexpectedChoiceKeys: Object.keys(state.backgroundChoices),
        errors,
      };
    }

    for (const choice of background.choices) {
      expectedChoiceIds.add(choice.id);
      const res = validateChoiceSpecSelection(
        choice,
        state.backgroundChoices[choice.id],
        {
          compendium,
          subChoiceSelections: state.backgroundChoices,
        },
      );
      choiceNodes.push({
        choice,
        originKind: 'background',
        originId: background.id,
        originName: background.name,
        selected: res.selected,
        normalizedSelected: res.normalizedSelected,
        allowedOptions: res.allowedOptions,
        valid: res.valid,
        errors: res.errors,
      });
      errors.push(...res.errors);
    }
  }

  const unexpectedChoiceKeys: string[] = [];
  for (const key of Object.keys(state.backgroundChoices)) {
    if (expectedChoiceIds.has(key)) continue;
    if (parseDuplicateReplacementChoiceId(key)) continue;
    unexpectedChoiceKeys.push(key);
    errors.push(
      `Unexpected background choice key '${key}' for background '${state.backgroundId}'.`,
    );
  }

  return {
    valid: errors.length === 0,
    backgroundId: state.backgroundId,
    isCustom,
    choiceNodes,
    unexpectedChoiceKeys,
    errors,
  };
}

// ============================================================================
// 7. Step 2: Class, Subclass, Feature, and ASI/Feat Choice Validator
// ============================================================================

const IMPLICIT_FEATURE_CHOICES: Readonly<Record<string, ChoiceSpec>> = {
  'favored-enemy': {
    id: 'favored-enemy',
    label: 'Choose a Favored Enemy type',
    count: 1,
    type: 'feature_option',
    featureGroup: 'favored-enemy',
    options: [...SRD_FAVORED_ENEMY_OPTIONS],
  },
  'natural-explorer': {
    id: 'natural-explorer',
    label: 'Choose a Natural Explorer favored terrain',
    count: 1,
    type: 'feature_option',
    featureGroup: 'natural-explorer',
    options: [...SRD_NATURAL_EXPLORER_OPTIONS],
  },
};

const RECOGNIZED_EXPERTISE_KEYS = new Set([
  'expertise-rogue',
  'rogue-expertise',
  'expertise-bard',
  'bard-expertise',
  'expertise',
]);

function computeRunningAbilityScores(
  state: Pick<
    CharacterBuildState,
    'raceId' | 'subraceId' | 'racialChoices' | 'baseAbilities' | 'classes'
  >,
  compendium: SrdCompendium,
  upToClassIndex: number,
  upToClassLevel: number,
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
        for (const ab of picked) {
          if (ABILITY_ID_SET.has(ab)) {
            scores[ab as AbilityId] += choice.bonus;
          }
        }
      }
    }
  }

  const subrace = state.subraceId ? compendium.getSubrace(state.subraceId) : undefined;
  if (subrace) {
    for (const ab of ABILITY_IDS) {
      scores[ab] += subrace.abilityBonuses[ab] ?? 0;
    }
  }

  for (let i = 0; i <= upToClassIndex && i < state.classes.length; i++) {
    const entry = state.classes[i]!;
    const maxLvl = i === upToClassIndex ? upToClassLevel : entry.level;
    for (const [lvlKey, sel] of Object.entries(entry.asiOrFeatByLevel)) {
      const lvl = Number(lvlKey);
      if (lvl >= maxLvl && i === upToClassIndex) continue;
      if (sel.type === 'asi') {
        for (const ab of ABILITY_IDS) {
          scores[ab] += sel.bonuses[ab] ?? 0;
        }
      } else {
        const feat = compendium.getFeat(sel.featId);
        if (feat?.abilityBonuses) {
          for (const ab of ABILITY_IDS) {
            scores[ab] += feat.abilityBonuses[ab] ?? 0;
          }
        }
      }
    }
  }

  return scores;
}

/**
 * Validates Step 2 (Classes, Subclasses, Class Skills/Tools, Feature `ChoiceSpec`s, and ASI/Feats).
 */
export function validateClassChoices(
  state: Pick<
    CharacterBuildState,
    'raceId' | 'subraceId' | 'racialChoices' | 'baseAbilities' | 'classes'
  >,
  compendium: SrdCompendium = createCompendium(),
  options?: ValidateCharacterChoicesOptions,
): ClassChoiceValidationResult {
  const requireStartingEquipment = options?.requireStartingEquipmentChoices ?? false;
  const requireAsiSelections = options?.requireAsiSelections ?? true;

  const errors: string[] = [];
  const entries: ClassEntryChoiceValidationResult[] = [];
  const allChoiceNodes: ChoiceNode[] = [];

  if (state.classes.length === 0) {
    errors.push('Character must have at least one class entry.');
    return {
      valid: false,
      totalLevel: 0,
      entries,
      choiceNodes: allChoiceNodes,
      errors,
    };
  }

  const totalLevel = state.classes.reduce((sum, c) => sum + c.level, 0);
  if (totalLevel < 1 || totalLevel > 20) {
    errors.push(
      `Total character level across all classes must be between 1 and 20, got ${totalLevel}.`,
    );
  }

  const seenClassIds = new Set<string>();
  const chosenFeatureOptionsByGroup = new Map<string, Set<string>>();
  const chosenFeatIds = new Set<string>();

  for (let classIndex = 0; classIndex < state.classes.length; classIndex++) {
    const entry: CharacterClassEntry = state.classes[classIndex]!;
    const entryErrors: string[] = [];
    const entryNodes: ChoiceNode[] = [];
    const expectedKeysByLevel = new Map<number, Set<string>>();

    const markExpectedKey = (lvl: number, key: string): void => {
      const set = expectedKeysByLevel.get(lvl) ?? new Set<string>();
      set.add(key);
      expectedKeysByLevel.set(lvl, set);
    };

    if (seenClassIds.has(entry.classId)) {
      entryErrors.push(`Duplicate class entry for '${entry.classId}'.`);
    }
    seenClassIds.add(entry.classId);

    const classData = compendium.getClass(entry.classId);
    if (!classData) {
      entryErrors.push(`Unknown SRD 5.1 Class ID '${entry.classId}'.`);
      errors.push(...entryErrors);
      entries.push({
        valid: false,
        classId: entry.classId,
        subclassId: entry.subclassId,
        level: entry.level,
        subclassRequired: false,
        choiceNodes: entryNodes,
        unexpectedChoiceKeysByLevel: {},
        errors: entryErrors,
      });
      continue;
    }

    // Subclass validation
    const subclassRequired = entry.level >= classData.subclassLevel;
    const subclassData = entry.subclassId
      ? compendium.getSubclass(entry.subclassId)
      : undefined;

    if (subclassRequired) {
      if (!entry.subclassId) {
        entryErrors.push(
          `Class '${classData.name}' at level ${entry.level} requires selecting a ${classData.subclassTitle} subclass (unlocked at level ${classData.subclassLevel}).`,
        );
      } else if (!subclassData || subclassData.classId !== classData.id) {
        entryErrors.push(
          `Subclass '${entry.subclassId}' is not a valid ${classData.subclassTitle} for class '${classData.name}'.`,
        );
      }
    } else if (entry.subclassId !== undefined) {
      entryErrors.push(
        `Class '${classData.name}' does not unlock ${classData.subclassTitle} until level ${classData.subclassLevel}, but subclassId '${entry.subclassId}' was set at level ${entry.level}.`,
      );
    }

    const evaluateClassChoice = (
      choice: ChoiceSpec,
      lvl: number,
      originKind: ChoiceOriginKind,
      originId: string,
      originName: string,
    ): void => {
      markExpectedKey(lvl, choice.id);
      const levelSelections = entry.choiceSelectionsByLevel[lvl] ?? {};
      const groupSet =
        choice.type === 'feature_option'
          ? (chosenFeatureOptionsByGroup.get(choice.featureGroup) ?? new Set<string>())
          : undefined;

      const res = validateChoiceSpecSelection(choice, levelSelections[choice.id], {
        compendium,
        alreadyChosenFeatureOptions: groupSet,
        subChoiceSelections: levelSelections,
      });

      if (choice.type === 'feature_option' && groupSet) {
        for (const opt of res.normalizedSelected) {
          if (res.allowedOptions.includes(opt)) {
            groupSet.add(opt);
          }
        }
        chosenFeatureOptionsByGroup.set(choice.featureGroup, groupSet);
      }

      // If equipment_bundle has sub-keys in levelSelections, mark them expected too
      if (choice.type === 'equipment_bundle') {
        for (const branch of choice.options) {
          const subKey = `${choice.id}:${branch.id}`;
          if (subKey in levelSelections) {
            markExpectedKey(lvl, subKey);
          }
        }
      }

      const node: ChoiceNode = {
        choice,
        originKind,
        originId,
        originName,
        classId: classData.id,
        classLevel: lvl,
        selected: res.selected,
        normalizedSelected: res.normalizedSelected,
        allowedOptions: res.allowedOptions,
        valid: res.valid,
        errors: res.errors,
      };
      entryNodes.push(node);
      allChoiceNodes.push(node);
      entryErrors.push(...res.errors);
    };

    // Level 1 class skillChoices and toolChoices
    const level1Selections = entry.choiceSelectionsByLevel[1] ?? {};
    if (classIndex === 0) {
      evaluateClassChoice(
        classData.skillChoices,
        1,
        'class',
        classData.id,
        `${classData.name} Skills`,
      );
    } else if (classData.skillChoices.id in level1Selections) {
      // Secondary (multiclass) class entry: Bard, Ranger, and Rogue grant 1 skill on multiclassing
      const isMulticlassSingleSkill =
        (classData.id === 'bard' ||
          classData.id === 'ranger' ||
          classData.id === 'rogue') &&
        level1Selections[classData.skillChoices.id]?.length === 1;
      const effectiveSkillChoice: ChoiceSpec =
        isMulticlassSingleSkill && classData.skillChoices.type === 'skill'
          ? {
              ...classData.skillChoices,
              count: 1,
              label: `Choose 1 ${classData.name} multiclass skill proficiency`,
              from:
                classData.id === 'bard'
                  ? { mode: 'category', category: 'all_skills' }
                  : classData.skillChoices.from,
            }
          : classData.skillChoices;
      evaluateClassChoice(
        effectiveSkillChoice,
        1,
        'class',
        classData.id,
        `${classData.name} Skills`,
      );
    }

    for (const toolChoice of classData.toolChoices ?? []) {
      if (classIndex === 0) {
        evaluateClassChoice(
          toolChoice,
          1,
          'class',
          classData.id,
          `${classData.name} Tool Proficiency`,
        );
      } else if (toolChoice.id in level1Selections) {
        const isMulticlassSingleInstrument =
          classData.id === 'bard' && level1Selections[toolChoice.id]?.length === 1;
        const effectiveToolChoice: ChoiceSpec = isMulticlassSingleInstrument
          ? {
              ...toolChoice,
              count: 1,
              label: 'Choose 1 musical instrument proficiency (Multiclass Bard)',
            }
          : toolChoice;
        evaluateClassChoice(
          effectiveToolChoice,
          1,
          'class',
          classData.id,
          `${classData.name} Tool Proficiency`,
        );
      }
    }

    // Starting equipment choices (required if requireStartingEquipment is true, or validated individually if present)
    if (classIndex === 0) {
      const anyEquipPresent = classData.startingEquipmentChoices.some(
        (c) => c.id in level1Selections,
      );
      if (requireStartingEquipment || anyEquipPresent) {
        for (const equipChoice of classData.startingEquipmentChoices) {
          if (requireStartingEquipment || equipChoice.id in level1Selections) {
            evaluateClassChoice(
              equipChoice,
              1,
              'class',
              classData.id,
              `${classData.name} Starting Equipment`,
            );
          }
        }
      }
    }

    // Unlocked Class & Subclass Feature Choices (levels 1..entry.level)
    const unlockedAsiLevels = new Set<number>();

    for (let lvl = 1; lvl <= entry.level; lvl++) {
      const lvlProg = classData.levels[lvl - 1];
      if (!lvlProg) continue;

      for (const featureId of lvlProg.featureIds) {
        if (featureId.startsWith('asi-')) {
          unlockedAsiLevels.add(lvl);
          continue;
        }
        const feature = compendium.getFeature(featureId);
        if (!feature) continue;

        for (const choice of feature.choices ?? []) {
          // Sorcerer Metamagic grants 2 options at L3, and +1 option at L10 and L17
          if (feature.id === 'metamagic' && lvl > 3) {
            const lvlSelections = entry.choiceSelectionsByLevel[lvl] ?? {};
            if (choice.id in lvlSelections) {
              evaluateClassChoice(
                {
                  ...choice,
                  count: 1,
                  label: 'Choose one additional Metamagic option',
                },
                lvl,
                'feature',
                feature.id,
                feature.name,
              );
            }
            continue;
          }
          evaluateClassChoice(choice, lvl, 'feature', feature.id, feature.name);
        }

        // Check implicit feature choices (e.g., favored-enemy, natural-explorer) if provided
        const implicitChoice = IMPLICIT_FEATURE_CHOICES[feature.id];
        if (implicitChoice && implicitChoice.id in (entry.choiceSelectionsByLevel[lvl] ?? {})) {
          evaluateClassChoice(implicitChoice, lvl, 'feature', feature.id, feature.name);
        }
      }

      // Check scaling class-specific feature choices at higher levels (Warlock Invocations at L5/7/9/12/15/18, Ranger Favored Enemy at L6/14, Natural Explorer at L6/10)
      const lvlSelections = entry.choiceSelectionsByLevel[lvl] ?? {};
      if (
        classData.id === 'warlock' &&
        lvl > 2 &&
        'warlock-invocations' in lvlSelections
      ) {
        const prevInvCount = Number(
          classData.levels[lvl - 2]?.classSpecific['invocations_known'] ?? 0,
        );
        const currInvCount = Number(lvlProg.classSpecific['invocations_known'] ?? 0);
        const deltaInv = currInvCount - prevInvCount;
        const invFeature = compendium.getFeature('eldritch-invocations');
        const baseInvChoice = invFeature?.choices?.[0];
        if (deltaInv > 0 && invFeature && baseInvChoice) {
          evaluateClassChoice(
            {
              ...baseInvChoice,
              count: deltaInv,
              label: `Choose ${deltaInv} additional Eldritch Invocation(s)`,
            },
            lvl,
            'feature',
            invFeature.id,
            invFeature.name,
          );
        }
      }

      if (classData.id === 'ranger' && lvl > 1) {
        const prevEnemyCount = Number(
          classData.levels[lvl - 2]?.classSpecific['favored_enemies'] ?? 1,
        );
        const currEnemyCount = Number(lvlProg.classSpecific['favored_enemies'] ?? 1);
        if (
          currEnemyCount > prevEnemyCount &&
          'favored-enemy' in lvlSelections &&
          IMPLICIT_FEATURE_CHOICES['favored-enemy']
        ) {
          evaluateClassChoice(
            IMPLICIT_FEATURE_CHOICES['favored-enemy'],
            lvl,
            'feature',
            'favored-enemy',
            'Favored Enemy',
          );
        }

        const prevTerrainCount = Number(
          classData.levels[lvl - 2]?.classSpecific['favored_terrains'] ?? 1,
        );
        const currTerrainCount = Number(lvlProg.classSpecific['favored_terrains'] ?? 1);
        if (
          currTerrainCount > prevTerrainCount &&
          'natural-explorer' in lvlSelections &&
          IMPLICIT_FEATURE_CHOICES['natural-explorer']
        ) {
          evaluateClassChoice(
            IMPLICIT_FEATURE_CHOICES['natural-explorer'],
            lvl,
            'feature',
            'natural-explorer',
            'Natural Explorer',
          );
        }
      }

      if (subclassData && subclassData.classId === classData.id && lvl >= classData.subclassLevel) {
        const subLvlProg = subclassData.levels.find((l) => l.level === lvl);
        for (const featureId of subLvlProg?.featureIds ?? []) {
          const feature = compendium.getFeature(featureId);
          if (!feature) continue;
          for (const choice of feature.choices ?? []) {
            evaluateClassChoice(choice, lvl, 'subclass', feature.id, feature.name);
          }
        }
      }
    }

    // Validate ASI / Feat selections
    for (const asiLvl of unlockedAsiLevels) {
      const asiOrFeat = entry.asiOrFeatByLevel[asiLvl];
      if (!asiOrFeat) {
        if (requireAsiSelections) {
          entryErrors.push(
            `Class '${classData.name}' level ${asiLvl} requires an Ability Score Improvement (ASI) or Feat selection.`,
          );
        }
        continue;
      }

      if (asiOrFeat.type === 'asi') {
        const bonusEntries = Object.entries(asiOrFeat.bonuses).filter(
          (pair): pair is [AbilityId, 1 | 2] => pair[1] !== undefined,
        );
        const sum = bonusEntries.reduce((acc, [, v]) => acc + v, 0);
        if (sum !== 2) {
          entryErrors.push(
            `ASI at '${classData.name}' level ${asiLvl} must total +2 across 1 or 2 abilities, got +${sum}.`,
          );
        }
      } else {
        const feat = compendium.getFeat(asiOrFeat.featId);
        if (!feat) {
          entryErrors.push(
            `Unknown SRD 5.1 Feat ID '${asiOrFeat.featId}' at '${classData.name}' level ${asiLvl}.`,
          );
          continue;
        }
        if (chosenFeatIds.has(feat.id)) {
          entryErrors.push(
            `Feat '${feat.name}' (${feat.id}) cannot be selected more than once.`,
          );
        }
        chosenFeatIds.add(feat.id);

        // Check Feat prerequisites
        const runningScores = computeRunningAbilityScores(
          state,
          compendium,
          classIndex,
          asiLvl,
        );
        for (const prereq of feat.prerequisites) {
          if (prereq.type === 'ability_minimum') {
            const currentScore = runningScores[prereq.ability];
            if (currentScore < prereq.minimum) {
              entryErrors.push(
                `Feat '${feat.name}' requires ${prereq.ability.toUpperCase()} ${prereq.minimum} or higher (character has ${currentScore}).`,
              );
            }
          } else if (prereq.type === 'level') {
            if (totalLevel < prereq.minimumLevel) {
              entryErrors.push(
                `Feat '${feat.name}' requires character level ${prereq.minimumLevel} or higher (character is level ${totalLevel}).`,
              );
            }
          } else if (prereq.type === 'spellcasting') {
            const hasSpellcasting = state.classes.some(
              (c) => compendium.getClass(c.classId)?.spellcasting !== undefined,
            );
            if (!hasSpellcasting) {
              entryErrors.push(
                `Feat '${feat.name}' requires the ability to cast at least one spell.`,
              );
            }
          }
        }

        // Validate Feat choices if any
        for (const choice of feat.choices ?? []) {
          const res = validateChoiceSpecSelection(choice, asiOrFeat.choices?.[choice.id], {
            compendium,
            subChoiceSelections: asiOrFeat.choices,
          });
          const node: ChoiceNode = {
            choice,
            originKind: 'feat',
            originId: feat.id,
            originName: feat.name,
            classId: classData.id,
            classLevel: asiLvl,
            selected: res.selected,
            normalizedSelected: res.normalizedSelected,
            allowedOptions: res.allowedOptions,
            valid: res.valid,
            errors: res.errors,
          };
          entryNodes.push(node);
          allChoiceNodes.push(node);
          entryErrors.push(...res.errors);
        }
      }
    }

    // Check for ASI entries at non-ASI levels
    for (const lvlKey of Object.keys(entry.asiOrFeatByLevel)) {
      const lvl = Number(lvlKey);
      if (!unlockedAsiLevels.has(lvl)) {
        entryErrors.push(
          `Class '${classData.name}' does not grant an Ability Score Improvement at level ${lvl}.`,
        );
      }
    }

    // Check for unexpected choice keys in choiceSelectionsByLevel
    const unexpectedChoiceKeysByLevel: Record<number, string[]> = {};
    for (const [lvlKey, selectionsAtLevel] of Object.entries(entry.choiceSelectionsByLevel)) {
      const lvl = Number(lvlKey);
      if (lvl > entry.level || lvl < 1) {
        entryErrors.push(
          `choiceSelectionsByLevel contains level ${lvl}, which exceeds '${classData.name}' level ${entry.level}.`,
        );
        continue;
      }
      const expectedSet = expectedKeysByLevel.get(lvl) ?? new Set<string>();
      for (const key of Object.keys(selectionsAtLevel)) {
        if (expectedSet.has(key)) continue;
        if (parseDuplicateReplacementChoiceId(key)) continue;
        if (RECOGNIZED_EXPERTISE_KEYS.has(key)) continue;
        const list = unexpectedChoiceKeysByLevel[lvl] ?? [];
        list.push(key);
        unexpectedChoiceKeysByLevel[lvl] = list;
        entryErrors.push(
          `Unexpected choice key '${key}' at '${classData.name}' level ${lvl}.`,
        );
      }
    }

    errors.push(...entryErrors);
    entries.push({
      valid: entryErrors.length === 0,
      classId: entry.classId,
      subclassId: entry.subclassId,
      level: entry.level,
      subclassRequired,
      choiceNodes: entryNodes,
      unexpectedChoiceKeysByLevel,
      errors: entryErrors,
    });
  }

  return {
    valid: errors.length === 0,
    totalLevel,
    entries,
    choiceNodes: allChoiceNodes,
    errors,
  };
}

// ============================================================================
// 8. Proficiency Aggregation & SRD Duplicate Proficiency Replacement Engine
// ============================================================================

/**
 * Collects all raw proficiency grants (`armor`, `weapon`, `tool`, `saving_throw`, `skill`, `language`)
 * from a `CharacterBuildState` before duplicate replacement resolution.
 */
export function collectProficiencyGrants(
  state: Pick<
    CharacterBuildState,
    | 'raceId'
    | 'subraceId'
    | 'racialChoices'
    | 'backgroundId'
    | 'backgroundChoices'
    | 'customBackground'
    | 'classes'
  >,
  compendium: SrdCompendium = createCompendium(),
): ProficiencyGrantRecord[] {
  const grants: ProficiencyGrantRecord[] = [];

  const addGrant = (
    rawProfId: string,
    sourceKind: ProficiencyGrantRecord['sourceKind'],
    sourceId: string,
    sourceName: string,
    isFixed: boolean,
    explicitCategory?: ProficiencyGrantRecord['category'],
    choiceId?: string,
  ): void => {
    const category = explicitCategory ?? classifyProficiencyId(rawProfId, compendium);
    if (!category) return;
    grants.push({
      category,
      proficiencyId: rawProfId,
      sourceKind,
      sourceId,
      sourceName,
      isFixed,
      choiceId,
    });
  };

  const collectFromChoiceSpec = (
    choice: ChoiceSpec,
    selectionsMap: Readonly<Record<string, readonly string[]>>,
    sourceKind: ProficiencyGrantRecord['sourceKind'],
    sourceId: string,
    sourceName: string,
  ): void => {
    if (
      choice.type !== 'skill' &&
      choice.type !== 'tool' &&
      choice.type !== 'language' &&
      choice.type !== 'proficiency'
    ) {
      return;
    }

    const allowedSet = new Set(compendium.resolveChoiceOptions(choice));
    const rawSelected = selectionsMap[choice.id] ?? [];
    const seenInThisChoice = new Set<string>();

    for (const opt of rawSelected) {
      // Ignore invalid or intra-choice duplicate options when collecting grants
      if (!allowedSet.has(opt) || seenInThisChoice.has(opt)) {
        continue;
      }
      seenInThisChoice.add(opt);
      const explicitCategory =
        choice.type === 'proficiency' ? undefined : choice.type;
      addGrant(opt, sourceKind, sourceId, sourceName, false, explicitCategory, choice.id);
    }
  };

  // 1. Race
  const race = compendium.getRace(state.raceId);
  if (race) {
    for (const profId of race.proficiencies) {
      addGrant(profId, 'race', race.id, race.name, true);
    }
    for (const langId of race.languages) {
      addGrant(langId, 'race', race.id, race.name, true, 'language');
    }
    for (const choice of race.choices) {
      collectFromChoiceSpec(choice, state.racialChoices, 'race', race.id, race.name);
    }
    for (const trait of race.traits) {
      for (const choice of trait.choices ?? []) {
        collectFromChoiceSpec(
          choice,
          state.racialChoices,
          'race',
          trait.id,
          `${race.name}: ${trait.name}`,
        );
      }
    }
  }

  // 2. Subrace
  const subrace = state.subraceId ? compendium.getSubrace(state.subraceId) : undefined;
  if (subrace && race && race.subraceIds.includes(subrace.id)) {
    for (const profId of subrace.proficiencies) {
      addGrant(profId, 'subrace', subrace.id, subrace.name, true);
    }
    for (const langId of subrace.languages ?? []) {
      addGrant(langId, 'subrace', subrace.id, subrace.name, true, 'language');
    }
    for (const choice of subrace.choices) {
      collectFromChoiceSpec(
        choice,
        state.racialChoices,
        'subrace',
        subrace.id,
        subrace.name,
      );
    }
    for (const trait of subrace.traits) {
      for (const choice of trait.choices ?? []) {
        collectFromChoiceSpec(
          choice,
          state.racialChoices,
          'subrace',
          trait.id,
          `${subrace.name}: ${trait.name}`,
        );
      }
    }
  }

  // 3. Background
  if (state.customBackground) {
    const bgName = state.customBackground.name || 'Custom Background';
    const seenCustomSkills = new Set<string>();
    for (const skillId of state.customBackground.skillProficiencies) {
      if (SKILL_ID_SET.has(skillId) && !seenCustomSkills.has(skillId)) {
        seenCustomSkills.add(skillId);
        addGrant(skillId, 'custom_background', 'custom', bgName, true, 'skill');
      }
    }
    const seenCustomTools = new Set<string>();
    for (const toolId of state.customBackground.toolProficiencies) {
      if (compendium.getTool(toolId) && !seenCustomTools.has(toolId)) {
        seenCustomTools.add(toolId);
        addGrant(toolId, 'custom_background', 'custom', bgName, true, 'tool');
      }
    }
    const seenCustomLangs = new Set<string>();
    for (const langId of state.customBackground.languages) {
      if (compendium.getLanguage(langId) && !seenCustomLangs.has(langId)) {
        seenCustomLangs.add(langId);
        addGrant(langId, 'custom_background', 'custom', bgName, true, 'language');
      }
    }
  } else {
    const background = compendium.getBackground(state.backgroundId);
    if (background) {
      for (const skillId of background.skillProficiencies) {
        addGrant(skillId, 'background', background.id, background.name, true, 'skill');
      }
      for (const toolId of background.toolProficiencies) {
        addGrant(toolId, 'background', background.id, background.name, true, 'tool');
      }
      for (const langId of background.languages) {
        addGrant(langId, 'background', background.id, background.name, true, 'language');
      }
      for (const choice of background.choices) {
        collectFromChoiceSpec(
          choice,
          state.backgroundChoices,
          'background',
          background.id,
          background.name,
        );
      }
    }
  }

  // 4. Classes, Subclasses, Features, and Feats
  for (let classIndex = 0; classIndex < state.classes.length; classIndex++) {
    const entry = state.classes[classIndex]!;
    const classData = compendium.getClass(entry.classId);
    if (!classData) continue;

    if (classIndex === 0) {
      for (const saveAb of classData.savingThrowProficiencies) {
        addGrant(saveAb, 'class', classData.id, classData.name, true, 'saving_throw');
      }
    }
    for (const armorId of classData.armorProficiencies) {
      addGrant(armorId, 'class', classData.id, classData.name, true, 'armor');
    }
    for (const weaponId of classData.weaponProficiencies) {
      addGrant(weaponId, 'class', classData.id, classData.name, true, 'weapon');
    }
    for (const toolId of classData.toolProficiencies) {
      addGrant(toolId, 'class', classData.id, classData.name, true, 'tool');
    }

    const level1Selections = entry.choiceSelectionsByLevel[1] ?? {};
    if (classIndex === 0 || classData.skillChoices.id in level1Selections) {
      collectFromChoiceSpec(
        classData.skillChoices,
        level1Selections,
        'class',
        classData.id,
        classData.name,
      );
    }
    for (const toolChoice of classData.toolChoices ?? []) {
      if (classIndex === 0 || toolChoice.id in level1Selections) {
        collectFromChoiceSpec(
          toolChoice,
          level1Selections,
          'class',
          classData.id,
          classData.name,
        );
      }
    }

    const subclassData = entry.subclassId
      ? compendium.getSubclass(entry.subclassId)
      : undefined;

    for (let lvl = 1; lvl <= entry.level; lvl++) {
      const lvlProg = classData.levels[lvl - 1];
      const lvlSelections = entry.choiceSelectionsByLevel[lvl] ?? {};

      for (const featureId of lvlProg?.featureIds ?? []) {
        if (featureId === 'druidic') {
          addGrant('druidic', 'feature', featureId, 'Druidic', true, 'language');
        } else if (featureId === 'thieves-cant-feature') {
          addGrant('thieves-cant', 'feature', featureId, "Thieves' Cant", true, 'language');
        }

        const feature = compendium.getFeature(featureId);
        for (const choice of feature?.choices ?? []) {
          collectFromChoiceSpec(
            choice,
            lvlSelections,
            'feature',
            feature!.id,
            feature!.name,
          );
        }
      }

      if (subclassData && subclassData.classId === classData.id && lvl >= classData.subclassLevel) {
        const subLvlProg = subclassData.levels.find((l) => l.level === lvl);
        for (const featureId of subLvlProg?.featureIds ?? []) {
          if (featureId === 'bonus-proficiency-life') {
            addGrant(
              'heavy-armor',
              'subclass',
              featureId,
              'Bonus Proficiency (Life Domain)',
              true,
              'armor',
            );
          }

          const feature = compendium.getFeature(featureId);
          for (const choice of feature?.choices ?? []) {
            collectFromChoiceSpec(
              choice,
              lvlSelections,
              'subclass',
              feature!.id,
              feature!.name,
            );
          }
        }
      }

      const asiOrFeat = entry.asiOrFeatByLevel[lvl];
      if (asiOrFeat?.type === 'feat') {
        const feat = compendium.getFeat(asiOrFeat.featId);
        for (const choice of feat?.choices ?? []) {
          collectFromChoiceSpec(
            choice,
            asiOrFeat.choices ?? {},
            'feat',
            feat!.id,
            feat!.name,
          );
        }
      }
    }
  }

  return grants;
}

function lookupReplacementSelections(
  state: Pick<
    CharacterBuildState,
    'racialChoices' | 'backgroundChoices' | 'classes'
  >,
  replacementChoiceId: string,
): string[] {
  if (state.backgroundChoices[replacementChoiceId]) {
    return [...state.backgroundChoices[replacementChoiceId]!];
  }
  if (state.racialChoices[replacementChoiceId]) {
    return [...state.racialChoices[replacementChoiceId]!];
  }
  for (const entry of state.classes) {
    for (const lvlSelections of Object.values(entry.choiceSelectionsByLevel)) {
      if (lvlSelections[replacementChoiceId]) {
        return [...lvlSelections[replacementChoiceId]!];
      }
    }
  }
  return [];
}

function getAllCategoryOptionIds(
  category: DuplicateProficiencyCategory,
  compendium: SrdCompendium,
): string[] {
  switch (category) {
    case 'skill':
      return [...SKILL_IDS];
    case 'tool':
      return compendium.tools.map((t) => t.id);
    case 'language':
      return compendium.languages.map((l) => l.id);
  }
}

export interface DuplicateProficiencyResolutionResult {
  proficiencyGrants: ProficiencyGrantRecord[];
  duplicateProficiencies: DuplicateProficiencyCollision[];
  unresolvedDuplicates: DuplicateProficiencyCollision[];
  replacementChoiceNodes: ChoiceNode[];
  resolvedProficiencies: DerivedProficiencies;
  staleReplacementChoiceKeys: string[];
  errors: string[];
}

/**
 * Evaluates all proficiency grants across the character, detects duplicate `skill`, `tool`, and
 * `language` proficiencies per the SRD 5.1 Duplicate Proficiency Rule, validates any replacement
 * choices, and returns the final deduplicated `DerivedProficiencies`.
 */
export function resolveProficienciesAndDuplicates(
  state: Pick<
    CharacterBuildState,
    | 'raceId'
    | 'subraceId'
    | 'racialChoices'
    | 'backgroundId'
    | 'backgroundChoices'
    | 'customBackground'
    | 'classes'
  >,
  compendium: SrdCompendium = createCompendium(),
  options?: { requireExpertiseChoices?: boolean | undefined },
): DuplicateProficiencyResolutionResult {
  const baseGrants = collectProficiencyGrants(state, compendium);
  const allGrants: ProficiencyGrantRecord[] = [...baseGrants];
  const duplicateProficiencies: DuplicateProficiencyCollision[] = [];
  const unresolvedDuplicates: DuplicateProficiencyCollision[] = [];
  const replacementChoiceNodes: ChoiceNode[] = [];
  const errors: string[] = [];

  // Base sets per category
  const armorSet = new Set<string>();
  const weaponSet = new Set<string>();
  const savingThrowSet = new Set<AbilityId>();

  const grantsByCategoryAndId: Record<
    DuplicateProficiencyCategory,
    Map<string, ProficiencyGrantRecord[]>
  > = {
    skill: new Map(),
    tool: new Map(),
    language: new Map(),
  };

  for (const grant of baseGrants) {
    switch (grant.category) {
      case 'armor':
        armorSet.add(grant.proficiencyId);
        break;
      case 'weapon':
        weaponSet.add(grant.proficiencyId);
        break;
      case 'saving_throw':
        if (ABILITY_ID_SET.has(grant.proficiencyId)) {
          savingThrowSet.add(grant.proficiencyId as AbilityId);
        }
        break;
      case 'skill':
      case 'tool':
      case 'language': {
        const map = grantsByCategoryAndId[grant.category];
        const list = map.get(grant.proficiencyId) ?? [];
        list.push(grant);
        map.set(grant.proficiencyId, list);
        break;
      }
    }
  }

  const activeReplacementIds = new Set<string>();

  for (const category of DUPLICATE_PROFICIENCY_CATEGORIES) {
    const categoryMap = grantsByCategoryAndId[category];
    const allCategoryPool = getAllCategoryOptionIds(category, compendium);
    const allCategoryPoolSet = new Set(allCategoryPool);

    // Known base proficiencies in this category
    const baseKnownInCategory = new Set<string>(categoryMap.keys());
    // Track replacements chosen across collisions in the same category so two collisions can't pick the same replacement
    const chosenReplacementsInCategory = new Set<string>();

    for (const [profId, grantList] of categoryMap.entries()) {
      if (grantList.length <= 1) {
        continue;
      }

      const duplicateCount = grantList.length - 1;
      const replacementChoiceId = getDuplicateReplacementChoiceId(category, profId);
      activeReplacementIds.add(replacementChoiceId);

      const categorySpecName =
        category === 'skill'
          ? 'all_skills'
          : category === 'language'
            ? 'all_languages'
            : 'all_tools';

      const sourceSummary = grantList.map((g) => g.sourceName).join(' + ');
      const replacementChoiceSpec: ProficiencyChoiceSpec = {
        id: replacementChoiceId,
        label: `Replace duplicate ${category} proficiency '${profId}' (${sourceSummary}) with any other ${category}`,
        count: duplicateCount,
        type: category,
        from: {
          mode: 'category',
          category: categorySpecName,
        },
      };

      const availableReplacementOptions = allCategoryPool.filter(
        (id) => !baseKnownInCategory.has(id) && !chosenReplacementsInCategory.has(id),
      );
      const availableSet = new Set(availableReplacementOptions);

      const selectedReplacements = lookupReplacementSelections(state, replacementChoiceId);
      const collisionErrors: string[] = [];

      if (selectedReplacements.length === 0) {
        collisionErrors.push(
          `Duplicate ${category} proficiency '${profId}' granted by multiple sources (${sourceSummary}). ` +
            `Per SRD 5.1 rules, select ${duplicateCount} replacement ${category}(s) via choice '${replacementChoiceId}'.`,
        );
      } else {
        if (selectedReplacements.length !== duplicateCount) {
          collisionErrors.push(
            `Duplicate ${category} replacement '${replacementChoiceId}' requires ${duplicateCount} selection(s), but got ${selectedReplacements.length}.`,
          );
        }

        const seenInReplacement = new Set<string>();
        for (const repId of selectedReplacements) {
          if (!allCategoryPoolSet.has(repId)) {
            collisionErrors.push(
              `Replacement '${repId}' in '${replacementChoiceId}' is not a valid SRD 5.1 ${category}.`,
            );
          } else if (baseKnownInCategory.has(repId)) {
            collisionErrors.push(
              `Replacement ${category} '${repId}' in '${replacementChoiceId}' is already possessed by the character.`,
            );
          } else if (
            seenInReplacement.has(repId) ||
            chosenReplacementsInCategory.has(repId)
          ) {
            collisionErrors.push(
              `Replacement ${category} '${repId}' in '${replacementChoiceId}' was selected more than once.`,
            );
          } else if (availableSet.has(repId)) {
            seenInReplacement.add(repId);
          }
        }
      }

      const resolved = collisionErrors.length === 0;
      if (resolved) {
        for (const repId of selectedReplacements) {
          chosenReplacementsInCategory.add(repId);
          allGrants.push({
            category,
            proficiencyId: repId,
            sourceKind: 'replacement',
            sourceId: replacementChoiceId,
            sourceName: `Duplicate ${category} replacement (${profId})`,
            isFixed: false,
            choiceId: replacementChoiceId,
          });
        }
      }

      const collision: DuplicateProficiencyCollision = {
        category,
        proficiencyId: profId,
        duplicateCount,
        grants: grantList,
        replacementChoiceId,
        replacementChoiceSpec,
        availableReplacementOptions,
        selectedReplacements,
        resolved,
        errors: collisionErrors,
      };

      duplicateProficiencies.push(collision);
      if (!resolved) {
        unresolvedDuplicates.push(collision);
        errors.push(...collisionErrors);
      }

      replacementChoiceNodes.push({
        choice: replacementChoiceSpec,
        originKind: 'duplicate_replacement',
        originId: profId,
        originName: `Duplicate ${category} replacement (${profId})`,
        selected: selectedReplacements,
        normalizedSelected: selectedReplacements,
        allowedOptions: availableReplacementOptions,
        valid: resolved,
        errors: collisionErrors,
      });
    }
  }

  // Check for stale/orphan `replace:<category>:<profId>` keys that do not match any active duplicate
  const staleReplacementChoiceKeys: string[] = [];
  const checkStaleMap = (map: Readonly<Record<string, readonly string[]>>, label: string): void => {
    for (const key of Object.keys(map)) {
      if (parseDuplicateReplacementChoiceId(key) && !activeReplacementIds.has(key)) {
        staleReplacementChoiceKeys.push(key);
        errors.push(
          `Stale duplicate replacement choice '${key}' in ${label}: '${key}' does not correspond to any duplicate proficiency on this character.`,
        );
      }
    }
  };
  checkStaleMap(state.backgroundChoices, 'backgroundChoices');
  checkStaleMap(state.racialChoices, 'racialChoices');
  for (const entry of state.classes) {
    for (const [lvlKey, lvlMap] of Object.entries(entry.choiceSelectionsByLevel)) {
      checkStaleMap(lvlMap, `${entry.classId} level ${lvlKey} choiceSelectionsByLevel`);
    }
  }

  // Build final deduplicated sets for skills, tools, and languages
  const finalSkillSet = new Set<SkillId>();
  const finalToolSet = new Set<string>();
  const finalLanguageSet = new Set<string>();

  for (const grant of allGrants) {
    if (grant.category === 'skill' && SKILL_ID_SET.has(grant.proficiencyId)) {
      finalSkillSet.add(grant.proficiencyId as SkillId);
    } else if (grant.category === 'tool') {
      finalToolSet.add(grant.proficiencyId);
    } else if (grant.category === 'language') {
      finalLanguageSet.add(grant.proficiencyId);
    }
  }

  // Validate and collect Expertise selections (Rogue L1/L6, Bard L3/L10)
  const expertiseSet = new Set<string>();
  const requireExpertise = options?.requireExpertiseChoices ?? false;

  for (const entry of state.classes) {
    const classData = compendium.getClass(entry.classId);
    if (!classData) continue;

    for (let lvl = 1; lvl <= entry.level; lvl++) {
      const lvlProg = classData.levels[lvl - 1];
      const hasRogueExpertise = lvlProg?.featureIds.includes('expertise-rogue') ?? false;
      const hasBardExpertise =
        (lvlProg?.featureIds.includes('expertise-bard') ?? false) ||
        (entry.classId === 'bard' && lvl === 10);
      if (!hasRogueExpertise && !hasBardExpertise) continue;

      const lvlSelections = entry.choiceSelectionsByLevel[lvl] ?? {};
      const candidateKeys = hasRogueExpertise
        ? ['expertise-rogue', 'rogue-expertise', 'expertise']
        : ['expertise-bard', 'bard-expertise', 'expertise'];

      const matchedKey = candidateKeys.find((k) => k in lvlSelections);
      if (!matchedKey) {
        if (requireExpertise) {
          const featureId = hasRogueExpertise ? 'expertise-rogue' : 'expertise-bard';
          errors.push(
            `Class '${classData.name}' level ${lvl} requires selecting 2 proficient skills${hasRogueExpertise ? " (or thieves' tools)" : ''} for Expertise ('${featureId}').`,
          );
        }
        continue;
      }

      const selectedExp = lvlSelections[matchedKey] ?? [];
      const allowedExpertisePool = new Set<string>(finalSkillSet);
      if (hasRogueExpertise && finalToolSet.has('thieves-tools')) {
        allowedExpertisePool.add('thieves-tools');
      }

      if (selectedExp.length !== 2) {
        errors.push(
          `Expertise selection '${matchedKey}' at '${classData.name}' level ${lvl} requires exactly 2 proficiencies, got ${selectedExp.length}.`,
        );
      }

      const seenInThisExpertise = new Set<string>();
      for (const expId of selectedExp) {
        if (seenInThisExpertise.has(expId)) {
          errors.push(
            `Expertise selection '${matchedKey}' at '${classData.name}' level ${lvl} contains duplicate entry '${expId}'.`,
          );
        } else if (expertiseSet.has(expId)) {
          errors.push(
            `Proficiency '${expId}' already has Expertise from an earlier level.`,
          );
        } else if (!allowedExpertisePool.has(expId)) {
          errors.push(
            `Expertise selection '${expId}' at '${classData.name}' level ${lvl} requires existing proficiency in that skill${hasRogueExpertise ? " (or thieves' tools)" : ''}.`,
          );
        } else {
          seenInThisExpertise.add(expId);
          expertiseSet.add(expId);
        }
      }
    }
  }

  const resolvedProficiencies: DerivedProficiencies = {
    armor: [...armorSet],
    weapons: [...weaponSet],
    tools: [...finalToolSet],
    savingThrows: ABILITY_IDS.filter((ab) => savingThrowSet.has(ab)),
    skills: SKILL_IDS.filter((sk) => finalSkillSet.has(sk)),
    expertise: [...expertiseSet],
    languages: [...finalLanguageSet],
  };

  return {
    proficiencyGrants: allGrants,
    duplicateProficiencies,
    unresolvedDuplicates,
    replacementChoiceNodes,
    resolvedProficiencies,
    staleReplacementChoiceKeys,
    errors,
  };
}

// ============================================================================
// 9. Unified Character Choice Tree Validator
// ============================================================================

/**
 * Validates the entire Character Choice Tree across Origin (Race/Subrace), Classes/Subclasses/Features/Feats,
 * Background/Custom Background, Expertise, and the SRD 5.1 Duplicate Proficiency Replacement Rule.
 */
export function validateCharacterChoices(
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
  >,
  compendium: SrdCompendium = createCompendium(),
  options?: ValidateCharacterChoicesOptions,
): CharacterChoiceTreeValidationResult {
  const origin = validateOriginChoices(state, compendium);
  const classes = validateClassChoices(state, compendium, options);
  const background = validateBackgroundChoices(state, compendium);
  const dupResolution = resolveProficienciesAndDuplicates(state, compendium, {
    requireExpertiseChoices: options?.requireExpertiseChoices,
  });

  const choiceNodes: ChoiceNode[] = [
    ...origin.choiceNodes,
    ...classes.choiceNodes,
    ...background.choiceNodes,
    ...dupResolution.replacementChoiceNodes,
  ];

  // Extract resolved ability bonuses, bonus spells, and feature options from valid choice nodes
  const abilityBonusesFromChoices: Record<AbilityId, number> = {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  };
  const cantripSet = new Set<string>();
  const spellSet = new Set<string>();
  const selectedFeatureOptionIdsByGroup: Record<string, string[]> = {};

  for (const node of choiceNodes) {
    if (!node.valid) continue;
    const { choice, normalizedSelected } = node;

    if (choice.type === 'ability_score_bonus') {
      for (const ab of normalizedSelected) {
        if (ABILITY_ID_SET.has(ab)) {
          abilityBonusesFromChoices[ab as AbilityId] += choice.bonus;
        }
      }
    } else if (choice.type === 'spell') {
      for (const spellId of normalizedSelected) {
        const spell = compendium.getSpell(spellId);
        if (!spell) continue;
        if (spell.level === 0) {
          cantripSet.add(spell.id);
        } else {
          spellSet.add(spell.id);
        }
      }
    } else if (choice.type === 'feature_option') {
      const groupList = selectedFeatureOptionIdsByGroup[choice.featureGroup] ?? [];
      for (const opt of normalizedSelected) {
        if (!groupList.includes(opt)) {
          groupList.push(opt);
        }
      }
      selectedFeatureOptionIdsByGroup[choice.featureGroup] = groupList;
    }
  }

  const errors: string[] = [
    ...origin.errors,
    ...classes.errors,
    ...background.errors,
    ...dupResolution.errors,
  ];

  return {
    valid: errors.length === 0,
    origin,
    classes,
    background,
    choiceNodes,
    proficiencyGrants: dupResolution.proficiencyGrants,
    duplicateProficiencies: dupResolution.duplicateProficiencies,
    unresolvedDuplicates: dupResolution.unresolvedDuplicates,
    resolvedProficiencies: dupResolution.resolvedProficiencies,
    abilityBonusesFromChoices,
    bonusSpellIdsFromChoices: {
      cantripIds: [...cantripSet],
      spellIds: [...spellSet],
    },
    selectedFeatureOptionIdsByGroup,
    errors,
  };
}
