import { z } from 'zod';
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacterByClass,
} from '@srd5/data';
import { applyLevelUp, getLevelUpRequirements } from '../character/level-up.js';
import { computeDerivedCharacter } from '../character/derived.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import { createCharacterCombatant, createMonsterCombatant } from '../combat/combatant.js';
import type { Combatant } from '../combat/types.js';
import {
  generateBattleTerrainGrid,
  generateOverworldBattle,
  type GeneratedOverworldBattle,
} from './battles.js';
import type { OverworldPOI } from './schemas.js';
import { normalizeSeed } from '../dice/prng.js';
import { RealmError } from './realm-error.js';

/**
 * SRD-1102 — Dynamic-CR class-based enemy squads, class-kit AI hooks, and
 * multi-wave Protect-POI defense battles (Spec 10 §4).
 *
 * Enemy garrisons are real SRD 5.1 classed NPCs (`fighter`, `wizard`,
 * `cleric`, `rogue`) built via `computeDerivedCharacter()` +
 * `createCharacterCombatant(..., { side: 'monster' })`, scaled to the party's
 * average level (dynamic CR). `generateWarMissionBattle()` layers timed
 * `WaveReinforcementSpec[]` waves plus `WarBattleModifiers` from the Approach
 * phase (SRD-1103) on top of the SRD-804 battle generator.
 *
 * All functions are pure and deterministic: every random choice threads the
 * seeded Mulberry32 PRNG. `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Squad classes & specs
// ---------------------------------------------------------------------------

export const WAR_SQUAD_CLASSES = ['fighter', 'wizard', 'cleric', 'rogue'] as const;
export const WarSquadClassSchema = z.enum(WAR_SQUAD_CLASSES);
export type WarSquadClass = z.infer<typeof WarSquadClassSchema>;

export const WAR_SQUAD_DEFAULT_SUBCLASS: Record<WarSquadClass, string> = {
  fighter: 'champion',
  wizard: 'evocation',
  cleric: 'life',
  rogue: 'thief',
};

export const WAR_SQUAD_PRIMARY_ABILITY: Record<WarSquadClass, 'str' | 'dex' | 'int' | 'wis'> = {
  fighter: 'str',
  wizard: 'int',
  cleric: 'wis',
  rogue: 'dex',
};

/** Nation-flavored SRD monster garnish paired with a classed squad. */
export const WAR_SQUAD_MONSTER_POOLS: Record<string, string[]> = {
  default: ['orc', 'goblin', 'bandit', 'scout', 'thug', 'skeleton', 'zombie'],
  evil: ['orc', 'skeleton', 'zombie', 'ghoul', 'cultist', 'gnoll'],
  good: ['scout', 'guard', 'bandit', 'acolyte', 'noble'],
};

export const WarSquadMemberSpecSchema = z.object({
  classId: WarSquadClassSchema,
  level: z.number().int().min(1).max(20),
  count: z.number().int().min(1).max(6).default(1),
});
export type WarSquadMemberSpec = z.infer<typeof WarSquadMemberSpecSchema>;

export const BuildWarSquadOptionsSchema = z.object({
  /** Average party level — squads scale 1:1 (dynamic CR). */
  partyLevel: z.number().int().min(1).max(20).default(1),
  seed: z.number().int().optional(),
  /** War nation footing this squad (drives ids, names, monster garnish). */
  nationId: z.string().min(1).default('ashen-spire'),
  /** Combat team for every squad combatant (default: hostile war band). */
  teamId: z.string().min(1).default('war_enemies'),
  /** Explicit class mix; defaults to a balanced Warrior/Mage/Cleric/Thief cell. */
  composition: z.array(WarSquadClassSchema).min(1).max(8).optional(),
  idPrefix: z.string().min(1).optional(),
});
export type BuildWarSquadOptions = z.infer<typeof BuildWarSquadOptionsSchema>;

export interface BuiltWarSquadMember {
  buildState: CharacterBuildState;
  sheet: DerivedCharacterSheet;
  combatant: Combatant;
}

