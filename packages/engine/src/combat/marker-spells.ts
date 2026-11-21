import type { AbilityId, EffectStepSpec } from '@srd5/data';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import { getFootprintDistanceFeet } from '../grid/footprints.js';
import type { TacticalGrid } from '../grid/model.js';
import type { CombatEvent, CombatState, Combatant } from './types.js';

/**
 * SRD-1204: Marker-spell enforcement (Spec 11 §4.2).
 *
 * `detect-magic`, `knock`, `sanctuary`, `sleep`, and `shield` previously
 * resolved as inert markers. This module gives each a real mechanical path:
 * sense, prop hook + alert tradeoff, ward saves, HP-pool ordering, and a
 * reconciled buff id — plus shared helpers for hazard-zone step coverage.
 */

// ---------------------------------------------------------------------------
// Shield buff id reconciliation
// ---------------------------------------------------------------------------

/** Canonical Shield AC buff id (matches `@srd5/data` `spells.json`). */
export const SHIELD_AC_EFFECT_ID = 'shield-ac-bonus' as const;
/** Legacy ids planted by older engine builds; still honoured on read. */
export const LEGACY_SHIELD_EFFECT_IDS = ['shield_ac_buff', 'shield'] as const;

const SHIELD_ID_SET: ReadonlySet<string> = new Set([
  SHIELD_AC_EFFECT_ID,
  ...LEGACY_SHIELD_EFFECT_IDS,
]);

/** True for the canonical Shield buff and both legacy ids. */
export function isShieldActiveEffect(effectId: string): boolean {
  return SHIELD_ID_SET.has(effectId);
}

// ---------------------------------------------------------------------------
// Sanctuary ward
// ---------------------------------------------------------------------------

/** Active-effect id planted by the `sanctuary` spell overlay. */
export const SANCTUARY_WARD_EFFECT_ID = 'sanctuary-ward' as const;

/** True when the target is currently warded by `sanctuary`. */
export function hasSanctuaryWard(target: Combatant): boolean {
  return (target.activeEffects ?? []).some((e) => e.effectId === SANCTUARY_WARD_EFFECT_ID);
}

/**
 * Sanctuary save DC: the ward caster's spell save DC, falling back to 13
 * when the caster is absent from the board (summon/out-of-combat edge).
 * Reads the sheet directly to avoid a spellcasting-module import cycle.
 */
export function getSanctuarySaveDc(state: CombatState, wardedTarget: Combatant): number {
  const ward = (wardedTarget.activeEffects ?? []).find(
    (e) => e.effectId === SANCTUARY_WARD_EFFECT_ID,
  );
  if (ward?.sourceEntityId) {
    const caster = state.combatants[ward.sourceEntityId];
    if (caster?.characterSheet?.spellcasting?.primarySpellSaveDc !== undefined) {
      return caster.characterSheet.spellcasting.primarySpellSaveDc;
    }
    if (caster?.monsterData?.spellcasting) return caster.monsterData.spellcasting.spellSaveDc;
  }
  return 13;
}

/** Local WIS-save bonus lookup (sheet → monster → 0), no import cycle. */
function wardSaveBonus(c: Combatant, ability: 'wis'): number {
  const fromSheet = (c.characterSheet as unknown as { savingThrows?: Record<string, { totalBonus: number }> } | undefined)?.savingThrows?.[ability]?.totalBonus;
  if (typeof fromSheet === 'number') return fromSheet;
  const fromMonster = c.monsterData?.savingThrows?.[ability];
  if (typeof fromMonster === 'number') return fromMonster;
  if (c.monsterData) return Math.floor(((c.monsterData.abilities?.[ability] ?? 10) - 10) / 2);
  return 0;
}

export interface SanctuaryWardCheckResult {
  blocked: boolean;
  dc: number;
  roll: number;
  total: number;
  events: CombatEvent[];
  rngState: number;
}

/**
 * SRD 5.1 Sanctuary: when an attacker targets the warded creature, the
 * attacker must succeed on a WIS saving throw or lose the attack (it must
 * choose a new target or the attack is wasted — the engine treats it as lost).
 */
export function resolveSanctuaryWardAttack(options: {
  state: CombatState;
  attackerId: string;
  targetId: string;
  rngState: number;
}): SanctuaryWardCheckResult {
  const { state, attackerId, targetId } = options;
  let rngState = options.rngState;
  const events: CombatEvent[] = [];
  const attacker = state.combatants[attackerId];
  const target = state.combatants[targetId];
  if (!attacker || !target || !hasSanctuaryWard(target)) {
    return { blocked: false, dc: 0, roll: 0, total: 0, events, rngState };
  }
  const dc = getSanctuarySaveDc(state, target);
  const bonus = wardSaveBonus(attacker, 'wis');
  const rollRes = rollD20(rngState, { modifier: bonus, mode: 'normal' });
  rngState = rollRes.nextState;
  events.push({
    type: 'DICE_ROLLED',
    actorId: attackerId,
    rollPurpose: 'WIS save vs Sanctuary',
    notation: rollRes.record.formula,
    rolls: rollRes.record.rolls,
    kept: rollRes.record.kept,
    modifier: rollRes.record.modifier,
    total: rollRes.total,
    mode: 'normal',
  });
  const success = rollRes.total >= dc;
  events.push({
    type: 'SAVING_THROW_RESOLVED',
    entityId: attackerId,
    ability: 'wis',
    dc,
    roll: rollRes.naturalRoll,
    total: rollRes.total,
    outcome: success ? 'success' : 'failure',
    sourceSpellOrAbilityName: 'Sanctuary',
  });
  events.push({
    type: 'SANCTUARY_WARD_RESOLVED',
    attackerId,
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    total: rollRes.total,
    outcome: success ? 'pierced' : 'blocked',
  });
  return { blocked: !success, dc, roll: rollRes.naturalRoll, total: rollRes.total, events, rngState };
}

