import {
  ALLOWED_SRD_BACKGROUND_IDS,
  ALLOWED_SRD_CLASS_IDS,
  ALLOWED_SRD_FEAT_IDS,
  ALLOWED_SRD_RACE_IDS,
  ALLOWED_SRD_SUBCLASS_IDS,
  ALLOWED_SRD_SUBRACE_IDS,
  containsProductIdentityMonster,
  containsProductIdentityProperName,
  containsProductIdentitySetting,
  isProhibitedMonsterId,
  isSrd52OnlyIdentifier,
  screenHomebrewRecord,
  type SrdIngestionInput,
} from '../ingestion/index.js';
import {
  ABILITY_IDS,
  AbilitiesAndSkillsFileSchema,
  BackgroundSchema,
  type ChoiceSpec,
  ClassSchema,
  CONDITION_IDS,
  ConditionDefinitionSchema,
  DAMAGE_TYPES,
  DamageTypeDefinitionSchema,
  type EffectStepSpec,
  EquipmentSchema,
  FeatSchema,
  FeatureSchema,
  FORMULA_FUNCTIONS,
  FORMULA_VARIABLES,
  MagicItemSchema,
  type ModifierSpec,
  MonsterSchema,
  type MonsterSpellcastingSpec,
  ProficienciesAndLanguagesFileSchema,
  RaceSchema,
  SKILL_DEFAULT_ABILITY,
  SKILL_IDS,
  SpellSchema,
  SubclassSchema,
  SubraceSchema,
} from '../schemas/index.js';
import { validateRelevanceCoverage } from '../relevance/index.js';

export interface SrdValidationError {
  category: 'schema' | 'duplicate_id' | 'cross_reference' | 'formula_syntax' | 'allowlist' | 'relevance';
  collection: string;
  entityId?: string;
  message: string;
}

export interface SrdValidationReport {
  valid: boolean;
  errors: SrdValidationError[];
  counts: {
    abilities: number;
    skills: number;
    conditions: number;
    damageTypes: number;
    proficiencies: number;
    languages: number;
    races: number;
    subraces: number;
    classes: number;
    subclasses: number;
    features: number;
    backgrounds: number;
    feats: number;
    equipment: number;
    magicItems: number;
    spells: number;
    monsters: number;
  };
}

const VALID_FORMULA_VARIABLES: ReadonlySet<string> = new Set(FORMULA_VARIABLES);
const VALID_FORMULA_FUNCTIONS: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS);
const VALID_SKILL_SET: ReadonlySet<string> = new Set(SKILL_IDS);

export interface FormulaSyntaxValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a `FormulaString` or `diceFormula` contains only valid dice notation,
 * numbers, arithmetic operators, balanced parentheses, allowed functions (`max`, `min`, `floor`, `ceil`),
 * and allowed `@variable` references (`FORMULA_VARIABLES`).
 */
export function validateFormulaSyntax(formula: string): FormulaSyntaxValidationResult {
  const trimmed = formula.trim();
  if (!trimmed) {
    return { valid: false, error: 'Formula cannot be empty' };
  }

  // Check balanced parentheses
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) {
        return { valid: false, error: `Unbalanced closing parenthesis in "${formula}"` };
      }
    }
  }
  if (depth !== 0) {
    return { valid: false, error: `Unclosed parenthesis in "${formula}"` };
  }

  if (/\(\s*\)/.test(trimmed)) {
    return { valid: false, error: `Empty parentheses in "${formula}"` };
  }

  // Check for trailing or leading binary operators (*, /) or trailing (+, -)
  if (/^[*/]|[+\-*/,(]\s*$/.test(trimmed)) {
    return { valid: false, error: `Invalid leading or trailing operator in "${formula}"` };
  }

  // Tokenize the formula from left to right
  const tokenRegex =
    /\s+|(\d+d\d+(?:(?:kh|kl|dh|dl|r|ro|min|max)\d+)*)|(\)\s*d\d+(?:(?:kh|kl|dh|dl|r|ro|min|max)\d+)*)|(\d+(?:\.\d+)?)|(@[a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)|([+\-*/(),])/gy;

  let pos = 0;
  let tokenCount = 0;
  while (pos < trimmed.length) {
    tokenRegex.lastIndex = pos;
    const match = tokenRegex.exec(trimmed);
    if (!match) {
      return {
        valid: false,
        error: `Unexpected syntax at index ${pos} ("${trimmed.slice(pos, pos + 12)}") in "${formula}"`,
      };
    }
    pos = tokenRegex.lastIndex;

    // Whitespace-only match
    if (
      !match[1] &&
      !match[2] &&
      !match[3] &&
      !match[4] &&
      !match[5] &&
      !match[6]
    ) {
      continue;
    }

    tokenCount++;

    // Handle `)d6` dynamic dice count suffix: the `)` was already checked in balanced parens,
    // but let's ensure `(` preceded it
    const variableToken = match[4];
    if (variableToken) {
      if (!VALID_FORMULA_VARIABLES.has(variableToken)) {
        return {
          valid: false,
          error: `Unknown formula variable "${variableToken}" in "${formula}"`,
        };
      }
      continue;
    }

    const identifierToken = match[5];
    if (identifierToken) {
      // Allow `d<N>` directly after `)` e.g. `(@slotLevel + 5)d6`
      if (/^d\d+(?:(?:kh|kl|dh|dl|r|ro|min|max)\d+)*$/.test(identifierToken)) {
        continue;
      }
      if (!VALID_FORMULA_FUNCTIONS.has(identifierToken)) {
        return {
          valid: false,
          error: `Unknown function or bare identifier "${identifierToken}" in "${formula}"`,
        };
      }
      const restAfterIdent = trimmed.slice(pos).trimStart();
      if (!restAfterIdent.startsWith('(')) {
        return {
          valid: false,
          error: `Function "${identifierToken}" must be followed by "(" in "${formula}"`,
        };
      }
    }
  }

  if (tokenCount === 0) {
    return { valid: false, error: `Formula "${formula}" contains no tokens` };
  }

  return { valid: true };
}

