import type {
  ActivatedAbilitySpec,
  EffectStepSpec,
  SummonControlMode,
  SummonStatblockSpec,
} from '@srd5/data';
import {
  rollD20,
  rollDamage,
  type FormulaContext,
  type RollMode,
} from '../dice/evaluator.js';
import {
  getFootprintCells,
  getFootprintDistanceFeet,
} from '../grid/footprints.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { applyConditionToCombatant } from './conditions.js';
import { applyDamage } from './damage.js';
import { areHostile } from './allegiance.js';
import { compareInitiativeEntries } from './initiative.js';
import { getTargetSavingThrowBonus } from './spellcasting.js';
import type {
  CombatEvent,
  CombatState,
  Combatant,
  InitiativeEntry,
} from './types.js';

/**
 * Summoned Creature & Conjured Token engine pipeline (Spec 08 §4).
 *
 * Everything here is pure and deterministic: every die roll threads the
 * authoritative `rngState`, so identical seeds replay identically.
 */

export interface SummonTransitionResult {
  state: CombatState;
  events: CombatEvent[];
}

export interface SpawnSummonOptions {
  summonId: string;
  name: string;
  statblock: SummonStatblockSpec;
  control: SummonControlMode;
  durationRounds: number;
  requiresConcentration: boolean;
  casterId: string;
  sourceName: string;
  origin?: GridPoint | undefined;
  /** Optional pre-computed instance id; generated deterministically when omitted. */
  entityId?: string | undefined;
}

/** Spellcasting context of a summon's owner (used by summon attack/save effects). */
export interface SummonSpellContext {
  spellSaveDc: number;
  spellAttackBonus: number;
  spellMod: number;
  prof: number;
}

/**
 * Returns the owner's spellcasting numbers for a summon's effects.
 * Kept local (rather than importing spellcasting) to avoid a module cycle.
 */
export function getSummonSpellContext(caster: Combatant): SummonSpellContext {
  let spellSaveDc = 13;
  let spellAttackBonus = 5;
  let spellMod = 3;
  let prof = 2;

  if (caster.characterSheet) {
    prof = caster.characterSheet.proficiencyBonus;
    const sp = caster.characterSheet.spellcasting;
    if (sp) {
      if (sp.primarySpellSaveDc !== undefined) spellSaveDc = sp.primarySpellSaveDc;
      if (sp.primarySpellAttackBonus !== undefined) spellAttackBonus = sp.primarySpellAttackBonus;
      const ability = sp.primaryAbility ?? 'int';
      spellMod = caster.characterSheet.abilities[ability]?.modifier ?? 3;
    }
  } else if (caster.monsterData?.spellcasting) {
    const sp = caster.monsterData.spellcasting;
    spellSaveDc = sp.spellSaveDc;
    spellAttackBonus = sp.spellAttackBonus;
    const ability = sp.ability;
    spellMod = Math.floor(((caster.monsterData.abilities[ability] ?? 10) - 10) / 2);
  }

  return { spellSaveDc, spellAttackBonus, spellMod, prof };
}

/**
 * Untargetable conjurations (hound, sword, guardian) are skipped by attack
 * declarations, spell targeting, AOE rasterization and the AI planner.
 */
export function isSummonTargetable(combatant: Combatant | undefined): boolean {
  if (!combatant) return false;
  if (combatant.isSummon && combatant.untargetable) return false;
  return true;
}

/**
 * Finds a deterministic, unoccupied cell within a few cells of the requested
 * origin. A summon occupies space only if its statblock is harmable; untargetable
 * conjurations still anchor to a cell so they can be rendered/triggered.
 */
