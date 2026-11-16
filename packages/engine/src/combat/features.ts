import type { ActivatedAbilitySpec, EffectStepSpec } from '@srd5/data';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { applyConditionToCombatant } from './conditions.js';
import { applyDamage, applyHealing } from './damage.js';
import { evaluateCombatVictory } from './state-machine.js';
import { getTargetSavingThrowBonus } from './spellcasting.js';
import type { CombatEvent, CombatState, Combatant } from './types.js';

export interface ExecuteActivatedAbilityOptions {
  state: CombatState;
  actorId: string;
  abilityId: string;
  ability?: ActivatedAbilitySpec;
  targetId?: string;
  targetIds?: string[];
  originCell?: GridPoint;
  grid?: TacticalGrid;
}

export interface ActivatedAbilityResult {
  state: CombatState;
  events: CombatEvent[];
  abilityName: string;
}

/**
 * Executes a Class Feature or Monster Activated Ability (Combat Tier A).
 * - Deducts action economy from TurnBudget (action, bonus action, reaction).
 * - Deducts resource cost from characterSheet resources if tracked.
 * - Resolves targets (self, single, multiple, or AOE).
 * - Executes declarative EffectStepSpec pipeline (apply_active_effect, heal, temp HP, condition, damage, save).
 */
export function executeActivatedAbility(options: ExecuteActivatedAbilityOptions): ActivatedAbilityResult {
  const { state, actorId, abilityId, originCell, grid } = options;
  const actor = state.combatants[actorId];
  if (!actor) {
    throw new Error(`Actor "${actorId}" not found in combatants`);
  }

  // 1. Resolve ability spec
  let ability = options.ability;
  if (!ability && actor.monsterData?.traits) {
    for (const trait of actor.monsterData.traits) {
      const found = trait.activatedAbilities?.find((a) => a.id === abilityId);
      if (found) {
        ability = found;
        break;
      }
    }
  }

  if (!ability) {
    throw new Error(`Activated ability "${abilityId}" not found on "${actor.name}"`);
  }

  const events: CombatEvent[] = [];
  let combatantsMap: Record<string, Combatant> = { ...state.combatants };
  let rng = state.rngState;
  let nextActor = { ...actor };

  // 2. Action Budget deduction
  let nextBudget = state.turnBudget ? { ...state.turnBudget } : null;
  if (nextBudget && state.activeCombatantId === actorId) {
    if (ability.actionCost === 'action') {
      if (nextBudget.action <= 0) {
        throw new Error(`No action available for "${actor.name}"`);
      }
      nextBudget.action -= 1;
    } else if (ability.actionCost === 'bonus_action') {
      if (nextBudget.bonusAction <= 0) {
        throw new Error(`No bonus action available for "${actor.name}"`);
      }
      nextBudget.bonusAction -= 1;
    } else if (ability.actionCost === 'reaction') {
      if (!nextBudget.reactionAvailable) {
        throw new Error(`Reaction not available for "${actor.name}"`);
      }
      nextBudget.reactionAvailable = false;
    }
  }

  // 3. Resource Cost deduction
  if (ability.resourceCost && nextActor.characterSheet?.resources) {
    const resId = ability.resourceCost.resourceId;
    const pool = nextActor.characterSheet.resources[resId];
    if (pool) {
      if (pool.available < ability.resourceCost.amount) {
        throw new Error(`Insufficient resource "${resId}" for "${actor.name}" (${pool.available} < ${ability.resourceCost.amount})`);
      }
      pool.available -= ability.resourceCost.amount;
      pool.spent = (pool.spent ?? 0) + ability.resourceCost.amount;
    }
  }

  events.push({
    type: 'ACTION_USED',
    actorId: actor.id,
    actionName: 'custom',
    cost: ability.actionCost === 'bonus_action' ? 'bonus_action' : ability.actionCost === 'reaction' ? 'free' : 'action',
  });

  // 4. Resolve targets
  let resolvedTargetIds: string[] = [];
  if (ability.targeting?.type === 'self') {
    resolvedTargetIds = [actorId];
  } else if (options.targetIds && options.targetIds.length > 0) {
    resolvedTargetIds = [...options.targetIds];
  } else if (options.targetId) {
    resolvedTargetIds = [options.targetId];
  } else {
    resolvedTargetIds = [actorId];
  }

  const formulaVars = {
    '@classLevel': nextActor.characterSheet?.classes?.[0]?.level ?? 1,
    '@charLevel': nextActor.characterSheet?.totalLevel ?? 1,
    '@strMod': nextActor.strengthModifier ?? 0,
    '@dexMod': nextActor.dexterityModifier ?? 0,
    '@conMod': nextActor.characterSheet?.abilities?.con ? Math.floor((nextActor.characterSheet.abilities.con.score - 10) / 2) : 0,
    '@chaMod': nextActor.characterSheet?.abilities?.cha ? Math.floor((nextActor.characterSheet.abilities.cha.score - 10) / 2) : 0,
    '@wisMod': nextActor.characterSheet?.abilities?.wis ? Math.floor((nextActor.characterSheet.abilities.wis.score - 10) / 2) : 0,
    '@intMod': nextActor.characterSheet?.abilities?.int ? Math.floor((nextActor.characterSheet.abilities.int.score - 10) / 2) : 0,
    '@prof': nextActor.characterSheet?.proficiencyBonus ?? 2,
    '@spellSaveDC': nextActor.characterSheet?.spellcasting?.classes?.[0]?.spellSaveDc ?? 13,
  };

  // 5. Execute effect steps on targets
  function executeSteps(steps: EffectStepSpec[], target: Combatant): void {
    for (const step of steps) {
      if (step.step === 'apply_active_effect') {
        if (step.effectId === 'disengaged' && target.id === actorId && nextBudget) {
          nextBudget.disengaged = true;
        }
        const currentEffects = target.activeEffects ? [...target.activeEffects] : [];
        const newEff = {
          effectId: step.effectId,
          name: step.name,
          requiresConcentration: step.requiresConcentration,
          remainingRounds: step.durationRounds,
          modifiers: step.modifiers,
        };
        const updatedEffects = [...currentEffects.filter((e) => e.effectId !== step.effectId), newEff];
        target.activeEffects = updatedEffects;
        combatantsMap[target.id] = { ...target, activeEffects: updatedEffects };
      } else if (step.step === 'heal') {
        const rollRes = rollDamage(rng, step.diceFormula, { context: formulaVars });
        rng = rollRes.nextState;
        const healApplied = applyHealing({
          state: { ...state, combatants: combatantsMap },
          targetId: target.id,
          amount: rollRes.total,
          sourceName: ability!.name,
        });
        combatantsMap[target.id] = healApplied.state.combatants[target.id]!;
        events.push(...healApplied.events);
      } else if (step.step === 'grant_temp_hp') {
        const rollRes = rollDamage(rng, step.amountFormula, { context: formulaVars });
        rng = rollRes.nextState;
        target.tempHp = Math.max(target.tempHp, rollRes.total);
        combatantsMap[target.id] = { ...target };
      } else if (step.step === 'apply_condition') {
        const condRes = applyConditionToCombatant(target, step.conditionId, {
          sourceId: ability!.id,
          sourceName: ability!.name,
          sourceEntityId: actor.id,
          durationRounds: step.durationRounds,
        });
        combatantsMap[target.id] = condRes.combatant;
        events.push(...condRes.events);
      } else if (step.step === 'deal_damage') {
        const dmgRoll = rollDamage(rng, step.diceFormula, { context: formulaVars });
        rng = dmgRoll.nextState;
        const dmgApplied = applyDamage({
          state: { ...state, rngState: rng, combatants: combatantsMap },
          targetId: target.id,
          rawAmount: dmgRoll.total,
          damageType: step.damageType,
          attackerId: actor.id,
          sourceName: ability!.name,
          isMagical: step.isMagical,
        });
        rng = dmgApplied.state.rngState;
        combatantsMap[target.id] = dmgApplied.state.combatants[target.id]!;
        events.push(...dmgApplied.events);
      } else if (step.step === 'saving_throw') {
        const bonus = getTargetSavingThrowBonus(target, step.ability);
        const d20 = rollD20(rng, { modifier: bonus, mode: 'normal' });
        rng = d20.nextState;
        const dc = parseInt(step.dcFormula, 10) || 13;
        const passed = d20.total >= dc;
        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: target.id,
          ability: step.ability,
          dc,
          roll: d20.naturalRoll,
          total: d20.total,
          outcome: passed ? 'success' : 'failure',
          sourceSpellOrAbilityName: ability!.name,
        });
        const followSteps = passed ? (step.onSuccess ?? []) : step.onFail;
        executeSteps(followSteps, target);
      } else if (step.step === 'manual_adjudication') {
        // Tier C fallback for class features: surface an adjudication card
        // instead of silently skipping an effect the engine cannot automate.
        events.push({
          type: 'MANUAL_ADJUDICATION_REQUIRED',
          actorId: actor.id,
          sourceName: ability!.name,
          adjudicationId: step.adjudicationId,
          title: step.title,
          guidance: step.guidance,
          ...(step.suggestedRoll ? { suggestedRoll: step.suggestedRoll } : {}),
          targetId: target.id,
        });
      }
    }
  }

  combatantsMap[nextActor.id] = nextActor;
  for (const tid of resolvedTargetIds) {
    const t = combatantsMap[tid];
    if (t && !t.isDead) {
      executeSteps(ability.effects, t);
    }
  }

  const victory = evaluateCombatVictory(combatantsMap);
  const nextState: CombatState = {
    ...state,
    turnBudget: nextBudget,
    combatants: combatantsMap,
    rngState: rng,
    outcome: victory,
    phase: victory !== 'in_progress' ? 'combat_ended' : state.phase,
  };

  return {
    state: nextState,
    events,
    abilityName: ability.name,
  };
}
