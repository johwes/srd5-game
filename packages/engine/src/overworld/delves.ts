import { z } from 'zod';
import { type SrdCompendium, defaultCompendium } from '@srd5/data';
import { type Combatant } from '../combat/types.js';
import {
  type DeepDescentRunState,
  STARTING_ROGUELITE_RATIONS,
  advanceRogueliteFloor,
  calculateRogueliteScore,
  checkRogueliteWipe,
  endRogueliteRun,
} from '../dungeon/roguelite.js';
import {
  type GeneratedDungeonFloor,
  generateDungeonFloor,
  getBiomeForDepth,
} from '../dungeon/generator.js';
import { createDungeonGameState } from '../dungeon/state.js';
import { type GameEvent, type GameState } from '../state/types.js';
import { normalizeSeed, nextRandomUint32 } from '../dice/prng.js';
import { type OverworldMap, type OverworldPOI } from './schemas.js';
import { RealmError } from './realm-error.js';
import { mixBattleSeed } from './battles.js';

/**
 * SRD-806 — Deep Descent fold-in: the Realm dungeon-delver (Spec 06 Section 4.3).
 *
 * `dungeon_entrance` POIs launch a bounded 2–4 floor delve built with the
 * SRD-508 procedural generator at the POI's depth-tier biome, running the
 * SRD-509 run loop (`DeepDescentRunState`: supplies, shrines, score) scoped to
 * the POI. `monster_lair` POIs resolve as single-floor boss clears with no run
 * scoring. `ancient_shrine` POIs reuse shrine blessings without a delve.
 *
 * Architectural invariant: every random choice threads the seeded Mulberry32
 * PRNG (`rngState` / deterministic seeds). `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Delve state
// ---------------------------------------------------------------------------

export const REALM_DELVE_KINDS = ['bounded_delve', 'lair_clear'] as const;
export const RealmDelveKindSchema = z.enum(REALM_DELVE_KINDS);
export type RealmDelveKind = z.infer<typeof RealmDelveKindSchema>;

/**
 * A Deep Descent run scoped to a single overworld POI. Extends the classic
 * `DeepDescentRunState` with the POI linkage and the bounded floor range.
 */
export interface RealmDelveState extends DeepDescentRunState {
  poiId: string;
  poiName: string;
  kind: RealmDelveKind;
  /** Depth tier the delve starts at (drives the biome). */
  startDepth: number;
  /** Inclusive final floor depth; descending past it clears the delve. */
  finalDepth: number;
  /** True when the party cleared the delve (vs. wiped or abandoned). */
  cleared: boolean;
}

export interface RealmDelveSession {
  delve: RealmDelveState;
  gameState: GameState;
  generatedFloor: GeneratedDungeonFloor;
}

/**
 * Deterministic floor count for a POI delve (Spec 06 §4.3): lairs are a single
 * floor; dungeon entrances roll a bounded 2–4 floors from the delve seed.
 */
export function getRealmDelveFloorCount(seed: number, kind: RealmDelveKind): number {
  if (kind === 'lair_clear') return 1;
  const roll = nextRandomUint32(normalizeSeed(seed));
  return 2 + (roll.value % 3);
}

/** Resolves the deterministic delve seed for a POI (explicit seed or map mix). */
export function getRealmDelveSeed(map: OverworldMap, poi: OverworldPOI): number {
  return poi.dungeonSeed ?? mixBattleSeed(map.worldSeed, poi.q, poi.r);
}

export interface StartRealmDelveOptions {
  map: OverworldMap;
  poi: OverworldPOI;
  /** Persistent party combatants (HP, slots, inventory and buildState preserved). */
  party: Combatant[];
  /** Rations carried into the delve (defaults to the classic starting supply). */
  startingRations?: number;
  runId?: string;
  compendium?: SrdCompendium;
}

/**
 * Generates the first floor of a POI delve and initializes its scoped run loop.
 * The party is cloned, never mutated, so results can be committed back later.
 */