export function findSummonPlacement(
  state: CombatState,
  origin: GridPoint,
  size: SummonStatblockSpec['size'],
): GridPoint {
  const occupied = Object.values(state.combatants).filter((c) => !c.isDead && c.currentHp > 0);
  const isFree = (cell: GridPoint): boolean => {
    const footprint = getFootprintCells(cell, size);
    return !occupied.some((c) =>
      getFootprintCells(c.position, c.size).some((fc) =>
        footprint.some((p) => p.x === fc.x && p.y === fc.y),
      ),
    );
  };

  if (isFree(origin)) return { ...origin };

  for (let radius = 1; radius <= 4; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = { x: origin.x + dx, y: origin.y + dy };
        if (candidate.x < 0 || candidate.y < 0) continue;
        if (isFree(candidate)) return candidate;
      }
    }
  }

  // Fallback: overlap the origin rather than failing a spell cast.
  return { ...origin };
}

/**
 * Builds a Combatant + initiative entry for a summon from its statblock.
 * All rolls (initiative and HP formula) consume the seeded PRNG.
 */
export function createSummonCombatant(
  state: CombatState,
  options: SpawnSummonOptions,
): { combatant: Combatant; entry: InitiativeEntry; nextRngState: number; events: CombatEvent[] } {
  const caster = state.combatants[options.casterId];
  if (!caster) {
    throw new Error(`Summon caster "${options.casterId}" not found in combat`);
  }

  let rng = state.rngState;
  const events: CombatEvent[] = [];
  const { statblock } = options;

  const dexScore = statblock.abilities?.dex ?? 10;
  const dexMod = Math.floor((dexScore - 10) / 2);
  const strScore = statblock.abilities?.str;
  const strMod = strScore !== undefined ? Math.floor((strScore - 10) / 2) : undefined;

  // HP: formulas such as `@casterMaxHp` (Arcane Hand) resolve from the caster.
  let maxHp = 1;
  if (statblock.hitPointsFormula) {
    const ctx: FormulaContext = {
      '@casterMaxHp': caster.maxHp,
      casterMaxHp: caster.maxHp,
      '@spellMod': getSummonSpellContext(caster).spellMod,
    };
    const hpRoll = rollDamage(rng, statblock.hitPointsFormula, { context: ctx });
    rng = hpRoll.nextState;
    maxHp = Math.max(1, Math.floor(hpRoll.total));
  }

  const untargetable = Boolean(statblock.untargetable);
  const armorClass = statblock.armorClass ?? 10;
  const position = findSummonPlacement(state, options.origin ?? caster.position, statblock.size);

  const summonsInCombat = Object.values(state.combatants).filter((c) => c.isSummon).length;
  const entityId = options.entityId ?? `${options.summonId}-${caster.id}-${state.round}-${summonsInCombat + 1}`;

  const combatant: Combatant = {
    id: entityId,
    name: options.name,
    side: caster.side,
    teamId: caster.teamId ?? caster.side,
    factionId: caster.factionId,
    playerId: caster.playerId,
    roomId: caster.roomId,
    size: statblock.size,
    position,
    speedFeet: statblock.speedFeet,
    currentHp: maxHp,
    maxHp,
    tempHp: 0,
    armorClass,
    dexterityScore: dexScore,
    dexterityModifier: dexMod,
    strengthScore: strScore,
    strengthModifier: strMod,
    initiativeBonus: dexMod,
    initiativeRollMode: 'normal',
    passivePerception: 10 + dexMod,
    stealthModifier: dexMod,
    isSurprised: false,
    isDodging: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    isSummon: true,
    summonId: options.summonId,
    summonedByEntityId: caster.id,
    summonSourceName: options.sourceName,
    summonControl: options.control,
    untargetable,
    summonExpiryRound: state.round + options.durationRounds,
    summonActions: statblock.actions ? structuredClone(statblock.actions) : undefined,
    summonTriggers: statblock.triggers ? structuredClone(statblock.triggers) : undefined,
    summonDamageCap: statblock.damageCap,
    summonDamageDealt: 0,
    summonTriggeredCreaturesThisTurn: [],
    summonDismissible: options.control === 'autonomous',
    summonConcentrationLinked: options.requiresConcentration,
  };

  // Commanded summons roll initiative at spawn (Spec 08 §4.2). Autonomous ones
  // also receive a deterministic entry for the initiative ribbon, but are
  // excluded from taking turns via `isCombatantEligibleForTurn`.
  const initRoll = rollD20(rng, { modifier: combatant.initiativeBonus, mode: 'normal' });
  rng = initRoll.nextState;
  const tieRoll = rollD20(rng);
  rng = tieRoll.nextState;

  const entry: InitiativeEntry = {
    entityId: entityId,
    initiative: initRoll.total,
    naturalRoll: initRoll.naturalRoll,
    dexterityScore: combatant.dexterityScore,
    tieBreaker: tieRoll.total,
  };

  events.push({
    type: 'DICE_ROLLED',
    actorId: entityId,
    rollPurpose: 'summon_initiative',
    notation: initRoll.record.resolvedNotation,
    rolls: initRoll.record.rolls,
    kept: initRoll.record.kept,
    modifier: initRoll.record.modifier,
    total: initRoll.total,
    mode: 'normal',
    naturalCrit: initRoll.isCrit,
    naturalFumble: initRoll.isFumble,
  });

  return { combatant, entry, nextRngState: rng, events };
}

