import { z } from 'zod';
import { type FactionAlignment } from './schemas.js';

/**
 * SRD-803 — Realm economy schemas (Spec 06 Section 4.1 / 4.3).
 *
 * Layers faction reputation, settlement services, shops, and quest boards on
 * top of the static `OverworldMap` produced by SRD-801. All schemas are plain
 * Zod objects so the resulting state stays JSON-serializable for transport.
 */

// ---------------------------------------------------------------------------
// Faction reputation (-100 .. +100, Spec 06 Section 4.1)
// ---------------------------------------------------------------------------

export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

export const ReputationValueSchema = z
  .number()
  .int()
  .min(REPUTATION_MIN)
  .max(REPUTATION_MAX);
export type ReputationValue = z.infer<typeof ReputationValueSchema>;

export const REPUTATION_TIERS = [
  'hated',
  'hostile',
  'unfriendly',
  'neutral',
  'friendly',
  'trusted',
  'exalted',
] as const;
export const ReputationTierSchema = z.enum(REPUTATION_TIERS);
export type ReputationTier = z.infer<typeof ReputationTierSchema>;

/** Disposition labels mirror `Disposition` from the tactical allegiance module. */
export const ReputationDispositionSchema = z.enum(['allied', 'hostile', 'neutral']);
export type ReputationDisposition = z.infer<typeof ReputationDispositionSchema>;

export interface ReputationTierProfile {
  /** Inclusive lower bound of the tier. */
  readonly min: number;
  /** Inclusive upper bound of the tier. */
  readonly max: number;
  readonly label: string;
  /** Multiplier applied to shop prices (hostile factions charge more). */
  readonly priceMultiplier: number;
  /** How the faction treats the party in the disposition matrix. */
  readonly disposition: ReputationDisposition;
}

/**
 * Seven standing bands from "Kill on sight" (-100) to "Exalted ally" (+100).
 * Bounds are contiguous and inclusive so every integer maps to exactly one tier.
 */
export const REPUTATION_TIER_PROFILES: Record<ReputationTier, ReputationTierProfile> = {
  hated: { min: -100, max: -81, label: 'Hated — slain on sight', priceMultiplier: 1.5, disposition: 'hostile' },
  hostile: { min: -80, max: -41, label: 'Hostile', priceMultiplier: 1.35, disposition: 'hostile' },
  unfriendly: { min: -40, max: -11, label: 'Unfriendly', priceMultiplier: 1.2, disposition: 'hostile' },
  neutral: { min: -10, max: 10, label: 'Neutral', priceMultiplier: 1, disposition: 'neutral' },
  friendly: { min: 11, max: 40, label: 'Friendly', priceMultiplier: 0.95, disposition: 'allied' },
  trusted: { min: 41, max: 80, label: 'Trusted', priceMultiplier: 0.9, disposition: 'allied' },
  exalted: { min: 81, max: 100, label: 'Exalted ally', priceMultiplier: 0.85, disposition: 'allied' },
};

/** Ascending tier order, used for tier comparison and iteration. */
export const REPUTATION_TIER_ORDER: readonly ReputationTier[] = [
  'hated',
  'hostile',
  'unfriendly',
  'neutral',
  'friendly',
  'trusted',
  'exalted',
];

/**
 * Build-time faction archetypes. Names/banners are original and contain no
 * SRD Product Identity; only the generic alignment vocabulary is used.
 */
export interface FactionArchetype {
  readonly id: string;
  readonly name: string;
  readonly bannerColor: string;
  readonly alignment: FactionAlignment;
}

export const FACTION_ARCHETYPES: readonly FactionArchetype[] = [
  { id: 'iron-covenant', name: 'The Iron Covenant', bannerColor: '#b91c1c', alignment: 'neutral' },
  { id: 'emerald-circle', name: 'The Emerald Circle', bannerColor: '#15803d', alignment: 'good' },
  { id: 'gilded-league', name: 'The Gilded League', bannerColor: '#ca8a04', alignment: 'neutral' },
  { id: 'dawn-order', name: 'The Dawn Order', bannerColor: '#0369a1', alignment: 'good' },
  { id: 'ashen-throne', name: 'The Ashen Throne', bannerColor: '#4c1d95', alignment: 'evil' },
  { id: 'frostbound-clan', name: 'The Frostbound Clan', bannerColor: '#0f766e', alignment: 'neutral' },
];

/** Canonical faction ID used for the party in the disposition matrix (Spec 06 §2.3). */
export const PLAYER_FACTION_ID = 'player_guild';

// ---------------------------------------------------------------------------
// Procedural settlement generation (SRD-803)
// ---------------------------------------------------------------------------

