import type { NormalizedSrdDataset } from '../ingestion/index.js';
import {
  ABILITY_IDS,
  type AbilityId,
  type AbilityScoreDefinition,
  type AiArchetype,
  type AoeShapeType,
  type ArmorCategory,
  type ArmorData,
  type BackgroundData,
  type ChallengeRating,
  type ChoiceSpec,
  type ClassData,
  type ConditionDefinition,
  type ConditionId,
  type CreatureSize,
  type CreatureType,
  type DamageType,
  type DamageTypeDefinition,
  type EffectStepSpec,
  type EquipmentData,
  type EquipmentPackData,
  type FeatData,
  type FeatureData,
  type GearCategory,
  type GearData,
  type HitDieSize,
  type LanguageCategory,
  type LanguageDefinition,
  type MagicItemCategory,
  type MagicItemData,
  type MagicItemRarity,
  type MagicSchool,
  type MonsterData,
  type ProficiencyCategory,
  type ProficiencyDefinition,
  type RaceData,
  SKILL_IDS,
  type SkillDefinition,
  type SkillId,
  type SpellCastingTime,
  type SpellData,
  type SpellLevel,
  type SpellPreparationMode,
  type SpellcastingProgression,
  type SubclassData,
  type SubraceData,
  type ToolCategory,
  type ToolData,
  type WeaponCategory,
  type WeaponData,
  type WeaponProperty,
  type WeaponRangeType,
} from '../schemas/index.js';
import { BUNDLED_SRD_DATASET } from '../srd/index.js';

/**
 * Entity categories indexed by the unified Compendium search engine.
 */
export const COMPENDIUM_ENTITY_KINDS = [
  'race',
  'subrace',
  'class',
  'subclass',
  'feature',
  'background',
  'feat',
  'equipment',
  'magic_item',
  'spell',
  'monster',
  'condition',
  'skill',
  'ability',
  'damage_type',
  'proficiency',
  'language',
] as const;

export type CompendiumEntityKind = (typeof COMPENDIUM_ENTITY_KINDS)[number];

/**
 * Filter criteria for SRD 5.1 Races.
 */
export interface RaceFilter {
  query?: string;
  size?: CreatureSize | readonly CreatureSize[];
  abilityBonus?: AbilityId | readonly AbilityId[];
  hasSubraces?: boolean;
  hasDarkvision?: boolean;
  languageId?: string;
}

/**
 * Filter criteria for SRD 5.1 Subraces.
 */
export interface SubraceFilter {
  query?: string;
  parentRaceId?: string | readonly string[];
  abilityBonus?: AbilityId | readonly AbilityId[];
  hasDarkvision?: boolean;
}

/**
 * Filter criteria for SRD 5.1 Classes.
 */
export interface ClassFilter {
  query?: string;
  hitDie?: HitDieSize | readonly HitDieSize[];
  primaryAbility?: AbilityId | readonly AbilityId[];
  savingThrowProficiency?: AbilityId | readonly AbilityId[];
  isSpellcaster?: boolean;
  spellcastingAbility?: AbilityId | readonly AbilityId[];
  spellcastingProgression?: SpellcastingProgression | readonly SpellcastingProgression[];
  preparationMode?: SpellPreparationMode | readonly SpellPreparationMode[];
}

/**
 * Filter criteria for SRD 5.1 Subclasses.
 */
export interface SubclassFilter {
  query?: string;
  classId?: string | readonly string[];
}

/**
 * Filter criteria for SRD 5.1 Class & Subclass Features.
 */
export interface FeatureFilter {
  query?: string;
  classId?: string | readonly string[];
  subclassId?: string | readonly string[];
  level?: number | readonly number[];
  minLevel?: number;
  maxLevel?: number;
  featureGroup?: string | readonly string[];
  includeSubclassFeatures?: boolean;
}

/**
 * Filter criteria for SRD 5.1 Backgrounds.
 */
export interface BackgroundFilter {
  query?: string;
  skillProficiency?: SkillId | readonly SkillId[];
}

/**
 * Filter criteria for SRD 5.1 Feats.
 */
export interface FeatFilter {
  query?: string;
  hasPrerequisites?: boolean;
}

/**
 * Filter criteria for SRD 5.1 Mundane Equipment (Weapons, Armor, Gear, Tools, Packs).
 */
export interface EquipmentFilter {
  query?: string;
  kind?: EquipmentData['kind'] | readonly EquipmentData['kind'][];
  weaponCategory?: WeaponCategory | readonly WeaponCategory[];
  weaponRangeType?: WeaponRangeType | readonly WeaponRangeType[];
  weaponProperty?: WeaponProperty | readonly WeaponProperty[];
  damageType?: DamageType | readonly DamageType[];
  armorCategory?: ArmorCategory | readonly ArmorCategory[];
  gearCategory?: GearCategory | readonly GearCategory[];
  toolCategory?: ToolCategory | readonly ToolCategory[];
  minCostCopper?: number;
  maxCostCopper?: number;
  maxWeightLb?: number;
  stealthDisadvantage?: boolean;
}

/**
 * Filter criteria specifically for SRD 5.1 Weapons.
 */
export interface WeaponFilter {
  query?: string;
  category?: WeaponCategory | readonly WeaponCategory[];
  rangeType?: WeaponRangeType | readonly WeaponRangeType[];
  property?: WeaponProperty | readonly WeaponProperty[];
  damageType?: DamageType | readonly DamageType[];
  minCostCopper?: number;
  maxCostCopper?: number;
  maxWeightLb?: number;
}

/**
 * Filter criteria specifically for SRD 5.1 Armors & Shields.
 */
export interface ArmorFilter {
  query?: string;
  category?: ArmorCategory | readonly ArmorCategory[];
  minBaseAc?: number;
  maxCostCopper?: number;
  maxStrengthRequirement?: number;
  stealthDisadvantage?: boolean;
}

/**
 * Filter criteria for SRD 5.1 Magic Items.
 */
export interface MagicItemFilter {
  query?: string;
  category?: MagicItemCategory | readonly MagicItemCategory[];
  rarity?: MagicItemRarity | readonly MagicItemRarity[];
  requiresAttunement?: boolean;
  baseEquipmentId?: string;
}

/**
 * Filter criteria for SRD 5.1 Spells.
 */
export interface SpellFilter {
  query?: string;
  level?: SpellLevel | readonly SpellLevel[];
  minLevel?: SpellLevel;
  maxLevel?: SpellLevel;
  school?: MagicSchool | readonly MagicSchool[];
  classId?: string | readonly string[];
  subclassId?: string | readonly string[];
  castingTime?: SpellCastingTime | readonly SpellCastingTime[];
  ritual?: boolean;
  concentration?: boolean;
  damageType?: DamageType | readonly DamageType[];
  savingThrowAbility?: AbilityId | readonly AbilityId[];
  hasAttackRoll?: boolean;
  aoeShape?: AoeShapeType | readonly AoeShapeType[];
  verbal?: boolean;
  somatic?: boolean;
  material?: boolean;
}

/**
 * Filter criteria for SRD 5.1 Monsters.
 */
export interface MonsterFilter {
  query?: string;
  size?: CreatureSize | readonly CreatureSize[];
  type?: CreatureType | readonly CreatureType[];
  challengeRating?: ChallengeRating | readonly ChallengeRating[];
  minCr?: number;
  maxCr?: number;
  aiArchetype?: AiArchetype | readonly AiArchetype[];
  hasSpellcasting?: boolean;
  hasLegendaryActions?: boolean;
  movementMode?: ('fly' | 'swim' | 'climb' | 'burrow') | readonly ('fly' | 'swim' | 'climb' | 'burrow')[];
  damageImmunity?: DamageType | readonly DamageType[];
  conditionImmunity?: ConditionId | readonly ConditionId[];
}

/**
 * Options for cross-collection Compendium full-text search.
 */
export interface CompendiumSearchOptions {
  kinds?: CompendiumEntityKind | readonly CompendiumEntityKind[];
  limit?: number;
}

/**
 * A ranked search result entry returned by `searchCompendium()`.
 */