/**
 * Spawns a summon onto the authoritative combat state, inserts it into the
 * initiative order (keeping the active combatant index stable), links it to the
 * caster's concentration when requested, and emits `SUMMON_SPAWNED`.
 */
export function spawnSummon(
  state: CombatState,
  options: SpawnSummonOptions,
): SummonTransitionResult & { entityId: string } {
  const created = createSummonCombatant(state, options);
  const events: CombatEvent[] = [...created.events];
  const caster = state.combatants[options.casterId];
  if (!caster) throw new Error(`Summon caster "${options.casterId}" not found in combat`);

  const combatants: Record<string, Combatant> = {
    ...state.combatants,
    [created.combatant.id]: created.combatant,
  };

  // Concentration linkage: add the summon to the caster's tracked targets so
  // breaking concentration despawns it via the existing concentration path.
  if (options.requiresConcentration && caster.concentratingOn) {
    const conc = caster.concentratingOn;
    combatants[caster.id] = {
      ...caster,
      concentratingOn: {
        ...conc,
        targetEntityIds: Array.from(new Set([...conc.targetEntityIds, created.combatant.id])),
      },
    };
  }

  const initiativeOrder = [...state.initiativeOrder, created.entry];
  initiativeOrder.sort(compareInitiativeEntries);
  const activeCombatantIndex = state.activeCombatantId
    ? Math.max(
        0,
        initiativeOrder.findIndex((e) => e.entityId === state.activeCombatantId),
      )
    : state.activeCombatantIndex;

  events.push({
    type: 'SUMMON_SPAWNED',
    entityId: created.combatant.id,
    summonId: options.summonId,
    casterId: caster.id,
    sourceName: options.sourceName,
    control: options.control,
    untargetable: Boolean(options.statblock.untargetable),
    position: { ...created.combatant.position },
    expiryRound: created.combatant.summonExpiryRound ?? state.round,
  });

  return {
    state: {
      ...state,
      combatants,
      initiativeOrder,
      activeCombatantIndex,
      rngState: created.nextRngState,
    },
    events,
    entityId: created.combatant.id,
  };
}

/**
 * Removes a summon from combatants and the initiative order, emitting
 * `SUMMON_EXPIRED`. Safe to call on an already-removed summon.
 */
