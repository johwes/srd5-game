import {
  ABILITY_IDS,
  type AbilityId,
  ALIGNMENTS,
  type Alignment,
  type ChoiceSpec,
  type ClassData,
  type EquipmentOptionBranch,
  type FeatureOptionChoiceSpec,
  SKILL_IDS,
  type SkillId,
  type SpellData,
  type SpellPreparationMode,
  type SrdCompendium,
  containsProductIdentityProperName,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultSpellcastingSelection,
  defaultCompendium,
  isProhibitedMonsterId,
} from '@srd5/data';
import {
  type AbilityGenerationMethod,
  type AbilityGenerationValidationResult,
  type AsiOrFeatSelection,
  type CharacterBuildState,
  type CharacterClassEntry,
  type CustomBackgroundSpec,
  type DerivedCharacterSheet,
  type DuplicateProficiencyCategory,
  type DuplicateProficiencyCollision,
  type EquippedSlots,
  type InventoryItemInstance,
  POINT_BUY_MIN_SCORE,
  SRD_FAVORED_ENEMY_OPTIONS,
  SRD_NATURAL_EXPLORER_OPTIONS,
  STANDARD_ARRAY,
  applyDuplicateProficiencyReplacement,
  computeDerivedCharacter,
  evaluateFeatEligibility,
  evaluateFormula,
  generateSeededAbilityRolls,
  getFixedHpRollForHitDie,
  getXpThresholdForLevel,
  normalizeFeatureOptionId,
  resolveProficienciesAndDuplicates,
  validateBackgroundChoices,
  validateCharacterBuildAbilities,
  validateCharacterChoices,
  validateChoiceSpecSelection,
  validateClassChoices,
  validateOriginChoices,
} from '@srd5/engine';

// ============================================================================
// 1. Builder Wizard Step Definitions & State Types
// ============================================================================

export const BUILDER_STEP_IDS = [
  'origin',
  'class',
  'abilities',
  'background',
  'equipment',
  'spells',
  'review',
] as const;

export type BuilderStepId = (typeof BUILDER_STEP_IDS)[number];

export interface BuilderStepMeta {
  id: BuilderStepId;
  stepNumber: number;
  title: string;
  shortTitle: string;
  description: string;
}

export const BUILDER_STEPS: readonly BuilderStepMeta[] = [
  {
    id: 'origin',
    stepNumber: 1,
    title: 'Step 1: Origin (Race & Subrace)',
    shortTitle: '1. Origin',
    description: 'Choose your SRD 5.1 race, subrace, and ancestral traits.',
  },
  {
    id: 'class',
    stepNumber: 2,
    title: 'Step 2: Class, Level & Features',
    shortTitle: '2. Class',
    description: 'Select your class, starting level, subclass, skills, and feature options.',
  },
  {
    id: 'abilities',
    stepNumber: 3,
    title: 'Step 3: Ability Scores',
    shortTitle: '3. Abilities',
    description: 'Generate ability scores via Standard Array, 27-Point Buy, or Seeded 4d6kh3.',
  },
  {
    id: 'background',
    stepNumber: 4,
    title: 'Step 4: Background & Proficiencies',
    shortTitle: '4. Background',
    description: 'Select Acolyte or a Custom SRD Background and resolve duplicate proficiencies.',
  },
  {
    id: 'equipment',
    stepNumber: 5,
    title: 'Step 5: Starting Equipment & Shop',
    shortTitle: '5. Equipment',
    description: 'Choose class starting equipment bundles or purchase gear with starting gold.',
  },
  {
    id: 'spells',
    stepNumber: 6,
    title: 'Step 6: Spellcasting Selection',
    shortTitle: '6. Spells',
    description: 'Choose cantrips, known spells, wizard spellbook entries, and prepared spells.',
  },
  {
    id: 'review',
    stepNumber: 7,
    title: 'Step 7: Review & Finalize',
    shortTitle: '7. Review',
    description: 'Inspect derived stats, customize identity, and save to your Party Roster.',
  },
] as const;

export type EquipmentAcquisitionMode = 'bundles' | 'gold';
export type StartingGoldMethod = 'average' | 'roll';

export interface CharacterBuilderWizardState {
  buildState: CharacterBuildState;
  currentStep: BuilderStepId;
  equipmentMode: EquipmentAcquisitionMode;
  goldMethod: StartingGoldMethod;
  goldRollSeed: number;
  startingGoldGp: number;
  goldShopCart: Record<string, number>; // equipment itemId -> quantity
}

export interface StepValidationSummary {
  stepId: BuilderStepId;
  valid: boolean;
  skipped: boolean;
  errors: string[];
}

export type BuilderValidationMap = Record<BuilderStepId, StepValidationSummary>;

// ============================================================================
// 2. Portrait & Token Presets
// ============================================================================

export interface PortraitPreset {
  portraitId: string;
  tokenSpriteId: string;
  label: string;
}

export const PORTRAIT_PRESETS: readonly PortraitPreset[] = [
  {
    portraitId: 'portrait-human-fighter',
    tokenSpriteId: 'token-human-fighter',
    label: 'Vanguard Knight',
  },
  {
    portraitId: 'portrait-elf-wizard',
    tokenSpriteId: 'token-elf-wizard',
    label: 'High Arcanist',
  },
  {
    portraitId: 'portrait-dwarf-cleric',
    tokenSpriteId: 'token-dwarf-cleric',
    label: 'Iron Cleric',
  },
  {
    portraitId: 'portrait-halfling-rogue',
    tokenSpriteId: 'token-halfling-rogue',
    label: 'Shadow Scout',
  },
  {
    portraitId: 'portrait-dragonborn-paladin',
    tokenSpriteId: 'token-dragonborn-paladin',
    label: 'Draconic Templar',
  },
  {
    portraitId: 'portrait-half-orc-barbarian',
    tokenSpriteId: 'token-half-orc-barbarian',
    label: 'Berserker Warlord',
  },
  {
    portraitId: 'portrait-tiefling-warlock',
    tokenSpriteId: 'token-tiefling-warlock',
    label: 'Fiend Pact Seeker',
  },
  {
    portraitId: 'portrait-half-elf-bard',
    tokenSpriteId: 'token-half-elf-bard',
    label: 'Lore Minstrel',
  },
] as const;

