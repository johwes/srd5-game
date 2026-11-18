import {
  type OverworldMap,
  type OverworldPOI,
  type OverworldPOIKind,
  type OverworldPOIService,
  type OverworldTravelState,
} from './schemas.js';
import {
  type ReputationTier,
  type ShopItem,
  type RealmEvent,
} from './realm-schemas.js';
import {
  getReputationPriceMultiplier,
  getReputationTier,
  getFactionByPoi,
  getFactionReputation,
} from './factions.js';
import { RealmError } from './realm-error.js';
import { normalizeSeed, nextRandomFloat } from '../dice/prng.js';
import { removeConditionFromCombatant } from '../combat/conditions.js';
import type { Combatant } from '../combat/types.js';
import type { InventoryItemInstance } from '@srd5/data';

/**
 * Settlement adventuring hub (SRD-808, Spec 06 §4.1 / §4.3).
 *
 * Settlements expose a single hub menu — never a walkable tactical city map.
 * Tabs: Inn (safe free Long Rest + rumors), Market (rep-gated buy/sell +
 * identify), Temple (affliction cleansing + blessings), Tavern board (quest
 * giver blurbs + accept/abandon, handled by the quest-board module).
 *
 * All functions are pure and deterministic. RNG is threaded through
 * `rngState`; `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Hub access (reputation gating)
// ---------------------------------------------------------------------------

export interface SettlementHubAccess {
  poiId: string;
  factionId?: string;
  reputation: number;
  tier: ReputationTier;
  priceMultiplier: number;
  /** Inn rest is always open to travellers. */
  innOpen: boolean;
  /** Market closes its gates to hated/hostile parties; unfriendly hides magic. */
  marketOpen: boolean;
  templeOpen: boolean;
  boardOpen: boolean;
  /** Magic stock is hidden from unfriendly (and worse) parties. */
  magicStockVisible: boolean;
  /** Exalted allies receive the temple blessing free. */
  blessingFree: boolean;
  gateClosed: boolean;
}

function hubReputation(map: OverworldMap, poi: OverworldPOI): number {
  const factionId = poi.factionId ?? getFactionByPoi(map, poi.id)?.id;
  if (!factionId || !map.factions[factionId]) return 0;
  return getFactionReputation(map, factionId);
}

/** Resolves the hub access profile for a settlement POI. */
export function getSettlementHubAccess(map: OverworldMap, poi: OverworldPOI): SettlementHubAccess {
  if (!['capital', 'town', 'village'].includes(poi.kind)) {
    throw new RealmError(`POI '${poi.id}' is not a settlement`);
  }
  const factionId = poi.factionId ?? getFactionByPoi(map, poi.id)?.id;
  const reputation = factionId ? hubReputation(map, poi) : 0;
  const tier = getReputationTier(reputation);
  const priceMultiplier = getReputationPriceMultiplier(reputation);
  const services = poi.services ?? [];
  const has = (service: OverworldPOIService): boolean => services.includes(service);

  const gateClosed = tier === 'hated' || tier === 'hostile';
  return {
    poiId: poi.id,
    ...(factionId ? { factionId } : {}),
    reputation,
    tier,
    priceMultiplier,
    innOpen: has('inn'),
    marketOpen: (has('blacksmith') || has('magic_shop') || has('inn')) && !gateClosed,
    templeOpen: has('temple') && !gateClosed,
    // Even hostile parties may take work to redeem themselves — only the
    // hated (kill-on-sight) lose the board.
    boardOpen: has('quest_board') && tier !== 'hated',
    magicStockVisible: tier === 'neutral' || tier === 'friendly' || tier === 'trusted' || tier === 'exalted',
    blessingFree: tier === 'exalted',
    gateClosed,
  };
}

/** Filters a shop inventory to the stock visible at a reputation tier. */
export function filterMarketStockForParty(items: readonly ShopItem[], reputation: number): ShopItem[] {
  const tier = getReputationTier(reputation);
  if (tier === 'hated' || tier === 'hostile') return [];
  if (tier === 'unfriendly') return items.filter((item) => !item.isMagicItem);
  return [...items];
}

// ---------------------------------------------------------------------------
// Inn rumors (reveal nearby POIs)
// ---------------------------------------------------------------------------

