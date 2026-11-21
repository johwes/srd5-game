import {
  type AbilityId,
  type CharacterBuildState,
  type ChoiceSpec,
  // NOTE: direct source imports are the repo scripts convention (see
  // validate-spell-targeting.ts). Each package's `exports` map maps `.` to
  // `./src/index.ts`, so this tests fresh source — never a stale `dist` build.
  defaultCompendium,
  getSunkenCryptModule,
} from '../packages/data/src/index.ts';
import {
  type Combatant,
  type GameCommand,
  type GameState,
  type LevelUpRequest,
  // NOTE: see above — source imports keep the soak bot on fresh engine code.
  advanceWarSimulation,
  applyBetweenCombatLevelUp,
  applyLevelUp,
  awardCharacterXp,
  buildMissionApproaches,
  canLevelUpByXp,
  computeDerivedCharacter,
  createCharacterCombatant,
  createDungeonGameState,
  createWarDiplomacyState,
  decayWarThreats,
  generateOverworldMap,
  generateWarMissionBattle,
  getAvailableSpellSlotLevels,
  getFootprintDistanceFeet,
  getLevelUpRequirements,
  getNationThreat,
  getStrategicPOIs,
  getWarNationTotal,
  hasLineOfSight,
  hireMercenaryCompany,
  initializeWarState,
  isPursuitActiveForThreat,
  negotiateTruce,
  planAiTurn,
  pointAoeGeometry,
  populateSettlements,
  rasterizeAoe,
  reduceGame,
  reportPatrolKill,
  resolveMissionApproach,
  resolvePatrolEncounter,
  rollPatrolEncounter,
  startOverworldBattle,
  transitionCombatToExploration,
  triggerDungeonEncounter,
  validateLevelUp,
} from '../packages/engine/src/index.ts';
import { LocalTransport, projectPlayerView } from '../packages/transport/src/index.ts';

interface InvariantFailure {
  suite: string;
  seed: number;
  detail: string;
}

const failures: InvariantFailure[] = [];

const telemetry = {
  classesExercised: new Set<string>(),
  totalLevelUps: 0,
  maxLevelReached: 1,
  spellsCast: new Map<string, number>(),
  featuresUsed: new Map<string, number>(),
  itemsUsed: new Map<string, number>(),
  concentrationBrokenEvents: 0,
};

function recordCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function assertInvariant(suite: string, seed: number, condition: boolean, detail: string): void {
  if (!condition) {
    failures.push({ suite, seed, detail });
  }
}