export interface BuiltWarSquad {
  members: BuiltWarSquadMember[];
  averageLevel: number;
  nextRngState: number;
}

// ---------------------------------------------------------------------------
// Battle modifiers (Approach-phase outputs, Spec 10 §5) & wave reinforcements
// ---------------------------------------------------------------------------

export const WarBattleModifiersSchema = z.object({
  /** Which side (if any) opens the battle with surprise. */
  surpriseAttackerSide: z.enum(['party', 'enemy', 'none']).default('none'),
  /** Allied militia joining the party (Shieldwall Oath / Rally Militia). */
  extraAlliedMilitia: z.number().int().min(0).max(8).default(0),
  /** First reinforcement wave opens surprised (ambush traps / scout recon). */
  wave1EnemiesSurprised: z.boolean().default(false),
  /** Scales the number of spawned enemies (sabotage attrition, frontal assault). */
  enemyCountMultiplier: z.number().min(0.25).max(2).default(1),
  /** Bloodless or weakened garrison: reduce enemy starting HP by this fraction. */
  enemyHpMultiplier: z.number().min(0.25).max(1).default(1),
});
export type WarBattleModifiers = z.infer<typeof WarBattleModifiersSchema>;

export const WaveReinforcementSpecSchema = z.object({
  /** 1-indexed wave number (wave 1 is the opening garrison). */
  wave: z.number().int().min(1),
  /** Combat round on which this wave deploys (deterministic schedule). */
  deployRound: z.number().int().min(1),
  /** Classed squad composition for this wave. */
  squad: z.array(WarSquadClassSchema).min(1).max(8),
  /** Extra SRD monster ids padding this wave. */
  monsters: z.array(z.string().min(1)).default([]),
  /** Edge the wave enters from (flavor for `RealmBattleView`). */
  spawnEdge: z.enum(['north', 'south', 'east', 'west']).default('east'),
});
export type WaveReinforcementSpec = z.infer<typeof WaveReinforcementSpecSchema>;

export const GenerateWarMissionBattleOptionsSchema = z.object({
  seed: z.number().int(),
  /** War mission kind driving garrison size and wave count. */
  missionKind: z.string().min(1).default('protect_poi'),
  poi: z
    .object({ id: z.string().min(1), kind: z.string().min(1) })
    .passthrough()
    .optional(),
  /** Persistent party heroes entering the battle (combatants or sheets). */
  party: z.array(z.any()).min(1).max(6),
  partyAverageLevel: z.number().int().min(1).max(20).default(1),
  nationId: z.string().min(1).default('ashen-spire'),
  enemyTeamId: z.string().min(1).default('war_enemies'),
  modifiers: WarBattleModifiersSchema.default({}),
  /** Explicit waves; defaults to a level-scaled 2–3 wave defense for `protect_poi`. */
  waves: z.array(WaveReinforcementSpecSchema).optional(),
  terrain: z.string().min(1).default('plains'),
});
export type GenerateWarMissionBattleOptionsInput = z.input<
  typeof GenerateWarMissionBattleOptionsSchema
>;

export interface GeneratedWarMissionBattle {
  battle: GeneratedOverworldBattle;
  waves: WaveReinforcementSpec[];
  modifiers: WarBattleModifiers;
  enemies: Combatant[];
  /** Combatant ids for scheduled (not yet spawned) reinforcements, in wave order. */
  reinforcementQueue: Combatant[];
  alliedMilitia: Combatant[];
}

// ---------------------------------------------------------------------------
// Squad construction
// ---------------------------------------------------------------------------

function warSquadDisplayName(classId: WarSquadClass, level: number, index: number): string {
  const title =
    classId === 'fighter'
      ? 'War Blade'
      : classId === 'wizard'
        ? 'Battle Mage'
        : classId === 'cleric'
          ? 'War Priest'
          : 'Shadow Knife';
  return index <= 1 ? `${title} (Lv ${level})` : `${title} ${index} (Lv ${level})`;
}

