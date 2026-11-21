import { z } from 'zod';

/**
 * SRD-1403 — World-Generation Options, the Civ Setup Screen (Spec 13 §5).
 *
 * No mutator draft, no unlock trees (Spec 13 §0): a Civ/MoM-style options row
 * chosen pre-launch, seeded, replay-stable, stored on the session, and shown in
 * the HUD banner + run record + graveyard so scores compare like-for-like.
 *
 * - World scope: standard (today's sizes) or grand (+50% rooms/tiles,
 *   +1 encounter monster per floor budget).
 * - Wildness: encounter density calm (0.75x) / standard / wild (1.5x).
 * - War intensity (Realm): contained (2 rivals) / standard (3–4 rolled) /
 *   total_war (5 rivals) with aggression tick scaling.
 * - Scarcity: loot rolls and ration consumption abundant / standard / scarce.
 * - Seed: manual entry + daily seed, rolled visibly.
 *
 * Rules: options are chosen pre-launch, never mid-run. Defaults reproduce
 * today's generation exactly (replay-safe baseline): every helper is a pure
 * no-op for the default value and consumes no extra PRNG state, so bit-exact
 * replay of existing seeds stays green.
 *
 * Architectural invariant: no `Math.random()` — all randomness threads the
 * seeded Mulberry32 PRNG at the call site. This module itself is pure math.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const WorldScopeSchema = z.enum(['standard', 'grand']);
export type WorldScope = z.infer<typeof WorldScopeSchema>;

export const WildnessSchema = z.enum(['calm', 'standard', 'wild']);
export type Wildness = z.infer<typeof WildnessSchema>;

export const WarIntensitySchema = z.enum(['contained', 'standard', 'total_war']);
export type WarIntensity = z.infer<typeof WarIntensitySchema>;

export const ScarcitySchema = z.enum(['abundant', 'standard', 'scarce']);
export type Scarcity = z.infer<typeof ScarcitySchema>;

export const WorldSeedSourceSchema = z.enum(['default', 'manual', 'daily']);
export type WorldSeedSource = z.infer<typeof WorldSeedSourceSchema>;

export const WorldOptionsSchema = z.object({
  scope: WorldScopeSchema.default('standard'),
  wildness: WildnessSchema.default('standard'),
  warIntensity: WarIntensitySchema.default('standard'),
  scarcity: ScarcitySchema.default('standard'),
  /** Authoritative run/world seed (manual entry, daily seed, or default). */
  seed: z.number().int().default(1337),
  /** Where `seed` came from — displayed in the HUD banner + graveyard. */
  seedSource: WorldSeedSourceSchema.default('default'),
  /** `YYYY-MM-DD` when `seedSource` is `daily`. */
  dailyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
});
export type WorldOptionsInput = z.input<typeof WorldOptionsSchema>;
export type WorldOptions = z.output<typeof WorldOptionsSchema>;

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  scope: 'standard',
  wildness: 'standard',
  warIntensity: 'standard',
  scarcity: 'standard',
  seed: 1337,
  seedSource: 'default',
};

/** Resolve a partial options bag onto the replay-safe defaults. */
export function resolveWorldOptions(input?: Partial<WorldOptionsInput>): WorldOptions {
  if (!input) return { ...DEFAULT_WORLD_OPTIONS };
  return WorldOptionsSchema.parse({ ...DEFAULT_WORLD_OPTIONS, ...input });
}

/** True when every knob matches today's generation (bit-exact baseline). */
export function isDefaultWorldOptions(options?: Partial<WorldOptionsInput> | null): boolean {
  if (!options) return true;
  const resolved = resolveWorldOptions(options);
  return (
    resolved.scope === 'standard' &&
    resolved.wildness === 'standard' &&
    resolved.warIntensity === 'standard' &&
    resolved.scarcity === 'standard'
  );
}

