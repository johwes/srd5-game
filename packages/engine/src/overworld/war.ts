import { z } from 'zod';
import {
  OVERWORLD_EDGE_DIRECTIONS,
  type FactionAlignment,
  type OverworldMap,
  type OverworldPOI,
  type OverworldPOIKind,
  type OverworldTile,
  OverworldMapSchema,
  overworldTileKey,
} from './schemas.js';
import { normalizeSeed, nextRandomFloat, nextRandomUint32 } from '../dice/prng.js';
import { RealmError } from './realm-error.js';

/**
 * SRD-1101 — War Core: nation archetypes, strategic POIs, living war tick
 * (Spec 10 Sections 1–3).
 *
 * The Realm frames the party as an elite special-operations company serving one
 * nation in a 3–4 nation war. Each nation holds a War Power score
 * (`0..dominanceTarget`, default `100`) across four visible pillars
 * (military / economy / arcana / morale). Victory: the player's nation reaches
 * `dominanceTarget` or all rivals collapse to `0`. Defeat: the player's nation
 * collapses to `0` (or a rival reaches dominance first).
 *
 * All functions are pure and deterministic. Every random choice threads the
 * seeded Mulberry32 PRNG (`rngState`); `Math.random()` is never called.
 */

// ---------------------------------------------------------------------------
// Nation archetypes (Spec 10 Section 2 — 3 Good / 3 Neutral / 2 Evil)
// ---------------------------------------------------------------------------

export interface WarNationArchetype {
  readonly id: string;
  readonly nationName: string;
  readonly ruler: string;
  readonly alignment: FactionAlignment;
  /** Strategic flavor line (original lore, zero SRD Product Identity). */
  readonly flavor: string;
  /** Patron perk granted to parties serving this nation. */
  readonly perk: string;
  readonly bannerColor: string;
}

export const WAR_NATION_ARCHETYPES: readonly WarNationArchetype[] = [
  {
    id: 'dawn-crown',
    nationName: 'The Dawn Crown',
    ruler: 'Queen Evelyn',
    alignment: 'good',
    flavor: 'Benevolent monarch defending her realm’s cities and farmlands.',
    perk: 'Royal Provisioning (inn/temple discount + Morale bonus).',
    bannerColor: '#b45309',
  },
  {
    id: 'emerald-circle',
    nationName: 'The Emerald Circle',
    ruler: 'Archdruid Sylvanus',
    alignment: 'good',
    flavor: 'Noble wardens of the ancient forests and sacred groves.',
    perk: 'Wilderness Guides (reduced off-road forest/swamp travel cost).',
    bannerColor: '#15803d',
  },
  {
    id: 'silver-bastion',
    nationName: 'The Silver Bastion',
    ruler: 'Lord Commander Cedric',
    alignment: 'good',
    flavor: 'Chivalric order of knights and frontier rangers shielding border towns.',
    perk: 'Shieldwall Oath (allied militia join POI defense battles).',
    bannerColor: '#9ca3af',
  },
  {
    id: 'gilded-league',
    nationName: 'The Gilded League',
    ruler: 'Magister Vance',
    alignment: 'neutral',
    flavor: 'Pragmatic merchant-princes funding mercenary companies.',
    perk: 'Mercenary Coffers (15% shop & mercenary hire discount).',
    bannerColor: '#ca8a04',
  },
  {
    id: 'iron-covenant',
    nationName: 'The Iron Covenant',
    ruler: 'High Thane Torin',
    alignment: 'neutral',
    flavor: 'Proud fortress-builders and deep-earth miners.',
    perk: 'Deep Forges (+25% Economy Power from intact mines).',
    bannerColor: '#b91c1c',
  },
  {
    id: 'frostbound-clan',
    nationName: 'The Frostbound Clan',
    ruler: 'Jarl Astrid',
    alignment: 'neutral',
    flavor: 'Fierce northern clan valuing martial honor and coastal raiding.',
    perk: 'Raider’s Swiftness (faster forced marches & ambush bonuses).',
    bannerColor: '#0f766e',
  },
  {
    id: 'ashen-spire',
    nationName: 'The Ashen Spire',
    ruler: 'Archmage Malakor',
    alignment: 'evil',
    flavor: 'Conquering archmage and necromancer seeking arcane supremacy.',
    perk: 'Arcane Tithe (bonus Arcana Power & spell scrolls).',
    bannerColor: '#4c1d95',
  },
  {
    id: 'bloodtusk-horde',
    nationName: 'The Bloodtusk Horde',
    ruler: 'Warlord Grak',
    alignment: 'evil',
    flavor: 'Warring tribe offering plunder, tribute, and raw might.',
    perk: 'Spoils of War (+25% mission gold rewards).',
    bannerColor: '#7f1d1d',
  },
];

export const WAR_GOOD_ARCHETYPE_IDS = WAR_NATION_ARCHETYPES.filter((a) => a.alignment === 'good').map(
  (a) => a.id,
);
export const WAR_EVIL_ARCHETYPE_IDS = WAR_NATION_ARCHETYPES.filter((a) => a.alignment === 'evil').map(
  (a) => a.id,
);

