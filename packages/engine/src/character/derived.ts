import {
  ABILITY_IDS,
  type AbilityId,
  type ActivatedAbilitySpec,
  type ArmorData,
  type ClassData,
  type CompendiumData,
  type ConditionId,
  type DamageType,
  type FeatureData,
  type MagicItemData,
  type ModifierSpec,
  type PredicateSpec,
  SKILL_DEFAULT_ABILITY,
  SKILL_IDS,
  type SkillId,
  type SubclassData,
  type WeaponData,
  createCompendium,
} from '@srd5/data';
import {
  type FormulaContext,
  evaluateStaticFormula,
  resolveRollMode,
} from '../dice/evaluator.js';
import { tryParseFormula } from '../dice/ast.js';
import { computeAbilityModifier } from './ability-generation.js';
import { getActiveWeaponSlotIds } from './weapon-sets.js';
import {
  normalizeFeatureOptionId,
  resolveProficienciesAndDuplicates,
  validateCharacterChoices,
} from './choices.js';
import {
  type AcFormulaCandidate,
  type CharacterBuildState,
  type CharacterClassEntry,
  type DerivedAbilitiesMap,
  type DerivedAbilityScore,
  type DerivedArmorClass,
  type DerivedCharacterSheet,
  type DerivedClassSpellcasting,
  type DerivedClassSummary,
  type DerivedInitiative,
  type DerivedPactMagic,
  type DerivedProficiencies,
  type DerivedResourcePool,
  type DerivedSavingThrow,
  type DerivedSavingThrowsMap,
  type DerivedSenses,
  type DerivedSkill,
  type DerivedSkillsMap,
  type DerivedSpellSlotPool,
  type DerivedSpellSlotsMap,
  type DerivedSpellcastingSummary,
  type DerivedWeaponAttackProfile,
  type HitDiePoolEntry,
  type InventoryItemInstance,
  type ModifierContribution,
  type SkillProficiencyLevel,
  type SourcedModifier,
  type WeaponSlotType,
} from './schemas.js';

// ============================================================================
// 1. SRD 5.1 Constants & Reference Tables
// ============================================================================

export const ABILITY_NAMES: Readonly<Record<AbilityId, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/**
 * SRD 5.1 Multiclass Spellcaster Table: Spell Slots per Spell Level for Effective Caster Levels 1..20.
 */
export const MULTICLASS_SPELL_SLOTS_TABLE: Readonly<
  Record<number, readonly [number, number, number, number, number, number, number, number, number]>
> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

/**
 * SRD 5.1 Draconic Ancestry table mapping dragon color to damage type, breath shape, and saving throw.
 */
export interface DraconicAncestryEntry {
  dragon: string;
  damageType: DamageType;
  aoeShape: 'line' | 'cone';
  sizeFeet: number;
  widthFeet?: number;
  saveAbility: AbilityId;
}

export const DRACONIC_ANCESTRY_TABLE: Readonly<Record<string, DraconicAncestryEntry>> = {
  black: {
    dragon: 'Black',
    damageType: 'acid',
    aoeShape: 'line',
    sizeFeet: 30,
    widthFeet: 5,
    saveAbility: 'dex',
  },
  blue: {
    dragon: 'Blue',
    damageType: 'lightning',
    aoeShape: 'line',
    sizeFeet: 30,
    widthFeet: 5,
    saveAbility: 'dex',
  },
  brass: {
    dragon: 'Brass',
    damageType: 'fire',
    aoeShape: 'line',
    sizeFeet: 30,
    widthFeet: 5,
    saveAbility: 'dex',
  },
  bronze: {
    dragon: 'Bronze',
    damageType: 'lightning',
    aoeShape: 'line',
    sizeFeet: 30,
    widthFeet: 5,
    saveAbility: 'dex',
  },
  copper: {
    dragon: 'Copper',
    damageType: 'acid',
    aoeShape: 'line',
    sizeFeet: 30,
    widthFeet: 5,
    saveAbility: 'dex',
  },
  gold: {
    dragon: 'Gold',
    damageType: 'fire',
    aoeShape: 'cone',
    sizeFeet: 15,
    saveAbility: 'dex',
  },
  green: {
    dragon: 'Green',
    damageType: 'poison',
    aoeShape: 'cone',
    sizeFeet: 15,
    saveAbility: 'con',
  },
  red: {
    dragon: 'Red',
    damageType: 'fire',
    aoeShape: 'cone',
    sizeFeet: 15,
    saveAbility: 'dex',
  },
  silver: {
    dragon: 'Silver',
    damageType: 'cold',
    aoeShape: 'cone',
    sizeFeet: 15,
    saveAbility: 'con',
  },
  white: {
    dragon: 'White',
    damageType: 'cold',
    aoeShape: 'cone',
    sizeFeet: 15,
    saveAbility: 'con',
  },
};

const ABILITY_ID_SET: ReadonlySet<string> = new Set(ABILITY_IDS);
const SKILL_ID_SET: ReadonlySet<string> = new Set(SKILL_IDS);

// ============================================================================
// 2. Internal Pipeline Types & Helpers
// ============================================================================

interface InternalSourcedModifier extends SourcedModifier {
  classId?: string | undefined;
  classLevel?: number | undefined;
  itemInstanceId?: string | undefined;
  isWeaponSpecific?: boolean | undefined;
}

interface ResolvedEquippedArmor {
  instance: InventoryItemInstance;
  armor: ArmorData;
  magicItem?: MagicItemData | undefined;
  displayName: string;
  magicAcBonus: number;
}

interface ResolvedEquippedWeapon {
  instance: InventoryItemInstance;
  weapon: WeaponData;
  magicItem?: MagicItemData | undefined;
  displayName: string;
  isMagical: boolean;
  magicAttackBonus: number;
  magicDamageBonus: number;
}

/**
 * Stage 1 helper: Computes SRD 5.1 Proficiency Bonus (`2..6`) from total character level (`1..20`).
 */
export function computeProficiencyBonus(totalLevel: number): number {
  const clamped = Math.min(20, Math.max(1, Math.floor(totalLevel)));
  return 2 + Math.floor((clamped - 1) / 4);
}

/**
 * Formats a dice expression and flat integer bonus into a compact damage formula string
 * (e.g. `"1d8"` + `4` -> `"1d8+4"`, `"1d6"` + `-1` -> `"1d6-1"`, `"1d4"` + `0` -> `"1d4"`).
 */
export function formatDamageFormula(damageDice: string, damageBonus: number): string {
  const base = damageDice.trim();
  if (damageBonus === 0) {
    return base;
  }
  if (damageBonus > 0) {
    return `${base}+${damageBonus}`;
  }
  return `${base}-${Math.abs(damageBonus)}`;
}

/**
 * Evaluates a `FlatBonusModifier`'s numeric or formula value safely.
 * Returns `null` if the formula contains random dice terms (such as `"1d4"` from Bless),
 * which are rolled dynamically during combat rather than added as a static integer bonus.
 */
function evaluateFlatModifierValue(
  value: number | string,
  context: FormulaContext,
): number | null {
  if (typeof value === 'number') {
    return Math.trunc(value);
  }
  const parsed = tryParseFormula(value);
  if (!parsed.valid) {
    return null;
  }
  try {
    return Math.trunc(evaluateStaticFormula(parsed.ast, context, false));
  } catch {
    // Formula contains dice nodes (e.g. "1d4" or "-1d4")
    return null;
  }
}

/**
 * Infers a base `WeaponData` for a generic magic weapon (such as `weapon-plus-1`)
 * from `magicItem.baseEquipmentId`, `instance.customName`, or `instance.itemId`.
 */
function resolveBaseWeaponForMagicItem(
  instance: InventoryItemInstance,
  magicItem: MagicItemData,
  compendium: CompendiumData,
): WeaponData | undefined {
  if (magicItem.baseEquipmentId) {
    const explicit = compendium.getWeapon(magicItem.baseEquipmentId);
    if (explicit) return explicit;
  }

  const directWeapon = compendium.getWeapon(instance.itemId);
  if (directWeapon) return directWeapon;

  const searchSource = `${instance.customName ?? ''} ${instance.instanceId}`.toLowerCase();
  const candidates = [...compendium.weapons].sort(
    (a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id),
  );
  for (const weapon of candidates) {
    if (
      searchSource.includes(weapon.name.toLowerCase()) ||
      searchSource.includes(weapon.id.toLowerCase())
    ) {
      return weapon;
    }
  }

  return compendium.getWeapon('longsword') ?? compendium.weapons[0];
}

/**
 * Infers a base `ArmorData` for a generic magic armor or shield (such as `armor-plus-1` or `shield-plus-1`)
 * from `magicItem.baseEquipmentId`, `instance.customName`, or `instance.itemId`.
 */
function resolveBaseArmorForMagicItem(
  instance: InventoryItemInstance,
  magicItem: MagicItemData,
  compendium: CompendiumData,
  expectShield: boolean,
): ArmorData | undefined {
  if (magicItem.baseEquipmentId) {
    const explicit = compendium.getArmor(magicItem.baseEquipmentId);
    if (explicit) return explicit;
  }

  if (expectShield || magicItem.id.startsWith('shield-')) {
    return compendium.getArmor('shield');
  }

  const searchSource = `${instance.customName ?? ''} ${instance.instanceId}`.toLowerCase();
  const nonShieldArmors = compendium.armors
    .filter((a) => a.category !== 'shield')
    .sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id));

  for (const armor of nonShieldArmors) {
    const shortName = armor.name.toLowerCase().replace(/\s+armor$/, '');
    if (
      searchSource.includes(armor.name.toLowerCase()) ||
      searchSource.includes(armor.id.toLowerCase()) ||
      (shortName.length >= 4 && searchSource.includes(shortName))
    ) {
      return armor;
    }
  }

  return compendium.getArmor('chain-mail') ?? nonShieldArmors[0];
}

/**
 * Resolves equipped armor, shield, and weapon instances from `state.inventory` and `state.equippedSlots`.
 */
