import type { ConditionId } from '@srd5/data';
import { rollD20 } from '../dice/evaluator.js';
import type {
  CombatEvent,
  CombatState,
  CombatVictoryOutcome,
  Combatant,
} from './types.js';
import { areHostile, type DispositionMatrix } from './allegiance.js';
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
  runSummonTriggersAtTurnStart,
  tickSummonsForRound,
  triggerSummonsOnMove,
} from './summon.js';
import {
  computeStepCostFeet,
  isFootprintStepDifficultTerrain,
  type GridCreature,
} from '../grid/pathfinding.js';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import {
  detectOpportunityAttackTrigger,
  spendCombatantReaction,
} from './reactions.js';
import { executeWeaponAttack } from './attack.js';
import { isIncapacitated } from './turn-budget.js';

export interface StartCombatEncounterOptions {
  encounterId: string;
  combatants: Combatant[];
  rngState: number;
  partyStealth?: PartyStealthInput;
  monsterAmbush?: MonsterAmbushInput;
  explicitSurprisedEntityIds?: string[];
  dispositionMatrix?: DispositionMatrix;
  /** SRD-512: dungeon props; hideSpot furniture grants Stealth advantage. */
  props?: ReadonlyArray<{ x: number; y: number; hideSpot?: boolean }>;
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
  matrix?: DispositionMatrix,
): CombatVictoryOutcome {
  const partyList = Object.values(combatants).filter((c) => (c.teamId ?? c.side) === 'party');
  const monsterList = Object.values(combatants).filter((c) => (c.teamId ?? c.side) !== 'party');

  const allPartyDefeated =
    partyList.length > 0 &&
    partyList.every((p) => p.isDead || p.deathSaves.failures >= 3);

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

  // Generalized multi-team hostility check
  const activeLiving = Object.values(combatants).filter(
    (c) => !c.isDead && c.currentHp > 0 && c.deathSaves.failures < 3,
  );
  if (activeLiving.length > 0) {
    const hasHostilesRemaining = activeLiving.some((c1) =>
      activeLiving.some((c2) => c1.id !== c2.id && areHostile(c1, c2, matrix)),
    );
    if (!hasHostilesRemaining) {
      const anyParty = activeLiving.some((c) => (c.teamId ?? c.side) === 'party');
      return anyParty ? 'party_victory' : 'monsters_victory';
    }
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

  // Filter out pre-dead participants (corpses from prior encounters must
  // never re-enter initiative) — party members at 0 HP without 3 death
  // failures stay eligible so they can roll death saves on their turn.
  const eligibleCombatants = combatants.filter(
    (c) =>
      !c.isDead &&
      c.deathSaves.failures < 3 &&
      !(c.side === 'monster' && c.currentHp <= 0),
  );

  // 1. Determine Surprise
  const surpriseRes = determineSurprise({
    combatants: eligibleCombatants,
    rngState: currentState,
    partyStealth,
    monsterAmbush,
    explicitSurprisedEntityIds,
    hideoutPositions: (options.props ?? [])
      .filter((p) => p.hideSpot === true)
      .map((p) => ({ x: p.x, y: p.y })),
  });
  currentState = surpriseRes.nextRngState;
  events.push(...surpriseRes.events);

  const surprisedLookup = new Set<string>(surpriseRes.surprisedEntityIds);

  // Clone combatants map and apply surprise flag
  const combatantMap: Record<string, Combatant> = {};
  for (const c of eligibleCombatants) {
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
    dispositionMatrix: options.dispositionMatrix,
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

  // Expire summons whose duration elapsed at this round boundary and reset
  // per-turn trigger tracking before any turn-start hooks fire (Spec 08 §4.3).
  const summonTick = tickSummonsForRound(state, state.round);
  if (summonTick.events.length > 0) {
    events.push(...summonTick.events);
    state = summonTick.state;
    currentState = state.rngState;
  }

  const currentCombatant = state.combatants[combatantId];
  if (!currentCombatant || !isCombatantEligibleForTurn(currentCombatant)) {
    // If not eligible, skip to next turn
    return endTurn(state, events);
  }

  // Reset reaction for turn start & clear Dodge (ends at start of next turn)
  const canReact = !currentCombatant.isSurprised && !isIncapacitated(currentCombatant);
  let updatedCombatant: Combatant = {
    ...currentCombatant,
    isDodging: false,
    reactionAvailable: canReact,
  };

  // Expire Shield spell buff at the start of reactor's next turn (SRD 5.1)
  if (updatedCombatant.activeEffects?.some((e) => e.effectId === 'shield_ac_buff' || e.effectId === 'shield')) {
    const nextEffects = updatedCombatant.activeEffects.filter(
      (e) => e.effectId !== 'shield_ac_buff' && e.effectId !== 'shield',
    );
    let nextSheet = updatedCombatant.characterSheet;
    if (nextSheet) {
      nextSheet = {
        ...nextSheet,
        armorClass: {
          ...nextSheet.armorClass,
          totalAc: Math.max(10, nextSheet.armorClass.totalAc - 5),
        },
      };
    }
    updatedCombatant = {
      ...updatedCombatant,
      armorClass: Math.max(10, updatedCombatant.armorClass - 5),
      activeEffects: nextEffects,
      characterSheet: nextSheet,
    };
  }

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

  // If the combatant is still unconscious at 0 HP (did not roll a Nat 20 to
  // wake up at 1 HP, or is already stabilized at 0 HP), they have no actions
  // or movement to take — automatically advance to the next combatant as long
  // as someone else in initiative can still act (prevents infinite recursion).
  if (
    updatedCombatant.currentHp <= 0 &&
    !updatedCombatant.isDead &&
    updatedCombatant.side === 'party'
  ) {
    const nextCombatantsMap = {
      ...state.combatants,
      [combatantId]: updatedCombatant,
    };
    const someoneElseCanAct = state.initiativeOrder.some((entry) => {
      if (entry.entityId === combatantId) return false;
      const other = nextCombatantsMap[entry.entityId];
      return Boolean(other && !other.isDead && other.currentHp > 0);
    });
    if (someoneElseCanAct) {
      return endTurn(
        {
          ...state,
          rngState: currentState,
          combatants: nextCombatantsMap,
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

  // Autonomous summon hooks (hound bark/bite/leash) fire at the caster's turn start.
  const summonTriggerRes = runSummonTriggersAtTurnStart(intermediateState, combatantId);
  intermediateState = summonTriggerRes.state;
  currentState = intermediateState.rngState;
  events.push(...summonTriggerRes.events);
  updatedCombatant = intermediateState.combatants[combatantId] ?? updatedCombatant;
  if (updatedCombatant.isDead) {
    return endTurn(
      {
        ...intermediateState,
        activeCombatantId: combatantId,
      },
      events,
    );
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
        reactionAvailable: true,
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
  skipReactionPrompts?: boolean;
}

/**
 * Moves a combatant along a path on the grid during their active turn:
 * - Checks frightened movement restrictions (cannot move closer to source of fear).
 * - Checks Opportunity Attacks on each step exiting hostile reach.
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

  const isProne = mover.conditions.includes('prone');
  let costSoFar = 0;
  let currentPos = mover.position;
  let currentState = state;
  const events: CombatEvent[] = [];

  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    // Paths from findPath/truncatePathToBudget are start-inclusive; skip
    // no-op entries already at the current position so the origin cell is
    // never charged as a 5-ft step (preview parity: evaluatePath semantics).
    if (step.x === currentPos.x && step.y === currentPos.y) {
      continue;
    }
    const occupiers: GridCreature[] = Object.values(currentState.combatants)
      .filter((c) => c.id !== actorId && !c.isDead && c.currentHp > 0)
      .map((c) => ({
        id: c.id,
        x: c.position.x,
        y: c.position.y,
        size: c.size,
      }));
    const moverForTerrain: GridCreature = {
      id: mover.id,
      x: currentPos.x,
      y: currentPos.y,
      size: mover.size,
      isProne,
    };
    const isDifficult =
      (grid &&
        isFootprintStepDifficultTerrain(grid, moverForTerrain, step, occupiers)) ||
      isCellInHazardDifficultTerrain(currentState.hazardZones, step);

    const stepResult = computeStepCostFeet({
      from: currentPos,
      to: step,
      difficultTerrain: Boolean(isDifficult),
      isProne,
    });

    if (costSoFar + stepResult.stepCostFeet > state.turnBudget.movementRemainingFeet) {
      throw new Error(
        `Not enough movement remaining (requires ${costSoFar + stepResult.stepCostFeet} ft, has ${state.turnBudget.movementRemainingFeet} ft)`,
      );
    }

    // Opportunity Attack check on this step exiting hostile reach
    if (!options.skipReactionPrompts) {
      const oaRes = detectOpportunityAttackTrigger(currentState, actorId, currentPos, step, grid);
      if (oaRes) {
        if (oaRes.reactor.side === 'monster') {
          // AI monster takes Opportunity Attack
          const spentRes = spendCombatantReaction(currentState, oaRes.reactor.id);
          currentState = spentRes.state;

          const oaAttackRes = executeWeaponAttack({
            state: currentState,
            attackerId: oaRes.reactor.id,
            targetId: actorId,
            isReaction: true,
            skipReactionPrompts: true,
            grid,
          });
          currentState = oaAttackRes.state;
          events.push(...oaAttackRes.events);

          const liveMover = currentState.combatants[actorId];
          if (!liveMover || liveMover.isDead || liveMover.currentHp <= 0 || isIncapacitated(liveMover)) {
            // Mover halted at currentPos before leaving reach!
            const nextBudget = spendMovement(currentState.turnBudget!, costSoFar);
            const haltedMover: Combatant = {
              ...(liveMover ?? mover),
              position: currentPos,
            };
            return {
              state: {
                ...currentState,
                turnBudget: nextBudget,
                combatants: {
                  ...currentState.combatants,
                  [actorId]: haltedMover,
                },
              },
              events,
            };
          }
        } else {
          // Player hero reaction prompt: pause execution!
          const nextBudget = spendMovement(currentState.turnBudget!, costSoFar);
          const pausedMover: Combatant = {
            ...mover,
            position: currentPos,
          };
          const promptState: CombatState = {
            ...currentState,
            phase: 'reaction_prompt',
            turnBudget: nextBudget,
            combatants: {
              ...currentState.combatants,
              [actorId]: pausedMover,
            },
            pendingReactionPrompt: oaRes.prompt,
            reactionInterruptContext: {
              type: 'movement',
              actorId,
              fullPath: path,
              completedPath: path.slice(0, i),
              currentStepIndex: i,
              spentMovementFeet: costSoFar,
              remainingPath: path.slice(i),
              stepFrom: currentPos,
              stepTo: step,
            },
          };
          events.push({
            type: 'REACTION_PROMPTED',
            prompt: oaRes.prompt,
          });
          return {
            state: promptState,
            events,
          };
        }
      }
    }

    costSoFar += stepResult.stepCostFeet;

    // Trigger hazard zones on this step
    const hzMoveRes = triggerHazardZonesOnMove(currentState, actorId, currentPos, step);
    currentState = hzMoveRes.state;
    events.push(...hzMoveRes.events);

    // Trigger autonomous summon auras (guardian of faith) on this step
    const summonMoveRes = triggerSummonsOnMove(currentState, actorId, currentPos, step);
    currentState = summonMoveRes.state;
    events.push(...summonMoveRes.events);

    const liveMover = currentState.combatants[actorId];
    if (!liveMover || liveMover.isDead || liveMover.currentHp <= 0) {
      // Stopped in hazard zone
      const nextBudget = spendMovement(currentState.turnBudget!, costSoFar);
      return {
        state: {
          ...currentState,
          turnBudget: nextBudget,
          combatants: {
            ...currentState.combatants,
            [actorId]: {
              ...(liveMover ?? mover),
              position: step,
            },
          },
        },
        events,
      };
    }

    currentPos = step;
  }

  const finalPos = currentPos;
  const nextBudget = spendMovement(state.turnBudget, costSoFar);
  const updatedMover: Combatant = {
    ...currentState.combatants[actorId]!,
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

  return { state: currentState, events };
}