// ============================================================================
// 3. Unlocked Class Choice & Progression Inspection Helpers
// ============================================================================

export interface BuilderClassLevelChoiceItem {
  level: number;
  choice: ChoiceSpec;
  originKind: 'class' | 'feature' | 'subclass';
  originId: string;
  originName: string;
}

export interface BuilderExpertisePrompt {
  level: number;
  choiceKey: 'expertise-rogue' | 'expertise-bard';
  label: string;
  count: number;
  eligibleOptions: string[];
  selectedOptions: string[];
}

const RANGER_FAVORED_ENEMY_CHOICE: FeatureOptionChoiceSpec = {
  id: 'favored-enemy',
  label: 'Choose a Favored Enemy type',
  count: 1,
  type: 'feature_option',
  featureGroup: 'favored-enemy',
  options: [...SRD_FAVORED_ENEMY_OPTIONS],
};

const RANGER_NATURAL_EXPLORER_CHOICE: FeatureOptionChoiceSpec = {
  id: 'natural-explorer',
  label: 'Choose a Natural Explorer favored terrain',
  count: 1,
  type: 'feature_option',
  featureGroup: 'natural-explorer',
  options: [...SRD_NATURAL_EXPLORER_OPTIONS],
};

/**
 * Inspects a primary `CharacterClassEntry` and returns all non-equipment `ChoiceSpec` items,
 * Expertise prompts, and unlocked ASI levels for levels `1..entry.level`.
 */
export function getBuilderClassProgressionPrompts(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): {
  classData: ClassData | undefined;
  subclassRequired: boolean;
  choiceItems: BuilderClassLevelChoiceItem[];
  expertisePrompts: BuilderExpertisePrompt[];
  unlockedAsiLevels: number[];
} {
  const entry = state.classes[0];
  if (!entry) {
    return {
      classData: undefined,
      subclassRequired: false,
      choiceItems: [],
      expertisePrompts: [],
      unlockedAsiLevels: [],
    };
  }

  const classData = compendium.getClass(entry.classId);
  if (!classData) {
    return {
      classData: undefined,
      subclassRequired: false,
      choiceItems: [],
      expertisePrompts: [],
      unlockedAsiLevels: [],
    };
  }

  const subclassRequired = entry.level >= classData.subclassLevel;
  const subclassData = entry.subclassId
    ? compendium.getSubclass(entry.subclassId)
    : undefined;

  const choiceItems: BuilderClassLevelChoiceItem[] = [];
  const unlockedAsiLevels: number[] = [];

  // Level 1 class skills & tools
  choiceItems.push({
    level: 1,
    choice: classData.skillChoices,
    originKind: 'class',
    originId: classData.id,
    originName: `${classData.name} Skill Proficiencies`,
  });

  for (const toolChoice of classData.toolChoices ?? []) {
    choiceItems.push({
      level: 1,
      choice: toolChoice,
      originKind: 'class',
      originId: classData.id,
      originName: `${classData.name} Tool Proficiencies`,
    });
  }

  for (let lvl = 1; lvl <= entry.level; lvl++) {
    const lvlProg = classData.levels[lvl - 1];
    if (!lvlProg) continue;

    for (const featureId of lvlProg.featureIds) {
      if (featureId.startsWith('asi-')) {
        unlockedAsiLevels.push(lvl);
        continue;
      }
      const feature = compendium.getFeature(featureId);
      if (!feature) continue;

      for (const choice of feature.choices ?? []) {
        if (feature.id === 'metamagic' && lvl > 3) {
          choiceItems.push({
            level: lvl,
            choice: {
              ...choice,
              count: 1,
              label: `Choose 1 additional Metamagic option (Level ${lvl})`,
            },
            originKind: 'feature',
            originId: feature.id,
            originName: feature.name,
          });
          continue;
        }
        choiceItems.push({
          level: lvl,
          choice,
          originKind: 'feature',
          originId: feature.id,
          originName: feature.name,
        });
      }

      if (feature.id === 'favored-enemy') {
        choiceItems.push({
          level: lvl,
          choice: RANGER_FAVORED_ENEMY_CHOICE,
          originKind: 'feature',
          originId: feature.id,
          originName: feature.name,
        });
      } else if (feature.id === 'natural-explorer') {
        choiceItems.push({
          level: lvl,
          choice: RANGER_NATURAL_EXPLORER_CHOICE,
          originKind: 'feature',
          originId: feature.id,
          originName: feature.name,
        });
      }
    }

    // Warlock additional Eldritch Invocations at higher levels
    if (classData.id === 'warlock' && lvl > 2) {
      const prevInv = Number(
        classData.levels[lvl - 2]?.classSpecific['invocations_known'] ?? 0,
      );
      const currInv = Number(lvlProg.classSpecific['invocations_known'] ?? 0);
      const delta = currInv - prevInv;
      const invFeature = compendium.getFeature('eldritch-invocations');
      const baseInvChoice = invFeature?.choices?.[0];
      if (delta > 0 && invFeature && baseInvChoice) {
        choiceItems.push({
          level: lvl,
          choice: {
            ...baseInvChoice,
            count: delta,
            label: `Choose ${delta} additional Eldritch Invocation(s) (Level ${lvl})`,
          },
          originKind: 'feature',
          originId: invFeature.id,
          originName: invFeature.name,
        });
      }
    }

    // Ranger additional Favored Enemy / Natural Explorer at higher levels
    if (classData.id === 'ranger' && lvl > 1) {
      const prevEnemy = Number(
        classData.levels[lvl - 2]?.classSpecific['favored_enemies'] ?? 1,
      );
      const currEnemy = Number(lvlProg.classSpecific['favored_enemies'] ?? 1);
      if (currEnemy > prevEnemy) {
        choiceItems.push({
          level: lvl,
          choice: {
            ...RANGER_FAVORED_ENEMY_CHOICE,
            label: `Choose an additional Favored Enemy (Level ${lvl})`,
          },
          originKind: 'feature',
          originId: 'favored-enemy',
          originName: 'Favored Enemy',
        });
      }

      const prevTerrain = Number(
        classData.levels[lvl - 2]?.classSpecific['favored_terrains'] ?? 1,
      );
      const currTerrain = Number(lvlProg.classSpecific['favored_terrains'] ?? 1);
      if (currTerrain > prevTerrain) {
        choiceItems.push({
          level: lvl,
          choice: {
            ...RANGER_NATURAL_EXPLORER_CHOICE,
            label: `Choose an additional Natural Explorer terrain (Level ${lvl})`,
          },
          originKind: 'feature',
          originId: 'natural-explorer',
          originName: 'Natural Explorer',
        });
      }
    }

    // Subclass feature choices
    if (
      subclassData &&
      subclassData.classId === classData.id &&
      lvl >= classData.subclassLevel
    ) {
      const subLvl = subclassData.levels.find((l) => l.level === lvl);
      for (const featureId of subLvl?.featureIds ?? []) {
        const feature = compendium.getFeature(featureId);
        if (!feature) continue;
        for (const choice of feature.choices ?? []) {
          choiceItems.push({
            level: lvl,
            choice,
            originKind: 'subclass',
            originId: feature.id,
            originName: feature.name,
          });
        }
      }
    }
  }

  // Expertise prompts (Rogue L1/L6, Bard L3/L10)
  const profResolution = resolveProficienciesAndDuplicates(state, compendium);
  const { resolvedProficiencies } = profResolution;
  const expertisePrompts: BuilderExpertisePrompt[] = [];
  const chosenEarlierExpertise = new Set<string>();

  for (let lvl = 1; lvl <= entry.level; lvl++) {
    const lvlProg = classData.levels[lvl - 1];
    const hasRogueExpertise = lvlProg?.featureIds.includes('expertise-rogue') ?? false;
    const hasBardExpertise =
      (lvlProg?.featureIds.includes('expertise-bard') ?? false) ||
      (classData.id === 'bard' && lvl === 10);

    if (!hasRogueExpertise && !hasBardExpertise) continue;

    const choiceKey = hasRogueExpertise ? 'expertise-rogue' : 'expertise-bard';
    const lvlSelections = entry.choiceSelectionsByLevel[lvl] ?? {};
    const selectedOptions = lvlSelections[choiceKey] ?? [];

    const pool: string[] = [...resolvedProficiencies.skills];
    if (hasRogueExpertise && resolvedProficiencies.tools.includes('thieves-tools')) {
      pool.push('thieves-tools');
    }

    const eligibleOptions = pool.filter((id) => !chosenEarlierExpertise.has(id));
    for (const picked of selectedOptions) {
      chosenEarlierExpertise.add(picked);
    }

    expertisePrompts.push({
      level: lvl,
      choiceKey,
      label: hasRogueExpertise
        ? `Rogue Expertise (Level ${lvl}): Choose 2 proficient skills or thieves' tools`
        : `Bard Expertise (Level ${lvl}): Choose 2 proficient skills`,
      count: 2,
      eligibleOptions,
      selectedOptions,
    });
  }

  return {
    classData,
    subclassRequired,
    choiceItems,
    expertisePrompts,
    unlockedAsiLevels,
  };
}

