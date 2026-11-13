import {
  type AbilityBonusMap,
  type ActivatedAbilitySpec,
  type AiArchetype,
  type ChoiceSpec,
  type EffectStepSpec,
  type EquipmentData,
  EquipmentSchema,
  type FeatData,
  type FeatPrerequisite,
  FeatSchema,
  type FeatureData,
  FeatureSchema,
  type InnateSpellGrant,
  type MagicItemCharges,
  type MagicItemData,
  MagicItemSchema,
  type ModifierSpec,
  type MonsterActionSpec,
  type MonsterData,
  MonsterSchema,
  type MonsterSpellcastingSpec,
  type MonsterTraitSpec,
  type RaceData,
  RaceSchema,
  type RacialTraitData,
  type ReactionTriggerSpec,
  type SpellData,
  type SpellHigherLevelScaling,
  SpellSchema,
  type SpellTargetSpec,
  type SubraceData,
  SubraceSchema,
} from '../schemas/index.js';

/**
 * Overlay enrichment for an individual racial or subracial trait.
 */
export interface RacialTraitOverlaySpec {
  modifiers?: ModifierSpec[];
  activatedAbilities?: ActivatedAbilitySpec[];
  choices?: ChoiceSpec[];
  innateSpells?: InnateSpellGrant[];
}

/**
 * Overlay enrichment for an SRD 5.1 Race or Subrace.
 */
export interface RaceOverlaySpec {
  choices?: ChoiceSpec[];
  traits?: Record<string, RacialTraitOverlaySpec>;
}

/**
 * Overlay enrichment for an SRD 5.1 Class or Subclass Feature.
 */
export interface FeatureOverlaySpec {
  featureGroup?: string;
  prerequisite?: string;
  choices?: ChoiceSpec[];
  modifiers?: ModifierSpec[];
  activatedAbilities?: ActivatedAbilitySpec[];
}

/**
 * Overlay enrichment for an SRD 5.1 Feat.
 */
export interface FeatOverlaySpec {
  prerequisites?: FeatPrerequisite[];
  abilityBonuses?: AbilityBonusMap;
  choices?: ChoiceSpec[];
  modifiers?: ModifierSpec[];
  activatedAbilities?: ActivatedAbilitySpec[];
}

/**
 * Overlay enrichment for an SRD 5.1 Adventuring Gear item (e.g. Potion of Healing).
 */
export interface GearOverlaySpec {
  modifiers?: ModifierSpec[];
  activatedAbilities?: ActivatedAbilitySpec[];
}

/**
 * Overlay enrichment for an SRD 5.1 Magic Item.
 */
export interface MagicItemOverlaySpec {
  requiresAttunement?: boolean;
  attunementRestriction?: string;
  baseEquipmentId?: string;
  charges?: MagicItemCharges;
  modifiers?: ModifierSpec[];
  activatedAbilities?: ActivatedAbilitySpec[];
}

/**
 * Overlay enrichment for an SRD 5.1 Spell.
 */
export interface SpellOverlaySpec {
  reactionTrigger?: ReactionTriggerSpec;
  subclasses?: string[];
  targeting?: SpellTargetSpec;
  effects?: EffectStepSpec[];
  higherLevelScaling?: SpellHigherLevelScaling;
}

/**
 * Overlay enrichment for an SRD 5.1 Monster.
 */
export interface MonsterOverlaySpec {
  aiArchetype?: AiArchetype;
  spellcasting?: MonsterSpellcastingSpec;
  traits?: Record<string, Partial<Omit<MonsterTraitSpec, 'id'>>>;
  actions?: Record<string, Partial<Omit<MonsterActionSpec, 'id'>>>;
  bonusActions?: MonsterActionSpec[];
  reactions?: MonsterActionSpec[];
}

/**
 * Complete bundle of declarative Effect DSL overlays across all SRD 5.1 collections.
 */
export interface SrdOverlayBundle {
  races?: Record<string, RaceOverlaySpec>;
  subraces?: Record<string, RaceOverlaySpec>;
  features?: Record<string, FeatureOverlaySpec>;
  feats?: Record<string, FeatOverlaySpec>;
  gear?: Record<string, GearOverlaySpec>;
  magicItems?: Record<string, MagicItemOverlaySpec>;
  spells?: Record<string, SpellOverlaySpec>;
  monsters?: Record<string, MonsterOverlaySpec>;
}