export function startRealmDelve(options: StartRealmDelveOptions): RealmDelveSession {
  const { map, poi } = options;
  if (poi.kind !== 'dungeon_entrance' && poi.kind !== 'monster_lair') {
    throw new RealmError(`POI ${poi.id} (${poi.kind}) does not launch a delve`);
  }
  if (options.party.length === 0) {
    throw new RealmError('Cannot enter a delve without a party');
  }
  const compendium = options.compendium ?? defaultCompendium;
  const kind: RealmDelveKind = poi.kind === 'monster_lair' ? 'lair_clear' : 'bounded_delve';
  const seed = getRealmDelveSeed(map, poi);
  const startDepth = poi.depthTier ?? 1;
  const floorCount = getRealmDelveFloorCount(seed, kind);
  const finalDepth = startDepth + floorCount - 1;
  const biome = getBiomeForDepth(startDepth);

  const generatedFloor = generateDungeonFloor({
    depth: startDepth,
    seed,
    biome,
    targetRoomCount: 5,
    trapDensity: 0.25,
    shrineProbability: kind === 'bounded_delve' ? 0.8 : 0.5,
    // The entry floor is always reachable; deeper floors gate stairs behind keys.
    lockedStairsDoor: false,
  });

  const combatantsList = options.party.map((hero, idx) => {
    const spawnPoint =
      generatedFloor.floor.partySpawnCells[idx] ??
      generatedFloor.floor.partySpawnCells[0] ?? { x: 2, y: 2 };
    return {
      ...structuredClone(hero),
      side: 'party' as const,
      teamId: 'party',
      position: { x: spawnPoint.x, y: spawnPoint.y },
      isSurprised: false,
    };
  });

  const gameState = createDungeonGameState({
    id: `delve_${poi.id}_${seed}`,
    floor: generatedFloor.floor,
    party: combatantsList,
    leadExplorerId: combatantsList[0]?.id ?? 'hero-1',
    formation: 'single_file',
    partyInStealth: false,
    rngState: generatedFloor.nextRngState,
  });

  const suppliesRemaining = options.startingRations ?? STARTING_ROGUELITE_RATIONS;
  const partyRecord: Record<string, Combatant> = {};
  for (const c of combatantsList) partyRecord[c.id] = c;

  const delve: RealmDelveState = {
    runId: options.runId ?? `delve_${poi.id}_${seed}`,
    seed,
    currentDepth: startDepth,
    maxDepthReached: startDepth,
    party: partyRecord,
    suppliesRemaining,
    goldCollected: 0,
    monstersSlain: 0,
    totalXp: 0,
    turnsTaken: 0,
    shrineBlessings: [],
    activeCurses: [],
    restCount: { short: 0, long: 0 },
    score:
      kind === 'bounded_delve'
        ? calculateRogueliteScore({
            depth: startDepth,
            totalXp: 0,
            gold: 0,
            unusedRations: suppliesRemaining,
            longRests: 0,
            turnsTaken: 0,
          })
        : 0,
    isComplete: false,
    poiId: poi.id,
    poiName: poi.name,
    kind,
    startDepth,
    finalDepth,
    cleared: false,
  };

  // Reference the compendium so partial datasets still validate monster ids.
  void compendium;

  return { delve, gameState, generatedFloor };
}

/** Whether the delve can descend to another generated floor. */
export function canAdvanceRealmDelve(delve: RealmDelveState): boolean {
  return (
    delve.kind === 'bounded_delve' &&
    !delve.isComplete &&
    delve.currentDepth < delve.finalDepth
  );
}

/**
 * Descends to the next bounded delve floor, preserving party state and the
 * scoped run loop. Throws when the delve is already on its final floor.
 */
export function advanceRealmDelveFloor(
  delve: RealmDelveState,
  gameState: GameState,
  compendium: SrdCompendium = defaultCompendium,
): RealmDelveSession {
  if (!canAdvanceRealmDelve(delve)) {
    throw new RealmError(
      `Delve ${delve.poiId} cannot descend past depth ${delve.currentDepth} (final ${delve.finalDepth})`,
    );
  }
  const sess = advanceRogueliteFloor(delve, gameState, compendium);
  const nextDelve: RealmDelveState = {
    ...sess.runState,
    poiId: delve.poiId,
    poiName: delve.poiName,
    kind: delve.kind,
    startDepth: delve.startDepth,
    finalDepth: delve.finalDepth,
    cleared: false,
  };
  return { delve: nextDelve, gameState: sess.gameState, generatedFloor: sess.generatedFloor };
}

/**
 * Reports whether a single-floor lair has been cleared: every encounter has
 * been triggered and defeated, and the floor has returned to exploration.
 */
export function isLairFloorCleared(gameState: GameState): boolean {
  if (!gameState.dungeon || gameState.mode !== 'exploration') return false;
  const encounters = gameState.dungeon.encounters;
  if (encounters.length === 0) return false;
  if (!encounters.every((e) => e.triggered)) return false;
  const monsters = Object.values(gameState.monsters);
  if (monsters.length === 0) return false;
  return monsters.every((m) => m.isDead || m.currentHp <= 0);
}

export interface CompleteRealmDelveOptions {
  /** Whether the party cleared the delve (false on wipe / abandon). */
  cleared?: boolean;
  deathCause?: string;
}

/**
 * Concludes a POI delve. Bounded delves produce a final run score and a
 * graveyard entry (persisted per delve, Spec 06 §4.3); lairs clear with no run
 * scoring. A party wipe always marks the delve uncleared.
 */
export function completeRealmDelve(
  delve: RealmDelveState,
  gameState: GameState,
  options: CompleteRealmDelveOptions = {},
): RealmDelveState {
  const wiped = checkRogueliteWipe(delve, gameState);
  const cleared = (options.cleared ?? true) && !wiped;

  if (delve.kind === 'lair_clear') {
    const next = structuredClone(delve);
    next.isComplete = true;
    next.cleared = cleared;
    next.score = 0; // Lairs resolve as single-floor clears with no run scoring.
    next.deathCause =
      options.deathCause ?? (cleared ? `Cleared ${delve.poiName}` : 'Overcome in the lair');
    return next;
  }

  const deathCause =
    options.deathCause ??
    (cleared ? `Emerged victorious from ${delve.poiName}` : 'Overcome by the Dungeons');
  const ended = endRogueliteRun(delve, gameState, deathCause);
  return {
    ...ended,
    poiId: delve.poiId,
    poiName: delve.poiName,
    kind: delve.kind,
    startDepth: delve.startDepth,
    finalDepth: delve.finalDepth,
    cleared,
  };
}

