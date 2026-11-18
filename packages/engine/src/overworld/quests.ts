import {
  type OverworldMap,
  type OverworldPOI,
  type OverworldTravelState,
} from './schemas.js';
import {
  QuestBoardGenerationConfigSchema,
  type QuestBoardGenerationConfigInput,
  type QuestBoardGenerationConfig,
  type OverworldQuest,
  type QuestKind,
  type QuestLog,
  type RealmEvent,
} from './realm-schemas.js';
import {
  adjustFactionReputation,
  getFactionByPoi,
  type ReputationChangeResult,
} from './factions.js';
import { RealmError } from './realm-error.js';
import { normalizeSeed, nextRandomFloat, rollDie } from '../dice/prng.js';

/**
 * Settlement quest boards (SRD-803, Spec 06 §4.1).
 *
 * Generates bounty and dungeon-delving postings from a settlement's nearby
 * wilderness POIs, then tracks acceptance/completion. Completing a quest
 * awards gold to the overworld party and reputation with the posting faction,
 * which feeds back into shop prices and the disposition matrix.
 */

/** SRD 5.1 monster IDs used as bounty targets (no Product Identity). */
export const BOUNTY_TARGET_POOL = [
  'goblin', 'kobold', 'orc', 'bandit', 'bugbear', 'wolf', 'giant-spider', 'owlbear', 'skeleton', 'zombie',
  'thug', 'berserker', 'specter', 'veteran', 'knight', 'troll', 'mummy', 'gladiator', 'oni',
] as const;

/** Tavern-board quest givers (original flavor, no SRD Product Identity). */
export const QUEST_GIVER_NAMES = [
  'Bram Holloway', 'Sella Marrow', 'Old Fenwick', 'Mira Thistledown', 'Corvin Ash',
  'Dame Ysolde', 'Tavernkeep Pell', 'Scout Rennick', 'Widow Harlowe', 'Brother Anselm',
  'Captain Vey', 'Herbalist Wren',
] as const;

const QUEST_GIVER_BLURBS: Record<QuestKind, readonly string[]> = {
  bounty: [
    '“They took my brother on the east road. I will pay good coin to see the beasts driven off.”',
    '“Merchants whisper about this menace over every ale. End it and the council will remember.”',
    '“I have counted the tracks myself — too many to face alone. Help us.”',
  ],
  dungeon: [
    '“Old maps mark a vault beneath those ruins. Bring back what the dark has kept.”',
    '“None who entered have returned with both their wits and their purse. Prove me wrong.”',
    '“The stones there remember an older war. Clear them and keep what you find.”',
  ],
  fetch: [
    '“Lost on the road and dear to me — return it and drink free on my tab.”',
    '“A simple errand for steady boots. The pay is honest, I swear it.”',
    '“My caravan cannot wait. Whoever recovers the goods earns my thanks and coin.”',
  ],
  escort: [
    '“The roads grow teeth after dusk. See my wagons through and name your price in ale.”',
    '“Bandits watch the passes. Guard us and the guild will speak well of you.”',
    '“My mules are brave but my guards are few. Walk with us.”',
  ],
};

export interface QuestBoardGenerationResult {
  quests: OverworldQuest[];
  nextRngState: number;
}

function pick<T>(items: readonly T[], value: number): T {
  return items[Math.floor(value * items.length)]!;
}

/** Builds an empty quest log. */
export function createQuestLog(quests: readonly OverworldQuest[] = []): QuestLog {
  return { quests: structuredClone([...quests]) };
}

/**
 * Generates deterministic quest postings for a settlement board. Wilderness
 * POIs (dungeon entrances, monster lairs) become bounty/dungeon targets; a
 * board with no nearby wilderness instead posts fetch/escort commissions.
 */
