import {
  type AbilityId,
  type CharacterBuildState,
  CharacterBuildStateSchema,
  type EquippedSlots,
  type InventoryItemInstance,
  type SrdCompendium,
  createDefaultCharacterRuntimeState,
  createDefaultSpellcastingSelection,
  defaultCompendium,
} from '@srd5/data';
import { rollAbilityScores4d6kh3 } from '../dice/evaluator.js';
import { nextRandomUint32, normalizeSeed } from '../dice/prng.js';
import { computeDerivedCharacter } from '../character/derived.js';

export interface DraftPartyOptions {
  seed?: number;
  partySize?: number; // 1 to 4, default 4
  level?: number;     // Level 1 default
  compendium?: SrdCompendium;
}

export interface DraftHeroOptions {
  seed: number;
  classId?: string;
  raceId?: string;
  subraceId?: string;
  name?: string;
  compendium?: SrdCompendium;
}

const SRD_CLASSES = [
  'fighter',
  'wizard',
  'cleric',
  'rogue',
  'barbarian',
  'bard',
  'druid',
  'monk',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
] as const;

interface RaceDraftInfo {
  raceId: string;
  subraceId?: string;
  racialChoices?: Record<string, string[]>;
}

const SRD_RACES: readonly RaceDraftInfo[] = [
  { raceId: 'human', racialChoices: { 'human-extra-language': ['dwarvish'] } },
  { raceId: 'elf', subraceId: 'high-elf', racialChoices: { 'high-elf-cantrip': ['light'], 'high-elf-extra-language': ['dwarvish'] } },
  { raceId: 'elf', subraceId: 'wood-elf' },
  { raceId: 'dwarf', subraceId: 'hill-dwarf' },
  { raceId: 'dwarf', subraceId: 'mountain-dwarf' },
  { raceId: 'halfling', subraceId: 'lightfoot-halfling' },
  { raceId: 'halfling', subraceId: 'stout-halfling' },
  { raceId: 'dragonborn' },
  { raceId: 'gnome', subraceId: 'rock-gnome' },
  { raceId: 'half-elf', racialChoices: { 'half-elf-skills': ['perception', 'insight'], 'half-elf-ability-bonuses': ['con', 'dex'] } },
  { raceId: 'half-orc' },
  { raceId: 'tiefling' },
];

const CLASS_ABILITY_PRIORITIES: Record<string, AbilityId[]> = {
  fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'],
  rogue: ['dex', 'con', 'int', 'wis', 'cha', 'str'],
  monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
  cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'],
  druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'],
};

const CLASS_HIT_DICE: Record<string, number> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  bard: 8,
  cleric: 8,
  druid: 8,
  monk: 8,
  rogue: 8,
  warlock: 8,
  sorcerer: 6,
  wizard: 6,
};

const FANTASY_FIRST_NAMES = [
  'Aeloria', 'Bram', 'Caelen', 'Dareth', 'Elowen', 'Faelan', 'Garrick', 'Hestia',
  'Illyria', 'Jarek', 'Kaelen', 'Lyra', 'Morrigan', 'Nyx', 'Orin', 'Pyria',
  'Rhiannon', 'Soren', 'Theron', 'Una', 'Vaelen', 'Wynne', 'Xander', 'Zephyr',
];

const FANTASY_TITLES = [
  'Dawnseeker', 'Ironheart', 'Shadowstride', 'Stormcaller', 'Emberforge', 'Swiftblade',
  'Whisperwind', 'Frostwarden', 'Spellbinder', 'Stoneguard', 'Silverthorn', 'Starweaver',
];

interface ClassGearTemplate {
  inventory: Array<{ itemId: string; quantity: number }>;
  equippedSlots?: {
    armorItemId?: string;
    shieldItemId?: string;
    mainHandItemId?: string;
    offHandItemId?: string;
    rangedItemId?: string;
  };
  cantrips?: string[];
  spellsKnown?: string[];
  spellsPrepared?: string[];
  skills: string[];
}

