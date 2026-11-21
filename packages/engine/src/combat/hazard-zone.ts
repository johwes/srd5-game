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
import { applyDamage, applyHealing } from './damage.js';
import { applyConditionToCombatant, getConditionSavingThrowRollMode } from './conditions.js';
import { startConcentration } from './concentration.js';
import { isHazardUnsupportedStep } from './marker-spells.js';
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
 * SRD-1205: parses a hazard `spend_resource` id that names a spell-slot
 * level (`spell_slot_3`, `slot_3`, `level_3`, `3`, `3_slot`). Returns the
 * level 0–9, or null for class-style resources (`action_surge`, …) that no
 * hazard can drain from a tracked pool.
 */
export function parseHazardSlotSpend(resourceId: string): number | null {
  const match = resourceId
    .trim()
    .toLowerCase()
    .match(/^(?:spell_slot_|slot_|level_)?(\d+)(?:_slot)?$/);
  if (!match) return null;
  const level = parseInt(match[1]!, 10);
  return level >= 0 && level <= 9 ? level : null;
}

/** Mutable spell-slot availability backing a hazard `spend_resource` drain. */
function hazardMutableSlotPools(target: Combatant, slotLevel: number): number[] {
  const pools: number[] = [];
  const key = String(slotLevel);
  const direct = target.spellSlots?.[key];
  if (direct) pools.push(direct.available);
  const sheet =
    target.characterSheet?.spellcasting?.spellSlots?.[
      slotLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    ];
  if (sheet) pools.push(sheet.available);
  if (target.pactMagic && target.pactMagic.slotLevel === slotLevel) {
    pools.push(target.pactMagic.availableSlots);
  }
  return pools;
}

/** True when a tracked pool covers the full drain amount (all-or-nothing). */
export function hazardSlotSpendAvailable(
  target: Combatant,
  slotLevel: number,
  amount: number,
): boolean {
  if (amount <= 0) return true;
  return hazardMutableSlotPools(target, slotLevel).some((available) => available >= amount);
}