// ---------------------------------------------------------------------------
// Ancient shrine POIs (Spec 06 §4.3 item 3)
// ---------------------------------------------------------------------------

export const OVERWORLD_SHRINE_TYPES = [
  'shrine_blood_god',
  'shrine_arcane_weave',
  'fountain_restoration',
] as const;
export type OverworldShrineType = (typeof OVERWORLD_SHRINE_TYPES)[number];

export interface OverworldShrineResult {
  party: Record<string, Combatant>;
  shrineType: OverworldShrineType;
  effectDescription: string;
  blessing: string;
  events: GameEvent[];
}

/**
 * Applies a Shrine of Fate blessing to the overworld party without a delve.
 * The shrine type is chosen deterministically from the POI seed. Effects mirror
 * the Deep Descent shrines (Spec 06 §3.2): Blood God vitality trade, Arcane Weave
 * slot restoration, and the Fountain of Restoration cleanse.
 */
export function activateOverworldShrine(
  map: OverworldMap,
  poi: OverworldPOI,
  party: Record<string, Combatant>,
  options: { seed?: number } = {},
): OverworldShrineResult {
  if (poi.kind !== 'ancient_shrine') {
    throw new RealmError(`POI ${poi.id} (${poi.kind}) is not an ancient shrine`);
  }
  const seed = options.seed ?? getRealmDelveSeed(map, poi);
  const shrineType =
    OVERWORLD_SHRINE_TYPES[nextRandomUint32(normalizeSeed(seed)).value % OVERWORLD_SHRINE_TYPES.length]!;
  const nextParty = structuredClone(party);
  const heroes = Object.values(nextParty).filter((h) => !h.isDead);
  const events: GameEvent[] = [];
  let effectDescription = '';
  let blessing = '';

  switch (shrineType) {
    case 'shrine_blood_god': {
      let totalReduction = 0;
      for (const hero of heroes) {
        const reduction = Math.max(1, Math.round(hero.maxHp * 0.15));
        const newMax = Math.max(1, hero.maxHp - reduction);
        hero.maxHp = newMax;
        if (hero.currentHp > newMax) hero.currentHp = newMax;
        if (hero.characterSheet) {
          hero.characterSheet.maxHp = newMax;
          if (hero.characterSheet.currentHp > newMax) hero.characterSheet.currentHp = newMax;
        }
        hero.blessings = hero.blessings ?? [];
        if (!hero.blessings.includes('shrine_blood_god')) hero.blessings.push('shrine_blood_god');
        totalReduction += reduction;
      }
      blessing = 'Shrine of the Blood God: +2 Attack Rolls (-15% Max HP)';
      effectDescription = `The party offered vitality to the Blood God, gaining +2 to attack rolls at the cost of ${totalReduction} total Max HP.`;
      break;
    }
    case 'shrine_arcane_weave': {
      for (const hero of heroes) {
        if (hero.spellSlots) {
          for (const pool of Object.values(hero.spellSlots)) {
            pool.expended = 0;
            pool.available = pool.max;
          }
        }
        if (hero.pactMagic) {
          hero.pactMagic.expendedSlots = 0;
          hero.pactMagic.availableSlots = hero.pactMagic.maxSlots;
        }
        if (hero.characterSheet?.spellcasting?.spellSlots) {
          for (const pool of Object.values(hero.characterSheet.spellcasting.spellSlots)) {
            pool.expended = 0;
            pool.available = pool.max;
          }
        }
      }
      blessing = 'Shrine of the Arcane Weave: All spell slots replenished';
      effectDescription = 'Arcane energy flooded through the party, restoring all spell slots.';
      break;
    }
    case 'fountain_restoration':
    default: {
      for (const hero of heroes) {
        hero.conditions = [];
        hero.exhaustionLevel = 0;
        hero.currentHp = hero.maxHp;
        if (hero.characterSheet) {
          hero.characterSheet.activeConditions = [];
          hero.characterSheet.exhaustionLevel = 0;
          hero.characterSheet.currentHp = hero.maxHp;
        }
      }
      blessing = 'Fountain of Restoration: Cleansed conditions & restored HP';
      effectDescription =
        'The pure fountain waters healed all wounds and washed away all conditions and exhaustion.';
      break;
    }
  }

  events.push({
    type: 'SHRINE_ACTIVATED',
    shrineId: poi.id,
    shrineType,
    actorId: heroes[0]?.id ?? 'party',
    effectDescription,
  });

  return { party: nextParty, shrineType, effectDescription, blessing, events };
}