/** Simple deterministic Mulberry32 PRNG for playtest randomization (never Math.random). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function shuffleWithRng<T>(arr: readonly T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const ALL_SRD_CLASSES = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
] as const;

type SrdClassId = (typeof ALL_SRD_CLASSES)[number];

interface ClassTemplate {
  primary: AbilityId;
  secondary: AbilityId;
  tertiary: AbilityId;
  armorId?: string;
  shield?: boolean;
  mainWeaponId: string;
  rangedWeaponId?: string;
  cantripsCount: number;
  knownSpellsCount: number;
  spellbookCount: number;
  preparedCaster: boolean;
}

const CLASS_TEMPLATES: Record<SrdClassId, ClassTemplate> = {
  barbarian: {
    primary: 'str',
    secondary: 'con',
    tertiary: 'dex',
    mainWeaponId: 'greataxe',
    rangedWeaponId: 'javelin',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: false,
  },
  bard: {
    primary: 'cha',
    secondary: 'dex',
    tertiary: 'con',
    armorId: 'leather-armor',
    mainWeaponId: 'rapier',
    rangedWeaponId: 'shortbow',
    cantripsCount: 2,
    knownSpellsCount: 4,
    spellbookCount: 0,
    preparedCaster: false,
  },
  cleric: {
    primary: 'wis',
    secondary: 'con',
    tertiary: 'str',
    armorId: 'chain-mail',
    shield: true,
    mainWeaponId: 'mace',
    cantripsCount: 3,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: true,
  },
  druid: {
    primary: 'wis',
    secondary: 'con',
    tertiary: 'dex',
    armorId: 'leather-armor',
    shield: true,
    mainWeaponId: 'scimitar',
    cantripsCount: 2,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: true,
  },
  fighter: {
    primary: 'str',
    secondary: 'con',
    tertiary: 'dex',
    armorId: 'chain-mail',
    shield: true,
    mainWeaponId: 'longsword',
    rangedWeaponId: 'handaxe',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: false,
  },
  monk: {
    primary: 'dex',
    secondary: 'wis',
    tertiary: 'con',
    mainWeaponId: 'shortsword',
    rangedWeaponId: 'dart',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: false,
  },
  paladin: {
    primary: 'str',
    secondary: 'cha',
    tertiary: 'con',
    armorId: 'chain-mail',
    shield: true,
    mainWeaponId: 'longsword',
    rangedWeaponId: 'javelin',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: true,
  },
  ranger: {
    primary: 'dex',
    secondary: 'wis',
    tertiary: 'con',
    armorId: 'scale-mail',
    mainWeaponId: 'shortsword',
    rangedWeaponId: 'longbow',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: false,
  },
  rogue: {
    primary: 'dex',
    secondary: 'con',
    tertiary: 'int',
    armorId: 'leather-armor',
    mainWeaponId: 'rapier',
    rangedWeaponId: 'shortbow',
    cantripsCount: 0,
    knownSpellsCount: 0,
    spellbookCount: 0,
    preparedCaster: false,
  },
  sorcerer: {
    primary: 'cha',
    secondary: 'con',
    tertiary: 'dex',
    mainWeaponId: 'dagger',
    rangedWeaponId: 'light-crossbow',
    cantripsCount: 4,
    knownSpellsCount: 2,
    spellbookCount: 0,
    preparedCaster: false,
  },
  warlock: {
    primary: 'cha',
    secondary: 'con',
    tertiary: 'dex',
    armorId: 'leather-armor',
    mainWeaponId: 'dagger',
    rangedWeaponId: 'light-crossbow',
    cantripsCount: 2,
    knownSpellsCount: 2,
    spellbookCount: 0,
    preparedCaster: false,
  },
  wizard: {
    primary: 'int',
    secondary: 'con',
    tertiary: 'dex',
    mainWeaponId: 'quarterstaff',
    cantripsCount: 3,
    knownSpellsCount: 0,
    spellbookCount: 6,
    preparedCaster: true,
  },
};

const PLAYTEST_RACES = [
  { raceId: 'human' },
  { raceId: 'elf', subraceId: 'high-elf' },
  { raceId: 'dwarf', subraceId: 'hill-dwarf' },
  { raceId: 'halfling', subraceId: 'lightfoot' },
  { raceId: 'tiefling' },
  { raceId: 'half-orc' },
  { raceId: 'dragonborn' },
] as const;

function autoResolveChoices(
  choices: ChoiceSpec | readonly ChoiceSpec[] | undefined,
  rng: () => number,
  exclude?: Set<string>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!choices) return result;
  const list = Array.isArray(choices) ? choices : [choices];
  for (const choice of list) {
    let opts: string[] = [];
    if (choice.type === 'feature_option') {
      opts = [...choice.options];
    } else if (choice.type === 'equipment_bundle') {
      opts = choice.options.map((o) => o.id);
    } else if (choice.type === 'proficiency' || choice.type === 'skill' || choice.type === 'language' || choice.type === 'tool') {
      if (choice.from.mode === 'explicit') {
        opts = [...choice.from.options];
      } else if (choice.type === 'skill') {
        opts = [
          'athletics',
          'acrobatics',
          'sleight-of-hand',
          'stealth',
          'arcana',
          'history',
          'investigation',
          'nature',
          'religion',
          'animal-handling',
          'insight',
          'medicine',
          'perception',
          'survival',
          'deception',
          'intimidation',
          'performance',
          'persuasion',
        ];
      } else if (choice.type === 'language') {
        opts = ['elvish', 'dwarvish', 'giant', 'gnomish', 'goblin', 'orc', 'draconic', 'celestial', 'sylvan', 'undercommon'];
      } else {
        const cat = choice.from.category.toLowerCase();
        if (cat.includes('musical') || cat.includes('instrument')) {
          opts = ['lute', 'flute', 'lyre', 'drum', 'horn', 'viol'];
        } else {
          opts = ['thieves-tools', 'herbalism-kit', 'smiths-tools', 'brewers-supplies', 'carpenters-tools'];
        }
      }
    } else if (choice.type === 'spell') {
      opts = defaultCompendium.spells
        .filter((s) => s.level <= choice.maxSpellLevel && (choice.classList === 'any' || s.classes.includes(choice.classList)))
        .map((s) => s.id);
    } else if (choice.type === 'ability_score_bonus') {
      const excluded = new Set(choice.excludeAbilities ?? []);
      opts = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).filter((a) => !excluded.has(a));
    }
    if (exclude && (choice.type === 'skill' || choice.type === 'language' || choice.type === 'tool' || choice.type === 'proficiency' || choice.type === 'feature_option')) {
      const filtered = opts.filter((o) => !exclude.has(o));
      if (filtered.length >= choice.count) opts = filtered;
    }
    if (opts.length > 0 && choice.count > 0) {
      const picked = shuffleWithRng(opts, rng).slice(0, choice.count);
      result[choice.id] = picked;
      if (exclude && (choice.type === 'skill' || choice.type === 'language' || choice.type === 'tool' || choice.type === 'proficiency' || choice.type === 'feature_option')) {
        for (const p of picked) exclude.add(p);
      }
    }
  }
  return result;
}

function buildRandomClassHero(
  classId: SrdClassId,
  slotIndex: number,
  seed: number,
  rng: () => number,
): Combatant {
  const tpl = CLASS_TEMPLATES[classId];
  const classData = defaultCompendium.getClass(classId)!;
  const raceChoice = pickRandom(PLAYTEST_RACES, rng);

  // Assign Standard Array [15, 14, 13, 12, 10, 8] to primary/secondary/tertiary + remaining
  const allAbilities: AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ordered: AbilityId[] = [tpl.primary, tpl.secondary, tpl.tertiary];
  for (const ab of allAbilities) {
    if (!ordered.includes(ab)) ordered.push(ab);
  }
  const arrayVals = [15, 14, 13, 12, 10, 8];
  const baseAbilities = {} as Record<AbilityId, number>;
  ordered.forEach((ab, i) => {
    baseAbilities[ab] = arrayVals[i]!;
  });

  // Pick Level 1 class spells/cantrips from compendium
  const classCantrips = defaultCompendium.spells
    .filter((s) => s.level === 0 && s.classes.includes(classId))
    .map((s) => s.id);
  const classLvl1Spells = defaultCompendium.spells
    .filter((s) => s.level === 1 && s.classes.includes(classId))
    .map((s) => s.id);

  // Prioritize combat-useful spells first while still shuffling for variety
  const prioritySpells = [
    'healing-word',
    'cure-wounds',
    'bless',
    'magic-missile',
    'burning-hands',
    'guiding-bolt',
    'thunderwave',
    'shield-of-faith',
    'faerie-fire',
    'inflict-wounds',
    'chromatic-orb',
    'hex',
    'hellish-rebuke',
    'entangle',
    'sleep',
  ];
  const sortWithVariety = (ids: string[]) => {
    const shuffled = shuffleWithRng(ids, rng);
    return shuffled.sort((a, b) => {
      const pa = prioritySpells.includes(a) ? 0 : 1;
      const pb = prioritySpells.includes(b) ? 0 : 1;
      return pa - pb;
    });
  };

  const knownCantripIds = shuffleWithRng(classCantrips, rng).slice(0, tpl.cantripsCount);
  const sortedLvl1 = sortWithVariety(classLvl1Spells);
  const knownSpellIds = tpl.knownSpellsCount > 0 ? sortedLvl1.slice(0, tpl.knownSpellsCount) : [];
  const spellbookSpellIds = tpl.spellbookCount > 0 ? sortedLvl1.slice(0, tpl.spellbookCount) : [];
  const preparedSpellIds = tpl.preparedCaster
    ? (tpl.spellbookCount > 0 ? spellbookSpellIds : sortedLvl1).slice(0, 4)
    : [];

  // Auto-select Level 1 subclass if the class picks at Level 1 (cleric, sorcerer, warlock)
  const subclasses = defaultCompendium.subclasses.filter((s) => s.classId === classId);
  const lvl1Subclass = classData.subclassLevel === 1 ? subclasses[0] : undefined;
  const lvl1SubclassId = lvl1Subclass?.id;

  // Populate all Level 1 choices while tracking already-granted proficiencies to avoid duplicates
  const raceData = defaultCompendium.getRace(raceChoice.raceId);
  const subraceData = 'subraceId' in raceChoice ? defaultCompendium.getSubrace(raceChoice.subraceId) : undefined;
  const bgData = defaultCompendium.getBackground('acolyte');

  const possessed = new Set<string>([
    ...(raceData?.languages ?? []),
    ...(raceData?.proficiencies?.skills ?? []),
    ...(subraceData?.languages ?? []),
    ...(subraceData?.proficiencies?.skills ?? []),
    ...(bgData?.skillProficiencies ?? []),
    ...(bgData?.toolProficiencies ?? []),
    ...(bgData?.languages ?? []),
    ...(raceChoice.raceId === 'elf' ? ['perception'] : []),
    ...(raceChoice.raceId === 'half-orc' ? ['intimidation'] : []),
  ]);

  const racialChoices: Record<string, string[]> = {
    ...autoResolveChoices(raceData?.choices, rng, possessed),
    ...autoResolveChoices(subraceData?.choices, rng, possessed),
  };
  for (const trait of [...(raceData?.traits ?? []), ...(subraceData?.traits ?? [])]) {
    Object.assign(racialChoices, autoResolveChoices(trait.choices, rng, possessed));
  }
  const backgroundChoices: Record<string, string[]> = {
    ...autoResolveChoices(bgData?.choices, rng, possessed),
  };

  const lvl1Choices: Record<string, string[]> = {
    ...autoResolveChoices(classData.skillChoices, rng, possessed),
    ...autoResolveChoices(classData.toolChoices, rng, possessed),
    ...autoResolveChoices(classData.startingEquipmentChoices, rng, possessed),
  };
  const lvl1FeatureIds = [
    ...(classData.levels?.find((e) => e.level === 1)?.featureIds ?? []),
    ...(lvl1Subclass?.featuresByLevel?.['1'] ?? []),
  ];
  for (const fid of lvl1FeatureIds) {
    const feat = defaultCompendium.getFeature(fid);
    if (feat?.choices) {
      Object.assign(lvl1Choices, autoResolveChoices(feat.choices, rng, possessed));
    }
  }

  const heroId = `soak_${seed}_${classId}_${slotIndex + 1}`;
  const inventory: CharacterBuildState['inventory'] = [];
  const equippedSlots: CharacterBuildState['equippedSlots'] = {};

  if (tpl.armorId && defaultCompendium.getEquipment(tpl.armorId)) {
    const instId = `${heroId}-armor`;
    inventory.push({ instanceId: instId, itemId: tpl.armorId, quantity: 1 });
    equippedSlots.armorInstanceId = instId;
  }
  if (tpl.shield && defaultCompendium.getEquipment('shield')) {
    const instId = `${heroId}-shield`;
    inventory.push({ instanceId: instId, itemId: 'shield', quantity: 1 });
    equippedSlots.shieldInstanceId = instId;
  }
  if (defaultCompendium.getEquipment(tpl.mainWeaponId)) {
    const instId = `${heroId}-main`;
    inventory.push({ instanceId: instId, itemId: tpl.mainWeaponId, quantity: 1 });
    equippedSlots.mainHandInstanceId = instId;
  }
  if (tpl.rangedWeaponId && defaultCompendium.getEquipment(tpl.rangedWeaponId)) {
    const instId = `${heroId}-ranged`;
    inventory.push({ instanceId: instId, itemId: tpl.rangedWeaponId, quantity: 1 });
    equippedSlots.rangedInstanceId = instId;
  }
  // Deterministic consumable for the USE_ITEM soak path (SRD-1303): every soak
  // hero carries exactly one healing potion so the bot can drink under fire.
  if (defaultCompendium.getEquipment('potion-of-healing')) {
    inventory.push({ instanceId: `${heroId}-potion-healing`, itemId: 'potion-of-healing', quantity: 1 });
  }

  const build: CharacterBuildState = {
    id: heroId,
    version: 1,
    name: `${classData.name} ${slotIndex + 1}`,
    portraitId: `portrait-${classId}`,
    tokenSpriteId: `token-${classId}`,
    alignment: 'neutral_good',
    raceId: raceChoice.raceId,
    ...('subraceId' in raceChoice ? { subraceId: raceChoice.subraceId } : {}),
    racialChoices,
    backgroundId: 'acolyte',
    backgroundChoices,
    abilityMethod: 'standard_array',
    baseAbilities,
    classes: [
      {
        classId,
        ...(lvl1SubclassId ? { subclassId: lvl1SubclassId } : {}),
        level: 1,
        hpRollsByLevel: [classData.hitDie],
        choiceSelectionsByLevel: {
          '1': lvl1Choices,
        },
        asiOrFeatByLevel: {},
      },
    ],
    currency: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
    inventory,
    equippedSlots,
    attunedItemInstanceIds: [],
    spellcasting: {
      knownCantripIds,
      knownSpellIds,
      spellbookSpellIds,
      preparedSpellIds,
    },
    runtime: {
      xp: 0,
      currentHp: classData.hitDie + Math.floor((baseAbilities.con - 10) / 2),
      tempHp: 0,
      hitDiceSpent: {},
      deathSaves: { successes: 0, failures: 0 },
      exhaustionLevel: 0,
      expendedSpellSlots: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 },
      expendedPactSlots: 0,
      resourceChargesSpent: {},
      activeConditions: [],
      activeEffects: [],
    },
  };

  const sheet = computeDerivedCharacter(build, defaultCompendium);
  build.runtime.currentHp = sheet.maxHp;
  telemetry.classesExercised.add(classId);

  return createCharacterCombatant(sheet, { x: 2 + (slotIndex % 2), y: 2 + Math.floor(slotIndex / 2) }, {
    side: 'party',
    teamId: 'party',
    buildState: build,
  });
}

/**
 * Builds a randomized 4-hero party for a given seed + batch index, guaranteeing
 * that across 3+ seeds all 12 SRD 5.1 classes are exercised.
 */