export interface SettlementRumor {
  id: string;
  poiId: string;
  targetPoiId: string;
  targetName: string;
  targetKind: OverworldPOIKind;
  title: string;
  rumorText: string;
  informant: string;
  costGp: number;
  distanceTiles: number;
}

export const RUMOR_INFORMANTS = [
  'a one-eyed drover',
  'the innkeep',
  'a muddy scout',
  'a travelling minstrel',
  'an off-duty watchman',
  'a caravan master',
] as const;

/** A round of ale loosens tongues — the flat price of a rumor. */
export const RUMOR_COST_GP = 1;

const RUMOR_TEXTS: Record<string, readonly string[]> = {
  dungeon_entrance: [
    '“Old stones, they say — a stair down into the dark, and treasure for whoever comes back up.”',
    '“None who map that ruin return with the same eyes. But the gold spends all the same.”',
  ],
  monster_lair: [
    '“Beasts den nearby. The bounty board pays, if you have the stomach for it.”',
    '“Livestock gone again. Something nests out there — put it down and name your reward.”',
  ],
  ancient_shrine: [
    '“A shrine sleeps in the wilds, older than the roads. The faithful say it still answers.”',
    '“Leave an offering at the old stones and the road treats you kinder. So they say.”',
  ],
};

export interface RumorGenerationResult {
  rumors: SettlementRumor[];
  nextRngState: number;
}

function rumorDistance(a: OverworldPOI, b: OverworldPOI): number {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

/**
 * Gathers deterministic inn rumors for nearby wilderness POIs, nearest first.
 * Excludes the settlement itself and already-cleared targets when provided.
 */
export function generateSettlementRumors(
  map: OverworldMap,
  poi: OverworldPOI,
  rngState: number,
  options: {
    maxRumors?: number;
    maxDistance?: number;
    excludePoiIds?: readonly string[];
  } = {},
): RumorGenerationResult {
  let state = normalizeSeed(rngState);
  const nextFloat = (): number => {
    const res = nextRandomFloat(state);
    state = res.nextState;
    return res.value;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(nextFloat() * items.length)]!;

  const maxRumors = options.maxRumors ?? 3;
  const maxDistance = options.maxDistance ?? 14;
  const excluded = new Set(options.excludePoiIds ?? []);
  const wilderness = Object.values(map.pois).filter(
    (candidate) =>
      candidate.id !== poi.id &&
      !excluded.has(candidate.id) &&
      (candidate.kind === 'dungeon_entrance' ||
        candidate.kind === 'monster_lair' ||
        candidate.kind === 'ancient_shrine'),
  );
  const nearby = wilderness.filter((candidate) => rumorDistance(poi, candidate) <= maxDistance);
  // Fall back to the nearest wilderness sites so remote settlements still hear
  // whispers; distance is surfaced on each rumor either way.
  const pool = nearby.length > 0 ? nearby : wilderness;
  const candidates = pool
    .sort((a, b) => rumorDistance(poi, a) - rumorDistance(poi, b) || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, maxRumors));

  const rumors: SettlementRumor[] = candidates.map((target, index) => {
    const texts = RUMOR_TEXTS[target.kind] ?? RUMOR_TEXTS.dungeon_entrance!;
    return {
      id: `rumor_${poi.id}_${index + 1}`,
      poiId: poi.id,
      targetPoiId: target.id,
      targetName: target.name,
      targetKind: target.kind,
      title: `Rumor: ${target.name}`,
      rumorText: pick(texts),
      informant: pick(RUMOR_INFORMANTS),
      costGp: RUMOR_COST_GP,
      distanceTiles: rumorDistance(poi, target),
    };
  });

  return { rumors, nextRngState: state };
}

/** Adds a rumor target to the revealed set (idempotent). */
export function acceptSettlementRumor(revealedPoiIds: readonly string[], rumor: SettlementRumor): string[] {
  if (revealedPoiIds.includes(rumor.targetPoiId)) return [...revealedPoiIds];
  return [...revealedPoiIds, rumor.targetPoiId];
}

// ---------------------------------------------------------------------------
// Market identify service
// ---------------------------------------------------------------------------

/** Flat identify fee before the reputation multiplier. */
export const IDENTIFY_BASE_COST_GP = 25;

