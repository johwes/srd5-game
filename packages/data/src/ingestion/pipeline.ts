import {
  type AbilitiesAndSkillsFile,
  AbilitiesAndSkillsFileSchema,
  type BackgroundData,
  BackgroundSchema,
  type ClassData,
  ClassSchema,
  type ConditionDefinition,
  ConditionDefinitionSchema,
  type DamageTypeDefinition,
  DamageTypeDefinitionSchema,
  type EquipmentData,
  type FeatData,
  type FeatureData,
  type MagicItemData,
  type MonsterData,
  type ProficienciesAndLanguagesFile,
  ProficienciesAndLanguagesFileSchema,
  type RaceData,
  type SpellData,
  type SubclassData,
  SubclassSchema,
  type SubraceData,
} from '../schemas/index.js';
import { DEFAULT_SRD_OVERLAY_BUNDLE } from '../overlays/index.js';
import {
  ALLOWED_SRD_BACKGROUND_IDS,
  ALLOWED_SRD_CLASS_IDS,
  ALLOWED_SRD_FEAT_IDS,
  ALLOWED_SRD_RACE_IDS,
  ALLOWED_SRD_SUBCLASS_IDS,
  ALLOWED_SRD_SUBRACE_IDS,
  isProhibitedMonsterId,
} from './allowlist.js';
import { canonicalizeSpellIdentity } from './normalize.js';
import {
  applyEquipmentOverlays,
  applyFeatOverlays,
  applyFeatureOverlays,
  applyMagicItemOverlays,
  applyMonsterOverlays,
  applyRaceOverlays,
  applySpellOverlays,
  applySubraceOverlays,
  type SrdOverlayBundle,
} from './overlay.js';

/**
 * Input collections for the SRD 5.1 ingestion and overlay pipeline.
 */
export interface SrdIngestionInput {
  abilitiesAndSkills: AbilitiesAndSkillsFile;
  conditions: readonly ConditionDefinition[];
  damageTypes: readonly DamageTypeDefinition[];
  proficienciesAndLanguages: ProficienciesAndLanguagesFile;
  races: readonly RaceData[];
  subraces: readonly SubraceData[];
  classes: readonly ClassData[];
  subclasses: readonly SubclassData[];
  features: readonly FeatureData[];
  backgrounds: readonly BackgroundData[];
  feats: readonly FeatData[];
  equipment: readonly EquipmentData[];
  magicItems: readonly MagicItemData[];
  spells: readonly SpellData[];
  monsters: readonly MonsterData[];
}

/**
 * Output of the SRD 5.1 ingestion, normalization, and overlay pipeline.
 */
