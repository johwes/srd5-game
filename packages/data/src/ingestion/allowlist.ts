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
  'drizzt',
  'elminster',
  'volo',
  'xanathar',
  'acererak',
  'vecna',
  'lolth',
  'tiamat',
  'bahamut',
] as const;

/**
 * Non-SRD Product Identity campaign settings, planes, and realms prohibited in open content.
 */
export const PROHIBITED_PRODUCT_IDENTITY_SETTINGS = [
  'forgotten-realms',
  'faerun',
  'waterdeep',
  'baldurs-gate',
  'neverwinter',
  'toril',
  'greyhawk',
  'oerth',
  'krynn',
  'dragonlance',
  'eberron',
  'khorvaire',
  'barovia',
  'ravenloft',
  'strahd',
  'planescape',
  'sigil',
  'spelljammer',
  'dark-sun',
  'athas',
] as const;

export const PROHIBITED_PRODUCT_IDENTITY_SETTING_SET: ReadonlySet<string> = new Set(
  PROHIBITED_PRODUCT_IDENTITY_SETTINGS,
);

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

/**
 * Checks whether a text contains prohibited Product Identity campaign settings.
 */
export function containsProductIdentitySetting(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_PRODUCT_IDENTITY_SETTINGS.some((setting) => {
    const clean = setting.replace(/-/g, '[-\\s]');
    const pattern = new RegExp(`\\b${clean}\\b`, 'i');
    return pattern.test(lower);
  });
}

/**
 * Checks whether a text contains prohibited Product Identity monster names.
 */
export function containsProductIdentityMonster(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_PRODUCT_IDENTITY_MONSTER_IDS.some((m) => {
    const clean = m.replace(/-/g, '[-\\s]');
    const pattern = new RegExp(`\\b${clean}(?:s)?\\b`, 'i');
    return pattern.test(lower);
  });
}

/**
 * Result of screening text or records against Product Identity and SRD 5.2 blocklists.
 */
export interface ProductIdentityScreenResult {
  valid: boolean;
  violations: string[];
  humanReviewConfirmed: boolean;
}

/**
 * Options for screening homebrew content.
 */
export interface ProductIdentityScreenOptions {
  /** If true, humanReviewConfirmed is required for valid: true. Default false. */
  requireHumanReview?: boolean;
  /** Explicit override for human review confirmation. */
  humanReviewed?: boolean;
}

/**
 * Evaluates freeform text against Product Identity proper names, settings, monsters, and SRD 5.2 terms.
 */
export function screenProductIdentityText(text: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!text || !text.trim()) {
    return { valid: true, violations };
  }

  // 1. Proper names check
  for (const name of PROHIBITED_PRODUCT_IDENTITY_PROPER_NAMES) {
    const pattern = new RegExp(`\\b${name}(?:'s|s)?\\b`, 'i');
    if (pattern.test(text)) {
      violations.push(`Prohibited Product Identity proper name: "${name}"`);
    }
  }

  // 2. Setting names check
  for (const setting of PROHIBITED_PRODUCT_IDENTITY_SETTINGS) {
    const clean = setting.replace(/-/g, '[-\\s]');
    const pattern = new RegExp(`\\b${clean}\\b`, 'i');
    if (pattern.test(text)) {
      violations.push(`Prohibited Product Identity setting/realm: "${setting}"`);
    }
  }

  // 3. Prohibited monsters check
  for (const monsterId of PROHIBITED_PRODUCT_IDENTITY_MONSTER_IDS) {
    const clean = monsterId.replace(/-/g, '[-\\s]');
    const pattern = new RegExp(`\\b${clean}(?:s)?\\b`, 'i');
    if (pattern.test(text)) {
      violations.push(`Prohibited Product Identity monster: "${monsterId}"`);
    }
  }

  // 4. SRD 5.2 identifier check (isolated words matching 5.2 additions)
  for (const v52 of SRD_52_ADDED_IDENTIFIERS) {
    const clean = v52.replace(/-/g, '[-\\s]');
    const pattern = new RegExp(`^${clean}$|\\b${clean}\\b`, 'i');
    if (pattern.test(text)) {
      violations.push(`Prohibited SRD 5.2 addition on SRD 5.1 track: "${v52}"`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Evaluates a candidate homebrew record against Product Identity blocklists and human review criteria.
 */
export function screenHomebrewRecord(
  record: {
    id?: string;
    name?: string;
    description?: string;
    source?: string;
    humanReviewed?: boolean;
    feature?: { name?: string; description?: string };
  },
  options?: ProductIdentityScreenOptions,
): ProductIdentityScreenResult {
  const violations: string[] = [];

  // Check mandatory provenance
  if (record.source !== undefined && record.source !== 'homebrew' && record.source !== 'srd-5.1') {
    violations.push(`Invalid source provenance "${record.source}" (must be "homebrew" or "srd-5.1")`);
  }

  const textsToScreen = [
    record.id ?? '',
    record.name ?? '',
    record.description ?? '',
    record.feature?.name ?? '',
    record.feature?.description ?? '',
  ];

  for (const txt of textsToScreen) {
    if (!txt) continue;
    const res = screenProductIdentityText(txt);
    for (const v of res.violations) {
      if (!violations.includes(v)) {
        violations.push(v);
      }
    }
  }

  const humanReviewConfirmed = Boolean(
    options?.humanReviewed ?? record.humanReviewed ?? false,
  );

  if (options?.requireHumanReview && !humanReviewConfirmed) {
    violations.push(
      'Human review confirmation required: verify content is original and not copied or paraphrased from closed official content.',
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    humanReviewConfirmed,
  };
}
