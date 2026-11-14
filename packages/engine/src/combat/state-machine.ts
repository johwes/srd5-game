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
import { executeDeathSave } from './damage.js';
import {
  resolveConditionTurnEndSaves,
  canFrightenedCreatureMove,
} from './conditions.js';
import {
  triggerHazardZonesAtTurnStart,
  triggerHazardZonesOnMove,
  tickHazardZones,
  isCellInHazardDifficultTerrain,
} from './hazard-zone.js';
import { tickConcentration } from './concentration.js';
import {
  computeStepCostFeet,
  isFootprintStepDifficultTerrain,
} from '../grid/pathfinding.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';

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
    const deathSaveRes = executeDeathSave({
      state: {
        ...state,
        rngState: currentState,
        combatants: {
          ...state.combatants,
          [combatantId]: updatedCombatant,
        },
      },
      combatantId,
    });
    currentState = deathSaveRes.state.rngState;
    events.push(...deathSaveRes.events);
    updatedCombatant = deathSaveRes.state.combatants[combatantId]!;

    if (updatedCombatant.isDead) {
      return endTurn(
        {
          ...deathSaveRes.state,
          activeCombatantId: combatantId,
        },
        events,
      );
    }
  }

  let intermediateState: CombatState = {
    ...state,
    rngState: currentState,
    combatants: {
      ...state.combatants,
      [combatantId]: updatedCombatant,
    },
  };

  // Trigger Hazard Zones covering combatant at start of turn
  if (!updatedCombatant.isDead && intermediateState.hazardZones) {
    const hzRes = triggerHazardZonesAtTurnStart(intermediateState, combatantId);
    intermediateState = hzRes.state;
    currentState = intermediateState.rngState;
    events.push(...hzRes.events);
    updatedCombatant = intermediateState.combatants[combatantId]!;
    if (updatedCombatant.isDead) {
      return endTurn(
        {
          ...intermediateState,
          activeCombatantId: combatantId,
        },
        events,
      );
    }
  }

  // Create Turn Budget
  const turnBudget = createTurnBudget(updatedCombatant, updatedCombatant.isSurprised);

  events.push({
    type: 'TURN_STARTED',
    entityId: updatedCombatant.id,
    round: state.round,
  });

  const nextCombatants = {
    ...intermediateState.combatants,
    [combatantId]: updatedCombatant,
  };

  const nextState: CombatState = {
    ...intermediateState,
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
 * - Resolves end-of-turn repeat saves on active conditions
 * - Ticks down hazard zones and concentration
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
  let nextHazardZones = state.hazardZones;
  let currentState = state.rngState;

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

    // 1. Condition turn-end saves (e.g. repeat saves against web, hold person, etc.)
    const turnEndSaveRes = resolveConditionTurnEndSaves(
      {
        ...state,
        rngState: currentState,
        combatants: nextCombatants,
        hazardZones: nextHazardZones,
      },
      activeId,
    );
    nextCombatants = turnEndSaveRes.state.combatants;
    currentState = turnEndSaveRes.state.rngState;
    events.push(...turnEndSaveRes.events);

    // 2. Tick hazard zones owned by active combatant
    const hzTickRes = tickHazardZones(
      {
        ...state,
        rngState: currentState,
        combatants: nextCombatants,
        hazardZones: nextHazardZones,
      },
      activeId,
    );
    nextHazardZones = hzTickRes.state.hazardZones;
    events.push(...hzTickRes.events);

    // 3. Tick concentration of active combatant
    const concTickRes = tickConcentration(
      {
        ...hzTickRes.state,
        rngState: currentState,
        combatants: nextCombatants,
        hazardZones: nextHazardZones,
      },
      activeId,
    );
    nextCombatants = concTickRes.state.combatants;
    nextHazardZones = concTickRes.state.hazardZones;
    events.push(...concTickRes.events);
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
        hazardZones: nextHazardZones,
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
    hazardZones: nextHazardZones,
    rngState: currentState,
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

export interface ExecuteMoveCombatantOptions {
  actorId: string;
  path: GridPoint[];
  grid?: TacticalGrid | undefined;
}

/**
 * Moves a combatant along a path on the grid during their active turn:
 * - Checks frightened movement restrictions (cannot move closer to source of fear).
 * - Computes movement cost accounting for difficult terrain from grid and active hazard zones.
 * - Deducts feet from turn budget.
 * - Updates combatant position.
 * - Emits ENTITY_MOVED.
 * - Checks and triggers any active hazard zones entered along the movement path.
 */
export function executeMoveCombatant(
  state: CombatState,
  options: ExecuteMoveCombatantOptions,
): CombatTransitionResult {
  const { actorId, path, grid } = options;
  if (state.activeCombatantId !== actorId) {
    throw new Error(`It is not ${actorId}'s turn`);
  }
  if (!state.turnBudget) {
    throw new Error('No active turn budget');
  }
  const mover = state.combatants[actorId];
  if (!mover || mover.isDead) {
    throw new Error(`Mover "${actorId}" not found or dead`);
  }
  if (path.length === 0) {
    return { state, events: [] };
  }

  // Frightened condition check: cannot willingly move closer to source of fear
  if (mover.conditions.includes('frightened') && mover.frightenedByEntityId) {
    const fearSource = state.combatants[mover.frightenedByEntityId];
    if (fearSource) {
      let currentPos = mover.position;
      for (const step of path) {
        if (!canFrightenedCreatureMove(mover, fearSource.position, currentPos, step)) {
          throw new Error('A frightened creature cannot willingly move closer to the source of its fear');
        }
        currentPos = step;
      }
    }
  }

  // Compute movement cost step-by-step
  let totalCostFeet = 0;
  let prevPos = mover.position;
  const isProne = mover.conditions.includes('prone');

  for (const step of path) {
    const isDifficult =
      (grid && isFootprintStepDifficultTerrain(grid, { id: mover.id, x: step.x, y: step.y, size: mover.size }, step)) ||
      isCellInHazardDifficultTerrain(state.hazardZones, step);

    const stepResult = computeStepCostFeet({
      from: prevPos,
      to: step,
      difficultTerrain: Boolean(isDifficult),
      isProne,
    });
    totalCostFeet += stepResult.stepCostFeet;
    prevPos = step;
  }

  if (totalCostFeet > state.turnBudget.movementRemainingFeet) {
    throw new Error(
      `Not enough movement remaining (requires ${totalCostFeet} ft, has ${state.turnBudget.movementRemainingFeet} ft)`,
    );
  }

  let currentState = state;
  const events: CombatEvent[] = [];

  const finalPos = path[path.length - 1]!;
  const nextBudget = spendMovement(state.turnBudget, totalCostFeet);

  const updatedMover: Combatant = {
    ...mover,
    position: finalPos,
  };

  currentState = {
    ...currentState,
    turnBudget: nextBudget,
    combatants: {
      ...currentState.combatants,
      [actorId]: updatedMover,
    },
  };

  events.push({
    type: 'ENTITY_MOVED',
    entityId: actorId,
    path,
    mode: 'walk',
  });

  // Check and trigger hazard zones entered along path
  let currentPos = mover.position;
  for (const step of path) {
    const hzMoveRes = triggerHazardZonesOnMove(currentState, actorId, currentPos, step);
    currentState = hzMoveRes.state;
    events.push(...hzMoveRes.events);
    currentPos = step;
  }

  return { state: currentState, events };
}
