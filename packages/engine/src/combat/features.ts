import type { ActivatedAbilitySpec, EffectStepSpec } from '@srd5/data';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { applyConditionToCombatant } from './conditions.js';
import { applyDamage, applyHealing } from './damage.js';
import { evaluateCombatVictory } from './state-machine.js';
import { getTargetSavingThrowBonus } from './spellcasting.js';
import { applyActionSurge } from './turn-budget.js';
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
  if (!ability && actor.characterSheet?.activatedAbilities) {
    // Player characters carry their class/racial activated abilities on the
    // derived sheet (e.g. Second Wind, Rage, Cunning Action). The
    // USE_CLASS_FEATURE command only carries the ability id, so resolve here
    // instead of requiring callers to pass the full spec.
    ability = actor.characterSheet.activatedAbilities.find((a) => a.id === abilityId);
  }

  if (!ability) {
    throw new Error(`Activated ability "${abilityId}" not found on "${actor.name}"`);
  }

  const events: CombatEvent[] = [];
  let combatantsMap: Record<string, Combatant> = { ...state.combatants };
  let rng = state.rngState;
  let nextActor = { ...actor };

  // 2. Action Budget deduction
  // SRD 5.1: 'action' consumes the main action, 'bonus_action' the bonus
  // action, 'reaction' the reaction. 'free', 'special', and 'movement'
  // cost no budget (free = e.g. Action Surge trigger, Indomitable reroll
  // hook; special = declared as part of another action, e.g. Divine Smite,
  // Reckless Attack, Stunning Strike).
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
    // 'free' | 'special' | 'movement' intentionally spend no budget here.
  }

  // 3. Resource Cost deduction
  // Track ids already charged via resourceCost so an embedded
  // `spend_resource` effect step for the same pool does not double-spend
  // (e.g. Action Surge declares both resourceCost and a spend_resource step).
  const resourcesChargedViaCost = new Set<string>();
  if (ability.resourceCost && nextActor.characterSheet?.resources) {
    const resId = ability.resourceCost.resourceId;
    const pool = nextActor.characterSheet.resources[resId];
    if (pool) {
      if (pool.available < ability.resourceCost.amount) {
        throw new Error(`Insufficient resource "${resId}" for "${actor.name}" (${pool.available} < ${ability.resourceCost.amount})`);
      }
      pool.available -= ability.resourceCost.amount;
      pool.spent = (pool.spent ?? 0) + ability.resourceCost.amount;
      resourcesChargedViaCost.add(`${resId}:${ability.resourceCost.amount}`);
    }
  }

  // SRD 5.1 Action Surge: triggering the feature costs no action itself but
  // grants one additional action on top of the regular action this turn.
  // This handles the USE_CLASS_FEATURE ('use-action-surge') path; the
  // USE_STANDARD_ACTION ('action_surge') path grants via executeActionSurge.
  if (abilityId === 'use-action-surge' || ability.id === 'use-action-surge') {
    if (nextBudget) {
      nextBudget = applyActionSurge(nextBudget);
    }
  }

  const economyCostForEvent =
    ability.actionCost === 'bonus_action'
      ? 'bonus_action'
      : ability.actionCost === 'reaction'
        ? 'reaction'
        : ability.actionCost === 'free'
          ? 'free'
          : ability.actionCost === 'special'
            ? 'special'
            : ability.actionCost === 'movement'
              ? 'movement'
              : 'action';
  events.push({
    type: 'ACTION_USED',
    actorId: actor.id,
    actionName: 'custom',
    cost: economyCostForEvent,
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
      } else if (step.step === 'spend_resource') {
        // Declarative resource spend (e.g. Action Surge's embedded
        // spend_resource step). Skip when the same pool/amount was already
        // charged via resourceCost above to avoid double-spending.
        const chargeKey = `${step.resourceId}:${step.amount}`;
        if (!resourcesChargedViaCost.has(chargeKey) && nextActor.characterSheet?.resources) {
          const pool = nextActor.characterSheet.resources[step.resourceId];
          if (pool) {
            if (pool.available < step.amount) {
              throw new Error(`Insufficient resource "${step.resourceId}" for "${actor.name}"`);
            }
            pool.available -= step.amount;
            pool.spent = (pool.spent ?? 0) + step.amount;
            resourcesChargedViaCost.add(chargeKey);
          }
        }
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