export const SettlementGenerationConfigSchema = z.object({
  /** Defaults to the world map seed. */
  seed: z.number().int().optional(),
  /** How many factions compete for the settlement sites. */
  factionCount: z.number().int().min(1).max(FACTION_ARCHETYPES.length).optional(),
  /** Optional starting reputations keyed by faction archetype ID. */
  startingReputations: z.record(z.string(), z.number()).optional(),
});
export type SettlementGenerationConfigInput = z.input<typeof SettlementGenerationConfigSchema>;
export type SettlementGenerationConfig = z.output<typeof SettlementGenerationConfigSchema>;

// ---------------------------------------------------------------------------
// Shop inventories (SRD-803)
// ---------------------------------------------------------------------------

export const ShopItemSchema = z.object({
  /** Canonical SRD 5.1 item ID (equipment or magic item). */
  itemId: z.string().min(1),
  name: z.string().min(1),
  /** Undiscounted price in gold pieces. */
  basePriceGp: z.number().nonnegative(),
  /** Units currently in stock. */
  quantity: z.number().int().nonnegative(),
  isMagicItem: z.boolean(),
  rarity: z.string().optional(),
});
export type ShopItem = z.infer<typeof ShopItemSchema>;

export const ShopInventorySchema = z.object({
  poiId: z.string().min(1),
  shopName: z.string().min(1),
  factionId: z.string().optional(),
  items: z.array(ShopItemSchema),
});
export type ShopInventory = z.infer<typeof ShopInventorySchema>;

/** Fraction of the list price a shop pays when buying an item back. */
export const SELL_PRICE_RATIO = 0.5;

// ---------------------------------------------------------------------------
// Quest boards (SRD-803)
// ---------------------------------------------------------------------------

export const QUEST_KINDS = ['bounty', 'dungeon', 'fetch', 'escort'] as const;
export const QuestKindSchema = z.enum(QUEST_KINDS);
export type QuestKind = z.infer<typeof QuestKindSchema>;

export const QUEST_STATUSES = ['available', 'active', 'completed', 'failed'] as const;
export const QuestStatusSchema = z.enum(QUEST_STATUSES);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;

export const OverworldQuestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  kind: QuestKindSchema,
  /** Settlement POI hosting the quest board. */
  boardPoiId: z.string().min(1),
  factionId: z.string().optional(),
  /** Dungeon/lair POI targeted by bounty and dungeon quests. */
  targetPoiId: z.string().min(1).optional(),
  targetName: z.string().min(1).optional(),
  targetMonsterId: z.string().min(1).optional(),
  rewardGold: z.number().int().nonnegative(),
  reputationReward: z.number().int(),
  difficultyTier: z.number().int().min(1).max(4),
  status: QuestStatusSchema,
  createdDay: z.number().int().min(1),
  acceptedDay: z.number().int().min(1).optional(),
  completedDay: z.number().int().min(1).optional(),
  failedDay: z.number().int().min(1).optional(),
  expiresDay: z.number().int().min(1).optional(),
});
export type OverworldQuest = z.infer<typeof OverworldQuestSchema>;

export const QuestLogSchema = z.object({
  quests: z.array(OverworldQuestSchema),
});
export type QuestLog = z.infer<typeof QuestLogSchema>;

export const QuestBoardGenerationConfigSchema = z.object({
  /** Defaults to the map seed. */
  seed: z.number().int().optional(),
  /** Number of postings to generate per board (default 3). */
  questsPerBoard: z.number().int().min(0).max(12).optional(),
  /** Current in-world day used for creation/expiry timestamps. */
  currentDay: z.number().int().min(1).default(1),
});
export type QuestBoardGenerationConfigInput = z.input<typeof QuestBoardGenerationConfigSchema>;
export type QuestBoardGenerationConfig = z.output<typeof QuestBoardGenerationConfigSchema>;

// ---------------------------------------------------------------------------
// Realm-domain events (serializable; no engine GameEvent coupling)
// ---------------------------------------------------------------------------

export type RealmEvent =
  | {
      type: 'REPUTATION_CHANGED';
      factionId: string;
      previous: number;
      value: number;
      tier: ReputationTier;
    }
  | {
      type: 'SHOP_PURCHASE';
      poiId: string;
      itemId: string;
      quantity: number;
      costGp: number;
      goldRemaining: number;
    }
  | {
      type: 'SHOP_SALE';
      poiId: string;
      itemId: string;
      quantity: number;
      goldEarned: number;
      goldTotal: number;
    }
  | { type: 'QUEST_ACCEPTED'; questId: string; title: string; day: number }
  | {
      type: 'QUEST_COMPLETED';
      questId: string;
      title: string;
      goldAwarded: number;
      reputationAwarded: number;
      day: number;
    }
  | { type: 'QUEST_FAILED'; questId: string; title: string; day: number };