function buildRandomizedParty(seed: number, batchIndex: number): Combatant[] {
  const rng = makeRng(seed * 7919 + batchIndex * 104729);
  // Deal 4 distinct classes per batch from a deterministic shuffled deck of all 12 classes
  const deck = shuffleWithRng(ALL_SRD_CLASSES, makeRng(1337 + Math.floor(batchIndex / 3) * 997));
  const sliceStart = (batchIndex % 3) * 4;
  const chosenClasses = deck.slice(sliceStart, sliceStart + 4);
  return chosenClasses.map((cls, idx) => buildRandomClassHero(cls, idx, seed, rng));
}

/**
 * Builds a schema-valid LevelUpRequest for ANY SRD 5.1 class using `getLevelUpRequirements`.
 */
function buildAutoLevelUpRequest(
  build: CharacterBuildState,
  rng: () => number,
): LevelUpRequest | null {
  const classId = build.classes[0]!.classId as SrdClassId;
  const tpl = CLASS_TEMPLATES[classId];
  let req = getLevelUpRequirements(build, classId, defaultCompendium);
  if (!req.canAdvance) return null;

  let subclassId: string | undefined;
  if (req.subclassUnlock.required && !req.subclassUnlock.alreadyChosen) {
    subclassId = req.subclassUnlock.availableSubclasses[0]?.id;
    if (subclassId) {
      req = getLevelUpRequirements(build, classId, defaultCompendium, subclassId);
    }
  }

  const currentSheet = computeDerivedCharacter(build, defaultCompendium);
  const existingPicked = new Set<string>([
    ...currentSheet.proficiencies.skills,
    ...currentSheet.proficiencies.languages,
    ...currentSheet.proficiencies.tools,
  ]);
  for (const clsEntry of build.classes) {
    for (const lvlMap of Object.values(clsEntry.choiceSelectionsByLevel)) {
      for (const vals of Object.values(lvlMap)) {
        for (const v of vals) existingPicked.add(v);
      }
    }
  }
  const choiceSelections: Record<string, string[]> = autoResolveChoices(req.featureChoices, rng, existingPicked);
  if (req.requiresExpertise && req.expertiseChoiceKey && req.expertiseEligibleOptions.length >= 2) {
    choiceSelections[req.expertiseChoiceKey] = req.expertiseEligibleOptions.slice(0, 2);
  }

  let asiOrFeat: LevelUpRequest['asiOrFeat'];
  if (req.requiresAsiOrFeat) {
    const sheet = computeDerivedCharacter(build, defaultCompendium);
    const primScore = sheet.abilities[tpl.primary].score;
    const secScore = sheet.abilities[tpl.secondary].score;
    if (primScore <= 18) {
      asiOrFeat = { type: 'asi', bonuses: { [tpl.primary]: 2 } };
    } else if (primScore === 19 && secScore <= 19) {
      asiOrFeat = { type: 'asi', bonuses: { [tpl.primary]: 1, [tpl.secondary]: 1 } };
    } else if (secScore <= 18) {
      asiOrFeat = { type: 'asi', bonuses: { [tpl.secondary]: 2 } };
    } else {
      asiOrFeat = { type: 'asi', bonuses: { con: 2 } };
    }
  }

  const sc = req.spellcasting;
  let spellcastingUpdates: LevelUpRequest['spellcastingUpdates'];
  if (sc.isSpellcastingClass) {
    const alreadyCantrips = new Set(build.spellcasting.knownCantripIds);
    const alreadyKnown = new Set(build.spellcasting.knownSpellIds);
    const alreadyBook = new Set(build.spellcasting.spellbookSpellIds);

    const newCantrips = shuffleWithRng(
      sc.allowedCantripIds.filter((id) => !alreadyCantrips.has(id)),
      rng,
    ).slice(0, sc.newCantripsRequired);

    // Prefer newly unlocked higher-level spells so level-ups exercise 2nd/3rd level spells!
    const sortHighLevelFirst = (ids: string[]) =>
      shuffleWithRng(ids, rng).sort((a, b) => {
        const la = defaultCompendium.getSpell(a)?.level ?? 0;
        const lb = defaultCompendium.getSpell(b)?.level ?? 0;
        return lb - la;
      });

    const newKnown =
      sc.newSpellsKnownRequired > 0
        ? sortHighLevelFirst(sc.allowedSpellIds.filter((id) => !alreadyKnown.has(id))).slice(
            0,
            sc.newSpellsKnownRequired,
          )
        : [];
    const newBook =
      sc.newSpellbookSpellsAllowed > 0
        ? sortHighLevelFirst(sc.allowedSpellIds.filter((id) => !alreadyBook.has(id))).slice(
            0,
            sc.newSpellbookSpellsAllowed,
          )
        : [];

    // Update prepared spells for prepared casters to include newly unlocked higher-level spells
    let preparedSpellIds: string[] | undefined;
    if (sc.preparationMode === 'prepared' || sc.preparationMode === 'spellbook') {
      const pool =
        sc.preparationMode === 'spellbook'
          ? [...build.spellcasting.spellbookSpellIds, ...newBook]
          : sc.allowedSpellIds;
      const topPrepared = sortHighLevelFirst([...new Set(pool)]).slice(0, 6);
      preparedSpellIds = topPrepared;
    }

    spellcastingUpdates = {
      ...(newCantrips.length > 0 ? { addedCantripIds: newCantrips } : {}),
      ...(newKnown.length > 0 ? { addedKnownSpellIds: newKnown } : {}),
      ...(newBook.length > 0 ? { addedSpellbookSpellIds: newBook } : {}),
      ...(preparedSpellIds ? { preparedSpellIds } : {}),
    };
  }

  return {
    classId,
    ...(subclassId ? { subclassId } : {}),
    hpMethod: 'fixed',
    ...(Object.keys(choiceSelections).length > 0 ? { choiceSelections } : {}),
    ...(asiOrFeat ? { asiOrFeat } : {}),
    ...(spellcastingUpdates ? { spellcastingUpdates } : {}),
    enforceXpRequirement: true,
    requireSpellSelections: false,
  };
}