/** Deducts a hazard drain across every tracked mirror of the slot pool. */
export function expendHazardSpellSlot(
  target: Combatant,
  slotLevel: number,
  amount: number,
): Combatant {
  let next = { ...target };
  const key = String(slotLevel);
  if (next.spellSlots?.[key]) {
    const pool = next.spellSlots[key]!;
    next = {
      ...next,
      spellSlots: {
        ...next.spellSlots,
        [key]: {
          ...pool,
          expended: pool.expended + amount,
          available: Math.max(0, pool.available - amount),
        },
      },
    };
  }
  if (next.pactMagic && next.pactMagic.slotLevel === slotLevel) {
    next = {
      ...next,
      pactMagic: {
        ...next.pactMagic,
        expendedSlots: next.pactMagic.expendedSlots + amount,
        availableSlots: Math.max(0, next.pactMagic.availableSlots - amount),
      },
    };
  }
  const sheetSlots = next.characterSheet?.spellcasting?.spellSlots;
  const sheetPool = sheetSlots?.[slotLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
  if (sheetPool && next.characterSheet?.spellcasting) {
    next = {
      ...next,
      characterSheet: {
        ...next.characterSheet,
        spellcasting: {
          ...next.characterSheet.spellcasting,
          spellSlots: {
            ...sheetSlots,
            [slotLevel]: {
              ...sheetPool,
              expended: sheetPool.expended + amount,
              available: Math.max(0, sheetPool.available - amount),
            },
          },
        },
      },
    };
  }
  return next;
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
          currentTarget.characterSheet?.savingThrows?.[step.ability]?.totalBonus ??
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
      } else if (step.step === 'heal') {
        const healRoll = rollDamage(currentRng, step.diceFormula);
        currentRng = healRoll.nextState;
        events.push({
          type: 'DICE_ROLLED',
          actorId: zone.casterId,
          rollPurpose: `${zone.sourceName} Healing`,
          notation: healRoll.record.formula,
          rolls: healRoll.record.rolls,
          kept: healRoll.record.kept,
          modifier: healRoll.record.modifier,
          total: healRoll.total,
          mode: 'normal',
        });
        const healRes = applyHealing({
          state: { ...currentState, rngState: currentRng },
          targetId: currentTarget.id,
          amount: healRoll.total,
          sourceName: zone.sourceName,
        });
        currentState = healRes.state;
        currentRng = currentState.rngState;
        events.push(...healRes.events);
        currentTarget = currentState.combatants[currentTarget.id] ?? currentTarget;
      } else if (step.step === 'grant_temp_hp') {
        const hpRoll = rollDamage(currentRng, step.amountFormula);
        currentRng = hpRoll.nextState;
        events.push({
          type: 'DICE_ROLLED',
          actorId: zone.casterId,
          rollPurpose: `${zone.sourceName} Temp HP`,
          notation: hpRoll.record.formula,
          rolls: hpRoll.record.rolls,
          kept: hpRoll.record.kept,
          modifier: hpRoll.record.modifier,
          total: hpRoll.total,
          mode: 'normal',
        });
        const updated: Combatant = {
          ...currentTarget,
          tempHp: Math.max(currentTarget.tempHp, hpRoll.total),
        };
        currentState = {
          ...currentState,
          combatants: { ...currentState.combatants, [updated.id]: updated },
        };
        events.push({
          type: 'TEMP_HP_APPLIED',
          targetId: updated.id,
          amount: hpRoll.total,
          tempHpBefore: currentTarget.tempHp,
          tempHpAfter: updated.tempHp,
          sourceName: zone.sourceName,
        });
        currentTarget = updated;
      } else if (step.step === 'apply_active_effect') {
        const existing = currentTarget.activeEffects ? [...currentTarget.activeEffects] : [];
        const entry = {
          effectId: step.effectId,
          name: step.name,
          sourceEntityId: zone.casterId,
          requiresConcentration: step.requiresConcentration,
          remainingRounds: step.durationRounds,
          modifiers: step.modifiers ?? [],
        };
        const updated: Combatant = {
          ...currentTarget,
          activeEffects: [...existing.filter((e) => e.effectId !== step.effectId), entry],
        };
        currentState = {
          ...currentState,
          combatants: { ...currentState.combatants, [updated.id]: updated },
        };
        currentTarget = updated;
      } else if (step.step === 'attack_roll') {
        // Hazard attack: bonus derived from the zone DC (DC = 8 + bonus).
        const attackBonus = saveDc - 8;
        const d20Res = rollD20(currentRng, { modifier: attackBonus, mode: 'normal' });
        currentRng = d20Res.nextState;
        events.push({
          type: 'DICE_ROLLED',
          actorId: zone.casterId,
          rollPurpose: `${zone.sourceName} attack (${step.attackType})`,
          notation: d20Res.record.formula,
          rolls: d20Res.record.rolls,
          kept: d20Res.record.kept,
          modifier: d20Res.record.modifier,
          total: d20Res.total,
          mode: 'normal',
          naturalCrit: d20Res.naturalRoll === 20,
          naturalFumble: d20Res.naturalRoll === 1,
        });
        const effectiveAc = currentTarget.armorClass;
        let outcome: 'miss' | 'hit' | 'critical_hit' = 'miss';
        if (d20Res.naturalRoll === 20) outcome = 'critical_hit';
        else if (d20Res.naturalRoll !== 1 && d20Res.total >= effectiveAc) outcome = 'hit';
        events.push({
          type: 'ATTACK_RESOLVED',
          attackerId: zone.casterId,
          targetId: currentTarget.id,
          weaponOrSpellName: zone.sourceName,
          attackType: step.attackType,
          roll: d20Res.naturalRoll,
          totalToHit: d20Res.total,
          targetAc: effectiveAc,
          outcome,
        });
        if (outcome === 'hit' || outcome === 'critical_hit') {
          runSteps(step.onHit, currentTarget, false);
          currentTarget = currentState.combatants[currentTarget.id] ?? currentTarget;
        } else if (step.onMiss) {
          runSteps(step.onMiss, currentTarget, false);
          currentTarget = currentState.combatants[currentTarget.id] ?? currentTarget;
        }
      } else if (step.step === 'forced_movement') {
        const stepsCount = Math.floor(step.distanceFeet / 5);
        const dirX = Math.sign(currentTarget.position.x - zone.origin.x) || 1;
        const dirY = Math.sign(currentTarget.position.y - zone.origin.y);
        const newPos = {
          x: Math.max(0, currentTarget.position.x + dirX * stepsCount * (step.direction === 'pull_to_actor' ? -1 : 1)),
          y: Math.max(0, currentTarget.position.y + dirY * stepsCount * (step.direction === 'pull_to_actor' ? -1 : 1)),
        };
        const updated: Combatant = { ...currentTarget, position: newPos };
        currentState = {
          ...currentState,
          combatants: { ...currentState.combatants, [updated.id]: updated },
        };
        events.push({ type: 'ENTITY_MOVED', entityId: updated.id, path: [newPos], mode: 'forced' });
        currentTarget = updated;
      } else if (step.step === 'teleport') {
        // SRD-1205: hazard teleport (e.g. a teleport trap) flings the
        // TRIGGERING creature — unlike a direct cast, which relocates the
        // caster. Same ray convention as `forced_movement`: straight away
        // from the zone origin, clamped to the board edge. Deterministic.
        const stepsCount = Math.floor(step.maxDistanceFeet / 5);
        const dirX = Math.sign(currentTarget.position.x - zone.origin.x) || 1;
        const dirY = Math.sign(currentTarget.position.y - zone.origin.y);
        const newPos = {
          x: Math.max(0, currentTarget.position.x + dirX * stepsCount),
          y: Math.max(0, currentTarget.position.y + dirY * stepsCount),
        };
        const updated: Combatant = { ...currentTarget, position: newPos };
        currentState = {
          ...currentState,
          combatants: { ...currentState.combatants, [updated.id]: updated },
        };
        events.push({ type: 'ENTITY_MOVED', entityId: updated.id, path: [newPos], mode: 'teleport' });
        currentTarget = updated;
      } else if (step.step === 'create_hazard_zone') {
        // SRD-1205: nested hazard — anchor the child zone at the triggering
        // creature's position with its own rasterized footprint. No immediate
        // trigger: the triggerer stands inside the new footprint and an
        // immediate sweep would recurse; it fires on turn start / re-entry.
        const nestedRes = createHazardZone(
          { ...currentState, rngState: currentRng },
          {
            zoneId: step.zoneId,
            casterId: zone.casterId,
            sourceName: zone.sourceName,
            shape: step.shape,
            origin: { ...currentTarget.position },
            sizeFeet: step.sizeFeet,
            durationRounds: step.durationRounds,
            requiresConcentration: false,
            difficultTerrain: step.difficultTerrain,
            obscurement: step.obscurement,
            onEnterOrStartTurn: step.onEnterOrStartTurn,
            saveDc,
            spellLevel: zone.spellLevel,
            triggerImmediatelyOnPlacement: false,
          },
        );
        currentState = nestedRes.state;
        currentRng = currentState.rngState;
        events.push(...nestedRes.events);
        currentTarget = currentState.combatants[currentTarget.id] ?? currentTarget;
      } else if (step.step === 'spend_resource') {
        // SRD-1205: hazard resource drain against the triggering creature's
        // tracked spell-slot pools. Unknown resource ids (and empty pools)
        // emit an explicit skip — never a silent drop.
        const slotLevel = parseHazardSlotSpend(step.resourceId);
        if (slotLevel === null) {
          events.push({
            type: 'HAZARD_ZONE_STEP_SKIPPED',
            instanceId: zone.id,
            zoneId: zone.zoneId,
            entityId: currentTarget.id,
            step: step.step,
            reason: `untracked_resource_${step.resourceId}`,
          });
        } else if (!hazardSlotSpendAvailable(currentTarget, slotLevel, step.amount)) {
          events.push({
            type: 'HAZARD_ZONE_STEP_SKIPPED',
            instanceId: zone.id,
            zoneId: zone.zoneId,
            entityId: currentTarget.id,
            step: step.step,
            reason: `insufficient_spell_slot_${slotLevel}`,
          });
        } else {
          const updated = expendHazardSpellSlot(currentTarget, slotLevel, step.amount);
          currentState = {
            ...currentState,
            combatants: { ...currentState.combatants, [updated.id]: updated },
          };
          events.push({
            type: 'RESOURCE_SPENT',
            entityId: updated.id,
            resourceId: step.resourceId,
            amount: step.amount,
            slotLevel,
            sourceName: zone.sourceName,
          });
          currentTarget = updated;
        }
      } else if (isHazardUnsupportedStep(step.step)) {
        // SRD-1204: no silent drops — steps with no hazard auto-resolver
        // (teleport / summon / nested zone / resource spend) emit explicitly.
        events.push({
          type: 'HAZARD_ZONE_STEP_SKIPPED',
          instanceId: zone.id,
          zoneId: zone.zoneId,
          entityId: currentTarget.id,
          step: step.step,
          reason: `no_hazard_resolver_for_${step.step}`,
        });
      } else {
        events.push({
          type: 'HAZARD_ZONE_STEP_SKIPPED',
          instanceId: zone.id,
          zoneId: zone.zoneId,
          entityId: currentTarget.id,
          step: (step as { step: string }).step,
          reason: 'unhandled_step',
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
