import { z } from 'zod';
import {
  type OverworldMap,
  type OverworldPOI,
} from './schemas.js';
import { type RealmEvent } from './realm-schemas.js';
import { getFactionByPoi } from './factions.js';
import { getSettlements } from './settlements.js';
import { RealmError } from './realm-error.js';
import { normalizeSeed, nextRandomFloat } from '../dice/prng.js';
import { QUEST_GIVER_NAMES } from './quests.js';

/**
 * Quest chains (SRD-809, Spec 06 §4.1 / §4.3).
 *
 * Single-posting quest boards (SRD-803) cover one-shot bounties and delves.
 * Quest chains layer multi-stage personal stories on top: stages run
 * talk → delve/lair/battle → choice → turn-in, with branches that lock each
 * other out, timed offers that expire, competing faction claims, and follow-up
 * chains that unlock on completion. Bounty/dungeon/fetch/escort stages resolve
 * through the existing tactical battle and POI delve commit-back — this module
 * only tracks stage pointers and rewards; `realmEngine` applies gold and
 * reputation and feeds POI visits / clears into the advance functions.
 *
 * World-state rule: cleared POIs stay cleared. Starting a chain auto-completes
 * combat stages whose target POI is already in `clearedPoiIds`, so the party is
 * never asked to re-clear a dungeon. There are no faction AI turns and no
 * territory control — reputation shifts are the only cross-faction effect.
 *
 * All functions are pure and deterministic. RNG is threaded through `rngState`;
 * `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const QUEST_CHAIN_STAGE_KINDS = [
  'talk',
  'bounty',
  'dungeon',
  'fetch',
  'escort',
  'choice',
  'turn_in',
] as const;
export const QuestChainStageKindSchema = z.enum(QUEST_CHAIN_STAGE_KINDS);
export type QuestChainStageKind = z.infer<typeof QuestChainStageKindSchema>;

/** Combat stage kinds resolve via battle/delve commit-back (Spec 06 §4.2/4.3). */
export const QUEST_CHAIN_COMBAT_STAGE_KINDS: readonly QuestChainStageKind[] = [
  'bounty',
  'dungeon',
  'fetch',
  'escort',
];

export const QuestChainReputationEffectSchema = z.object({
  factionId: z.string().min(1),
  delta: z.number().int(),
});
export type QuestChainReputationEffect = z.infer<typeof QuestChainReputationEffectSchema>;

export const QuestChainStageOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  /** Stage to advance to after this choice; absent ends the chain. */
  nextStageId: z.string().min(1).optional(),
  /** Applied immediately when the option is chosen (both ways: +chosen, −spurned). */
  reputationEffects: z.array(QuestChainReputationEffectSchema).default([]),
});
export type QuestChainStageOption = z.infer<typeof QuestChainStageOptionSchema>;

export const QuestChainStageSchema = z.object({
  id: z.string().min(1),
  kind: QuestChainStageKindSchema,
  title: z.string().min(1),
  description: z.string().default(''),
  /** Settlement / wilderness POI this stage points at (talk, combat, turn-in). */
  targetPoiId: z.string().min(1).optional(),
  targetName: z.string().min(1).optional(),
  /** Branch options for `choice` stages. */
  options: z.array(QuestChainStageOptionSchema).optional(),
  /** Linear successor for non-choice stages. */
  nextStageId: z.string().min(1).optional(),
});
export type QuestChainStage = z.infer<typeof QuestChainStageSchema>;

export const QuestChainDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  giverName: z.string().min(1).optional(),
  giverBlurb: z.string().min(1).optional(),
  /** Settlement board where the chain is offered. */
  originBoardPoiId: z.string().min(1),
  originFactionId: z.string().optional(),
  /** Chains sharing a group are competing offers: starting one locks the rest. */
  exclusiveGroupId: z.string().min(1).optional(),
  /** Prerequisite chain; the chain starts `locked` until it completes. */
  requiresCompletedChainId: z.string().min(1).optional(),
  /** Follow-ups unlocked (available) when this chain completes. */
  unlocksChainIds: z.array(z.string().min(1)).default([]),
  /** Days after starting before the offer expires (timed offers). */
  timeLimitDays: z.number().int().positive().optional(),
  stages: z.array(QuestChainStageSchema).min(1),
  finalRewardGold: z.number().int().nonnegative().default(0),
  finalReputationEffects: z.array(QuestChainReputationEffectSchema).default([]),
});
export type QuestChainDefinition = z.infer<typeof QuestChainDefinitionSchema>;

