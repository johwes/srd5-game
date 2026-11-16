import {
  type AoeShapeType,
  type EffectStepSpec,
} from '@srd5/data';
import {
  cellCenterFeet,
  rasterizeAoe,
  type AoeTemplate,
  type FeetPoint,
} from '../grid/aoe.js';
import { CELL_SIZE_FEET, type GridPoint } from '../grid/model.js';
import { doesFootprintContainCell, getFootprintCells } from '../grid/footprints.js';
import { rollDamage, rollD20 } from '../dice/evaluator.js';
import { applyDamage } from './damage.js';
import { applyConditionToCombatant, getConditionSavingThrowRollMode } from './conditions.js';
import { startConcentration } from './concentration.js';
import type {
  CombatEvent,
  CombatState,
  Combatant,
  HazardZone,
} from './types.js';

export interface CreateHazardZoneOptions {
  zoneId: string;
  casterId: string;
  sourceName: string;
  shape: AoeShapeType;
  origin: GridPoint;
  targetPoint?: GridPoint | undefined;
  sizeFeet: number;
  durationRounds?: number | undefined;
  requiresConcentration?: boolean | undefined;
  difficultTerrain?: boolean | undefined;
  obscurement?: 'light' | 'heavy' | undefined;
  onEnterOrStartTurn: EffectStepSpec[];
  saveDc?: number | undefined;
  spellLevel?: number | undefined;
  triggerImmediatelyOnPlacement?: boolean | undefined;
  /**
   * Pre-rasterized footprint cells. When provided (spell casts pass their own
   * resolved AOE cells), rasterization is skipped so the persistent zone
   * matches the targeting preview and initial hits exactly.
   */
  cells?: GridPoint[] | undefined;
}

export interface HazardZoneTransitionResult {
  state: CombatState;
  events: CombatEvent[];
}

let hazardZoneCounter = 1;

/**
 * Computes rasterized grid cells for a hazard zone based on AOE template geometry.
 */
export function rasterizeHazardZoneCells(
  shape: AoeShapeType,
  origin: GridPoint,
  targetPoint?: GridPoint,
  sizeFeet = 20,
): GridPoint[] {
  const originCenterFeet: FeetPoint = cellCenterFeet(origin);

  let template: AoeTemplate;

  switch (shape) {
    case 'sphere':
      template = {
        shape: 'sphere',
        origin: originCenterFeet,
        radiusFeet: sizeFeet,
      };
      break;
    case 'cylinder':
      template = {
        shape: 'cylinder',
        origin: originCenterFeet,
        radiusFeet: sizeFeet,
      };
      break;
    case 'cube':
      template = {
        shape: 'cube',
        origin: { x: origin.x * CELL_SIZE_FEET, y: origin.y * CELL_SIZE_FEET },
        sideFeet: sizeFeet,
        facing: 'n',
      };
      break;
    case 'cone': {
      const tgt = targetPoint ? cellCenterFeet(targetPoint) : { x: originCenterFeet.x + 5, y: originCenterFeet.y };
      const dir: FeetPoint = { x: tgt.x - originCenterFeet.x, y: tgt.y - originCenterFeet.y };
      template = {
        shape: 'cone',
        origin: originCenterFeet,
        direction: dir.x === 0 && dir.y === 0 ? { x: 1, y: 0 } : dir,
        lengthFeet: sizeFeet,
      };
      break;
    }
    case 'line': {
      const tgt = targetPoint ? cellCenterFeet(targetPoint) : { x: originCenterFeet.x + 5, y: originCenterFeet.y };
      template = {
        shape: 'line',
        origin: originCenterFeet,
        target: tgt.x === originCenterFeet.x && tgt.y === originCenterFeet.y ? { x: originCenterFeet.x + 5, y: originCenterFeet.y } : tgt,
        lengthFeet: sizeFeet,
      };
      break;
    }
  }

  return rasterizeAoe(template);
}

/**
 * Checks whether any grid cell in a creature's footprint is within a hazard zone's covered cells.
 */
export function isCreatureInHazardZone(creature: Combatant, zone: HazardZone): boolean {
  const footprintCells = getFootprintCells(creature.position, creature.size);
  return zone.cells.some((zCell) =>
    footprintCells.some((fCell) => fCell.x === zCell.x && fCell.y === zCell.y),
  );
}

