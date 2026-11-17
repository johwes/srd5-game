import { rollD20, resolveRollMode, type RollMode } from '../dice/evaluator.js';
import type {
  CombatEvent,
  CombatState,
  Combatant,
  HazardZone,
} from './types.js';

export interface StartConcentrationOptions {
  sourceId: string;
  sourceName?: string | undefined;
  targetEntityIds?: string[] | undefined;
  durationRounds?: number | undefined;
  hazardZoneIds?: string[] | undefined;
}

export interface ConcentrationTransitionResult {
  state: CombatState;
  events: CombatEvent[];
}

/**
 * Starts concentration on a spell or effect for a combatant.
 * If the caster was already concentrating, their previous concentration immediately ends
 * (and all linked hazard zones / conditions / effects are cleared).
 */
export function startConcentration(
  state: CombatState,
  casterId: string,
  options: StartConcentrationOptions,
): ConcentrationTransitionResult {
  const events: CombatEvent[] = [];
  const caster = state.combatants[casterId];
  if (!caster) {
    throw new Error(`Caster combatant "${casterId}" not found`);
  }

  let currentState = state;

  // 1. End previous concentration if already concentrating
  if (caster.concentratingOn) {
    const endRes = breakConcentration(currentState, casterId, 'new_spell');
    currentState = endRes.state;
    events.push(...endRes.events);
  }

  const durationRounds = options.durationRounds ?? 10;
  const targetEntityIds = options.targetEntityIds ? [...options.targetEntityIds] : [];
  const hazardZoneIds = options.hazardZoneIds ? [...options.hazardZoneIds] : [];

  const updatedCaster: Combatant = {
    ...currentState.combatants[casterId]!,
    concentratingOn: {
      sourceId: options.sourceId,
      sourceName: options.sourceName,
      targetEntityIds,
      remainingRounds: durationRounds,
      hazardZoneIds,
    },
  };

  events.push({
    type: 'CONCENTRATION_STARTED',
    entityId: caster.id,
    spellId: options.sourceId,
    spellName: options.sourceName ?? options.sourceId,
    targetEntityIds,
  });

  return {
    state: {
      ...currentState,
      combatants: {
        ...currentState.combatants,
        [casterId]: updatedCaster,
      },
    },
    events,
  };
}

/**
 * Breaks / ends a combatant's active concentration:
 * - Emits CONCENTRATION_ENDED with the given reason.
 * - Cleans up all active hazard zones created by this caster that require concentration.
 * - Cleans up all active conditions and effects on all combatants created by this caster requiring concentration.
 */