function mergeRacialTraits(
  traits: readonly RacialTraitData[],
  traitOverlays?: Record<string, RacialTraitOverlaySpec>,
): RacialTraitData[] {
  if (!traitOverlays) {
    return [...traits];
  }
  return traits.map((trait) => {
    const overlay = traitOverlays[trait.id];
    if (!overlay) {
      return trait;
    }
    return {
      ...trait,
      ...(overlay.modifiers ? { modifiers: overlay.modifiers } : {}),
      ...(overlay.activatedAbilities ? { activatedAbilities: overlay.activatedAbilities } : {}),
      ...(overlay.choices ? { choices: overlay.choices } : {}),
      ...(overlay.innateSpells ? { innateSpells: overlay.innateSpells } : {}),
    };
  });
}

/**
 * Applies Effect DSL overlays onto an array of `RaceData` records and validates each with `RaceSchema`.
 */
export function applyRaceOverlays(
  races: readonly RaceData[],
  overlays: Readonly<Record<string, RaceOverlaySpec>>,
): RaceData[] {
  return races.map((race) => {
    const overlay = overlays[race.id];
    if (!overlay) {
      return RaceSchema.parse(race);
    }
    const merged: RaceData = {
      ...race,
      ...(overlay.choices ? { choices: overlay.choices } : {}),
      traits: mergeRacialTraits(race.traits, overlay.traits),
    };
    return RaceSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto an array of `SubraceData` records and validates each with `SubraceSchema`.
 */
export function applySubraceOverlays(
  subraces: readonly SubraceData[],
  overlays: Readonly<Record<string, RaceOverlaySpec>>,
): SubraceData[] {
  return subraces.map((subrace) => {
    const overlay = overlays[subrace.id];
    if (!overlay) {
      return SubraceSchema.parse(subrace);
    }
    const merged: SubraceData = {
      ...subrace,
      ...(overlay.choices ? { choices: overlay.choices } : {}),
      traits: mergeRacialTraits(subrace.traits, overlay.traits),
    };
    return SubraceSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto an array of `FeatureData` records and validates each with `FeatureSchema`.
 */
export function applyFeatureOverlays(
  features: readonly FeatureData[],
  overlays: Readonly<Record<string, FeatureOverlaySpec>>,
): FeatureData[] {
  return features.map((feature) => {
    const overlay = overlays[feature.id];
    if (!overlay) {
      return FeatureSchema.parse(feature);
    }
    const merged: FeatureData = {
      ...feature,
      ...(overlay.featureGroup ? { featureGroup: overlay.featureGroup } : {}),
      ...(overlay.prerequisite ? { prerequisite: overlay.prerequisite } : {}),
      ...(overlay.choices ? { choices: overlay.choices } : {}),
      ...(overlay.modifiers ? { modifiers: overlay.modifiers } : {}),
      ...(overlay.activatedAbilities ? { activatedAbilities: overlay.activatedAbilities } : {}),
    };
    return FeatureSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto an array of `FeatData` records and validates each with `FeatSchema`.
 */
export function applyFeatOverlays(
  feats: readonly FeatData[],
  overlays: Readonly<Record<string, FeatOverlaySpec>>,
): FeatData[] {
  return feats.map((feat) => {
    const overlay = overlays[feat.id];
    if (!overlay) {
      return FeatSchema.parse(feat);
    }
    const merged: FeatData = {
      ...feat,
      ...(overlay.prerequisites ? { prerequisites: overlay.prerequisites } : {}),
      ...(overlay.abilityBonuses ? { abilityBonuses: overlay.abilityBonuses } : {}),
      ...(overlay.choices ? { choices: overlay.choices } : {}),
      ...(overlay.modifiers ? { modifiers: overlay.modifiers } : {}),
      ...(overlay.activatedAbilities ? { activatedAbilities: overlay.activatedAbilities } : {}),
    };
    return FeatSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto `EquipmentData` records (specifically enriching `kind: 'gear'`)
 * and validates each with `EquipmentSchema`.
 */
export function applyEquipmentOverlays(
  equipment: readonly EquipmentData[],
  gearOverlays: Readonly<Record<string, GearOverlaySpec>>,
): EquipmentData[] {
  return equipment.map((item) => {
    if (item.kind !== 'gear') {
      return EquipmentSchema.parse(item);
    }
    const overlay = gearOverlays[item.id];
    if (!overlay) {
      return EquipmentSchema.parse(item);
    }
    const merged: EquipmentData = {
      ...item,
      ...(overlay.modifiers ? { modifiers: overlay.modifiers } : {}),
      ...(overlay.activatedAbilities ? { activatedAbilities: overlay.activatedAbilities } : {}),
    };
    return EquipmentSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto `MagicItemData` records and validates each with `MagicItemSchema`.
 */
export function applyMagicItemOverlays(
  magicItems: readonly MagicItemData[],
  overlays: Readonly<Record<string, MagicItemOverlaySpec>>,
): MagicItemData[] {
  return magicItems.map((item) => {
    const overlay = overlays[item.id];
    if (!overlay) {
      return MagicItemSchema.parse(item);
    }
    const merged: MagicItemData = {
      ...item,
      ...(overlay.requiresAttunement !== undefined
        ? { requiresAttunement: overlay.requiresAttunement }
        : {}),
      ...(overlay.attunementRestriction
        ? { attunementRestriction: overlay.attunementRestriction }
        : {}),
      ...(overlay.baseEquipmentId ? { baseEquipmentId: overlay.baseEquipmentId } : {}),
      ...(overlay.charges ? { charges: overlay.charges } : {}),
      ...(overlay.modifiers ? { modifiers: overlay.modifiers } : {}),
      ...(overlay.activatedAbilities ? { activatedAbilities: overlay.activatedAbilities } : {}),
    };
    return MagicItemSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto `SpellData` records and validates each with `SpellSchema`.
 */
export function applySpellOverlays(
  spells: readonly SpellData[],
  overlays: Readonly<Record<string, SpellOverlaySpec>>,
): SpellData[] {
  return spells.map((spell) => {
    const overlay = overlays[spell.id];
    if (!overlay) {
      return SpellSchema.parse(spell);
    }
    const merged: SpellData = {
      ...spell,
      ...(overlay.reactionTrigger ? { reactionTrigger: overlay.reactionTrigger } : {}),
      ...(overlay.subclasses ? { subclasses: overlay.subclasses } : {}),
      ...(overlay.targeting ? { targeting: overlay.targeting } : {}),
      ...(overlay.effects ? { effects: overlay.effects } : {}),
      ...(overlay.higherLevelScaling ? { higherLevelScaling: overlay.higherLevelScaling } : {}),
    };
    return SpellSchema.parse(merged);
  });
}

/**
 * Applies Effect DSL overlays onto `MonsterData` records and validates each with `MonsterSchema`.
 */
export function applyMonsterOverlays(
  monsters: readonly MonsterData[],
  overlays: Readonly<Record<string, MonsterOverlaySpec>>,
): MonsterData[] {
  return monsters.map((monster) => {
    const overlay = overlays[monster.id];
    if (!overlay) {
      return MonsterSchema.parse(monster);
    }

    const traits = overlay.traits
      ? monster.traits.map((trait) => {
          const traitOverlay = overlay.traits?.[trait.id];
          return traitOverlay ? { ...trait, ...traitOverlay, id: trait.id } : trait;
        })
      : monster.traits;

    const actions = overlay.actions
      ? monster.actions.map((action) => {
          const actionOverlay = overlay.actions?.[action.id];
          return actionOverlay ? { ...action, ...actionOverlay, id: action.id } : action;
        })
      : monster.actions;

    const merged: MonsterData = {
      ...monster,
      ...(overlay.aiArchetype ? { aiArchetype: overlay.aiArchetype } : {}),
      ...(overlay.spellcasting ? { spellcasting: overlay.spellcasting } : {}),
      traits,
      actions,
      ...(overlay.bonusActions ? { bonusActions: overlay.bonusActions } : {}),
      ...(overlay.reactions ? { reactions: overlay.reactions } : {}),
    };
    return MonsterSchema.parse(merged);
  });
}