/**
 * Checks if a specific grid cell is treated as difficult terrain by any active hazard zone.
 */
export function isCellInHazardDifficultTerrain(
  hazardZones: Record<string, HazardZone> | undefined,
  cell: GridPoint,
): boolean {
  if (!hazardZones) return false;
  return Object.values(hazardZones).some((zone) =>
    zone.difficultTerrain && zone.cells.some((c) => c.x === cell.x && c.y === cell.y),
  );
}

/**
 * Creates and registers a new active Hazard Zone on the tactical board.
 */
export function createHazardZone(
  state: CombatState,
  options: CreateHazardZoneOptions,
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  const instanceId = `hazard_${options.zoneId}_${Date.now()}_${hazardZoneCounter++}`;
  const cells =
    options.cells ??
    rasterizeHazardZoneCells(
      options.shape,
      options.origin,
      options.targetPoint,
      options.sizeFeet,
    );

  const durationRounds = options.durationRounds ?? 10;
  const requiresConcentration = Boolean(options.requiresConcentration);
  const difficultTerrain = Boolean(options.difficultTerrain);

  let currentState = state;

  // If requires concentration, link into concentration system
  if (requiresConcentration) {
    const concRes = startConcentration(currentState, options.casterId, {
      sourceId: options.zoneId,
      sourceName: options.sourceName,
      durationRounds,
      hazardZoneIds: [instanceId],
    });
    currentState = concRes.state;
    events.push(...concRes.events);
  }

  const zone: HazardZone = {
    id: instanceId,
    zoneId: options.zoneId,
    casterId: options.casterId,
    sourceName: options.sourceName,
    shape: options.shape,
    origin: options.origin,
    targetPoint: options.targetPoint,
    sizeFeet: options.sizeFeet,
    cells,
    durationRounds,
    remainingRounds: durationRounds,
    requiresConcentration,
    difficultTerrain,
    obscurement: options.obscurement,
    saveDc: options.saveDc,
    spellLevel: options.spellLevel,
    onEnterOrStartTurn: options.onEnterOrStartTurn,
    triggeredCreaturesThisTurn: [],
  };

  events.push({
    type: 'HAZARD_ZONE_CREATED',
    instanceId,
    zoneId: options.zoneId,
    casterId: options.casterId,
    sourceName: options.sourceName,
    shape: options.shape,
    origin: options.origin,
    sizeFeet: options.sizeFeet,
    cells,
    durationRounds,
    difficultTerrain,
    obscurement: options.obscurement,
  });

  const nextZones = {
    ...(currentState.hazardZones ?? {}),
    [instanceId]: zone,
  };

  currentState = {
    ...currentState,
    hazardZones: nextZones,
  };

  // Immediate trigger for creatures already standing in the area on placement
  if (options.triggerImmediatelyOnPlacement) {
    for (const combatant of Object.values(currentState.combatants)) {
      if (!combatant.isDead && isCreatureInHazardZone(combatant, zone)) {
        const trigRes = executeHazardZoneEffects(currentState, zone, combatant, 'enter');
        currentState = trigRes.state;
        events.push(...trigRes.events);
      }
    }
  }

  return { state: currentState, events };
}

/**
 * Removes an active Hazard Zone from the tactical board.
 */
export function removeHazardZone(
  state: CombatState,
  instanceId: string,
  reason: 'expired' | 'concentration_ended' | 'dispelled' | 'cleared',
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  const zone = state.hazardZones?.[instanceId];
  if (!zone) {
    return { state, events };
  }

  events.push({
    type: 'HAZARD_ZONE_REMOVED',
    instanceId,
    zoneId: zone.zoneId,
    casterId: zone.casterId,
    reason,
  });

  const nextZones = { ...state.hazardZones };
  delete nextZones[instanceId];

  return {
    state: {
      ...state,
      hazardZones: nextZones,
    },
    events,
  };
}

/**
 * Executes a Hazard Zone's `onEnterOrStartTurn` effect pipeline on a target creature.
 */
