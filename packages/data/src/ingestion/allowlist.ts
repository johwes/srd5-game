import {
  SRD_CLASS_IDS,
  SRD_RACE_IDS,
  SRD_SUBCLASS_IDS,
  SRD_SUBRACE_IDS,
} from '../schemas/enums.js';

/**
 * Canonical SRD 5.1 Race IDs allowed in the dataset.
 */
export const ALLOWED_SRD_RACE_IDS: ReadonlySet<string> = new Set(SRD_RACE_IDS);

/**
 * Canonical SRD 5.1 Subrace IDs allowed in the dataset.
 */
export const ALLOWED_SRD_SUBRACE_IDS: ReadonlySet<string> = new Set(SRD_SUBRACE_IDS);

/**
 * Canonical SRD 5.1 Class IDs allowed in the dataset.
 */
export const ALLOWED_SRD_CLASS_IDS: ReadonlySet<string> = new Set(SRD_CLASS_IDS);

/**
 * Canonical SRD 5.1 Subclass IDs allowed in the dataset.
 */
export const ALLOWED_SRD_SUBCLASS_IDS: ReadonlySet<string> = new Set(SRD_SUBCLASS_IDS);

/**
 * Canonical SRD 5.1 Background IDs allowed in the base SRD dataset.
 */
export const ALLOWED_SRD_BACKGROUND_IDS: ReadonlySet<string> = new Set(['acolyte']);

/**
 * Canonical SRD 5.1 Feat IDs allowed in the base SRD dataset.
 */
export const ALLOWED_SRD_FEAT_IDS: ReadonlySet<string> = new Set(['grappler']);

/**
 * Non-SRD Product Identity monster identifiers explicitly prohibited by WotC SRD 5.1 guidelines.
 */
export const PROHIBITED_PRODUCT_IDENTITY_MONSTER_IDS = [
  'beholder',
  'spectator',
  'death-tyrant',
  'mind-flayer',
  'illithid',
  'displacer-beast',
  'carrion-crawler',
  'umber-hulk',
  'yuan-ti',
  'yuan-ti-abomination',
  'yuan-ti-malison',
  'yuan-ti-pureblood',
  'githyanki',
  'githyanki-warrior',
  'githyanki-knight',
  'githzerai',
  'githzerai-monk',
  'githzerai-zerth',
  'kuo-toa',
  'kuo-toa-archpriest',
  'kuo-toa-whip',
  'slaad',
  'red-slaad',
  'blue-slaad',
  'green-slaad',
  'gray-slaad',
  'death-slaad',
  'modron',
  'monodrone',
  'duodrone',
  'tridrone',
  'quadrone',
  'pentadrone',
] as const;

export const PROHIBITED_PRODUCT_IDENTITY_MONSTER_SET: ReadonlySet<string> = new Set(
  PROHIBITED_PRODUCT_IDENTITY_MONSTER_IDS,
);

/**
 * Non-SRD Product Identity proper names that must not appear in canonical SRD 5.1 spell or item names.
 */
export const PROHIBITED_PRODUCT_IDENTITY_PROPER_NAMES = [
  'bigby',
  'drawmij',
  'evard',
  'leomund',
  'melf',
  'mordenkainen',
  'nystul',
  'otiluke',
  'otto',
  'rary',
  'tasha',
  'tenser',
  'hadar',
  'agathys',
  'abi-dalzim',
  'aganazzar',
  'snilloc',
] as const;

/**
 * Mapping of PHB named spells to their official SRD 5.1 open-content names and IDs.
 */
export const SRD_SPELL_RENAME_MAP: Readonly<
  Record<string, { id: string; name: string }>
> = {
  'melfs-acid-arrow': { id: 'acid-arrow', name: 'Acid Arrow' },
  'bigbys-hand': { id: 'arcane-hand', name: 'Arcane Hand' },
  'mordenkainens-sword': { id: 'arcane-sword', name: 'Arcane Sword' },
  'nystuls-magic-aura': { id: 'arcanists-magic-aura', name: "Arcanist's Magic Aura" },
  'evards-black-tentacles': { id: 'black-tentacles', name: 'Black Tentacles' },
  'mordenkainens-faithful-hound': { id: 'faithful-hound', name: 'Faithful Hound' },
  'tensers-floating-disk': { id: 'floating-disk', name: 'Floating Disk' },
  'otilukes-freezing-sphere': { id: 'freezing-sphere', name: 'Freezing Sphere' },
  'tashas-hideous-laughter': { id: 'hideous-laughter', name: 'Hideous Laughter' },
  'drawmijs-instant-summons': { id: 'instant-summons', name: 'Instant Summons' },
  'ottos-irresistible-dance': { id: 'irresistible-dance', name: 'Irresistible Dance' },
  'mordenkainens-magnificent-mansion': {
    id: 'magnificent-mansion',
    name: 'Magnificent Mansion',
  },
  'mordenkainens-private-sanctum': { id: 'private-sanctum', name: 'Private Sanctum' },
  'otilukes-resilient-sphere': { id: 'resilient-sphere', name: 'Resilient Sphere' },
  'leomunds-secret-chest': { id: 'secret-chest', name: 'Secret Chest' },
  'rarys-telepathic-bond': { id: 'telepathic-bond', name: 'Telepathic Bond' },
  'leomunds-tiny-hut': { id: 'tiny-hut', name: 'Tiny Hut' },
};