export const QUEST_CHAIN_STATUSES = [
  'available',
  'active',
  'completed',
  'failed',
  'locked',
] as const;
export const QuestChainStatusSchema = z.enum(QUEST_CHAIN_STATUSES);
export type QuestChainStatus = z.infer<typeof QuestChainStatusSchema>;

export const QuestChainProgressSchema = z.object({
  chainId: z.string().min(1),
  definitionId: z.string().min(1),
  status: QuestChainStatusSchema,
  currentStageId: z.string().min(1).optional(),
  completedStageIds: z.array(z.string().min(1)).default([]),
  chosenOptions: z.record(z.string(), z.string()).default({}),
  startedDay: z.number().int().min(1).optional(),
  completedDay: z.number().int().min(1).optional(),
  failedDay: z.number().int().min(1).optional(),
  expiresDay: z.number().int().min(1).optional(),
  lockedReason: z.string().optional(),
});
export type QuestChainProgress = z.infer<typeof QuestChainProgressSchema>;

export const QuestChainLogSchema = z.object({
  definitions: z.array(QuestChainDefinitionSchema),
  progress: z.array(QuestChainProgressSchema),
});
export type QuestChainLog = z.infer<typeof QuestChainLogSchema>;

// ---------------------------------------------------------------------------
// Log construction
// ---------------------------------------------------------------------------

/** Builds a chain log; chains with unmet prerequisites start `locked`. */
export function createQuestChainLog(definitions: readonly QuestChainDefinition[]): QuestChainLog {
  const defs = structuredClone([...definitions]);
  const completedIds = new Set<string>();
  void completedIds;
  return {
    definitions: defs,
    progress: defs.map((def) => ({
      chainId: def.id,
      definitionId: def.id,
      status: (def.requiresCompletedChainId ? 'locked' : 'available') as QuestChainStatus,
      completedStageIds: [],
      chosenOptions: {},
      ...(def.requiresCompletedChainId
        ? { lockedReason: `Completing '${def.requiresCompletedChainId}' unlocks this chain` }
        : {}),
    })),
  };
}

export function getChainDefinition(log: QuestChainLog, chainId: string): QuestChainDefinition {
  const def = log.definitions.find((candidate) => candidate.id === chainId);
  if (!def) throw new RealmError(`Unknown quest chain '${chainId}'`);
  return def;
}

export function getChainProgress(log: QuestChainLog, chainId: string): QuestChainProgress {
  const progress = log.progress.find((candidate) => candidate.chainId === chainId);
  if (!progress) throw new RealmError(`Unknown quest chain '${chainId}'`);
  return progress;
}

export interface CurrentChainStage {
  definition: QuestChainDefinition;
  progress: QuestChainProgress;
  stage: QuestChainStage;
}

/** Returns the active stage of a chain, or null when it has none. */
export function getCurrentChainStage(log: QuestChainLog, chainId: string): CurrentChainStage | null {
  const definition = getChainDefinition(log, chainId);
  const progress = getChainProgress(log, chainId);
  if (progress.status !== 'active' || !progress.currentStageId) return null;
  const stage = definition.stages.find((candidate) => candidate.id === progress.currentStageId);
  if (!stage) throw new RealmError(`Chain '${chainId}' points at unknown stage '${progress.currentStageId}'`);
  return { definition, progress, stage };
}

export function getAvailableChains(log: QuestChainLog): QuestChainProgress[] {
  return log.progress.filter((entry) => entry.status === 'available');
}

export function getActiveChains(log: QuestChainLog): QuestChainProgress[] {
  return log.progress.filter((entry) => entry.status === 'active');
}

export function getCompletedChains(log: QuestChainLog): QuestChainProgress[] {
  return log.progress.filter((entry) => entry.status === 'completed');
}

// ---------------------------------------------------------------------------
// Advance results
// ---------------------------------------------------------------------------

export interface ChainStageCompletion {
  chainId: string;
  stageId: string;
  title: string;
}

export interface ChainCompletionReward {
  chainId: string;
  title: string;
  rewardGold: number;
  reputationEffects: QuestChainReputationEffect[];
}

export interface ChainAdvanceResult {
  log: QuestChainLog;
  stageCompletions: ChainStageCompletion[];
  chainCompletions: ChainCompletionReward[];
  reputationEffects: QuestChainReputationEffect[];
  events: RealmEvent[];
}