/**
 * Awards accelerated XP (so soak runs reach Level 3–5+) and levels up every eligible party hero
 * in a Dungeon exploration `GameState`, asserting level-up invariants.
 */
function awardAcceleratedXpAndLevelUpDungeon(
  state: GameState,
  xpAward: number,
  seed: number,
  rng: () => number,
): GameState {
  let nextState = state;
  for (const heroId of Object.keys(nextState.party)) {
    const hero = nextState.party[heroId]!;
    if (!hero.buildState) continue;

    // Award accelerated XP to backing buildState
    const awarded = awardCharacterXp(hero.buildState, xpAward);
    let updatedHero: Combatant = {
      ...hero,
      buildState: awarded.state,
      characterSheet: computeDerivedCharacter(awarded.state, defaultCompendium),
    };
    nextState = {
      ...nextState,
      party: { ...nextState.party, [heroId]: updatedHero },
    };

    // Level up as many times as XP allows (up to Level 5 in soak)
    let safety = 0;
    while (safety < 5) {
      safety++;
      const current = nextState.party[heroId]!;
      const b = current.buildState!;
      const curLvl = b.classes.reduce((s, c) => s + c.level, 0);
      if (curLvl >= 5 || !canLevelUpByXp(curLvl, b.runtime.xp)) break;

      const req = buildAutoLevelUpRequest(b, rng);
      if (!req) break;

      const validation = validateLevelUp(b, req, defaultCompendium);
      assertInvariant(
        'level-up',
        seed,
        validation.valid,
        `Level-up validation failed for ${current.name} (L${curLvl}->L${curLvl + 1}): ${validation.errors.join('; ')}`,
      );
      if (!validation.valid) break;

      const prevMaxHp = current.maxHp;
      const res = applyBetweenCombatLevelUp(nextState, heroId, req, defaultCompendium);
      nextState = res.nextState;
      const after = nextState.party[heroId]!;
      assertInvariant(
        'level-up',
        seed,
        after.maxHp > prevMaxHp && res.summary.newTotalLevel === curLvl + 1,
        `Level-up stat invariant failed for ${after.name}: HP ${prevMaxHp}->${after.maxHp}, lvl ${curLvl}->${res.summary.newTotalLevel}`,
      );
      telemetry.totalLevelUps++;
      telemetry.maxLevelReached = Math.max(telemetry.maxLevelReached, res.summary.newTotalLevel);
    }
  }
  return nextState;
}

/**
 * Awards accelerated XP and levels up standalone Realm War party combatants between battles.
 */
function awardAcceleratedXpAndLevelUpParty(
  party: Combatant[],
  xpAward: number,
  seed: number,
  rng: () => number,
): Combatant[] {
  return party.map((hero) => {
    if (!hero.buildState) return hero;
    let build = awardCharacterXp(hero.buildState, xpAward).state;

    let safety = 0;
    while (safety < 5) {
      safety++;
      const curLvl = build.classes.reduce((s, c) => s + c.level, 0);
      if (curLvl >= 5 || !canLevelUpByXp(curLvl, build.runtime.xp)) break;

      const req = buildAutoLevelUpRequest(build, rng);
      if (!req) break;

      const validation = validateLevelUp(build, req, defaultCompendium);
      assertInvariant(
        'level-up',
        seed,
        validation.valid,
        `Realm level-up validation failed for ${hero.name} (L${curLvl}->L${curLvl + 1}): ${validation.errors.join('; ')}`,
      );
      if (!validation.valid) break;

      const applied = applyLevelUp(build, req, defaultCompendium);
      build = applied.state;
      telemetry.totalLevelUps++;
      telemetry.maxLevelReached = Math.max(telemetry.maxLevelReached, applied.summary.newTotalLevel);
    }

    const sheet = computeDerivedCharacter(build, defaultCompendium);
    build.runtime.currentHp = sheet.maxHp;
    return createCharacterCombatant(sheet, hero.position, {
      side: 'party',
      teamId: 'party',
      buildState: build,
    });
  });
}

function checkCombatInvariants(
  suite: string,
  seed: number,
  state: GameState,
  checkFog = true,
): void {
  const combat = state.combat;
  if (!combat) return;

  for (const c of Object.values(combat.combatants)) {
    assertInvariant(
      suite,
      seed,
      Number.isFinite(c.currentHp) && Number.isFinite(c.maxHp),
      `Non-finite HP on ${c.id}: ${c.currentHp}/${c.maxHp}`,
    );
  }
  if (combat.phase === 'active_turn' && combat.activeCombatantId) {
    const active = combat.combatants[combat.activeCombatantId];
    assertInvariant(
      suite,
      seed,
      Boolean(active) && !(active!.side === 'monster' && (active!.isDead || active!.currentHp <= 0)),
      `Dead/missing monster holds activeCombatantId: ${combat.activeCombatantId}`,
    );
  }

  // Concentration cleanup invariant
  for (const caster of Object.values(combat.combatants)) {
    if (!caster.concentratingOn) {
      for (const target of Object.values(combat.combatants)) {
        const staleEffects = (target.activeEffects ?? []).filter(
          (e) => e.requiresConcentration && e.sourceCombatantId === caster.id,
        );
        const staleConds = (target.activeConditions ?? []).filter(
          (c) => c.requiresConcentration && c.sourceCombatantId === caster.id,
        );
        assertInvariant(
          suite,
          seed,
          staleEffects.length === 0 && staleConds.length === 0,
          `Stale concentration buff from ${caster.id} remained on ${target.id}`,
        );
      }
    }
  }

  // Darkness / Fog visibility invariant
  if (checkFog) {
    const view = projectPlayerView(state, 'player-1');
    const livingHeroes = Object.values(combat.combatants).filter(
      (c) => c.side === 'party' && !c.isDead && c.currentHp > 0,
    );
    for (const enemy of Object.values(combat.combatants)) {
      if (enemy.side === 'party' || enemy.isDead || enemy.currentHp <= 0) continue;
      const visibleToHero = livingHeroes.some((h) => {
        const dv = h.senses?.darkvision ?? h.characterSheet?.senses?.darkvision ?? 0;
        const distFt = Math.max(Math.abs(h.position.x - enemy.position.x), Math.abs(h.position.y - enemy.position.y)) * 5;
        if (dv > 0 && distFt <= dv && hasLineOfSight(state.grid, h.position, enemy.position)) {
          return true;
        }
        const cell = state.grid.cells[enemy.position.y]?.[enemy.position.x];
        if (cell && cell.baseLight !== 'darkness' && hasLineOfSight(state.grid, h.position, enemy.position)) {
          return true;
        }
        return false;
      });
      if (visibleToHero) {
        assertInvariant(
          suite,
          seed,
          Boolean(view.combat?.combatants[enemy.id]),
          `Visible enemy ${enemy.id} missing from projected PlayerViewState`,
        );
      }
    }
  }
}