export function getWarNationArchetype(id: string): WarNationArchetype {
  const found = WAR_NATION_ARCHETYPES.find((a) => a.id === id);
  if (!found) throw new RealmError(`Unknown war nation archetype '${id}'`);
  return found;
}

// ---------------------------------------------------------------------------
// War Power pillars & nation state
// ---------------------------------------------------------------------------

export const WarPowerPillarsSchema = z.object({
  military: z.number().int().min(0),
  economy: z.number().int().min(0),
  arcana: z.number().int().min(0),
  morale: z.number().int().min(0),
});
export type WarPowerPillars = z.infer<typeof WarPowerPillarsSchema>;

/** Starting pillars for every nation: visible, even footing (total 20). */
export const WAR_INITIAL_POWER: WarPowerPillars = {
  military: 5,
  economy: 5,
  arcana: 5,
  morale: 5,
};

/** Pillar each strategic POI kind feeds while `intact` (Spec 10 §1/§3). */
export const STRATEGIC_POI_POWER_PILLAR: Record<string, keyof WarPowerPillars> = {
  fortress: 'military',
  mine: 'economy',
  bridge: 'economy',
  supply_depot: 'economy',
  prison_keep: 'morale',
  subfaction_camp: 'morale',
};

/** Default `powerValue` per strategic POI kind. */
export const STRATEGIC_POI_POWER_VALUES: Record<string, number> = {
  fortress: 3,
  mine: 2,
  bridge: 1,
  supply_depot: 2,
  prison_keep: 2,
  subfaction_camp: 1,
};

/** Baseline arcana/morale drift per tick (battle mages, domestic security). */
export const WAR_BASELINE_ARCANA_PER_TICK = 1;
export const WAR_BASELINE_MORALE_PER_TICK = 1;

export function getWarPowerTotal(power: WarPowerPillars): number {
  return power.military + power.economy + power.arcana + power.morale;
}

export const WarNationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ruler: z.string().min(1),
  alignment: z.enum(['good', 'neutral', 'evil']),
  /** Patron perk line from the archetype table (effects wired in SRD-1103+). */
  perk: z.string().min(1),
  bannerColor: z.string().min(1),
  power: WarPowerPillarsSchema,
  /** True for the nation the party serves. */
  isPlayerNation: z.boolean(),
});
export type WarNation = z.infer<typeof WarNationSchema>;

export function getWarNationTotal(nation: WarNation): number {
  return getWarPowerTotal(nation.power);
}

// ---------------------------------------------------------------------------
// Truces & guerrilla drains (forward-compatible hooks owned by SRD-1104)
// ---------------------------------------------------------------------------

export const WarTruceSchema = z.object({
  nationIdA: z.string().min(1),
  nationIdB: z.string().min(1),
  /** War day the truce expires (exclusive: active while `currentDay < untilDay`). */
  untilDay: z.number().int().min(1),
});
export type WarTruce = z.infer<typeof WarTruceSchema>;

export const GuerrillaDrainSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  targetNationId: z.string().min(1),
  militaryDrain: z.number().int().min(0).default(0),
  economyDrain: z.number().int().min(0).default(0),
});
export type GuerrillaDrain = z.infer<typeof GuerrillaDrainSchema>;

// ---------------------------------------------------------------------------
// Chronicle & war state
// ---------------------------------------------------------------------------

export const WAR_CHRONICLE_KINDS = [
  'war_founded',
  'bridge_rebuilt',
  'mine_contested',
  'mine_cursed',
  'poi_sabotaged',
  'poi_attacked',
  'poi_lost',
  'truce_signed',
  'truce_expired',
  'mercenaries_hired',
  'covert_strike',
  'guerrilla_started',
  'druid_blessing',
  'patrol_skirmish',
  'pursuit_started',
  'pursuit_ended',
  'nation_collapsed',
  'victory',
  'defeat',
] as const;
export const WarChronicleKindSchema = z.enum(WAR_CHRONICLE_KINDS);
export type WarChronicleKind = z.infer<typeof WarChronicleKindSchema>;

export const WarChronicleEntrySchema = z.object({
  day: z.number().int().min(1),
  kind: WarChronicleKindSchema,
  headline: z.string().min(1),
});
export type WarChronicleEntry = z.infer<typeof WarChronicleEntrySchema>;

export const WAR_OUTCOMES = ['ongoing', 'victory', 'defeat'] as const;
export const WarOutcomeSchema = z.enum(WAR_OUTCOMES);
export type WarOutcome = z.infer<typeof WarOutcomeSchema>;