export interface CompendiumSearchResult {
  id: string;
  name: string;
  kind: CompendiumEntityKind;
  subtitle: string;
  score: number;
  entity:
    | RaceData
    | SubraceData
    | ClassData
    | SubclassData
    | FeatureData
    | BackgroundData
    | FeatData
    | EquipmentData
    | MagicItemData
    | SpellData
    | MonsterData
    | ConditionDefinition
    | SkillDefinition
    | AbilityScoreDefinition
    | DamageTypeDefinition
    | ProficiencyDefinition
    | LanguageDefinition;
}

interface SearchIndexDocument {
  id: string;
  name: string;
  nameLower: string;
  nameTokens: readonly string[];
  bodyLower: string;
  subtitle: string;
  kind: CompendiumEntityKind;
  entity: CompendiumSearchResult['entity'];
}

function toSet<T>(value: T | readonly T[] | undefined): ReadonlySet<T> | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return new Set(value as readonly T[]);
  }
  return new Set([value as T]);
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9+-]+/g, ' ')
    .trim();
}

function tokenizeQuery(query: string | undefined): string[] {
  if (!query) return [];
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function matchesSearchTokens(haystackLower: string, queryTokens: readonly string[]): boolean {
  if (queryTokens.length === 0) return true;
  for (const token of queryTokens) {
    if (!haystackLower.includes(token)) {
      return false;
    }
  }
  return true;
}

function collectSpellEffectMetadata(steps: readonly EffectStepSpec[]): {
  damageTypes: Set<DamageType>;
  saveAbilities: Set<AbilityId>;
  hasAttackRoll: boolean;
} {
  const damageTypes = new Set<DamageType>();
  const saveAbilities = new Set<AbilityId>();
  let hasAttackRoll = false;

  const visit = (list: readonly EffectStepSpec[] | undefined): void => {
    if (!list) return;
    for (const step of list) {
      switch (step.step) {
        case 'attack_roll':
          hasAttackRoll = true;
          visit(step.onHit);
          visit(step.onMiss);
          break;
        case 'saving_throw':
          saveAbilities.add(step.ability);
          visit(step.onFail);
          visit(step.onSuccess);
          break;
        case 'deal_damage':
          damageTypes.add(step.damageType);
          break;
        case 'create_hazard_zone':
          visit(step.onEnterOrStartTurn);
          break;
        default:
          break;
      }
    }
  };

  visit(steps);
  return { damageTypes, saveAbilities, hasAttackRoll };
}

/**
 * Typed, O(1) indexed SRD 5.1 Compendium lookup and search/filter API.
 */
export interface SrdCompendium {
  readonly dataset: NormalizedSrdDataset;

  // Raw collection arrays
  readonly abilities: readonly AbilityScoreDefinition[];
  readonly skills: readonly SkillDefinition[];
  readonly conditions: readonly ConditionDefinition[];
  readonly damageTypes: readonly DamageTypeDefinition[];
  readonly proficiencies: readonly ProficiencyDefinition[];
  readonly languages: readonly LanguageDefinition[];
  readonly races: readonly RaceData[];
  readonly subraces: readonly SubraceData[];
  readonly classes: readonly ClassData[];
  readonly subclasses: readonly SubclassData[];
  readonly features: readonly FeatureData[];
  readonly backgrounds: readonly BackgroundData[];
  readonly feats: readonly FeatData[];
  readonly equipment: readonly EquipmentData[];
  readonly weapons: readonly WeaponData[];
  readonly armors: readonly ArmorData[];
  readonly gear: readonly GearData[];
  readonly tools: readonly ToolData[];
  readonly equipmentPacks: readonly EquipmentPackData[];
  readonly magicItems: readonly MagicItemData[];
  readonly spells: readonly SpellData[];
  readonly monsters: readonly MonsterData[];

  // O(1) ID Lookups (optional return)
  getAbility(id: AbilityId | string): AbilityScoreDefinition | undefined;
  getSkill(id: SkillId | string): SkillDefinition | undefined;
  getCondition(id: ConditionId | string): ConditionDefinition | undefined;
  getDamageType(id: DamageType | string): DamageTypeDefinition | undefined;
  getProficiency(id: string): ProficiencyDefinition | undefined;
  getLanguage(id: string): LanguageDefinition | undefined;
  getRace(id: string): RaceData | undefined;
  getSubrace(id: string): SubraceData | undefined;
  getClass(id: string): ClassData | undefined;
  getSubclass(id: string): SubclassData | undefined;
  getFeature(id: string): FeatureData | undefined;
  getBackground(id: string): BackgroundData | undefined;
  getFeat(id: string): FeatData | undefined;
  getEquipment(id: string): EquipmentData | undefined;
  getWeapon(id: string): WeaponData | undefined;
  getArmor(id: string): ArmorData | undefined;
  getGear(id: string): GearData | undefined;
  getTool(id: string): ToolData | undefined;
  getEquipmentPack(id: string): EquipmentPackData | undefined;
  getMagicItem(id: string): MagicItemData | undefined;
  getSpell(id: string): SpellData | undefined;
  getMonster(id: string): MonsterData | undefined;

  // Strict O(1) ID Lookups (throws descriptive error if missing)
  requireAbility(id: AbilityId | string): AbilityScoreDefinition;
  requireSkill(id: SkillId | string): SkillDefinition;
  requireCondition(id: ConditionId | string): ConditionDefinition;
  requireDamageType(id: DamageType | string): DamageTypeDefinition;
  requireProficiency(id: string): ProficiencyDefinition;
  requireLanguage(id: string): LanguageDefinition;
  requireRace(id: string): RaceData;
  requireSubrace(id: string): SubraceData;
  requireClass(id: string): ClassData;
  requireSubclass(id: string): SubclassData;
  requireFeature(id: string): FeatureData;
  requireBackground(id: string): BackgroundData;
  requireFeat(id: string): FeatData;
  requireEquipment(id: string): EquipmentData;
  requireWeapon(id: string): WeaponData;
  requireArmor(id: string): ArmorData;
  requireGear(id: string): GearData;
  requireTool(id: string): ToolData;
  requireEquipmentPack(id: string): EquipmentPackData;
  requireMagicItem(id: string): MagicItemData;
  requireSpell(id: string): SpellData;
  requireMonster(id: string): MonsterData;

  // Relational & Secondary Index Queries
  getSubracesForRace(raceId: string): readonly SubraceData[];
  getSubclassesForClass(classId: string): readonly SubclassData[];
  getFeaturesForClass(classId: string, maxLevel?: number): readonly FeatureData[];
  getFeaturesForSubclass(subclassId: string, maxLevel?: number): readonly FeatureData[];
  getFeaturesByGroup(featureGroup: string): readonly FeatureData[];
  getSpellsForClass(
    classId: string,
    filter?: Omit<SpellFilter, 'classId'>,
  ): readonly SpellData[];
  getSpellsForSubclass(subclassId: string, maxClassLevel?: number): readonly SpellData[];
  getLanguagesByCategory(category: LanguageCategory): readonly LanguageDefinition[];
  getProficienciesByCategory(category: ProficiencyCategory): readonly ProficiencyDefinition[];
  isProficientWithEquipment(proficiencyIds: Iterable<string>, equipmentId: string): boolean;
  resolveEquipmentCategory(category: string): readonly EquipmentData[];
  resolveChoiceOptions(choice: ChoiceSpec): readonly string[];

  // Structured Filter Queries
  filterRaces(filter?: RaceFilter): readonly RaceData[];
  filterSubraces(filter?: SubraceFilter): readonly SubraceData[];
  filterClasses(filter?: ClassFilter): readonly ClassData[];
  filterSubclasses(filter?: SubclassFilter): readonly SubclassData[];
  filterFeatures(filter?: FeatureFilter): readonly FeatureData[];
  filterBackgrounds(filter?: BackgroundFilter): readonly BackgroundData[];
  filterFeats(filter?: FeatFilter): readonly FeatData[];
  filterEquipment(filter?: EquipmentFilter): readonly EquipmentData[];
  filterWeapons(filter?: WeaponFilter): readonly WeaponData[];
  filterArmors(filter?: ArmorFilter): readonly ArmorData[];
  filterMagicItems(filter?: MagicItemFilter): readonly MagicItemData[];
  filterSpells(filter?: SpellFilter): readonly SpellData[];
  filterMonsters(filter?: MonsterFilter): readonly MonsterData[];

  // Cross-Collection Full-Text Search
  searchCompendium(
    query: string,
    options?: CompendiumSearchOptions,
  ): readonly CompendiumSearchResult[];
}

/**
 * Alias used by `@srd5/engine` (`computeDerivedCharacter(state, data: CompendiumData)`).
 */
export type CompendiumData = SrdCompendium;

/**
 * Builds an indexed `SrdCompendium` instance over a normalized SRD 5.1 dataset
 * (defaults to `BUNDLED_SRD_DATASET`).
 */
export function createCompendium(
  dataset: NormalizedSrdDataset = BUNDLED_SRD_DATASET,
): SrdCompendium {
  const abilities = dataset.abilitiesAndSkills.abilities;
  const skills = dataset.abilitiesAndSkills.skills;
  const conditions = dataset.conditions;
  const damageTypes = dataset.damageTypes;
  const proficiencies = dataset.proficienciesAndLanguages.proficiencies;
  const languages = dataset.proficienciesAndLanguages.languages;
  const races = dataset.races;
  const subraces = dataset.subraces;
  const classes = dataset.classes;
  const subclasses = dataset.subclasses;
  const features = dataset.features;
  const backgrounds = dataset.backgrounds;
  const feats = dataset.feats;
  const equipment = dataset.equipment;
  const magicItems = dataset.magicItems;
  const spells = dataset.spells;
  const monsters = dataset.monsters;

  // Partition equipment by kind
  const weapons: WeaponData[] = [];
  const armors: ArmorData[] = [];
  const gear: GearData[] = [];
  const tools: ToolData[] = [];
  const equipmentPacks: EquipmentPackData[] = [];

  for (const item of equipment) {
    switch (item.kind) {
      case 'weapon':
        weapons.push(item);
        break;
      case 'armor':
        armors.push(item);
        break;
      case 'gear':
        gear.push(item);
        break;
      case 'tool':
        tools.push(item);
        break;
      case 'pack':
        equipmentPacks.push(item);
        break;
    }
  }

  // Primary O(1) ID Maps
  const abilityMap = new Map<string, AbilityScoreDefinition>(abilities.map((a) => [a.id, a]));
  const skillMap = new Map<string, SkillDefinition>(skills.map((s) => [s.id, s]));
  const conditionMap = new Map<string, ConditionDefinition>(conditions.map((c) => [c.id, c]));
  const damageTypeMap = new Map<string, DamageTypeDefinition>(damageTypes.map((d) => [d.id, d]));
  const proficiencyMap = new Map<string, ProficiencyDefinition>(
    proficiencies.map((p) => [p.id, p]),
  );
  const languageMap = new Map<string, LanguageDefinition>(languages.map((l) => [l.id, l]));
  const raceMap = new Map<string, RaceData>(races.map((r) => [r.id, r]));
  const subraceMap = new Map<string, SubraceData>(subraces.map((s) => [s.id, s]));
  const classMap = new Map<string, ClassData>(classes.map((c) => [c.id, c]));
  const subclassMap = new Map<string, SubclassData>(subclasses.map((s) => [s.id, s]));
  const featureMap = new Map<string, FeatureData>(features.map((f) => [f.id, f]));
  const backgroundMap = new Map<string, BackgroundData>(backgrounds.map((b) => [b.id, b]));
  const featMap = new Map<string, FeatData>(feats.map((f) => [f.id, f]));
  const equipmentMap = new Map<string, EquipmentData>(equipment.map((e) => [e.id, e]));
  const weaponMap = new Map<string, WeaponData>(weapons.map((w) => [w.id, w]));
  const armorMap = new Map<string, ArmorData>(armors.map((a) => [a.id, a]));
  const gearMap = new Map<string, GearData>(gear.map((g) => [g.id, g]));
  const toolMap = new Map<string, ToolData>(tools.map((t) => [t.id, t]));
  const equipmentPackMap = new Map<string, EquipmentPackData>(
    equipmentPacks.map((p) => [p.id, p]),
  );
  const magicItemMap = new Map<string, MagicItemData>(magicItems.map((m) => [m.id, m]));
  const spellMap = new Map<string, SpellData>(spells.map((s) => [s.id, s]));
  const monsterMap = new Map<string, MonsterData>(monsters.map((m) => [m.id, m]));

  // Secondary Relational Indices
  const subracesByRaceId = new Map<string, SubraceData[]>();
  for (const sub of subraces) {
    const list = subracesByRaceId.get(sub.parentRaceId) ?? [];
    list.push(sub);
    subracesByRaceId.set(sub.parentRaceId, list);
  }

  const subclassesByClassId = new Map<string, SubclassData[]>();
  for (const sc of subclasses) {
    const list = subclassesByClassId.get(sc.classId) ?? [];
    list.push(sc);
    subclassesByClassId.set(sc.classId, list);
  }

  const baseFeaturesByClassId = new Map<string, FeatureData[]>();
  const featuresBySubclassId = new Map<string, FeatureData[]>();
  const featuresByGroup = new Map<string, FeatureData[]>();

  for (const feat of features) {
    if (feat.subclassId) {
      const list = featuresBySubclassId.get(feat.subclassId) ?? [];
      list.push(feat);
      featuresBySubclassId.set(feat.subclassId, list);
    } else if (!feat.featureGroup) {
      const list = baseFeaturesByClassId.get(feat.classId) ?? [];
      list.push(feat);
      baseFeaturesByClassId.set(feat.classId, list);
    }

    if (feat.featureGroup) {
      const groupList = featuresByGroup.get(feat.featureGroup) ?? [];
      groupList.push(feat);
      featuresByGroup.set(feat.featureGroup, groupList);
    }
  }

  for (const list of baseFeaturesByClassId.values()) {
    list.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  }
  for (const list of featuresBySubclassId.values()) {
    list.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  }
  for (const list of featuresByGroup.values()) {
    list.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  }

  const spellsByClassId = new Map<string, SpellData[]>();
  const spellEffectMetadataById = new Map<
    string,
    {
      damageTypes: Set<DamageType>;
      saveAbilities: Set<AbilityId>;
      hasAttackRoll: boolean;
    }
  >();

  for (const spell of spells) {
    spellEffectMetadataById.set(spell.id, collectSpellEffectMetadata(spell.effects));
    for (const clsId of spell.classes) {
      const list = spellsByClassId.get(clsId) ?? [];
      list.push(spell);
      spellsByClassId.set(clsId, list);
    }
  }
  for (const list of spellsByClassId.values()) {
    list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }

  const languagesByCategory = new Map<LanguageCategory, LanguageDefinition[]>();
  for (const lang of languages) {
    const list = languagesByCategory.get(lang.category) ?? [];
    list.push(lang);
    languagesByCategory.set(lang.category, list);
  }

  const proficienciesByCategory = new Map<ProficiencyCategory, ProficiencyDefinition[]>();
  for (const prof of proficiencies) {
    const list = proficienciesByCategory.get(prof.category) ?? [];
    list.push(prof);
    proficienciesByCategory.set(prof.category, list);
  }

  // Pre-build search strings per entity for fast filtering and ranked full-text search
  const raceSearchText = new Map<string, string>();
  for (const r of races) {
    const subNames = (subracesByRaceId.get(r.id) ?? []).map((s) => s.name).join(' ');
    const traitText = r.traits.map((t) => `${t.name} ${t.description}`).join(' ');
    raceSearchText.set(
      r.id,
      normalizeSearchText(`${r.id} ${r.name} ${r.size} ${r.description} ${traitText} ${subNames}`),
    );
  }

  const subraceSearchText = new Map<string, string>();
  for (const sr of subraces) {
    const traitText = sr.traits.map((t) => `${t.name} ${t.description}`).join(' ');
    subraceSearchText.set(
      sr.id,
      normalizeSearchText(`${sr.id} ${sr.name} ${sr.parentRaceId} ${sr.description} ${traitText}`),
    );
  }

  const classSearchText = new Map<string, string>();
  for (const c of classes) {
    const scNames = (subclassesByClassId.get(c.id) ?? []).map((s) => s.name).join(' ');
    classSearchText.set(
      c.id,
      normalizeSearchText(
        `${c.id} ${c.name} ${c.subclassTitle} ${scNames} ${c.description ?? ''}`,
      ),
    );
  }

  const subclassSearchText = new Map<string, string>();
  for (const sc of subclasses) {
    const featNames = (featuresBySubclassId.get(sc.id) ?? [])
      .map((f) => `${f.name} ${f.description}`)
      .join(' ');
    subclassSearchText.set(
      sc.id,
      normalizeSearchText(
        `${sc.id} ${sc.name} ${sc.classId} ${sc.subclassFlavor} ${sc.description} ${featNames}`,
      ),
    );
  }

  const featureSearchText = new Map<string, string>();
  for (const f of features) {
    featureSearchText.set(
      f.id,
      normalizeSearchText(
        `${f.id} ${f.name} ${f.classId} ${f.subclassId ?? ''} ${f.featureGroup ?? ''} ${f.description}`,
      ),
    );
  }

  const backgroundSearchText = new Map<string, string>();
  for (const b of backgrounds) {
    backgroundSearchText.set(
      b.id,
      normalizeSearchText(
        `${b.id} ${b.name} ${b.feature.name} ${b.feature.description} ${b.description}`,
      ),
    );
  }

  const featSearchText = new Map<string, string>();
  for (const f of feats) {
    featSearchText.set(f.id, normalizeSearchText(`${f.id} ${f.name} ${f.description}`));
  }

  const equipmentSearchText = new Map<string, string>();
  for (const e of equipment) {
    const extra =
      e.kind === 'weapon'
        ? `${e.category} ${e.rangeType} ${e.damageType} ${e.properties.join(' ')}`
        : e.kind === 'armor'
          ? `${e.category} armor`
          : e.kind === 'gear'
            ? e.category
            : e.kind === 'tool'
              ? e.category
              : 'pack';
    equipmentSearchText.set(
      e.id,
      normalizeSearchText(`${e.id} ${e.name} ${e.kind} ${extra} ${e.description ?? ''}`),
    );
  }

  const magicItemSearchText = new Map<string, string>();
  for (const m of magicItems) {
    magicItemSearchText.set(
      m.id,
      normalizeSearchText(`${m.id} ${m.name} ${m.category} ${m.rarity} ${m.description}`),
    );
  }

  const spellSearchText = new Map<string, string>();
  for (const s of spells) {
    const meta = spellEffectMetadataById.get(s.id);
    const dmgText = meta ? [...meta.damageTypes].join(' ') : '';
    spellSearchText.set(
      s.id,
      normalizeSearchText(
        `${s.id} ${s.name} ${s.school} ${s.classes.join(' ')} ${dmgText} ${s.description} ${s.higherLevelDescription ?? ''}`,
      ),
    );
  }

  const monsterSearchText = new Map<string, string>();
  for (const m of monsters) {
    const traitNames = m.traits.map((t) => t.name).join(' ');
    const actionNames = m.actions.map((a) => a.name).join(' ');
    monsterSearchText.set(
      m.id,
      normalizeSearchText(
        `${m.id} ${m.name} ${m.size} ${m.type} ${m.subtype ?? ''} ${m.alignment} ${m.aiArchetype} ${traitNames} ${actionNames} ${m.description ?? ''}`,
      ),
    );
  }

  // Unified search documents index
  const searchDocuments: SearchIndexDocument[] = [];
  const addSearchDoc = (
    id: string,
    name: string,
    kind: CompendiumEntityKind,
    subtitle: string,
    bodyLower: string,
    entity: CompendiumSearchResult['entity'],
  ): void => {
    const nameLower = normalizeSearchText(name);
    const nameTokens = nameLower.split(/\s+/).filter(Boolean);
    searchDocuments.push({
      id,
      name,
      nameLower,
      nameTokens,
      bodyLower,
      subtitle,
      kind,
      entity,
    });
  };

  for (const r of races) {
    addSearchDoc(
      r.id,
      r.name,
      'race',
      `${r.size} race (${r.speedFeet} ft)`,
      raceSearchText.get(r.id) ?? '',
      r,
    );
  }
  for (const sr of subraces) {
    addSearchDoc(
      sr.id,
      sr.name,
      'subrace',
      `Subrace of ${raceMap.get(sr.parentRaceId)?.name ?? sr.parentRaceId}`,
      subraceSearchText.get(sr.id) ?? '',
      sr,
    );
  }
  for (const c of classes) {
    addSearchTextDoc(c.id, c.name, 'class', `d${c.hitDie} Class`, classSearchText.get(c.id) ?? '', c);
  }
  function addSearchTextDoc(
    id: string,
    name: string,
    kind: CompendiumEntityKind,
    subtitle: string,
    bodyLower: string,
    entity: CompendiumSearchResult['entity'],
  ): void {
    addSearchDoc(id, name, kind, subtitle, bodyLower, entity);
  }
  for (const sc of subclasses) {
    addSearchDoc(
      sc.id,
      sc.name,
      'subclass',
      `${classMap.get(sc.classId)?.name ?? sc.classId} ${sc.subclassFlavor}`,
      subclassSearchText.get(sc.id) ?? '',
      sc,
    );
  }
  for (const f of features) {
    addSearchDoc(
      f.id,
      f.name,
      'feature',
      `Level ${f.level} ${f.classId} feature`,
      featureSearchText.get(f.id) ?? '',
      f,
    );
  }
  for (const b of backgrounds) {
    addSearchDoc(
      b.id,
      b.name,
      'background',
      'Background',
      backgroundSearchText.get(b.id) ?? '',
      b,
    );
  }
  for (const f of feats) {
    addSearchDoc(f.id, f.name, 'feat', 'Feat', featSearchText.get(f.id) ?? '', f);
  }
  for (const e of equipment) {
    const subtitle =
      e.kind === 'weapon'
        ? `${e.category} ${e.rangeType} weapon (${e.damageDice} ${e.damageType})`
        : e.kind === 'armor'
          ? `${e.category} armor (AC ${e.baseAc})`
          : e.kind === 'tool'
            ? `Tool (${e.category})`
            : e.kind === 'pack'
              ? 'Equipment pack'
              : `Adventuring gear (${e.category})`;
    addSearchDoc(e.id, e.name, 'equipment', subtitle, equipmentSearchText.get(e.id) ?? '', e);
  }
  for (const m of magicItems) {
    addSearchDoc(
      m.id,
      m.name,
      'magic_item',
      `${m.rarity} ${m.category}`,
      magicItemSearchText.get(m.id) ?? '',
      m,
    );
  }
  for (const s of spells) {
    const lvlLabel = s.level === 0 ? `${s.school} cantrip` : `Level ${s.level} ${s.school}`;
    addSearchDoc(s.id, s.name, 'spell', lvlLabel, spellSearchText.get(s.id) ?? '', s);
  }
  for (const m of monsters) {
    addSearchDoc(
      m.id,
      m.name,
      'monster',
      `${m.size} ${m.type} (CR ${m.challengeRating})`,
      monsterSearchText.get(m.id) ?? '',
      m,
    );
  }
  for (const cond of conditions) {
    addSearchDoc(
      cond.id,
      cond.name,
      'condition',
      'Condition',
      normalizeSearchText(`${cond.id} ${cond.name} ${cond.description} ${cond.bullets.join(' ')}`),
      cond,
    );
  }
  for (const sk of skills) {
    addSearchDoc(
      sk.id,
      sk.name,
      'skill',
      `${sk.ability.toUpperCase()} Skill`,
      normalizeSearchText(`${sk.id} ${sk.name} ${sk.ability} ${sk.description}`),
      sk,
    );
  }
  for (const ab of abilities) {
    addSearchDoc(
      ab.id,
      ab.name,
      'ability',
      `Ability Score (${ab.abbreviation})`,
      normalizeSearchText(`${ab.id} ${ab.name} ${ab.abbreviation} ${ab.description}`),
      ab,
    );
  }
  for (const dt of damageTypes) {
    addSearchDoc(
      dt.id,
      dt.name,
      'damage_type',
      'Damage Type',
      normalizeSearchText(`${dt.id} ${dt.name} ${dt.description}`),
      dt,
    );
  }
  for (const prof of proficiencies) {
    addSearchDoc(
      prof.id,
      prof.name,
      'proficiency',
      `Proficiency (${prof.category})`,
      normalizeSearchText(`${prof.id} ${prof.name} ${prof.category} ${prof.description ?? ''}`),
      prof,
    );
  }
  for (const lang of languages) {
    addSearchDoc(
      lang.id,
      lang.name,
      'language',
      `${lang.category} language`,
      normalizeSearchText(
        `${lang.id} ${lang.name} ${lang.category} ${lang.typicalSpeakers.join(' ')} ${lang.script ?? ''}`,
      ),
      lang,
    );
  }

  function requireEntity<T>(map: Map<string, T>, id: string, label: string): T {
    const found = map.get(id);
    if (!found) {
      throw new Error(`Unknown SRD 5.1 ${label} ID: "${id}"`);
    }
    return found;
  }

  function resolveEquipmentCategory(category: string): readonly EquipmentData[] {
    const normalized = category.trim().toLowerCase().replace(/-/g, '_');
    switch (normalized) {
      case 'simple_weapons':
      case 'simple_weapon':
        return weapons.filter((w) => w.category === 'simple');
      case 'martial_weapons':
      case 'martial_weapon':
        return weapons.filter((w) => w.category === 'martial');
      case 'simple_melee_weapons':
      case 'simple_melee_weapon':
      case 'simple_melee':
        return weapons.filter((w) => w.category === 'simple' && w.rangeType === 'melee');
      case 'simple_ranged_weapons':
      case 'simple_ranged_weapon':
      case 'simple_ranged':
        return weapons.filter((w) => w.category === 'simple' && w.rangeType === 'ranged');
      case 'martial_melee_weapons':
      case 'martial_melee_weapon':
      case 'martial_melee':
        return weapons.filter((w) => w.category === 'martial' && w.rangeType === 'melee');
      case 'martial_ranged_weapons':
      case 'martial_ranged_weapon':
      case 'martial_ranged':
        return weapons.filter((w) => w.category === 'martial' && w.rangeType === 'ranged');
      case 'light_armor':
        return armors.filter((a) => a.category === 'light');
      case 'medium_armor':
        return armors.filter((a) => a.category === 'medium');
      case 'heavy_armor':
        return armors.filter((a) => a.category === 'heavy');
      case 'shields':
      case 'shield':
        return armors.filter((a) => a.category === 'shield');
      case 'artisans_tools':
        return tools.filter((t) => t.category === 'artisans_tools');
      case 'gaming_sets':
      case 'gaming_set':
        return tools.filter((t) => t.category === 'gaming_set');
      case 'musical_instruments':
      case 'musical_instrument':
        return tools.filter((t) => t.category === 'musical_instrument');
      case 'thieves_tools':
        return tools.filter((t) => t.category === 'thieves_tools');
      case 'all_tools':
      case 'tools':
        return tools;
      case 'all_weapons':
      case 'weapons':
        return weapons;
      case 'all_armor':
      case 'armor':
        return armors;
      default: {
        const prof = proficiencyMap.get(category);
        if (prof?.equipmentIds) {
          return prof.equipmentIds
            .map((eqId) => equipmentMap.get(eqId))
            .filter((item): item is EquipmentData => item !== undefined);
        }
        return [];
      }
    }
  }

  function isProficientWithEquipment(
    proficiencyIds: Iterable<string>,
    equipmentId: string,
  ): boolean {
    const profSet = new Set(proficiencyIds);
    if (profSet.has(equipmentId)) {
      return true;
    }

    // Check proficiency definitions that list equipmentIds
    for (const profId of profSet) {
      const profDef = proficiencyMap.get(profId);
      if (profDef?.equipmentIds?.includes(equipmentId)) {
        return true;
      }
    }

    const eq = equipmentMap.get(equipmentId);
    if (!eq) return false;

    if (eq.kind === 'weapon') {
      if (eq.category === 'simple' && profSet.has('simple-weapons')) return true;
      if (eq.category === 'martial' && profSet.has('martial-weapons')) return true;
    } else if (eq.kind === 'armor') {
      if (eq.category === 'light' && profSet.has('light-armor')) return true;
      if (eq.category === 'medium' && profSet.has('medium-armor')) return true;
      if (eq.category === 'heavy' && profSet.has('heavy-armor')) return true;
      if (eq.category === 'shield' && profSet.has('shields')) return true;
    } else if (eq.kind === 'tool') {
      if (eq.category === 'artisans_tools' && profSet.has('artisans-tools')) return true;
      if (eq.category === 'gaming_set' && profSet.has('gaming-sets')) return true;
      if (eq.category === 'musical_instrument' && profSet.has('musical-instruments')) return true;
    }

    return false;
  }

  function filterSpells(filter?: SpellFilter): readonly SpellData[] {
    if (!filter) return spells;
    const queryTokens = tokenizeQuery(filter.query);
    const levelSet = toSet(filter.level);
    const schoolSet = toSet(filter.school);
    const classSet = toSet(filter.classId);
    const subclassSet = toSet(filter.subclassId);
    const castingTimeSet = toSet(filter.castingTime);
    const damageTypeSet = toSet(filter.damageType);
    const saveAbilitySet = toSet(filter.savingThrowAbility);
    const aoeShapeSet = toSet(filter.aoeShape);

    return spells.filter((spell) => {
      if (levelSet && !levelSet.has(spell.level)) return false;
      if (filter.minLevel !== undefined && spell.level < filter.minLevel) return false;
      if (filter.maxLevel !== undefined && spell.level > filter.maxLevel) return false;
      if (schoolSet && !schoolSet.has(spell.school)) return false;
      if (classSet && !spell.classes.some((c) => classSet.has(c))) return false;
      if (subclassSet && !(spell.subclasses ?? []).some((sc) => subclassSet.has(sc))) return false;
      if (castingTimeSet && !castingTimeSet.has(spell.castingTime)) return false;
      if (filter.ritual !== undefined && spell.ritual !== filter.ritual) return false;
      if (filter.concentration !== undefined && spell.concentration !== filter.concentration) {
        return false;
      }
      if (filter.verbal !== undefined && spell.components.verbal !== filter.verbal) return false;
      if (filter.somatic !== undefined && spell.components.somatic !== filter.somatic) return false;
      if (filter.material !== undefined && spell.components.material !== filter.material) {
        return false;
      }
      if (aoeShapeSet) {
        const shape = spell.targeting.aoe?.shape;
        if (!shape || !aoeShapeSet.has(shape)) return false;
      }

      const meta = spellEffectMetadataById.get(spell.id);
      if (damageTypeSet) {
        if (!meta || ![...damageTypeSet].some((dt) => meta.damageTypes.has(dt))) return false;
      }
      if (saveAbilitySet) {
        if (!meta || ![...saveAbilitySet].some((ab) => meta.saveAbilities.has(ab))) return false;
      }
      if (filter.hasAttackRoll !== undefined) {
        const hasAttack = meta?.hasAttackRoll ?? false;
        if (hasAttack !== filter.hasAttackRoll) return false;
      }

      if (queryTokens.length > 0) {
        const haystack = spellSearchText.get(spell.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }

      return true;
    });
  }

  function resolveChoiceOptions(choice: ChoiceSpec): readonly string[] {
    switch (choice.type) {
      case 'skill':
      case 'language':
      case 'tool':
      case 'proficiency': {
        if (choice.from.mode === 'explicit') {
          return choice.from.options;
        }
        const cat = choice.from.category.trim().toLowerCase().replace(/-/g, '_');
        if (cat === 'all_skills' || cat === 'skills') {
          return SKILL_IDS;
        }
        if (cat === 'all_languages' || cat === 'languages') {
          return languages.map((l) => l.id);
        }
        if (cat === 'standard_languages') {
          return (languagesByCategory.get('standard') ?? []).map((l) => l.id);
        }
        if (cat === 'exotic_languages') {
          return (languagesByCategory.get('exotic') ?? []).map((l) => l.id);
        }
        return resolveEquipmentCategory(cat).map((eq) => eq.id);
      }
      case 'ability_score_bonus': {
        const excluded = new Set(choice.excludeAbilities ?? []);
        return ABILITY_IDS.filter((ab) => !excluded.has(ab));
      }
      case 'spell': {
        return filterSpells({
          classId: choice.classList,
          maxLevel: choice.maxSpellLevel as SpellLevel,
          ...(choice.schoolRestriction ? { school: choice.schoolRestriction } : {}),
        }).map((s) => s.id);
      }
      case 'feature_option':
        return choice.options;
      case 'equipment_bundle':
        return choice.options.map((branch) => branch.id);
    }
  }

  function filterRaces(filter?: RaceFilter): readonly RaceData[] {
    if (!filter) return races;
    const queryTokens = tokenizeQuery(filter.query);
    const sizeSet = toSet(filter.size);
    const abilitySet = toSet(filter.abilityBonus);

    return races.filter((race) => {
      if (sizeSet && !sizeSet.has(race.size)) return false;
      if (filter.hasSubraces !== undefined) {
        const hasSub = race.subraceIds.length > 0;
        if (hasSub !== filter.hasSubraces) return false;
      }
      if (filter.hasDarkvision !== undefined) {
        const hasDark = (race.senses.darkvisionFeet ?? 0) > 0;
        if (hasDark !== filter.hasDarkvision) return false;
      }
      if (filter.languageId !== undefined && !race.languages.includes(filter.languageId)) {
        return false;
      }
      if (abilitySet) {
        const grantsBonus = [...abilitySet].some((ab) => (race.abilityBonuses[ab] ?? 0) > 0);
        if (!grantsBonus) return false;
      }
      if (queryTokens.length > 0) {
        const haystack = raceSearchText.get(race.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterSubraces(filter?: SubraceFilter): readonly SubraceData[] {
    if (!filter) return subraces;
    const queryTokens = tokenizeQuery(filter.query);
    const parentSet = toSet(filter.parentRaceId);
    const abilitySet = toSet(filter.abilityBonus);

    return subraces.filter((sub) => {
      if (parentSet && !parentSet.has(sub.parentRaceId)) return false;
      if (filter.hasDarkvision !== undefined) {
        const parentDark = raceMap.get(sub.parentRaceId)?.senses.darkvisionFeet ?? 0;
        const subDark = sub.senses?.darkvisionFeet ?? parentDark;
        if (subDark > 0 !== filter.hasDarkvision) return false;
      }
      if (abilitySet) {
        const grantsBonus = [...abilitySet].some((ab) => (sub.abilityBonuses[ab] ?? 0) > 0);
        if (!grantsBonus) return false;
      }
      if (queryTokens.length > 0) {
        const haystack = subraceSearchText.get(sub.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterClasses(filter?: ClassFilter): readonly ClassData[] {
    if (!filter) return classes;
    const queryTokens = tokenizeQuery(filter.query);
    const hitDieSet = toSet(filter.hitDie);
    const primaryAbSet = toSet(filter.primaryAbility);
    const saveAbSet = toSet(filter.savingThrowProficiency);
    const spellAbSet = toSet(filter.spellcastingAbility);
    const spellProgSet = toSet(filter.spellcastingProgression);
    const prepModeSet = toSet(filter.preparationMode);

    return classes.filter((cls) => {
      if (hitDieSet && !hitDieSet.has(cls.hitDie)) return false;
      if (primaryAbSet && !cls.primaryAbilities.some((ab) => primaryAbSet.has(ab))) return false;
      if (saveAbSet && !cls.savingThrowProficiencies.some((ab) => saveAbSet.has(ab))) return false;
      if (filter.isSpellcaster !== undefined) {
        const isCaster = cls.spellcasting !== undefined;
        if (isCaster !== filter.isSpellcaster) return false;
      }
      if (spellAbSet) {
        if (!cls.spellcasting || !spellAbSet.has(cls.spellcasting.ability)) return false;
      }
      if (spellProgSet) {
        if (!cls.spellcasting || !spellProgSet.has(cls.spellcasting.progression)) return false;
      }
      if (prepModeSet) {
        if (!cls.spellcasting || !prepModeSet.has(cls.spellcasting.preparationMode)) return false;
      }
      if (queryTokens.length > 0) {
        const haystack = classSearchText.get(cls.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterSubclasses(filter?: SubclassFilter): readonly SubclassData[] {
    if (!filter) return subclasses;
    const queryTokens = tokenizeQuery(filter.query);
    const classSet = toSet(filter.classId);

    return subclasses.filter((sc) => {
      if (classSet && !classSet.has(sc.classId)) return false;
      if (queryTokens.length > 0) {
        const haystack = subclassSearchText.get(sc.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterFeatures(filter?: FeatureFilter): readonly FeatureData[] {
    if (!filter) return features;
    const queryTokens = tokenizeQuery(filter.query);
    const classSet = toSet(filter.classId);
    const subclassSet = toSet(filter.subclassId);
    const levelSet = toSet(filter.level);
    const groupSet = toSet(filter.featureGroup);

    return features.filter((feat) => {
      if (classSet && !classSet.has(feat.classId)) return false;
      if (subclassSet && (!feat.subclassId || !subclassSet.has(feat.subclassId))) return false;
      if (filter.includeSubclassFeatures === false && feat.subclassId !== undefined) return false;
      if (levelSet && !levelSet.has(feat.level)) return false;
      if (filter.minLevel !== undefined && feat.level < filter.minLevel) return false;
      if (filter.maxLevel !== undefined && feat.level > filter.maxLevel) return false;
      if (groupSet && (!feat.featureGroup || !groupSet.has(feat.featureGroup))) return false;
      if (queryTokens.length > 0) {
        const haystack = featureSearchText.get(feat.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterBackgrounds(filter?: BackgroundFilter): readonly BackgroundData[] {
    if (!filter) return backgrounds;
    const queryTokens = tokenizeQuery(filter.query);
    const skillSet = toSet(filter.skillProficiency);

    return backgrounds.filter((bg) => {
      if (skillSet && !bg.skillProficiencies.some((sk) => skillSet.has(sk))) return false;
      if (queryTokens.length > 0) {
        const haystack = backgroundSearchText.get(bg.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterFeats(filter?: FeatFilter): readonly FeatData[] {
    if (!filter) return feats;
    const queryTokens = tokenizeQuery(filter.query);

    return feats.filter((feat) => {
      if (filter.hasPrerequisites !== undefined) {
        const hasPrereq = feat.prerequisites.length > 0;
        if (hasPrereq !== filter.hasPrerequisites) return false;
      }
      if (queryTokens.length > 0) {
        const haystack = featSearchText.get(feat.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterEquipment(filter?: EquipmentFilter): readonly EquipmentData[] {
    if (!filter) return equipment;
    const queryTokens = tokenizeQuery(filter.query);
    const kindSet = toSet(filter.kind);
    const weaponCatSet = toSet(filter.weaponCategory);
    const weaponRangeSet = toSet(filter.weaponRangeType);
    const weaponPropSet = toSet(filter.weaponProperty);
    const damageTypeSet = toSet(filter.damageType);
    const armorCatSet = toSet(filter.armorCategory);
    const gearCatSet = toSet(filter.gearCategory);
    const toolCatSet = toSet(filter.toolCategory);

    return equipment.filter((item) => {
      if (kindSet && !kindSet.has(item.kind)) return false;
      if (filter.minCostCopper !== undefined && item.costCopper < filter.minCostCopper) {
        return false;
      }
      if (filter.maxCostCopper !== undefined && item.costCopper > filter.maxCostCopper) {
        return false;
      }
      if (filter.maxWeightLb !== undefined && item.weightLb > filter.maxWeightLb) {
        return false;
      }

      if (weaponCatSet || weaponRangeSet || weaponPropSet || damageTypeSet) {
        if (item.kind !== 'weapon') return false;
        if (weaponCatSet && !weaponCatSet.has(item.category)) return false;
        if (weaponRangeSet && !weaponRangeSet.has(item.rangeType)) return false;
        if (damageTypeSet && !damageTypeSet.has(item.damageType)) return false;
        if (weaponPropSet && ![...weaponPropSet].every((p) => item.properties.includes(p))) {
          return false;
        }
      }

      if (armorCatSet || filter.stealthDisadvantage !== undefined) {
        if (item.kind !== 'armor') return false;
        if (armorCatSet && !armorCatSet.has(item.category)) return false;
        if (
          filter.stealthDisadvantage !== undefined &&
          item.stealthDisadvantage !== filter.stealthDisadvantage
        ) {
          return false;
        }
      }

      if (gearCatSet) {
        if (item.kind !== 'gear' || !gearCatSet.has(item.category)) return false;
      }

      if (toolCatSet) {
        if (item.kind !== 'tool' || !toolCatSet.has(item.category)) return false;
      }

      if (queryTokens.length > 0) {
        const haystack = equipmentSearchText.get(item.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }

      return true;
    });
  }

  function filterWeapons(filter?: WeaponFilter): readonly WeaponData[] {
    if (!filter) return weapons;
    return filterEquipment({
      query: filter.query,
      kind: 'weapon',
      weaponCategory: filter.category,
      weaponRangeType: filter.rangeType,
      weaponProperty: filter.property,
      damageType: filter.damageType,
      minCostCopper: filter.minCostCopper,
      maxCostCopper: filter.maxCostCopper,
      maxWeightLb: filter.maxWeightLb,
    }) as readonly WeaponData[];
  }

  function filterArmors(filter?: ArmorFilter): readonly ArmorData[] {
    if (!filter) return armors;
    const queryTokens = tokenizeQuery(filter.query);
    const catSet = toSet(filter.category);

    return armors.filter((armor) => {
      if (catSet && !catSet.has(armor.category)) return false;
      if (filter.minBaseAc !== undefined && armor.baseAc < filter.minBaseAc) return false;
      if (filter.maxCostCopper !== undefined && armor.costCopper > filter.maxCostCopper) {
        return false;
      }
      if (
        filter.maxStrengthRequirement !== undefined &&
        (armor.strengthRequirement ?? 0) > filter.maxStrengthRequirement
      ) {
        return false;
      }
      if (
        filter.stealthDisadvantage !== undefined &&
        armor.stealthDisadvantage !== filter.stealthDisadvantage
      ) {
        return false;
      }
      if (queryTokens.length > 0) {
        const haystack = equipmentSearchText.get(armor.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterMagicItems(filter?: MagicItemFilter): readonly MagicItemData[] {
    if (!filter) return magicItems;
    const queryTokens = tokenizeQuery(filter.query);
    const catSet = toSet(filter.category);
    const raritySet = toSet(filter.rarity);

    return magicItems.filter((item) => {
      if (catSet && !catSet.has(item.category)) return false;
      if (raritySet && !raritySet.has(item.rarity)) return false;
      if (
        filter.requiresAttunement !== undefined &&
        item.requiresAttunement !== filter.requiresAttunement
      ) {
        return false;
      }
      if (
        filter.baseEquipmentId !== undefined &&
        item.baseEquipmentId !== filter.baseEquipmentId
      ) {
        return false;
      }
      if (queryTokens.length > 0) {
        const haystack = magicItemSearchText.get(item.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function filterMonsters(filter?: MonsterFilter): readonly MonsterData[] {
    if (!filter) return monsters;
    const queryTokens = tokenizeQuery(filter.query);
    const sizeSet = toSet(filter.size);
    const typeSet = toSet(filter.type);
    const crSet = toSet(filter.challengeRating);
    const archetypeSet = toSet(filter.aiArchetype);
    const moveModeSet = toSet(filter.movementMode);
    const dmgImmuneSet = toSet(filter.damageImmunity);
    const condImmuneSet = toSet(filter.conditionImmunity);

    return monsters.filter((monster) => {
      if (sizeSet && !sizeSet.has(monster.size)) return false;
      if (typeSet && !typeSet.has(monster.type)) return false;
      if (crSet && !crSet.has(monster.challengeRating)) return false;
      if (filter.minCr !== undefined && monster.challengeRating < filter.minCr) return false;
      if (filter.maxCr !== undefined && monster.challengeRating > filter.maxCr) return false;
      if (archetypeSet && !archetypeSet.has(monster.aiArchetype)) return false;
      if (filter.hasSpellcasting !== undefined) {
        const hasCast =
          monster.spellcasting !== undefined ||
          monster.traits.some((t) => t.spellcasting !== undefined);
        if (hasCast !== filter.hasSpellcasting) return false;
      }
      if (filter.hasLegendaryActions !== undefined) {
        const hasLeg = monster.legendaryActions !== undefined;
        if (hasLeg !== filter.hasLegendaryActions) return false;
      }
      if (moveModeSet) {
        for (const mode of moveModeSet) {
          if ((monster.speed[mode] ?? 0) <= 0) return false;
        }
      }
      if (dmgImmuneSet) {
        if (![...dmgImmuneSet].every((dt) => monster.damageImmunities.includes(dt))) return false;
      }
      if (condImmuneSet) {
        if (![...condImmuneSet].every((c) => monster.conditionImmunities.includes(c))) {
          return false;
        }
      }
      if (queryTokens.length > 0) {
        const haystack = monsterSearchText.get(monster.id) ?? '';
        if (!matchesSearchTokens(haystack, queryTokens)) return false;
      }
      return true;
    });
  }

  function searchCompendium(
    query: string,
    options?: CompendiumSearchOptions,
  ): readonly CompendiumSearchResult[] {
    const kindSet = toSet(options?.kinds);
    const limit = options?.limit;
    const rawTrimmed = query.trim().toLowerCase();
    const queryNorm = normalizeSearchText(query);
    const queryTokens = tokenizeQuery(query);

    const results: CompendiumSearchResult[] = [];

    for (const doc of searchDocuments) {
      if (kindSet && !kindSet.has(doc.kind)) continue;

      if (queryTokens.length === 0) {
        results.push({
          id: doc.id,
          name: doc.name,
          kind: doc.kind,
          subtitle: doc.subtitle,
          score: 1,
          entity: doc.entity,
        });
        continue;
      }

      if (!matchesSearchTokens(doc.bodyLower, queryTokens)) {
        continue;
      }

      // Compute relevance score
      let score = 10;
      if (doc.id === rawTrimmed || doc.nameLower === queryNorm) {
        score = 100;
      } else if (doc.nameLower.startsWith(queryNorm)) {
        score = 80;
      } else if (doc.nameTokens.some((tok) => tok === queryNorm)) {
        score = 70;
      } else if (doc.nameLower.includes(queryNorm)) {
        score = 60;
      } else if (queryTokens.every((qt) => doc.nameLower.includes(qt))) {
        score = 50;
      } else if (queryTokens.some((qt) => doc.nameLower.includes(qt))) {
        score = 30;
      }

      results.push({
        id: doc.id,
        name: doc.name,
        kind: doc.kind,
        subtitle: doc.subtitle,
        score,
        entity: doc.entity,
      });
    }

    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return limit !== undefined ? results.slice(0, limit) : results;
  }

  return {
    dataset,
    abilities,
    skills,
    conditions,
    damageTypes,
    proficiencies,
    languages,
    races,
    subraces,
    classes,
    subclasses,
    features,
    backgrounds,
    feats,
    equipment,
    weapons,
    armors,
    gear,
    tools,
    equipmentPacks,
    magicItems,
    spells,
    monsters,

    getAbility: (id) => abilityMap.get(id),
    getSkill: (id) => skillMap.get(id),
    getCondition: (id) => conditionMap.get(id),
    getDamageType: (id) => damageTypeMap.get(id),
    getProficiency: (id) => proficiencyMap.get(id),
    getLanguage: (id) => languageMap.get(id),
    getRace: (id) => raceMap.get(id),
    getSubrace: (id) => subraceMap.get(id),
    getClass: (id) => classMap.get(id),
    getSubclass: (id) => subclassMap.get(id),
    getFeature: (id) => featureMap.get(id),
    getBackground: (id) => backgroundMap.get(id),
    getFeat: (id) => featMap.get(id),
    getEquipment: (id) => equipmentMap.get(id),
    getWeapon: (id) => weaponMap.get(id),
    getArmor: (id) => armorMap.get(id),
    getGear: (id) => gearMap.get(id),
    getTool: (id) => toolMap.get(id),
    getEquipmentPack: (id) => equipmentPackMap.get(id),
    getMagicItem: (id) => magicItemMap.get(id),
    getSpell: (id) => spellMap.get(id),
    getMonster: (id) => monsterMap.get(id),

    requireAbility: (id) => requireEntity(abilityMap, id, 'ability'),
    requireSkill: (id) => requireEntity(skillMap, id, 'skill'),
    requireCondition: (id) => requireEntity(conditionMap, id, 'condition'),
    requireDamageType: (id) => requireEntity(damageTypeMap, id, 'damage type'),
    requireProficiency: (id) => requireEntity(proficiencyMap, id, 'proficiency'),
    requireLanguage: (id) => requireEntity(languageMap, id, 'language'),
    requireRace: (id) => requireEntity(raceMap, id, 'race'),
    requireSubrace: (id) => requireEntity(subraceMap, id, 'subrace'),
    requireClass: (id) => requireEntity(classMap, id, 'class'),
    requireSubclass: (id) => requireEntity(subclassMap, id, 'subclass'),
    requireFeature: (id) => requireEntity(featureMap, id, 'feature'),
    requireBackground: (id) => requireEntity(backgroundMap, id, 'background'),
    requireFeat: (id) => requireEntity(featMap, id, 'feat'),
    requireEquipment: (id) => requireEntity(equipmentMap, id, 'equipment'),
    requireWeapon: (id) => requireEntity(weaponMap, id, 'weapon'),
    requireArmor: (id) => requireEntity(armorMap, id, 'armor'),
    requireGear: (id) => requireEntity(gearMap, id, 'gear'),
    requireTool: (id) => requireEntity(toolMap, id, 'tool'),
    requireEquipmentPack: (id) => requireEntity(equipmentPackMap, id, 'equipment pack'),
    requireMagicItem: (id) => requireEntity(magicItemMap, id, 'magic item'),
    requireSpell: (id) => requireEntity(spellMap, id, 'spell'),
    requireMonster: (id) => requireEntity(monsterMap, id, 'monster'),

    getSubracesForRace: (raceId) => subracesByRaceId.get(raceId) ?? [],
    getSubclassesForClass: (classId) => subclassesByClassId.get(classId) ?? [],
    getFeaturesForClass: (classId, maxLevel) => {
      const list = baseFeaturesByClassId.get(classId) ?? [];
      return maxLevel !== undefined ? list.filter((f) => f.level <= maxLevel) : list;
    },
    getFeaturesForSubclass: (subclassId, maxLevel) => {
      const list = featuresBySubclassId.get(subclassId) ?? [];
      return maxLevel !== undefined ? list.filter((f) => f.level <= maxLevel) : list;
    },
    getFeaturesByGroup: (featureGroup) => featuresByGroup.get(featureGroup) ?? [],
    getSpellsForClass: (classId, filter) => {
      if (!filter) {
        return spellsByClassId.get(classId) ?? [];
      }
      return filterSpells({ ...filter, classId });
    },
    getSpellsForSubclass: (subclassId, maxClassLevel) => {
      const sc = subclassMap.get(subclassId);
      if (!sc?.spells) return [];
      const spellIds = new Set<string>();
      for (const grant of sc.spells) {
        if (maxClassLevel !== undefined && grant.classLevel > maxClassLevel) continue;
        for (const id of grant.spellIds) {
          spellIds.add(id);
        }
      }
      return [...spellIds]
        .map((id) => spellMap.get(id))
        .filter((s): s is SpellData => s !== undefined)
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    },
    getLanguagesByCategory: (category) => languagesByCategory.get(category) ?? [],
    getProficienciesByCategory: (category) => proficienciesByCategory.get(category) ?? [],
    isProficientWithEquipment,
    resolveEquipmentCategory,
    resolveChoiceOptions,

    filterRaces,
    filterSubraces,
    filterClasses,
    filterSubclasses,
    filterFeatures,
    filterBackgrounds,
    filterFeats,
    filterEquipment,
    filterWeapons,
    filterArmors,
    filterMagicItems,
    filterSpells,
    filterMonsters,
    searchCompendium,
  };
}

/**
 * Default pre-indexed SRD 5.1 Compendium singleton backed by `BUNDLED_SRD_DATASET`.
 */
export const defaultCompendium: SrdCompendium = createCompendium(BUNDLED_SRD_DATASET);

/**
 * Alias for `defaultCompendium`.
 */
export const compendium: SrdCompendium = defaultCompendium;

// Top-level convenience lookup functions bound to `defaultCompendium`
export const getAbility = (id: AbilityId | string): AbilityScoreDefinition | undefined =>
  defaultCompendium.getAbility(id);
export const getSkill = (id: SkillId | string): SkillDefinition | undefined =>
  defaultCompendium.getSkill(id);
export const getCondition = (id: ConditionId | string): ConditionDefinition | undefined =>
  defaultCompendium.getCondition(id);
export const getDamageType = (id: DamageType | string): DamageTypeDefinition | undefined =>
  defaultCompendium.getDamageType(id);
export const getProficiency = (id: string): ProficiencyDefinition | undefined =>
  defaultCompendium.getProficiency(id);
export const getLanguage = (id: string): LanguageDefinition | undefined =>
  defaultCompendium.getLanguage(id);
export const getRace = (id: string): RaceData | undefined => defaultCompendium.getRace(id);
export const getSubrace = (id: string): SubraceData | undefined =>
  defaultCompendium.getSubrace(id);
export const getClass = (id: string): ClassData | undefined => defaultCompendium.getClass(id);
export const getSubclass = (id: string): SubclassData | undefined =>
  defaultCompendium.getSubclass(id);
export const getFeature = (id: string): FeatureData | undefined =>
  defaultCompendium.getFeature(id);
export const getBackground = (id: string): BackgroundData | undefined =>
  defaultCompendium.getBackground(id);
export const getFeat = (id: string): FeatData | undefined => defaultCompendium.getFeat(id);
export const getEquipment = (id: string): EquipmentData | undefined =>
  defaultCompendium.getEquipment(id);
export const getWeapon = (id: string): WeaponData | undefined => defaultCompendium.getWeapon(id);
export const getArmor = (id: string): ArmorData | undefined => defaultCompendium.getArmor(id);
export const getGear = (id: string): GearData | undefined => defaultCompendium.getGear(id);
export const getTool = (id: string): ToolData | undefined => defaultCompendium.getTool(id);
export const getEquipmentPack = (id: string): EquipmentPackData | undefined =>
  defaultCompendium.getEquipmentPack(id);
export const getMagicItem = (id: string): MagicItemData | undefined =>
  defaultCompendium.getMagicItem(id);
export const getSpell = (id: string): SpellData | undefined => defaultCompendium.getSpell(id);
export const getMonster = (id: string): MonsterData | undefined =>
  defaultCompendium.getMonster(id);

export const filterRaces = (filter?: RaceFilter): readonly RaceData[] =>
  defaultCompendium.filterRaces(filter);
export const filterSubraces = (filter?: SubraceFilter): readonly SubraceData[] =>
  defaultCompendium.filterSubraces(filter);
export const filterClasses = (filter?: ClassFilter): readonly ClassData[] =>
  defaultCompendium.filterClasses(filter);
export const filterSubclasses = (filter?: SubclassFilter): readonly SubclassData[] =>
  defaultCompendium.filterSubclasses(filter);
export const filterFeatures = (filter?: FeatureFilter): readonly FeatureData[] =>
  defaultCompendium.filterFeatures(filter);
export const filterBackgrounds = (filter?: BackgroundFilter): readonly BackgroundData[] =>
  defaultCompendium.filterBackgrounds(filter);
export const filterFeats = (filter?: FeatFilter): readonly FeatData[] =>
  defaultCompendium.filterFeats(filter);
export const filterEquipment = (filter?: EquipmentFilter): readonly EquipmentData[] =>
  defaultCompendium.filterEquipment(filter);
export const filterWeapons = (filter?: WeaponFilter): readonly WeaponData[] =>
  defaultCompendium.filterWeapons(filter);
export const filterArmors = (filter?: ArmorFilter): readonly ArmorData[] =>
  defaultCompendium.filterArmors(filter);
export const filterMagicItems = (filter?: MagicItemFilter): readonly MagicItemData[] =>
  defaultCompendium.filterMagicItems(filter);
export const filterSpells = (filter?: SpellFilter): readonly SpellData[] =>
  defaultCompendium.filterSpells(filter);
export const filterMonsters = (filter?: MonsterFilter): readonly MonsterData[] =>
  defaultCompendium.filterMonsters(filter);
export const searchCompendium = (
  query: string,
  options?: CompendiumSearchOptions,
): readonly CompendiumSearchResult[] => defaultCompendium.searchCompendium(query, options);