/**
 * Proactive Hero Ability & Spell Planner for automated playtesting:
 * Exercises class features (`USE_CLASS_FEATURE`) and diverse spells (`DECLARE_CAST_SPELL`)
 * across all 12 SRD classes before falling through to `planAiTurn` for movement/weapons.
 */
function buildHeroAbilityAndSpellCommands(state: GameState, actorId: string, rng: () => number): GameCommand[] {
  const combat = state.combat;
  if (!combat || combat.phase !== 'active_turn' || combat.activeCombatantId !== actorId) return [];
  const actor = combat.combatants[actorId];
  if (!actor || actor.side !== 'party' || actor.isDead || actor.currentHp <= 0) return [];
  const budget = combat.turnBudget;
  if (!budget) return [];

  const cmds: GameCommand[] = [];
  const hostiles = Object.values(combat.combatants).filter(
    (c) => c.side !== 'party' && !c.isDead && c.currentHp > 0,
  );
  const allies = Object.values(combat.combatants).filter(
    (c) => c.side === 'party' && !c.isDead && c.currentHp > 0,
  );
  if (hostiles.length === 0) return [];

  const nearestHostile = [...hostiles].sort(
    (a, b) =>
      getFootprintDistanceFeet(actor.position, actor.size, a.position, a.size) -
      getFootprintDistanceFeet(actor.position, actor.size, b.position, b.size),
  )[0]!;
  const woundedAlly = [...allies]
    .filter((a) => a.currentHp < a.maxHp * 0.75)
    .sort((a, b) => a.currentHp / a.maxHp - b.currentHp / b.maxHp)[0];

  let bonusLeft = budget.bonusAction;
  let actionLeft = budget.action;

  // 0. Drink a healing potion when hurt (USE_ITEM consumables path, SRD-1303).
  // Checked first: item-granted abilities can no longer fire through
  // USE_CLASS_FEATURE (engine guard), so the bot must drink via USE_ITEM —
  // exactly like the UI hotbar does. Healing now spends the turn's action,
  // like real play.
  const missingHp = actor.maxHp - actor.currentHp;
  if (actionLeft > 0 && missingHp >= 4) {
    const potion = actor.buildState?.inventory.find(
      (i) => i.itemId === 'potion-of-healing' && i.quantity > 0,
    );
    if (potion) {
      return [
        {
          type: 'USE_ITEM',
          actorId: actor.id,
          itemInstanceId: potion.instanceId,
          targetId: actor.id,
        },
      ];
    }
  }

  // 1. Try activating an available Class Feature (Rage, Second Wind, Action Surge, Bardic Inspiration, Lay on Hands, Channel Divinity, Ki, etc.)
  const abilities = actor.characterSheet?.activatedAbilities ?? [];

  for (const ab of shuffleWithRng(abilities, rng)) {
    if (ab.actionCost === 'reaction' || ab.actionCost === 'movement' || ab.actionCost === 'special') continue;
    if (ab.actionCost === 'bonus_action' && bonusLeft <= 0) continue;
    if (ab.actionCost === 'action' && actionLeft <= 0) continue;

    // Check resource pool availability
    if (ab.resourceCost) {
      const pool = actor.characterSheet?.resources?.[ab.resourceCost.resourceId];
      if (!pool || pool.available < ab.resourceCost.amount) continue;
    }

    // Contextual gating so we don't waste heals at full HP
    const idLower = ab.id.toLowerCase();
    if ((idLower.includes('second-wind') || idLower.includes('lay-on-hands')) && actor.currentHp >= actor.maxHp * 0.85 && !woundedAlly) {
      continue;
    }
    if (idLower.includes('rage') && (actor.activeEffects ?? []).some((e) => e.name.toLowerCase().includes('rage'))) {
      continue;
    }

    let targetId: string | undefined;
    if (ab.targetType === 'self') {
      targetId = actor.id;
    } else if (ab.targetType === 'ally') {
      const allyTarget = woundedAlly ?? allies.find((a) => a.id !== actor.id) ?? actor;
      targetId = allyTarget.id;
    } else if (ab.targetType === 'enemy' || ab.targetType === 'creature') {
      targetId = nearestHostile.id;
    }

    cmds.push({
      type: 'USE_CLASS_FEATURE',
      actorId: actor.id,
      featureId: ab.id,
      ...(targetId ? { targetId } : {}),
    });
    if (ab.actionCost === 'bonus_action') bonusLeft--;
    if (ab.actionCost === 'action') actionLeft--;
    break; // One class feature trigger per turn pass
  }

  // 2. Try casting a diverse Spell (Heal -> Buff/Concentration -> Offensive Leveled -> Cantrip)
  const sc = actor.buildState?.spellcasting;
  if (sc && (actionLeft > 0 || bonusLeft > 0)) {
    const candidateSpellIds = [
      ...new Set([...sc.preparedSpellIds, ...sc.knownSpellIds, ...sc.knownCantripIds]),
    ];
    const availableSlots = getAvailableSpellSlotLevels(actor, 1);

    const tryPickSpell = (predicate: (sp: NonNullable<ReturnType<typeof defaultCompendium.getSpell>>) => boolean) => {
      for (const sid of shuffleWithRng(candidateSpellIds, rng)) {
        const sp = defaultCompendium.getSpell(sid);
        if (!sp || !predicate(sp)) continue;
        const isBonus = sp.castingTime.toLowerCase().includes('bonus');
        if (isBonus && bonusLeft <= 0) continue;
        if (!isBonus && actionLeft <= 0) continue;
        if (sp.level > 0) {
          const slot = availableSlots.find((lvl) => lvl >= sp.level);
          if (!slot) continue;
          return { spell: sp, slotLevel: slot, isBonus };
        }
        return { spell: sp, slotLevel: 0, isBonus };
      }
      return null;
    };

    // Priority A: Heal a wounded ally
    let picked = woundedAlly
      ? tryPickSpell((sp) => sp.level > 0 && (sp.id === 'healing-word' || sp.id === 'cure-wounds' || sp.id === 'mass-healing-word'))
      : null;

    let targetIds: string[] = [];
    let aoeOrigin: { x: number; y: number } | undefined;

    if (picked && woundedAlly) {
      targetIds = [woundedAlly.id];
    } else {
      // Priority B: Cast a concentration/buff spell if not currently concentrating
      if (!actor.concentratingOn) {
        picked = tryPickSpell((sp) =>
          sp.level > 0 &&
          ['bless', 'shield-of-faith', 'heroism', 'barkskin', 'mage-armor'].includes(sp.id),
        );
        if (picked) {
          targetIds = picked.spell.id === 'bless' ? allies.slice(0, 3).map((a) => a.id) : [actor.id];
        }
      }

      // Priority C: Offensive leveled spell (1st, 2nd, 3rd level)
      if (!picked && hasLineOfSight(state.grid, actor.position, nearestHostile.position)) {
        picked = tryPickSpell((sp) => {
          if (sp.level <= 0) return false;
          const dist = getFootprintDistanceFeet(actor.position, actor.size, nearestHostile.position, nearestHostile.size);
          const rangeFt = sp.rangeFeet ?? (sp.areaOfEffect ? 15 : 30);
          return dist <= Math.max(15, rangeFt) && Boolean(sp.damage || sp.savingThrow || sp.attackType);
        });
        if (picked) {
          if (picked.spell.areaOfEffect) {
            const geo = pointAoeGeometry(nearestHostile.position, actor.position);
            aoeOrigin = picked.spell.areaOfEffect.shape === 'cube' ? geo.cubeAnchor : nearestHostile.position;
          } else {
            targetIds = [nearestHostile.id];
          }
        }
      }

      // Priority D: Damage cantrip
      if (!picked && hasLineOfSight(state.grid, actor.position, nearestHostile.position)) {
        picked = tryPickSpell((sp) => {
          if (sp.level !== 0) return false;
          const dist = getFootprintDistanceFeet(actor.position, actor.size, nearestHostile.position, nearestHostile.size);
          const rangeFt = sp.rangeFeet ?? 30;
          return dist <= rangeFt && Boolean(sp.damage || sp.savingThrow || sp.attackType);
        });
        if (picked) {
          targetIds = [nearestHostile.id];
        }
      }
    }

    if (picked) {
      cmds.push({
        type: 'DECLARE_CAST_SPELL',
        actorId: actor.id,
        spellId: picked.spell.id,
        ...(picked.slotLevel > 0 ? { slotLevel: picked.slotLevel } : {}),
        ...(targetIds.length > 0 ? { targetIds } : {}),
        ...(aoeOrigin ? { originCell: aoeOrigin } : {}),
      });
    }
  }

  return cmds;
}