export function despawnSummon(
  state: CombatState,
  entityId: string,
  reason: 'duration' | 'concentration' | 'dismissed' | 'leash' | 'damage_cap' | 'death',
): SummonTransitionResult {
  const summon = state.combatants[entityId];
  if (!summon || !summon.isSummon) return { state, events: [] };

  const events: CombatEvent[] = [
    {
      type: 'SUMMON_EXPIRED',
      entityId,
      summonId: summon.summonId ?? entityId,
      reason,
      sourceName: summon.summonSourceName,
    },
  ];

  const combatants = { ...state.combatants };
  delete combatants[entityId];

  const oldIndex = state.initiativeOrder.findIndex((e) => e.entityId === entityId);
  const initiativeOrder = state.initiativeOrder.filter((e) => e.entityId !== entityId);
  let activeCombatantIndex = state.activeCombatantIndex;
  if (oldIndex >= 0 && oldIndex < activeCombatantIndex) {
    activeCombatantIndex = Math.max(0, activeCombatantIndex - 1);
  }
  if (state.activeCombatantId === entityId) {
    activeCombatantIndex = Math.max(0, Math.min(activeCombatantIndex, initiativeOrder.length - 1));
  }

  return {
    state: { ...state, combatants, initiativeOrder, activeCombatantIndex },
    events,
  };
}

/** Expires summons whose absolute expiry round has been reached and resets per-turn trigger tracking. */
export function tickSummonsForRound(state: CombatState, round: number): SummonTransitionResult {
  const events: CombatEvent[] = [];
  let nextState = state;

  for (const summon of Object.values(state.combatants)) {
    if (!summon.isSummon) continue;
    if (
      summon.summonExpiryRound !== undefined &&
      round >= summon.summonExpiryRound
    ) {
      const res = despawnSummon(nextState, summon.id, 'duration');
      nextState = res.state;
      events.push(...res.events);
    }
  }

  const combatants: Record<string, Combatant> = {};
  for (const [id, c] of Object.entries(nextState.combatants)) {
    combatants[id] = c.isSummon
      ? { ...c, summonTriggeredCreaturesThisTurn: [] }
      : c;
  }

  return { state: { ...nextState, combatants }, events };
}

/** Resolves a summon's activated ability effects against targets. */
export interface ResolveSummonEffectsOptions {
  state: CombatState;
  summonId: string;
  targetIds: string[];
  steps: EffectStepSpec[];
  sourceName: string;
  grid?: TacticalGrid | undefined;
}