export function generateQuestBoard(
  map: OverworldMap,
  poi: OverworldPOI,
  rngState: number,
  rawConfig: QuestBoardGenerationConfigInput = {},
): QuestBoardGenerationResult {
  const config: QuestBoardGenerationConfig = QuestBoardGenerationConfigSchema.parse(rawConfig);
  let state = normalizeSeed(config.seed ?? map.worldSeed);
  function nextFloat(): number {
    const res = nextRandomFloat(state);
    state = res.nextState;
    return res.value;
  }
  function nextD20(): number {
    const res = rollDie(state, 20);
    state = res.nextState;
    return res.roll;
  }

  const factionId = poi.factionId ?? getFactionByPoi(map, poi.id)?.id;
  const targets = Object.values(map.pois).filter(
    (candidate) =>
      candidate.id !== poi.id &&
      (candidate.kind === 'dungeon_entrance' || candidate.kind === 'monster_lair'),
  );
  const lairs = targets.filter((target) => target.kind === 'monster_lair');
  const dungeons = targets.filter((target) => target.kind === 'dungeon_entrance');

  const count = config.questsPerBoard ?? 3;
  const quests: OverworldQuest[] = [];

  for (let i = 0; i < count; i++) {
    let kind: QuestKind;
    let target: OverworldPOI | undefined;

    if (i === 0 && lairs.length > 0) {
      kind = 'bounty';
      target = lairs[Math.floor(nextFloat() * lairs.length)];
    } else if (dungeons.length > 0) {
      kind = 'dungeon';
      target = dungeons[Math.floor(nextFloat() * dungeons.length)];
    } else if (lairs.length > 0) {
      kind = 'bounty';
      target = lairs[Math.floor(nextFloat() * lairs.length)];
    } else {
      kind = i % 2 === 0 ? 'fetch' : 'escort';
    }

    const difficultyTier = target?.depthTier ?? Math.max(1, Math.min(4, Math.ceil(nextD20() / 5)));
    const baseReward = 20 + difficultyTier * 15 + (nextD20() * 2);
    const reputationReward = 4 + difficultyTier * 3;
    const expiresDay = config.currentDay + 8 + Math.floor(nextFloat() * 13);
    const targetName = target?.name;
    const giverName = pick(QUEST_GIVER_NAMES, nextFloat());
    const blurbs = QUEST_GIVER_BLURBS[kind];
    const giverBlurb = pick(blurbs, nextFloat());

    let title: string;
    let description: string;
    switch (kind) {
      case 'bounty':
        title = `Bounty: ${targetName ?? 'Wilderness Menace'}`;
        description = `Slay the creatures plaguing ${targetName ?? 'the wilds'} and return proof of the deed.`;
        break;
      case 'dungeon':
        title = `Delve the ${targetName ?? 'Forgotten Depths'}`;
        description = `Enter ${targetName ?? 'the ruin'}, overcome its guardians, and recover what lies within.`;
        break;
      case 'fetch':
        title = 'Retrieve the Lost Relic';
        description = 'Recover a relic lost on the roads and return it to the quest board.';
        break;
      case 'escort':
        title = 'Escort the Caravan';
        description = 'Guard a merchant caravan until it reaches the next settlement.';
        break;
    }

    quests.push({
      id: `quest_${poi.id}_${i + 1}`,
      title,
      description,
      kind,
      boardPoiId: poi.id,
      ...(factionId ? { factionId } : {}),
      ...(target ? { targetPoiId: target.id } : {}),
      ...(targetName ? { targetName } : {}),
      ...(kind === 'bounty' ? { targetMonsterId: pick(BOUNTY_TARGET_POOL, nextFloat()) } : {}),
      giverName,
      giverBlurb,
      rewardGold: baseReward,
      reputationReward,
      difficultyTier,
      status: 'available',
      createdDay: config.currentDay,
      expiresDay,
    });
  }

  return { quests, nextRngState: state };
}

export function getQuestById(log: QuestLog, questId: string): OverworldQuest {
  const quest = log.quests.find((candidate) => candidate.id === questId);
  if (!quest) throw new RealmError(`Unknown quest '${questId}'`);
  return quest;
}