function runHeadlessCombat(
  suite: string,
  seed: number,
  initialState: GameState,
  maxTurns = 60,
): { finalState: GameState; turnsPlayed: number; outcome: string } {
  let state = initialState;
  const rng = makeRng(seed * 31 + 17);
  let turnsPlayed = 0;
  let guardSteps = 0;

  while (
    state.combat &&
    state.combat.phase !== 'combat_ended' &&
    turnsPlayed < maxTurns &&
    guardSteps < maxTurns * 4
  ) {
    guardSteps++;
    if (state.combat.pendingReactionPrompt) {
      const prompt = state.combat.pendingReactionPrompt;
      state = reduceGame(
        state,
        {
          type: 'RESOLVE_REACTION_PROMPT',
          promptId: prompt.promptId,
          reactorId: prompt.reactorEntityId,
          decision: 'decline',
        },
        { compendium: defaultCompendium },
      ).nextState;
      continue;
    }

    const activeId = state.combat.activeCombatantId;
    if (!activeId) break;

    const executeAndTrack = (cmd: GameCommand): boolean => {
      if (!state.combat || state.combat.phase === 'combat_ended') return false;
      if (state.combat.pendingReactionPrompt) {
        const prompt = state.combat.pendingReactionPrompt;
        state = reduceGame(
          state,
          {
            type: 'RESOLVE_REACTION_PROMPT',
            promptId: prompt.promptId,
            reactorId: prompt.reactorEntityId,
            decision: 'decline',
          },
          { compendium: defaultCompendium },
        ).nextState;
      }
      try {
        if (cmd.type === 'USE_ITEM') {
          const user = state.combat?.combatants[cmd.actorId];
          const used = user?.buildState?.inventory.find(
            (i) => i.instanceId === cmd.itemInstanceId,
          );
          recordCount(telemetry.itemsUsed, used?.itemId ?? cmd.itemInstanceId);
        }
        const res = reduceGame(state, cmd, { compendium: defaultCompendium });
        state = res.nextState;
        if (cmd.type === 'DECLARE_CAST_SPELL') {
          recordCount(telemetry.spellsCast, cmd.spellId);
        } else if (cmd.type === 'USE_CLASS_FEATURE') {
          recordCount(telemetry.featuresUsed, cmd.featureId);
        }
        for (const ev of res.events) {
          if (ev.type === 'CONCENTRATION_BROKEN') {
            telemetry.concentrationBrokenEvents++;
          }
        }
        return true;
      } catch {
        return false;
      }
    };

    // 1. For party heroes, proactively exercise class features & diverse spells first
    const proactiveCmds = buildHeroAbilityAndSpellCommands(state, activeId, rng);
    for (const cmd of proactiveCmds) {
      executeAndTrack(cmd);
    }

    // 2. Follow up with planAiTurn for movement and remaining budget (hold END_TURN until after weapon attacks)
    if (state.combat && state.combat.phase === 'active_turn' && state.combat.activeCombatantId === activeId) {
      const plan = planAiTurn({
        state: state.combat,
        activeCombatantId: activeId,
        grid: state.grid,
      });
      for (const cmd of plan.commands) {
        if (!state.combat || state.combat.phase === 'combat_ended') break;
        if (state.combat.activeCombatantId !== activeId) break;
        if (cmd.type === 'END_TURN' && state.combat.combatants[activeId]?.side === 'party') {
          continue;
        }
        executeAndTrack(cmd);
      }
    }

    // 3. For party heroes, if action/attacks remain after moving, swing equipped melee or ranged weapon!
    if (
      state.combat &&
      state.combat.phase === 'active_turn' &&
      state.combat.activeCombatantId === activeId &&
      state.combat.combatants[activeId]?.side === 'party'
    ) {
      for (let swing = 0; swing < 3; swing++) {
        if (!state.combat || state.combat.phase !== 'active_turn' || state.combat.activeCombatantId !== activeId) break;
        const hero = state.combat.combatants[activeId]!;
        const budget = state.combat.turnBudget;
        if (!budget || (budget.action <= 0 && (budget.attacksRemaining ?? 0) <= 0)) break;

        const hostiles = Object.values(state.combat.combatants).filter(
          (c) => c.side !== 'party' && !c.isDead && c.currentHp > 0,
        );
        if (hostiles.length === 0) break;
        const nearest = [...hostiles].sort(
          (a, b) =>
            getFootprintDistanceFeet(hero.position, hero.size, a.position, a.size) -
            getFootprintDistanceFeet(hero.position, hero.size, b.position, b.size),
        )[0]!;
        const distFt = getFootprintDistanceFeet(hero.position, hero.size, nearest.position, nearest.size);

        // Pick main-hand melee weapon if adjacent, else equipped ranged weapon if in LoS
        const equipped = hero.buildState?.equippedSlots;
        let weaponInstanceId: string | undefined;
        if (distFt <= 5) {
          weaponInstanceId = equipped?.mainHandInstanceId;
        } else if (equipped?.rangedInstanceId && hasLineOfSight(state.grid, hero.position, nearest.position)) {
          weaponInstanceId = equipped.rangedInstanceId;
        } else {
          break;
        }

        const ok = executeAndTrack({
          type: 'DECLARE_ATTACK',
          actorId: activeId,
          targetId: nearest.id,
          ...(weaponInstanceId ? { weaponInstanceId } : {}),
        });
        if (!ok) break;
      }
    }

    if (state.combat && state.combat.phase === 'active_turn' && state.combat.activeCombatantId === activeId) {
      state = reduceGame(state, { type: 'END_TURN', actorId: activeId }, { compendium: defaultCompendium }).nextState;
    }

    checkCombatInvariants(suite, seed, state, turnsPlayed % 3 === 0);
    turnsPlayed++;
  }

  const outcome = state.combat?.outcome ?? 'unknown';
  if (turnsPlayed >= maxTurns && outcome === 'in_progress' && state.combat) {
    const alive = Object.values(state.combat.combatants)
      .filter((c) => !c.isDead && c.currentHp > 0)
      .map((c) => `${c.id}(${c.side},hp=${c.currentHp}/${c.maxHp},pos=${c.position.x},${c.position.y})`)
      .join(', ');
    assertInvariant(
      suite,
      seed,
      false,
      `Combat hit maxTurns (${maxTurns}) without concluding (outcome=${outcome}; alive=[${alive}])`,
    );
  }

  return { finalState: state, turnsPlayed, outcome };
}