/**
 * Computes the `hpRollsByLevel` array for a single-class character of `level` using SRD 5.1
 * maximum Hit Die at Level 1 and fixed average (`hitDie / 2 + 1`) for Levels 2+.
 */
export function buildDefaultHpRollsForClass(
  classData: ClassData,
  level: number,
  existingRolls: readonly number[] = [],
): number[] {
  const fixedAvg = getFixedHpRollForHitDie(classData.hitDie);
  const rolls: number[] = [];
  for (let lvl = 1; lvl <= level; lvl++) {
    if (lvl === 1) {
      rolls.push(classData.hitDie);
    } else {
      const existing = existingRolls[lvl - 1];
      rolls.push(
        existing !== undefined && existing >= 1 && existing <= classData.hitDie
          ? existing
          : fixedAvg,
      );
    }
  }
  return rolls;
}

// ============================================================================
// 4. Step 5: Starting Equipment Bundle & Gold Shop Materialization
// ============================================================================

/**
 * Computes the average starting gold (in gp) for a class's `startingGoldFormula` (e.g., `"5d4 * 10"` -> `125`).
 */
export function computeAverageStartingGoldGp(formula: string): number {
  const match = /^(\d+)d(\d+)(?:\s*\*\s*(\d+))?$/.exec(formula.trim());
  if (!match) {
    return 100;
  }
  const count = Number(match[1]);
  const faces = Number(match[2]);
  const multiplier = match[3] ? Number(match[3]) : 1;
  const avgPerDie = (faces + 1) / 2;
  return Math.round(count * avgPerDie * multiplier);
}

/**
 * Deterministically rolls a class's `startingGoldFormula` using `@srd5/engine` seeded PRNG.
 */
export function rollStartingGoldGp(formula: string, seed: number): number {
  const res = evaluateFormula(formula, { rngState: seed });
  return Math.max(1, Math.round(res.total));
}

/**
 * Automatically selects default equipped slots (`armorInstanceId`, `shieldInstanceId`,
 * `mainHandInstanceId`, `offHandInstanceId`, `rangedInstanceId`) from an inventory list.
 */