/**
 * Checks whether a monster ID or name is prohibited Product Identity outside SRD 5.1.
 */
export function isProhibitedMonsterId(idOrName: string): boolean {
  const normalized = idOrName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (PROHIBITED_PRODUCT_IDENTITY_MONSTER_SET.has(normalized)) {
    return true;
  }
  return PROHIBITED_PRODUCT_IDENTITY_MONSTER_IDS.some(
    (forbidden) =>
      normalized === forbidden ||
      normalized.startsWith(`${forbidden}-`) ||
      normalized.endsWith(`-${forbidden}`),
  );
}

/**
 * Checks whether a string contains prohibited Product Identity proper names.
 */
export function containsProductIdentityProperName(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_PRODUCT_IDENTITY_PROPER_NAMES.some((name) => {
    const pattern = new RegExp(`\\b${name}(?:'s|s)?\\b`, 'i');
    return pattern.test(lower);
  });
}

/**
 * Identifiers added in SRD 5.2 (per the official SRD 5.2 FAQ difference tables)
 * that are absent from SRD 5.1. Because this engine targets the 5.1 ruleset,
 * records with `source !== 'homebrew'` must never use these identifiers.
 */
export const SRD_52_ADDED_IDENTIFIERS = [
  // Monsters added in 5.2
  'allosaurus',
  'ankylosaurus',
  'archelon',
  'bugbear-stalker',
  'goblin-boss',
  'goblin-minion',
  'guard-captain',
  'hippopotamus',
  'hobgoblin-captain',
  'pirate',
  'pirate-captain',
  'pteranodon',
  'pteradon',
  'sphinx-of-wonder',
  'swarm-of-crawling-claws',
  'tough-boss',
  'troll-limb',
  'vampire-familiar',
  // Spells added in 5.2
  'aura-of-life',
  'charm-monster',
  'chromatic-orb',
  'dissonant-whispers',
  'divine-smite',
  'dragons-breath',
  'elementalism',
  'ensnaring-strike',
  'hex',
  'ice-knife',
  'mind-spike',
  'phantasmal-force',
  'power-word-heal',
  'ray-of-sickness',
  'searing-smite',
  'sorcerous-burst',
  'starry-wisp',
  'summon-dragon',
  'tsunami',
  'vitriolic-sphere',
  // Magic items added or renamed in 5.2
  'bead-of-nourishment',
  'cloak-of-invisibility',
  'elixir-of-health',
  'energy-bow',
  'gloves-of-thievery',
  'hat-of-many-spells',
  'potion-of-invulnerability',
  'potion-of-longevity',
  'potion-of-vitality',
  'quarterstaff-of-the-acrobat',
  'rod-of-resurrection',
  'sending-stones',
  'sentinel-shield',
  'shield-of-the-cavalier',
  'thunderous-greatclub',
  'mysterious-deck',
  'dragon-orb',
  // Feats and backgrounds added in 5.2
  'alert',
  'magic-initiate',
  'savage-attacker',
  'ability-score-improvement',
  'archery',
  'great-weapon-fighting',
  'two-weapon-fighting',
  'boon-of-combat-prowess',
  'boon-of-dimensional-travel',
  'boon-of-fate',
  'boon-of-irresistible-offense',
  'boon-of-irresistable-offense',
  'boon-of-the-night-spirit',
  'boon-of-spell-recall',
  'boon-of-truesight',
  'criminal',
  'sage',
  'soldier',
] as const;

const SRD_52_ADDED_NORMALIZED_SET: ReadonlySet<string> = new Set(
  SRD_52_ADDED_IDENTIFIERS.map((s) => s.replace(/[^a-z]/g, '')),
);

/**
 * Checks whether an ID or name matches an SRD 5.2-only addition.
 */
export function isSrd52OnlyIdentifier(idOrName: string): boolean {
  const norm = idOrName.toLowerCase().replace(/[^a-z]/g, '');
  return SRD_52_ADDED_NORMALIZED_SET.has(norm);
}