// ---------------------------------------------------------------------------
// Daily seed (mirrors the Daily Descent FNV-1a scheme without importing remix,
// so dungeon + overworld + remix all stay cycle-free).
// ---------------------------------------------------------------------------

function fnv1a32(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getWorldSeedDateString(date?: Date | string): string {
  if (typeof date === 'string') {
    const match = /^\d{4}-\d{2}-\d{2}/.exec(date.trim());
    if (match) return match[0]!;
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return getWorldSeedDateString(parsed);
    date = undefined;
  }
  const d = date instanceof Date ? date : new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Deterministic 32-bit seed for a daily world/Delve date. */
export function computeWorldDailySeed(dateString: string): number {
  const normalized = getWorldSeedDateString(dateString);
  const uint = fnv1a32(`srd5:daily_descent:${normalized}`);
  return uint === 0 ? 1337 : uint;
}

export function createDailyWorldOptions(date?: Date | string): WorldOptions {
  const dailyDate = getWorldSeedDateString(date ?? new Date());
  return {
    ...DEFAULT_WORLD_OPTIONS,
    seed: computeWorldDailySeed(dailyDate),
    seedSource: 'daily',
    dailyDate,
  };
}

// ---------------------------------------------------------------------------
// Scope — map/floor scale
// ---------------------------------------------------------------------------

export interface FloorSizeInput {
  width: number;
  height: number;
  targetRoomCount: number;
}

/** Grand scope: +50% rooms/tiles (capped), standard: untouched. */
export function applyScopeToFloorSize(
  input: FloorSizeInput,
  scope: WorldScope = 'standard',
): FloorSizeInput {
  if (scope === 'standard') return { ...input };
  return {
    width: Math.min(80, Math.max(input.width, Math.ceil(input.width * 1.5))),
    height: Math.min(80, Math.max(input.height, Math.ceil(input.height * 1.5))),
    targetRoomCount: Math.min(24, Math.max(input.targetRoomCount, Math.ceil(input.targetRoomCount * 1.5))),
  };
}

export interface OverworldSizeInput {
  width: number;
  height: number;
}

/** Grand scope on the Realm map: +50% tiles per axis (capped at 256). */
export function applyScopeToOverworldSize(
  input: OverworldSizeInput,
  scope: WorldScope = 'standard',
): OverworldSizeInput {
  if (scope === 'standard') return { ...input };
  return {
    width: Math.min(256, Math.ceil(input.width * 1.5)),
    height: Math.min(256, Math.ceil(input.height * 1.5)),
  };
}

// ---------------------------------------------------------------------------
// Wildness — encounter density (pure count scaling, no extra RNG)
// ---------------------------------------------------------------------------

export const WILDNESS_DENSITY_MULTIPLIER: Record<Wildness, number> = {
  calm: 0.75,
  standard: 1,
  wild: 1.5,
};

/**
 * Scales a rolled base monster count for encounter density.
 * Standard is the identity (no RNG, bit-exact). Calm sheds one (min 1);
 * wild adds one extra hunter to the pack.
 */
export function applyWildnessToMonsterCount(
  baseCount: number,
  wildness: Wildness = 'standard',
): number {
  if (wildness === 'standard') return baseCount;
  if (wildness === 'calm') return Math.max(1, baseCount - 1);
  return baseCount + 1;
}

// ---------------------------------------------------------------------------
// Scarcity — loot rolls and ration consumption
// ---------------------------------------------------------------------------

export interface LootCoins {
  cp?: number;
  sp?: number;
  ep?: number;
  gp?: number;
  pp?: number;
}

/** Scales coin fields; items/magic bias untouched. Standard is identity. */
export function scaleLootForScarcity<T extends LootCoins>(loot: T, scarcity: Scarcity = 'standard'): T {
  if (scarcity === 'standard') return { ...loot };
  const factor = scarcity === 'abundant' ? 1.5 : 0.5;
  const next: LootCoins = { ...(loot as LootCoins) };
  for (const denom of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
    const value = (loot as LootCoins)[denom];
    if (typeof value === 'number' && value > 0) {
      (next as Record<string, number>)[denom] = Math.max(0, Math.floor(value * factor));
    }
  }
  return next as T;
}

/** Ration requirement for a Long Rest (per living member). */
export function scaleRationRequirement(base: number, scarcity: Scarcity = 'standard'): number {
  if (scarcity === 'standard') return base;
  if (scarcity === 'abundant') return Math.max(1, Math.ceil(base * 0.5));
  return base * 2;
}

/** Starting supply cache for a new run/expedition. */
export function scaleStartingRations(base: number, scarcity: Scarcity = 'standard'): number {
  if (scarcity === 'standard') return base;
  if (scarcity === 'abundant') return base + 5;
  return Math.max(1, base - 4);
}

// ---------------------------------------------------------------------------
// War intensity — rival nations + aggression tick
// ---------------------------------------------------------------------------

export const WAR_INTENSITY_RIVAL_COUNTS: Record<WarIntensity, number | 'rolled'> = {
  contained: 2,
  standard: 'rolled',
  total_war: 5,
};

export const WAR_INTENSITY_TICK_DAYS: Record<WarIntensity, number> = {
  contained: 4,
  standard: 3,
  total_war: 2,
};

/**
 * Resolves the total nation count for `initializeWarState()` from intensity.
 * Standard returns undefined so the engine keeps its deterministic 3–4 roll
 * (bit-exact); contained forces 3 total (player + 2 rivals), total_war 6.
 */
export function resolveWarNationCountForIntensity(
  intensity: WarIntensity = 'standard',
): 3 | 6 | undefined {
  if (intensity === 'contained') return 3;
  if (intensity === 'total_war') return 6;
  return undefined;
}

/** Aggression tick scaling: fewer days per tick means a hotter war. */
export function resolveWarTickIntervalForIntensity(intensity: WarIntensity = 'standard'): number {
  return WAR_INTENSITY_TICK_DAYS[intensity];
}

// ---------------------------------------------------------------------------
// Presentation — HUD banner + run record + graveyard
// ---------------------------------------------------------------------------

export const WORLD_OPTION_LABELS: Record<string, Record<string, string>> = {
  scope: { standard: 'Standard', grand: 'Grand' },
  wildness: { calm: 'Calm', standard: 'Standard', wild: 'Wild' },
  warIntensity: { contained: 'Contained (2 rivals)', standard: 'Standard (3–4 rivals)', total_war: 'Total War (5 rivals)' },
  scarcity: { abundant: 'Abundant', standard: 'Standard', scarce: 'Scarce' },
};

export function formatWorldOptionsBanner(options?: Partial<WorldOptionsInput> | null): string {
  const resolved = resolveWorldOptions(options ?? undefined);
  const scope = WORLD_OPTION_LABELS.scope[resolved.scope] ?? resolved.scope;
  const wild = WORLD_OPTION_LABELS.wildness[resolved.wildness] ?? resolved.wildness;
  const scar = WORLD_OPTION_LABELS.scarcity[resolved.scarcity] ?? resolved.scarcity;
  const seedHex = `0x${(resolved.seed >>> 0).toString(16).toUpperCase()}`;
  const seedTag = resolved.seedSource === 'daily' && resolved.dailyDate
    ? `Daily ${resolved.dailyDate} · ${seedHex}`
    : resolved.seedSource === 'manual'
      ? `Seed ${resolved.seed} · ${seedHex}`
      : `Seed ${seedHex}`;
  return `${scope} · ${wild} density · ${scar} · ${seedTag}`;
}

/** Compact summary persisted on run records + graveyard entries. */
export function getWorldOptionsSummary(options?: Partial<WorldOptionsInput> | null): string {
  return formatWorldOptionsBanner(options);
}