export function breakConcentration(
  state: CombatState,
  casterId: string,
  reason: 'new_spell' | 'damaged' | 'incapacitated' | 'turn_expiry' | 'manual',
): ConcentrationTransitionResult {
  const events: CombatEvent[] = [];
  const caster = state.combatants[casterId];
  if (!caster || !caster.concentratingOn) {
    return { state, events };
  }

  const spellId = caster.concentratingOn.sourceId;

  events.push({
    type: 'CONCENTRATION_ENDED',
    entityId: caster.id,
    spellId,
    reason,
  });

  // 1. Remove linked hazard zones
  const nextHazardZones: Record<string, HazardZone> = {};
  if (state.hazardZones) {
    for (const [zoneKey, zone] of Object.entries(state.hazardZones)) {
      if (zone.casterId === casterId && zone.requiresConcentration) {
        events.push({
          type: 'HAZARD_ZONE_REMOVED',
          instanceId: zone.id,
          zoneId: zone.zoneId,
          casterId: zone.casterId,
          reason: 'concentration_ended',
        });
      } else {
        nextHazardZones[zoneKey] = zone;
      }
    }
  }

  // 2. Remove linked conditions and effects across all combatants
  const nextCombatants: Record<string, Combatant> = {};
  for (const [cid, comb] of Object.entries(state.combatants)) {
    let combModified = false;
    let nextConditions = [...comb.conditions];
    let nextActiveConditions = comb.activeConditions ? [...comb.activeConditions] : [];
    let nextActiveEffects = comb.activeEffects ? [...comb.activeEffects] : [];

    if (comb.activeConditions) {
      const remainingAc = comb.activeConditions.filter((ac) => {
        if (ac.sourceEntityId === casterId && ac.requiresConcentration) {
          combModified = true;
          nextConditions = nextConditions.filter((c) => c !== ac.conditionId);
          events.push({
            type: 'CONDITION_REMOVED',
            targetId: comb.id,
            conditionId: ac.conditionId,
            sourceName: ac.sourceName ?? spellId,
          });
          return false;
        }
        return true;
      });
      nextActiveConditions = remainingAc;
    }

    if (comb.activeEffects) {
      const remainingEffects = comb.activeEffects.filter((ae) => {
        if (ae.sourceEntityId === casterId && ae.requiresConcentration) {
          combModified = true;
          return false;
        }
        return true;
      });
      nextActiveEffects = remainingEffects;
    }

    let updatedComb = comb;
    if (cid === casterId) {
      updatedComb = {
        ...updatedComb,
        concentratingOn: undefined,
      };
      combModified = true;
    }

    if (combModified) {
      nextCombatants[cid] = {
        ...updatedComb,
        conditions: nextConditions,
        activeConditions: nextActiveConditions,
        activeEffects: nextActiveEffects,
      };
    } else {
      nextCombatants[cid] = updatedComb;
    }
  }

  // 3. Despawn concentration-linked summons owned by this caster (Spec 08 §4.3).
  const nextCombatantsWithoutSummons: Record<string, Combatant> = {};
  const despawnedSummonIds = new Set<string>();
  for (const [cid, comb] of Object.entries(nextCombatants)) {
    if (comb.isSummon && comb.summonedByEntityId === casterId && comb.summonConcentrationLinked) {
      despawnedSummonIds.add(cid);
      events.push({
        type: 'SUMMON_EXPIRED',
        entityId: cid,
        summonId: comb.summonId ?? cid,
        reason: 'concentration',
        sourceName: comb.summonSourceName,
      });
    } else {
      nextCombatantsWithoutSummons[cid] = comb;
    }
  }
  const nextInitiativeOrder = despawnedSummonIds.size
    ? state.initiativeOrder.filter((e) => !despawnedSummonIds.has(e.entityId))
    : state.initiativeOrder;
  let nextActiveCombatantIndex = state.activeCombatantIndex;
  if (despawnedSummonIds.size) {
    const removedBefore = state.initiativeOrder
      .slice(0, nextActiveCombatantIndex)
      .filter((e) => despawnedSummonIds.has(e.entityId)).length;
    nextActiveCombatantIndex = Math.max(0, nextActiveCombatantIndex - removedBefore);
  }

  return {
    state: {
      ...state,
      combatants: nextCombatantsWithoutSummons,
      hazardZones: nextHazardZones,
      initiativeOrder: nextInitiativeOrder,
      activeCombatantIndex: nextActiveCombatantIndex,
    },
    events,
  };
}

/**
 * Resolves a Concentration Constitution saving throw after taking damage (DC = max(10, floor(damage / 2))).
 * - Accounts for War Caster (advantage on concentration saves).
 * - Accounts for Exhaustion level 3+ (disadvantage on saving throws).
 * - If failed, breaks concentration and cleans up linked zones/effects.
 */