export function autoEquipInventoryItems(
  inventory: readonly InventoryItemInstance[],
  compendium: SrdCompendium = defaultCompendium,
): EquippedSlots {
  const slots: EquippedSlots = {};

  for (const inst of inventory) {
    if (inst.quantity <= 0) continue;
    const eq = compendium.getEquipment(inst.itemId);
    if (!eq) continue;

    if (eq.kind === 'armor') {
      if (eq.category === 'shield') {
        if (!slots.shieldInstanceId) {
          slots.shieldInstanceId = inst.instanceId;
        }
      } else if (!slots.armorInstanceId) {
        slots.armorInstanceId = inst.instanceId;
      }
    } else if (eq.kind === 'weapon') {
      if (eq.rangeType === 'melee') {
        if (!slots.mainHandInstanceId) {
          slots.mainHandInstanceId = inst.instanceId;
          // If weapon has thrown property and no ranged weapon yet, also allow ranged slot if no dedicated ranged weapon is found later
        } else if (
          !slots.offHandInstanceId &&
          !slots.shieldInstanceId &&
          eq.properties.includes('light')
        ) {
          slots.offHandInstanceId = inst.instanceId;
        }
      } else if (eq.rangeType === 'ranged') {
        if (!slots.rangedInstanceId) {
          slots.rangedInstanceId = inst.instanceId;
        }
      }
    }
  }

  // If no dedicated ranged weapon was equipped, check for a thrown melee weapon not already in mainHand
  if (!slots.rangedInstanceId) {
    for (const inst of inventory) {
      if (inst.instanceId === slots.mainHandInstanceId) continue;
      const eq = compendium.getEquipment(inst.itemId);
      if (eq?.kind === 'weapon' && eq.properties.includes('thrown')) {
        slots.rangedInstanceId = inst.instanceId;
        break;
      }
    }
  }

  // If mainHand weapon is two-handed, unequip shield/offHand
  if (slots.mainHandInstanceId) {
    const mainInst = inventory.find((i) => i.instanceId === slots.mainHandInstanceId);
    const mainWeapon = mainInst ? compendium.getEquipment(mainInst.itemId) : undefined;
    if (
      mainWeapon?.kind === 'weapon' &&
      mainWeapon.properties.includes('two-handed')
    ) {
      delete slots.shieldInstanceId;
      delete slots.offHandInstanceId;
    }
  }

  return slots;
}

/**
 * Materializes `inventory`, `currency`, and `equippedSlots` from a character's selected
 * class starting equipment bundles + class default starting equipment + background starting equipment.
 */
export function materializeBundleEquipment(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): Pick<CharacterBuildState, 'inventory' | 'currency' | 'equippedSlots'> {
  const entry = state.classes[0];
  const classData = entry ? compendium.getClass(entry.classId) : undefined;
  const lvl1Selections = entry?.choiceSelectionsByLevel[1] ?? {};

  const quantityByItemId = new Map<string, number>();
  const addItem = (itemId: string, qty: number): void => {
    if (!compendium.getEquipment(itemId) || qty <= 0) return;
    quantityByItemId.set(itemId, (quantityByItemId.get(itemId) ?? 0) + qty);
  };

  if (classData) {
    for (const equipChoice of classData.startingEquipmentChoices) {
      if (equipChoice.type !== 'equipment_bundle') continue;
      const selectedBranchIds = lvl1Selections[equipChoice.id] ?? [];
      for (const branchId of selectedBranchIds) {
        const branch = equipChoice.options.find(
          (b: EquipmentOptionBranch) => b.id === branchId,
        );
        if (!branch) continue;

        const subKey = `${equipChoice.id}:${branch.id}`;
        const subSelections = lvl1Selections[subKey] ?? [];
        let subOffset = 0;

        for (const itemSpec of branch.items) {
          if (itemSpec.kind === 'item') {
            addItem(itemSpec.itemId, itemSpec.quantity);
          } else {
            const chosenSlice = subSelections.slice(
              subOffset,
              subOffset + itemSpec.count,
            );
            subOffset += itemSpec.count;
            for (const chosenItemId of chosenSlice) {
              addItem(chosenItemId, 1);
            }
          }
        }
      }
    }

    for (const defaultItem of classData.startingEquipmentDefault ?? []) {
      addItem(defaultItem.itemId, defaultItem.quantity);
    }
  }

  // Background starting equipment & currency
  let startingGp = 15;
  if (state.customBackground) {
    addItem('common-clothes', 1);
    addItem('pouch', 1);
  } else {
    const bg = compendium.getBackground(state.backgroundId);
    if (bg) {
      for (const bgItem of bg.startingEquipment) {
        addItem(bgItem.itemId, bgItem.quantity);
      }
      startingGp = bg.startingCurrency?.gp ?? 15;
    }
  }

  const inventory: InventoryItemInstance[] = [];
  let index = 1;
  for (const [itemId, quantity] of quantityByItemId.entries()) {
    inventory.push({
      instanceId: `inv-${index++}-${itemId}`,
      itemId,
      quantity,
    });
  }

  const currency = {
    ...createDefaultCurrency(),
    gp: startingGp,
  };

  const equippedSlots = autoEquipInventoryItems(inventory, compendium);

  return {
    inventory,
    currency,
    equippedSlots,
  };
}

/**
 * Materializes `inventory`, `currency`, and `equippedSlots` from a Gold Shop cart and starting gold budget.
 */