function emptyAdvance(log: QuestChainLog): ChainAdvanceResult {
  return { log, stageCompletions: [], chainCompletions: [], reputationEffects: [], events: [] };
}

function cloneLog(log: QuestChainLog): QuestChainLog {
  return structuredClone(log);
}

function findProgress(mutable: QuestChainProgress[], chainId: string): QuestChainProgress {
  const progress = mutable.find((candidate) => candidate.chainId === chainId);
  if (!progress) throw new RealmError(`Unknown quest chain '${chainId}'`);
  return progress;
}

function findDefinition(mutable: QuestChainDefinition[], chainId: string): QuestChainDefinition {
  const def = mutable.find((candidate) => candidate.id === chainId);
  if (!def) throw new RealmError(`Unknown quest chain '${chainId}'`);
  return def;
}

/** Marks a stage complete and moves the pointer; completes the chain at the end. */
function completeStage(
  mutableLog: QuestChainLog,
  chainId: string,
  stageId: string,
  day: number,
  result: ChainAdvanceResult,
): void {
  const def = findDefinition(mutableLog.definitions, chainId);
  const progress = findProgress(mutableLog.progress, chainId);
  if (progress.status !== 'active') return;
  if (progress.completedStageIds.includes(stageId)) return;
  const stage = def.stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new RealmError(`Chain '${chainId}' has no stage '${stageId}'`);
  progress.completedStageIds.push(stageId);
  result.stageCompletions.push({ chainId, stageId, title: stage.title });
  result.events.push({
    type: 'CHAIN_STAGE_COMPLETED',
    chainId,
    stageId,
    title: stage.title,
    day,
  });

  const nextStageId = stage.nextStageId;
  if (nextStageId) {
    const next = def.stages.find((candidate) => candidate.id === nextStageId);
    if (!next) throw new RealmError(`Chain '${chainId}' stage '${stageId}' leads to unknown stage '${nextStageId}'`);
    progress.currentStageId = nextStageId;
  } else {
    completeChain(mutableLog, chainId, day, result);
  }
}

/** Marks a chain complete, stamps rewards, and unlocks follow-ups. */
function completeChain(
  mutableLog: QuestChainLog,
  chainId: string,
  day: number,
  result: ChainAdvanceResult,
): void {
  const def = findDefinition(mutableLog.definitions, chainId);
  const progress = findProgress(mutableLog.progress, chainId);
  progress.status = 'completed';
  progress.completedDay = day;
  delete progress.currentStageId;
  delete progress.expiresDay;
  result.chainCompletions.push({
    chainId,
    title: def.title,
    rewardGold: def.finalRewardGold,
    reputationEffects: [...def.finalReputationEffects],
  });
  result.events.push({
    type: 'CHAIN_COMPLETED',
    chainId,
    title: def.title,
    goldAwarded: def.finalRewardGold,
    reputationAwarded: def.finalReputationEffects.reduce((sum, effect) => sum + effect.delta, 0),
    day,
  });
  for (const unlockedId of def.unlocksChainIds) {
    const unlocked = mutableLog.progress.find((candidate) => candidate.chainId === unlockedId);
    if (unlocked && unlocked.status === 'locked') {
      unlocked.status = 'available';
      delete unlocked.lockedReason;
      const unlockedDef = mutableLog.definitions.find((candidate) => candidate.id === unlockedId);
      result.events.push({
        type: 'CHAIN_UNLOCKED',
        chainId: unlockedId,
        title: unlockedDef?.title ?? unlockedId,
        day,
      });
    }
  }
}

/**
 * Auto-completes the chain's current stage while it is a combat stage (`bounty`
 * / `dungeon` / `fetch` / `escort`) pointing at an already-cleared POI.
 * Cleared POIs stay cleared: the party is never sent back into a finished
 * delve or a pacified lair, no matter when the stage becomes current.
 */