/** Ensures level-scaled prepared spells so high-level squads can use their kit. */
function ensureWarSquadSpells(state: CharacterBuildState, classId: WarSquadClass): CharacterBuildState {
  const next: CharacterBuildState = structuredClone(state);
  const ensure = (list: string[] | undefined, ...ids: string[]): string[] => {
    const out = [...(list ?? [])];
    for (const id of ids) if (!out.includes(id)) out.push(id);
    return out;
  };
  if (classId === 'wizard') {
    const level = next.classes[0]?.level ?? 1;
    next.spellcasting.knownCantripIds = ensure(next.spellcasting.knownCantripIds, 'fire-bolt');
    if (level >= 5) {
      next.spellcasting.preparedSpellIds = ensure(
        next.spellcasting.preparedSpellIds,
        'magic-missile',
        'burning-hands',
        'fireball',
      );
      next.spellcasting.spellbookSpellIds = ensure(
        next.spellcasting.spellbookSpellIds,
        'magic-missile',
        'burning-hands',
        'fireball',
        'mage-armor',
        'shield',
      );
    } else {
      next.spellcasting.preparedSpellIds = ensure(
        next.spellcasting.preparedSpellIds,
        'magic-missile',
        'burning-hands',
      );
      next.spellcasting.spellbookSpellIds = ensure(
        next.spellcasting.spellbookSpellIds,
        'magic-missile',
        'burning-hands',
        'mage-armor',
        'shield',
      );
    }
  } else if (classId === 'cleric') {
    next.spellcasting.knownCantripIds = ensure(next.spellcasting.knownCantripIds, 'sacred-flame');
    next.spellcasting.preparedSpellIds = ensure(
      next.spellcasting.preparedSpellIds,
      'bless',
      'cure-wounds',
      'healing-word',
      'guiding-bolt',
    );
  }
  return next;
}

function levelWarSquadState(
  base: CharacterBuildState,
  classId: WarSquadClass,
  targetLevel: number,
  subclassId: string,
  primary: 'str' | 'dex' | 'int' | 'wis',
  comp: SrdCompendium,
): CharacterBuildState {
  let state = base;
  const secondary = 'con' as const;
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    const reqs = getLevelUpRequirements(state, classId, comp);
    const needsSubclass = reqs.subclassUnlock.required;
    const needsAsi = reqs.requiresAsiOrFeat;
    // Keep ASIs under the 20 cap: prefer +2 primary, else split +1/+1.
    const currentPrimary = state.baseAbilities[primary] ?? 10;
    const asiBonuses =
      currentPrimary <= 18
        ? { [primary]: 2 as const }
        : { [primary]: 1 as const, [secondary]: 1 as const };
    const result = applyLevelUp(
      state,
      {
        classId,
        hpMethod: 'fixed',
        ...(needsSubclass ? { subclassId } : {}),
        ...(needsAsi ? { asiOrFeat: { type: 'asi', bonuses: asiBonuses } } : {}),
      },
      comp,
    );
    state = result.state;
  }
  return state;
}

/**
 * Builds one level-scaled classed NPC from its iconic pregen template:
 * clones the template, advances it with fixed-HP level-ups (auto subclass +
 * primary-stat ASI), then pins level-appropriate war spells.
 */