/**
 * SRD 5.1: the ward ends early if the warded creature makes an attack or
 * casts a harmful spell. Strips the ward and reports whether it was present.
 */
export function stripSanctuaryOnOffense(combatant: Combatant): {
  combatant: Combatant;
  wardEnded: boolean;
} {
  if (!hasSanctuaryWard(combatant)) return { combatant, wardEnded: false };
  return {
    combatant: {
      ...combatant,
      activeEffects: (combatant.activeEffects ?? []).filter(
        (e) => e.effectId !== SANCTUARY_WARD_EFFECT_ID,
      ),
    },
    wardEnded: true,
  };
}

// ---------------------------------------------------------------------------
// Sleep HP pool
// ---------------------------------------------------------------------------

/** Base Sleep pool (SRD 5.1: 5d8, +2d8 per slot above 1st). */
export const SLEEP_BASE_POOL_FORMULA = '5d8' as const;
export const SLEEP_UPSCALE_FORMULA = '2d8' as const;

/** Creature types explicitly unaffected by Sleep (SRD 5.1). */
const SLEEP_IMMUNE_TYPES: ReadonlySet<string> = new Set(['undead', 'construct']);

function sleepImmuneReason(c: Combatant): string | null {
  if (c.isDead || c.currentHp <= 0) return 'no_hp';
  if (c.conditions.includes('unconscious')) return 'already_unconscious';
  if (c.conditionImmunities.includes('unconscious')) return 'condition_immune';
  if (c.conditionImmunities.includes('charmed')) return 'charm_immune';
  const mtype = c.monsterData?.type?.toLowerCase();
  if (mtype && SLEEP_IMMUNE_TYPES.has(mtype)) return `type_immune:${mtype}`;
  return null;
}

export interface SleepPoolRoll {
  poolTotal: number;
  poolFormula: string;
  rngState: number;
}

/** Rolls the Sleep HP pool deterministically (5d8 + 2d8/slot above 1st). */
export function rollSleepPool(rngState: number, slotLevel: number): SleepPoolRoll {
  const extra = Math.max(0, slotLevel - 1);
  const poolFormula = extra > 0 ? `${SLEEP_BASE_POOL_FORMULA} + ${extra * 2}d8` : SLEEP_BASE_POOL_FORMULA;
  const res = rollDamage(rngState, poolFormula);
  return { poolTotal: res.total, poolFormula, rngState: res.nextState };
}

export interface SleepHpPoolResult {
  affectedIds: string[];
  skippedIds: Array<{ id: string; reason: string }>;
  poolTotal: number;
  poolFormula: string;
  remainingPool: number;
  rngState: number;
  events: CombatEvent[];
}

/**
 * SRD 5.1 Sleep resolution: roll the HP pool, then affect creatures in
 * ascending current-HP order, subtracting each affected creature's current HP
 * from the pool. Creatures whose HP exceeds the remaining pool (and everything
 * above them) are skipped.
 */
export function resolveSleepHpPool(options: {
  state: CombatState;
  casterId: string;
  candidateIds: string[];
  slotLevel: number;
  rngState: number;
}): SleepHpPoolResult {
  const { state, casterId, slotLevel } = options;
  let rngState = options.rngState;
  const events: CombatEvent[] = [];
  const pool = rollSleepPool(rngState, slotLevel);
  rngState = pool.rngState;
  events.push({
    type: 'DICE_ROLLED',
    actorId: casterId,
    rollPurpose: 'Sleep HP pool',
    notation: pool.poolFormula,
    rolls: [],
    kept: [],
    modifier: 0,
    total: pool.poolTotal,
    mode: 'normal',
  });

  const ordered = [...options.candidateIds]
    .map((id) => state.combatants[id])
    .filter((c): c is Combatant => Boolean(c))
    .sort((a, b) => a.currentHp - b.currentHp || (a.id < b.id ? -1 : 1));

  const affectedIds: string[] = [];
  const skippedIds: Array<{ id: string; reason: string }> = [];
  let remaining = pool.poolTotal;
  for (const c of ordered) {
    const immune = sleepImmuneReason(c);
    if (immune) {
      skippedIds.push({ id: c.id, reason: immune });
      continue;
    }
    if (c.currentHp > remaining) {
      skippedIds.push({ id: c.id, reason: 'pool_exhausted' });
      continue;
    }
    remaining -= c.currentHp;
    affectedIds.push(c.id);
  }

  events.push({
    type: 'SLEEP_HP_POOL_RESOLVED',
    casterId,
    poolFormula: pool.poolFormula,
    poolTotal: pool.poolTotal,
    affectedIds: [...affectedIds],
    skippedIds: skippedIds.map((s) => s.id),
    remainingPool: remaining,
  });
  return {
    affectedIds,
    skippedIds,
    poolTotal: pool.poolTotal,
    poolFormula: pool.poolFormula,
    remainingPool: remaining,
    rngState,
    events,
  };
}