export const WarStateSchema = z.object({
  seed: z.number().int(),
  /** Current war day (1-indexed; advances by `tickIntervalDays` per tick). */
  currentDay: z.number().int().min(1),
  tickCount: z.number().int().min(0),
  /** Days between living-world ticks (default 3, Spec 10 §3). */
  tickIntervalDays: z.number().int().min(1).default(3),
  /** First nation to this total wins (default 100, Spec 10 §1). */
  dominanceTarget: z.number().int().min(1).default(100),
  nations: z.record(z.string(), WarNationSchema),
  /** Deterministic nation order (selection order). */
  nationOrder: z.array(z.string().min(1)),
  playerNationId: z.string().min(1),
  rngState: z.number().int(),
  truces: z.array(WarTruceSchema).default([]),
  guerrillaDrains: z.array(GuerrillaDrainSchema).default([]),
  chronicle: z.array(WarChronicleEntrySchema).default([]),
  outcome: WarOutcomeSchema.default('ongoing'),
  outcomeReason: z.string().optional(),
});
export type WarState = z.infer<typeof WarStateSchema>;

// ---------------------------------------------------------------------------
// Tuning knobs (exported for tests and SRD-1103 mission hooks)
// ---------------------------------------------------------------------------

export const WAR_SIM_TUNING = {
  /** Per-tick chance an unclaimed/neutral intact mine is contested. */
  neutralMineContestChance: 0.35,
  /** Per-tick chance an evil/arcane rival curses an intact player mine. */
  necromanticCurseChance: 0.25,
  /** Per-tick chance a rival sabotages another intact player POI. */
  sabotageChance: 0.2,
  /** Per-tick chance a rival opens a timed assault on an intact player POI. */
  attackWarningChance: 0.25,
  /** Days of warning before an `under_attack` POI falls when undefended. */
  attackWarningLeadDays: 6,
  /** Days until a destroyed bridge is rebuilt. */
  bridgeRebuildDays: 9,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getWarNation(war: WarState, nationId: string): WarNation {
  const nation = war.nations[nationId];
  if (!nation) throw new RealmError(`Unknown war nation '${nationId}'`);
  return nation;
}

export function getPlayerWarNation(war: WarState): WarNation {
  return getWarNation(war, war.playerNationId);
}

export function getRivalWarNations(war: WarState): WarNation[] {
  return war.nationOrder
    .filter((id) => id !== war.playerNationId)
    .map((id) => getWarNation(war, id));
}

export function isTruceActive(war: WarState, nationA: string, nationB: string, day: number): boolean {
  return war.truces.some(
    (truce) =>
      ((truce.nationIdA === nationA && truce.nationIdB === nationB) ||
        (truce.nationIdA === nationB && truce.nationIdB === nationA)) &&
      day < truce.untilDay,
  );
}

/** All strategic-kind POIs on the map (Spec 10 §3). */
export function getStrategicPOIs(map: OverworldMap): OverworldPOI[] {
  return Object.values(map.pois).filter((poi) =>
    ['fortress', 'mine', 'bridge', 'supply_depot', 'prison_keep', 'subfaction_camp'].includes(poi.kind),
  );
}

function pickRandom<T>(items: readonly T[], rngState: number): { item: T; nextRng: number } {
  if (items.length === 0) throw new RealmError('Cannot pick from an empty pool');
  const draw = nextRandomFloat(normalizeSeed(rngState));
  return { item: items[Math.floor(draw.value * items.length)]!, nextRng: draw.nextState };
}

function rollChance(rngState: number, chance: number): { success: boolean; nextRng: number } {
  const draw = nextRandomFloat(normalizeSeed(rngState));
  return { success: draw.value < chance, nextRng: draw.nextState };
}

/** Deterministic Fisher–Yates shuffle; never mutates the input. */
function shuffled<T>(items: readonly T[], rngState: number): { items: T[]; nextRng: number } {
  const output = [...items];
  let state = normalizeSeed(rngState);
  for (let i = output.length - 1; i > 0; i--) {
    const draw = nextRandomUint32(state);
    state = draw.nextState;
    const j = draw.value % (i + 1);
    [output[i], output[j]] = [output[j]!, output[i]!];
  }
  return { items: output, nextRng: state };
}

// ---------------------------------------------------------------------------
// War founding (deterministic 3–4 nation roll + strategic POI placement)
// ---------------------------------------------------------------------------

export const InitializeWarStateOptionsSchema = z.object({
  seed: z.number().int().optional(),
  /** Force 3 or 4 nations; otherwise rolled deterministically (≈50/50). */
  nationCount: z.union([z.literal(3), z.literal(4)]).optional(),
  /** Force the player nation; defaults to the first Good nation selected. */
  playerNationArchetypeId: z.string().min(1).optional(),
  /** Strategic POIs placed per nation (fortress/mine/depot/bridge cycle). */
  strategicPoisPerNation: z.number().int().min(1).max(6).default(4),
  /** Extra unclaimed mines open to contests (default 2, Spec 10 §3). */
  neutralMineCount: z.number().int().min(0).max(6).default(2),
});
export type InitializeWarStateOptions = z.infer<typeof InitializeWarStateOptionsSchema>;

export interface InitializeWarStateResult {
  war: WarState;
  map: OverworldMap;
  events: WarChronicleEntry[];
}

function resolveNationSelection(
  rngState: number,
  nationCount: 3 | 4,
  requiredArchetypeId?: string,
): { selected: WarNationArchetype[]; nextRng: number } {
  const required = requiredArchetypeId
    ? WAR_NATION_ARCHETYPES.find((a) => a.id === requiredArchetypeId)
    : undefined;
  if (requiredArchetypeId && !required) {
    throw new RealmError(`Unknown player nation archetype '${requiredArchetypeId}'`);
  }

  const order = shuffled(WAR_NATION_ARCHETYPES, rngState);
  const state = order.nextRng;
  let selected: WarNationArchetype[];
  if (required) {
    const rest = order.items.filter((a) => a.id !== required.id);
    selected = [required, ...rest.slice(0, nationCount - 1)];
  } else {
    selected = order.items.slice(0, nationCount);
  }

  const ensureAlignment = (
    current: WarNationArchetype[],
    wanted: FactionAlignment,
  ): WarNationArchetype[] => {
    if (current.some((a) => a.alignment === wanted)) return current;
    const replacement = order.items.find(
      (a) => a.alignment === wanted && !current.some((s) => s.id === a.id),
    );
    if (!replacement) return current;
    // Never evict the player's explicitly chosen nation or the sole opposite-alignment nation.
    const oppositeAlignment: FactionAlignment | null =
      wanted === 'good' ? 'evil' : wanted === 'evil' ? 'good' : null;
    const firstOppositeIdx = oppositeAlignment
      ? current.findIndex((a) => a.alignment === oppositeAlignment)
      : -1;
    const isProtected = (a: WarNationArchetype, idx: number): boolean =>
      a.id === required?.id || (firstOppositeIdx !== -1 && idx === firstOppositeIdx);
    let victimIndex = current.findIndex((a, idx) => a.alignment === 'neutral' && !isProtected(a, idx));
    if (victimIndex === -1) {
      for (let i = current.length - 1; i >= 0; i--) {
        if (!isProtected(current[i]!, i)) {
          victimIndex = i;
          break;
        }
      }
    }
    if (victimIndex === -1) return current;
    const next = [...current];
    next[victimIndex] = replacement;
    return next;
  };

  selected = ensureAlignment(selected, 'good');
  selected = ensureAlignment(selected, 'evil');
  return { selected, nextRng: state };
}

const STRATEGIC_KIND_CYCLE: OverworldPOIKind[] = ['fortress', 'mine', 'supply_depot', 'bridge'];

function strategicPoiName(nationName: string | undefined, kind: OverworldPOIKind, index: number): string {
  const kindLabel =
    kind === 'fortress'
      ? 'Bastion'
      : kind === 'mine'
        ? 'Mine'
        : kind === 'bridge'
          ? 'Bridge'
          : kind === 'supply_depot'
            ? 'Depot'
            : kind === 'prison_keep'
              ? 'Keep'
              : 'Camp';
  const owner = nationName ?? 'Freehold';
  return index <= 1 ? `${owner} ${kindLabel}` : `${owner} ${kindLabel} ${index}`;
}

/**
 * Founds the multi-nation war: rolls 3–4 nations (always ≥1 Good and ≥1 Evil),
 * musters starting War Power, and plants strategic POIs on free land tiles.
 * The supplied map is never mutated.
 */
export function initializeWarState(
  map: OverworldMap,
  rawOptions: Partial<InitializeWarStateOptions> = {},
): InitializeWarStateResult {
  const options = InitializeWarStateOptionsSchema.parse(rawOptions);
  let rngState = normalizeSeed(options.seed ?? map.worldSeed);

  const countDraw = nextRandomFloat(rngState);
  rngState = countDraw.nextState;
  const nationCount = options.nationCount ?? (countDraw.value < 0.5 ? 3 : 4);

  const selection = resolveNationSelection(rngState, nationCount, options.playerNationArchetypeId);
  rngState = selection.nextRng;
  const selected = selection.selected;

  const playerArchetypeId =
    options.playerNationArchetypeId ?? selected.find((a) => a.alignment === 'good')?.id ?? selected[0]!.id;
  if (!selected.some((a) => a.id === playerArchetypeId)) {
    throw new RealmError(`Player nation '${playerArchetypeId}' is not among the warring nations`);
  }

  const nations: Record<string, WarNation> = {};
  for (const archetype of selected) {
    nations[archetype.id] = {
      id: archetype.id,
      name: archetype.nationName,
      ruler: archetype.ruler,
      alignment: archetype.alignment,
      perk: archetype.perk,
      bannerColor: archetype.bannerColor,
      power: { ...WAR_INITIAL_POWER },
      isPlayerNation: archetype.id === playerArchetypeId,
    };
  }

  const nextMap: OverworldMap = structuredClone(map);
  // Register war nations as macro-factions so tile control stays consistent.
  for (const nation of Object.values(nations)) {
    if (!nextMap.factions[nation.id]) {
      nextMap.factions[nation.id] = {
        id: nation.id,
        name: nation.name,
        bannerColor: nation.bannerColor,
        alignment: nation.alignment,
        relationshipWithParty: nation.isPlayerNation ? 100 : -50,
        capitalPoiId: `war_${nation.id}_fortress_1`,
        townPoiIds: [],
      };
    }
  }

  // Collect free land tiles (no POI, not ocean) in deterministic key order.
  const freeTiles = Object.values(nextMap.tiles)
    .filter((tile) => tile.terrain !== 'ocean' && !tile.poiId)
    .sort((a, b) => a.q - b.q || a.r - b.r);
  const perNation = options.strategicPoisPerNation;
  const needed = selected.length * perNation + options.neutralMineCount;
  if (freeTiles.length < needed) {
    throw new RealmError(
      `Not enough free land for strategic POIs (need ${needed}, have ${freeTiles.length})`,
    );
  }
  const spread = shuffled(freeTiles, rngState);
  rngState = spread.nextRng;
  const available: OverworldTile[] = [...spread.items];

  const isAdjacentToOcean = (tile: OverworldTile): boolean =>
    OVERWORLD_EDGE_DIRECTIONS.some((dir) => {
      const neighbor = nextMap.tiles[overworldTileKey(tile.q + dir.q, tile.r + dir.r)];
      return neighbor?.terrain === 'ocean';
    });

  const takeMatchingTile = (predicates: Array<(tile: OverworldTile) => boolean>): OverworldTile => {
    for (const pred of predicates) {
      const idx = available.findIndex(pred);
      if (idx !== -1) {
        return available.splice(idx, 1)[0]!;
      }
    }
    return available.shift()!;
  };

  const takeTileForKind = (kind: OverworldPOIKind): OverworldTile => {
    if (kind === 'bridge') {
      return takeMatchingTile([
        (t) => (t.riverEdges?.length ?? 0) > 0 && Boolean(t.roadThrough),
        (t) => (t.riverEdges?.length ?? 0) > 0,
        (t) => t.terrain === 'coast' || isAdjacentToOcean(t),
      ]);
    }
    if (kind === 'mine') {
      return takeMatchingTile([
        (t) => t.terrain === 'mountains' || t.terrain === 'hills',
      ]);
    }
    if (kind === 'supply_depot') {
      return takeMatchingTile([(t) => Boolean(t.roadThrough)]);
    }
    return available.shift()!;
  };

  const events: WarChronicleEntry[] = [];
  const ownedByNation: Record<string, string[]> = {};
  const kindCounters: Record<string, number> = {};

  const placeStrategicPoi = (
    kind: OverworldPOIKind,
    ownerNationId: string | undefined,
    tile: { q: number; r: number },
  ): void => {
    const counterKey = ownerNationId ? `${ownerNationId}:${kind}` : `neutral:${kind}`;
    kindCounters[counterKey] = (kindCounters[counterKey] ?? 0) + 1;
    const ownerNation = ownerNationId ? nations[ownerNationId] : undefined;
    const idBase = ownerNationId ? `war_${ownerNationId}_${kind}_${kindCounters[counterKey]}` : `war_free_${kind}_${kindCounters[counterKey]}`;
    let poiId = idBase;
    let suffix = 2;
    while (nextMap.pois[poiId]) poiId = `${idBase}_${suffix++}`;
    const poi: OverworldPOI = {
      id: poiId,
      name: strategicPoiName(ownerNation?.name, kind, kindCounters[counterKey]!),
      kind,
      q: tile.q,
      r: tile.r,
      ...(ownerNationId
        ? { factionId: ownerNationId, ownerNationId }
        : {}),
      strategicStatus: 'intact',
      statusChangedDay: 1,
      powerValue: STRATEGIC_POI_POWER_VALUES[kind] ?? 1,
    };
    nextMap.pois[poiId] = poi;
    const mapTile = nextMap.tiles[overworldTileKey(tile.q, tile.r)]!;
    mapTile.poiId = poiId;
    if (ownerNationId) {
      mapTile.factionControlId = ownerNationId;
      (ownedByNation[ownerNationId] ??= []).push(poiId);
    }
  };

  for (const nation of selected) {
    for (let i = 0; i < perNation; i++) {
      const kind = STRATEGIC_KIND_CYCLE[i % STRATEGIC_KIND_CYCLE.length]!;
      placeStrategicPoi(kind, nation.id, takeTileForKind(kind));
    }
  }
  for (let i = 0; i < options.neutralMineCount; i++) {
    placeStrategicPoi('mine', undefined, takeTileForKind('mine'));
  }

  // Point each war faction at its stronghold seats.
  for (const nation of selected) {
    const owned = ownedByNation[nation.id] ?? [];
    const faction = nextMap.factions[nation.id]!;
    const fortress = owned.find((id) => nextMap.pois[id]?.kind === 'fortress') ?? owned[0]!;
    faction.capitalPoiId = fortress;
    faction.townPoiIds = owned.filter((id) => id !== fortress);
    nextMap.factions[nation.id] = faction;
  }

  OverworldMapSchema.parse(nextMap);

  const war: WarState = WarStateSchema.parse({
    seed: options.seed ?? map.worldSeed,
    currentDay: 1,
    tickCount: 0,
    tickIntervalDays: 3,
    dominanceTarget: 100,
    nations,
    nationOrder: selected.map((a) => a.id),
    playerNationId: playerArchetypeId,
    rngState,
    truces: [],
    guerrillaDrains: [],
    chronicle: [],
    outcome: 'ongoing',
  });

  const playerNation = nations[playerArchetypeId]!;
  const rivalNames = selected
    .filter((a) => a.id !== playerArchetypeId)
    .map((a) => a.nationName)
    .join(', ');
  const founded: WarChronicleEntry = {
    day: 1,
    kind: 'war_founded',
    headline: `${playerNation.name} marches to war against ${rivalNames}.`,
  };
  events.push(founded);

  return {
    war: { ...war, chronicle: [founded] },
    map: nextMap,
    events,
  };
}

// ---------------------------------------------------------------------------
// Living war tick
// ---------------------------------------------------------------------------

export interface AdvanceWarSimulationOptions {
  /** Advance until this war day (inclusive); defaults to one tick ahead. */
  toDay?: number;
  /** Skip stochastic raids/curses/sabotage (isolates income + rebuilds). */
  disableRandomEvents?: boolean;
}

export interface AdvanceWarSimulationResult {
  war: WarState;
  map: OverworldMap;
  events: WarChronicleEntry[];
}

function pushChronicle(events: WarChronicleEntry[], day: number, kind: WarChronicleKind, headline: string): void {
  events.push({ day, kind, headline });
}

/** Evaluates Power Dominance victory/defeat for the current war state. */
export function evaluateWarOutcome(war: WarState): { outcome: WarOutcome; reason?: string } {
  const player = getPlayerWarNation(war);
  const rivals = getRivalWarNations(war);
  const playerTotal = getWarNationTotal(player);
  if (playerTotal <= 0) {
    return { outcome: 'defeat', reason: `${player.name} has collapsed to 0 War Power.` };
  }
  if (rivals.length > 0 && rivals.every((rival) => getWarNationTotal(rival) <= 0)) {
    return { outcome: 'victory', reason: 'All rival nations have collapsed to 0 War Power.' };
  }
  if (playerTotal >= war.dominanceTarget) {
    return { outcome: 'victory', reason: `${player.name} has reached ${war.dominanceTarget} War Power.` };
  }
  const dominator = rivals.find((rival) => getWarNationTotal(rival) >= war.dominanceTarget);
  if (dominator) {
    return { outcome: 'defeat', reason: `${dominator.name} has reached ${war.dominanceTarget} War Power.` };
  }
  return { outcome: 'ongoing' };
}

function runSingleWarTick(
  war: WarState,
  map: OverworldMap,
  options: AdvanceWarSimulationOptions,
): { war: WarState; map: OverworldMap; events: WarChronicleEntry[] } {
  const events: WarChronicleEntry[] = [];
  const nextMap: OverworldMap = structuredClone(map);
  const nextNations: Record<string, WarNation> = structuredClone(war.nations);
  let rngState = normalizeSeed(war.rngState);
  const day = war.currentDay + war.tickIntervalDays;

  const nationName = (id: string): string => nextNations[id]?.name ?? id;

  // 1. Bridge rebuilds: destroyed bridges finish repairs on `recoveryDay`.
  for (const poi of Object.values(nextMap.pois)) {
    if (
      poi.kind === 'bridge' &&
      poi.strategicStatus === 'destroyed' &&
      poi.recoveryDay !== undefined &&
      day >= poi.recoveryDay
    ) {
      poi.strategicStatus = 'intact';
      poi.statusChangedDay = day;
      delete poi.recoveryDay;
      pushChronicle(events, day, 'bridge_rebuilt', `${poi.name} has been rebuilt — supply lines flow again.`);
    }
  }

  // 2. Resolve expired `under_attack` defenses left undefended (SRD-1103/1105
  //    defenses complete through missions; expiry here means the enemy prevails).
  for (const poi of Object.values(nextMap.pois)) {
    if (
      poi.strategicStatus === 'under_attack' &&
      poi.attackDeadlineDay !== undefined &&
      day >= poi.attackDeadlineDay
    ) {
      const ownerId = poi.ownerNationId ?? poi.factionId;
      const attacker = poi.contestedByNationId ? nationName(poi.contestedByNationId) : 'the enemy';
      if (poi.kind === 'bridge') {
        poi.strategicStatus = 'destroyed';
        poi.statusChangedDay = day;
        poi.recoveryDay = day + WAR_SIM_TUNING.bridgeRebuildDays;
        delete poi.attackDeadlineDay;
        pushChronicle(events, day, 'poi_lost', `${poi.name} has fallen to ${attacker} and lies in ruins.`);
      } else {
        poi.strategicStatus = 'sabotaged';
        poi.statusChangedDay = day;
        delete poi.attackDeadlineDay;
        pushChronicle(events, day, 'poi_lost', `${poi.name} has fallen to ${attacker} and been looted.`);
      }
      void ownerId;
    }
  }

  // 3. Resource income: intact strategic POIs feed their owner's pillar.
  for (const poi of Object.values(nextMap.pois)) {
    if (poi.strategicStatus !== 'intact') continue;
    const ownerId = poi.ownerNationId ?? poi.factionId;
    if (!ownerId || !nextNations[ownerId]) continue;
    const pillar = STRATEGIC_POI_POWER_PILLAR[poi.kind];
    if (!pillar) continue;
    const owner = nextNations[ownerId]!;
    let gain = poi.powerValue ?? STRATEGIC_POI_POWER_VALUES[poi.kind] ?? 1;
    // Deep Forges: the Iron Covenant mines run hot.
    if (ownerId === 'iron-covenant' && poi.kind === 'mine') gain = Math.ceil(gain * 1.25);
    owner.power[pillar] += gain;
  }
  for (const nation of Object.values(nextNations)) {
    // Collapsed nations (0 War Power, no intact holdings) stay collapsed —
    // only fresh POI income can revive them.
    if (getWarPowerTotal(nation.power) > 0) {
      nation.power.arcana += WAR_BASELINE_ARCANA_PER_TICK;
      nation.power.morale += WAR_BASELINE_MORALE_PER_TICK;
    }
  }

  // 4. Guerrilla drains (SRD-1104 sub-faction proxy warfare hook).
  for (const drain of war.guerrillaDrains) {
    const target = nextNations[drain.targetNationId];
    if (!target) continue;
    target.power.military = Math.max(0, target.power.military - drain.militaryDrain);
    target.power.economy = Math.max(0, target.power.economy - drain.economyDrain);
    if (getWarNationTotal(target) <= 0) {
      pushChronicle(events, day, 'nation_collapsed', `${target.name} collapses under ${drain.label}.`);
    }
  }

  // 5. Truce expiry (SRD-1104 diplomacy hook): expired truces revert to war.
  const truces = war.truces.filter((truce) => {
    if (day >= truce.untilDay) {
      pushChronicle(
        events,
        day,
        'truce_expired',
        `The truce between ${nationName(truce.nationIdA)} and ${nationName(truce.nationIdB)} has expired.`,
      );
      return false;
    }
    return true;
  });

  // 6–8. Stochastic raids: contests, curses, sabotage, attack warnings.
  if (!options.disableRandomEvents && war.outcome === 'ongoing') {
    const rivals = war.nationOrder.filter((id) => id !== war.playerNationId);
    const playerId = war.playerNationId;

    // Neutral mine contests.
    for (const poi of Object.values(nextMap.pois)) {
      if (poi.kind !== 'mine' || poi.strategicStatus !== 'intact') continue;
      const ownerId = poi.ownerNationId ?? poi.factionId;
      if (ownerId) continue;
      const roll = rollChance(rngState, WAR_SIM_TUNING.neutralMineContestChance);
      rngState = roll.nextRng;
      if (!roll.success || rivals.length === 0) continue;
      const claimant = pickRandom(rivals, rngState);
      rngState = claimant.nextRng;
      if (isTruceActive({ ...war, truces }, claimant.item, playerId, day)) continue;
      poi.strategicStatus = 'contested';
      poi.statusChangedDay = day;
      poi.contestedByNationId = claimant.item;
      pushChronicle(
        events,
        day,
        'mine_contested',
        `${nationName(claimant.item)} agents have seized the tunnels of ${poi.name} — the mine is contested.`,
      );
    }

    // Necromantic curses on intact player mines (arcane/evil rivals first).
    const playerMines = Object.values(nextMap.pois).filter(
      (poi) =>
        poi.kind === 'mine' &&
        poi.strategicStatus === 'intact' &&
        (poi.ownerNationId ?? poi.factionId) === playerId,
    );
    if (playerMines.length > 0 && rivals.length > 0) {
      const roll = rollChance(rngState, WAR_SIM_TUNING.necromanticCurseChance);
      rngState = roll.nextRng;
      if (roll.success) {
        const arcaneFirst = [
          ...rivals.filter((id) => id === 'ashen-spire'),
          ...rivals.filter((id) => id !== 'ashen-spire' && nextNations[id]?.alignment === 'evil'),
          ...rivals.filter((id) => nextNations[id]?.alignment !== 'evil' && id !== 'ashen-spire'),
        ];
        const curser = arcaneFirst.find((id) => !isTruceActive({ ...war, truces }, id, playerId, day));
        if (curser) {
          const victim = pickRandom(playerMines, rngState);
          rngState = victim.nextRng;
          victim.item.strategicStatus = 'cursed';
          victim.item.statusChangedDay = day;
          pushChronicle(
            events,
            day,
            'mine_cursed',
            `Necromancers of ${nationName(curser)} have cursed ${victim.item.name} — the dead walk its shafts.`,
          );
        }
      }
    }

    // Sabotage of other intact player POIs.
    const sabotageTargets = Object.values(nextMap.pois).filter(
      (poi) =>
        poi.kind !== 'mine' &&
        ['fortress', 'bridge', 'supply_depot', 'prison_keep', 'subfaction_camp'].includes(poi.kind) &&
        poi.strategicStatus === 'intact' &&
        (poi.ownerNationId ?? poi.factionId) === playerId,
    );
    if (sabotageTargets.length > 0 && rivals.length > 0) {
      const roll = rollChance(rngState, WAR_SIM_TUNING.sabotageChance);
      rngState = roll.nextRng;
      if (roll.success) {
        const eligibleSaboteurs = rivals.filter((id) => !isTruceActive({ ...war, truces }, id, playerId, day));
        if (eligibleSaboteurs.length > 0) {
          const saboteur = pickRandom(eligibleSaboteurs, rngState);
          rngState = saboteur.nextRng;
          const victim = pickRandom(sabotageTargets, rngState);
          rngState = victim.nextRng;
          victim.item.strategicStatus = 'sabotaged';
          victim.item.statusChangedDay = day;
          pushChronicle(
            events,
            day,
            'poi_sabotaged',
            `Agents of ${nationName(saboteur.item)} have sabotaged ${victim.item.name}.`,
          );
        }
      }
    }

    // Incoming attack warnings (`protect_poi` hook for SRD-1102/1103).
    const defendable = Object.values(nextMap.pois).filter(
      (poi) =>
        ['fortress', 'mine', 'bridge', 'supply_depot'].includes(poi.kind) &&
        poi.strategicStatus === 'intact' &&
        (poi.ownerNationId ?? poi.factionId) === playerId,
    );
    if (defendable.length > 0 && rivals.length > 0) {
      const roll = rollChance(rngState, WAR_SIM_TUNING.attackWarningChance);
      rngState = roll.nextRng;
      if (roll.success) {
        const eligibleAttackers = rivals.filter((id) => !isTruceActive({ ...war, truces }, id, playerId, day));
        if (eligibleAttackers.length > 0) {
          const attacker = pickRandom(eligibleAttackers, rngState);
          rngState = attacker.nextRng;
          const victim = pickRandom(defendable, rngState);
          rngState = victim.nextRng;
          victim.item.strategicStatus = 'under_attack';
          victim.item.statusChangedDay = day;
          victim.item.attackDeadlineDay = day + WAR_SIM_TUNING.attackWarningLeadDays;
          victim.item.contestedByNationId = attacker.item;
          pushChronicle(
            events,
            day,
            'poi_attacked',
            `Scouts report ${nationName(attacker.item)} columns marching on ${victim.item.name} — defend it before day ${victim.item.attackDeadlineDay}.`,
          );
        }
      }
    }
  }

  OverworldMapSchema.parse(nextMap);

  let nextWar: WarState = WarStateSchema.parse({
    ...war,
    currentDay: day,
    tickCount: war.tickCount + 1,
    nations: nextNations,
    truces,
    rngState,
    chronicle: [...war.chronicle, ...events],
  });

  const verdict = evaluateWarOutcome(nextWar);
  if (verdict.outcome !== 'ongoing' && nextWar.outcome === 'ongoing') {
    const closing: WarChronicleEntry = {
      day,
      kind: verdict.outcome,
      headline: verdict.reason ?? (verdict.outcome === 'victory' ? 'Victory!' : 'Defeat.'),
    };
    events.push(closing);
    nextWar = { ...nextWar, outcome: verdict.outcome, outcomeReason: verdict.reason, chronicle: [...nextWar.chronicle, closing] };
  } else {
    nextWar = { ...nextWar, outcome: nextWar.outcome === 'ongoing' ? verdict.outcome : nextWar.outcome };
  }

  return { war: nextWar, map: nextMap, events };
}

/**
 * Advances the living war simulation to `toDay` (default: one tick ahead).
 * Each tick accrues intact-POI income, rebuilds bridges on `recoveryDay`,
 * contests neutral mines, triggers curses/sabotage/attack warnings, drains
 * guerrilla targets, expires truces, and evaluates Power Dominance.
 */
export function advanceWarSimulation(
  war: WarState,
  map: OverworldMap,
  rawOptions: AdvanceWarSimulationOptions = {},
): AdvanceWarSimulationResult {
  const options = { ...rawOptions };
  const toDay = options.toDay ?? war.currentDay + war.tickIntervalDays;
  if (!Number.isInteger(toDay) || toDay < war.currentDay) {
    throw new RealmError(`Cannot advance the war simulation to day ${String(toDay)}`);
  }
  let currentWar = war;
  let currentMap = map;
  const allEvents: WarChronicleEntry[] = [];
  while (currentWar.outcome === 'ongoing' && currentWar.currentDay + currentWar.tickIntervalDays <= toDay) {
    const tick = runSingleWarTick(currentWar, currentMap, options);
    currentWar = tick.war;
    currentMap = tick.map;
    allEvents.push(...tick.events);
  }
  return { war: currentWar, map: currentMap, events: allEvents };
}