/** Identify fee after the reputation multiplier (minimum 5 gp). */
export function getIdentifyCost(reputation: number): number {
  return Math.max(5, Math.ceil(IDENTIFY_BASE_COST_GP * getReputationPriceMultiplier(reputation)));
}

export interface IdentifyItemResult {
  state: OverworldTravelState;
  instance: InventoryItemInstance;
  costGp: number;
  events: RealmEvent[];
}

/** Identifies one unidentified magic item, spending overworld gold. */
export function identifyMagicItem(
  state: OverworldTravelState,
  instance: InventoryItemInstance,
  reputation = 0,
): IdentifyItemResult {
  if (instance.identified === true) {
    throw new RealmError(`'${instance.itemId}' is already identified`);
  }
  const costGp = getIdentifyCost(reputation);
  if (costGp > state.gold + 1e-9) {
    throw new RealmError(`Not enough gold to identify (need ${costGp} gp, have ${state.gold} gp)`);
  }
  return {
    state: { ...state, gold: Math.round((state.gold - costGp) * 100) / 100 },
    instance: { ...instance, identified: true },
    costGp,
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Temple services (cleansing + blessings)
// ---------------------------------------------------------------------------

export const TEMPLE_CLEANSE_BASE_COST_GP = 50;
export const TEMPLE_BLESSING_BASE_COST_GP = 30;
export const TEMPLE_BLESSING_ID = 'temple_blessing';

/** Conditions the temple can lift (SRD curse/disease analogues). */
export const TEMPLE_CLEANSABLE_CONDITIONS = ['poisoned', 'blinded', 'deafened', 'frightened'] as const;

export function getTempleCleanseCost(reputation: number): number {
  return Math.max(10, Math.ceil(TEMPLE_CLEANSE_BASE_COST_GP * getReputationPriceMultiplier(reputation)));
}

export function getTempleBlessingCost(reputation: number): number {
  if (getReputationTier(reputation) === 'exalted') return 0;
  return Math.max(5, Math.ceil(TEMPLE_BLESSING_BASE_COST_GP * getReputationPriceMultiplier(reputation)));
}

export interface TempleCleanseResult {
  party: Record<string, Combatant>;
  removed: string[];
  events: RealmEvent[];
}

function cleanseCombatant(combatant: Combatant): { combatant: Combatant; removed: string[] } {
  let next = combatant;
  const removed: string[] = [];
  for (const condition of TEMPLE_CLEANSABLE_CONDITIONS) {
    if (next.conditions.includes(condition)) {
      next = removeConditionFromCombatant(next, condition, { sourceName: 'Temple cleansing' }).combatant;
      removed.push(condition);
    }
  }
  if ((next.exhaustionLevel ?? 0) > 0) {
    next = removeConditionFromCombatant(next, 'exhaustion', {
      exhaustionLevelReduction: 1,
      sourceName: 'Temple cleansing',
    }).combatant;
    removed.push('exhaustion:-1');
  }
  return { combatant: next, removed };
}

/** Lifts temple-cleansable afflictions from one hero. */
export function cleansePartyAffliction(
  party: Record<string, Combatant>,
  characterId: string,
): TempleCleanseResult {
  const hero = party[characterId];
  if (!hero) throw new RealmError(`Unknown party member '${characterId}'`);
  const { combatant, removed } = cleanseCombatant(hero);
  if (removed.length === 0) {
    throw new RealmError(`${hero.name} bears no affliction the temple can lift`);
  }
  return {
    party: { ...party, [characterId]: combatant },
    removed,
    events: [],
  };
}

export interface TempleBlessingResult {
  party: Record<string, Combatant>;
  blessedCount: number;
}

/** Grants the temple blessing to every living hero (idempotent). */
export function blessPartyWithTemple(party: Record<string, Combatant>): TempleBlessingResult {
  const next: Record<string, Combatant> = { ...party };
  let blessedCount = 0;
  for (const [id, hero] of Object.entries(next)) {
    if (hero.isDead || hero.currentHp <= 0) continue;
    const blessings = hero.blessings ?? [];
    if (!blessings.includes(TEMPLE_BLESSING_ID)) {
      next[id] = { ...hero, blessings: [...blessings, TEMPLE_BLESSING_ID] };
      blessedCount += 1;
    }
  }
  if (blessedCount === 0) {
    throw new RealmError('The whole party already bears the temple blessing');
  }
  return { party: next, blessedCount };
}