function collectModifierFormulas(
  modifiers: readonly ModifierSpec[] | undefined,
  onFormula: (formula: string, context: string) => void,
): void {
  if (!modifiers) return;
  for (const mod of modifiers) {
    switch (mod.type) {
      case 'ac_calculation':
        onFormula(mod.formula, `ac_calculation(${mod.id}).formula`);
        break;
      case 'flat_bonus':
        if (typeof mod.value === 'string') {
          onFormula(mod.value, `flat_bonus(${mod.target}).value`);
        }
        break;
      case 'grant_resource':
        onFormula(mod.maxFormula, `grant_resource(${mod.resourceId}).maxFormula`);
        if (mod.recoveryAmountFormula && mod.recoveryAmountFormula !== 'max') {
          onFormula(
            mod.recoveryAmountFormula,
            `grant_resource(${mod.resourceId}).recoveryAmountFormula`,
          );
        }
        break;
      default:
        break;
    }
  }
}

function collectEffectStepFormulas(
  steps: readonly EffectStepSpec[] | undefined,
  onFormula: (formula: string, context: string) => void,
): void {
  if (!steps) return;
  for (const step of steps) {
    switch (step.step) {
      case 'attack_roll':
        collectEffectStepFormulas(step.onHit, onFormula);
        collectEffectStepFormulas(step.onMiss, onFormula);
        break;
      case 'saving_throw':
        onFormula(step.dcFormula, `saving_throw(${step.ability}).dcFormula`);
        collectEffectStepFormulas(step.onFail, onFormula);
        collectEffectStepFormulas(step.onSuccess, onFormula);
        break;
      case 'deal_damage':
        onFormula(step.diceFormula, `deal_damage(${step.damageType}).diceFormula`);
        break;
      case 'heal':
        onFormula(step.diceFormula, 'heal.diceFormula');
        break;
      case 'grant_temp_hp':
        onFormula(step.amountFormula, 'grant_temp_hp.amountFormula');
        break;
      case 'apply_condition':
        if (step.repeatSaveAtTurnEnd) {
          onFormula(
            step.repeatSaveAtTurnEnd.dcFormula,
            `apply_condition(${step.conditionId}).repeatSaveAtTurnEnd.dcFormula`,
          );
        }
        break;
      case 'apply_active_effect':
        collectModifierFormulas(step.modifiers, onFormula);
        break;
      case 'create_hazard_zone':
        collectEffectStepFormulas(step.onEnterOrStartTurn, onFormula);
        break;
      case 'summon_creature':
        if (step.statblock.hitPointsFormula) {
          onFormula(
            step.statblock.hitPointsFormula,
            `summon_creature(${step.summonId}).statblock.hitPointsFormula`,
          );
        }
        for (const action of step.statblock.actions ?? []) {
          collectEffectStepFormulas(action.effects, (f, ctx) =>
            onFormula(
              f,
              `summon_creature(${step.summonId}).statblock.action(${action.id}).${ctx}`,
            ),
          );
        }
        break;
      case 'manual_adjudication':
        if (step.suggestedRoll) {
          onFormula(step.suggestedRoll, `manual_adjudication(${step.adjudicationId}).suggestedRoll`);
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Runs the comprehensive SRD 5.1 validation and referential integrity suite across all 15 collections.
 */
export function validateSrdDataset(
  dataset: SrdIngestionInput,
  options?: { requireHumanReview?: boolean },
): SrdValidationReport {
  const errors: SrdValidationError[] = [];

  const addError = (
    category: SrdValidationError['category'],
    collection: string,
    message: string,
    entityId?: string,
  ): void => {
    errors.push({
      category,
      collection,
      ...(entityId ? { entityId } : {}),
      message,
    });
  };

  const checkFormula = (
    collection: string,
    entityId: string,
    formula: string,
    context: string,
  ): void => {
    const res = validateFormulaSyntax(formula);
    if (!res.valid) {
      addError(
        'formula_syntax',
        collection,
        `Invalid formula in ${context}: ${res.error}`,
        entityId,
      );
    }
  };

  // 1. Validate abilities-and-skills.json
  const abilitiesAndSkillsParse = AbilitiesAndSkillsFileSchema.safeParse(
    dataset.abilitiesAndSkills,
  );
  if (!abilitiesAndSkillsParse.success) {
    addError(
      'schema',
      'abilities-and-skills',
      abilitiesAndSkillsParse.error.message,
    );
  } else {
    const abilityIdSet = new Set(dataset.abilitiesAndSkills.abilities.map((a) => a.id));
    for (const ab of ABILITY_IDS) {
      if (!abilityIdSet.has(ab)) {
        addError('schema', 'abilities-and-skills', `Missing canonical ability "${ab}"`);
      }
    }
    const skillIdSet = new Set(dataset.abilitiesAndSkills.skills.map((s) => s.id));
    for (const sk of SKILL_IDS) {
      if (!skillIdSet.has(sk)) {
        addError('schema', 'abilities-and-skills', `Missing canonical skill "${sk}"`);
      }
    }
    for (const skill of dataset.abilitiesAndSkills.skills) {
      if (SKILL_DEFAULT_ABILITY[skill.id] !== skill.ability) {
        addError(
          'cross_reference',
          'abilities-and-skills',
          `Skill "${skill.id}" has governing ability "${skill.ability}", expected "${SKILL_DEFAULT_ABILITY[skill.id]}"`,
          skill.id,
        );
      }
    }
  }

  // Helper to check collection schema + duplicate IDs
  function validateCollection<T extends { id: string }>(
    collectionName: string,
    items: readonly T[],
    schema: { safeParse: (val: unknown) => { success: boolean; error?: { message: string } } },
  ): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of items) {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        addError(
          'schema',
          collectionName,
          parsed.error?.message ?? 'Schema validation failed',
          item.id,
        );
      }
      if (map.has(item.id)) {
        addError(
          'duplicate_id',
          collectionName,
          `Duplicate ID "${item.id}" in ${collectionName}`,
          item.id,
        );
      } else {
        map.set(item.id, item);
      }
    }
    return map;
  }

  // 2. Conditions & Damage Types
  const conditionMap = validateCollection(
    'conditions',
    dataset.conditions,
    ConditionDefinitionSchema,
  );
  for (const condId of CONDITION_IDS) {
    if (!conditionMap.has(condId)) {
      addError('schema', 'conditions', `Missing canonical SRD condition "${condId}"`);
    }
  }
  for (const cond of dataset.conditions) {
    collectModifierFormulas(cond.modifiers, (f, ctx) =>
      checkFormula('conditions', cond.id, f, ctx),
    );
  }

  const damageTypeMap = validateCollection(
    'damage-types',
    dataset.damageTypes,
    DamageTypeDefinitionSchema,
  );
  for (const dt of DAMAGE_TYPES) {
    if (!damageTypeMap.has(dt)) {
      addError('schema', 'damage-types', `Missing canonical SRD damage type "${dt}"`);
    }
  }

  // 3. Proficiencies & Languages
  const profLangParse = ProficienciesAndLanguagesFileSchema.safeParse(
    dataset.proficienciesAndLanguages,
  );
  if (!profLangParse.success) {
    addError('schema', 'proficiencies-and-languages', profLangParse.error.message);
  }
  const proficiencyMap = new Map<string, (typeof dataset.proficienciesAndLanguages.proficiencies)[number]>();
  for (const prof of dataset.proficienciesAndLanguages.proficiencies) {
    if (proficiencyMap.has(prof.id)) {
      addError(
        'duplicate_id',
        'proficiencies',
        `Duplicate proficiency ID "${prof.id}"`,
        prof.id,
      );
    } else {
      proficiencyMap.set(prof.id, prof);
    }
  }
  const languageMap = new Map<string, (typeof dataset.proficienciesAndLanguages.languages)[number]>();
  for (const lang of dataset.proficienciesAndLanguages.languages) {
    if (languageMap.has(lang.id)) {
      addError('duplicate_id', 'languages', `Duplicate language ID "${lang.id}"`, lang.id);
    } else {
      languageMap.set(lang.id, lang);
    }
  }

  // 4. Validate primary entity collections
  const raceMap = validateCollection('races', dataset.races, RaceSchema);
  const subraceMap = validateCollection('subraces', dataset.subraces, SubraceSchema);
  const classMap = validateCollection('classes', dataset.classes, ClassSchema);
  const subclassMap = validateCollection('subclasses', dataset.subclasses, SubclassSchema);
  const featureMap = validateCollection('features', dataset.features, FeatureSchema);
  const backgroundMap = validateCollection('backgrounds', dataset.backgrounds, BackgroundSchema);
  const featMap = validateCollection('feats', dataset.feats, FeatSchema);
  const equipmentMap = validateCollection('equipment', dataset.equipment, EquipmentSchema);
  const magicItemMap = validateCollection('magic-items', dataset.magicItems, MagicItemSchema);
  const spellMap = validateCollection('spells', dataset.spells, SpellSchema);
  const monsterMap = validateCollection('monsters', dataset.monsters, MonsterSchema);

  // Validate proficiency equipmentIds references
  for (const prof of dataset.proficienciesAndLanguages.proficiencies) {
    for (const eqId of prof.equipmentIds ?? []) {
      if (!equipmentMap.has(eqId)) {
        addError(
          'cross_reference',
          'proficiencies',
          `Proficiency "${prof.id}" references unknown equipmentId "${eqId}"`,
          prof.id,
        );
      }
    }
  }

  const isKnownProficiencyOrItem = (id: string): boolean =>
    proficiencyMap.has(id) || equipmentMap.has(id) || VALID_SKILL_SET.has(id);

  // ChoiceSpec cross-reference & formula helper
  const validateChoices = (
    collection: string,
    entityId: string,
    choices: readonly ChoiceSpec[] | undefined,
  ): void => {
    if (!choices) return;
    for (const choice of choices) {
      switch (choice.type) {
        case 'skill':
          if (choice.from.mode === 'explicit') {
            for (const opt of choice.from.options) {
              if (!VALID_SKILL_SET.has(opt)) {
                addError(
                  'cross_reference',
                  collection,
                  `Choice "${choice.id}" references unknown skill "${opt}"`,
                  entityId,
                );
              }
            }
          }
          break;
        case 'language':
          if (choice.from.mode === 'explicit') {
            for (const opt of choice.from.options) {
              if (!languageMap.has(opt)) {
                addError(
                  'cross_reference',
                  collection,
                  `Choice "${choice.id}" references unknown language "${opt}"`,
                  entityId,
                );
              }
            }
          }
          break;
        case 'tool':
        case 'proficiency':
          if (choice.from.mode === 'explicit') {
            for (const opt of choice.from.options) {
              if (!isKnownProficiencyOrItem(opt)) {
                addError(
                  'cross_reference',
                  collection,
                  `Choice "${choice.id}" references unknown proficiency or item "${opt}"`,
                  entityId,
                );
              }
            }
          }
          break;
        case 'spell':
          if (!classMap.has(choice.classList)) {
            addError(
              'cross_reference',
              collection,
              `Spell choice "${choice.id}" references unknown classList "${choice.classList}"`,
              entityId,
            );
          }
          break;
        case 'equipment_bundle':
          for (const branch of choice.options) {
            for (const entry of branch.items) {
              if (entry.kind === 'item' && !equipmentMap.has(entry.itemId)) {
                addError(
                  'cross_reference',
                  collection,
                  `Equipment choice "${choice.id}" branch "${branch.id}" references unknown itemId "${entry.itemId}"`,
                  entityId,
                );
              }
            }
          }
          break;
        case 'feature_option':
          // If options reference feature IDs in features.json (e.g., fighting-style-*), verify they exist
          if (choice.featureGroup === 'fighting-style') {
            for (const opt of choice.options) {
              if (!featureMap.has(opt)) {
                addError(
                  'cross_reference',
                  collection,
                  `Feature option choice "${choice.id}" references unknown feature "${opt}"`,
                  entityId,
                );
              }
            }
          }
          break;
        default:
          break;
      }
    }
  };

  // 5. Races & Subraces validation
  for (const raceId of ALLOWED_SRD_RACE_IDS) {
    if (!raceMap.has(raceId)) {
      addError('allowlist', 'races', `Missing canonical SRD 5.1 race "${raceId}"`);
    }
  }
  for (const race of dataset.races) {
    if (!ALLOWED_SRD_RACE_IDS.has(race.id)) {
      addError('allowlist', 'races', `Non-SRD race ID "${race.id}" is not allowed`, race.id);
    }
    for (const subId of race.subraceIds) {
      const sub = subraceMap.get(subId);
      if (!sub) {
        addError(
          'cross_reference',
          'races',
          `Race "${race.id}" references missing subraceId "${subId}"`,
          race.id,
        );
      } else if (sub.parentRaceId !== race.id) {
        addError(
          'cross_reference',
          'races',
          `Subrace "${subId}" has parentRaceId "${sub.parentRaceId}", expected "${race.id}"`,
          race.id,
        );
      }
    }
    for (const langId of race.languages) {
      if (!languageMap.has(langId)) {
        addError(
          'cross_reference',
          'races',
          `Race "${race.id}" references unknown language "${langId}"`,
          race.id,
        );
      }
    }
    for (const profId of race.proficiencies) {
      if (!isKnownProficiencyOrItem(profId)) {
        addError(
          'cross_reference',
          'races',
          `Race "${race.id}" references unknown proficiency "${profId}"`,
          race.id,
        );
      }
    }
    validateChoices('races', race.id, race.choices);
    for (const trait of race.traits) {
      validateChoices('races', race.id, trait.choices);
      collectModifierFormulas(trait.modifiers, (f, ctx) =>
        checkFormula('races', race.id, f, `trait(${trait.id}).${ctx}`),
      );
      for (const ab of trait.activatedAbilities ?? []) {
        if (ab.targeting?.maxTargets && typeof ab.targeting.maxTargets === 'string') {
          checkFormula('races', race.id, ab.targeting.maxTargets, `trait(${trait.id}).maxTargets`);
        }
        collectEffectStepFormulas(ab.effects, (f, ctx) =>
          checkFormula('races', race.id, f, `trait(${trait.id}).ability(${ab.id}).${ctx}`),
        );
      }
      for (const grant of trait.innateSpells ?? []) {
        if (!spellMap.has(grant.spellId)) {
          addError(
            'cross_reference',
            'races',
            `Race "${race.id}" trait "${trait.id}" references unknown innate spell "${grant.spellId}"`,
            race.id,
          );
        }
      }
    }
  }

  for (const subraceId of ALLOWED_SRD_SUBRACE_IDS) {
    if (!subraceMap.has(subraceId)) {
      addError('allowlist', 'subraces', `Missing canonical SRD 5.1 subrace "${subraceId}"`);
    }
  }
  for (const subrace of dataset.subraces) {
    if (!ALLOWED_SRD_SUBRACE_IDS.has(subrace.id)) {
      addError(
        'allowlist',
        'subraces',
        `Non-SRD subrace ID "${subrace.id}" is not allowed`,
        subrace.id,
      );
    }
    const parent = raceMap.get(subrace.parentRaceId);
    if (!parent) {
      addError(
        'cross_reference',
        'subraces',
        `Subrace "${subrace.id}" references unknown parentRaceId "${subrace.parentRaceId}"`,
        subrace.id,
      );
    } else if (!parent.subraceIds.includes(subrace.id)) {
      addError(
        'cross_reference',
        'subraces',
        `Parent race "${parent.id}" does not list subrace "${subrace.id}" in subraceIds`,
        subrace.id,
      );
    }
    for (const langId of subrace.languages ?? []) {
      if (!languageMap.has(langId)) {
        addError(
          'cross_reference',
          'subraces',
          `Subrace "${subrace.id}" references unknown language "${langId}"`,
          subrace.id,
        );
      }
    }
    for (const profId of subrace.proficiencies) {
      if (!isKnownProficiencyOrItem(profId)) {
        addError(
          'cross_reference',
          'subraces',
          `Subrace "${subrace.id}" references unknown proficiency "${profId}"`,
          subrace.id,
        );
      }
    }
    validateChoices('subraces', subrace.id, subrace.choices);
    for (const trait of subrace.traits) {
      validateChoices('subraces', subrace.id, trait.choices);
      collectModifierFormulas(trait.modifiers, (f, ctx) =>
        checkFormula('subraces', subrace.id, f, `trait(${trait.id}).${ctx}`),
      );
      for (const ab of trait.activatedAbilities ?? []) {
        collectEffectStepFormulas(ab.effects, (f, ctx) =>
          checkFormula('subraces', subrace.id, f, `trait(${trait.id}).ability(${ab.id}).${ctx}`),
        );
      }
      for (const grant of trait.innateSpells ?? []) {
        if (!spellMap.has(grant.spellId)) {
          addError(
            'cross_reference',
            'subraces',
            `Subrace "${subrace.id}" trait "${trait.id}" references unknown innate spell "${grant.spellId}"`,
            subrace.id,
          );
        }
      }
    }
  }

  // 6. Classes, Subclasses & Features validation
  for (const clsId of ALLOWED_SRD_CLASS_IDS) {
    if (!classMap.has(clsId)) {
      addError('allowlist', 'classes', `Missing canonical SRD 5.1 class "${clsId}"`);
    }
  }
  for (const cls of dataset.classes) {
    if (!ALLOWED_SRD_CLASS_IDS.has(cls.id)) {
      addError('allowlist', 'classes', `Non-SRD class ID "${cls.id}" is not allowed`, cls.id);
    }
    checkFormula('classes', cls.id, cls.startingGoldFormula, 'startingGoldFormula');
    for (const profId of [
      ...cls.armorProficiencies,
      ...cls.weaponProficiencies,
      ...cls.toolProficiencies,
    ]) {
      if (!isKnownProficiencyOrItem(profId)) {
        addError(
          'cross_reference',
          'classes',
          `Class "${cls.id}" references unknown proficiency "${profId}"`,
          cls.id,
        );
      }
    }
    validateChoices('classes', cls.id, [
      cls.skillChoices,
      ...(cls.toolChoices ?? []),
      ...cls.startingEquipmentChoices,
    ]);
    for (const itemGrant of cls.startingEquipmentDefault ?? []) {
      if (!equipmentMap.has(itemGrant.itemId)) {
        addError(
          'cross_reference',
          'classes',
          `Class "${cls.id}" startingEquipmentDefault references unknown itemId "${itemGrant.itemId}"`,
          cls.id,
        );
      }
    }
    for (const subId of cls.subclassIds ?? []) {
      const sub = subclassMap.get(subId);
      if (!sub) {
        addError(
          'cross_reference',
          'classes',
          `Class "${cls.id}" references unknown subclassId "${subId}"`,
          cls.id,
        );
      } else if (sub.classId !== cls.id) {
        addError(
          'cross_reference',
          'classes',
          `Subclass "${subId}" has classId "${sub.classId}", expected "${cls.id}"`,
          cls.id,
        );
      }
    }
    for (const lvl of cls.levels) {
      for (const featId of lvl.featureIds) {
        const feat = featureMap.get(featId);
        if (!feat) {
          addError(
            'cross_reference',
            'classes',
            `Class "${cls.id}" level ${lvl.level} references missing featureId "${featId}"`,
            cls.id,
          );
        } else if (feat.classId !== cls.id) {
          addError(
            'cross_reference',
            'classes',
            `Feature "${featId}" referenced by class "${cls.id}" has mismatched classId "${feat.classId}"`,
            cls.id,
          );
        }
      }
    }
  }

  for (const subId of ALLOWED_SRD_SUBCLASS_IDS) {
    if (!subclassMap.has(subId)) {
      addError('allowlist', 'subclasses', `Missing canonical SRD 5.1 subclass "${subId}"`);
    }
  }
  for (const sc of dataset.subclasses) {
    if (sc.source === 'homebrew') {
      const screenResult = screenHomebrewRecord(sc, options);
      for (const violation of screenResult.violations) {
        addError(
          'allowlist',
          'subclasses',
          `Subclass "${sc.name}" (${sc.id}) failed Product Identity gate: ${violation}`,
          sc.id,
        );
      }
    } else if (!ALLOWED_SRD_SUBCLASS_IDS.has(sc.id)) {
      addError(
        'allowlist',
        'subclasses',
        `Non-SRD subclass ID "${sc.id}" is not allowed`,
        sc.id,
      );
    }
    if (!classMap.has(sc.classId)) {
      addError(
        'cross_reference',
        'subclasses',
        `Subclass "${sc.id}" references unknown classId "${sc.classId}"`,
        sc.id,
      );
    }
    for (const lvl of sc.levels) {
      for (const featId of lvl.featureIds) {
        const feat = featureMap.get(featId);
        if (!feat) {
          addError(
            'cross_reference',
            'subclasses',
            `Subclass "${sc.id}" level ${lvl.level} references missing featureId "${featId}"`,
            sc.id,
          );
        } else if (feat.subclassId && feat.subclassId !== sc.id) {
          addError(
            'cross_reference',
            'subclasses',
            `Feature "${featId}" referenced by subclass "${sc.id}" has mismatched subclassId "${feat.subclassId}"`,
            sc.id,
          );
        }
      }
    }
    for (const spellGrant of sc.spells ?? []) {
      for (const spellId of spellGrant.spellIds) {
        if (!spellMap.has(spellId)) {
          addError(
            'cross_reference',
            'subclasses',
            `Subclass "${sc.id}" level ${spellGrant.classLevel} spell grant references missing spellId "${spellId}"`,
            sc.id,
          );
        }
      }
    }
  }

  for (const feat of dataset.features) {
    if (!classMap.has(feat.classId)) {
      addError(
        'cross_reference',
        'features',
        `Feature "${feat.id}" references unknown classId "${feat.classId}"`,
        feat.id,
      );
    }
    if (feat.subclassId && !subclassMap.has(feat.subclassId)) {
      addError(
        'cross_reference',
        'features',
        `Feature "${feat.id}" references unknown subclassId "${feat.subclassId}"`,
        feat.id,
      );
    }
    validateChoices('features', feat.id, feat.choices);
    collectModifierFormulas(feat.modifiers, (f, ctx) =>
      checkFormula('features', feat.id, f, ctx),
    );
    for (const ab of feat.activatedAbilities ?? []) {
      if (ab.targeting?.maxTargets && typeof ab.targeting.maxTargets === 'string') {
        checkFormula('features', feat.id, ab.targeting.maxTargets, `ability(${ab.id}).maxTargets`);
      }
      collectEffectStepFormulas(ab.effects, (f, ctx) =>
        checkFormula('features', feat.id, f, `ability(${ab.id}).${ctx}`),
      );
    }
  }

  // 7. Backgrounds & Feats validation
  for (const bgId of ALLOWED_SRD_BACKGROUND_IDS) {
    if (!backgroundMap.has(bgId)) {
      addError('allowlist', 'backgrounds', `Missing canonical SRD 5.1 background "${bgId}"`);
    }
  }
  for (const bg of dataset.backgrounds) {
    if (bg.source === 'homebrew') {
      const screenResult = screenHomebrewRecord(
        {
          id: bg.id,
          name: bg.name,
          description: bg.description,
          source: bg.source,
          humanReviewed: (bg as any).humanReviewed,
          feature: bg.feature,
        },
        options,
      );
      for (const violation of screenResult.violations) {
        addError(
          'allowlist',
          'backgrounds',
          `Background "${bg.name}" (${bg.id}) failed Product Identity gate: ${violation}`,
          bg.id,
        );
      }
    } else if (!ALLOWED_SRD_BACKGROUND_IDS.has(bg.id)) {
      addError(
        'allowlist',
        'backgrounds',
        `Non-SRD background ID "${bg.id}" is not allowed`,
        bg.id,
      );
    }
    for (const toolId of bg.toolProficiencies) {
      if (!isKnownProficiencyOrItem(toolId)) {
        addError(
          'cross_reference',
          'backgrounds',
          `Background "${bg.id}" references unknown toolProficiency "${toolId}"`,
          bg.id,
        );
      }
    }
    for (const langId of bg.languages) {
      if (!languageMap.has(langId)) {
        addError(
          'cross_reference',
          'backgrounds',
          `Background "${bg.id}" references unknown language "${langId}"`,
          bg.id,
        );
      }
    }
    validateChoices('backgrounds', bg.id, bg.choices);
    for (const eq of bg.startingEquipment) {
      if (!equipmentMap.has(eq.itemId)) {
        addError(
          'cross_reference',
          'backgrounds',
          `Background "${bg.id}" startingEquipment references unknown itemId "${eq.itemId}"`,
          bg.id,
        );
      }
    }
  }

  for (const featId of ALLOWED_SRD_FEAT_IDS) {
    if (!featMap.has(featId)) {
      addError('allowlist', 'feats', `Missing canonical SRD 5.1 feat "${featId}"`);
    }
  }
  for (const feat of dataset.feats) {
    if (feat.source === 'homebrew') {
      const screenResult = screenHomebrewRecord(
        {
          id: feat.id,
          name: feat.name,
          description: feat.description,
          source: feat.source,
          humanReviewed: (feat as any).humanReviewed,
        },
        options,
      );
      for (const violation of screenResult.violations) {
        addError(
          'allowlist',
          'feats',
          `Feat "${feat.name}" (${feat.id}) failed Product Identity gate: ${violation}`,
          feat.id,
        );
      }
    } else if (!ALLOWED_SRD_FEAT_IDS.has(feat.id)) {
      addError('allowlist', 'feats', `Non-SRD feat ID "${feat.id}" is not allowed`, feat.id);
    }
    for (const prereq of feat.prerequisites) {
      if (prereq.type === 'proficiency' && !isKnownProficiencyOrItem(prereq.proficiencyId)) {
        addError(
          'cross_reference',
          'feats',
          `Feat "${feat.id}" prerequisite references unknown proficiencyId "${prereq.proficiencyId}"`,
          feat.id,
        );
      }
    }
    validateChoices('feats', feat.id, feat.choices);
    collectModifierFormulas(feat.modifiers, (f, ctx) => checkFormula('feats', feat.id, f, ctx));
    for (const ab of feat.activatedAbilities ?? []) {
      collectEffectStepFormulas(ab.effects, (f, ctx) =>
        checkFormula('feats', feat.id, f, `ability(${ab.id}).${ctx}`),
      );
    }
  }

  // 8. Equipment & Magic Items validation
  for (const item of dataset.equipment) {
    if (item.kind === 'weapon') {
      checkFormula('equipment', item.id, item.damageDice, 'damageDice');
      if (item.versatileDamageDice) {
        checkFormula('equipment', item.id, item.versatileDamageDice, 'versatileDamageDice');
      }
    } else if (item.kind === 'gear') {
      collectModifierFormulas(item.modifiers, (f, ctx) =>
        checkFormula('equipment', item.id, f, ctx),
      );
      for (const ab of item.activatedAbilities ?? []) {
        collectEffectStepFormulas(ab.effects, (f, ctx) =>
          checkFormula('equipment', item.id, f, `ability(${ab.id}).${ctx}`),
        );
      }
    } else if (item.kind === 'pack') {
      for (const entry of item.contents) {
        if (!equipmentMap.has(entry.itemId)) {
          addError(
            'cross_reference',
            'equipment',
            `Equipment pack "${item.id}" references unknown content itemId "${entry.itemId}"`,
            item.id,
          );
        }
      }
    }
  }

  for (const mi of dataset.magicItems) {
    if (
      containsProductIdentityProperName(mi.id) ||
      containsProductIdentityProperName(mi.name)
    ) {
      addError(
        'allowlist',
        'magic-items',
        `Magic item "${mi.name}" (${mi.id}) contains prohibited Product Identity proper name`,
        mi.id,
      );
    }
    if (
      mi.source !== 'homebrew' &&
      (isSrd52OnlyIdentifier(mi.id) || isSrd52OnlyIdentifier(mi.name))
    ) {
      addError(
        'allowlist',
        'magic-items',
        `Magic item "${mi.name}" (${mi.id}) is an SRD 5.2 addition and not allowed on the SRD 5.1 track`,
        mi.id,
      );
    }
    if (mi.baseEquipmentId && !equipmentMap.has(mi.baseEquipmentId)) {
      addError(
        'cross_reference',
        'magic-items',
        `Magic item "${mi.id}" references unknown baseEquipmentId "${mi.baseEquipmentId}"`,
        mi.id,
      );
    }
    if (mi.charges?.rechargeFormula) {
      checkFormula('magic-items', mi.id, mi.charges.rechargeFormula, 'charges.rechargeFormula');
    }
    collectModifierFormulas(mi.modifiers, (f, ctx) =>
      checkFormula('magic-items', mi.id, f, ctx),
    );
    for (const ab of mi.activatedAbilities ?? []) {
      if (ab.targeting?.maxTargets && typeof ab.targeting.maxTargets === 'string') {
        checkFormula('magic-items', mi.id, ab.targeting.maxTargets, `ability(${ab.id}).maxTargets`);
      }
      collectEffectStepFormulas(ab.effects, (f, ctx) =>
        checkFormula('magic-items', mi.id, f, `ability(${ab.id}).${ctx}`),
      );
    }
  }

  // 9. Spells validation
  for (const spell of dataset.spells) {
    if (
      containsProductIdentityProperName(spell.id) ||
      containsProductIdentityProperName(spell.name)
    ) {
      addError(
        'allowlist',
        'spells',
        `Spell "${spell.name}" (${spell.id}) contains prohibited Product Identity proper name`,
        spell.id,
      );
    }
    if (
      spell.source !== 'homebrew' &&
      (isSrd52OnlyIdentifier(spell.id) || isSrd52OnlyIdentifier(spell.name))
    ) {
      addError(
        'allowlist',
        'spells',
        `Spell "${spell.name}" (${spell.id}) is an SRD 5.2 addition and not allowed on the SRD 5.1 track`,
        spell.id,
      );
    }
    for (const clsId of spell.classes) {
      if (!classMap.has(clsId)) {
        addError(
          'cross_reference',
          'spells',
          `Spell "${spell.id}" references unknown classId "${clsId}"`,
          spell.id,
        );
      }
    }
    for (const subId of spell.subclasses ?? []) {
      if (!subclassMap.has(subId)) {
        addError(
          'cross_reference',
          'spells',
          `Spell "${spell.id}" references unknown subclassId "${subId}"`,
          spell.id,
        );
      }
    }
    if (spell.targeting.maxTargets && typeof spell.targeting.maxTargets === 'string') {
      checkFormula('spells', spell.id, spell.targeting.maxTargets, 'targeting.maxTargets');
    }
    collectEffectStepFormulas(spell.effects, (f, ctx) =>
      checkFormula('spells', spell.id, f, ctx),
    );
    if (spell.higherLevelScaling) {
      if (spell.higherLevelScaling.bonusDicePerSlotAboveBase) {
        checkFormula(
          'spells',
          spell.id,
          spell.higherLevelScaling.bonusDicePerSlotAboveBase,
          'higherLevelScaling.bonusDicePerSlotAboveBase',
        );
      }
      for (const [tierKey, override] of Object.entries(
        spell.higherLevelScaling.overrides ?? {},
      )) {
        if ('diceFormula' in override && typeof override.diceFormula === 'string') {
          checkFormula(
            'spells',
            spell.id,
            override.diceFormula,
            `higherLevelScaling.overrides[${tierKey}].diceFormula`,
          );
        }
        if ('amountFormula' in override && typeof override.amountFormula === 'string') {
          checkFormula(
            'spells',
            spell.id,
            override.amountFormula,
            `higherLevelScaling.overrides[${tierKey}].amountFormula`,
          );
        }
      }
    }
  }

  // 10. Monsters validation
  const validateMonsterSpellcasting = (
    monsterId: string,
    sc: MonsterSpellcastingSpec | undefined,
    context: string,
  ): void => {
    if (!sc) return;
    if (sc.classId && !classMap.has(sc.classId)) {
      addError(
        'cross_reference',
        'monsters',
        `Monster "${monsterId}" ${context} references unknown classId "${sc.classId}"`,
        monsterId,
      );
    }
    const allSpellRefs = [
      ...(sc.atWillSpellIds ?? []),
      ...(sc.preparedSpellIds ?? []),
      ...(sc.perDaySpells ?? []).flatMap((p) => p.spellIds),
    ];
    for (const spellId of allSpellRefs) {
      if (!spellMap.has(spellId)) {
        addError(
          'cross_reference',
          'monsters',
          `Monster "${monsterId}" ${context} references unknown spellId "${spellId}"`,
          monsterId,
        );
      }
    }
  };

  for (const monster of dataset.monsters) {
    if (isProhibitedMonsterId(monster.id) || isProhibitedMonsterId(monster.name)) {
      addError(
        'allowlist',
        'monsters',
        `Monster "${monster.name}" (${monster.id}) is prohibited Product Identity outside SRD 5.1`,
        monster.id,
      );
    }
    if (
      monster.source !== 'homebrew' &&
      (isSrd52OnlyIdentifier(monster.id) || isSrd52OnlyIdentifier(monster.name))
    ) {
      addError(
        'allowlist',
        'monsters',
        `Monster "${monster.name}" (${monster.id}) is an SRD 5.2 addition and must carry source: "homebrew" if original`,
        monster.id,
      );
    }
    checkFormula('monsters', monster.id, monster.hitPoints.rollFormula, 'hitPoints.rollFormula');
    for (const armorId of monster.armorClass.armorIds ?? []) {
      if (!equipmentMap.has(armorId)) {
        addError(
          'cross_reference',
          'monsters',
          `Monster "${monster.id}" armorClass references unknown armorId "${armorId}"`,
          monster.id,
        );
      }
    }
    validateMonsterSpellcasting(monster.id, monster.spellcasting, 'spellcasting');

    for (const trait of monster.traits) {
      collectModifierFormulas(trait.modifiers, (f, ctx) =>
        checkFormula('monsters', monster.id, f, `trait(${trait.id}).${ctx}`),
      );
      for (const ab of trait.activatedAbilities ?? []) {
        collectEffectStepFormulas(ab.effects, (f, ctx) =>
          checkFormula('monsters', monster.id, f, `trait(${trait.id}).ability(${ab.id}).${ctx}`),
        );
      }
      validateMonsterSpellcasting(
        monster.id,
        trait.spellcasting,
        `trait(${trait.id}).spellcasting`,
      );
    }

    const actionIdSet = new Set(monster.actions.map((a) => a.id));
    for (const action of monster.actions) {
      if (action.multiattack) {
        for (const seq of action.multiattack.sequence) {
          if (!actionIdSet.has(seq.actionId)) {
            addError(
              'cross_reference',
              'monsters',
              `Monster "${monster.id}" multiattack references unknown actionId "${seq.actionId}"`,
              monster.id,
            );
          }
        }
      }
      if (action.targeting?.maxTargets && typeof action.targeting.maxTargets === 'string') {
        checkFormula(
          'monsters',
          monster.id,
          action.targeting.maxTargets,
          `action(${action.id}).maxTargets`,
        );
      }
      collectEffectStepFormulas(action.effects, (f, ctx) =>
        checkFormula('monsters', monster.id, f, `action(${action.id}).${ctx}`),
      );
    }

    for (const bonusAction of monster.bonusActions ?? []) {
      collectEffectStepFormulas(bonusAction.effects, (f, ctx) =>
        checkFormula('monsters', monster.id, f, `bonusAction(${bonusAction.id}).${ctx}`),
      );
    }

    for (const reaction of monster.reactions ?? []) {
      collectEffectStepFormulas(reaction.effects, (f, ctx) =>
        checkFormula('monsters', monster.id, f, `reaction(${reaction.id}).${ctx}`),
      );
    }

    for (const legAction of monster.legendaryActions?.actions ?? []) {
      collectEffectStepFormulas(legAction.effects, (f, ctx) =>
        checkFormula('monsters', monster.id, f, `legendaryAction(${legAction.id}).${ctx}`),
      );
    }
  }

  // 11. SRD-1212 relevance contract: every offered spell/skill/language must
  // resolve or carry an explicit tracking ticket. Runs inside the shared
  // validator so the integrity suite fails on new dangling offered content.
  for (const relevanceError of validateRelevanceCoverage(dataset)) {
    errors.push(relevanceError);
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      abilities: dataset.abilitiesAndSkills.abilities.length,
      skills: dataset.abilitiesAndSkills.skills.length,
      conditions: dataset.conditions.length,
      damageTypes: dataset.damageTypes.length,
      proficiencies: dataset.proficienciesAndLanguages.proficiencies.length,
      languages: dataset.proficienciesAndLanguages.languages.length,
      races: dataset.races.length,
      subraces: dataset.subraces.length,
      classes: dataset.classes.length,
      subclasses: dataset.subclasses.length,
      features: dataset.features.length,
      backgrounds: dataset.backgrounds.length,
      feats: dataset.feats.length,
      equipment: dataset.equipment.length,
      magicItems: dataset.magicItems.length,
      spells: dataset.spells.length,
      monsters: dataset.monsters.length,
    },
  };
}

/**
 * Validates the dataset and throws an Error with detailed diagnostics if any check fails.
 */
export function assertValidSrdDataset(dataset: SrdIngestionInput): SrdValidationReport {
  const report = validateSrdDataset(dataset);
  if (!report.valid) {
    const formatted = report.errors
      .slice(0, 25)
      .map(
        (e) =>
          `  - [${e.category}] ${e.collection}${e.entityId ? ` (${e.entityId})` : ''}: ${e.message}`,
      )
      .join('\n');
    const extra =
      report.errors.length > 25 ? `\n  ...and ${report.errors.length - 25} more error(s)` : '';
    throw new Error(
      `SRD 5.1 Dataset Validation Failed with ${report.errors.length} error(s):\n${formatted}${extra}`,
    );
  }
  return report;
}