function runAoeInvariants(): void {
  const target = { x: 14, y: 7 };
  const cases = [
    { caster: { x: 15, y: 5 }, facing: 's' },
    { caster: { x: 15, y: 10 }, facing: 'n' },
    { caster: { x: 10, y: 7 }, facing: 'e' },
    { caster: { x: 17, y: 7 }, facing: 'w' },
  ] as const;
  for (const { caster, facing } of cases) {
    const geo = pointAoeGeometry(target, caster);
    const cells = rasterizeAoe({
      shape: 'cube',
      origin: geo.cubeAnchor,
      sideFeet: 10,
      facing: geo.facing,
    });
    assertInvariant(
      'aoe-cube',
      0,
      geo.facing === facing && cells.some((c) => c.x === target.x && c.y === target.y),
      `Cube AOE facing=${geo.facing} missed hovered cell (${target.x},${target.y})`,
    );
  }
}

function runDungeonSoak(seeds: number[]) {
  const campaign = getSunkenCryptModule();
  const floor1 = campaign.floors[0]!;
  let encountersCleared = 0;
  let totalTurns = 0;

  const encounterSpawns: Array<{ encId: string; partyCoords: Array<{ x: number; y: number }> }> = [
    {
      encId: 'enc_f1_rats', // f1_armory (baseLight: 'darkness')
      partyCoords: [
        { x: 8, y: 11 },
        { x: 8, y: 12 },
        { x: 9, y: 11 },
        { x: 9, y: 12 },
      ],
    },
    {
      encId: 'enc_f1_kobolds', // f1_warren
      partyCoords: [
        { x: 13, y: 12 },
        { x: 14, y: 12 },
        { x: 15, y: 12 },
        { x: 14, y: 11 },
      ],
    },
    {
      encId: 'enc_f1_goblin_boss', // f1_descent (baseLight: 'darkness')
      partyCoords: [
        { x: 4, y: 11 },
        { x: 4, y: 12 },
        { x: 4, y: 13 },
        { x: 5, y: 12 },
      ],
    },
  ];

  for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
    const seed = seeds[sIdx]!;
    const rng = makeRng(seed * 41 + 9);
    const party = buildRandomizedParty(seed, sIdx);
    let state = createDungeonGameState({ floor: floor1, party, rngState: seed });
    const transport = new LocalTransport({ initialState: state, defaultPlayerId: 'player-1' });
    assertInvariant('dungeon-soak', seed, Boolean(transport.getPlayerViewState('player-1')), 'LocalTransport failed to project view');

    for (const { encId, partyCoords } of encounterSpawns) {
      // Position & refresh party resources (like a Long Rest) inside the target room
      const heroes = Object.values(state.party);
      for (let i = 0; i < heroes.length; i++) {
        const h = heroes[i]!;
        if (h.buildState) {
          h.buildState.runtime.expendedSpellSlots = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 };
          h.buildState.runtime.expendedPactSlots = 0;
          h.buildState.runtime.resourceChargesSpent = {};
          const freshSheet = computeDerivedCharacter(h.buildState, defaultCompendium);
          h.characterSheet = freshSheet;
          h.maxHp = freshSheet.maxHp;
        }
        h.currentHp = h.maxHp;
        h.isDead = false;
        h.conditions = [];
        h.activeConditions = [];
        h.activeEffects = [];
        h.concentratingOn = undefined;
        h.position = { ...partyCoords[i % partyCoords.length]! };
      }

      const triggered = triggerDungeonEncounter(state, encId, { compendium: defaultCompendium });
      const { finalState, turnsPlayed, outcome } = runHeadlessCombat(`dungeon:${encId}`, seed, triggered.nextState, 120);
      totalTurns += turnsPlayed;
      if (outcome === 'party_victory') {
        encountersCleared++;
        state = transitionCombatToExploration(finalState).nextState;
        // Accelerated XP (950 XP per encounter -> Level 1 -> 2 -> 3 -> 4 across 3 encounters!)
        state = awardAcceleratedXpAndLevelUpDungeon(state, 950, seed, rng);
      } else {
        state = transitionCombatToExploration(finalState).nextState;
        // Still award partial accelerated XP so we keep exercising level-ups on subsequent rooms
        state = awardAcceleratedXpAndLevelUpDungeon(state, 400, seed, rng);
      }
    }
  }

  return {
    encountersCleared,
    totalEncounters: seeds.length * encounterSpawns.length,
    avgTurns: +(totalTurns / Math.max(1, seeds.length * encounterSpawns.length)).toFixed(1),
  };
}