// ---------------------------------------------------------------------------
// Detect Magic sense
// ---------------------------------------------------------------------------

export interface DetectMagicAura {
  kind: 'active_effect' | 'concentration' | 'hazard_zone' | 'summon' | 'prop';
  id: string;
  label: string;
}

export interface DetectMagicSenseResult {
  observerId: string;
  rangeFeet: number;
  auraCount: number;
  auras: DetectMagicAura[];
}

/** SRD 5.1 Detect Magic range (30 ft). */
export const DETECT_MAGIC_RANGE_FEET = 30 as const;

/**
 * Real sense mechanic: reveals magical auras within 30 ft of the observer —
 * active spell effects, concentrations, hazard zones, summoned tokens, and
 * (via `propAuras`) dungeon props such as shrines and warded traps.
 */
export function senseDetectMagic(
  state: CombatState,
  observerId: string,
  options?: { rangeFeet?: number; grid?: TacticalGrid; propAuras?: DetectMagicAura[] },
): DetectMagicSenseResult {
  const rangeFeet = options?.rangeFeet ?? DETECT_MAGIC_RANGE_FEET;
  const observer = state.combatants[observerId];
  if (!observer) return { observerId, rangeFeet, auraCount: 0, auras: [] };
  const auras: DetectMagicAura[] = [];

  for (const c of Object.values(state.combatants)) {
    if (c.id === observerId || c.isDead) continue;
    const dist = getFootprintDistanceFeet(observer.position, observer.size, c.position, c.size);
    if (dist > rangeFeet) continue;
    if (c.activeEffects && c.activeEffects.length > 0) {
      for (const e of c.activeEffects) {
        auras.push({ kind: 'active_effect', id: `${c.id}:${e.effectId}`, label: `${e.name} on ${c.name}` });
      }
    }
    if (c.concentratingOn) {
      auras.push({
        kind: 'concentration',
        id: `${c.id}:${c.concentratingOn.sourceId}`,
        label: `${c.name} concentrating on ${c.concentratingOn.sourceName ?? c.concentratingOn.sourceId}`,
      });
    }
    if (c.isSummon) {
      auras.push({ kind: 'summon', id: c.id, label: `Conjured ${c.name}` });
    }
  }

  for (const z of Object.values(state.hazardZones ?? {})) {
    const originDist = Math.max(
      Math.abs(observer.position.x - z.origin.x),
      Math.abs(observer.position.y - z.origin.y),
    ) * 5;
    if (originDist <= rangeFeet + z.sizeFeet) {
      auras.push({ kind: 'hazard_zone', id: z.id, label: `Magic: ${z.sourceName}` });
    }
  }
  void options?.grid;

  if (options?.propAuras) auras.push(...options.propAuras);

  return { observerId, rangeFeet, auraCount: auras.length, auras };
}

// ---------------------------------------------------------------------------
// Knock prop hook + alert tradeoff
// ---------------------------------------------------------------------------

/** SRD 5.1: Knock is audible from 300 ft. Engine models it as adjacent-room alert. */
export const KNOCK_AUDIBLE_FEET = 300 as const;

/**
 * Prop ids resolve to rooms via the tactical grid's roomId cells. Knock
 * alerts the prop's own room plus every room touching its 8-neighbourhood —
 * the classic tradeoff for bypassing the lock without tools or Athletics.
 */
export function getKnockAlertedRoomIds(
  grid: TacticalGrid | undefined,
  prop: { x: number; y: number },
): string[] {
  if (!grid) return [];
  const rooms = new Set<string>();
  const cells = (grid as unknown as { cells?: Array<{ x: number; y: number; roomId?: string }> }).cells;
  if (!Array.isArray(cells)) return [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = cells.find((c) => c.x === prop.x + dx && c.y === prop.y + dy);
      if (cell?.roomId) rooms.add(cell.roomId);
    }
  }
  return [...rooms].sort();
}

/** Steps the hazard-zone runner cannot auto-resolve (emitted, never silent). */
export const HAZARD_UNSUPPORTED_STEPS: ReadonlySet<EffectStepSpec['step']> = new Set([
  'teleport',
  'summon_creature',
  'create_hazard_zone',
  'spend_resource',
] as Array<EffectStepSpec['step']>);

/** True when a hazard `onEnterOrStartTurn` step has no auto-resolver. */
export function isHazardUnsupportedStep(step: EffectStepSpec['step']): boolean {
  return HAZARD_UNSUPPORTED_STEPS.has(step);
}