export function materializeGoldShopEquipment(
  startingGoldGp: number,
  cart: Readonly<Record<string, number>>,
  compendium: SrdCompendium = defaultCompendium,
): {
  inventory: InventoryItemInstance[];
  currency: CharacterBuildState['currency'];
  equippedSlots: EquippedSlots;
  budgetCopper: number;
  spentCopper: number;
  remainingCopper: number;
} {
  const budgetCopper = Math.max(0, Math.round(startingGoldGp * 100));
  let spentCopper = 0;
  const inventory: InventoryItemInstance[] = [];
  let index = 1;

  for (const [itemId, qty] of Object.entries(cart)) {
    const safeQty = Math.floor(qty);
    if (safeQty <= 0) continue;
    const eq = compendium.getEquipment(itemId);
    if (!eq) continue;
    spentCopper += eq.costCopper * safeQty;
    inventory.push({
      instanceId: `shop-${index++}-${itemId}`,
      itemId,
      quantity: safeQty,
    });
  }

  const remainingCopper = Math.max(0, budgetCopper - spentCopper);
  const gp = Math.floor(remainingCopper / 100);
  const sp = Math.floor((remainingCopper % 100) / 10);
  const cp = remainingCopper % 10;

  const currency = {
    cp,
    sp,
    ep: 0,
    gp,
    pp: 0,
  };

  const equippedSlots = autoEquipInventoryItems(inventory, compendium);

  return {
    inventory,
    currency,
    equippedSlots,
    budgetCopper,
    spentCopper,
    remainingCopper: budgetCopper - spentCopper,
  };
}

// ============================================================================
// 5. Step 6: Spellcasting Requirements & Applicability
// ============================================================================

export interface BuilderSpellcastingRequirements {
  applicable: boolean;
  classId?: string | undefined;
  className?: string | undefined;
  preparationMode?: SpellPreparationMode | undefined;
  spellcastingAbility?: AbilityId | undefined;
  spellSaveDc?: number | undefined;
  spellAttackBonus?: number | undefined;
  cantripsRequired: number;
  knownSpellsRequired: number;
  spellbookSpellsRequired: number;
  preparedSpellsRequired: number;
  maxSpellLevel: number;
  alwaysPreparedSpellIds: string[];
  availableCantrips: SpellData[];
  availableLeveledSpells: SpellData[];
}

/**
 * Computes the exact spell selection quotas and available spell lists for Step 6 of the Character Builder.
 */
export function getBuilderSpellcastingRequirements(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): BuilderSpellcastingRequirements {
  const derived = computeDerivedCharacter(state, compendium);
  const clsSpell = derived.spellcasting.classes[0];
  const entry = state.classes[0];
  const classData = entry ? compendium.getClass(entry.classId) : undefined;

  if (!clsSpell || !entry || !classData?.spellcasting) {
    return {
      applicable: false,
      cantripsRequired: 0,
      knownSpellsRequired: 0,
      spellbookSpellsRequired: 0,
      preparedSpellsRequired: 0,
      maxSpellLevel: 0,
      alwaysPreparedSpellIds: [],
      availableCantrips: [],
      availableLeveledSpells: [],
    };
  }

  // Determine highest castable spell slot level for this class at `entry.level`
  let maxSpellLevel = 1;
  const lvlSlots = classData.levels[entry.level - 1]?.spellSlots;
  if (classData.spellcasting.progression === 'pact') {
    maxSpellLevel = lvlSlots?.pactSlotLevel ?? 1;
  } else if (lvlSlots) {
    for (let sLvl = 9; sLvl >= 1; sLvl--) {
      const key = `level${sLvl}` as keyof typeof lvlSlots;
      if ((lvlSlots[key] ?? 0) > 0) {
        maxSpellLevel = sLvl;
        break;
      }
    }
  }

  const allClassSpells = compendium.getSpellsForClass(classData.id);
  const availableCantrips = allClassSpells.filter((s) => s.level === 0);
  const availableLeveledSpells = allClassSpells.filter(
    (s) => s.level >= 1 && s.level <= maxSpellLevel,
  );

  const cantripsRequired = clsSpell.cantripsKnownCount;
  const preparationMode = clsSpell.preparationMode;

  let knownSpellsRequired = 0;
  let spellbookSpellsRequired = 0;
  let preparedSpellsRequired = 0;

  if (preparationMode === 'known') {
    knownSpellsRequired = clsSpell.spellsKnownCount ?? 0;
  } else if (preparationMode === 'spellbook') {
    spellbookSpellsRequired = 6 + Math.max(0, entry.level - 1) * 2;
    preparedSpellsRequired = clsSpell.maxPreparedSpells ?? 1;
  } else if (preparationMode === 'prepared_full_list') {
    preparedSpellsRequired = clsSpell.maxPreparedSpells ?? 1;
  }

  return {
    applicable: true,
    classId: classData.id,
    className: classData.name,
    preparationMode,
    spellcastingAbility: clsSpell.ability,
    spellSaveDc: clsSpell.spellSaveDc,
    spellAttackBonus: clsSpell.spellAttackBonus,
    cantripsRequired,
    knownSpellsRequired,
    spellbookSpellsRequired,
    preparedSpellsRequired,
    maxSpellLevel,
    alwaysPreparedSpellIds: clsSpell.alwaysPreparedSpellIds,
    availableCantrips,
    availableLeveledSpells,
  };
}

/**
 * Returns true if the character has class spellcasting unlocked at their current level
 * (so Step 6 is active), or false if Step 6 is skipped (Non-Caster Class).
 */
export function isSpellStepApplicable(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): boolean {
  return getBuilderSpellcastingRequirements(state, compendium).applicable;
}

// ============================================================================
// 6. Per-Step Validation Functions (Steps 1–7)
// ============================================================================

/**
 * Validates Step 1: Race, Subrace, and racial `ChoiceSpec`s.
 */