function runRealmWarSoak(seeds: number[]) {
  let victories = 0;
  let defeats = 0;
  let totalBattles = 0;
  let totalBloodless = 0;
  let totalPatrols = 0;
  let totalTicks = 0;

  for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
    const seed = seeds[sIdx]!;
    const rng = makeRng(seed * 53 + 7);
    const gen = generateOverworldMap({ seed, width: 24, height: 24 });
    const settled = populateSettlements(gen.map, gen.settlementSites, { seed });
    const init = initializeWarState(settled.map, { seed });

    let war = init.war;
    let map = init.map;
    let diplomacy = createWarDiplomacyState();
    let rngState = init.nextRngState;
    let party = buildRandomizedParty(seed + 1000, sIdx + 1);
    let partySheets = party.map((c) => c.characterSheet!);

    const alignments = Object.values(war.nations).map((n) => n.alignment);
    assertInvariant('realm-war', seed, alignments.includes('good'), 'War nation roll missing Good nation');
    assertInvariant('realm-war', seed, alignments.includes('evil'), 'War nation roll missing Evil nation');

    const bridgeApproaches = buildMissionApproaches('destroy_bridge', 'bridge', { seed });
    assertInvariant(
      'realm-war',
      seed,
      bridgeApproaches.every((a) => !a.requiresSpellIds || a.requiresSpellIds.length === 0),
      'Bridge mission offered a teleport/spell approach',
    );

    const rivals = Object.values(war.nations).filter((n) => n.id !== war.playerNationId);
    const rivalId = rivals[0]!.id;

    // Enemy Territory Patrol + Threat escalation + Natural Decay
    const patrolRoll = rollPatrolEncounter({
      rngState,
      nationId: rivalId,
      day: war.currentDay,
      onRoad: true,
      war,
      party: partySheets,
    });
    rngState = patrolRoll.nextRngState;
    if (patrolRoll.encounter) {
      totalPatrols++;
      const res = resolvePatrolEncounter({
        encounter: patrolRoll.encounter,
        choice: 'bluff',
        party: partySheets,
        rngState,
      });
      rngState = res.nextRngState;
      const afterKill = reportPatrolKill(war, { nationId: rivalId, day: war.currentDay });
      const threat = getNationThreat(afterKill.war, rivalId);
      assertInvariant('realm-war', seed, threat >= 25, `Expected threat >= 25 after patrol kill, got ${threat}`);
      const decayed = decayWarThreats(afterKill.war, 10);
      assertInvariant(
        'realm-war',
        seed,
        getNationThreat(decayed, rivalId) < threat,
        'Expected threat to decay after 10 days',
      );
      void isPursuitActiveForThreat(threat);
    }

    // Diplomacy & Sub-Factions
    const truce = negotiateTruce({
      war,
      diplomacy,
      targetNationId: rivalId,
      party: partySheets,
      rngState,
      days: 10,
      goldAvailable: 500,
    });
    rngState = truce.nextRngState;
    war = truce.war;
    diplomacy = truce.diplomacy;

    const merc = hireMercenaryCompany({
      war,
      diplomacy,
      goldAvailable: 500,
      days: 10,
      rngState,
    });
    war = merc.war;
    diplomacy = merc.diplomacy;

    // Run 2 sequential war mission battles per seed with accelerated XP & level-ups between them!
    const pois = getStrategicPOIs(map);
    const targetPoi = pois.find((p) => p.factionId && p.factionId !== war.playerNationId) ?? pois[0];
    if (targetPoi) {
      for (let battleIdx = 0; battleIdx < 2; battleIdx++) {
        const missionKind = battleIdx === 0 ? 'sabotage_enemy_mine' : 'assassinate_general';
        const avgLevel = Math.max(
          1,
          Math.round(
            party.reduce((sum, h) => sum + (h.characterSheet?.totalLevel ?? 1), 0) / Math.max(1, party.length),
          ),
        );
        const approaches = buildMissionApproaches(missionKind, targetPoi.kind, { seed: rngState });
        const chosenApproach = approaches[Math.min(battleIdx, approaches.length - 1)]!;
        const approachRes = resolveMissionApproach({
          approachId: chosenApproach.id,
          approaches,
          mission: {
            id: `soak_m_${seed}_${battleIdx}`,
            kind: missionKind,
            title: `Soak ${missionKind}`,
            briefing: 'Automated soak mission',
            issuerNationId: war.playerNationId,
            targetNationId: targetPoi.factionId ?? rivalId,
            poiId: targetPoi.id,
            poiName: targetPoi.name,
            poiKind: targetPoi.kind,
            tier: Math.min(3, Math.max(1, Math.ceil(avgLevel / 2))),
            rewardGold: 200,
            rewardXp: 350,
            expiresOnDay: war.currentDay + 14,
            approaches,
            status: 'active',
          },
          party: partySheets,
          rngState,
        });
        rngState = approachRes.nextRngState;

        if (approachRes.outcome === 'bloodless_success') {
          totalBloodless++;
        } else {
          const warBattle = generateWarMissionBattle(
            {
              seed: rngState,
              missionKind,
              poiId: targetPoi.id,
              poiName: targetPoi.name,
              terrain: 'plains',
              targetNationId: targetPoi.factionId ?? rivalId,
              party,
              partyAverageLevel: avgLevel,
              modifiers: approachRes.modifiers,
            },
            defaultCompendium,
          );
          const started = startOverworldBattle({ battle: warBattle.battle, party });
          const { outcome } = runHeadlessCombat(`realm:${missionKind}`, seed, started.gameState, 120);
          totalBattles++;
          if (outcome === 'party_victory') {
            victories++;
          } else if (outcome === 'monsters_victory') {
            defeats++;
          }
        }

        // Accelerated XP (3,250 XP per mission -> drives party through Level 1 -> 4 -> 5!)
        party = awardAcceleratedXpAndLevelUpParty(party, 3250, seed, rng);
        partySheets = party.map((c) => c.characterSheet!);
      }
    }

    for (let step = 0; step < 6 && war.outcome === 'ongoing'; step++) {
      const tick = advanceWarSimulation(war, map, { toDay: war.currentDay + war.tickIntervalDays });
      war = tick.war;
      map = tick.map;
      totalTicks++;
      for (const n of Object.values(war.nations)) {
        assertInvariant(
          'realm-war',
          seed,
          Number.isFinite(getWarNationTotal(n)) && getWarNationTotal(n) >= 0,
          `Invalid War Power on nation ${n.id}: ${getWarNationTotal(n)}`,
        );
      }
    }
  }

  return {
    seedsRun: seeds.length,
    totalTicks,
    totalBattles,
    victories,
    defeats,
    totalBloodless,
    totalPatrols,
  };
}

function main() {
  const startMs = Date.now();
  const seedCount = Math.max(1, Number(process.argv[2] ?? 3) || 3);
  const seeds = Array.from({ length: seedCount }, (_, i) => 101 * (i + 1));

  console.log(`🎲 Running Automated Headless Soak & Invariant Playtest (${seeds.length} seeds, randomized 12-class parties + accelerated XP)...\n`);

  runAoeInvariants();
  console.log('  ✓ AOE geometry invariants checked');
  const dungeonStats = runDungeonSoak(seeds);
  console.log('  ✓ Dungeon darkness, class abilities & multi-level-up soak completed');
  const realmStats = runRealmWarSoak(seeds);
  console.log('  ✓ Realm War campaign, classed-squad & L1→L5 progression soak completed\n');

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(2);
  const totalSpellCasts = [...telemetry.spellsCast.values()].reduce((a, b) => a + b, 0);
  const totalFeatureUses = [...telemetry.featuresUsed.values()].reduce((a, b) => a + b, 0);
  const totalItemsUsed = [...telemetry.itemsUsed.values()].reduce((a, b) => a + b, 0);
  const topSpells = [...telemetry.spellsCast.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');
  const topFeatures = [...telemetry.featuresUsed.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');

  console.log('📊 Playtest Telemetry Summary');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`  SRD Classes Exercised:             ${telemetry.classesExercised.size}/12 (${[...telemetry.classesExercised].sort().join(', ')})`);
  console.log(`  Progression (Accelerated XP):      ${telemetry.totalLevelUps} level-ups applied · Max Level reached: L${telemetry.maxLevelReached}`);
  console.log(`  Spells Cast:                       ${totalSpellCasts} casts across ${telemetry.spellsCast.size} distinct spells`);
  if (topSpells) console.log(`    Top Spells:                      ${topSpells}`);
  console.log(`  Class Features Used:               ${totalFeatureUses} activations across ${telemetry.featuresUsed.size} distinct features`);
  if (topFeatures) console.log(`    Top Features:                    ${topFeatures}`);
  console.log(`  Consumables Used (USE_ITEM):       ${totalItemsUsed} drinks across ${telemetry.itemsUsed.size} distinct items`);
  console.log(`  Concentration Checks Broken:       ${telemetry.concentrationBrokenEvents}`);
  console.log(`  Dungeon Soak (Kaelen F1 Darkness): ${dungeonStats.encountersCleared}/${dungeonStats.totalEncounters} cleared (avg ${dungeonStats.avgTurns} turns)`);
  console.log(`  Realm War Soak (${realmStats.seedsRun} seeds):         ${realmStats.totalTicks} ticks · ${realmStats.totalBattles} battles (${realmStats.victories}W/${realmStats.defeats}L) · ${realmStats.totalBloodless} bloodless · ${realmStats.totalPatrols} patrols`);
  console.log(`  Elapsed:                           ${elapsedSec}s`);
  console.log(`  Invariant Violations:              ${failures.length}`);
  console.log('────────────────────────────────────────────────────────────────────');

  if (failures.length > 0) {
    console.error('\n❌ Invariant Failures Detected:');
    for (const f of failures.slice(0, 20)) {
      console.error(`  [${f.suite} | seed=${f.seed}] ${f.detail}`);
    }
    process.exit(1);
  }

  // Assert minimum exercise diversity on 3+ seed runs
  if (seedCount >= 3) {
    if (telemetry.classesExercised.size < 12) {
      console.error(`\n❌ Expected all 12 SRD classes exercised across ${seedCount} seeds, got ${telemetry.classesExercised.size}`);
      process.exit(1);
    }
    if (telemetry.totalLevelUps === 0 || telemetry.maxLevelReached < 3) {
      console.error(`\n❌ Expected multi-level-up progression (L3+), got ${telemetry.totalLevelUps} level-ups (max L${telemetry.maxLevelReached})`);
      process.exit(1);
    }
    if (totalItemsUsed === 0) {
      console.error(`\n❌ Expected soak combat to exercise USE_ITEM consumables (SRD-1303), got 0 potion drinks`);
      process.exit(1);
    }
  }

  console.log('\n✅ All headless soak, 12-class progression, spell/ability & gameplay invariants passed!');
}

main();