export function resolveSummonEffects(
  options: ResolveSummonEffectsOptions,
): SummonTransitionResult {
  const summon = options.state.combatants[options.summonId];
  if (!summon) return { state: options.state, events: [] };
  const caster = summon.summonedByEntityId
    ? options.state.combatants[summon.summonedByEntityId]
    : undefined;
  const spellCtx = caster ? getSummonSpellContext(caster) : { spellSaveDc: 13, spellAttackBonus: 5, spellMod: 3, prof: 2 };

  const events: CombatEvent[] = [];
  let rng = options.state.rngState;
  let combatantsMap: Record<string, Combatant> = { ...options.state.combatants };
  let damageDealt = 0;

  const formulaVars: FormulaContext = {
    '@spellSaveDC': spellCtx.spellSaveDc,
    '@spellMod': spellCtx.spellMod,
    '@prof': spellCtx.prof,
    spellSaveDC: spellCtx.spellSaveDc,
    spellMod: spellCtx.spellMod,
    prof: spellCtx.prof,
  };

  const runSteps = (steps: EffectStepSpec[], target: Combatant, isCritical = false, halfDamage = false): void => {
    for (const step of steps) {
      const liveTarget = combatantsMap[target.id];
      if (!liveTarget || liveTarget.isDead) break;

      if (step.step === 'attack_roll') {
        const attackBonus = step.attackBonusOverride ?? spellCtx.spellAttackBonus;
        const d20 = rollD20(rng, {
          modifier: attackBonus,
          mode: 'normal' as RollMode,
        });
        rng = d20.nextState;

        events.push({
          type: 'DICE_ROLLED',
          actorId: summon.id,
          rollPurpose: `${options.sourceName} attack roll`,
          notation: d20.record.resolvedNotation,
          rolls: d20.record.rolls,
          kept: d20.record.kept,
          modifier: d20.record.modifier,
          total: d20.total,
          mode: 'normal',
          naturalCrit: d20.isCrit,
          naturalFumble: d20.isFumble,
        });

        const outcome = d20.naturalRoll === 20 ? 'critical_hit' : d20.naturalRoll === 1 ? 'miss' : d20.total >= liveTarget.armorClass ? 'hit' : 'miss';
        events.push({
          type: 'ATTACK_RESOLVED',
          attackerId: summon.id,
          targetId: liveTarget.id,
          weaponOrSpellName: options.sourceName,
          attackType: step.attackType,
          roll: d20.naturalRoll,
          totalToHit: d20.total,
          targetAc: liveTarget.armorClass,
          outcome,
        });

        if (outcome !== 'miss') {
          runSteps(step.onHit, liveTarget, outcome === 'critical_hit');
        } else if (step.onMiss) {
          runSteps(step.onMiss, liveTarget);
        }
      } else if (step.step === 'saving_throw') {
        const bonus = getTargetSavingThrowBonus(liveTarget, step.ability);
        const dcRoll = rollDamage(rng, step.dcFormula, { context: formulaVars });
        rng = dcRoll.nextState;
        const dc = Math.round(dcRoll.total);
        const d20 = rollD20(rng, { modifier: bonus, mode: 'normal' });
        rng = d20.nextState;
        const passed = d20.total >= dc;

        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: liveTarget.id,
          ability: step.ability,
          dc,
          roll: d20.naturalRoll,
          total: d20.total,
          outcome: passed ? 'success' : 'failure',
          sourceSpellOrAbilityName: options.sourceName,
        });

        if (passed) {
          if (step.onSuccess) runSteps(step.onSuccess, liveTarget);
          for (const failStep of step.onFail) {
            if (failStep.step === 'deal_damage' && failStep.halfOnSaveSuccess) {
              runSteps([failStep], liveTarget, false, true);
            }
          }
        } else {
          runSteps(step.onFail, liveTarget);
        }
      } else if (step.step === 'deal_damage') {
        const dmgRoll = rollDamage(rng, step.diceFormula, { context: formulaVars, isCritical });
        rng = dmgRoll.nextState;
        const rawAmount = halfDamage ? Math.floor(dmgRoll.total / 2) : dmgRoll.total;

        events.push({
          type: 'DICE_ROLLED',
          actorId: summon.id,
          rollPurpose: `${options.sourceName} damage (${step.diceFormula})`,
          notation: dmgRoll.record.formula,
          rolls: dmgRoll.record.rolls,
          kept: dmgRoll.record.kept,
          modifier: dmgRoll.record.modifier,
          total: dmgRoll.total,
          mode: 'normal',
        });

        const dmgRes = applyDamage({
          state: { ...options.state, rngState: rng, combatants: combatantsMap },
          targetId: liveTarget.id,
          rawAmount,
          damageType: step.damageType,
          isCritical,
          attackerId: summon.id,
          sourceName: options.sourceName,
          isMagical: step.isMagical ?? true,
        });
        rng = dmgRes.state.rngState;
        combatantsMap = dmgRes.state.combatants;
        damageDealt += dmgRes.finalAmount;
        events.push(...dmgRes.events);
      } else if (step.step === 'apply_condition') {
        // Conditions from summon effects use the standard condition engine.
        const condRes = applyConditionToCombatant(liveTarget, step.conditionId, {
          sourceId: summon.id,
          sourceName: options.sourceName,
          sourceEntityId: summon.id,
          durationRounds: step.durationRounds,
          requiresConcentration: step.requiresConcentration,
        });
        combatantsMap[liveTarget.id] = condRes.combatant;
        events.push(...condRes.events);
      } else if (step.step === 'grant_temp_hp') {
        const hpRoll = rollDamage(rng, step.amountFormula, { context: formulaVars });
        rng = hpRoll.nextState;
        combatantsMap[liveTarget.id] = {
          ...combatantsMap[liveTarget.id]!,
          tempHp: Math.max(combatantsMap[liveTarget.id]!.tempHp, hpRoll.total),
        };
      }
    }
  };

  for (const tid of options.targetIds) {
    const target = combatantsMap[tid];
    if (target && !target.isDead) runSteps(options.steps, target);
  }

  let nextState: CombatState = { ...options.state, combatants: combatantsMap, rngState: rng };

  const actingSummon = nextState.combatants[options.summonId];
  if (actingSummon) {
    const updated: Combatant = { ...actingSummon, summonDamageDealt: (actingSummon.summonDamageDealt ?? 0) + damageDealt };
    const combatants = { ...nextState.combatants, [options.summonId]: updated };
    nextState = { ...nextState, combatants };

    if (
      updated.summonDamageCap !== undefined &&
      (updated.summonDamageDealt ?? 0) >= updated.summonDamageCap
    ) {
      const despawn = despawnSummon(nextState, options.summonId, 'damage_cap');
      nextState = despawn.state;
      events.push(...despawn.events);
    }
  }

  return { state: nextState, events };
}