export function getAvailableQuests(log: QuestLog): OverworldQuest[] {
  return log.quests.filter((quest) => quest.status === 'available');
}

export function getActiveQuests(log: QuestLog): OverworldQuest[] {
  return log.quests.filter((quest) => quest.status === 'active');
}

export function getCompletedQuests(log: QuestLog): OverworldQuest[] {
  return log.quests.filter((quest) => quest.status === 'completed');
}

/** Accepts an available posting, stamping the current day. */
export function acceptQuest(log: QuestLog, questId: string, day: number): QuestLog {
  const quest = getQuestById(log, questId);
  if (quest.status !== 'available') {
    throw new RealmError(`Quest '${questId}' is ${quest.status}, not available`);
  }
  if (quest.expiresDay !== undefined && day > quest.expiresDay) {
    throw new RealmError(`Quest '${questId}' expired on day ${quest.expiresDay}`);
  }
  return {
    quests: log.quests.map((candidate) =>
      candidate.id === questId
        ? { ...candidate, status: 'active' as const, acceptedDay: day }
        : candidate,
    ),
  };
}

export interface QuestCompletionResult {
  log: QuestLog;
  quest: OverworldQuest;
  rewardGold: number;
  reputationReward: number;
}

/** Marks an active quest complete (reward bookkeeping is done by the caller). */
export function completeQuest(log: QuestLog, questId: string, day: number): QuestCompletionResult {
  const quest = getQuestById(log, questId);
  if (quest.status !== 'active') {
    throw new RealmError(`Quest '${questId}' must be accepted before it can be completed`);
  }
  const completed: OverworldQuest = { ...quest, status: 'completed', completedDay: day };
  return {
    log: {
      quests: log.quests.map((candidate) => (candidate.id === questId ? completed : candidate)),
    },
    quest: completed,
    rewardGold: quest.rewardGold,
    reputationReward: quest.reputationReward,
  };
}

/** Marks an active quest as failed. */
export function failQuest(log: QuestLog, questId: string, day: number): QuestLog {
  const quest = getQuestById(log, questId);
  if (quest.status !== 'active') {
    throw new RealmError(`Only active quests can be failed (quest '${questId}' is ${quest.status})`);
  }
  return {
    quests: log.quests.map((candidate) =>
      candidate.id === questId
        ? { ...candidate, status: 'failed' as const, failedDay: day }
        : candidate,
    ),
  };
}

export interface ResolveQuestResult {
  log: QuestLog;
  state: OverworldTravelState;
  map: OverworldMap;
  rewardGold: number;
  reputationChange?: ReputationChangeResult;
  events: RealmEvent[];
}

/**
 * Full quest-resolution flow: award gold to the party, adjust the posting
 * faction's reputation, and produce deterministic realm events. Non-mutating.
 */
export function completeQuestForParty(
  log: QuestLog,
  state: OverworldTravelState,
  map: OverworldMap,
  questId: string,
  day: number,
): ResolveQuestResult {
  const completed = completeQuest(log, questId, day);
  const events: RealmEvent[] = [
    {
      type: 'QUEST_COMPLETED',
      questId: completed.quest.id,
      title: completed.quest.title,
      goldAwarded: completed.rewardGold,
      reputationAwarded: completed.reputationReward,
      day,
    },
  ];

  let nextMap = map;
  let reputationChange: ReputationChangeResult | undefined;
  const factionId = completed.quest.factionId;
  if (factionId && map.factions[factionId]) {
    reputationChange = adjustFactionReputation(nextMap, factionId, completed.reputationReward);
    nextMap = reputationChange.map;
    events.push({
      type: 'REPUTATION_CHANGED',
      factionId,
      previous: reputationChange.previous,
      value: reputationChange.reputation,
      tier: reputationChange.tier,
    });
  }

  return {
    log: completed.log,
    state: { ...state, gold: state.gold + completed.rewardGold },
    map: nextMap,
    rewardGold: completed.rewardGold,
    ...(reputationChange ? { reputationChange } : {}),
    events,
  };
}
