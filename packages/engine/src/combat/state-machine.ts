import type { ConditionId } from '@srd5/data';
import { rollD20 } from '../dice/evaluator.js';
import type {
  CombatEvent,
  CombatState,
  CombatVictoryOutcome,
  Combatant,
} from './types.js';
import {
  findNextActiveCombatantIndex,
  isCombatantEligibleForTurn,
  rollInitiativeForCombatants,
} from './initiative.js';
import {
  determineSurprise,
  type MonsterAmbushInput,
  type PartyStealthInput,
} from './surprise.js';
import {
  applyActionSurge,
  applyDash,
  applyDisengage,
  applyDodge,
  applyStandUp,
  createTurnBudget,
  spendMovement,
} from './turn-budget.js';

export interface StartCombatEncounterOptions {
  encounterId: string;
  combatants: Combatant[];
  rngState: number;
  partyStealth?: PartyStealthInput;
  monsterAmbush?: MonsterAmbushInput;
  explicitSurprisedEntityIds?: string[];
}

export interface CombatTransitionResult {
  state: CombatState;
  events: CombatEvent[];
}

/**
 * Checks whether combat has reached an end state (party wiped or all monsters defeated).
 */
export function evaluateCombatVictory(
  combatants: Record<string, Combatant>,
): CombatVictoryOutcome {
  const partyList = Object.values(combatants).filter((c) => c.side === 'party');
  const monsterList = Object.values(combatants).filter((c) => c.side === 'monster');

  // Party defeated if all party members are dead or defeated
  const allPartyDefeated =
    partyList.length > 0 &&
    partyList.every((p) => p.isDead || p.deathSaves.failures >= 3);

  // Monsters defeated if all monsters are at 0 HP or dead
  const allMonstersDefeated =
    monsterList.length > 0 &&
    monsterList.every((m) => m.isDead || m.currentHp <= 0);

  if (allPartyDefeated && allMonstersDefeated) {
    return 'draw';
  }
  if (allMonstersDefeated) {
    return 'party_victory';
  }
  if (allPartyDefeated) {
    return 'monsters_victory';
  }

  return 'in_progress';
}

/**
 * Initializes and starts a tactical combat encounter:
 * 1. Evaluates surprise (SRD 5.1).
 * 2. Rolls initiative for all participants with PRNG tiebreaking.
 * 3. Starts Round 1 and the first active turn.
 */
export function startCombatEncounter(
  options: StartCombatEncounterOptions,
): CombatTransitionResult {
  const { encounterId, combatants, rngState, partyStealth, monsterAmbush, explicitSurprisedEntityIds } =
    options;

  const events: CombatEvent[] = [];
  let currentState = rngState;

  // 1. Determine Surprise
  const surpriseRes = determineSurprise({
    combatants,
    rngState: currentState,
    partyStealth,
    monsterAmbush,
    explicitSurprisedEntityIds,
  });
  currentState = surpriseRes.nextRngState;
  events.push(...surpriseRes.events);

  const surprisedLookup = new Set<string>(surpriseRes.surprisedEntityIds);

  // Clone combatants map and apply surprise flag
  const combatantMap: Record<string, Combatant> = {};
  for (const c of combatants) {
    const isSurprised = surprisedLookup.has(c.id);
    combatantMap[c.id] = {
      ...c,
      isSurprised,
    };
  }

  // 2. Roll Initiative
  const initRes = rollInitiativeForCombatants(Object.values(combatantMap), currentState);
  currentState = initRes.nextRngState;
  events.push(...initRes.events);

  events.push({
    type: 'COMBAT_STARTED',
    encounterId,
    initiativeOrder: initRes.entries.map((e) => ({
      entityId: e.entityId,
      initiative: e.initiative,
    })),
  });

  events.push({
    type: 'ROUND_STARTED',
    round: 1,
  });

  const baseState: CombatState = {
    encounterId,
    round: 1,
    phase: 'active_turn',
    initiativeOrder: initRes.entries,
    activeCombatantIndex: 0,
    activeCombatantId: initRes.entries[0]?.entityId ?? null,
    turnBudget: null,
    combatants: combatantMap,
    surprisedCombatantIds: surpriseRes.surprisedEntityIds,
    outcome: 'in_progress',
    rngState: currentState,
  };

  // 3. Start turn for the first combatant
  if (baseState.activeCombatantId) {
    return startTurn(baseState, baseState.activeCombatantId, events);
  }

  return { state: baseState, events };
}

/**
 * Handles Start-of-Turn lifecycle for an active combatant:
 * - Clears lingering effects (Dodge)
 * - Executes Death Save if at 0 HP (and not dead/stable)
 * - Initializes turn budget
 * - Emits TURN_STARTED
 */