/** Autonomous hooks fired at the start of the owner's turn (hound bite, bark, leash). */
export function runSummonTriggersAtTurnStart(
  state: CombatState,
  casterId: string,
): SummonTransitionResult {
  const events: CombatEvent[] = [];
  let nextState = state;

  for (const summon of Object.values(state.combatants)) {
    if (!summon.isSummon || summon.summonControl !== 'autonomous') continue;
    if (summon.summonedByEntityId !== casterId) continue;
    const caster = nextState.combatants[casterId];
    if (!caster || caster.isDead) continue;
    const triggers = summon.summonTriggers ?? [];
    const liveSummon = nextState.combatants[summon.id];
    if (!liveSummon || liveSummon.isDead) continue;

    // Leash: vanish when too far from the caster.
    const leash = triggers.find((t) => t.kind === 'leash');
    if (leash && leash.kind === 'leash') {
      const dist = getFootprintDistanceFeet(caster.position, caster.size, liveSummon.position, liveSummon.size);
      if (dist > leash.maxDistanceFeet) {
        events.push({
          type: 'SUMMON_TRIGGERED',
          entityId: liveSummon.id,
          summonId: liveSummon.summonId ?? liveSummon.id,
          trigger: 'leash',
          detail: `More than ${leash.maxDistanceFeet} ft from caster`,
        });
        const despawn = despawnSummon(nextState, liveSummon.id, 'leash');
        nextState = despawn.state;
        events.push(...despawn.events);
        continue;
      }
    }

    // Bark: alert when a hostile of Small+ size is within 30 ft (no mechanical effect).
    if (!triggers.some((t) => t.kind === 'start_of_caster_turn_attack')) continue;
    const barkTargets = Object.values(nextState.combatants).filter((other) => {
      if (other.id === casterId || other.id === liveSummon.id) return false;
      if (other.isDead || other.currentHp <= 0) return false;
      if (other.size === 'tiny') return false;
      if (areAlliedToSummon(liveSummon, other, nextState)) return false;
      const d = getFootprintDistanceFeet(liveSummon.position, liveSummon.size, other.position, other.size);
      return d <= 30;
    });
    if (barkTargets.length > 0) {
      events.push({
        type: 'SUMMON_TRIGGERED',
        entityId: liveSummon.id,
        summonId: liveSummon.summonId ?? liveSummon.id,
        trigger: 'bark',
        detail: `${liveSummon.name} barks at ${barkTargets[0]!.name}`,
      });
    }

    // Bite: at the start of the caster's turn, attack one hostile within range.
    const attackTrigger = triggers.find((t) => t.kind === 'start_of_caster_turn_attack');
    if (attackTrigger && attackTrigger.kind === 'start_of_caster_turn_attack' && liveSummon.summonActions?.length) {
      const candidates = Object.values(nextState.combatants)
        .filter((other) => {
          if (other.id === liveSummon.id || other.isDead || other.currentHp <= 0) return false;
          if (areAlliedToSummon(liveSummon, other, nextState)) return false;
          if (!isSummonTargetable(other)) return false;
          const d = getFootprintDistanceFeet(liveSummon.position, liveSummon.size, other.position, other.size);
          return d <= attackTrigger.rangeFeet;
        })
        .sort((a, b) => {
          const da = getFootprintDistanceFeet(liveSummon.position, liveSummon.size, a.position, a.size);
          const db = getFootprintDistanceFeet(liveSummon.position, liveSummon.size, b.position, b.size);
          return da - db || a.id.localeCompare(b.id);
        });

      if (candidates.length > 0) {
        const action = liveSummon.summonActions.find((a) => a.id === 'bite') ?? liveSummon.summonActions[0]!;
        events.push({
          type: 'SUMMON_TRIGGERED',
          entityId: liveSummon.id,
          summonId: liveSummon.summonId ?? liveSummon.id,
          trigger: 'bite',
          targetEntityId: candidates[0]!.id,
        });
        const res = resolveSummonEffects({
          state: nextState,
          summonId: liveSummon.id,
          targetIds: [candidates[0]!.id],
          steps: action.effects,
          sourceName: `${liveSummon.name} — ${action.name}`,
        });
        nextState = res.state;
        events.push(...res.events);
      }
    }
  }

  return { state: nextState, events };
}