export function validateOriginStep(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary {
  const res = validateOriginChoices(state, compendium);
  return {
    stepId: 'origin',
    valid: res.valid,
    skipped: false,
    errors: res.errors,
  };
}

/**
 * Validates Step 2: Class, Level, Subclass, Skills, Feature Choices, Expertise, and ASI/Feats.
 */
export function validateClassStep(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary {
  const errors: string[] = [];
  const classRes = validateClassChoices(state, compendium, {
    requireStartingEquipmentChoices: false,
    requireAsiSelections: true,
    requireExpertiseChoices: true,
  });
  errors.push(...classRes.errors);

  // Also check Expertise selections via resolveProficienciesAndDuplicates
  const profRes = resolveProficienciesAndDuplicates(state, compendium, {
    requireExpertiseChoices: true,
  });
  for (const err of profRes.errors) {
    if (err.includes('Expertise')) {
      errors.push(err);
    }
  }

  // Check Ranger implicit choices (favored-enemy, natural-explorer) if primary class is Ranger
  const entry = state.classes[0];
  if (entry?.classId === 'ranger') {
    const prompts = getBuilderClassProgressionPrompts(state, compendium);
    for (const item of prompts.choiceItems) {
      if (item.choice.id === 'favored-enemy' || item.choice.id === 'natural-explorer') {
        const selected = entry.choiceSelectionsByLevel[item.level]?.[item.choice.id];
        const singleRes = validateChoiceSpecSelection(item.choice, selected, {
          compendium,
        });
        for (const err of singleRes.errors) {
          if (!errors.includes(err)) {
            errors.push(err);
          }
        }
      }
    }
  }

  return {
    stepId: 'class',
    valid: errors.length === 0,
    skipped: false,
    errors,
  };
}

/**
 * Validates Step 3: Ability Score Generation (Standard Array, 27-Point Buy, or Seeded 4d6kh3).
 */
export function validateAbilitiesStep(
  state: CharacterBuildState,
): StepValidationSummary & { details: AbilityGenerationValidationResult } {
  const details = validateCharacterBuildAbilities(state);
  return {
    stepId: 'abilities',
    valid: details.valid,
    skipped: false,
    errors: details.errors,
    details,
  };
}

/**
 * Validates Step 4: Background / Custom SRD Background & Duplicate Proficiency Replacements.
 */
export function validateBackgroundStep(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary & {
  duplicateProficiencies: DuplicateProficiencyCollision[];
  unresolvedDuplicates: DuplicateProficiencyCollision[];
} {
  const bgRes = validateBackgroundChoices(state, compendium);
  const dupRes = resolveProficienciesAndDuplicates(state, compendium, {
    requireExpertiseChoices: false,
  });

  const errors: string[] = [
    ...bgRes.errors,
    ...dupRes.errors.filter((e) => !e.includes('Expertise')),
  ];

  return {
    stepId: 'background',
    valid: errors.length === 0,
    skipped: false,
    errors,
    duplicateProficiencies: dupRes.duplicateProficiencies,
    unresolvedDuplicates: dupRes.unresolvedDuplicates,
  };
}

/**
 * Validates Step 5: Starting Equipment Bundles OR Starting Gold Shop.
 */
export function validateEquipmentStep(
  wizard: CharacterBuilderWizardState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary {
  const { buildState, equipmentMode, startingGoldGp, goldShopCart } = wizard;
  const errors: string[] = [];
  const entry = buildState.classes[0];
  const classData = entry ? compendium.getClass(entry.classId) : undefined;

  if (!entry || !classData) {
    return {
      stepId: 'equipment',
      valid: false,
      skipped: false,
      errors: ['Select a valid class before configuring starting equipment.'],
    };
  }

  if (equipmentMode === 'bundles') {
    const lvl1Selections = entry.choiceSelectionsByLevel[1] ?? {};
    for (const equipChoice of classData.startingEquipmentChoices) {
      const res = validateChoiceSpecSelection(
        equipChoice,
        lvl1Selections[equipChoice.id],
        {
          compendium,
          subChoiceSelections: lvl1Selections,
        },
      );
      errors.push(...res.errors);

      // Ensure any selected branch with `category_choice` items has sub-selections
      if (equipChoice.type === 'equipment_bundle') {
        for (const branchId of res.normalizedSelected) {
          const branch = equipChoice.options.find(
            (b: EquipmentOptionBranch) => b.id === branchId,
          );
          if (!branch) continue;
          const categoryItems = branch.items.filter(
            (
              i: EquipmentOptionBranch['items'][number],
            ): i is Extract<
              EquipmentOptionBranch['items'][number],
              { kind: 'category_choice' }
            > => i.kind === 'category_choice',
          );
          if (categoryItems.length > 0) {
            const subKey = `${equipChoice.id}:${branch.id}`;
            const subSelected = lvl1Selections[subKey] ?? [];
            const expectedCount = categoryItems.reduce(
              (s: number, c) => s + c.count,
              0,
            );
            if (subSelected.length !== expectedCount) {
              errors.push(
                `Select ${expectedCount} specific weapon/item(s) for '${branch.label}'.`,
              );
            }
          }
        }
      }
    }
  } else {
    const shopResult = materializeGoldShopEquipment(
      startingGoldGp,
      goldShopCart,
      compendium,
    );
    if (shopResult.spentCopper > shopResult.budgetCopper) {
      const overGp = ((shopResult.spentCopper - shopResult.budgetCopper) / 100).toFixed(2);
      errors.push(
        `Gold Shop purchases exceed your starting gold budget of ${startingGoldGp} gp by ${overGp} gp.`,
      );
    }
    if (shopResult.inventory.length === 0) {
      errors.push(
        'Purchase at least one piece of equipment from the SRD Gold Shop (or switch to Equipment Bundles).',
      );
    }
  }

  return {
    stepId: 'equipment',
    valid: errors.length === 0,
    skipped: false,
    errors,
  };
}

/**
 * Validates Step 6: Spellcasting Selection (Skipped for Non-Casters).
 */
export function validateSpellsStep(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary {
  const reqs = getBuilderSpellcastingRequirements(state, compendium);
  if (!reqs.applicable) {
    return {
      stepId: 'spells',
      valid: true,
      skipped: true,
      errors: [],
    };
  }

  const errors: string[] = [];
  const allowedCantripSet = new Set(reqs.availableCantrips.map((s) => s.id));
  const allowedSpellSet = new Set(reqs.availableLeveledSpells.map((s) => s.id));
  const alwaysPreparedSet = new Set(reqs.alwaysPreparedSpellIds);

  // 1. Cantrips
  const selectedCantrips = state.spellcasting.knownCantripIds.filter((id) =>
    allowedCantripSet.has(id),
  );
  if (selectedCantrips.length !== reqs.cantripsRequired) {
    errors.push(
      `${reqs.className} requires selecting ${reqs.cantripsRequired} cantrip(s), but ${selectedCantrips.length} selected.`,
    );
  }

  // 2. Mode-specific Leveled Spells
  if (reqs.preparationMode === 'known') {
    const selectedKnown = state.spellcasting.knownSpellIds.filter((id) =>
      allowedSpellSet.has(id),
    );
    if (selectedKnown.length !== reqs.knownSpellsRequired) {
      errors.push(
        `${reqs.className} requires selecting ${reqs.knownSpellsRequired} known spell(s), but ${selectedKnown.length} selected.`,
      );
    }
  } else if (reqs.preparationMode === 'spellbook') {
    const selectedBook = state.spellcasting.spellbookSpellIds.filter((id) =>
      allowedSpellSet.has(id),
    );
    if (selectedBook.length !== reqs.spellbookSpellsRequired) {
      errors.push(
        `Wizard Spellbook requires ${reqs.spellbookSpellsRequired} spell(s), but ${selectedBook.length} selected.`,
      );
    }
    const bookSet = new Set(selectedBook);
    const selectedPrep = state.spellcasting.preparedSpellIds.filter((id) =>
      bookSet.has(id),
    );
    const targetPrep = Math.min(
      reqs.preparedSpellsRequired,
      selectedBook.length > 0 ? selectedBook.length : reqs.preparedSpellsRequired,
    );
    if (selectedPrep.length !== targetPrep) {
      errors.push(
        `Wizard requires preparing ${targetPrep} spell(s) from your Spellbook, but ${selectedPrep.length} prepared.`,
      );
    }
  } else if (reqs.preparationMode === 'prepared_full_list') {
    const selectedPrep = state.spellcasting.preparedSpellIds.filter(
      (id) => allowedSpellSet.has(id) && !alwaysPreparedSet.has(id),
    );
    if (selectedPrep.length !== reqs.preparedSpellsRequired) {
      errors.push(
        `${reqs.className} requires preparing ${reqs.preparedSpellsRequired} spell(s) (in addition to domain/oath spells), but ${selectedPrep.length} prepared.`,
      );
    }
  }

  return {
    stepId: 'spells',
    valid: errors.length === 0,
    skipped: false,
    errors,
  };
}

/**
 * Validates Step 7: Character Name, Alignment, Product Identity guardrails, and overall build readiness.
 */
export function validateReviewStep(
  wizard: CharacterBuilderWizardState,
  compendium: SrdCompendium = defaultCompendium,
): StepValidationSummary {
  const { buildState } = wizard;
  const errors: string[] = [];

  const trimmedName = buildState.name.trim();
  if (trimmedName.length === 0) {
    errors.push('Character name is required.');
  } else if (trimmedName.length > 60) {
    errors.push('Character name must be 60 characters or fewer.');
  } else {
    const tokens = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (
      containsProductIdentityProperName(trimmedName) ||
      tokens.some((t) => isProhibitedMonsterId(t))
    ) {
      errors.push(
        `Character name "${trimmedName}" contains a prohibited non-SRD Product Identity term.`,
      );
    }
  }

  if (!ALIGNMENTS.includes(buildState.alignment)) {
    errors.push(`Invalid alignment '${buildState.alignment}'.`);
  }

  // Ensure all prior steps are valid
  const s1 = validateOriginStep(buildState, compendium);
  const s2 = validateClassStep(buildState, compendium);
  const s3 = validateAbilitiesStep(buildState);
  const s4 = validateBackgroundStep(buildState, compendium);
  const s5 = validateEquipmentStep(wizard, compendium);
  const s6 = validateSpellsStep(buildState, compendium);

  for (const prev of [s1, s2, s3, s4, s5, s6]) {
    if (!prev.valid) {
      errors.push(...prev.errors);
    }
  }

  return {
    stepId: 'review',
    valid: errors.length === 0,
    skipped: false,
    errors,
  };
}

/**
 * Evaluates validation across all 7 steps of the Character Builder Wizard.
 */
export function validateAllBuilderSteps(
  wizard: CharacterBuilderWizardState,
  compendium: SrdCompendium = defaultCompendium,
): BuilderValidationMap {
  return {
    origin: validateOriginStep(wizard.buildState, compendium),
    class: validateClassStep(wizard.buildState, compendium),
    abilities: validateAbilitiesStep(wizard.buildState),
    background: validateBackgroundStep(wizard.buildState, compendium),
    equipment: validateEquipmentStep(wizard, compendium),
    spells: validateSpellsStep(wizard.buildState, compendium),
    review: validateReviewStep(wizard, compendium),
  };
}

// ============================================================================
// 7. Navigation Helpers (Including Automatic Step 6 Skip for Non-Casters)
// ============================================================================

/**
 * Returns the next step ID in the wizard sequence, skipping `spells` (Step 6) when
 * the character is a non-caster class (`!isSpellStepApplicable`).
 */
export function getNextBuilderStep(
  currentStep: BuilderStepId,
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): BuilderStepId | null {
  const idx = BUILDER_STEP_IDS.indexOf(currentStep);
  if (idx === -1 || idx >= BUILDER_STEP_IDS.length - 1) {
    return null;
  }
  const next = BUILDER_STEP_IDS[idx + 1]!;
  if (next === 'spells' && !isSpellStepApplicable(state, compendium)) {
    return 'review';
  }
  return next;
}

/**
 * Returns the previous step ID in the wizard sequence, skipping `spells` (Step 6) when
 * the character is a non-caster class (`!isSpellStepApplicable`).
 */
export function getPreviousBuilderStep(
  currentStep: BuilderStepId,
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): BuilderStepId | null {
  const idx = BUILDER_STEP_IDS.indexOf(currentStep);
  if (idx <= 0) {
    return null;
  }
  const prev = BUILDER_STEP_IDS[idx - 1]!;
  if (prev === 'spells' && !isSpellStepApplicable(state, compendium)) {
    return 'equipment';
  }
  return prev;
}

// ============================================================================
// 8. State Initialization & Mutation Helpers
// ============================================================================

/**
 * Creates a fresh default `CharacterBuilderWizardState` with sensible defaults
 * so the player can either customize step-by-step or inspect a valid build immediately.
 */
export function createDefaultBuilderWizardState(
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuilderWizardState {
  const baseBuild: CharacterBuildState = {
    id: 'custom-hero-1',
    version: 1,
    name: 'Alden Stormwind',
    portraitId: 'portrait-human-fighter',
    tokenSpriteId: 'token-human-fighter',
    alignment: 'lawful_good',
    raceId: 'human',
    racialChoices: {
      'human-extra-language': ['dwarvish'],
    },
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['elvish', 'draconic'],
    },
    abilityMethod: 'standard_array',
    baseAbilities: {
      str: 15,
      dex: 13,
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
            'fighter-fighting-style': ['fighting-style-defense'],
            'fighter-armor': ['chain-mail'],
            'fighter-weapons': ['sword-and-shield'],
            'fighter-pack': ['dungeoneers-pack'],
          },
        },
        asiOrFeatByLevel: {},
      },
    ],
    currency: {
      ...createDefaultCurrency(),
      gp: 15,
    },
    inventory: [],
    equippedSlots: {},
    attunedItemInstanceIds: [],
    spellcasting: createDefaultSpellcastingSelection(),
    runtime: createDefaultCharacterRuntimeState({ currentHp: 12 }),
  };

  const materialized = materializeBundleEquipment(baseBuild, compendium);
  const fullBuild: CharacterBuildState = {
    ...baseBuild,
    ...materialized,
  };
  const derived = computeDerivedCharacter(fullBuild, compendium);
  fullBuild.runtime.currentHp = derived.maxHp;

  return {
    buildState: fullBuild,
    currentStep: 'origin',
    equipmentMode: 'bundles',
    goldMethod: 'average',
    goldRollSeed: 10101,
    startingGoldGp: 125,
    goldShopCart: {},
  };
}

/**
 * Loads an existing `CharacterBuildState` (such as one of the 4 iconic party members)
 * into a `CharacterBuilderWizardState`.
 */
export function createWizardStateFromCharacter(
  character: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuilderWizardState {
  const cloned = structuredClone(character);
  const entry = cloned.classes[0];
  const classData = entry ? compendium.getClass(entry.classId) : undefined;
  const formula = classData?.startingGoldFormula ?? '5d4 * 10';
  const avgGold = computeAverageStartingGoldGp(formula);

  return {
    buildState: cloned,
    currentStep: 'origin',
    equipmentMode: 'bundles',
    goldMethod: 'average',
    goldRollSeed: cloned.abilityRollSeed ?? 10101,
    startingGoldGp: avgGold,
    goldShopCart: {},
  };
}

/**
 * Synchronizes `runtime.currentHp` and `runtime.xp` with the character's derived `maxHp` and `totalLevel`
 * during character creation so finalized builds always start at full HP and matching level XP floor.
 */
export function syncBuilderDerivedRuntime(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): { state: CharacterBuildState; derived: DerivedCharacterSheet } {
  const derived = computeDerivedCharacter(state, compendium);
  const nextState: CharacterBuildState = {
    ...state,
    runtime: {
      ...state.runtime,
      xp: getXpThresholdForLevel(derived.totalLevel),
      currentHp: derived.maxHp,
    },
  };
  const nextDerived = computeDerivedCharacter(nextState, compendium);
  return { state: nextState, derived: nextDerived };
}

/**
 * Cleans up any stale `replace:<category>:<proficiencyId>` keys from `backgroundChoices`
 * that no longer correspond to an active duplicate proficiency collision.
 */
export function pruneStaleDuplicateReplacements(
  state: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuildState {
  const dupRes = resolveProficienciesAndDuplicates(state, compendium);
  if (dupRes.staleReplacementChoiceKeys.length === 0) {
    return state;
  }
  const staleSet = new Set(dupRes.staleReplacementChoiceKeys);
  const cleanedBgChoices: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(state.backgroundChoices)) {
    if (!staleSet.has(k)) {
      cleanedBgChoices[k] = v;
    }
  }
  return {
    ...state,
    backgroundChoices: cleanedBgChoices,
  };
}

export {
  ABILITY_IDS,
  type AbilityId,
  ALIGNMENTS,
  type Alignment,
  type AbilityGenerationMethod,
  type AsiOrFeatSelection,
  type CharacterBuildState,
  type CharacterClassEntry,
  type ChoiceSpec,
  type CustomBackgroundSpec,
  type DerivedCharacterSheet,
  type DuplicateProficiencyCategory,
  type DuplicateProficiencyCollision,
  type EquippedSlots,
  type InventoryItemInstance,
  POINT_BUY_MIN_SCORE,
  SKILL_IDS,
  type SkillId,
  STANDARD_ARRAY,
  applyDuplicateProficiencyReplacement,
  computeDerivedCharacter,
  evaluateFeatEligibility,
  generateSeededAbilityRolls,
  normalizeFeatureOptionId,
};
