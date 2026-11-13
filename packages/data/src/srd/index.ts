import type {
  AbilitiesAndSkillsFile,
  BackgroundData,
  ClassData,
  ConditionDefinition,
  DamageTypeDefinition,
  EquipmentData,
  FeatData,
  FeatureData,
  MagicItemData,
  MonsterData,
  NormalizedSrdDataset,
  ProficienciesAndLanguagesFile,
  RaceData,
  SpellData,
  SubclassData,
  SubraceData,
} from '../index.js';
import abilitiesAndSkillsJson from './abilities-and-skills.json' with { type: 'json' };
import backgroundsJson from './backgrounds.json' with { type: 'json' };
import classesJson from './classes.json' with { type: 'json' };
import conditionsJson from './conditions.json' with { type: 'json' };
import damageTypesJson from './damage-types.json' with { type: 'json' };
import equipmentJson from './equipment.json' with { type: 'json' };
import featsJson from './feats.json' with { type: 'json' };
import featuresJson from './features.json' with { type: 'json' };
import magicItemsJson from './magic-items.json' with { type: 'json' };
import monstersJson from './monsters.json' with { type: 'json' };
import proficienciesAndLanguagesJson from './proficiencies-and-languages.json' with {
  type: 'json',
};
import racesJson from './races.json' with { type: 'json' };
import spellsJson from './spells.json' with { type: 'json' };
import subclassesJson from './subclasses.json' with { type: 'json' };
import subracesJson from './subraces.json' with { type: 'json' };

/**
 * Complete offline-bundled SRD 5.1 normalized dataset (`packages/data/src/srd/*.json`).
 */
export const BUNDLED_SRD_DATASET: NormalizedSrdDataset = {
  abilitiesAndSkills: abilitiesAndSkillsJson as unknown as AbilitiesAndSkillsFile,
  conditions: conditionsJson as unknown as ConditionDefinition[],
  damageTypes: damageTypesJson as unknown as DamageTypeDefinition[],
  proficienciesAndLanguages:
    proficienciesAndLanguagesJson as unknown as ProficienciesAndLanguagesFile,
  races: racesJson as unknown as RaceData[],
  subraces: subracesJson as unknown as SubraceData[],
  classes: classesJson as unknown as ClassData[],
  subclasses: subclassesJson as unknown as SubclassData[],
  features: featuresJson as unknown as FeatureData[],
  backgrounds: backgroundsJson as unknown as BackgroundData[],
  feats: featsJson as unknown as FeatData[],
  equipment: equipmentJson as unknown as EquipmentData[],
  magicItems: magicItemsJson as unknown as MagicItemData[],
  spells: spellsJson as unknown as SpellData[],
  monsters: monstersJson as unknown as MonsterData[],
};
