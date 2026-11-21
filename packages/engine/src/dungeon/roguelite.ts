import {
  type BiomeTier,
  type CharacterBuildState,
  type LootBundleSpec,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { type Combatant } from '../combat/types.js';
import { applyConditionToCombatant } from '../combat/conditions.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { createCharacterCombatant } from '../combat/combatant.js';
import { createDungeonGameState } from './state.js';
import {
  type GeneratedDungeonFloor,
  generateDungeonFloor,
  getBiomeForDepth,
  getBiomeTheme,
} from './generator.js';
import {
  type ResolveRestOptions,
  resolveLongRest,
} from './rest.js';
import {
  type GameEvent,
  type GameState,
  type InteractiveProp,
} from '../state/types.js';
import { isAdjacent } from './props.js';
import { triggerDungeonEncounter } from './encounters.js';

export const STARTING_ROGUELITE_RATIONS = 10;
export const RATIONS_PER_LONG_REST = 4;

/**
 * Historical record of a completed or failed roguelite run (Spec 06 Section 3.1 & 3.2).
 */
export interface GraveyardEntry {
  runId: string;
  timestamp: string;
  depth: number;
  score: number;
  monstersSlain: number;
  goldCollected: number;
  deathCause: string;
  livingPartyCount: number;
  totalPartyCount: number;
  partyNames: string[];
  turnsTaken: number;
  isDaily?: boolean;
  dailyDate?: string;
  mode?: string;
}

/**
 * Full state representation of an active Deep Descent run (Spec 06 Section 3.1).
 */
export interface DeepDescentRunState {
  runId: string;
  seed: number;
  currentDepth: number;
  maxDepthReached: number;
  party: Record<string, Combatant>;
  suppliesRemaining: number;
  goldCollected: number;
  monstersSlain: number;
  totalXp: number;
  turnsTaken: number;
  shrineBlessings: string[];
  bloodGodFloorsRemaining?: number;
  activeCurses: string[];
  restCount: { short: number; long: number };
  score: number;
  isComplete: boolean;
  deathCause?: string;
  graveyardEntry?: GraveyardEntry;
  isDaily?: boolean;
  dailyDate?: string;
  mode?: string;
}

export interface RogueliteScoreFactors {
  depth: number;
  totalXp: number;
  gold: number;
  unusedRations: number;
  longRests: number;
  turnsTaken: number;
}

/**
 * Pure calculation of the Deep Descent Final Score (Spec 06 Section 3.2).
 * Formula:
 * FinalScore = (Depth * 1,000) + TotalXP + (Gold * 2) + (UnusedRations * 100) - (LongRests * 200) - (TurnsTaken * 2)
 * Clamped to >= 0.
 */
export function calculateRogueliteScore(factors: RogueliteScoreFactors): number {
  const rawScore =
    factors.depth * 1000 +
    factors.totalXp +
    factors.gold * 2 +
    factors.unusedRations * 100 -
    factors.longRests * 200 -
    factors.turnsTaken * 2;
  return Math.max(0, Math.floor(rawScore));
}

/**
 * Converts a loot bundle (cp, sp, ep, gp, pp) into total gold pieces (GP).
 */
export function calculateGoldFromLoot(loot?: LootBundleSpec): number {
  if (!loot) return 0;
  const cp = loot.cp ?? 0;
  const sp = loot.sp ?? 0;
  const ep = loot.ep ?? 0;
  const gp = loot.gp ?? 0;
  const pp = loot.pp ?? 0;
  return Math.floor(gp + pp * 10 + ep * 0.5 + sp * 0.1 + cp * 0.01);
}

/**
 * Returns default party characters if none are provided.
 */
export function getDefaultRogueliteParty(): CharacterBuildState[] {
  return [
    getPregenCharacter('pregen-fighter')!,
    getPregenCharacter('pregen-cleric')!,
    getPregenCharacter('pregen-rogue')!,
    getPregenCharacter('pregen-wizard')!,
  ].filter((c): c is CharacterBuildState => c !== undefined);
}

export interface CreateRogueliteRunOptions {
  runId?: string;
  seed?: number;
  partyCharacters?: CharacterBuildState[];
  startingRations?: number;
  compendium?: SrdCompendium;
  isDaily?: boolean;
  dailyDate?: string;
  mode?: string;
}

export interface RogueliteRunSession {
  runState: DeepDescentRunState;
  gameState: GameState;
  generatedFloor: GeneratedDungeonFloor;
}

/**
 * Initializes a new Deep Descent Roguelite Run at Depth 1 (Spec 06 Section 3.1).
 */
export function startRogueliteRun(options: CreateRogueliteRunOptions = {}): RogueliteRunSession {
  const runId = options.runId ?? `descent_${Date.now()}`;
  const seed = options.seed ?? 1337;
  const depth = 1;
  const compendium = options.compendium ?? defaultCompendium;
  const characters =
    options.partyCharacters && options.partyCharacters.length > 0
      ? options.partyCharacters
      : getDefaultRogueliteParty();

  const generatedFloor = generateDungeonFloor({
    depth,
    seed,
    biome: 'catacombs',
    targetRoomCount: 5,
    trapDensity: 0.25,
    shrineProbability: 0.8,
  });

  const partyCombatants: Record<string, Combatant> = {};
  const combatantsList = characters.map((char, idx) => {
    const sheet = computeDerivedCharacter(char, compendium);
    const spawnPoint =
      generatedFloor.floor.partySpawnCells[idx] ??
      generatedFloor.floor.partySpawnCells[0] ?? { x: 2, y: 2 };
    const combatant = createCharacterCombatant(sheet, spawnPoint, {
      side: 'party',
      teamId: 'party',
      playerId: 'player-1',
      buildState: char,
    });
    partyCombatants[combatant.id] = combatant;
    return combatant;
  });

  const gameState = createDungeonGameState({
    floor: generatedFloor.floor,
    party: combatantsList,
    leadExplorerId: combatantsList[0]?.id ?? 'hero-1',
    formation: 'single_file',
    partyInStealth: false,
    rngState: generatedFloor.nextRngState,
  });

  const suppliesRemaining = options.startingRations ?? STARTING_ROGUELITE_RATIONS;

  const runState: DeepDescentRunState = {
    runId,
    seed,
    currentDepth: depth,
    maxDepthReached: depth,
    party: partyCombatants,
    suppliesRemaining,
    goldCollected: 0,
    monstersSlain: 0,
    totalXp: 0,
    turnsTaken: 0,
    shrineBlessings: [],
    activeCurses: [],
    restCount: { short: 0, long: 0 },
    score: calculateRogueliteScore({
      depth,
      totalXp: 0,
      gold: 0,
      unusedRations: suppliesRemaining,
      longRests: 0,
      turnsTaken: 0,
    }),
    isComplete: false,
    ...(options.isDaily !== undefined ? { isDaily: options.isDaily } : {}),
    ...(options.dailyDate ? { dailyDate: options.dailyDate } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
  };

  return { runState, gameState, generatedFloor };
}

/**
 * Transitions party to the next procedural dungeon floor (Spec 06 Section 3.1 & 3.2).
 */
export function advanceRogueliteFloor(
  runState: DeepDescentRunState,
  currentGameState: GameState,
  compendium: SrdCompendium = defaultCompendium,
): RogueliteRunSession {
  const nextDepth = runState.currentDepth + 1;
  const nextBiome = getBiomeForDepth(nextDepth);
  const floorSeed = runState.seed + nextDepth * 104729;

  // Floor dimensions and rooms scale with depth
  const width = Math.min(50, 36 + Math.floor(nextDepth * 1.5));
  const height = Math.min(50, 36 + Math.floor(nextDepth * 1.5));
  const targetRoomCount = Math.min(10, 4 + Math.floor(nextDepth / 3));

  const generatedFloor = generateDungeonFloor({
    depth: nextDepth,
    seed: floorSeed,
    biome: nextBiome,
    width,
    height,
    targetRoomCount,
    shrineProbability: 0.75,
    lockedStairsDoor: nextDepth >= 3,
  });

  // Preserve existing party state across floor transitions
  const existingPartyList = Object.values(currentGameState.party);
  const updatedCombatants = existingPartyList.map((c, idx) => {
    const spawnPoint =
      generatedFloor.floor.partySpawnCells[idx] ??
      generatedFloor.floor.partySpawnCells[0] ?? { x: 2, y: 2 };
    return {
      ...structuredClone(c),
      position: { x: spawnPoint.x, y: spawnPoint.y },
    };
  });

  const nextGameState = createDungeonGameState({
    floor: generatedFloor.floor,
    party: updatedCombatants,
    marchingOrder: currentGameState.marchingOrder?.order,
    formation: currentGameState.marchingOrder?.formation ?? 'single_file',
    leadExplorerId:
      currentGameState.marchingOrder?.leadExplorerId ?? updatedCombatants[0]?.id,
    partyInStealth: currentGameState.partyInStealth ?? false,
    rngState: generatedFloor.nextRngState,
  });

  const nextRunState = structuredClone(runState);
  nextRunState.currentDepth = nextDepth;
  nextRunState.maxDepthReached = Math.max(nextRunState.maxDepthReached, nextDepth);

  // Update blood god blessing duration (3 floors)
  if (nextRunState.bloodGodFloorsRemaining !== undefined) {
    nextRunState.bloodGodFloorsRemaining -= 1;
    if (nextRunState.bloodGodFloorsRemaining <= 0) {
      delete nextRunState.bloodGodFloorsRemaining;
      // Remove blessing from party combatants
      for (const hero of Object.values(nextGameState.party)) {
        if (hero.blessings) {
          hero.blessings = hero.blessings.filter((b) => b !== 'shrine_blood_god');
        }
      }
      nextRunState.shrineBlessings = nextRunState.shrineBlessings.filter(
        (b) => !b.includes('Blood God'),
      );
    }
  }

  // Update party mapping in run state
  nextRunState.party = {};
  for (const c of updatedCombatants) {
    nextRunState.party[c.id] = c;
  }

  // Re-evaluate score
  nextRunState.score = calculateRogueliteScore({
    depth: nextRunState.currentDepth,
    totalXp: nextRunState.totalXp,
    gold: nextRunState.goldCollected,
    unusedRations: nextRunState.suppliesRemaining,
    longRests: nextRunState.restCount.long,
    turnsTaken: nextRunState.turnsTaken,
  });

  return {
    runState: nextRunState,
    gameState: nextGameState,
    generatedFloor,
  };
}

/**
 * Resolves a Long Rest in roguelite mode with ration consumption and starvation exhaustion (Spec 06 Section 3.2).
 */
export function resolveRogueliteLongRest(
  runState: DeepDescentRunState,
  gameState: GameState,
  options?: ResolveRestOptions,
): {
  nextRunState: DeepDescentRunState;
  nextGameState: GameState;
  events: GameEvent[];
  starved: boolean;
} {
  const nextRunState = structuredClone(runState);
  let nextGameState = structuredClone(gameState);
  const events: GameEvent[] = [];

  // Count conscious or living party members
  const livingHeroes = Object.values(nextGameState.party).filter(
    (c) => !c.isDead && c.currentHp > 0,
  );
  const requiredRations = Math.max(1, livingHeroes.length);

  if (nextRunState.suppliesRemaining >= requiredRations) {
    // Satiated Long Rest: consume rations and execute full rest
    nextRunState.suppliesRemaining -= requiredRations;
    nextRunState.restCount.long += 1;

    const restRes = resolveLongRest(
      nextGameState,
      {
        type: 'START_REST',
        restType: 'long',
        forceSafe: options?.forceSafe,
      },
      options,
    );

    nextGameState = restRes.nextState;
    events.push(...restRes.events);

    // Recompute score
    nextRunState.score = calculateRogueliteScore({
      depth: nextRunState.currentDepth,
      totalXp: nextRunState.totalXp,
      gold: nextRunState.goldCollected,
      unusedRations: nextRunState.suppliesRemaining,
      longRests: nextRunState.restCount.long,
      turnsTaken: nextRunState.turnsTaken,
    });

    return { nextRunState, nextGameState, events, starved: false };
  }

  // Starvation Long Rest: Insufficient rations!
  // Party does NOT recover HP or spell slots.
  // Each living party member gains 1 level of Exhaustion!
  const availableRations = nextRunState.suppliesRemaining;
  const rationsShort = requiredRations - availableRations;
  nextRunState.suppliesRemaining = 0;
  nextRunState.restCount.long += 1;

  for (const hero of livingHeroes) {
    const exhaustRes = applyConditionToCombatant(hero, 'exhaustion', {
      exhaustionLevelChange: 1,
    });
    nextGameState.party[hero.id] = exhaustRes.combatant;
    nextRunState.party[hero.id] = exhaustRes.combatant;

    events.push({
      type: 'ROGUELITE_STARVATION',
      actorId: hero.id,
      rationsConsumed: availableRations,
      rationsShort,
      exhaustionLevel: exhaustRes.combatant.exhaustionLevel ?? 1,
    });

    if ((exhaustRes.combatant.exhaustionLevel ?? 0) >= 6) {
      // Exhaustion level 6 is lethal!
      exhaustRes.combatant.isDead = true;
      exhaustRes.combatant.currentHp = 0;
    }
  }

  // Interrupted / Starved rest event
  events.push({
    type: 'REST_INTERRUPTED',
    restType: 'long',
    reason: 'combat',
  });

  // Check if starvation caused party wipe
  if (checkRogueliteWipe(nextRunState, nextGameState)) {
    const completed = endRogueliteRun(
      nextRunState,
      nextGameState,
      'Perished of Starvation and Exhaustion',
    );
    return {
      nextRunState: completed,
      nextGameState,
      events,
      starved: true,
    };
  }

  nextRunState.score = calculateRogueliteScore({
    depth: nextRunState.currentDepth,
    totalXp: nextRunState.totalXp,
    gold: nextRunState.goldCollected,
    unusedRations: nextRunState.suppliesRemaining,
    longRests: nextRunState.restCount.long,
    turnsTaken: nextRunState.turnsTaken,
  });

  return { nextRunState, nextGameState, events, starved: true };
}

/**
 * Activates a Shrine of Fate (Risk & Reward) (Spec 06 Section 3.2).
 */
export function activateShrine(
  runState: DeepDescentRunState,
  gameState: GameState,
  shrinePropId: string,
  actorId: string,
): {
  nextRunState: DeepDescentRunState;
  nextGameState: GameState;
  events: GameEvent[];
} {
  const nextRunState = structuredClone(runState);
  let nextGameState = structuredClone(gameState);
  const events: GameEvent[] = [];

  const prop = nextGameState.props.find((p) => p.id === shrinePropId);
  if (!prop) {
    throw new Error(`Shrine prop "${shrinePropId}" not found`);
  }
  if (prop.kind !== 'shrine') {
    throw new Error(`Prop "${shrinePropId}" is not a shrine`);
  }
  if (prop.state === 'open' || prop.state === 'triggered' || prop.state === 'destroyed') {
    throw new Error(`Shrine "${shrinePropId}" has already been used on this floor`);
  }

  const actor = nextGameState.party[actorId];
  if (!actor) {
    throw new Error(`Actor "${actorId}" not found in party`);
  }

  if (!isAdjacent(actor.position, { x: prop.x, y: prop.y })) {
    throw new Error(`Actor "${actorId}" is not adjacent to shrine "${shrinePropId}"`);
  }

  // Determine shrine type
  const shrineType = prop.shrineType ?? 'fountain_restoration';
  let effectDescription = '';

  switch (shrineType) {
    case 'shrine_blood_god': {
      // Blood God: +2 attack rolls for 3 floors; permanently reduce Max HP by 15%
      const reduction = Math.max(1, Math.round(actor.maxHp * 0.15));
      const newMax = Math.max(1, actor.maxHp - reduction);
      actor.maxHp = newMax;
      if (actor.currentHp > newMax) actor.currentHp = newMax;
      if (actor.characterSheet) {
        actor.characterSheet.maxHp = newMax;
        if (actor.characterSheet.currentHp > newMax) {
          actor.characterSheet.currentHp = newMax;
        }
      }

      // Add blessing to actor
      actor.blessings = actor.blessings ?? [];
      if (!actor.blessings.includes('shrine_blood_god')) {
        actor.blessings.push('shrine_blood_god');
      }

      nextRunState.bloodGodFloorsRemaining = 3;
      nextRunState.shrineBlessings.push(
        `Shrine of the Blood God: +2 Attack Rolls for 3 floors (-${reduction} Max HP)`,
      );
      effectDescription = `${actor.name} offered vitality to the Blood God. Max HP decreased by ${reduction}, gaining +2 to attack rolls for 3 floors.`;
      break;
    }

    case 'shrine_arcane_weave': {
      // Arcane Weave: Instantly restore all spell slots; spawns hostile Astral Specter ambush
      for (const hero of Object.values(nextGameState.party)) {
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

      nextRunState.shrineBlessings.push(
        'Shrine of the Arcane Weave: All spell slots replenished',
      );
      effectDescription =
        'Arcane energy flooded through the party, restoring all spell slots! But the disturbance summoned an Astral Specter!';

      // Spawn hostile Specter encounter
      const specterEncounterId = `shrine_ambush_${Date.now()}`;
      if (nextGameState.dungeon) {
        nextGameState.dungeon.encounters.push({
          id: specterEncounterId,
          roomId: actor.roomId ?? 'dungeon',
          triggered: false,
          monsters: [
            {
              monsterId: 'specter',
              spawnX: Math.max(0, prop.x + (prop.x > 0 ? -1 : 1)),
              spawnY: prop.y,
            },
          ],
        });

        // Trigger encounter immediately into combat
        const encRes = triggerDungeonEncounter(nextGameState, specterEncounterId, {
          explicitSurprisedEntityIds: [],
        });
        nextGameState = encRes.nextState;
        events.push(...encRes.events);
      }
      break;
    }

    case 'fountain_restoration':
    default: {
      // Fountain of Restoration: Remove all conditions, poison, and exhaustion; full HP heal
      for (const hero of Object.values(nextGameState.party)) {
        hero.conditions = [];
        hero.exhaustionLevel = 0;
        hero.currentHp = hero.maxHp;
        if (hero.characterSheet) {
          hero.characterSheet.activeConditions = [];
          hero.characterSheet.exhaustionLevel = 0;
          hero.characterSheet.currentHp = hero.maxHp;
        }
      }
      nextRunState.shrineBlessings.push(
        'Fountain of Restoration: Cleansed conditions & restored HP',
      );
      effectDescription =
        'The pure fountain waters healed all wounds and washed away all conditions and exhaustion.';
      break;
    }
  }

  // Mark shrine as used
  prop.state = 'open';

  events.push({
    type: 'SHRINE_ACTIVATED',
    shrineId: prop.id,
    shrineType,
    actorId,
    effectDescription,
  });

  events.push({
    type: 'PROP_STATE_CHANGED',
    propId: prop.id,
    prevState: 'closed',
    nextState: 'open',
    actorId,
  });

  return { nextRunState, nextGameState, events };
}

/**
 * Evaluates whether all party members are dead or in fatal condition (wipe).
 */
export function checkRogueliteWipe(
  runState: DeepDescentRunState,
  gameState: GameState,
): boolean {
  const partyMembers = Object.values(gameState.party);
  if (partyMembers.length === 0) return true;
  return partyMembers.every(
    (c) =>
      c.isDead ||
      (c.currentHp <= 0 && (c.deathSaves?.failures ?? 0) >= 3) ||
      (c.exhaustionLevel ?? 0) >= 6,
  );
}

/**
 * Concludes a roguelite run, producing final score and graveyard entry.
 */
export function endRogueliteRun(
  runState: DeepDescentRunState,
  gameState: GameState,
  deathCause?: string,
): DeepDescentRunState {
  const nextRunState = structuredClone(runState);
  nextRunState.isComplete = true;
  nextRunState.deathCause = deathCause ?? 'Slain in the Dungeons';

  const finalScore = calculateRogueliteScore({
    depth: nextRunState.currentDepth,
    totalXp: nextRunState.totalXp,
    gold: nextRunState.goldCollected,
    unusedRations: nextRunState.suppliesRemaining,
    longRests: nextRunState.restCount.long,
    turnsTaken: nextRunState.turnsTaken,
  });
  nextRunState.score = finalScore;

  const partyList = Object.values(gameState.party);
  const livingParty = partyList.filter(
    (c) => !c.isDead && c.currentHp > 0 && (c.exhaustionLevel ?? 0) < 6,
  );

  const graveyardEntry: GraveyardEntry = {
    runId: nextRunState.runId,
    timestamp: new Date().toISOString(),
    depth: nextRunState.maxDepthReached,
    score: finalScore,
    monstersSlain: nextRunState.monstersSlain,
    goldCollected: nextRunState.goldCollected,
    deathCause: nextRunState.deathCause,
    livingPartyCount: livingParty.length,
    totalPartyCount: partyList.length,
    partyNames: partyList.map((c) => c.name),
    turnsTaken: nextRunState.turnsTaken,
    ...(nextRunState.isDaily !== undefined ? { isDaily: nextRunState.isDaily } : {}),
    ...(nextRunState.dailyDate ? { dailyDate: nextRunState.dailyDate } : {}),
    ...(nextRunState.mode ? { mode: nextRunState.mode } : {}),
  };

  nextRunState.graveyardEntry = graveyardEntry;
  return nextRunState;
}

/**
 * Records monsters slain and awards XP / gold to the run.
 */
export function recordRunMonstersSlain(
  runState: DeepDescentRunState,
  count: number,
  xp: number,
  gold: number = 0,
): DeepDescentRunState {
  const next = structuredClone(runState);
  next.monstersSlain += count;
  next.totalXp += xp;
  next.goldCollected += gold;
  next.score = calculateRogueliteScore({
    depth: next.currentDepth,
    totalXp: next.totalXp,
    gold: next.goldCollected,
    unusedRations: next.suppliesRemaining,
    longRests: next.restCount.long,
    turnsTaken: next.turnsTaken,
  });
  return next;
}

/**
 * Adds supplies / rations found during exploration.
 */
export function addRunSupplies(
  runState: DeepDescentRunState,
  rationsCount: number,
): DeepDescentRunState {
  const next = structuredClone(runState);
  next.suppliesRemaining += Math.max(0, rationsCount);
  next.score = calculateRogueliteScore({
    depth: next.currentDepth,
    totalXp: next.totalXp,
    gold: next.goldCollected,
    unusedRations: next.suppliesRemaining,
    longRests: next.restCount.long,
    turnsTaken: next.turnsTaken,
  });
  return next;
}
