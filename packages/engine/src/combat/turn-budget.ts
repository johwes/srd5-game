import type { ConditionId } from '@srd5/data';
import type { Combatant, TurnBudget } from './types.js';
import {
  INCAPACITATING_CONDITIONS,
  IMMOBILIZING_CONDITIONS,
  isIncapacitated,
  isImmobilized,
  getConditionSpeed,
} from './conditions.js';

export {
  INCAPACITATING_CONDITIONS,
  IMMOBILIZING_CONDITIONS,
  isIncapacitated,
  isImmobilized,
};

/**
 * Initializes a new TurnBudget for a combatant at the beginning of their turn.
 * Follows SRD 5.1 rules for Incapacitation, Surprise, and Speed modifiers.
 */
export function createTurnBudget(combatant: Combatant, isSurprised = false): TurnBudget {
  const incapacitated = isIncapacitated(combatant);

  // If surprised or incapacitated, creature cannot take actions or move on its turn
  if (isSurprised || incapacitated) {
    return {
      action: 0,
      bonusAction: 0,
      reactionAvailable: false,
      movementRemainingFeet: 0,
      freeObjectInteraction: 0,
      bonusActionSpellCast: false,
      leveledActionSpellCast: false,
      attackActionTaken: false,
      extraAttacksRemaining: 0,
      disengaged: false,
      dodging: false,
    };
  }

  // Speed is 0 if immobilized or exhaustion level 5; halved if exhaustion level 2..4
  const movementRemainingFeet = getConditionSpeed(combatant);

  return {
    action: 1,
    bonusAction: 1,
    reactionAvailable: true,
    movementRemainingFeet,
    freeObjectInteraction: 1,
    bonusActionSpellCast: false,
    leveledActionSpellCast: false,
    attackActionTaken: false,
    extraAttacksRemaining: 0,
    disengaged: false,
    dodging: false,
  };
}

/**
 * Spends 1 main Action from the budget. Throws if no action is available.
 */
export function spendAction(budget: TurnBudget): TurnBudget {
  if (budget.action <= 0) {
    throw new Error('No actions remaining this turn');
  }
  return {
    ...budget,
    action: budget.action - 1,
  };
}

/**
 * Spends 1 Bonus Action from the budget. Throws if no bonus action is available.
 */
export function spendBonusAction(budget: TurnBudget): TurnBudget {
  if (budget.bonusAction <= 0) {
    throw new Error('No bonus actions remaining this turn');
  }
  return {
    ...budget,
    bonusAction: budget.bonusAction - 1,
  };
}

/**
 * Spends Reaction from the budget.
 */
export function spendReaction(budget: TurnBudget): TurnBudget {
  if (!budget.reactionAvailable) {
    throw new Error('Reaction is already spent');
  }
  return {
    ...budget,
    reactionAvailable: false,
  };
}

/**
 * Deducts movement feet from remaining budget.
 */
export function spendMovement(budget: TurnBudget, feet: number): TurnBudget {
  if (feet < 0) {
    throw new Error('Movement deduction cannot be negative');
  }
  if (budget.movementRemainingFeet < feet) {
    throw new Error(
      `Not enough movement remaining: requested ${feet} ft, have ${budget.movementRemainingFeet} ft`,
    );
  }
  return {
    ...budget,
    movementRemainingFeet: budget.movementRemainingFeet - feet,
  };
}

/**
 * Spends 1 free object interaction.
 */
export function spendFreeObjectInteraction(budget: TurnBudget): TurnBudget {
  if (budget.freeObjectInteraction <= 0) {
    throw new Error('Free object interaction already used this turn');
  }
  return {
    ...budget,
    freeObjectInteraction: budget.freeObjectInteraction - 1,
  };
}

/**
 * Fighter: Action Surge grants +1 Action to the budget.
 */
export function applyActionSurge(budget: TurnBudget): TurnBudget {
  return {
    ...budget,
    action: budget.action + 1,
  };
}

/**
 * Applies the Dash action: increases remaining movement by speedFeet.
 */
export function applyDash(
  budget: TurnBudget,
  speedFeet: number,
  asBonusAction = false,
): TurnBudget {
  const next = asBonusAction ? spendBonusAction(budget) : spendAction(budget);
  return {
    ...next,
    movementRemainingFeet: next.movementRemainingFeet + speedFeet,
  };
}

/**
 * Applies the Disengage action: movement does not provoke opportunity attacks this turn.
 */
export function applyDisengage(budget: TurnBudget, asBonusAction = false): TurnBudget {
  const next = asBonusAction ? spendBonusAction(budget) : spendAction(budget);
  return {
    ...next,
    disengaged: true,
  };
}

/**
 * Applies the Dodge action: attacks against have disadvantage until start of next turn.
 */