export function buildWarSquadMember(
  classId: WarSquadClass,
  level: number,
  options: {
    seed?: number;
    nationId?: string;
    teamId?: string;
    idPrefix?: string;
    index?: number;
    compendium?: SrdCompendium;
  } = {},
  compendium: SrdCompendium = defaultCompendium,
): BuiltWarSquadMember {
  const comp = options.compendium ?? compendium;
  const clampedLevel = Math.max(1, Math.min(20, Math.floor(level)));
  const template = getPregenCharacterByClass(classId);
  if (!template) throw new RealmError(`No iconic template for war squad class '${classId}'`);
  const nationId = options.nationId ?? 'ashen-spire';
  const teamId = options.teamId ?? 'war_enemies';
  const index = options.index ?? 1;
  const prefix = options.idPrefix ?? `war_${nationId}_${classId}`;

  let state: CharacterBuildState = structuredClone(template);
  state.id = `${prefix}_lv${clampedLevel}_${index}`;
  state.name = warSquadDisplayName(classId, clampedLevel, index);

  const subclassId = state.classes[0]?.subclassId ?? WAR_SQUAD_DEFAULT_SUBCLASS[classId];
  const primary = WAR_SQUAD_PRIMARY_ABILITY[classId];

  state = levelWarSquadState(state, classId, clampedLevel, subclassId, primary, comp);
  state = ensureWarSquadSpells(state, classId);
  const sheet = computeDerivedCharacter(state, comp);
  const combatant = createCharacterCombatant(sheet, { x: 0, y: 0 }, {
    side: 'monster',
    teamId,
    factionId: nationId,
    buildState: state,
  });
  return { buildState: state, sheet, combatant };
}

/**
 * Builds a full war squad scaled to the party's average level (dynamic CR):
 * one member per requested class (default: Warrior/Mage/Cleric/Thief cell).
 * Deterministic in `seed` (member order + spawn jitter only).
 */
export function buildWarSquad(
  rawOptions: Partial<BuildWarSquadOptions> = {},
  compendium: SrdCompendium = defaultCompendium,
): BuiltWarSquad {
  const options = BuildWarSquadOptionsSchema.parse(rawOptions);
  const level = Math.max(1, Math.min(20, Math.floor(options.partyLevel)));
  const composition = options.composition ?? (['fighter', 'wizard', 'cleric', 'rogue'] as WarSquadClass[]);
  const members = composition.map((classId, i) =>
    buildWarSquadMember(
      classId,
      level,
      {
        seed: options.seed,
        nationId: options.nationId,
        teamId: options.teamId,
        idPrefix: options.idPrefix,
        index: i + 1,
      },
      compendium,
    ),
  );
  return { members, averageLevel: level, nextRngState: normalizeSeed((options.seed ?? 0) + members.length) };
}

// ---------------------------------------------------------------------------
// War mission battles (multi-wave)
// ---------------------------------------------------------------------------

function defaultWavesForMission(
  missionKind: string,
  partyLevel: number,
): WaveReinforcementSpec[] {
  if (missionKind === 'protect_poi') {
    // 2–3 waves scaled to party level: the opening garrison plus timed relief
    // columns. Higher parties (Lv 5+) earn a third elite wave.
    const waves: WaveReinforcementSpec[] = [
      { wave: 1, deployRound: 1, squad: ['fighter', 'fighter', 'cleric'], monsters: ['orc'], spawnEdge: 'east' },
      { wave: 2, deployRound: 3, squad: ['wizard', 'rogue', 'fighter'], monsters: ['orc'], spawnEdge: 'west' },
    ];
    if (partyLevel >= 5) {
      waves.push({
        wave: 3,
        deployRound: 5,
        squad: ['wizard', 'cleric', 'fighter', 'rogue'],
        monsters: ['ogre'],
        spawnEdge: 'north',
      });
    }
    return WaveReinforcementSpecSchema.array().parse(waves);
  }
  return WaveReinforcementSpecSchema.array().parse([
    { wave: 1, deployRound: 1, squad: ['fighter', 'wizard'], monsters: [], spawnEdge: 'east' },
  ]);
}

function pickMonsterPool(nationId: string): string[] {
  if (nationId === 'ashen-spire' || nationId === 'bloodtusk-horde') return WAR_SQUAD_MONSTER_POOLS.evil!;
  if (nationId === 'dawn-crown' || nationId === 'emerald-circle' || nationId === 'silver-bastion') {
    return WAR_SQUAD_MONSTER_POOLS.good!;
  }
  return WAR_SQUAD_MONSTER_POOLS.default!;
}