export function executeHazardZoneEffects(
  state: CombatState,
  zone: HazardZone,
  target: Combatant,
  trigger: 'enter' | 'start_turn',
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  let currentState = state;
  let currentRng = currentState.rngState;

  events.push({
    type: 'HAZARD_ZONE_TRIGGERED',
    instanceId: zone.id,
    zoneId: zone.zoneId,
    entityId: target.id,
    trigger,
  });

  // Mark creature as triggered for this zone this turn
  const triggeredSet = new Set(zone.triggeredCreaturesThisTurn ?? []);
  triggeredSet.add(target.id);
  const updatedZone: HazardZone = {
    ...zone,
    triggeredCreaturesThisTurn: Array.from(triggeredSet),
  };
  currentState = {
    ...currentState,
    hazardZones: {
      ...(currentState.hazardZones ?? {}),
      [zone.id]: updatedZone,
    },
  };

  const saveDc = zone.saveDc ?? 13;

  function runSteps(steps: EffectStepSpec[], currentTarget: Combatant, halfDamage = false) {
    for (const step of steps) {
      if (currentTarget.isDead) break;

      if (step.step === 'saving_throw') {
        const bonus =
          currentTarget.characterSheet?.savingThrows[step.ability]?.totalBonus ??
          currentTarget.monsterData?.savingThrows?.[step.ability] ??
          0;

        const { mode, autoFail } = getConditionSavingThrowRollMode(currentTarget, step.ability);

        let roll = 10;
        let total = bonus + 10;
        let passed = false;

        if (autoFail) {
          roll = 1;
          total = bonus + 1;
          passed = false;
        } else {
          const d20Res = rollD20(currentRng, { modifier: bonus, mode });
          currentRng = d20Res.nextState;
          roll = d20Res.naturalRoll;
          total = d20Res.total;
          passed = total >= saveDc;

          events.push({
            type: 'DICE_ROLLED',
            actorId: currentTarget.id,
            rollPurpose: `${step.ability.toUpperCase()} save vs ${zone.sourceName} DC ${saveDc}`,
            notation: d20Res.record.formula,
            rolls: d20Res.record.rolls,
            kept: d20Res.record.kept,
            modifier: d20Res.record.modifier,
            total: d20Res.total,
            mode,
            naturalCrit: roll === 20,
            naturalFumble: roll === 1,
          });
        }

        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: currentTarget.id,
          ability: step.ability,
          dc: saveDc,
          roll,
          total,
          outcome: passed ? 'success' : 'failure',
          sourceSpellOrAbilityName: zone.sourceName,
        });

        if (passed) {
          if (step.onSuccess) {
            runSteps(step.onSuccess, currentTarget);
          }
          // Check for half-damage on save
          for (const failStep of step.onFail) {
            if (failStep.step === 'deal_damage' && failStep.halfOnSaveSuccess) {
              runSteps([failStep], currentTarget, true);
            }
          }
        } else {
          runSteps(step.onFail, currentTarget, false);
        }
      } else if (step.step === 'deal_damage') {
        const dmgRoll = rollDamage(currentRng, step.diceFormula);
        currentRng = dmgRoll.nextState;

        events.push({
          type: 'DICE_ROLLED',
          actorId: zone.casterId,
          rollPurpose: `${zone.sourceName} Damage (${step.damageType})`,
          notation: dmgRoll.record.formula,
          rolls: dmgRoll.record.rolls,
          kept: dmgRoll.record.kept,
          modifier: dmgRoll.record.modifier,
          total: dmgRoll.total,
          mode: 'normal',
        });

        let rawAmount = dmgRoll.total;
        if (halfDamage) {
          rawAmount = Math.floor(rawAmount / 2);
        }

        const dmgRes = applyDamage({
          state: { ...currentState, rngState: currentRng },
          targetId: currentTarget.id,
          rawAmount,
          damageType: step.damageType,
          attackerId: zone.casterId,
          sourceName: zone.sourceName,
          isMagical: step.isMagical ?? true,
        });

        currentState = dmgRes.state;
        currentRng = currentState.rngState;
        events.push(...dmgRes.events);
        currentTarget = currentState.combatants[currentTarget.id] ?? currentTarget;
      } else if (step.step === 'apply_condition') {
        const condRes = applyConditionToCombatant(currentTarget, step.conditionId, {
          sourceId: zone.zoneId,
          sourceName: zone.sourceName,
          sourceEntityId: zone.casterId,
          durationRounds: step.durationRounds,
          requiresConcentration: step.requiresConcentration,
          repeatSaveAtTurnEnd: step.repeatSaveAtTurnEnd
            ? {
                ability: step.repeatSaveAtTurnEnd.ability,
                dc: saveDc,
              }
            : undefined,
        });

        currentTarget = condRes.combatant;
        currentState = {
          ...currentState,
          combatants: {
            ...currentState.combatants,
            [currentTarget.id]: currentTarget,
          },
        };
        events.push(...condRes.events);
      } else if (step.step === 'manual_adjudication') {
        events.push({
          type: 'MANUAL_ADJUDICATION_REQUIRED',
          actorId: zone.casterId,
          sourceName: zone.sourceName,
          adjudicationId: step.adjudicationId,
          title: step.title,
          guidance: step.guidance,
          ...(step.suggestedRoll ? { suggestedRoll: step.suggestedRoll } : {}),
          targetId: currentTarget.id,
        });
      }
    }
  }

  const liveTarget = currentState.combatants[target.id] ?? target;
  runSteps(zone.onEnterOrStartTurn, liveTarget);

  return {
    state: {
      ...currentState,
      rngState: currentRng,
    },
    events,
  };
}