export function startTurn(
  state: CombatState,
  combatantId: string,
  accumulatedEvents: CombatEvent[] = [],
): CombatTransitionResult {
  const events = [...accumulatedEvents];
  let currentState = state.rngState;

  const currentCombatant = state.combatants[combatantId];
  if (!currentCombatant || !isCombatantEligibleForTurn(currentCombatant)) {
    // If not eligible, skip to next turn
    return endTurn(state, events);
  }

  // Clear Dodge condition / state from previous turn (SRD 5.1 Dodge ends at start of next turn)
  let updatedCombatant: Combatant = {
    ...currentCombatant,
    isDodging: false,
  };

  // If at 0 HP and not stable, roll start-of-turn Death Saving Throw
  if (
    updatedCombatant.currentHp === 0 &&
    !updatedCombatant.isDead &&
    !updatedCombatant.isStable &&
    updatedCombatant.side === 'party'
  ) {
    const d20Res = rollD20(currentState);
    currentState = d20Res.nextState;

    const roll = d20Res.naturalRoll;
    let deathSaves = { ...updatedCombatant.deathSaves };
    let currentHp = 0;
    let isDead = false;
    let isStable = false;
    let outcome: 'success' | 'failure' | 'revived' | 'dead';
    let conditions = [...updatedCombatant.conditions];

    if (roll === 1) {
      // Nat 1: 2 failures
      deathSaves.failures += 2;
      if (deathSaves.failures >= 3) {
        isDead = true;
        outcome = 'dead';
      } else {
        outcome = 'failure';
      }
    } else if (roll < 10) {
      // 2..9: 1 failure
      deathSaves.failures += 1;
      if (deathSaves.failures >= 3) {
        isDead = true;
        outcome = 'dead';
      } else {
        outcome = 'failure';
      }
    } else if (roll < 20) {
      // 10..19: 1 success
      deathSaves.successes += 1;
      if (deathSaves.successes >= 3) {
        isStable = true;
      }
      outcome = 'success';
    } else {
      // Nat 20: Regain 1 HP immediately, wake up!
      currentHp = 1;
      deathSaves = { successes: 0, failures: 0 };
      conditions = conditions.filter((c) => c !== 'unconscious');
      outcome = 'revived';
      events.push({
        type: 'CONDITION_REMOVED',
        targetId: updatedCombatant.id,
        conditionId: 'unconscious' as ConditionId,
      });
    }

    updatedCombatant = {
      ...updatedCombatant,
      currentHp,
      deathSaves,
      isDead,
      isStable,
      conditions,
    };

    events.push({
      type: 'DEATH_SAVE_ROLLED',
      entityId: updatedCombatant.id,
      roll,
      outcome,
      deathSaves,
      currentHp,
    });
  }

  // Create Turn Budget
  const turnBudget = createTurnBudget(updatedCombatant, updatedCombatant.isSurprised);

  events.push({
    type: 'TURN_STARTED',
    entityId: updatedCombatant.id,
    round: state.round,
  });

  const nextCombatants = {
    ...state.combatants,
    [combatantId]: updatedCombatant,
  };

  const nextState: CombatState = {
    ...state,
    activeCombatantId: combatantId,
    turnBudget,
    combatants: nextCombatants,
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
  };
}

/**
 * Ends the active combatant's turn and advances the combat state:
 * - Emits TURN_ENDED
 * - Clears surprise if combatant was surprised (surprise ends at the end of first turn)
 * - Checks victory / defeat conditions
 * - Advances to the next eligible combatant in initiative order (incrementing round if wrapped)
 */
