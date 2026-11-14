import { rollD20, rollDamage } from '../dice/evaluator.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import { executeWeaponAttack } from './attack.js';
import { applyConditionToCombatant } from './conditions.js';
import { applyDamage } from './damage.js';
import { evaluateCombatVictory } from './state-machine.js';
import { getTargetSavingThrowBonus } from './spellcasting.js';
import { spendAction, spendBonusAction } from './turn-budget.js';
import type { CombatEvent, CombatState } from './types.js';

export interface ExecuteMonsterActionOptions {
  state: CombatState;
  attackerId: string;
  actionId: string;
  targetId?: string;
  targetIds?: string[];
  originCell?: GridPoint;
  grid?: TacticalGrid;
  skipReactionPrompts?: boolean;
}

export interface MonsterActionResult {
  state: CombatState;
  events: CombatEvent[];
  actionName: string;
  executedSubActions?: string[];
}

/**
 * Executes a Monster Action according to SRD 5.1 rules:
 * - Multiattack sequences (resolves each sub-action).
 * - Attack rolls (delegates to executeWeaponAttack).
 * - Saving throws and AOE/utility monster actions (e.g., Harpy Luring Song).
 */
export function executeMonsterAction(options: ExecuteMonsterActionOptions): MonsterActionResult {
  const { state, attackerId, actionId, targetId, targetIds, originCell, grid, skipReactionPrompts } = options;
  const attacker = state.combatants[attackerId];
  if (!attacker) {
    throw new Error(`Attacker "${attackerId}" not found in combatants`);
  }
  if (!attacker.monsterData) {
    throw new Error(`Combatant "${attacker.name}" does not have monsterData`);
  }

  const action = attacker.monsterData.actions.find((a) => a.id === actionId);
  if (!action) {
    throw new Error(`Monster action "${actionId}" not found on monster "${attacker.name}"`);
  }

  const events: CombatEvent[] = [];
  let currentState = state;

  // 1. Handle Multiattack sequence
  if (action.multiattack && action.multiattack.sequence.length > 0) {
    const executedSubActions: string[] = [];
    const chosenTargetId = targetId ?? targetIds?.[0];
    if (!chosenTargetId) {
      throw new Error(`Target required for multiattack by "${attacker.name}"`);
    }

    const totalAttacks = action.multiattack.sequence.reduce((acc, it) => acc + it.count, 0);
    const originalAttacksPerAction = attacker.attacksPerAction;

    if (currentState.turnBudget && currentState.activeCombatantId === attackerId) {
      currentState = {
        ...currentState,
        combatants: {
          ...currentState.combatants,
          [attackerId]: {
            ...currentState.combatants[attackerId]!,
            attacksPerAction: totalAttacks,
          },
        },
      };
    }

    for (const item of action.multiattack.sequence) {
      for (let i = 0; i < item.count; i++) {
        const currentTarget = currentState.combatants[chosenTargetId];
        if (!currentTarget || currentTarget.isDead || currentTarget.currentHp <= 0) {
          break;
        }

        const subRes = executeWeaponAttack({
          state: currentState,
          attackerId,
          targetId: chosenTargetId,
          monsterActionId: item.actionId,
          grid,
          skipReactionPrompts,
        });
        currentState = subRes.state;
        events.push(...subRes.events);
        executedSubActions.push(item.actionId);
      }
    }

    // Restore original attacksPerAction and clear any dangling extraAttacksRemaining
    if (currentState.combatants[attackerId]) {
      currentState = {
        ...currentState,
        combatants: {
          ...currentState.combatants,
          [attackerId]: {
            ...currentState.combatants[attackerId]!,
            attacksPerAction: originalAttacksPerAction,
          },
        },
      };
    }
    if (currentState.turnBudget && currentState.activeCombatantId === attackerId) {
      currentState = {
        ...currentState,
        turnBudget: {
          ...currentState.turnBudget,
          extraAttacksRemaining: 0,
        },
      };
    }

    return {
      state: currentState,
      events,
      actionName: action.name,
      executedSubActions,
    };
  }

  // 2. Handle single Attack Roll action
  if (action.effects.some((e) => e.step === 'attack_roll')) {
    const chosenTargetId = targetId ?? targetIds?.[0];
    if (!chosenTargetId) {
      throw new Error(`Target required for action "${action.name}" by "${attacker.name}"`);
    }

    const attackRes = executeWeaponAttack({
      state: currentState,
      attackerId,
      targetId: chosenTargetId,
      monsterActionId: actionId,
      grid,
      skipReactionPrompts,
    });
    return {
      state: attackRes.state,
      events: attackRes.events,
      actionName: action.name,
    };
  }

  // 3. Handle saving throw / area of effect actions
  let combatantsMap = { ...currentState.combatants };
  let rng = currentState.rngState;

  if (currentState.turnBudget && currentState.activeCombatantId === attackerId) {
    if (action.actionCost === 'action') {
      currentState = { ...currentState, turnBudget: spendAction(currentState.turnBudget) };
    } else if (action.actionCost === 'bonus_action') {
      currentState = { ...currentState, turnBudget: spendBonusAction(currentState.turnBudget) };
    }
  }

  const resolvedTargets = targetIds ?? (targetId ? [targetId] : []);
  for (const tid of resolvedTargets) {
    const target = combatantsMap[tid];
    if (!target || target.isDead || target.currentHp <= 0) continue;

    for (const step of action.effects) {
      if (step.step === 'saving_throw') {
        const bonus = getTargetSavingThrowBonus(target, step.ability);
        const d20 = rollD20(rng, { modifier: bonus, mode: 'normal' });
        rng = d20.nextState;
        const dc = parseInt(step.dcFormula, 10) || 10;
        const passed = d20.total >= dc;
        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: target.id,
          ability: step.ability,
          dc,
          roll: d20.naturalRoll,
          total: d20.total,
          outcome: passed ? 'success' : 'failure',
          sourceSpellOrAbilityName: action.name,
        });

        const followSteps = passed ? (step.onSuccess ?? []) : step.onFail;
        for (const sub of followSteps) {
          if (sub.step === 'apply_condition') {
            const condRes = applyConditionToCombatant(target, sub.conditionId, {
              sourceId: attacker.id,
              sourceName: action.name,
              sourceEntityId: attacker.id,
              durationRounds: sub.durationRounds,
            });
            combatantsMap[target.id] = condRes.combatant;
            events.push(...condRes.events);
          } else if (sub.step === 'deal_damage') {
            const dmgRoll = rollDamage(rng, sub.diceFormula);
            rng = dmgRoll.nextState;
            const dmgApplied = applyDamage({
              state: { ...currentState, rngState: rng, combatants: combatantsMap },
              targetId: target.id,
              rawAmount: dmgRoll.total,
              damageType: sub.damageType,
              attackerId: attacker.id,
              sourceName: action.name,
            });
            rng = dmgApplied.state.rngState;
            combatantsMap[target.id] = dmgApplied.state.combatants[target.id]!;
            events.push(...dmgApplied.events);
          }
        }
      }
    }
  }

  const victory = evaluateCombatVictory(combatantsMap);
  const nextState: CombatState = {
    ...currentState,
    combatants: combatantsMap,
    rngState: rng,
    outcome: victory,
    phase: victory !== 'in_progress' ? 'combat_ended' : currentState.phase,
  };

  return {
    state: nextState,
    events,
    actionName: action.name,
  };
}