export function applyDodge(budget: TurnBudget): TurnBudget {
  const next = spendAction(budget);
  return {
    ...next,
    dodging: true,
  };
}

/**
 * Standing up from Prone: costs half maximum speed (Spec 03 Section 3.2).
 */
export function applyStandUp(budget: TurnBudget, speedFeet: number): TurnBudget {
  if (speedFeet <= 0) {
    throw new Error('Cannot stand up with a speed of 0');
  }
  const cost = Math.floor(speedFeet / 2);
  if (budget.movementRemainingFeet < cost) {
    throw new Error(
      `Cannot stand up: requires ${cost} ft of movement, but only ${budget.movementRemainingFeet} ft remaining`,
    );
  }
  return spendMovement(budget, cost);
}

/**
 * Spends 1 attack from the budget.
 * If extra attacks from the Attack action are available, consumes 1 extra attack.
 * Otherwise, spends 1 main Action, marks attackActionTaken, and sets extraAttacksRemaining.
 */
export function spendAttack(budget: TurnBudget, attacksPerAction = 1): TurnBudget {
  if (budget.extraAttacksRemaining > 0) {
    return {
      ...budget,
      extraAttacksRemaining: budget.extraAttacksRemaining - 1,
    };
  }
  if (budget.action <= 0) {
    throw new Error('No actions remaining this turn to take the Attack action');
  }
  return {
    ...budget,
    action: budget.action - 1,
    attackActionTaken: true,
    extraAttacksRemaining: Math.max(0, attacksPerAction - 1),
  };
}

/**
 * Spends 1 bonus action for a Two-Weapon Fighting off-hand attack.
 * Enforces the SRD 5.1 rule that the Attack action must already have been taken this turn.
 */
export function spendTwoWeaponFightingBonusAttack(budget: TurnBudget): TurnBudget {
  if (!budget.attackActionTaken) {
    throw new Error('Two-Weapon Fighting bonus attack requires taking the Attack action first');
  }
  if (budget.bonusAction <= 0) {
    throw new Error('No bonus action remaining this turn');
  }
  return {
    ...budget,
    bonusAction: budget.bonusAction - 1,
  };
}

export type SpellCastingTime = 'action' | 'bonus_action' | 'reaction';

export interface SpellCastCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates whether casting a spell is permitted under the SRD 5.1 Bonus Action spellcasting rule:
 * - If a bonus action spell was cast this turn, only cantrips with casting time of 1 action can be cast.
 * - If a leveled 1-action spell was cast this turn, bonus action spells are prohibited.
 */
export function canCastSpell(
  budget: TurnBudget,
  castingTime: SpellCastingTime,
  isCantrip: boolean,
): SpellCastCheckResult {
  if (castingTime === 'bonus_action') {
    if (budget.bonusAction <= 0) {
      return { allowed: false, reason: 'No bonus action remaining' };
    }
    if (budget.leveledActionSpellCast) {
      return {
        allowed: false,
        reason: 'Cannot cast a bonus action spell after casting a leveled 1-action spell on the same turn',
      };
    }
    return { allowed: true };
  }

  if (castingTime === 'action') {
    if (budget.action <= 0) {
      return { allowed: false, reason: 'No action remaining' };
    }
    if (budget.bonusActionSpellCast && !isCantrip) {
      return {
        allowed: false,
        reason: 'SRD 5.1 Bonus Action Rule: Only cantrips with a casting time of 1 action can be cast after casting a bonus action spell',
      };
    }
    return { allowed: true };
  }

  if (castingTime === 'reaction') {
    if (!budget.reactionAvailable) {
      return { allowed: false, reason: 'Reaction is not available' };
    }
    if (budget.bonusActionSpellCast) {
      return {
        allowed: false,
        reason: 'SRD 5.1 Bonus Action Rule: Reaction spells cannot be cast during your own turn if you cast a bonus action spell',
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Updates the budget when a spell is successfully cast.
 */
export function recordSpellCast(
  budget: TurnBudget,
  castingTime: SpellCastingTime,
  isCantrip: boolean,
): TurnBudget {
  const check = canCastSpell(budget, castingTime, isCantrip);
  if (!check.allowed) {
    throw new Error(check.reason ?? 'Spell casting disallowed');
  }

  if (castingTime === 'bonus_action') {
    const afterAction = spendBonusAction(budget);
    return {
      ...afterAction,
      bonusActionSpellCast: true,
    };
  }

  if (castingTime === 'action') {
    const afterAction = spendAction(budget);
    return {
      ...afterAction,
      leveledActionSpellCast: !isCantrip || afterAction.leveledActionSpellCast,
    };
  }

  // reaction
  return spendReaction(budget);
}
