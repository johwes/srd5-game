import type { CharacterBuildState } from '@srd5/data';
import type { Combatant } from '../combat/types.js';
import type { GameEvent } from '../state/types.js';

/**
 * SRD-1405: Veteran Roster — Heroes Remembered (Spec 13 §7).
 *
 * MoM heroes meet the campfire: living heroes at a run's conclusion (Deep
 * Descent `endRogueliteRun`, Realm dominance victory / cleared delve) with
 * total level >= `VETERAN_MIN_LEVEL` may **retire** into a persistent veteran
 * roster instead of vanishing into the graveyard. Veterans are full
 * `CharacterBuildState` snapshots (offline deterministic data) stored in the
 * existing delve IndexedDB store, capped at `VETERAN_MAX_ROSTER_SIZE` (FIFO
 * with a confirm-to-release row), and recruitable in campfire assembly
 * (SRD-603 seats) for a level-scaled gp hire cost paid from the seated
 * party's pooled personal gold. Hired veterans deploy as ordinary party
 * members — no scaling power beyond what leveling already gives.
 *
 * No `Math.random()` anywhere: snapshots and FIFO eviction are pure data
 * operations. No new mid-run player commands.
 */

/** Minimum total character level to be offered retirement (Spec 13 §7). */
export const VETERAN_MIN_LEVEL = 3;

/**
 * Maximum total character level admitted to the roster at entry.
 * Above this the hero is too legendary to settle ("no epic veterans");
 * costs stay scaled so level-1 starts remain competitive.
 */
export const VETERAN_MAX_LEVEL = 10;

/** Cap on stored veterans; oldest is released first (FIFO). */
export const VETERAN_MAX_ROSTER_SIZE = 8;

/** Hire cost scales linearly with total level: `level × 100 gp`. */
export const VETERAN_HIRE_COST_PER_LEVEL_GP = 100;

/** Where a veteran retired from. */
export type VeteranSource = 'descent' | 'delve' | 'realm';

export interface VeteranRosterEntry {
  /** Stable id — the retired hero's `CharacterBuildState.id`. */
  veteranId: string;
  /** Full build snapshot; deploys as an ordinary party member. */
  hero: CharacterBuildState;
  /** Total character level at retirement (frozen for cost/display). */
  level: number;
  /** ISO timestamp of retirement (display only). */
  retiredAt: string;
  /** Run that produced the veteran, when known. */
  runId?: string;
  /** Which game mode the veteran retired from. */
  source: VeteranSource;
}

/**
 * Level-scaled hire cost in gp (keeps level-1 starts competitive:
 * a level-3 veteran costs 300 gp, a level-10 veteran 1000 gp).
 */
export function veteranHireCost(totalLevel: number): number {
  return Math.max(0, Math.floor(totalLevel)) * VETERAN_HIRE_COST_PER_LEVEL_GP;
}

/** Total character level across all classes in a build. */
export function getBuildTotalLevel(build: CharacterBuildState): number {
  return build.classes.reduce((sum, c) => sum + c.level, 0);
}

/** Whether a build snapshot meets the retirement level band. */
export function isVeteranEligibleBuild(build: CharacterBuildState): boolean {
  const level = getBuildTotalLevel(build);
  return level >= VETERAN_MIN_LEVEL && level <= VETERAN_MAX_LEVEL;
}

function isLivingHero(c: Combatant): boolean {
  return !c.isDead && c.currentHp > 0 && (c.exhaustionLevel ?? 0) < 6;
}

/**
 * Collects retirement candidates from a concluded run's party: living heroes
 * (mirrors `checkRogueliteWipe` survivorship) whose build snapshot sits in
 * the veteran level band. Returns structured-cloned snapshots.
 */
export function collectVeteranCandidates(
  party: Record<string, Combatant>,
): CharacterBuildState[] {
  const candidates: CharacterBuildState[] = [];
  for (const combatant of Object.values(party)) {
    if (!isLivingHero(combatant)) continue;
    const build = combatant.buildState;
    if (!build) continue;
    if (!isVeteranEligibleBuild(build)) continue;
    candidates.push(structuredClone(build));
  }
  return candidates;
}

export interface PlanVeteranRetirementOptions {
  runId?: string;
  source?: VeteranSource;
  /**
   * When the roster is full, retirement requires an explicit confirmation
   * to release the oldest veterans (FIFO confirm-to-release row in the UI).
   * Pass `true` once the player confirms; otherwise the roster is returned
   * unchanged with `requiresConfirmation: true`.
   */
  confirmRelease?: boolean;
  /** ISO timestamp override for retirement records (defaults to now). */
  retiredAt?: string;
}

export interface PlannedVeteranRetirement {
  /** Resulting roster (unchanged when `requiresConfirmation` is true). */
  roster: VeteranRosterEntry[];
  /** Entries retired by this call (empty when confirmation is pending). */
  retired: VeteranRosterEntry[];
  /** Oldest entries released FIFO to make room (empty unless confirmed). */
  released: VeteranRosterEntry[];
  /** True when the roster is full and `confirmRelease` was not given. */
  requiresConfirmation: boolean;
  /**
   * Oldest entries that *would* be released FIFO if the player confirms
   * (shown in the confirm-to-release row).
   */
  wouldRelease: VeteranRosterEntry[];
  /** Number of eligible candidates still waiting on confirmation. */
  pendingCount: number;
  events: GameEvent[];
}

