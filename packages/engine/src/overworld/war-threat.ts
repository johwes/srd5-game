import {
  z,
} from 'zod';

/**
 * SRD-1104 — War Threat / Heat state and natural decay (Spec 10 Section 7).
 *
 * Owns the shared `WarDiplomacyState` (per-nation Threat `0..100`, sub-faction
 * progress, Druid blessing flag) plus tier bands, pursuit threshold, and the
 * deterministic decay applied as travel days elapse. Pure and seeded; inputs
 * are never mutated — updated copies are returned.
 */

// ---------------------------------------------------------------------------
// Threat / Heat (Spec 10 Section 7)
// ---------------------------------------------------------------------------

export const WAR_THREAT_TIERS = ['unnoticed', 'suspicious', 'hunted', 'most_wanted'] as const;
export const WarThreatTierSchema = z.enum(WAR_THREAT_TIERS);
export type WarThreatTier = z.infer<typeof WarThreatTierSchema>;

/** Threat tier bands (Spec 10 §7). */
export function getWarThreatTier(level: number): WarThreatTier {
  if (level >= 80) return 'most_wanted';
  if (level >= 55) return 'hunted';
  if (level >= 25) return 'suspicious';
  return 'unnoticed';
}

/** Threat at or above this level marks the party as hunted (pursuit squads). */
export const WAR_THREAT_PURSUIT_THRESHOLD = 55;
/** Threat gained for killing an enemy patrol (Spec 10 §7). */
export const WAR_THREAT_KILL_PATROL_GAIN = 20;
/** Threat gained for bribing a patrol captain (Spec 10 §7). */
export const WAR_THREAT_BRIBE_GAIN = 5;
/** Daily decay outside the nation's territory (Spec 10 §7). */
export const WAR_THREAT_DECAY_OUTSIDE_PER_DAY = 6;
/** Daily decay inside the nation's territory while undetected (Spec 10 §7). */
export const WAR_THREAT_DECAY_INSIDE_PER_DAY = 2;

export function isPursuitActiveForThreat(level: number): boolean {
  return level >= WAR_THREAT_PURSUIT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Diplomacy state (threats + sub-faction progress live beside `WarState`)
// ---------------------------------------------------------------------------

export const WAR_SUBFACTION_IDS = ['local_orc_tribe', 'local_druid_circle'] as const;
export const WarSubfactionIdSchema = z.enum(WAR_SUBFACTION_IDS);
export type WarSubfactionId = z.infer<typeof WarSubfactionIdSchema>;

/** Ordered quest chains: the Orc tribe needs 3 quests, the Druid Circle 2. */
export const WAR_SUBFACTION_QUESTS: Record<WarSubfactionId, readonly string[]> = {
  local_orc_tribe: ['orc-raid-relief', 'orc-warchief-parley', 'orc-war-path'],
  local_druid_circle: ['druid-blighted-grove', 'druid-circle-rite'],
};

export const SubFactionProgressSchema = z.object({
  id: WarSubfactionIdSchema,
  completedQuestIds: z.array(z.string().min(1)).default([]),
  allied: z.boolean().default(false),
});
export type SubFactionProgress = z.infer<typeof SubFactionProgressSchema>;

export const WarDiplomacyStateSchema = z.object({
  /** Per-nation Threat level (`0..100`); absent nations are `unnoticed` (0). */
  threats: z.record(z.string().min(1), z.number().int().min(0).max(100)).default({}),
  subfactions: z.record(z.string().min(1), SubFactionProgressSchema).default({}),
  /** Set when the Druid Circle chain completes (forest-stealth/healing hook). */
  druidBlessingActive: z.boolean().default(false),
  /**
   * SRD-1214: retained party interpreter (War Room hire row). When true the
   * party travels with a linguist covering every war command tongue: patrol
   * bluffs and truce parleys fall back to the baseline tier (plus a
   * per-parley fee) instead of the gesture tier. Compromise/double-agent
   * behavior is a deferred data hook (never set in phase 1).
   */
  interpreterHired: z.boolean().default(false),
});
export type WarDiplomacyState = z.infer<typeof WarDiplomacyStateSchema>;

export function createWarDiplomacyState(): WarDiplomacyState {
  return WarDiplomacyStateSchema.parse({});
}

export function getNationThreat(diplomacy: WarDiplomacyState, nationId: string): number {
  return diplomacy.threats[nationId] ?? 0;
}

/** Adds (or removes) Threat for a nation, clamped to `0..100`. */
export function addNationThreat(
  diplomacy: WarDiplomacyState,
  nationId: string,
  delta: number,
): WarDiplomacyState {
  const next = structuredClone(diplomacy);
  const updated = Math.max(0, Math.min(100, getNationThreat(next, nationId) + delta));
  if (updated === 0) delete next.threats[nationId];
  else next.threats[nationId] = updated;
  return next;
}

export const DecayWarThreatsOptionsSchema = z.object({
  /** Full in-game days elapsed since the last decay. */
  days: z.number().int().min(1).default(1),
  /** Nations whose territory the party occupied *detected* (no decay there). */
  detectedNationIds: z.array(z.string().min(1)).default([]),
  /** Nations whose territory the party crossed *undetected* (slow decay). */
  undetectedNationIds: z.array(z.string().min(1)).default([]),
});
export type DecayWarThreatsOptions = z.input<typeof DecayWarThreatsOptionsSchema>;

export interface DecayWarThreatsResult {
  diplomacy: WarDiplomacyState;
  /** Nations whose pursuit stood down by dropping below the hunted threshold. */
  stoodDown: string[];
  headlines: string[];
}

/**
 * Applies natural Threat decay (Spec 10 §7): `-6`/day outside a nation's
 * territory, `-2`/day undetected inside it, no decay while detected inside.
 * Pursuit automatically clears below `55` (reported via `stoodDown`).
 */
export function decayWarThreats(
  diplomacy: WarDiplomacyState,
  rawOptions: Partial<DecayWarThreatsOptions> = {},
): DecayWarThreatsResult {
  const options = DecayWarThreatsOptionsSchema.parse(rawOptions);
  const detected = new Set(options.detectedNationIds);
  const undetected = new Set(options.undetectedNationIds);
  let next = structuredClone(diplomacy);
  const stoodDown: string[] = [];
  const headlines: string[] = [];
  for (const nationId of Object.keys(next.threats)) {
    const before = next.threats[nationId]!;
    if (detected.has(nationId)) continue;
    const perDay = undetected.has(nationId)
      ? WAR_THREAT_DECAY_INSIDE_PER_DAY
      : WAR_THREAT_DECAY_OUTSIDE_PER_DAY;
    const after = Math.max(0, before - perDay * options.days);
    if (after === 0) delete next.threats[nationId];
    else next.threats[nationId] = after;
    if (isPursuitActiveForThreat(before) && !isPursuitActiveForThreat(after)) {
      stoodDown.push(nationId);
      headlines.push(`Hunter-killer pursuit from ${nationId} has stood down — the heat has cooled.`);
    }
  }
  return { diplomacy: next, stoodDown, headlines };
}