const CLASS_GEAR_TEMPLATES: Record<string, ClassGearTemplate> = {
  fighter: {
    inventory: [
      { itemId: 'chain-mail', quantity: 1 },
      { itemId: 'longsword', quantity: 1 },
      { itemId: 'shield', quantity: 1 },
      { itemId: 'light-crossbow', quantity: 1 },
      { itemId: 'crossbow-bolt', quantity: 20 },
      { itemId: 'potion-of-healing', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'chain-mail', mainHandItemId: 'longsword', shieldItemId: 'shield' },
    skills: ['athletics', 'perception'],
  },
  barbarian: {
    inventory: [
      { itemId: 'greataxe', quantity: 1 },
      { itemId: 'handaxe', quantity: 2 },
      { itemId: 'javelin', quantity: 4 },
      { itemId: 'potion-of-healing', quantity: 1 },
    ],
    equippedSlots: { mainHandItemId: 'greataxe' },
    skills: ['athletics', 'survival'],
  },
  paladin: {
    inventory: [
      { itemId: 'chain-mail', quantity: 1 },
      { itemId: 'warhammer', quantity: 1 },
      { itemId: 'shield', quantity: 1 },
      { itemId: 'javelin', quantity: 5 },
      { itemId: 'potion-of-healing', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'chain-mail', mainHandItemId: 'warhammer', shieldItemId: 'shield' },
    skills: ['athletics', 'religion'],
  },
  rogue: {
    inventory: [
      { itemId: 'leather-armor', quantity: 1 },
      { itemId: 'rapier', quantity: 1 },
      { itemId: 'shortbow', quantity: 1 },
      { itemId: 'arrow', quantity: 20 },
      { itemId: 'dagger', quantity: 2 },
      { itemId: 'thieves-tools', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'leather-armor', mainHandItemId: 'rapier' },
    skills: ['stealth', 'sleight-of-hand', 'acrobatics', 'perception'],
  },
  monk: {
    inventory: [
      { itemId: 'shortsword', quantity: 1 },
      { itemId: 'dart', quantity: 10 },
      { itemId: 'potion-of-healing', quantity: 1 },
    ],
    equippedSlots: { mainHandItemId: 'shortsword' },
    skills: ['acrobatics', 'athletics'],
  },
  ranger: {
    inventory: [
      { itemId: 'scale-mail', quantity: 1 },
      { itemId: 'shortsword', quantity: 2 },
      { itemId: 'longbow', quantity: 1 },
      { itemId: 'arrow', quantity: 20 },
    ],
    equippedSlots: { armorItemId: 'scale-mail', mainHandItemId: 'shortsword', offHandItemId: 'shortsword' },
    skills: ['survival', 'stealth', 'perception'],
  },
  wizard: {
    inventory: [
      { itemId: 'quarterstaff', quantity: 1 },
      { itemId: 'dagger', quantity: 1 },
      { itemId: 'component-pouch', quantity: 1 },
      { itemId: 'spellbook', quantity: 1 },
      { itemId: 'potion-of-healing', quantity: 1 },
    ],
    equippedSlots: { mainHandItemId: 'quarterstaff' },
    cantrips: ['fire-bolt', 'ray-of-frost', 'mage-hand'],
    spellsPrepared: ['magic-missile', 'mage-armor', 'shield', 'sleep'],
    skills: ['arcana', 'investigation'],
  },
  cleric: {
    inventory: [
      { itemId: 'scale-mail', quantity: 1 },
      { itemId: 'mace', quantity: 1 },
      { itemId: 'shield', quantity: 1 },
      { itemId: 'light-crossbow', quantity: 1 },
      { itemId: 'crossbow-bolt', quantity: 20 },
      { itemId: 'holy-symbol', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'scale-mail', mainHandItemId: 'mace', shieldItemId: 'shield' },
    cantrips: ['sacred-flame', 'guidance', 'spare-the-dying'],
    spellsPrepared: ['cure-wounds', 'bless', 'healing-word'],
    skills: ['insight', 'religion'],
  },
  druid: {
    inventory: [
      { itemId: 'leather-armor', quantity: 1 },
      { itemId: 'scimitar', quantity: 1 },
      { itemId: 'wooden-shield', quantity: 1 },
      { itemId: 'druidic-focus', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'leather-armor', mainHandItemId: 'scimitar', shieldItemId: 'wooden-shield' },
    cantrips: ['druidcraft', 'produce-flame'],
    spellsPrepared: ['cure-wounds', 'entangle', 'thunderwave'],
    skills: ['nature', 'perception'],
  },
  bard: {
    inventory: [
      { itemId: 'leather-armor', quantity: 1 },
      { itemId: 'rapier', quantity: 1 },
      { itemId: 'dagger', quantity: 1 },
      { itemId: 'lute', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'leather-armor', mainHandItemId: 'rapier' },
    cantrips: ['vicious-mockery', 'light'],
    spellsKnown: ['cure-wounds', 'dissonant-whispers', 'faerie-fire', 'thunderwave'],
    skills: ['persuasion', 'performance', 'deception'],
  },
  sorcerer: {
    inventory: [
      { itemId: 'dagger', quantity: 2 },
      { itemId: 'light-crossbow', quantity: 1 },
      { itemId: 'crossbow-bolt', quantity: 20 },
      { itemId: 'arcane-focus', quantity: 1 },
    ],
    equippedSlots: { mainHandItemId: 'dagger' },
    cantrips: ['fire-bolt', 'shocking-grasp', 'prestidigitation', 'light'],
    spellsKnown: ['magic-missile', 'shield'],
    skills: ['arcana', 'persuasion'],
  },
  warlock: {
    inventory: [
      { itemId: 'leather-armor', quantity: 1 },
      { itemId: 'quarterstaff', quantity: 1 },
      { itemId: 'light-crossbow', quantity: 1 },
      { itemId: 'crossbow-bolt', quantity: 20 },
      { itemId: 'arcane-focus', quantity: 1 },
    ],
    equippedSlots: { armorItemId: 'leather-armor', mainHandItemId: 'quarterstaff' },
    cantrips: ['eldritch-blast', 'chill-touch'],
    spellsKnown: ['hex', 'arms-of-hadar'],
    skills: ['arcana', 'intimidation'],
  },
};

/**
 * Generates a single deterministic Level 1 CharacterBuildState from seeded rolls.
 */
export function generateDraftHero(
  options: DraftHeroOptions,
  compendium: SrdCompendium = defaultCompendium,
): { hero: CharacterBuildState; nextState: number } {
  let rng = normalizeSeed(options.seed);

  // 1. Pick Class
  const classId =
    options.classId ??
    SRD_CLASSES[(() => {
      const { value, nextState } = nextRandomUint32(rng);
      rng = nextState;
      return value % SRD_CLASSES.length;
    })()]!;

  // 2. Pick Race
  const raceOption =
    options.raceId
      ? SRD_RACES.find((r) => r.raceId === options.raceId && (!options.subraceId || r.subraceId === options.subraceId)) ?? SRD_RACES[0]!
      : SRD_RACES[(() => {
          const { value, nextState } = nextRandomUint32(rng);
          rng = nextState;
          return value % SRD_RACES.length;
        })()]!;

  // 3. Roll 4d6kh3 Ability Scores deterministically
  const rollRes = rollAbilityScores4d6kh3(rng);
  rng = rollRes.nextState;

  // Sort rolled scores descending
  const sortedScores = [...rollRes.scores].sort((a, b) => b - a);
  const priorities = CLASS_ABILITY_PRIORITIES[classId] ?? ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  const baseAbilities: Record<AbilityId, number> = {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };

  priorities.forEach((ability, index) => {
    baseAbilities[ability] = sortedScores[index] ?? 10;
  });

  // 4. Generate Name
  const firstName =
    FANTASY_FIRST_NAMES[(() => {
      const { value, nextState } = nextRandomUint32(rng);
      rng = nextState;
      return value % FANTASY_FIRST_NAMES.length;
    })()]!;

  const title =
    FANTASY_TITLES[(() => {
      const { value, nextState } = nextRandomUint32(rng);
      rng = nextState;
      return value % FANTASY_TITLES.length;
    })()]!;

  const name = options.name ?? `${firstName} ${title}`;
  const charId = `draft-${classId}-${normalizeSeed(options.seed).toString(16)}-${name.toLowerCase().replace(/\s+/g, '-')}`;

  // 5. Template Gear & Choices
  const template = CLASS_GEAR_TEMPLATES[classId] ?? CLASS_GEAR_TEMPLATES.fighter!;
  const inventory: InventoryItemInstance[] = [];
  let armorInstanceId: string | undefined;
  let shieldInstanceId: string | undefined;
  let mainHandInstanceId: string | undefined;
  let offHandInstanceId: string | undefined;
  let rangedInstanceId: string | undefined;

  template.inventory.forEach((item, idx) => {
    const instanceId = `${charId}-item-${idx + 1}`;
    inventory.push({ instanceId, itemId: item.itemId, quantity: item.quantity });
    if (template.equippedSlots?.armorItemId === item.itemId && !armorInstanceId) {
      armorInstanceId = instanceId;
    }
    if (template.equippedSlots?.shieldItemId === item.itemId && !shieldInstanceId) {
      shieldInstanceId = instanceId;
    }
    if (template.equippedSlots?.mainHandItemId === item.itemId && !mainHandInstanceId) {
      mainHandInstanceId = instanceId;
    }
    if (template.equippedSlots?.offHandItemId === item.itemId && !offHandInstanceId) {
      offHandInstanceId = instanceId;
    }
    if (template.equippedSlots?.rangedItemId === item.itemId && !rangedInstanceId) {
      rangedInstanceId = instanceId;
    }
  });

  const equipped: EquippedSlots = {
    ...(armorInstanceId ? { armorInstanceId } : {}),
    ...(shieldInstanceId ? { shieldInstanceId } : {}),
    ...(mainHandInstanceId ? { mainHandInstanceId } : {}),
    ...(offHandInstanceId ? { offHandInstanceId } : {}),
    ...(rangedInstanceId ? { rangedInstanceId } : {}),
  };

  const maxHp = CLASS_HIT_DICE[classId] ?? 8;

  const rawHero: CharacterBuildState = {
    id: charId,
    version: 1,
    name,
    portraitId: `portrait-${raceOption.raceId}-${classId}`,
    tokenSpriteId: `token-${raceOption.raceId}-${classId}`,
    alignment: 'neutral_good',
    raceId: raceOption.raceId,
    ...(raceOption.subraceId ? { subraceId: raceOption.subraceId } : {}),
    racialChoices: raceOption.racialChoices ?? {},
    backgroundId: 'acolyte',
    backgroundChoices: {
      'acolyte-languages': ['elvish', 'dwarvish'],
    },
    abilityMethod: 'rolled',
    abilityRollSeed: normalizeSeed(options.seed),
    baseAbilities,
    classes: [
      {
        classId,
        level: 1,
        hpRollsByLevel: [maxHp],
        choiceSelectionsByLevel: {
          '1': {
            [`${classId}-skills`]: template.skills,
          },
        },
        asiOrFeatByLevel: {},
      },
    ],
    currency: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 },
    inventory,
    equippedSlots: equipped,
    attunedItemInstanceIds: [],
    spellcasting: createDefaultSpellcastingSelection({
      knownCantripIds: template.cantrips ?? [],
      knownSpellIds: template.spellsKnown ?? [],
      preparedSpellIds: template.spellsPrepared ?? [],
      spellbookSpellIds: classId === 'wizard' ? [...(template.spellsPrepared ?? []), 'comprehend-languages', 'detect-magic'] : [],
    }),
    runtime: createDefaultCharacterRuntimeState({
      currentHp: maxHp,
    }),
  };

  const parsedHero = CharacterBuildStateSchema.parse(rawHero);
  // Verify derived character computation succeeds
  computeDerivedCharacter(parsedHero, compendium);

  return { hero: parsedHero, nextState: rng };
}

/**
 * Generates a full adventuring party (default: 4 distinct class heroes) deterministically
 * from a seed using seeded 4d6kh3 rolls.
 */
export function generateDraftParty(
  options: DraftPartyOptions = {},
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuildState[] {
  let rng = normalizeSeed(options.seed ?? 1337);
  const count = Math.max(1, Math.min(4, options.partySize ?? 4));

  // Pick count distinct classes for balanced party diversity
  const shuffledClasses = [...SRD_CLASSES];
  for (let i = shuffledClasses.length - 1; i > 0; i--) {
    const { value, nextState } = nextRandomUint32(rng);
    rng = nextState;
    const j = value % (i + 1);
    const temp = shuffledClasses[i]!;
    shuffledClasses[i] = shuffledClasses[j]!;
    shuffledClasses[j] = temp;
  }

  const party: CharacterBuildState[] = [];
  for (let i = 0; i < count; i++) {
    const classId = shuffledClasses[i]!;
    const heroRes = generateDraftHero(
      {
        seed: rng + i * 104729,
        classId,
        compendium,
      },
      compendium,
    );
    rng = heroRes.nextState;
    party.push(heroRes.hero);
  }

  return party;
}