function cascadeClearedStages(
  mutableLog: QuestChainLog,
  chainId: string,
  cleared: ReadonlySet<string>,
  day: number,
  result: ChainAdvanceResult,
): void {
  const def = findDefinition(mutableLog.definitions, chainId);
  let guard = 0;
  while (guard++ < def.stages.length + 1) {
    const current = findProgress(mutableLog.progress, chainId);
    if (current.status !== 'active' || !current.currentStageId) break;
    const stage = def.stages.find((candidate) => candidate.id === current.currentStageId);
    if (!stage) break;
    const isCombat = (QUEST_CHAIN_COMBAT_STAGE_KINDS as readonly string[]).includes(stage.kind);
    if (!isCombat || !stage.targetPoiId || !cleared.has(stage.targetPoiId)) break;
    completeStage(mutableLog, chainId, stage.id, day, result);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: start / visit / cleared / choice / abandon / expire
// ---------------------------------------------------------------------------

/**
 * Starts an available chain: stamps the day, derives the expiry from
 * `timeLimitDays`, locks competing offers in the same exclusive group, and
 * auto-completes combat stages whose target POI is already cleared (cleared
 * POIs stay cleared — the party is never sent back into a finished delve).
 */
export function startQuestChain(
  log: QuestChainLog,
  chainId: string,
  day: number,
  clearedPoiIds: readonly string[] = [],
): ChainAdvanceResult {
  const def = getChainDefinition(log, chainId);
  const progress = getChainProgress(log, chainId);
  if (progress.status !== 'available') {
    throw new RealmError(`Quest chain '${chainId}' is ${progress.status}, not available`);
  }
  const cleared = new Set(clearedPoiIds);
  const next = cloneLog(log);
  const result = emptyAdvance(next);
  const mutable = findProgress(next.progress, chainId);
  mutable.status = 'active';
  mutable.startedDay = day;
  if (def.timeLimitDays !== undefined) {
    mutable.expiresDay = day + def.timeLimitDays;
  }
  const firstStage = def.stages[0];
  if (!firstStage) throw new RealmError(`Quest chain '${chainId}' has no stages`);
  mutable.currentStageId = firstStage.id;
  result.events.push({ type: 'CHAIN_STARTED', chainId, title: def.title, day });

  // Competing offers: starting one claim locks the rival claims in its group.
  if (def.exclusiveGroupId) {
    for (const other of next.progress) {
      if (other.chainId === chainId || other.status !== 'available') continue;
      const otherDef = next.definitions.find((candidate) => candidate.id === other.chainId);
      if (otherDef?.exclusiveGroupId === def.exclusiveGroupId) {
        other.status = 'locked';
        other.lockedReason = `A rival claim ('${def.title}') was taken up instead`;
        result.events.push({
          type: 'CHAIN_FAILED',
          chainId: other.chainId,
          title: otherDef.title,
          day,
          reason: `Locked out by competing offer '${def.title}'`,
        });
      }
    }
  }

  // Auto-resolve combat stages pointing at already-cleared POIs.
  cascadeClearedStages(next, chainId, cleared, day, result);
  return result;
}

/**
 * Advances `talk` and `turn_in` stages when the party visits their target POI.
 * Combat and choice stages never move here. Completing the final `turn_in`
 * completes the chain (rewards are returned for the caller to apply).
 * Newly exposed combat stages pointing at `clearedPoiIds` auto-complete, so
 * pre-cleared targets never block a chain.
 */
export function advanceChainsForVisit(
  log: QuestChainLog,
  poiId: string,
  day: number,
  clearedPoiIds: readonly string[] = [],
): ChainAdvanceResult {
  const cleared = new Set(clearedPoiIds);
  const next = cloneLog(log);
  const result = emptyAdvance(next);
  for (const progress of next.progress) {
    if (progress.status !== 'active' || !progress.currentStageId) continue;
    const def = findDefinition(next.definitions, progress.chainId);
    const stage = def.stages.find((candidate) => candidate.id === progress.currentStageId);
    if (!stage) continue;
    if ((stage.kind === 'talk' || stage.kind === 'turn_in') && stage.targetPoiId === poiId) {
      completeStage(next, progress.chainId, stage.id, day, result);
      cascadeClearedStages(next, progress.chainId, cleared, day, result);
    }
  }
  return result;
}

/**
 * Advances `bounty` / `dungeon` / `fetch` / `escort` stages when their target
 * POI clears — fed by the tactical battle and POI delve commit-back (and by
 * shrine activation for `fetch` stages pointing at an `ancient_shrine`).
 */
export function advanceChainsForClearedPoi(
  log: QuestChainLog,
  poiId: string,
  day: number,
  clearedPoiIds: readonly string[] = [],
): ChainAdvanceResult {
  const cleared = new Set(clearedPoiIds);
  cleared.add(poiId);
  const next = cloneLog(log);
  const result = emptyAdvance(next);
  for (const progress of next.progress) {
    if (progress.status !== 'active' || !progress.currentStageId) continue;
    const def = findDefinition(next.definitions, progress.chainId);
    const stage = def.stages.find((candidate) => candidate.id === progress.currentStageId);
    if (!stage) continue;
    const isCombat = (QUEST_CHAIN_COMBAT_STAGE_KINDS as readonly string[]).includes(stage.kind);
    if (isCombat && stage.targetPoiId === poiId) {
      completeStage(next, progress.chainId, stage.id, day, result);
      cascadeClearedStages(next, progress.chainId, cleared, day, result);
    }
  }
  return result;
}

export interface ChainChoiceResult extends ChainAdvanceResult {
  chosenOptionId: string;
}

/**
 * Resolves a `choice` stage: records the branch, applies the option's
 * reputation effects immediately (both ways), and locks the unchosen branch by
 * advancing to the chosen successor. A choice with no successor ends the chain.
 */
export function chooseChainBranch(
  log: QuestChainLog,
  chainId: string,
  optionId: string,
  day: number,
  clearedPoiIds: readonly string[] = [],
): ChainChoiceResult {
  const current = getCurrentChainStage(log, chainId);
  if (!current) throw new RealmError(`Quest chain '${chainId}' has no active stage to choose`);
  if (current.stage.kind !== 'choice') {
    throw new RealmError(`Chain '${chainId}' stage '${current.stage.id}' is not a choice`);
  }
  const option = current.stage.options?.find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new RealmError(`Chain '${chainId}' stage '${current.stage.id}' has no option '${optionId}'`);
  }
  const next = cloneLog(log);
  const result: ChainChoiceResult = { ...emptyAdvance(next), chosenOptionId: optionId };
  const mutable = findProgress(next.progress, chainId);
  mutable.chosenOptions[current.stage.id] = optionId;
  result.reputationEffects.push(...option.reputationEffects);
  result.events.push({
    type: 'CHAIN_CHOICE_MADE',
    chainId,
    stageId: current.stage.id,
    optionId,
    label: option.label,
    day,
  });
  // The choice itself counts as a completed stage; the unchosen branch is
  // locked out because its stages are never entered.
  mutable.completedStageIds.push(current.stage.id);
  result.stageCompletions.push({
    chainId,
    stageId: current.stage.id,
    title: `${current.stage.title} — ${option.label}`,
  });
  if (option.nextStageId) {
    const def = findDefinition(next.definitions, chainId);
    const nextStage = def.stages.find((candidate) => candidate.id === option.nextStageId);
    if (!nextStage) {
      throw new RealmError(`Chain '${chainId}' option '${optionId}' leads to unknown stage '${option.nextStageId}'`);
    }
    mutable.currentStageId = option.nextStageId;
    cascadeClearedStages(next, chainId, new Set(clearedPoiIds), day, result);
  } else {
    completeChain(next, chainId, day, result);
  }
  return result;
}

/** Abandons an active chain (failed — it can never be re-taken). */
export function abandonQuestChain(log: QuestChainLog, chainId: string, day: number): ChainAdvanceResult {
  const progress = getChainProgress(log, chainId);
  if (progress.status !== 'active') {
    throw new RealmError(`Quest chain '${chainId}' is ${progress.status}, not active`);
  }
  const next = cloneLog(log);
  const result = emptyAdvance(next);
  const mutable = findProgress(next.progress, chainId);
  mutable.status = 'failed';
  mutable.failedDay = day;
  delete mutable.currentStageId;
  delete mutable.expiresDay;
  const def = findDefinition(next.definitions, chainId);
  result.events.push({
    type: 'CHAIN_FAILED',
    chainId,
    title: def.title,
    day,
    reason: 'Abandoned by the party',
  });
  return result;
}

/** Fails active chains past their timed-offer expiry. */
export function expireQuestChains(log: QuestChainLog, day: number): ChainAdvanceResult {
  const next = cloneLog(log);
  const result = emptyAdvance(next);
  for (const progress of next.progress) {
    if (progress.status !== 'active' || progress.expiresDay === undefined) continue;
    if (day <= progress.expiresDay) continue;
    progress.status = 'failed';
    progress.failedDay = day;
    delete progress.currentStageId;
    delete progress.expiresDay;
    const def = findDefinition(next.definitions, progress.chainId);
    result.events.push({
      type: 'CHAIN_FAILED',
      chainId: progress.chainId,
      title: def.title,
      day,
      reason: 'The offer expired',
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Starter chains (2–3 personal stories bound to a concrete map)
// ---------------------------------------------------------------------------

function pickFloat(state: number): { value: number; nextState: number } {
  const res = nextRandomFloat(state);
  return { value: res.value, nextState: res.nextState };
}

function pickFrom<T>(items: readonly T[], value: number): T {
  return items[Math.floor(value * items.length) % items.length]!;
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface StarterChainBuildOptions {
  currentDay?: number;
  seed?: number;
}

/**
 * Binds the starter chain templates to real POIs on a settled map
 * (deterministic from the world seed). Gracefully skips chains whose required
 * POIs are absent: A needs two rival settlements + a dungeon, B needs a
 * settlement + two lairs, C needs a settlement + a dungeon and unlocks a
 * lair-based follow-up when one exists.
 */
export function buildStarterQuestChains(
  map: OverworldMap,
  options: StarterChainBuildOptions = {},
): QuestChainDefinition[] {
  void options.currentDay;
  let state = normalizeSeed(options.seed ?? map.worldSeed);
  const nextFloat = (): number => {
    const res = pickFloat(state);
    state = res.nextState;
    return res.value;
  };

  const settlements = sortById(getSettlements(map));
  if (settlements.length === 0) return [];
  const boardSettlements = settlements.filter((poi) => poi.services?.includes('quest_board'));
  const origin = boardSettlements.length > 0 ? pickFrom(boardSettlements, nextFloat()) : settlements[0]!;
  const originFactionId = origin.factionId ?? getFactionByPoi(map, origin.id)?.id;
  const rivals = settlements.filter((poi) => {
    const factionId = poi.factionId ?? getFactionByPoi(map, poi.id)?.id;
    return poi.id !== origin.id && (!originFactionId || factionId !== originFactionId);
  });
  const rival = rivals.length > 0 ? pickFrom(sortById(rivals), nextFloat()) : undefined;
  const rivalFactionId = rival ? (rival.factionId ?? getFactionByPoi(map, rival.id)?.id) : undefined;

  const dungeons = sortById(
    Object.values(map.pois).filter((poi) => poi.kind === 'dungeon_entrance'),
  );
  const lairs = sortById(Object.values(map.pois).filter((poi) => poi.kind === 'monster_lair'));
  const shrines = sortById(
    Object.values(map.pois).filter((poi) => poi.kind === 'ancient_shrine'),
  );

  const giverA = pickFrom(QUEST_GIVER_NAMES, nextFloat());
  const giverB = pickFrom(QUEST_GIVER_NAMES, nextFloat());
  const giverC = pickFrom(QUEST_GIVER_NAMES, nextFloat());

  const chains: QuestChainDefinition[] = [];

  // Chain A — "The Rotted Crown": competing faction claims over a relic.
  if (rival && rivalFactionId && originFactionId && dungeons.length > 0) {
    const crownVault = pickFrom(dungeons, nextFloat()) as OverworldPOI;
    const chainId = 'chain_rotted_crown';
    chains.push({
      id: chainId,
      title: 'The Rotted Crown',
      description:
        `Rival houses both claim a burial crown sealed in ${crownVault.name}. ` +
        `Recover it, then decide who wears its history.`,
      giverName: giverA,
      giverBlurb: '“Two banners, one grave. The dead, at least, are patient — the living are not.”',
      originBoardPoiId: origin.id,
      originFactionId,
      unlocksChainIds: [],
      stages: [
        {
          id: `${chainId}_talk`,
          kind: 'talk',
          title: 'Hear the rival claims',
          description: `Speak with ${giverA} at ${origin.name} to learn of the crown.`,
          targetPoiId: origin.id,
          targetName: origin.name,
          nextStageId: `${chainId}_delve`,
        },
        {
          id: `${chainId}_delve`,
          kind: 'dungeon',
          title: 'Recover the burial crown',
          description: `Delve ${crownVault.name} and clear its guardians to claim the crown.`,
          targetPoiId: crownVault.id,
          targetName: crownVault.name,
          nextStageId: `${chainId}_choice`,
        },
        {
          id: `${chainId}_choice`,
          kind: 'choice',
          title: 'Choose who holds the crown',
          description:
            `Both houses paid for this expedition in promises. ` +
            `One keeps the crown; the other remembers the slight.`,
          options: [
            {
              id: 'crown_origin',
              label: `Entomb it with ${origin.name}`,
              description: `${origin.name} keeps its dead; ${rival.name} nurses the insult.`,
              nextStageId: `${chainId}_turnin_origin`,
              reputationEffects: [
                { factionId: originFactionId, delta: 15 },
                { factionId: rivalFactionId, delta: -10 },
              ],
            },
            {
              id: 'crown_rival',
              label: `Yield it to ${rival.name}`,
              description: `${rival.name} honors the debt; ${origin.name} calls it betrayal.`,
              nextStageId: `${chainId}_turnin_rival`,
              reputationEffects: [
                { factionId: rivalFactionId, delta: 15 },
                { factionId: originFactionId, delta: -10 },
              ],
            },
          ],
        },
        {
          id: `${chainId}_turnin_origin`,
          kind: 'turn_in',
          title: `Return the crown to ${origin.name}`,
          description: `Bring the burial crown home to ${origin.name}.`,
          targetPoiId: origin.id,
          targetName: origin.name,
        },
        {
          id: `${chainId}_turnin_rival`,
          kind: 'turn_in',
          title: `Deliver the crown to ${rival.name}`,
          description: `Carry the burial crown to ${rival.name} and collect their gratitude.`,
          targetPoiId: rival.id,
          targetName: rival.name,
        },
      ],
      finalRewardGold: 120,
      finalReputationEffects: [],
    });
  }

  // Chain B — "Beasts of the Wild Road": timed bounty + escort pair.
  if (lairs.length >= 2) {
    const bountyLair = pickFrom(lairs, nextFloat()) as OverworldPOI;
    const remaining = lairs.filter((poi) => poi.id !== bountyLair.id);
    const escortLair = pickFrom(remaining, nextFloat()) as OverworldPOI;
    const chainId = 'chain_wild_road';
    chains.push({
      id: chainId,
      title: 'Beasts of the Wild Road',
      description:
        `Packs den at ${bountyLair.name} and stalk the caravan road past ` +
        `${escortLair.name}. The merchants leave within the fortnight — with guards or without.`,
      giverName: giverB,
      giverBlurb: '“My wagons roll with the next dawn patrol. Be on them or be forgotten.”',
      originBoardPoiId: origin.id,
      ...(originFactionId ? { originFactionId } : {}),
      timeLimitDays: 12,
      unlocksChainIds: [],
      stages: [
        {
          id: `${chainId}_talk`,
          kind: 'talk',
          title: 'Take the merchants’ contract',
          description: `Meet ${giverB} at ${origin.name} and accept the road wardenship.`,
          targetPoiId: origin.id,
          targetName: origin.name,
          nextStageId: `${chainId}_bounty`,
        },
        {
          id: `${chainId}_bounty`,
          kind: 'bounty',
          title: `Break the ${bountyLair.name} pack`,
          description: `Drive the beasts from ${bountyLair.name} in open battle.`,
          targetPoiId: bountyLair.id,
          targetName: bountyLair.name,
          nextStageId: `${chainId}_escort`,
        },
        {
          id: `${chainId}_escort`,
          kind: 'escort',
          title: `Ride guard past ${escortLair.name}`,
          description: `See the wagons safely past ${escortLair.name} — steel out, lanterns lit.`,
          targetPoiId: escortLair.id,
          targetName: escortLair.name,
          nextStageId: `${chainId}_turnin`,
        },
        {
          id: `${chainId}_turnin`,
          kind: 'turn_in',
          title: 'Collect the road wage',
          description: `Report back to ${origin.name} for the merchants’ wage.`,
          targetPoiId: origin.id,
          targetName: origin.name,
        },
      ],
      finalRewardGold: 150,
      finalReputationEffects: originFactionId ? [{ factionId: originFactionId, delta: 12 }] : [],
    });
  }

  // Chain C — "The Sunken Tithe": fetch a tithe chest, unlocking a follow-up.
  const crownTargets = new Set(chains.flatMap((chain) => chain.stages.map((s) => s.targetPoiId)));
  const freeDungeons = dungeons.filter((poi) => !crownTargets.has(poi.id));
  const titheVault = (freeDungeons.length > 0 ? freeDungeons[0] : dungeons[0]) as OverworldPOI | undefined;
  const shrineSite = shrines.length > 0 ? (pickFrom(shrines, nextFloat()) as OverworldPOI) : undefined;
  if (titheVault) {
    const chainId = 'chain_sunken_tithe';
    const followUpId = 'chain_tithes_shadow';
    const followUpLair = lairs.find((poi) => poi.id !== titheVault.id) ?? lairs[0];
    const hasFollowUp = Boolean(followUpLair);
    chains.push({
      id: chainId,
      title: 'The Sunken Tithe',
      description:
        `A drowned tithe chest lies in ${titheVault.name}, owed to the shrine-keepers ` +
        `a generation ago. Recover it and settle the ledger.`,
      giverName: giverC,
      giverBlurb: '“The waters took our coin and our patience. Bring back one of the two.”',
      originBoardPoiId: origin.id,
      ...(originFactionId ? { originFactionId } : {}),
      unlocksChainIds: hasFollowUp ? [followUpId] : [],
      stages: [
        {
          id: `${chainId}_talk`,
          kind: 'talk',
          title: 'Learn of the lost tithe',
          description: `Hear ${giverC}’s account at ${origin.name}.`,
          targetPoiId: origin.id,
          targetName: origin.name,
          nextStageId: `${chainId}_fetch`,
        },
        {
          id: `${chainId}_fetch`,
          kind: 'fetch',
          title: `Raise the tithe from ${titheVault.name}`,
          description:
            shrineSite
              ? `Delve ${titheVault.name}, then carry the chest onward — the shrine at ${shrineSite.name} remembers the debt.`
              : `Delve ${titheVault.name} and recover the drowned tithe chest.`,
          targetPoiId: titheVault.id,
          targetName: titheVault.name,
          nextStageId: `${chainId}_turnin`,
        },
        {
          id: `${chainId}_turnin`,
          kind: 'turn_in',
          title: 'Settle the ledger',
          description: `Deliver the tithe chest to ${origin.name}.`,
          targetPoiId: origin.id,
          targetName: origin.name,
        },
      ],
      finalRewardGold: 90,
      finalReputationEffects: originFactionId ? [{ factionId: originFactionId, delta: 8 }] : [],
    });

    // Follow-up — "Tithe's Shadow": the chest was marked; something followed it back.
    if (followUpLair) {
      chains.push({
        id: followUpId,
        title: 'Tithe’s Shadow',
        description:
          `Something followed the tithe chest up from the dark and now dens at ` +
          `${followUpLair.name}. Finish what the ledger started.`,
        giverName: giverC,
        giverBlurb: '“We paid the debt. Nobody said the dark would give change.”',
        originBoardPoiId: origin.id,
        ...(originFactionId ? { originFactionId } : {}),
        requiresCompletedChainId: chainId,
        unlocksChainIds: [],
        stages: [
          {
            id: `${followUpId}_talk`,
            kind: 'talk',
            title: 'Hear the night watch report',
            description: `The watch at ${origin.name} has a description and a casualty list.`,
            targetPoiId: origin.id,
            targetName: origin.name,
            nextStageId: `${followUpId}_bounty`,
          },
          {
            id: `${followUpId}_bounty`,
            kind: 'bounty',
            title: `Slay the shadow of ${followUpLair.name}`,
            description: `Destroy the thing nesting at ${followUpLair.name}.`,
            targetPoiId: followUpLair.id,
            targetName: followUpLair.name,
            nextStageId: `${followUpId}_turnin`,
          },
          {
            id: `${followUpId}_turnin`,
            kind: 'turn_in',
            title: 'Close the ledger for good',
            description: `Report the kill at ${origin.name}.`,
            targetPoiId: origin.id,
            targetName: origin.name,
          },
        ],
        finalRewardGold: 180,
        finalReputationEffects: originFactionId ? [{ factionId: originFactionId, delta: 10 }] : [],
      });
    }
  }

  // Validate the authored output before it enters any log.
  for (const chain of chains) {
    QuestChainDefinitionSchema.parse(chain);
    const stageIds = new Set(chain.stages.map((stage) => stage.id));
    for (const stage of chain.stages) {
      if (stage.nextStageId && !stageIds.has(stage.nextStageId)) {
        throw new RealmError(`Chain '${chain.id}' stage '${stage.id}' leads nowhere`);
      }
      for (const option of stage.options ?? []) {
        if (option.nextStageId && !stageIds.has(option.nextStageId)) {
          throw new RealmError(`Chain '${chain.id}' option '${option.id}' leads nowhere`);
        }
      }
    }
  }
  return chains;
}