/** Autonomous hooks fired when a creature moves (guardian aura trigger). */
export function triggerSummonsOnMove(
  state: CombatState,
  moverId: string,
  _fromPoint: GridPoint,
  toPoint: GridPoint,
): SummonTransitionResult {
  const events: CombatEvent[] = [];
  let nextState = state;
  const mover = state.combatants[moverId];
  if (!mover || mover.isDead || mover.currentHp <= 0) return { state, events };

  const movedMover: Combatant = { ...mover, position: toPoint };

  for (const summon of Object.values(state.combatants)) {
    if (!summon.isSummon || summon.summonControl !== 'autonomous') continue;
    if (summon.isDead) continue;
    const trigger = summon.summonTriggers?.find((t) => t.kind === 'hostile_enter_radius');
    if (!trigger || trigger.kind !== 'hostile_enter_radius') continue;
    if (areAlliedToSummon(summon, movedMover, state)) continue;
    if (!isSummonTargetable(movedMover)) continue;
    if (summon.summonTriggeredCreaturesThisTurn?.includes(moverId)) continue;

    const liveSummon = nextState.combatants[summon.id];
    if (!liveSummon || liveSummon.isDead) continue;
    const dist = getFootprintDistanceFeet(liveSummon.position, liveSummon.size, toPoint, movedMover.size);
    if (dist > trigger.radiusFeet) continue;

    const triggered = Array.from(new Set([...(liveSummon.summonTriggeredCreaturesThisTurn ?? []), moverId]));
    nextState = {
      ...nextState,
      combatants: {
        ...nextState.combatants,
        [liveSummon.id]: { ...liveSummon, summonTriggeredCreaturesThisTurn: triggered },
      },
    };

    events.push({
      type: 'SUMMON_TRIGGERED',
      entityId: liveSummon.id,
      summonId: liveSummon.summonId ?? liveSummon.id,
      trigger: 'hostile_enter_radius',
      targetEntityId: moverId,
    });

    if (liveSummon.summonActions?.length) {
      const action = liveSummon.summonActions[0]!;
      const res = resolveSummonEffects({
        state: nextState,
        summonId: liveSummon.id,
        targetIds: [moverId],
        steps: action.effects,
        sourceName: `${liveSummon.name} — ${action.name}`,
      });
      nextState = res.state;
      events.push(...res.events);
    }
  }

  return { state: nextState, events };
}