function resolveEquippedGear(
  state: CharacterBuildState,
  compendium: CompendiumData,
): {
  equippedArmor?: ResolvedEquippedArmor | undefined;
  equippedShield?: ResolvedEquippedArmor | undefined;
  mainHandWeapon?: ResolvedEquippedWeapon | undefined;
  offHandWeapon?: ResolvedEquippedWeapon | undefined;
  rangedWeapon?: ResolvedEquippedWeapon | undefined;
} {
  const inventoryById = new Map<string, InventoryItemInstance>(
    state.inventory.map((item) => [item.instanceId, item]),
  );
  const attunedSet = new Set(state.attunedItemInstanceIds);

  const isMagicItemActive = (instanceId: string, magicItem: MagicItemData): boolean => {
    if (!magicItem.requiresAttunement) return true;
    return attunedSet.has(instanceId);
  };

  const resolveArmorSlot = (
    instanceId: string | undefined,
    expectShield: boolean,
  ): ResolvedEquippedArmor | undefined => {
    if (!instanceId) return undefined;
    const instance = inventoryById.get(instanceId);
    if (!instance) return undefined;

    const mundaneArmor = compendium.getArmor(instance.itemId);
    if (mundaneArmor) {
      if (expectShield && mundaneArmor.category !== 'shield') return undefined;
      if (!expectShield && mundaneArmor.category === 'shield') return undefined;
      return {
        instance,
        armor: mundaneArmor,
        displayName: instance.customName ?? mundaneArmor.name,
        magicAcBonus: 0,
      };
    }

    const magicItem = compendium.getMagicItem(instance.itemId);
    if (magicItem && magicItem.category === 'armor') {
      const baseArmor = resolveBaseArmorForMagicItem(
        instance,
        magicItem,
        compendium,
        expectShield,
      );
      if (!baseArmor) return undefined;
      if (expectShield && baseArmor.category !== 'shield') return undefined;
      if (!expectShield && baseArmor.category === 'shield') return undefined;

      let magicAcBonus = 0;
      if (isMagicItemActive(instance.instanceId, magicItem)) {
        for (const mod of magicItem.modifiers) {
          if (mod.type === 'flat_bonus' && mod.target === 'ac' && typeof mod.value === 'number') {
            magicAcBonus += mod.value;
          }
        }
      }

      return {
        instance,
        armor: baseArmor,
        magicItem,
        displayName: instance.customName ?? magicItem.name,
        magicAcBonus,
      };
    }

    return undefined;
  };

  const resolveWeaponSlot = (
    instanceId: string | undefined,
  ): ResolvedEquippedWeapon | undefined => {
    if (!instanceId) return undefined;
    const instance = inventoryById.get(instanceId);
    if (!instance) return undefined;

    const mundaneWeapon = compendium.getWeapon(instance.itemId);
    if (mundaneWeapon) {
      return {
        instance,
        weapon: mundaneWeapon,
        displayName: instance.customName ?? mundaneWeapon.name,
        isMagical: Boolean(instance.isMagicItem),
        magicAttackBonus: 0,
        magicDamageBonus: 0,
      };
    }

    const magicItem = compendium.getMagicItem(instance.itemId);
    if (magicItem && magicItem.category === 'weapon') {
      const baseWeapon = resolveBaseWeaponForMagicItem(instance, magicItem, compendium);
      if (!baseWeapon) return undefined;

      let magicAttackBonus = 0;
      let magicDamageBonus = 0;
      if (isMagicItemActive(instance.instanceId, magicItem)) {
        const atkTarget =
          baseWeapon.rangeType === 'ranged' ? 'ranged_attack' : 'melee_attack';
        const dmgTarget =
          baseWeapon.rangeType === 'ranged' ? 'ranged_damage' : 'melee_damage';
        for (const mod of magicItem.modifiers) {
          if (mod.type === 'flat_bonus' && typeof mod.value === 'number') {
            if (mod.target === atkTarget) {
              magicAttackBonus += mod.value;
            } else if (mod.target === dmgTarget) {
              magicDamageBonus += mod.value;
            }
          }
        }
      }

      return {
        instance,
        weapon: baseWeapon,
        magicItem,
        displayName: instance.customName ?? magicItem.name,
        isMagical: true,
        magicAttackBonus,
        magicDamageBonus,
      };
    }

    return undefined;
  };

  // SRD-1703: weapon slots resolve through the active weapon set. Armor and
  // shield stay shared across sets; only main/off/ranged vary per set.
  const activeWeaponSlots = getActiveWeaponSlotIds(state.equippedSlots);
  const equippedArmor = resolveArmorSlot(state.equippedSlots.armorInstanceId, false);
  const equippedShield =
    resolveArmorSlot(state.equippedSlots.shieldInstanceId, true) ??
    resolveArmorSlot(activeWeaponSlots.offHandInstanceId, true);
  const mainHandWeapon = resolveWeaponSlot(activeWeaponSlots.mainHandInstanceId);
  const offHandWeapon =
    activeWeaponSlots.offHandInstanceId &&
    activeWeaponSlots.offHandInstanceId !== equippedShield?.instance.instanceId
      ? resolveWeaponSlot(activeWeaponSlots.offHandInstanceId)
      : undefined;
  const rangedWeapon =
    activeWeaponSlots.rangedInstanceId &&
    activeWeaponSlots.rangedInstanceId !== activeWeaponSlots.mainHandInstanceId
      ? resolveWeaponSlot(activeWeaponSlots.rangedInstanceId)
      : undefined;

  return {
    equippedArmor,
    equippedShield,
    mainHandWeapon,
    offHandWeapon,
    rangedWeapon,
  };
}

/**
 * Searches a class entry's `choiceSelectionsByLevel` for selections matching a feature choice ID
 * (with fallback support for shorthand fighting style keys in unit tests).
 */
function findFeatureChoiceSelections(
  entry: CharacterClassEntry,
  level: number,
  choiceId: string,
  featureGroup?: string,
): readonly string[] {
  const results: string[] = [];
  const addOptions = (opts: readonly string[] | undefined): void => {
    if (!opts) return;
    for (const opt of opts) {
      if (!results.includes(opt)) {
        results.push(opt);
      }
    }
  };

  const atLevel = entry.choiceSelectionsByLevel[level];
  if (atLevel?.[choiceId]) {
    addOptions(atLevel[choiceId]);
  } else if (featureGroup === 'fighting-style' && atLevel?.['fighting-style']) {
    addOptions(atLevel['fighting-style']);
  }

  for (let lvl = 1; lvl <= entry.level; lvl++) {
    const map = entry.choiceSelectionsByLevel[lvl];
    if (!map) continue;
    if (map[choiceId]) {
      addOptions(map[choiceId]);
    } else if (
      results.length === 0 &&
      featureGroup === 'fighting-style' &&
      map['fighting-style']
    ) {
      addOptions(map['fighting-style']);
    }
  }

  return results;
}

/**
 * Customizes Dragonborn Breath Weapon damage dice (`2d6` L1, `3d6` L6, `4d6` L11, `5d6` L16)
 * and Draconic Ancestry damage type, save ability, and AOE template.
 */
function customizeDragonbornBreathWeapon(
  ability: ActivatedAbilitySpec,
  ancestry: DraconicAncestryEntry,
  totalLevel: number,
): ActivatedAbilitySpec {
  const breathDice =
    totalLevel >= 16 ? '5d6' : totalLevel >= 11 ? '4d6' : totalLevel >= 6 ? '3d6' : '2d6';

  return {
    ...ability,
    name: `Breath Weapon (${ancestry.dragon})`,
    targeting: {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: {
        shape: ancestry.aoeShape,
        sizeFeet: ancestry.sizeFeet,
        ...(ancestry.widthFeet !== undefined ? { widthFeet: ancestry.widthFeet } : {}),
      },
    },
    effects: [
      {
        step: 'saving_throw',
        ability: ancestry.saveAbility,
        dcFormula: '8 + @conMod + @prof',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: breathDice,
            damageType: ancestry.damageType,
            halfOnSaveSuccess: true,
          },
        ],
      },
    ],
  };
}

/**
 * Evaluates whether a passive modifier's `PredicateSpec` is satisfied in the current character state.
 * Situational combat predicates (like `save_against_poison` or `save_against_traps`) return `false`
 * for unconditional static sheet totals while remaining listed in `sheet.activeModifiers`.
 */
function isCharacterStatePredicateSatisfied(
  condition: PredicateSpec | undefined,
  context: {
    wearingArmor: boolean;
    wearingHeavyArmor: boolean;
    wieldingShield: boolean;
    sourceId?: string;
  },
): boolean {
  if (!condition) {
    return true;
  }
  if (typeof condition !== 'string') {
    return false;
  }

  switch (condition) {
    case 'wearing_armor':
      return context.wearingArmor;
    case 'wearing_no_armor':
      // Monk Unarmored Movement and Bracers of Defense require no armor AND no shield per SRD 5.1
      if (
        context.sourceId === 'unarmored-movement' ||
        context.sourceId === 'bracers-of-defense'
      ) {
        return !context.wearingArmor && !context.wieldingShield;
      }
      return !context.wearingArmor;
    case 'wearing_heavy_armor':
      return context.wearingHeavyArmor;
    case 'not_wearing_heavy_armor':
      return !context.wearingHeavyArmor;
    case 'wielding_shield':
      return context.wieldingShield;
    default:
      // Situational combat/save predicates or weapon-specific predicates handled in Stage 8
      return false;
  }
}

/**
 * Parses the maximum die faces from a dice formula like `"1d4"` -> `4`, `"1d8"` -> `8`, `"1"` -> `1`.
 */
function parseDieFaces(diceFormula: string): number {
  const match = /^(\d+)d(\d+)$/i.exec(diceFormula.trim());
  if (!match) {
    return Number(diceFormula) || 1;
  }
  return Number(match[2]);
}

/**
 * Checks whether a weapon qualifies as a Monk Weapon under SRD 5.1 Martial Arts rules:
 * *"shortswords and any simple melee weapons that don't have the two-handed or heavy property."*
 */
export function isMonkWeapon(weapon: WeaponData): boolean {
  if (weapon.id === 'shortsword') {
    return true;
  }
  return (
    weapon.category === 'simple' &&
    weapon.rangeType === 'melee' &&
    !weapon.properties.includes('two-handed') &&
    !weapon.properties.includes('heavy')
  );
}

// ============================================================================
// 3. Main 10-Stage `computeDerivedCharacter()` Pipeline
// ============================================================================

/**
 * Deterministic 10-stage character calculation pipeline that projects a `CharacterBuildState`
 * and `CompendiumData` into a complete `DerivedCharacterSheet`.
 */