export interface NormalizedSrdDataset {
  abilitiesAndSkills: AbilitiesAndSkillsFile;
  conditions: ConditionDefinition[];
  damageTypes: DamageTypeDefinition[];
  proficienciesAndLanguages: ProficienciesAndLanguagesFile;
  races: RaceData[];
  subraces: SubraceData[];
  classes: ClassData[];
  subclasses: SubclassData[];
  features: FeatureData[];
  backgrounds: BackgroundData[];
  feats: FeatData[];
  equipment: EquipmentData[];
  magicItems: MagicItemData[];
  spells: SpellData[];
  monsters: MonsterData[];
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Runs the SRD 5.1 normalization, Product Identity allowlist/blocklist verification,
 * Effect DSL overlay enrichment, and Zod schema validation across all collections.
 */
export function runSrdIngestionPipeline(
  input: SrdIngestionInput,
  overlays: SrdOverlayBundle = DEFAULT_SRD_OVERLAY_BUNDLE,
): NormalizedSrdDataset {
  const abilitiesAndSkills = AbilitiesAndSkillsFileSchema.parse(input.abilitiesAndSkills);

  const conditions = sortById(
    input.conditions.map((c) => ConditionDefinitionSchema.parse(c)),
  );

  const damageTypes = sortById(
    input.damageTypes.map((d) => DamageTypeDefinitionSchema.parse(d)),
  );

  const proficienciesAndLanguages = ProficienciesAndLanguagesFileSchema.parse({
    proficiencies: sortById(input.proficienciesAndLanguages.proficiencies),
    languages: sortById(input.proficienciesAndLanguages.languages),
  });

  // Verify Races against SRD 5.1 allowlist
  for (const race of input.races) {
    if (!ALLOWED_SRD_RACE_IDS.has(race.id)) {
      throw new Error(`Non-SRD Race ID rejected by ingestion pipeline: "${race.id}"`);
    }
  }
  const races = sortById(applyRaceOverlays(input.races, overlays.races ?? {}));

  // Verify Subraces against SRD 5.1 allowlist
  for (const subrace of input.subraces) {
    if (!ALLOWED_SRD_SUBRACE_IDS.has(subrace.id)) {
      throw new Error(`Non-SRD Subrace ID rejected by ingestion pipeline: "${subrace.id}"`);
    }
  }
  const subraces = sortById(applySubraceOverlays(input.subraces, overlays.subraces ?? {}));

  // Verify Classes against SRD 5.1 allowlist
  for (const cls of input.classes) {
    if (!ALLOWED_SRD_CLASS_IDS.has(cls.id)) {
      throw new Error(`Non-SRD Class ID rejected by ingestion pipeline: "${cls.id}"`);
    }
  }
  const classes = sortById(input.classes.map((c) => ClassSchema.parse(c)));

  // Verify Subclasses against SRD 5.1 allowlist
  for (const sc of input.subclasses) {
    if (!ALLOWED_SRD_SUBCLASS_IDS.has(sc.id)) {
      throw new Error(`Non-SRD Subclass ID rejected by ingestion pipeline: "${sc.id}"`);
    }
  }
  const subclasses = sortById(input.subclasses.map((sc) => SubclassSchema.parse(sc)));

  // Apply Feature overlays
  const features = sortById(applyFeatureOverlays(input.features, overlays.features ?? {}));

  // Verify Backgrounds against SRD 5.1 allowlist
  for (const bg of input.backgrounds) {
    if (!ALLOWED_SRD_BACKGROUND_IDS.has(bg.id)) {
      throw new Error(`Non-SRD Background ID rejected by ingestion pipeline: "${bg.id}"`);
    }
  }
  const backgrounds = sortById(input.backgrounds.map((bg) => BackgroundSchema.parse(bg)));

  // Verify Feats against SRD 5.1 allowlist & apply overlays
  for (const feat of input.feats) {
    if (!ALLOWED_SRD_FEAT_IDS.has(feat.id)) {
      throw new Error(`Non-SRD Feat ID rejected by ingestion pipeline: "${feat.id}"`);
    }
  }
  const feats = sortById(applyFeatOverlays(input.feats, overlays.feats ?? {}));

  // Apply Equipment & Magic Item overlays
  const equipment = sortById(applyEquipmentOverlays(input.equipment, overlays.gear ?? {}));
  const magicItems = sortById(
    applyMagicItemOverlays(input.magicItems, overlays.magicItems ?? {}),
  );

  // Canonicalize Spells (converting PHB wizard names to SRD open-content names and rejecting Product Identity)
  const canonicalSpells: SpellData[] = input.spells.map((spell) => {
    const identity = canonicalizeSpellIdentity(spell.id, spell.name);
    return {
      ...spell,
      id: identity.id,
      name: identity.name,
    };
  });
  const spells = sortById(applySpellOverlays(canonicalSpells, overlays.spells ?? {}));

  // Verify Monsters against Product Identity blocklist & apply overlays
  for (const monster of input.monsters) {
    if (isProhibitedMonsterId(monster.id) || isProhibitedMonsterId(monster.name)) {
      throw new Error(
        `Prohibited Product Identity Monster rejected by ingestion pipeline: "${monster.name}" (${monster.id})`,
      );
    }
  }
  const monsters = sortById(applyMonsterOverlays(input.monsters, overlays.monsters ?? {}));

  return {
    abilitiesAndSkills,
    conditions,
    damageTypes,
    proficienciesAndLanguages,
    races,
    subraces,
    classes,
    subclasses,
    features,
    backgrounds,
    feats,
    equipment,
    magicItems,
    spells,
    monsters,
  };
}

/**
 * Canonical filenames in `packages/data/src/srd/`.
 */
export const SRD_BUNDLE_FILENAMES = [
  'abilities-and-skills.json',
  'conditions.json',
  'damage-types.json',
  'proficiencies-and-languages.json',
  'races.json',
  'subraces.json',
  'classes.json',
  'subclasses.json',
  'features.json',
  'backgrounds.json',
  'feats.json',
  'equipment.json',
  'magic-items.json',
  'spells.json',
  'monsters.json',
] as const;

export type SrdBundleFilename = (typeof SRD_BUNDLE_FILENAMES)[number];

/**
 * Serializes a validated `NormalizedSrdDataset` into deterministic JSON strings keyed by filename.
 */
export function serializeSrdDatasetFiles(
  dataset: NormalizedSrdDataset,
): Record<SrdBundleFilename, string> {
  const formatJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  return {
    'abilities-and-skills.json': formatJson(dataset.abilitiesAndSkills),
    'conditions.json': formatJson(dataset.conditions),
    'damage-types.json': formatJson(dataset.damageTypes),
    'proficiencies-and-languages.json': formatJson(dataset.proficienciesAndLanguages),
    'races.json': formatJson(dataset.races),
    'subraces.json': formatJson(dataset.subraces),
    'classes.json': formatJson(dataset.classes),
    'subclasses.json': formatJson(dataset.subclasses),
    'features.json': formatJson(dataset.features),
    'backgrounds.json': formatJson(dataset.backgrounds),
    'feats.json': formatJson(dataset.feats),
    'equipment.json': formatJson(dataset.equipment),
    'magic-items.json': formatJson(dataset.magicItems),
    'spells.json': formatJson(dataset.spells),
    'monsters.json': formatJson(dataset.monsters),
  };
}