/**
 * Plans (and, unless blocked on confirmation, applies) veteran retirements.
 * Duplicate heroes already on the roster and out-of-band builds are skipped.
 */
export function planVeteranRetirement(
  roster: VeteranRosterEntry[],
  candidates: CharacterBuildState[],
  options: PlanVeteranRetirementOptions = {},
): PlannedVeteranRetirement {
  const source = options.source ?? 'descent';
  const retiredAt = options.retiredAt ?? new Date().toISOString();
  const onRoster = new Set(roster.map((v) => v.veteranId));
  const seen = new Set<string>();

  const fresh: VeteranRosterEntry[] = [];
  for (const hero of candidates) {
    if (seen.has(hero.id) || onRoster.has(hero.id)) continue;
    seen.add(hero.id);
    if (!isVeteranEligibleBuild(hero)) continue;
    fresh.push({
      veteranId: hero.id,
      hero: structuredClone(hero),
      level: getBuildTotalLevel(hero),
      retiredAt,
      ...(options.runId ? { runId: options.runId } : {}),
      source,
    });
  }

  if (fresh.length === 0) {
    return {
      roster: [...roster],
      retired: [],
      released: [],
      requiresConfirmation: false,
      wouldRelease: [],
      pendingCount: 0,
      events: [],
    };
  }

  const overflow = roster.length + fresh.length - VETERAN_MAX_ROSTER_SIZE;
  if (overflow > 0 && !options.confirmRelease) {
    return {
      roster: [...roster],
      retired: [],
      released: [],
      requiresConfirmation: true,
      wouldRelease: roster.slice(0, overflow).map((v) => structuredClone(v)),
      pendingCount: fresh.length,
      events: [],
    };
  }

  const released: VeteranRosterEntry[] =
    overflow > 0 ? roster.slice(0, overflow) : [];
  const next: VeteranRosterEntry[] = [...roster.slice(released.length), ...fresh];
  const events: GameEvent[] = fresh.map((v) => ({
    type: 'VETERAN_RETIRED',
    heroId: v.hero.id,
    level: v.level,
    ...(v.runId ? { runId: v.runId } : {}),
    source: v.source,
  }));

  return {
    roster: next,
    retired: fresh,
    released,
    requiresConfirmation: false,
    wouldRelease: [],
    pendingCount: 0,
    events,
  };
}

export type RecruitVeteranResult =
  | {
      ok: true;
      roster: VeteranRosterEntry[];
      hero: CharacterBuildState;
      hireCostGp: number;
      events: GameEvent[];
    }
  | { ok: false; roster: VeteranRosterEntry[]; error: string };

/**
 * Recruits a veteran into the campfire assembly: removes the entry from the
 * roster and returns the hero snapshot, which deploys as an ordinary party
 * member. The gp hire cost is charged separately via `payVeteranHireCost`.
 */
export function recruitVeteran(
  roster: VeteranRosterEntry[],
  veteranId: string,
): RecruitVeteranResult {
  const entry = roster.find((v) => v.veteranId === veteranId);
  if (!entry) {
    return {
      ok: false,
      roster: [...roster],
      error: `Veteran '${veteranId}' is not on the veteran roster.`,
    };
  }
  return {
    ok: true,
    roster: roster.filter((v) => v.veteranId !== veteranId),
    hero: structuredClone(entry.hero),
    hireCostGp: veteranHireCost(entry.level),
    events: [
      { type: 'VETERAN_RECRUITED', heroId: entry.hero.id, hireCostGp: veteranHireCost(entry.level) },
    ],
  };
}

export interface PayVeteranHireCostResult {
  /**
   * True when the seated party covered the full cost. On `false` the party
   * is returned unchanged and `shortfall` holds the missing gp.
   */
  ok: boolean;
  party: CharacterBuildState[];
  paid: number;
  shortfall: number;
}

/**
 * Pays a veteran hire cost from the seated party's pooled personal gold
 * (`currency.gp`), deducting in seat order. Atomic: insufficient funds leave
 * the party unchanged so the UI can block the hire.
 */
export function payVeteranHireCost(
  party: CharacterBuildState[],
  costGp: number,
): PayVeteranHireCostResult {
  const cost = Math.max(0, Math.floor(costGp));
  if (cost === 0) {
    return { ok: true, party: party.map((c) => structuredClone(c)), paid: 0, shortfall: 0 };
  }
  const total = party.reduce((sum, c) => sum + (c.currency?.gp ?? 0), 0);
  if (total < cost) {
    return {
      ok: false,
      party: party.map((c) => structuredClone(c)),
      paid: 0,
      shortfall: cost - total,
    };
  }
  let remaining = cost;
  const next = party.map((c) => {
    const clone = structuredClone(c);
    if (remaining <= 0) return clone;
    const purse = clone.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    const take = Math.min(purse.gp, remaining);
    clone.currency = { ...purse, gp: purse.gp - take };
    remaining -= take;
    return clone;
  });
  return { ok: true, party: next, paid: cost, shortfall: 0 };
}