export function computeDerivedCharacter(
  state: CharacterBuildState,
  compendium: CompendiumData = createCompendium(),
): DerivedCharacterSheet {
  // --------------------------------------------------------------------------
  // STAGE 1: Identity, Total Level & Proficiency Bonus
  // --------------------------------------------------------------------------
  const race = compendium.getRace(state.raceId);
  const subrace =
    state.subraceId && race?.subraceIds.includes(state.subraceId)
      ? compendium.getSubrace(state.subraceId)
      : state.subraceId
        ? compendium.getSubrace(state.subraceId)
        : undefined;
  const background = compendium.getBackground(state.backgroundId);

  const classSummaries: DerivedClassSummary[] = [];
  let rawTotalLevel = 0;

  for (const entry of state.classes) {
    const classData = compendium.getClass(entry.classId);
    const subclassData = entry.subclassId
      ? compendium.getSubclass(entry.subclassId)
      : undefined;
    rawTotalLevel += entry.level;

    classSummaries.push({
      classId: entry.classId,
      className: classData?.name ?? entry.classId,
      ...(entry.subclassId ? { subclassId: entry.subclassId } : {}),
      ...(subclassData ? { subclassName: subclassData.name } : {}),
      level: entry.level,
      hitDie: classData?.hitDie ?? 8,
    });
  }

  const totalLevel = Math.min(20, Math.max(1, rawTotalLevel));
  const proficiencyBonus = computeProficiencyBonus(totalLevel);

  // --------------------------------------------------------------------------
  // PRE-STAGE 2/3: Discover Unlocked Traits, Features, Feats, Choices & Gear
  // --------------------------------------------------------------------------
  const choiceTree = validateCharacterChoices(state, compendium, {
    requireStartingEquipmentChoices: false,
    requireAsiSelections: false,
    requireExpertiseChoices: false,
  });
  const profResolution = resolveProficienciesAndDuplicates(state, compendium, {
    requireExpertiseChoices: false,
  });

  const {
    equippedArmor,
    equippedShield,
    mainHandWeapon,
    offHandWeapon,
    rangedWeapon,
  } = resolveEquippedGear(state, compendium);

  const traitIds: string[] = [];
  const featureIds: string[] = [];
  const featIds: string[] = [];
  const sourcedModifiers: InternalSourcedModifier[] = [];
  const activatedAbilitiesMap = new Map<string, ActivatedAbilitySpec>();

  const addTraitId = (id: string): void => {
    if (!traitIds.includes(id)) traitIds.push(id);
  };
  const addFeatureId = (id: string): void => {
    if (!featureIds.includes(id)) featureIds.push(id);
  };
  const addFeatId = (id: string): void => {
    if (!featIds.includes(id)) featIds.push(id);
  };
  const addActivatedAbility = (ability: ActivatedAbilitySpec): void => {
    if (!activatedAbilitiesMap.has(ability.id)) {
      activatedAbilitiesMap.set(ability.id, ability);
    }
  };

  // Add Background Feature if present
  if (background?.feature) {
    addFeatureId(background.feature.id);
  } else if (state.customBackground?.feature) {
    addFeatureId(
      state.customBackground.feature.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    );
  }

  // Resolve Dragonborn Draconic Ancestry if applicable
  const selectedDraconicAncestryKey =
    state.racialChoices['draconic-ancestry']?.[0]?.toLowerCase();
  const draconicAncestry: DraconicAncestryEntry | undefined =
    selectedDraconicAncestryKey ? DRACONIC_ANCESTRY_TABLE[selectedDraconicAncestryKey] : undefined;

  // 1. Racial & Subracial Traits
  if (race) {
    for (const trait of race.traits) {
      addTraitId(trait.id);

      for (const mod of trait.modifiers) {
        if (
          trait.id === 'draconic-damage-resistance' &&
          mod.type === 'damage_mitigation' &&
          draconicAncestry
        ) {
          sourcedModifiers.push({
            sourceId: trait.id,
            sourceName: `${trait.name} (${draconicAncestry.dragon})`,
            sourceCategory: 'race',
            modifier: {
              ...mod,
              damageTypes: [draconicAncestry.damageType],
            },
          });
        } else {
          sourcedModifiers.push({
            sourceId: trait.id,
            sourceName: trait.name,
            sourceCategory: 'race',
            modifier: mod,
          });
        }
      }

      for (const act of trait.activatedAbilities ?? []) {
        if (act.id === 'dragonborn-breath-weapon') {
          const effectiveAncestry = draconicAncestry ?? DRACONIC_ANCESTRY_TABLE['red']!;
          addActivatedAbility(
            customizeDragonbornBreathWeapon(act, effectiveAncestry, totalLevel),
          );
        } else {
          addActivatedAbility(act);
        }
      }
    }
  }

  if (subrace) {
    for (const trait of subrace.traits) {
      addTraitId(trait.id);
      for (const mod of trait.modifiers) {
        sourcedModifiers.push({
          sourceId: trait.id,
          sourceName: trait.name,
          sourceCategory: 'subrace',
          modifier: mod,
        });
      }
      for (const act of trait.activatedAbilities ?? []) {
        addActivatedAbility(act);
      }
    }
  }

  // 2. Class & Subclass Features + Chosen Feature Options + Feats
  const collectedFeatureModifierIds = new Set<string>();
  const collectFeatureAndOptions = (
    feature: FeatureData,
    entry: CharacterClassEntry,
    unlockLevel: number,
    category: 'class_feature' | 'subclass_feature',
  ): void => {
    addFeatureId(feature.id);
    if (!collectedFeatureModifierIds.has(feature.id)) {
      collectedFeatureModifierIds.add(feature.id);
      for (const mod of feature.modifiers) {
        sourcedModifiers.push({
          sourceId: feature.id,
          sourceName: feature.name,
          sourceCategory: category,
          classId: entry.classId,
          classLevel: entry.level,
          modifier: mod,
        });
      }
      for (const act of feature.activatedAbilities ?? []) {
        addActivatedAbility(act);
      }
    }

    for (const choice of feature.choices ?? []) {
      if (choice.type !== 'feature_option') continue;
      const pickedOptions = findFeatureChoiceSelections(
        entry,
        unlockLevel,
        choice.id,
        choice.featureGroup,
      );
      for (const rawOpt of pickedOptions) {
        const normOpt = normalizeFeatureOptionId(rawOpt, choice);
        const optionFeature =
          compendium.getFeature(normOpt) ??
          compendium.getFeature(`${choice.featureGroup}-${rawOpt.trim()}`);
        if (optionFeature) {
          addFeatureId(optionFeature.id);
          if (!collectedFeatureModifierIds.has(optionFeature.id)) {
            collectedFeatureModifierIds.add(optionFeature.id);
            for (const mod of optionFeature.modifiers) {
              sourcedModifiers.push({
                sourceId: optionFeature.id,
                sourceName: optionFeature.name,
                sourceCategory: category,
                classId: entry.classId,
                classLevel: entry.level,
                modifier: mod,
              });
            }
            for (const act of optionFeature.activatedAbilities ?? []) {
              addActivatedAbility(act);
            }
          }
        } else if (choice.options.includes(normOpt)) {
          addFeatureId(normOpt);
        }
      }
    }
  };

  for (const entry of state.classes) {
    const classData = compendium.getClass(entry.classId);
    if (!classData) continue;

    const subclassData: SubclassData | undefined =
      entry.subclassId && entry.level >= classData.subclassLevel
        ? compendium.getSubclass(entry.subclassId)
        : undefined;

    for (let lvl = 1; lvl <= entry.level; lvl++) {
      const lvlProg = classData.levels[lvl - 1];
      if (lvlProg) {
        for (const featureId of lvlProg.featureIds) {
          if (featureId.startsWith('asi-')) continue;
          const feature = compendium.getFeature(featureId);
          if (feature) {
            collectFeatureAndOptions(feature, entry, lvl, 'class_feature');
          } else {
            addFeatureId(featureId);
          }
        }
      }

      if (subclassData && subclassData.classId === classData.id) {
        const subLvlProg = subclassData.levels.find((l) => l.level === lvl);
        for (const featureId of subLvlProg?.featureIds ?? []) {
          const feature = compendium.getFeature(featureId);
          if (feature) {
            collectFeatureAndOptions(feature, entry, lvl, 'subclass_feature');
          } else {
            addFeatureId(featureId);
          }
        }
      }

      const asiOrFeat = entry.asiOrFeatByLevel[lvl];
      if (asiOrFeat?.type === 'feat') {
        addFeatId(asiOrFeat.featId);
        const feat =
          state.customFeats?.find((f) => f.id === asiOrFeat.featId) ??
          compendium.getFeat(asiOrFeat.featId);
        if (feat) {
          for (const mod of feat.modifiers) {
            sourcedModifiers.push({
              sourceId: feat.id,
              sourceName: feat.name,
              sourceCategory: 'feat',
              classId: entry.classId,
              classLevel: entry.level,
              modifier: mod,
            });
          }
          for (const act of feat.activatedAbilities ?? []) {
            addActivatedAbility(act);
          }
        }
      }
    }
  }

  // 3. Inventory Gear, Equipped Magic Armor/Shield/Weapons, and Attuned Magic Items
  const attunedSet = new Set(state.attunedItemInstanceIds);
  const equippedWeaponInstanceIds = new Set<string>(
    [
      mainHandWeapon?.instance.instanceId,
      offHandWeapon?.instance.instanceId,
      rangedWeapon?.instance.instanceId,
    ].filter((id): id is string => id !== undefined),
  );

  for (const invItem of state.inventory) {
    if (invItem.identified === false) continue;

    const gearItem = compendium.getGear(invItem.itemId);
    if (gearItem) {
      for (const mod of gearItem.modifiers ?? []) {
        sourcedModifiers.push({
          sourceId: gearItem.id,
          sourceName: invItem.customName ?? gearItem.name,
          sourceCategory: 'equipment',
          itemInstanceId: invItem.instanceId,
          modifier: mod,
        });
      }
      for (const act of gearItem.activatedAbilities ?? []) {
        addActivatedAbility(act);
      }
      continue;
    }

    const magicItem = compendium.getMagicItem(invItem.itemId);
    if (!magicItem) continue;

    // Check attunement requirement
    if (magicItem.requiresAttunement && !attunedSet.has(invItem.instanceId)) {
      continue;
    }

    // Armor/Shield magic items only apply their passive modifiers when equipped in the corresponding slot
    if (magicItem.category === 'armor') {
      const isEquippedArmor = equippedArmor?.instance.instanceId === invItem.instanceId;
      const isEquippedShield = equippedShield?.instance.instanceId === invItem.instanceId;
      if (!isEquippedArmor && !isEquippedShield) {
        continue;
      }
    }

    // Weapon magic items only apply when equipped in a weapon slot
    const isWeaponItem = magicItem.category === 'weapon';
    if (isWeaponItem && !equippedWeaponInstanceIds.has(invItem.instanceId)) {
      continue;
    }

    for (const mod of magicItem.modifiers) {
      const isWeaponAttackOrDamageMod =
        isWeaponItem &&
        mod.type === 'flat_bonus' &&
        (mod.target === 'melee_attack' ||
          mod.target === 'ranged_attack' ||
          mod.target === 'melee_damage' ||
          mod.target === 'ranged_damage');

      sourcedModifiers.push({
        sourceId: magicItem.id,
        sourceName: invItem.customName ?? magicItem.name,
        sourceCategory: 'magic_item',
        itemInstanceId: invItem.instanceId,
        isWeaponSpecific: isWeaponAttackOrDamageMod,
        modifier: mod,
      });
    }

    for (const act of magicItem.activatedAbilities ?? []) {
      addActivatedAbility(act);
    }
  }

  // 4. Runtime Active Effects (`state.runtime.activeEffects`)
  for (const activeEff of state.runtime.activeEffects) {
    for (const mod of activeEff.modifiers) {
      sourcedModifiers.push({
        sourceId: activeEff.effectId,
        sourceName: activeEff.name,
        sourceCategory: 'active_effect',
        modifier: mod,
      });
    }
  }

  // --------------------------------------------------------------------------
  // STAGE 2: Final Ability Scores & Modifiers
  // --------------------------------------------------------------------------
  const derivedAbilities = {} as Record<AbilityId, DerivedAbilityScore>;

  // Extract racial choice ability bonuses (even if other unrelated steps have validation errors)
  const racialChoiceAbilityBonuses: Record<AbilityId, { bonus: number; label: string }[]> = {
    str: [],
    dex: [],
    con: [],
    int: [],
    wis: [],
    cha: [],
  };
  if (race) {
    for (const choice of race.choices) {
      if (choice.type === 'ability_score_bonus') {
        const picked = state.racialChoices[choice.id] ?? [];
        const seen = new Set<string>();
        const excluded = new Set(choice.excludeAbilities ?? []);
        for (const ab of picked) {
          if (
            ABILITY_ID_SET.has(ab) &&
            !excluded.has(ab as AbilityId) &&
            (!choice.distinct || !seen.has(ab))
          ) {
            seen.add(ab);
            racialChoiceAbilityBonuses[ab as AbilityId].push({
              bonus: choice.bonus,
              label: `${race.name} Ability Choice`,
            });
          }
        }
      }
    }
  }

  for (const ability of ABILITY_IDS) {
    const base = state.baseAbilities[ability];
    const breakdown: ModifierContribution[] = [
      { sourceId: 'base', sourceName: 'Base Score', value: base },
    ];

    let racialBonus = 0;
    const raceFixed = race?.abilityBonuses[ability] ?? 0;
    if (raceFixed !== 0 && race) {
      racialBonus += raceFixed;
      breakdown.push({ sourceId: race.id, sourceName: race.name, value: raceFixed });
    }
    const subraceFixed = subrace?.abilityBonuses[ability] ?? 0;
    if (subraceFixed !== 0 && subrace) {
      racialBonus += subraceFixed;
      breakdown.push({
        sourceId: subrace.id,
        sourceName: subrace.name,
        value: subraceFixed,
      });
    }
    for (const rcBonus of racialChoiceAbilityBonuses[ability]) {
      racialBonus += rcBonus.bonus;
      breakdown.push({
        sourceId: `${state.raceId}-ability-choice`,
        sourceName: rcBonus.label,
        value: rcBonus.bonus,
      });
    }

    let asiBonus = 0;
    let featBonus = 0;
    for (const entry of state.classes) {
      const classData = compendium.getClass(entry.classId);
      for (const [lvlKey, sel] of Object.entries(entry.asiOrFeatByLevel)) {
        const lvl = Number(lvlKey);
        if (lvl > entry.level) continue;
        if (sel.type === 'asi') {
          const val = sel.bonuses[ability] ?? 0;
          if (val !== 0) {
            asiBonus += val;
            breakdown.push({
              sourceId: `asi-${entry.classId}-${lvl}`,
              sourceName: `${classData?.name ?? entry.classId} L${lvl} ASI`,
              value: val,
            });
          }
        } else {
          const feat =
            state.customFeats?.find((f) => f.id === sel.featId) ??
            compendium.getFeat(sel.featId);
          const fVal = feat?.abilityBonuses?.[ability] ?? 0;
          if (fVal !== 0 && feat) {
            featBonus += fVal;
            breakdown.push({
              sourceId: feat.id,
              sourceName: feat.name,
              value: fVal,
            });
          }
          for (const choice of feat?.choices ?? []) {
            if (choice.type === 'ability_score_bonus') {
              const picked = sel.choices?.[choice.id] ?? [];
              if (picked.includes(ability)) {
                featBonus += choice.bonus;
                breakdown.push({
                  sourceId: feat!.id,
                  sourceName: `${feat!.name} (${choice.label})`,
                  value: choice.bonus,
                });
              }
            }
          }
        }
      }
    }

    // Check passive `ability_score` modifiers (e.g., Barbarian L20 Primal Champion: +4 STR, +4 CON, maxCap 24)
    let maxCap = 20;
    for (const sm of sourcedModifiers) {
      if (sm.modifier.type === 'ability_score' && sm.modifier.ability === ability) {
        if (sm.modifier.maxCap !== undefined && sm.modifier.maxCap > maxCap) {
          maxCap = sm.modifier.maxCap;
        }
        if (sm.modifier.bonus !== 0) {
          if (sm.sourceCategory === 'feat') {
            featBonus += sm.modifier.bonus;
          } else {
            asiBonus += sm.modifier.bonus;
          }
          breakdown.push({
            sourceId: sm.sourceId,
            sourceName: sm.sourceName,
            value: sm.modifier.bonus,
          });
        }
      }
    }

    const uncappedScore = base + racialBonus + asiBonus + featBonus;
    const cappedScore = Math.min(maxCap, Math.max(1, uncappedScore));

    // Check `set_ability_minimum` modifiers (e.g., Gauntlets of Ogre Power -> 19, Belt of Hill Giant Strength -> 21)
    let itemMinimum: number | undefined;
    let itemMinimumSource: { sourceId: string; sourceName: string } | undefined;
    for (const sm of sourcedModifiers) {
      if (sm.modifier.type === 'set_ability_minimum' && sm.modifier.ability === ability) {
        if (itemMinimum === undefined || sm.modifier.minimum > itemMinimum) {
          itemMinimum = sm.modifier.minimum;
          itemMinimumSource = { sourceId: sm.sourceId, sourceName: sm.sourceName };
        }
      }
    }

    let finalScore = cappedScore;
    if (itemMinimum !== undefined && itemMinimum > cappedScore && itemMinimumSource) {
      finalScore = itemMinimum;
      breakdown.push({
        sourceId: itemMinimumSource.sourceId,
        sourceName: `${itemMinimumSource.sourceName} (Min ${itemMinimum})`,
        value: itemMinimum - cappedScore,
      });
    }

    const modifier = computeAbilityModifier(finalScore);

    derivedAbilities[ability] = {
      ability,
      base,
      racialBonus,
      asiBonus,
      featBonus,
      ...(itemMinimum !== undefined ? { itemMinimum } : {}),
      maxCap,
      score: finalScore,
      modifier,
      breakdown,
    };
  }

  const abilities: DerivedAbilitiesMap = derivedAbilities;

  // Base formula evaluation context after Stage 2
  const primaryClassLevel = state.classes[0]?.level ?? totalLevel;
  const baseFormulaContext: FormulaContext = {
    '@strMod': abilities.str.modifier,
    '@dexMod': abilities.dex.modifier,
    '@conMod': abilities.con.modifier,
    '@intMod': abilities.int.modifier,
    '@wisMod': abilities.wis.modifier,
    '@chaMod': abilities.cha.modifier,
    '@prof': proficiencyBonus,
    '@charLevel': totalLevel,
    '@classLevel': primaryClassLevel,
  };

  const getModifierFormulaContext = (sm: InternalSourcedModifier): FormulaContext => {
    if (sm.classLevel !== undefined) {
      return {
        ...baseFormulaContext,
        '@classLevel': sm.classLevel,
      };
    }
    return baseFormulaContext;
  };

  // --------------------------------------------------------------------------
  // STAGE 3: Active Modifiers, Proficiencies & Mitigations
  // --------------------------------------------------------------------------
  const wearingArmor = equippedArmor !== undefined;
  const wearingHeavyArmor = equippedArmor?.armor.category === 'heavy';
  const wieldingShield = equippedShield !== undefined;

  const activeModifiers: SourcedModifier[] = sourcedModifiers.map((sm) => ({
    sourceId: sm.sourceId,
    sourceName: sm.sourceName,
    sourceCategory: sm.sourceCategory,
    modifier: sm.modifier,
  }));

  // Consolidate proficiencies (plus high-level class features like Monk Diamond Soul & Rogue Slippery Mind)
  const savingThrowSet = new Set<AbilityId>(profResolution.resolvedProficiencies.savingThrows);
  if (featureIds.includes('diamond-soul')) {
    for (const ab of ABILITY_IDS) {
      savingThrowSet.add(ab);
    }
  }
  if (featureIds.includes('slippery-mind')) {
    savingThrowSet.add('wis');
  }

  // Also check if a class skill choice was stored under shorthand key 'skills'
  const skillSet = new Set<SkillId>(profResolution.resolvedProficiencies.skills);
  for (const entry of state.classes) {
    const shorthandSkills = entry.choiceSelectionsByLevel[1]?.['skills'] ?? [];
    for (const sk of shorthandSkills) {
      if (SKILL_ID_SET.has(sk)) {
        skillSet.add(sk as SkillId);
      }
    }
  }

  const proficiencies: DerivedProficiencies = {
    armor: profResolution.resolvedProficiencies.armor,
    weapons: profResolution.resolvedProficiencies.weapons,
    tools: profResolution.resolvedProficiencies.tools,
    savingThrows: ABILITY_IDS.filter((ab) => savingThrowSet.has(ab)),
    skills: SKILL_IDS.filter((sk) => skillSet.has(sk)),
    expertise: profResolution.resolvedProficiencies.expertise,
    languages: profResolution.resolvedProficiencies.languages,
  };

  const resistanceSet = new Set<DamageType>();
  const immunitySet = new Set<DamageType>();
  const vulnerabilitySet = new Set<DamageType>();
  const conditionImmunitySet = new Set<ConditionId>();

  for (const sm of sourcedModifiers) {
    if (sm.modifier.type === 'damage_mitigation') {
      const targetSet =
        sm.modifier.mitigation === 'resistance'
          ? resistanceSet
          : sm.modifier.mitigation === 'immunity'
            ? immunitySet
            : vulnerabilitySet;
      for (const dt of sm.modifier.damageTypes) {
        targetSet.add(dt);
      }
    } else if (sm.modifier.type === 'condition_immunity') {
      for (const cond of sm.modifier.conditions) {
        conditionImmunitySet.add(cond);
      }
    }
  }

  const damageResistances = [...resistanceSet];
  const damageImmunities = [...immunitySet];
  const damageVulnerabilities = [...vulnerabilitySet];
  const conditionImmunities = [...conditionImmunitySet];

  // Active condition set & exhaustion
  const activeConditionIds = new Set<ConditionId>(
    state.runtime.activeConditions.map((c) => c.conditionId),
  );
  const exhaustionLevel = state.runtime.exhaustionLevel;

  // --------------------------------------------------------------------------
  // STAGE 4: Saving Throws, Skills & Passive Scores
  // --------------------------------------------------------------------------
  const derivedSavingThrows = {} as Record<AbilityId, DerivedSavingThrow>;

  for (const ability of ABILITY_IDS) {
    const proficient = proficiencies.savingThrows.includes(ability);
    const abilityModifier = abilities[ability].modifier;
    const saveProfBonus = proficient ? proficiencyBonus : 0;
    const saveTarget = `save:${ability}` as const;

    const breakdown: ModifierContribution[] = [
      {
        sourceId: ability,
        sourceName: ABILITY_NAMES[ability],
        value: abilityModifier,
      },
    ];
    if (proficient) {
      breakdown.push({
        sourceId: 'prof',
        sourceName: 'Proficiency Bonus',
        value: saveProfBonus,
      });
    }

    let flatBonus = 0;
    let advCount = 0;
    let disadvCount = 0;

    for (const sm of sourcedModifiers) {
      const { modifier } = sm;
      if (
        modifier.type === 'flat_bonus' &&
        (modifier.target === 'all_saving_throws' || modifier.target === saveTarget)
      ) {
        if (
          !isCharacterStatePredicateSatisfied(modifier.condition, {
            wearingArmor,
            wearingHeavyArmor,
            wieldingShield,
            sourceId: sm.sourceId,
          })
        ) {
          continue;
        }
        const val = evaluateFlatModifierValue(
          modifier.value,
          getModifierFormulaContext(sm),
        );
        if (val !== null && val !== 0) {
          flatBonus += val;
          breakdown.push({
            sourceId: sm.sourceId,
            sourceName: sm.sourceName,
            value: val,
          });
        }
      } else if (
        modifier.type === 'roll_mode' &&
        (modifier.target === 'all_saving_throws' || modifier.target === saveTarget)
      ) {
        if (
          !isCharacterStatePredicateSatisfied(modifier.condition, {
            wearingArmor,
            wearingHeavyArmor,
            wieldingShield,
            sourceId: sm.sourceId,
          })
        ) {
          continue;
        }
        if (modifier.mode === 'advantage') advCount++;
        else disadvCount++;
      }
    }

    if (exhaustionLevel >= 3) {
      disadvCount++;
    }
    if (ability === 'dex' && activeConditionIds.has('restrained')) {
      disadvCount++;
    }

    const rollMode = resolveRollMode({
      advantageCount: advCount,
      disadvantageCount: disadvCount,
    });

    derivedSavingThrows[ability] = {
      ability,
      proficient,
      abilityModifier,
      proficiencyBonus: saveProfBonus,
      flatBonus,
      totalBonus: abilityModifier + saveProfBonus + flatBonus,
      rollMode,
      breakdown,
    };
  }

  const savingThrows: DerivedSavingThrowsMap = derivedSavingThrows;

  const hasJackOfAllTrades = featureIds.includes('jack-of-all-trades');
  const hasRemarkableAthlete = featureIds.includes('remarkable-athlete');
  const derivedSkills = {} as Record<SkillId, DerivedSkill>;

  for (const skill of SKILL_IDS) {
    const ability = SKILL_DEFAULT_ABILITY[skill];
    const abilityModifier = abilities[ability].modifier;
    const skillTarget = `skill:${skill}` as const;

    let proficiencyLevel: SkillProficiencyLevel = 'none';
    let skillProfBonus = 0;

    if (proficiencies.expertise.includes(skill)) {
      proficiencyLevel = 'expertise';
      skillProfBonus = proficiencyBonus * 2;
    } else if (proficiencies.skills.includes(skill)) {
      proficiencyLevel = 'proficient';
      skillProfBonus = proficiencyBonus;
    } else if (hasJackOfAllTrades) {
      proficiencyLevel = 'half';
      skillProfBonus = Math.floor(proficiencyBonus / 2);
    }

    const breakdown: ModifierContribution[] = [
      {
        sourceId: ability,
        sourceName: ABILITY_NAMES[ability],
        value: abilityModifier,
      },
    ];

    if (skillProfBonus > 0) {
      breakdown.push({
        sourceId:
          proficiencyLevel === 'expertise'
            ? 'expertise'
            : proficiencyLevel === 'half'
              ? 'jack-of-all-trades'
              : 'prof',
        sourceName:
          proficiencyLevel === 'expertise'
            ? 'Expertise (2x Proficiency)'
            : proficiencyLevel === 'half'
              ? 'Jack of All Trades'
              : 'Proficiency Bonus',
        value: skillProfBonus,
      });
    }

    let flatBonus = 0;
    if (
      proficiencyLevel === 'none' &&
      hasRemarkableAthlete &&
      (ability === 'str' || ability === 'dex' || ability === 'con')
    ) {
      const raBonus = Math.ceil(proficiencyBonus / 2);
      flatBonus += raBonus;
      breakdown.push({
        sourceId: 'remarkable-athlete',
        sourceName: 'Remarkable Athlete',
        value: raBonus,
      });
    }

    let advCount = 0;
    let disadvCount = 0;

    for (const sm of sourcedModifiers) {
      const { modifier } = sm;
      if (modifier.type === 'flat_bonus' && modifier.target === skillTarget) {
        if (
          !isCharacterStatePredicateSatisfied(modifier.condition, {
            wearingArmor,
            wearingHeavyArmor,
            wieldingShield,
            sourceId: sm.sourceId,
          })
        ) {
          continue;
        }
        const val = evaluateFlatModifierValue(
          modifier.value,
          getModifierFormulaContext(sm),
        );
        if (val !== null && val !== 0) {
          flatBonus += val;
          breakdown.push({
            sourceId: sm.sourceId,
            sourceName: sm.sourceName,
            value: val,
          });
        }
      } else if (
        modifier.type === 'roll_mode' &&
        (modifier.target === 'all_ability_checks' || modifier.target === skillTarget)
      ) {
        if (
          !isCharacterStatePredicateSatisfied(modifier.condition, {
            wearingArmor,
            wearingHeavyArmor,
            wieldingShield,
            sourceId: sm.sourceId,
          })
        ) {
          continue;
        }
        if (modifier.mode === 'advantage') advCount++;
        else disadvCount++;
      }
    }

    if (skill === 'stealth' && equippedArmor?.armor.stealthDisadvantage) {
      disadvCount++;
    }
    if (exhaustionLevel >= 1 || activeConditionIds.has('poisoned')) {
      disadvCount++;
    }

    const rollMode = resolveRollMode({
      advantageCount: advCount,
      disadvantageCount: disadvCount,
    });

    const totalBonus = abilityModifier + skillProfBonus + flatBonus;
    const passiveAdjustment =
      rollMode === 'advantage' ? 5 : rollMode === 'disadvantage' ? -5 : 0;
    const passiveScore = 10 + totalBonus + passiveAdjustment;

    derivedSkills[skill] = {
      skill,
      ability,
      proficiencyLevel,
      abilityModifier,
      proficiencyBonus: skillProfBonus,
      flatBonus,
      totalBonus,
      passiveScore,
      rollMode,
      breakdown,
    };
  }

  const skills: DerivedSkillsMap = derivedSkills;
  const passivePerception = skills.perception.passiveScore;
  const passiveInvestigation = skills.investigation.passiveScore;
  const passiveInsight = skills.insight.passiveScore;

  // --------------------------------------------------------------------------
  // STAGE 5: Maximum Hit Points & Hit Dice Pool
  // --------------------------------------------------------------------------
  const hpBreakdown: ModifierContribution[] = [];
  const conMod = abilities.con.modifier;
  let totalBaseHpFromRolls = 0;
  let totalHpBeforePerLevelMods = 0;

  const hitDiceTotalsBySize = new Map<6 | 8 | 10 | 12, number>();

  for (let classIdx = 0; classIdx < state.classes.length; classIdx++) {
    const entry = state.classes[classIdx]!;
    const classData = compendium.getClass(entry.classId);
    const hitDie: 6 | 8 | 10 | 12 = classData?.hitDie ?? 8;
    const fixedAverage = hitDie / 2 + 1;

    hitDiceTotalsBySize.set(hitDie, (hitDiceTotalsBySize.get(hitDie) ?? 0) + entry.level);

    let classRollSum = 0;
    for (let lvlIdx = 0; lvlIdx < entry.level; lvlIdx++) {
      const isCharacterFirstLevel = classIdx === 0 && lvlIdx === 0;
      const defaultRoll = isCharacterFirstLevel ? hitDie : fixedAverage;
      const roll = entry.hpRollsByLevel[lvlIdx] ?? defaultRoll;
      classRollSum += roll;

      const levelHp = isCharacterFirstLevel
        ? roll + conMod
        : Math.max(1, roll + conMod);
      totalHpBeforePerLevelMods += levelHp;
    }

    totalBaseHpFromRolls += classRollSum;
    hpBreakdown.push({
      sourceId: `${entry.classId}-hd`,
      sourceName: `${classData?.name ?? entry.classId} Hit Dice (${entry.level}d${hitDie})`,
      value: classRollSum,
    });
  }

  const totalConHpContribution = totalHpBeforePerLevelMods - totalBaseHpFromRolls;
  if (totalConHpContribution !== 0) {
    hpBreakdown.push({
      sourceId: 'con-mod',
      sourceName: `Constitution Modifier (${conMod >= 0 ? `+${conMod}` : conMod} x ${totalLevel})`,
      value: totalConHpContribution,
    });
  }

  let perLevelModHpTotal = 0;
  for (const sm of sourcedModifiers) {
    if (sm.modifier.type === 'flat_bonus' && sm.modifier.target === 'hp_per_level') {
      const valPerLevel = evaluateFlatModifierValue(
        sm.modifier.value,
        getModifierFormulaContext(sm),
      );
      if (valPerLevel !== null && valPerLevel !== 0) {
        // Class/subclass features (e.g. Sorcerer Draconic Resilience) scale by that class's level;
        // racial traits/feats (e.g. Hill Dwarf Dwarven Toughness) scale by total character level.
        const applicableLevels =
          (sm.sourceCategory === 'class_feature' || sm.sourceCategory === 'subclass_feature') &&
          sm.classLevel !== undefined
            ? sm.classLevel
            : totalLevel;
        const modTotal = valPerLevel * applicableLevels;
        perLevelModHpTotal += modTotal;
        hpBreakdown.push({
          sourceId: sm.sourceId,
          sourceName: `${sm.sourceName} (+${valPerLevel} x ${applicableLevels})`,
          value: modTotal,
        });
      }
    }
  }

  let maxHp = Math.max(1, totalHpBeforePerLevelMods + perLevelModHpTotal);
  if (exhaustionLevel >= 4) {
    maxHp = Math.max(1, Math.floor(maxHp / 2));
  }
  const currentHp = Math.min(maxHp, Math.max(0, state.runtime.currentHp));
  const tempHp = state.runtime.tempHp;

  const hitDicePools: HitDiePoolEntry[] = [];
  for (const [dieSize, total] of hitDiceTotalsBySize.entries()) {
    const rawSpent = state.runtime.hitDiceSpent[dieSize] ?? 0;
    const spent = Math.min(total, Math.max(0, rawSpent));
    hitDicePools.push({
      dieSize,
      total,
      spent,
      available: total - spent,
    });
  }

  // --------------------------------------------------------------------------
  // STAGE 6: Armor Class (AC) Competing Formula Resolution
  // --------------------------------------------------------------------------
  const candidateFormulas: AcFormulaCandidate[] = [];

  // 1. Default Unarmored candidate: 10 + @dexMod
  candidateFormulas.push({
    id: 'unarmored',
    name: 'Unarmored',
    formula: '10 + @dexMod',
    baseAc: 10 + abilities.dex.modifier,
    allowsShield: true,
    valid: !wearingArmor,
    ...(wearingArmor ? { invalidReason: 'Wearing armor' } : {}),
  });

  // 2. Declarative `ac_calculation` candidates (Barbarian/Monk Unarmored Defense, Draconic Resilience, Mage Armor)
  let minimumAcOverride: number | undefined;

  for (const sm of sourcedModifiers) {
    if (sm.modifier.type !== 'ac_calculation') continue;
    const acMod = sm.modifier;

    if (acMod.id === 'barkskin') {
      const barkskinVal = evaluateFlatModifierValue(
        acMod.formula,
        getModifierFormulaContext(sm),
      );
      if (barkskinVal !== null) {
        minimumAcOverride = Math.max(minimumAcOverride ?? 0, barkskinVal);
      }
      continue;
    }

    const baseAcVal =
      evaluateFlatModifierValue(acMod.formula, getModifierFormulaContext(sm)) ??
      10 + abilities.dex.modifier;

    let valid = true;
    let invalidReason: string | undefined;
    if (acMod.requiresNoArmor && wearingArmor) {
      valid = false;
      invalidReason = 'Wearing armor';
    } else if (!acMod.allowsShield && wieldingShield) {
      valid = false;
      invalidReason = 'Wielding a shield';
    }

    candidateFormulas.push({
      id: acMod.id,
      name: sm.sourceName,
      formula: acMod.formula,
      baseAc: baseAcVal,
      allowsShield: acMod.allowsShield,
      valid,
      ...(invalidReason ? { invalidReason } : {}),
    });
  }

  // Check if Barkskin is active by effectId/sourceId even without an ac_calculation modifier
  for (const eff of state.runtime.activeEffects) {
    if (
      eff.effectId === 'barkskin' ||
      eff.sourceId === 'barkskin' ||
      eff.name.toLowerCase().includes('barkskin')
    ) {
      minimumAcOverride = Math.max(minimumAcOverride ?? 0, 16);
    }
  }

  // 3. Equipped Armor candidate (Light, Medium, Heavy)
  if (equippedArmor) {
    const { armor } = equippedArmor;
    let armorFormula: string;
    let armorBaseAc: number;

    if (armor.addDexModifier) {
      if (armor.maxDexBonus !== undefined) {
        armorFormula = `${armor.baseAc} + min(${armor.maxDexBonus}, @dexMod)`;
        armorBaseAc = armor.baseAc + Math.min(armor.maxDexBonus, abilities.dex.modifier);
      } else {
        armorFormula = `${armor.baseAc} + @dexMod`;
        armorBaseAc = armor.baseAc + abilities.dex.modifier;
      }
    } else {
      armorFormula = `${armor.baseAc}`;
      armorBaseAc = armor.baseAc;
    }

    candidateFormulas.push({
      id: `armor:${armor.id}`,
      name: armor.name,
      formula: armorFormula,
      baseAc: armorBaseAc,
      allowsShield: true,
      valid: true,
    });
  }

  // Select the highest valid candidate formula (accounting for whether the candidate allows a shield)
  const validCandidates = candidateFormulas.filter((c) => c.valid);
  let selectedCandidate = validCandidates[0] ?? candidateFormulas[0]!;
  let bestEffectiveAc = -Infinity;

  for (const candidate of validCandidates) {
    const candidateShieldBonus =
      candidate.allowsShield && equippedShield ? equippedShield.armor.baseAc : 0;
    const effectiveAc = candidate.baseAc + candidateShieldBonus;
    if (
      effectiveAc > bestEffectiveAc ||
      (effectiveAc === bestEffectiveAc && selectedCandidate.id === 'unarmored')
    ) {
      bestEffectiveAc = effectiveAc;
      selectedCandidate = candidate;
    }
  }

  const shieldBonus =
    selectedCandidate.allowsShield && equippedShield ? equippedShield.armor.baseAc : 0;

  // Collect additive AC bonuses that stack on top of the winning base AC
  const additiveBonuses: ModifierContribution[] = [];
  for (const sm of sourcedModifiers) {
    if (sm.modifier.type !== 'flat_bonus' || sm.modifier.target !== 'ac') continue;
    if (
      !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
        wearingArmor,
        wearingHeavyArmor,
        wieldingShield: wieldingShield && selectedCandidate.allowsShield,
        sourceId: sm.sourceId,
      })
    ) {
      continue;
    }
    const val = evaluateFlatModifierValue(
      sm.modifier.value,
      getModifierFormulaContext(sm),
    );
    if (val !== null && val !== 0) {
      additiveBonuses.push({
        sourceId: sm.sourceId,
        sourceName: sm.sourceName,
        value: val,
      });
    }
  }

  const additiveSum = additiveBonuses.reduce((sum, b) => sum + b.value, 0);
  const rawTotalAc = selectedCandidate.baseAc + shieldBonus + additiveSum;
  const totalAc =
    minimumAcOverride !== undefined
      ? Math.max(rawTotalAc, minimumAcOverride)
      : rawTotalAc;

  const tooltipParts: string[] = [`${selectedCandidate.name} (${selectedCandidate.baseAc})`];
  if (shieldBonus > 0) {
    tooltipParts.push(`Shield (+${shieldBonus})`);
  }
  for (const bonus of additiveBonuses) {
    tooltipParts.push(
      `${bonus.sourceName} (${bonus.value >= 0 ? `+${bonus.value}` : bonus.value})`,
    );
  }
  let formulaTooltip = `${tooltipParts.join(' + ')} = ${totalAc}`;
  if (minimumAcOverride !== undefined && minimumAcOverride > rawTotalAc) {
    formulaTooltip = `${tooltipParts.join(' + ')} (${rawTotalAc}) -> Barkskin Minimum (${minimumAcOverride}) = ${totalAc}`;
  }

  const armorClass: DerivedArmorClass = {
    totalAc,
    selectedFormulaId: selectedCandidate.id,
    selectedFormulaName: selectedCandidate.name,
    baseAc: selectedCandidate.baseAc,
    shieldBonus,
    additiveBonuses,
    ...(minimumAcOverride !== undefined ? { minimumAcOverride } : {}),
    stealthDisadvantage: Boolean(equippedArmor?.armor.stealthDisadvantage),
    candidateFormulas,
    formulaTooltip,
  };

  // --------------------------------------------------------------------------
  // STAGE 7: Speed, Senses & Initiative
  // --------------------------------------------------------------------------
  let speedFeet = race?.speedFeet ?? 30;

  // Heavy armor Strength requirement penalty (-10 ft unless STR >= req or Dwarf)
  if (
    equippedArmor?.armor.strengthRequirement !== undefined &&
    abilities.str.score < equippedArmor.armor.strengthRequirement &&
    state.raceId !== 'dwarf'
  ) {
    speedFeet -= 10;
  }

  // Additive speed bonuses (Fast Movement, Monk Unarmored Movement, Haste, etc.)
  const monkEntry = state.classes.find((c) => c.classId === 'monk');
  const monkClassData = monkEntry ? compendium.getClass('monk') : undefined;
  const monkUnarmoredSpeedScale =
    monkEntry && monkClassData
      ? Number(
          monkClassData.levels[monkEntry.level - 1]?.classSpecific[
            'unarmored_movement_bonus'
          ] ?? 0,
        )
      : 0;

  for (const sm of sourcedModifiers) {
    if (sm.modifier.type !== 'flat_bonus' || sm.modifier.target !== 'speed') continue;
    if (
      !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
        wearingArmor,
        wearingHeavyArmor,
        wieldingShield,
        sourceId: sm.sourceId,
      })
    ) {
      continue;
    }

    if (sm.sourceId === 'unarmored-movement' && monkUnarmoredSpeedScale > 0) {
      speedFeet += monkUnarmoredSpeedScale;
      continue;
    }

    const val = evaluateFlatModifierValue(
      sm.modifier.value,
      getModifierFormulaContext(sm),
    );
    if (val !== null) {
      speedFeet += val;
    }
  }

  const isImmobilizedByCondition =
    activeConditionIds.has('grappled') ||
    activeConditionIds.has('restrained') ||
    activeConditionIds.has('paralyzed') ||
    activeConditionIds.has('petrified') ||
    activeConditionIds.has('stunned') ||
    activeConditionIds.has('unconscious');

  if (exhaustionLevel >= 5 || isImmobilizedByCondition) {
    speedFeet = 0;
  } else if (exhaustionLevel >= 2) {
    speedFeet = Math.floor(Math.max(0, speedFeet) / 2);
  } else {
    speedFeet = Math.max(0, speedFeet);
  }

  // Senses
  let darkvisionFeet = Math.max(
    race?.senses.darkvisionFeet ?? 0,
    subrace?.senses?.darkvisionFeet ?? 0,
  );
  const warlockInvocations =
    choiceTree.selectedFeatureOptionIdsByGroup['eldritch-invocation'] ?? [];
  if (
    warlockInvocations.includes('devils-sight') ||
    warlockInvocations.includes('eldritch-invocation-devils-sight')
  ) {
    darkvisionFeet = Math.max(darkvisionFeet, 120);
  }
  const blindsightFeet = featureIds.includes('blindsense') ? 10 : undefined;

  const senses: DerivedSenses = {
    darkvisionFeet,
    ...(blindsightFeet !== undefined ? { blindsightFeet } : {}),
  };

  // Initiative
  const initiativeBreakdown: ModifierContribution[] = [
    {
      sourceId: 'dex',
      sourceName: 'Dexterity Modifier',
      value: abilities.dex.modifier,
    },
  ];
  let initiativeBonus = abilities.dex.modifier;

  if (hasJackOfAllTrades) {
    const joatBonus = Math.floor(proficiencyBonus / 2);
    if (joatBonus > 0) {
      initiativeBonus += joatBonus;
      initiativeBreakdown.push({
        sourceId: 'jack-of-all-trades',
        sourceName: 'Jack of All Trades',
        value: joatBonus,
      });
    }
  } else if (hasRemarkableAthlete) {
    const raBonus = Math.ceil(proficiencyBonus / 2);
    if (raBonus > 0) {
      initiativeBonus += raBonus;
      initiativeBreakdown.push({
        sourceId: 'remarkable-athlete',
        sourceName: 'Remarkable Athlete',
        value: raBonus,
      });
    }
  }

  let initAdvCount = 0;
  let initDisadvCount = 0;
  for (const sm of sourcedModifiers) {
    const { modifier } = sm;
    if (modifier.type === 'flat_bonus' && modifier.target === 'initiative') {
      if (
        !isCharacterStatePredicateSatisfied(modifier.condition, {
          wearingArmor,
          wearingHeavyArmor,
          wieldingShield,
          sourceId: sm.sourceId,
        })
      ) {
        continue;
      }
      const val = evaluateFlatModifierValue(
        modifier.value,
        getModifierFormulaContext(sm),
      );
      if (val !== null && val !== 0) {
        initiativeBonus += val;
        initiativeBreakdown.push({
          sourceId: sm.sourceId,
          sourceName: sm.sourceName,
          value: val,
        });
      }
    } else if (
      modifier.type === 'roll_mode' &&
      (modifier.target === 'initiative' || modifier.target === 'all_ability_checks')
    ) {
      if (
        !isCharacterStatePredicateSatisfied(modifier.condition, {
          wearingArmor,
          wearingHeavyArmor,
          wieldingShield,
          sourceId: sm.sourceId,
        })
      ) {
        continue;
      }
      if (modifier.mode === 'advantage') initAdvCount++;
      else initDisadvCount++;
    }
  }

  if (exhaustionLevel >= 1 || activeConditionIds.has('poisoned')) {
    initDisadvCount++;
  }

  const initiative: DerivedInitiative = {
    bonus: initiativeBonus,
    rollMode: resolveRollMode({
      advantageCount: initAdvCount,
      disadvantageCount: initDisadvCount,
    }),
    breakdown: initiativeBreakdown,
  };

  // --------------------------------------------------------------------------
  // STAGE 8: Weapon Attack Profiles
  // --------------------------------------------------------------------------
  let critRange = 20;
  for (const sm of sourcedModifiers) {
    if (
      sm.modifier.type === 'die_manipulation' &&
      sm.modifier.rule === 'expanded_crit_range'
    ) {
      const minRoll = sm.modifier.params?.['minCritRoll'];
      if (typeof minRoll === 'number' && minRoll >= 1 && minRoll < critRange) {
        critRange = minRoll;
      }
    }
  }

  const hasMartialArts =
    featureIds.includes('martial-arts') && !wearingArmor && !wieldingShield;
  const monkMartialArtsDie =
    monkEntry && monkClassData
      ? String(
          monkClassData.levels[monkEntry.level - 1]?.classSpecific['martial_arts_die'] ??
            '1d4',
        )
      : '1d4';
  const hasTwoWeaponFightingStyle = featureIds.includes(
    'fighting-style-two-weapon-fighting',
  );

  // Barbarian Rage damage scaling by Barbarian level
  const barbarianEntry = state.classes.find((c) => c.classId === 'barbarian');
  const barbarianClassData = barbarianEntry
    ? compendium.getClass('barbarian')
    : undefined;
  const barbarianRageDamageScale =
    barbarianEntry && barbarianClassData
      ? Number(
          barbarianClassData.levels[barbarianEntry.level - 1]?.classSpecific[
            'rage_damage_bonus'
          ] ?? 2,
        )
      : 2;

  const buildWeaponAttackProfile = (
    resolved: ResolvedEquippedWeapon,
    slot: WeaponSlotType,
  ): DerivedWeaponAttackProfile => {
    const { instance, weapon, displayName, isMagical, magicAttackBonus, magicDamageBonus } =
      resolved;
    const rangeType = weapon.rangeType;
    const isFinesse = weapon.properties.includes('finesse');
    const qualifiesForMartialArts = hasMartialArts && isMonkWeapon(weapon);

    // Determine governing ability (STR vs DEX)
    let abilityUsed: AbilityId;
    if (rangeType === 'melee') {
      if (isFinesse || qualifiesForMartialArts) {
        abilityUsed =
          abilities.dex.modifier > abilities.str.modifier ? 'dex' : 'str';
      } else {
        abilityUsed = 'str';
      }
    } else {
      // Ranged weapon (uses DEX, or max(STR, DEX) if finesse like Dart)
      if (isFinesse) {
        abilityUsed =
          abilities.str.modifier > abilities.dex.modifier ? 'str' : 'dex';
      } else {
        abilityUsed = 'dex';
      }
    }

    const abilityMod = abilities[abilityUsed].modifier;
    const proficient = compendium.isProficientWithEquipment(
      proficiencies.weapons,
      weapon.id,
    );

    // To-Hit Calculation
    const toHitBreakdown: ModifierContribution[] = [
      {
        sourceId: abilityUsed,
        sourceName: ABILITY_NAMES[abilityUsed],
        value: abilityMod,
      },
    ];
    let toHitBonus = abilityMod;

    if (proficient) {
      toHitBonus += proficiencyBonus;
      toHitBreakdown.push({
        sourceId: 'prof',
        sourceName: 'Proficiency',
        value: proficiencyBonus,
      });
    }

    if (magicAttackBonus !== 0) {
      toHitBonus += magicAttackBonus;
      toHitBreakdown.push({
        sourceId: 'magic',
        sourceName: `+${magicAttackBonus} Magic Bonus`,
        value: magicAttackBonus,
      });
    }

    const attackTarget = rangeType === 'ranged' ? 'ranged_attack' : 'melee_attack';
    for (const sm of sourcedModifiers) {
      if (sm.isWeaponSpecific) continue;
      if (sm.modifier.type !== 'flat_bonus' || sm.modifier.target !== attackTarget) {
        continue;
      }

      // Check weapon attack condition (e.g. Archery: 'wielding_ranged_weapon')
      if (sm.modifier.condition === 'wielding_ranged_weapon' && rangeType !== 'ranged') {
        continue;
      } else if (
        sm.modifier.condition &&
        sm.modifier.condition !== 'wielding_ranged_weapon' &&
        !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
          wearingArmor,
          wearingHeavyArmor,
          wieldingShield,
          sourceId: sm.sourceId,
        })
      ) {
        continue;
      }

      const val = evaluateFlatModifierValue(
        sm.modifier.value,
        getModifierFormulaContext(sm),
      );
      if (val !== null && val !== 0) {
        toHitBonus += val;
        toHitBreakdown.push({
          sourceId: sm.sourceId,
          sourceName: sm.sourceName,
          value: val,
        });
      }
    }

    // Damage Calculation
    const damageBreakdown: ModifierContribution[] = [];
    let damageBonus = 0;

    // Two-Weapon Fighting off-hand rule: omit positive ability modifier unless character has Two-Weapon Fighting style
    const includeAbilityModOnDamage =
      slot !== 'off_hand' || hasTwoWeaponFightingStyle || abilityMod < 0;

    if (includeAbilityModOnDamage && (abilityMod !== 0 || slot !== 'off_hand')) {
      damageBonus += abilityMod;
      damageBreakdown.push({
        sourceId: abilityUsed,
        sourceName: ABILITY_NAMES[abilityUsed],
        value: abilityMod,
      });
    }

    if (magicDamageBonus !== 0) {
      damageBonus += magicDamageBonus;
      damageBreakdown.push({
        sourceId: 'magic',
        sourceName: `+${magicDamageBonus} Magic Bonus`,
        value: magicDamageBonus,
      });
    }

    const damageTarget = rangeType === 'ranged' ? 'ranged_damage' : 'melee_damage';
    const isOneHandedMeleeNoOtherWeapon =
      rangeType === 'melee' &&
      !weapon.properties.includes('two-handed') &&
      (slot === 'main_hand' ? offHandWeapon === undefined : mainHandWeapon === undefined);

    for (const sm of sourcedModifiers) {
      if (sm.isWeaponSpecific) continue;
      if (sm.modifier.type !== 'flat_bonus' || sm.modifier.target !== damageTarget) {
        continue;
      }

      if (sm.modifier.condition === 'one_handed_melee_no_other_weapon') {
        if (!isOneHandedMeleeNoOtherWeapon) continue;
      } else if (
        sm.modifier.condition &&
        !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
          wearingArmor,
          wearingHeavyArmor,
          wieldingShield,
          sourceId: sm.sourceId,
        })
      ) {
        continue;
      }

      // SRD 5.1 Rage bonus applies only to melee weapon attacks using Strength
      if (sm.sourceId === 'barbarian-rage' && abilityUsed !== 'str') {
        continue;
      }

      const rawVal =
        sm.sourceId === 'barbarian-rage'
          ? barbarianRageDamageScale
          : evaluateFlatModifierValue(
              sm.modifier.value,
              getModifierFormulaContext(sm),
            );

      if (rawVal !== null && rawVal !== 0) {
        damageBonus += rawVal;
        damageBreakdown.push({
          sourceId: sm.sourceId,
          sourceName: sm.sourceName,
          value: rawVal,
        });
      }
    }

    // Monk Martial Arts die upgrade if larger than weapon's base damage die
    let effectiveDamageDice = weapon.damageDice;
    if (
      qualifiesForMartialArts &&
      parseDieFaces(monkMartialArtsDie) > parseDieFaces(weapon.damageDice)
    ) {
      effectiveDamageDice = monkMartialArtsDie;
    }

    const damageFormula = formatDamageFormula(effectiveDamageDice, damageBonus);
    const versatileDamageFormula = weapon.versatileDamageDice
      ? formatDamageFormula(weapon.versatileDamageDice, damageBonus)
      : undefined;

    return {
      id: instance.instanceId,
      weaponId: weapon.id,
      name: displayName,
      slot,
      rangeType,
      abilityUsed,
      proficient,
      toHitBonus,
      toHitBreakdown,
      damageDice: effectiveDamageDice,
      ...(weapon.versatileDamageDice
        ? { versatileDamageDice: weapon.versatileDamageDice }
        : {}),
      damageBonus,
      damageBreakdown,
      damageFormula,
      ...(versatileDamageFormula ? { versatileDamageFormula } : {}),
      damageType: weapon.damageType,
      properties: weapon.properties,
      reachFeet: weapon.properties.includes('reach') ? 10 : 5,
      ...(weapon.rangeFeet ? { rangeFeet: weapon.rangeFeet } : {}),
      critRange,
      isMagical,
      actionCost: slot === 'off_hand' ? 'bonus_action' : 'action',
    };
  };

  const weaponAttacks: DerivedWeaponAttackProfile[] = [];
  if (mainHandWeapon) {
    weaponAttacks.push(buildWeaponAttackProfile(mainHandWeapon, 'main_hand'));
  }
  // SRD 5.1 Two-Weapon Fighting: the off-hand bonus attack requires a light
  // melee weapon in EACH hand (PHB: "a light melee weapon... in one hand...
  // a different light melee weapon... in the other hand"). A non-light main
  // (e.g. quarterstaff/longsword) with a light off-hand (e.g. dagger) does
  // NOT qualify, so no off-hand profile is emitted and no BA button appears.
  const isLightMeleeWeapon = (w: typeof mainHandWeapon): boolean =>
    Boolean(w) && w!.weapon.rangeType === 'melee' && w!.weapon.properties.includes('light');
  if (
    offHandWeapon &&
    offHandWeapon.instance.instanceId !== mainHandWeapon?.instance.instanceId &&
    isLightMeleeWeapon(mainHandWeapon) &&
    isLightMeleeWeapon(offHandWeapon)
  ) {
    weaponAttacks.push(buildWeaponAttackProfile(offHandWeapon, 'off_hand'));
  }
  if (rangedWeapon) {
    weaponAttacks.push(buildWeaponAttackProfile(rangedWeapon, 'ranged'));
  }

  // Always include Unarmed Strike (or Monk Martial Arts Unarmed Strike)
  const unarmedAbility: AbilityId =
    hasMartialArts && abilities.dex.modifier > abilities.str.modifier ? 'dex' : 'str';
  const unarmedAbilityMod = abilities[unarmedAbility].modifier;
  const unarmedToHit = unarmedAbilityMod + proficiencyBonus;
  const unarmedDamageDice = hasMartialArts ? monkMartialArtsDie : '1';
  const unarmedDamageBreakdown: ModifierContribution[] = [
    {
      sourceId: unarmedAbility,
      sourceName: ABILITY_NAMES[unarmedAbility],
      value: unarmedAbilityMod,
    },
  ];
  let unarmedDamageBonus = unarmedAbilityMod;

  for (const sm of sourcedModifiers) {
    if (sm.isWeaponSpecific) continue;
    if (sm.modifier.type !== 'flat_bonus' || sm.modifier.target !== 'melee_damage') {
      continue;
    }
    // Dueling requires wielding a melee weapon in one hand (does not apply to unarmed strikes)
    if (sm.modifier.condition === 'one_handed_melee_no_other_weapon') {
      continue;
    }
    if (
      sm.modifier.condition &&
      !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
        wearingArmor,
        wearingHeavyArmor,
        wieldingShield,
        sourceId: sm.sourceId,
      })
    ) {
      continue;
    }
    if (sm.sourceId === 'barbarian-rage' && unarmedAbility !== 'str') {
      continue;
    }
    const rawVal =
      sm.sourceId === 'barbarian-rage'
        ? barbarianRageDamageScale
        : evaluateFlatModifierValue(sm.modifier.value, getModifierFormulaContext(sm));
    if (rawVal !== null && rawVal !== 0) {
      unarmedDamageBonus += rawVal;
      unarmedDamageBreakdown.push({
        sourceId: sm.sourceId,
        sourceName: sm.sourceName,
        value: rawVal,
      });
    }
  }

  weaponAttacks.push({
    id: 'unarmed-strike',
    weaponId: 'unarmed-strike',
    name: hasMartialArts ? 'Unarmed Strike (Martial Arts)' : 'Unarmed Strike',
    slot: 'unarmed',
    rangeType: 'melee',
    abilityUsed: unarmedAbility,
    proficient: true,
    toHitBonus: unarmedToHit,
    toHitBreakdown: [
      {
        sourceId: unarmedAbility,
        sourceName: ABILITY_NAMES[unarmedAbility],
        value: unarmedAbilityMod,
      },
      {
        sourceId: 'prof',
        sourceName: 'Proficiency',
        value: proficiencyBonus,
      },
    ],
    damageDice: unarmedDamageDice,
    damageBonus: unarmedDamageBonus,
    damageBreakdown: unarmedDamageBreakdown,
    damageFormula: formatDamageFormula(unarmedDamageDice, unarmedDamageBonus),
    damageType: 'bludgeoning',
    properties: [],
    reachFeet: 5,
    critRange,
    isMagical: featureIds.includes('ki-empowered-strikes'),
    actionCost: 'action',
  });

  // --------------------------------------------------------------------------
  // STAGE 9: Spellcasting DC, Attack & Slots
  // --------------------------------------------------------------------------
  let flatSpellSaveDcBonus = 0;
  let flatSpellAttackBonus = 0;

  for (const sm of sourcedModifiers) {
    if (sm.modifier.type !== 'flat_bonus') continue;
    if (
      !isCharacterStatePredicateSatisfied(sm.modifier.condition, {
        wearingArmor,
        wearingHeavyArmor,
        wieldingShield,
        sourceId: sm.sourceId,
      })
    ) {
      continue;
    }
    if (sm.modifier.target === 'spell_save_dc') {
      const val = evaluateFlatModifierValue(
        sm.modifier.value,
        getModifierFormulaContext(sm),
      );
      if (val !== null) flatSpellSaveDcBonus += val;
    } else if (sm.modifier.target === 'spell_attack') {
      const val = evaluateFlatModifierValue(
        sm.modifier.value,
        getModifierFormulaContext(sm),
      );
      if (val !== null) flatSpellAttackBonus += val;
    }
  }

  const derivedSpellClasses: DerivedClassSpellcasting[] = [];
  const allAlwaysPreparedSet = new Set<string>();
  const nonPactCasterEntries: { entry: CharacterClassEntry; classData: ClassData }[] = [];
  let warlockCasterEntry: { entry: CharacterClassEntry; classData: ClassData } | undefined;

  const chosenLandTerrains =
    choiceTree.selectedFeatureOptionIdsByGroup['circle-terrain'] ?? [];

  for (const entry of state.classes) {
    const classData = compendium.getClass(entry.classId);
    if (!classData?.spellcasting) continue;

    const { spellcasting } = classData;
    // Half casters (Paladin, Ranger) unlock spellcasting at L2; Third casters at L3
    const minLevelForSpellcasting =
      spellcasting.progression === 'half'
        ? 2
        : spellcasting.progression === 'third'
          ? 3
          : 1;
    if (entry.level < minLevelForSpellcasting) {
      continue;
    }

    if (spellcasting.progression === 'pact') {
      warlockCasterEntry = { entry, classData };
    } else {
      nonPactCasterEntries.push({ entry, classData });
    }

    const spellAb = spellcasting.ability;
    const spellAbMod = abilities[spellAb].modifier;
    const spellSaveDc = 8 + proficiencyBonus + spellAbMod + flatSpellSaveDcBonus;
    const spellAttackBonus = proficiencyBonus + spellAbMod + flatSpellAttackBonus;

    let maxPreparedSpells: number | undefined;
    if (
      spellcasting.preparationMode === 'prepared_full_list' ||
      spellcasting.preparationMode === 'spellbook'
    ) {
      const levelContribution =
        spellcasting.progression === 'half'
          ? Math.floor(entry.level / 2)
          : spellcasting.progression === 'third'
            ? Math.floor(entry.level / 3)
            : entry.level;
      maxPreparedSpells = Math.max(1, spellAbMod + levelContribution);
    }

    let cantripsKnownCount = spellcasting.cantripsKnownByLevel[entry.level - 1] ?? 0;
    if (entry.classId === 'druid' && featureIds.includes('bonus-cantrip-land')) {
      cantripsKnownCount += 1;
    }

    const spellsKnownCount = spellcasting.spellsKnownByLevel
      ? spellcasting.spellsKnownByLevel[entry.level - 1]
      : undefined;

    // Collect subclass always-prepared spells (e.g. Life Domain, Oath of Devotion, Circle of the Land)
    const classAlwaysPrepared: string[] = [];
    const subclassData =
      entry.subclassId && entry.level >= classData.subclassLevel
        ? compendium.getSubclass(entry.subclassId)
        : undefined;

    if (subclassData?.spells) {
      for (const grant of subclassData.spells) {
        if (grant.mode !== 'always_prepared' || grant.classLevel > entry.level) {
          continue;
        }
        if (
          grant.terrain &&
          chosenLandTerrains.length > 0 &&
          !chosenLandTerrains.includes(grant.terrain)
        ) {
          continue;
        }
        for (const spellId of grant.spellIds) {
          if (!classAlwaysPrepared.includes(spellId)) {
            classAlwaysPrepared.push(spellId);
          }
          allAlwaysPreparedSet.add(spellId);
        }
      }
    }

    derivedSpellClasses.push({
      classId: entry.classId,
      ability: spellAb,
      abilityModifier: spellAbMod,
      spellSaveDc,
      spellAttackBonus,
      preparationMode: spellcasting.preparationMode,
      ...(maxPreparedSpells !== undefined ? { maxPreparedSpells } : {}),
      cantripsKnownCount,
      ...(spellsKnownCount !== undefined ? { spellsKnownCount } : {}),
      ritualCasting: spellcasting.ritualCasting,
      alwaysPreparedSpellIds: classAlwaysPrepared,
    });
  }

  // Compute Effective Caster Level and Standard/Multiclass Spell Slots (1..9)
  let nonPactEffectiveLevel = 0;
  for (const { entry, classData } of nonPactCasterEntries) {
    const prog = classData.spellcasting!.progression;
    if (prog === 'full') {
      nonPactEffectiveLevel += entry.level;
    } else if (prog === 'half') {
      nonPactEffectiveLevel += Math.floor(entry.level / 2);
    } else if (prog === 'third') {
      nonPactEffectiveLevel += Math.floor(entry.level / 3);
    }
  }
  nonPactEffectiveLevel = Math.min(20, Math.max(0, nonPactEffectiveLevel));

  const maxSlotsByLevel: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, number> = {
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

  if (nonPactCasterEntries.length === 1) {
    const { entry, classData } = nonPactCasterEntries[0]!;
    const lvlSlots = classData.levels[entry.level - 1]?.spellSlots;
    if (lvlSlots) {
      maxSlotsByLevel[1] = lvlSlots.level1;
      maxSlotsByLevel[2] = lvlSlots.level2;
      maxSlotsByLevel[3] = lvlSlots.level3;
      maxSlotsByLevel[4] = lvlSlots.level4;
      maxSlotsByLevel[5] = lvlSlots.level5;
      maxSlotsByLevel[6] = lvlSlots.level6;
      maxSlotsByLevel[7] = lvlSlots.level7;
      maxSlotsByLevel[8] = lvlSlots.level8;
      maxSlotsByLevel[9] = lvlSlots.level9;
    }
  } else if (nonPactCasterEntries.length > 1 && nonPactEffectiveLevel >= 1) {
    const mcRow = MULTICLASS_SPELL_SLOTS_TABLE[nonPactEffectiveLevel];
    if (mcRow) {
      for (let sLvl = 1; sLvl <= 9; sLvl++) {
        maxSlotsByLevel[sLvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9] = mcRow[sLvl - 1]!;
      }
    }
  }

  const spellSlots = {} as Record<
    1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    DerivedSpellSlotPool
  >;
  for (let sLvl = 1; sLvl <= 9; sLvl++) {
    const key = sLvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    const max = maxSlotsByLevel[key];
    const expended = Math.min(
      max,
      Math.max(0, state.runtime.expendedSpellSlots[key] ?? 0),
    );
    spellSlots[key] = {
      max,
      expended,
      available: max - expended,
    };
  }

  // Warlock Pact Magic
  let pactMagic: DerivedPactMagic | undefined;
  if (warlockCasterEntry) {
    const wSlots =
      warlockCasterEntry.classData.levels[warlockCasterEntry.entry.level - 1]?.spellSlots;
    const maxSlots = wSlots?.pactSlots ?? 1;
    const slotLevel = wSlots?.pactSlotLevel ?? 1;
    const expendedSlots = Math.min(
      maxSlots,
      Math.max(0, state.runtime.expendedPactSlots),
    );
    pactMagic = {
      slotLevel,
      maxSlots,
      expendedSlots,
      availableSlots: maxSlots - expendedSlots,
    };
  }

  const effectiveCasterLevel =
    nonPactEffectiveLevel > 0
      ? nonPactEffectiveLevel
      : warlockCasterEntry
        ? warlockCasterEntry.entry.level
        : 0;

  // Collect innate racial spells and choice-based bonus spells
  const cantripSet = new Set<string>(state.spellcasting.knownCantripIds);
  const preparedOrKnownSet = new Set<string>([
    ...state.spellcasting.knownSpellIds,
    ...state.spellcasting.preparedSpellIds,
    ...allAlwaysPreparedSet,
  ]);
  let innateSpellAbility: AbilityId | undefined;

  for (const cId of choiceTree.bonusSpellIdsFromChoices.cantripIds) {
    cantripSet.add(cId);
  }
  for (const sId of choiceTree.bonusSpellIdsFromChoices.spellIds) {
    preparedOrKnownSet.add(sId);
  }
  if (
    state.subraceId === 'high-elf' &&
    (state.racialChoices['high-elf-cantrip']?.length ?? 0) > 0
  ) {
    innateSpellAbility = 'int';
    for (const cId of state.racialChoices['high-elf-cantrip'] ?? []) {
      if (compendium.getSpell(cId)) {
        cantripSet.add(cId);
      }
    }
  }

  const allRacialTraits = [...(race?.traits ?? []), ...(subrace?.traits ?? [])];
  for (const trait of allRacialTraits) {
    for (const innate of trait.innateSpells ?? []) {
      const minLvl = innate.minCharacterLevel ?? 1;
      if (totalLevel < minLvl) continue;
      if (innate.ability && !innateSpellAbility) {
        innateSpellAbility = innate.ability;
      }
      const spell = compendium.getSpell(innate.spellId);
      if (!spell) continue;
      if (spell.level === 0) {
        cantripSet.add(spell.id);
      } else {
        allAlwaysPreparedSet.add(spell.id);
        preparedOrKnownSet.add(spell.id);
      }
    }
  }

  const primarySpellClass = derivedSpellClasses.reduce<
    DerivedClassSpellcasting | undefined
  >((best, curr) => {
    if (!best) return curr;
    const bestLvl =
      state.classes.find((c) => c.classId === best.classId)?.level ?? 0;
    const currLvl =
      state.classes.find((c) => c.classId === curr.classId)?.level ?? 0;
    return currLvl > bestLvl ? curr : best;
  }, undefined);

  const isSpellcaster =
    derivedSpellClasses.length > 0 ||
    cantripSet.size > 0 ||
    preparedOrKnownSet.size > 0;

  const primaryAbility: AbilityId | undefined =
    primarySpellClass?.ability ??
    innateSpellAbility ??
    (isSpellcaster ? 'int' : undefined);

  const primarySpellSaveDc: number | undefined = primarySpellClass
    ? primarySpellClass.spellSaveDc
    : primaryAbility
      ? 8 + proficiencyBonus + abilities[primaryAbility].modifier + flatSpellSaveDcBonus
      : undefined;

  const primarySpellAttackBonus: number | undefined = primarySpellClass
    ? primarySpellClass.spellAttackBonus
    : primaryAbility
      ? proficiencyBonus + abilities[primaryAbility].modifier + flatSpellAttackBonus
      : undefined;

  const spellcastingSummary: DerivedSpellcastingSummary = {
    isSpellcaster,
    effectiveCasterLevel,
    classes: derivedSpellClasses,
    ...(primaryAbility !== undefined ? { primaryAbility } : {}),
    ...(primarySpellSaveDc !== undefined ? { primarySpellSaveDc } : {}),
    ...(primarySpellAttackBonus !== undefined ? { primarySpellAttackBonus } : {}),
    spellSlots,
    ...(pactMagic !== undefined ? { pactMagic } : {}),
    cantripIds: [...cantripSet],
    preparedOrKnownSpellIds: [...preparedOrKnownSet],
    alwaysPreparedSpellIds: [...allAlwaysPreparedSet],
    spellbookSpellIds: [...new Set(state.spellcasting.spellbookSpellIds)],
  };

  // --------------------------------------------------------------------------
  // STAGE 10: Action Economy, Resource Pools & Activated Abilities
  // --------------------------------------------------------------------------
  let attacksPerAction = 1;
  for (const sm of sourcedModifiers) {
    if (
      sm.modifier.type === 'extra_attack' &&
      sm.modifier.attacksPerAction > attacksPerAction
    ) {
      attacksPerAction = sm.modifier.attacksPerAction;
    }
  }

  const resources: Record<string, DerivedResourcePool> = {};

  for (const sm of sourcedModifiers) {
    if (sm.modifier.type !== 'grant_resource') continue;
    const resMod = sm.modifier;
    const { resourceId } = resMod;

    let max =
      evaluateFlatModifierValue(resMod.maxFormula, getModifierFormulaContext(sm)) ?? 1;
    let recovery = resMod.recovery;

    // Apply class-level progression table overrides for scaling class resources
    if (resourceId === 'rage' && barbarianEntry && barbarianClassData) {
      const rageCount =
        barbarianClassData.levels[barbarianEntry.level - 1]?.classSpecific['rage_count'];
      if (typeof rageCount === 'number') {
        max = rageCount;
      }
    } else if (resourceId === 'channel_divinity') {
      const clericEntry = state.classes.find((c) => c.classId === 'cleric');
      const clericClass = clericEntry ? compendium.getClass('cleric') : undefined;
      const clericCd =
        clericEntry && clericClass
          ? Number(
              clericClass.levels[clericEntry.level - 1]?.classSpecific[
                'channel_divinity_charges'
              ] ?? 1,
            )
          : 1;
      max = Math.max(max, clericCd);
    } else if (resourceId === 'action_surge') {
      const fighterEntry = state.classes.find((c) => c.classId === 'fighter');
      const fighterClass = fighterEntry ? compendium.getClass('fighter') : undefined;
      const surges =
        fighterEntry && fighterClass
          ? Number(
              fighterClass.levels[fighterEntry.level - 1]?.classSpecific[
                'action_surges'
              ] ?? 1,
            )
          : 1;
      max = Math.max(max, surges);
    } else if (
      resourceId === 'bardic_inspiration' &&
      featureIds.includes('font-of-inspiration')
    ) {
      recovery = 'short_rest';
    }

    max = Math.max(0, max);

    // Support both snake_case (`action_surge`) and kebab-case (`action-surge`) keys in `resourceChargesSpent`
    const kebabId = resourceId.replace(/_/g, '-');
    const rawSpent =
      state.runtime.resourceChargesSpent[resourceId] ??
      state.runtime.resourceChargesSpent[kebabId] ??
      (sm.sourceId ? state.runtime.resourceChargesSpent[sm.sourceId] : undefined) ??
      0;
    const spent = Math.min(max, Math.max(0, rawSpent));

    resources[resourceId] = {
      resourceId,
      name: resMod.name,
      max,
      spent,
      available: max - spent,
      recovery,
      sourceId: sm.sourceId,
    };
  }

  const backgroundName = state.customBackground
    ? state.customBackground.name
    : (background?.name ?? state.backgroundId);

  return {
    id: state.id,
    name: state.name,
    ...(state.playerId !== undefined ? { playerId: state.playerId } : {}),
    portraitId: state.portraitId,
    tokenSpriteId: state.tokenSpriteId,
    raceId: state.raceId,
    raceName: race?.name ?? state.raceId,
    ...(state.subraceId !== undefined ? { subraceId: state.subraceId } : {}),
    ...(subrace !== undefined ? { subraceName: subrace.name } : {}),
    backgroundId: state.backgroundId,
    backgroundName,
    alignment: state.alignment,
    size: race?.size ?? 'medium',
    classes: classSummaries,
    totalLevel,
    xp: state.runtime.xp,
    proficiencyBonus,
    abilities,
    activeModifiers,
    proficiencies,
    damageResistances,
    damageImmunities,
    damageVulnerabilities,
    conditionImmunities,
    traitIds,
    featureIds,
    featIds,
    savingThrows,
    skills,
    passivePerception,
    passiveInvestigation,
    passiveInsight,
    maxHp,
    currentHp,
    tempHp,
    hpBreakdown,
    hitDicePools,
    deathSaves: state.runtime.deathSaves,
    exhaustionLevel,
    armorClass,
    speedFeet,
    senses,
    initiative,
    weaponAttacks,
    spellcasting: spellcastingSummary,
    attacksPerAction,
    resources,
    activatedAbilities: [...activatedAbilitiesMap.values()],
    activeConditions: state.runtime.activeConditions,
    activeEffects: state.runtime.activeEffects,
    ...(state.runtime.concentratingOn !== undefined
      ? { concentratingOn: state.runtime.concentratingOn }
      : {}),
  };
}