export function resolveConcentrationSavingThrow(
  state: CombatState,
  casterId: string,
  damageTaken: number,
  options?: { rollModeOverride?: RollMode },
): {
  state: CombatState;
  events: CombatEvent[];
  passed: boolean;
  dc: number;
  roll: number;
  total: number;
  concentrationBroken: boolean;
} {
  const events: CombatEvent[] = [];
  const caster = state.combatants[casterId];

  if (!caster || !caster.concentratingOn || damageTaken <= 0) {
    return {
      state,
      events,
      passed: true,
      dc: 10,
      roll: 10,
      total: 10,
      concentrationBroken: false,
    };
  }

  const dc = Math.max(10, Math.floor(damageTaken / 2));
  let currentRng = state.rngState;

  // Compute CON modifier / bonus
  const conBonus =
    caster.characterSheet?.savingThrows.con.totalBonus ??
    caster.monsterData?.savingThrows?.con ??
    Math.floor(((caster.characterSheet?.abilities.con.score ?? caster.monsterData?.abilities.con ?? 10) - 10) / 2);

  // Roll Mode
  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];

  // War Caster feat gives advantage on concentration saving throws
  const hasWarCaster =
    caster.characterSheet?.traitIds?.some(
      (t: string) => t.toLowerCase().includes('war-caster') || t.toLowerCase().includes('war_caster'),
    ) ||
    caster.characterSheet?.activeModifiers?.some((m) =>
      m.sourceName.toLowerCase().includes('war caster'),
    ) ||
    false;
  if (hasWarCaster) {
    advantageSources.push('war_caster');
  }

  // Exhaustion level 3+ gives disadvantage on all saves
  if ((caster.exhaustionLevel ?? 0) >= 3 || caster.conditions.includes('exhaustion')) {
    disadvantageSources.push('exhaustion');
  }

  const mode = options?.rollModeOverride ?? resolveRollMode({ advantageSources, disadvantageSources });

  const d20Res = rollD20(currentRng, {
    modifier: conBonus,
    mode,
    advantageSources,
    disadvantageSources,
  });
  currentRng = d20Res.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: caster.id,
    rollPurpose: `CON saving throw vs Concentration DC ${dc}`,
    notation: d20Res.record.formula,
    rolls: d20Res.record.rolls,
    kept: d20Res.record.kept,
    modifier: d20Res.record.modifier,
    total: d20Res.total,
    mode,
    naturalCrit: d20Res.isCrit,
    naturalFumble: d20Res.isFumble,
  });

  const passed = d20Res.total >= dc;

  events.push({
    type: 'SAVING_THROW_RESOLVED',
    entityId: caster.id,
    ability: 'con',
    dc,
    roll: d20Res.naturalRoll,
    total: d20Res.total,
    outcome: passed ? 'success' : 'failure',
    sourceSpellOrAbilityName: 'Concentration Check',
  });

  let nextState: CombatState = {
    ...state,
    rngState: currentRng,
  };

  let concentrationBroken = false;
  if (!passed) {
    concentrationBroken = true;
    const breakRes = breakConcentration(nextState, casterId, 'damaged');
    nextState = breakRes.state;
    events.push(...breakRes.events);
  }

  return {
    state: nextState,
    events,
    passed,
    dc,
    roll: d20Res.naturalRoll,
    total: d20Res.total,
    concentrationBroken,
  };
}

/**
 * Ticks down concentration remaining rounds for the active combatant.
 * If rounds reach 0, concentration expires and is broken.
 */
export function tickConcentration(
  state: CombatState,
  casterId: string,
): ConcentrationTransitionResult {
  const caster = state.combatants[casterId];
  if (!caster || !caster.concentratingOn) {
    return { state, events: [] };
  }

  const nextRounds = caster.concentratingOn.remainingRounds - 1;
  if (nextRounds <= 0) {
    return breakConcentration(state, casterId, 'turn_expiry');
  }

  const updatedCaster: Combatant = {
    ...caster,
    concentratingOn: {
      ...caster.concentratingOn,
      remainingRounds: nextRounds,
    },
  };

  return {
    state: {
      ...state,
      combatants: {
        ...state.combatants,
        [casterId]: updatedCaster,
      },
    },
    events: [],
  };
}