/** Dismisses a summon, validating the caster's ownership (Spec 08 §4.2). */
export function dismissSummon(
  state: CombatState,
  actorId: string,
  options: { summonId?: string; summonEntityId?: string },
): SummonTransitionResult {
  const candidates = Object.values(state.combatants).filter(
    (c) =>
      c.isSummon &&
      c.summonedByEntityId === actorId &&
      (options.summonEntityId
        ? c.id === options.summonEntityId
        : options.summonId
          ? c.summonId === options.summonId
          : true),
  );

  if (candidates.length === 0) {
    throw new Error(`No summon owned by "${actorId}" matches the dismissal request`);
  }

  const budget = state.activeCombatantId === actorId ? state.turnBudget : null;
  if (budget && budget.action <= 0) {
    throw new Error('No action available to dismiss a summon');
  }

  let nextState = state;
  const events: CombatEvent[] = [];
  for (const summon of candidates) {
    const res = despawnSummon(nextState, summon.id, 'dismissed');
    nextState = res.state;
    events.push(...res.events);
  }

  if (budget) {
    nextState = { ...nextState, turnBudget: { ...budget, action: budget.action - 1 } };
  }

  return { state: nextState, events };
}

/** Executes one of a commanded summon's activated abilities during its own turn. */
export function executeSummonAction(
  state: CombatState,
  options: {
    summonId: string;
    actionId: string;
    actorId?: string;
    targetId?: string;
    targetIds?: string[];
  },
): SummonTransitionResult {
  const summon = state.combatants[options.summonId];
  if (!summon || !summon.isSummon) {
    throw new Error(`Summon "${options.summonId}" not found in combat`);
  }
  if (options.actorId && !controlsSummon(state, options.actorId, summon)) {
    throw new Error(`Player "${options.actorId}" does not control summon "${summon.name}"`);
  }
  if (summon.summonControl !== 'commanded') {
    throw new Error(`${summon.name} is autonomous and cannot be commanded`);
  }
  if (state.activeCombatantId !== summon.id) {
    throw new Error(`It is not ${summon.name}'s turn`);
  }
  if (!state.turnBudget || state.turnBudget.action <= 0) {
    throw new Error(`No action available for ${summon.name}`);
  }

  const action: ActivatedAbilitySpec | undefined = summon.summonActions?.find(
    (a) => a.id === options.actionId,
  );
  if (!action) {
    throw new Error(`Summon action "${options.actionId}" not found on ${summon.name}`);
  }

  const targetIds = options.targetIds ?? (options.targetId ? [options.targetId] : []);
  const res = resolveSummonEffects({
    state,
    summonId: summon.id,
    targetIds,
    steps: action.effects,
    sourceName: `${summon.name} — ${action.name}`,
  });

  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId: summon.id,
      actionName: 'custom',
      cost: 'action',
    },
    ...res.events,
  ];

  const turnBudget = res.state.turnBudget ? { ...res.state.turnBudget, action: res.state.turnBudget.action - 1 } : null;
  return { state: { ...res.state, turnBudget }, events };
}

/**
 * Transitive ownership: a player controls a summon iff they control the chain
 * root of `summonedByEntityId` (Spec 08 §4.2 / §5).
 */
export function controlsSummon(state: CombatState, actorId: string, summon: Combatant): boolean {
  if (summon.playerId && actorId === summon.playerId) return true;
  const caster = summon.summonedByEntityId ? state.combatants[summon.summonedByEntityId] : undefined;
  if (!caster) return false;
  if (caster.id === actorId) return true;
  if (caster.playerId && caster.playerId === actorId) return true;
  return false;
}

function areAlliedToSummon(summon: Combatant, other: Combatant, state: CombatState): boolean {
  return !areHostile(summon, other, state.dispositionMatrix);
}