function edgeSpawnPoint(edge: WaveReinforcementSpec['spawnEdge']): { x: number; y: number } {
  switch (edge) {
    case 'west':
      return { x: 2, y: 12 };
    case 'north':
      return { x: 12, y: 2 };
    case 'south':
      return { x: 12, y: 21 };
    case 'east':
    default:
      return { x: 21, y: 12 };
  }
}

/**
 * Generates a war-mission tactical battle: a 24×24 SRD-804 grid seeded from
 * the mission, an opening garrison (wave 1) placed on the east edge, and a
 * deterministic reinforcement queue for later waves (`protect_poi`
 * defenses). `modifiers` from the Approach phase tune surprise, militia, and
 * enemy counts/HP.
 */
export function generateWarMissionBattle(
  rawOptions: GenerateWarMissionBattleOptionsInput,
  compendium: SrdCompendium = defaultCompendium,
): GeneratedWarMissionBattle {
  const options = GenerateWarMissionBattleOptionsSchema.parse(rawOptions);
  const modifiers = WarBattleModifiersSchema.parse(options.modifiers ?? {});
  const partyLevel = Math.max(1, Math.min(20, Math.floor(options.partyAverageLevel)));
  const waves = (options.waves ?? defaultWavesForMission(options.missionKind, partyLevel)).map((w, i) => ({
    ...w,
    wave: i + 1,
  }));
  const firstWave = waves[0] ?? {
    wave: 1,
    deployRound: 1,
    squad: ['fighter'] as WarSquadClass[],
    monsters: [] as string[],
    spawnEdge: 'east' as const,
  };

  const terrainGen = generateBattleTerrainGrid(
    (options.terrain as 'plains' | 'forest' | 'hills' | 'mountains' | 'swamp' | 'desert' | 'tundra' | 'coast') ?? 'plains',
    normalizeSeed(options.seed),
    { width: 24, height: 24, partySize: Math.min(6, Math.max(1, options.party.length)) },
  );

  // Opening garrison: classed squad scaled to party level + monster garnish.
  const openingSquad = buildWarSquad(
    {
      partyLevel,
      seed: options.seed,
      nationId: options.nationId,
      teamId: options.enemyTeamId,
      composition: firstWave.squad as WarSquadClass[],
      idPrefix: `war_${options.seed}_w1`,
    },
    compendium,
  );
  const scaledMonsterCount = Math.max(
    0,
    Math.round(firstWave.monsters.length * modifiers.enemyCountMultiplier),
  );
  const pool = pickMonsterPool(options.nationId);
  const garnishIds: string[] = [];
  for (let i = 0; i < scaledMonsterCount; i++) {
    const requested = firstWave.monsters[i];
    if (requested && compendium.getMonster(requested)) garnishIds.push(requested);
    else if (pool[i % pool.length] && compendium.getMonster(pool[i % pool.length]!)) {
      garnishIds.push(pool[i % pool.length]!);
    }
  }

  const enemyCount = openingSquad.members.length + garnishIds.length;
  const monsterCount = Math.max(1, Math.min(12, Math.round(enemyCount * modifiers.enemyCountMultiplier)));

  const battleSeedPayload = {
    seed: normalizeSeed(options.seed),
    terrain: terrainGen.template.terrain,
    origin: 'wilderness' as const,
    width: 24,
    height: 24,
    crTier: Math.min(6, 1 + Math.floor(Math.max(0, partyLevel - 1) / 2)),
    partySize: Math.min(6, Math.max(1, options.party.length)),
    monsterCount,
    monsterPool: garnishIds.length > 0 ? garnishIds : pool,
    ...(options.poi ? { poiId: (options.poi as { id: string }).id } : {}),
  };
  const battle: GeneratedOverworldBattle = generateOverworldBattle(battleSeedPayload, compendium);

  // Place the opening classed squad on the monster spawn cells; overflow
  // members share the last cell. Apply the HP attrition modifier.
  const enemies: Combatant[] = openingSquad.members.map((member, i) => {
    const spawn = battle.monsters[i % Math.max(1, battle.monsters.length)]?.position
      ?? terrainGen.monsterSpawnCells[i % terrainGen.monsterSpawnCells.length]!
      ?? { x: 20, y: 12 };
    const combatant: Combatant = {
      ...member.combatant,
      id: `${member.combatant.id}_spawn${i + 1}`,
      position: { ...spawn },
      isSurprised:
        modifiers.surpriseAttackerSide === 'party' || modifiers.wave1EnemiesSurprised,
    };
    if (modifiers.enemyHpMultiplier < 1) {
      const scaled = Math.max(1, Math.floor(combatant.maxHp * modifiers.enemyHpMultiplier));
      combatant.maxHp = scaled;
      combatant.currentHp = Math.min(combatant.currentHp, scaled);
    }
    return combatant;
  });

  // Scheduled reinforcements: classed squads for waves 2+ (spawned by
  // `RealmBattleView` on their `deployRound` or once the prior wave falls).
  const reinforcementQueue: Combatant[] = [];
  for (const wave of waves.slice(1)) {
    const squad = buildWarSquad(
      {
        partyLevel,
        seed: options.seed + wave.wave * 1013,
        nationId: options.nationId,
        teamId: options.enemyTeamId,
        composition: wave.squad as WarSquadClass[],
        idPrefix: `war_${options.seed}_w${wave.wave}`,
      },
      compendium,
    );
    for (const member of squad.members) {
      const combatant: Combatant = {
        ...member.combatant,
        id: `${member.combatant.id}_wave${wave.wave}`,
        position: { ...edgeSpawnPoint(wave.spawnEdge) },
        isSurprised: false,
      };
      if (modifiers.enemyHpMultiplier < 1) {
        const scaled = Math.max(1, Math.floor(combatant.maxHp * modifiers.enemyHpMultiplier));
        combatant.maxHp = scaled;
        combatant.currentHp = Math.min(combatant.currentHp, scaled);
      }
      reinforcementQueue.push(combatant);
    }
    for (const monsterId of wave.monsters) {
      const data = compendium.getMonster(monsterId);
      if (!data) continue;
      const monster = createMonsterCombatant(data, `war_${options.seed}_w${wave.wave}_${monsterId}`, edgeSpawnPoint(wave.spawnEdge), {
        side: 'monster',
        teamId: options.enemyTeamId,
        factionId: options.nationId,
      });
      reinforcementQueue.push({
        ...monster,
        isSurprised: modifiers.wave1EnemiesSurprised && wave.wave === 2,
      });
    }
  }

  // Allied militia reinforcements (Shieldwall Oath / Rally Militia) arrive
  // with the party on the west edge as guard statblocks.
  const alliedMilitia: Combatant[] = [];
  if (modifiers.extraAlliedMilitia > 0) {
    const guard = compendium.getMonster('guard');
    if (guard) {
      for (let i = 0; i < modifiers.extraAlliedMilitia; i++) {
        const spawn = terrainGen.partySpawnCells[i % terrainGen.partySpawnCells.length] ?? { x: 2, y: 12 };
        const militia = createMonsterCombatant(guard, `war_militia_${options.seed}_${i + 1}`, { ...spawn }, {
          side: 'party',
          teamId: 'party',
          factionId: options.nationId,
        });
        alliedMilitia.push({ ...militia, name: `${militia.name} (Militia)` });
      }
    }
  }

  return { battle, waves, modifiers, enemies, reinforcementQueue, alliedMilitia };
}

/** Type-guard for war-mission POIs eligible for multi-wave defense battles. */
export function isWarMissionPoi(poi: Pick<OverworldPOI, 'kind'>): boolean {
  return ['fortress', 'mine', 'bridge', 'supply_depot', 'prison_keep'].includes(poi.kind);
}

export function getWarSquadMonsterPool(nationId: string): string[] {
  return [...pickMonsterPool(nationId)];
}