export function endTurn(
  state: CombatState,
  accumulatedEvents: CombatEvent[] = [],
): CombatTransitionResult {
  const events = [...accumulatedEvents];
  const activeId = state.activeCombatantId;

  let nextCombatants = { ...state.combatants };

  if (activeId && nextCombatants[activeId]) {
    const activeCombatant = nextCombatants[activeId]!;
    events.push({
      type: 'TURN_ENDED',
      entityId: activeId,
      round: state.round,
    });

    // If surprised, surprise ends at the end of their first turn (SRD 5.1)
    if (activeCombatant.isSurprised) {
      nextCombatants[activeId] = {
        ...activeCombatant,
        isSurprised: false,
      };
      events.push({
        type: 'SURPRISE_ENDED',
        entityId: activeId,
      });
    }
  }

  // Check victory / defeat
  const victoryOutcome = evaluateCombatVictory(nextCombatants);
  if (victoryOutcome !== 'in_progress') {
    events.push({
      type: 'ENCOUNTER_VICTORY',
      outcome: victoryOutcome,
      round: state.round,
    });

    return {
      state: {
        ...state,
        phase: 'combat_ended',
        outcome: victoryOutcome,
        combatants: nextCombatants,
        turnBudget: null,
      },
      events,
    };
  }

  // Find next eligible combatant
  const nextInfo = findNextActiveCombatantIndex(
    state.initiativeOrder,
    nextCombatants,
    state.activeCombatantIndex,
  );

  if (!nextInfo) {
    // No eligible combatants left
    return {
      state: {
        ...state,
        phase: 'combat_ended',
        outcome: 'draw',
        combatants: nextCombatants,
        turnBudget: null,
      },
      events,
    };
  }

  let nextRound = state.round;
  if (nextInfo.wrapped) {
    nextRound += 1;
    events.push({
      type: 'ROUND_STARTED',
      round: nextRound,
    });
  }

  const nextActiveEntry = state.initiativeOrder[nextInfo.nextIndex]!;
  const advancedState: CombatState = {
    ...state,
    round: nextRound,
    activeCombatantIndex: nextInfo.nextIndex,
    activeCombatantId: nextActiveEntry.entityId,
    combatants: nextCombatants,
    turnBudget: null,
  };

  return startTurn(advancedState, nextActiveEntry.entityId, events);
}

/**
 * Standard turn action helpers that validate and update active turn budget.
 */
export function executeDash(
  state: CombatState,
  actorId: string,
  asBonusAction = false,
): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }
  const combatant = state.combatants[actorId];
  if (!combatant) {
    throw new Error(`Combatant ${actorId} not found`);
  }

  const nextBudget = applyDash(state.turnBudget, combatant.speedFeet, asBonusAction);
  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId,
      actionName: 'dash',
      cost: asBonusAction ? 'bonus_action' : 'action',
      movementCostFeet: 0,
    },
  ];

  return {
    state: {
      ...state,
      turnBudget: nextBudget,
    },
    events,
  };
}

export function executeDisengage(
  state: CombatState,
  actorId: string,
  asBonusAction = false,
): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }

  const nextBudget = applyDisengage(state.turnBudget, asBonusAction);
  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId,
      actionName: 'disengage',
      cost: asBonusAction ? 'bonus_action' : 'action',
    },
  ];

  return {
    state: {
      ...state,
      turnBudget: nextBudget,
    },
    events,
  };
}

export function executeDodge(state: CombatState, actorId: string): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }

  const nextBudget = applyDodge(state.turnBudget);
  const combatant = state.combatants[actorId];
  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId,
      actionName: 'dodge',
      cost: 'action',
    },
  ];

  return {
    state: {
      ...state,
      turnBudget: nextBudget,
      combatants: {
        ...state.combatants,
        ...(combatant ? { [actorId]: { ...combatant, isDodging: true } } : {}),
      },
    },
    events,
  };
}

export function executeStandUp(state: CombatState, actorId: string): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }
  const combatant = state.combatants[actorId];
  if (!combatant) {
    throw new Error(`Combatant ${actorId} not found`);
  }

  const nextBudget = applyStandUp(state.turnBudget, combatant.speedFeet);
  const cost = Math.floor(combatant.speedFeet / 2);

  // Remove prone condition if present
  const nextConditions = combatant.conditions.filter((c) => c !== 'prone');
  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId,
      actionName: 'stand_up',
      cost: 'movement',
      movementCostFeet: cost,
    },
  ];

  if (combatant.conditions.includes('prone')) {
    events.push({
      type: 'CONDITION_REMOVED',
      targetId: actorId,
      conditionId: 'prone' as ConditionId,
    });
  }

  return {
    state: {
      ...state,
      turnBudget: nextBudget,
      combatants: {
        ...state.combatants,
        [actorId]: {
          ...combatant,
          conditions: nextConditions,
        },
      },
    },
    events,
  };
}

export function executeActionSurge(state: CombatState, actorId: string): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }

  const nextBudget = applyActionSurge(state.turnBudget);
  const events: CombatEvent[] = [
    {
      type: 'ACTION_USED',
      actorId,
      actionName: 'action_surge',
      cost: 'free',
    },
  ];

  return {
    state: {
      ...state,
      turnBudget: nextBudget,
    },
    events,
  };
}

export function executeSpendMovement(
  state: CombatState,
  actorId: string,
  feet: number,
): CombatTransitionResult {
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }

  const nextBudget = spendMovement(state.turnBudget, feet);
  return {
    state: {
      ...state,
      turnBudget: nextBudget,
    },
    events: [],
  };
}