/**
 * Checks and triggers hazard zones when a creature enters new cells during movement.
 */
export function triggerHazardZonesOnMove(
  state: CombatState,
  moverId: string,
  fromPoint: GridPoint,
  toPoint: GridPoint,
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  let currentState = state;
  const mover = currentState.combatants[moverId];
  if (!mover || mover.isDead || !currentState.hazardZones) {
    return { state, events };
  }

  // Create temporary mover at destination position to evaluate footprint
  const movedMover: Combatant = {
    ...mover,
    position: toPoint,
  };

  for (const zone of Object.values(currentState.hazardZones)) {
    if (isCreatureInHazardZone(movedMover, zone)) {
      const alreadyTriggered = zone.triggeredCreaturesThisTurn?.includes(moverId) ?? false;
      if (!alreadyTriggered) {
        const trigRes = executeHazardZoneEffects(currentState, zone, mover, 'enter');
        currentState = trigRes.state;
        events.push(...trigRes.events);
      }
    }
  }

  return { state: currentState, events };
}

/**
 * Triggers all hazard zones covering an active combatant at the start of their turn.
 */
export function triggerHazardZonesAtTurnStart(
  state: CombatState,
  combatantId: string,
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  let currentState = state;
  const combatant = currentState.combatants[combatantId];
  if (!combatant || combatant.isDead || !currentState.hazardZones) {
    return { state, events };
  }

  for (const zone of Object.values(currentState.hazardZones)) {
    if (isCreatureInHazardZone(combatant, zone)) {
      const trigRes = executeHazardZoneEffects(currentState, zone, combatant, 'start_turn');
      currentState = trigRes.state;
      events.push(...trigRes.events);
    }
  }

  return { state: currentState, events };
}

/**
 * Ticks remaining rounds for hazard zones and cleans up expired zones at turn/round transitions.
 * Also resets per-turn trigger tracking for the active combatant.
 */
export function tickHazardZones(
  state: CombatState,
  activeCombatantId: string,
): HazardZoneTransitionResult {
  const events: CombatEvent[] = [];
  if (!state.hazardZones) {
    return { state, events };
  }

  let currentState = state;
  const nextZones: Record<string, HazardZone> = {};

  for (const [id, zone] of Object.entries(state.hazardZones)) {
    // Reset triggered status for the combatant ending their turn
    const triggered = (zone.triggeredCreaturesThisTurn ?? []).filter((cid) => cid !== activeCombatantId);

    if (zone.casterId === activeCombatantId) {
      const nextRounds = zone.remainingRounds - 1;
      if (nextRounds <= 0) {
        events.push({
          type: 'HAZARD_ZONE_REMOVED',
          instanceId: zone.id,
          zoneId: zone.zoneId,
          casterId: zone.casterId,
          reason: 'expired',
        });
        continue;
      }
      nextZones[id] = {
        ...zone,
        remainingRounds: nextRounds,
        triggeredCreaturesThisTurn: triggered,
      };
    } else {
      nextZones[id] = {
        ...zone,
        triggeredCreaturesThisTurn: triggered,
      };
    }
  }

  return {
    state: {
      ...currentState,
      hazardZones: nextZones,
    },
    events,
  };
}
