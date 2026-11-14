import {
  type Combatant,
  type CombatEvent,
  type CombatState,
} from '../combat/types.js';
import {
  startCombatEncounter,
  endTurn,
  executeDash,
  executeDisengage,
  executeDodge,
  executeStandUp,
  executeActionSurge,
  executeMoveCombatant,
} from '../combat/state-machine.js';
import { executeWeaponAttack, executeGrapple, executeShove } from '../combat/attack.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeActivatedAbility } from '../combat/features.js';
import { resolveReactionPrompt } from '../combat/reactions.js';
import { breakConcentration } from '../combat/concentration.js';
import { applyDamage } from '../combat/damage.js';
import { rollDamage } from '../dice/evaluator.js';
import {
  type GridPoint,
  type TacticalGrid,
  getGridCell,
  setGridCell,
  isCellPassable,
} from '../grid/model.js';
import { hasLineOfSight } from '../grid/vision.js';
import { calculateMarchingMovements } from '../dungeon/marching-order.js';
import { updateDungeonRoomDiscovery } from '../dungeon/state.js';
import {
  checkPassivePerceptionForProps,
  triggerTrapEffect,
  resolveActiveSearch,
  resolvePropInteraction,
} from '../dungeon/props.js';
import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type InteractiveProp,
  type PlayerSlotAssignment,
} from './types.js';

export interface ReduceGameResult {
  nextState: GameState;
  events: GameEvent[];
}

/**
 * Creates a clean default GameState.
 */
export function createInitialGameState(options: {
  id?: string;
  grid: TacticalGrid;
  party: Combatant[];
  monsters?: Combatant[];
  props?: InteractiveProp[];
  slots?: PlayerSlotAssignment[];
  rngState?: number;
}): GameState {
  const partyMap: Record<string, Combatant> = {};
  for (const p of options.party) {
    partyMap[p.id] = { ...p, side: 'party' };
  }

  const monstersMap: Record<string, Combatant> = {};
  if (options.monsters) {
    for (const m of options.monsters) {
      monstersMap[m.id] = { ...m, side: 'monster' };
    }
  }

  const slots = options.slots ?? [
    {
      playerId: 'player-1',
      displayName: 'Party Leader',
      controlledCharacterIds: options.party.map((p) => p.id),
    },
  ];

  const initialState: GameState = {
    id: options.id ?? `game-${Date.now()}`,
    mode: 'exploration',
    grid: options.grid,
    combat: null,
    party: partyMap,
    monsters: monstersMap,
    props: options.props ? structuredClone(options.props) : [],
    lightSources: [],
    exploredCells: {},
    slots,
    rngState: options.rngState ?? 123456789,
  };

  // Pre-seed explored cells from initial party positions
  return updateExploredCells(initialState);
}

/**
 * Updates exploredCells based on the current party positions and grid visibility.
 */
export function updateExploredCells(state: GameState): GameState {
  const nextExplored = { ...state.exploredCells };
  const observers = Object.values(state.combat?.combatants ?? state.party).filter(
    (c) => c.side === 'party' && !c.isDead && c.currentHp > 0 && !c.conditions.includes('blinded'),
  );

  if (observers.length === 0) {
    return state;
  }

  for (const cell of state.grid.cells) {
    const key = `${cell.x},${cell.y}`;
    if (nextExplored[key]) continue;

    for (const obs of observers) {
      if (
        hasLineOfSight(
          state.grid,
          { id: obs.id, x: obs.position.x, y: obs.position.y, size: obs.size },
          { x: cell.x, y: cell.y, size: 'medium' },
        )
      ) {
        nextExplored[key] = true;
        break;
      }
    }
  }

  return {
    ...state,
    exploredCells: nextExplored,
  };
}

/**
 * Authoritative GameState Reducer.
 * Dispatches serializable GameCommands and yields deterministic state transitions & events.
 */
export function reduceGame(state: GameState, command: GameCommand): ReduceGameResult {
  const events: GameEvent[] = [];
  let nextState: GameState = structuredClone(state);

  switch (command.type) {
    case 'START_COMBAT': {
      const combatantsList =
        command.combatants ??
        [...Object.values(nextState.party), ...Object.values(nextState.monsters)];

      const transition = startCombatEncounter({
        encounterId: command.encounterId ?? `encounter-${Date.now()}`,
        combatants: combatantsList,
        rngState: command.rngState ?? nextState.rngState,
        dispositionMatrix: command.dispositionMatrix,
      });

      nextState.mode = 'combat';
      nextState.combat = transition.state;
      nextState.rngState = transition.state.rngState;

      // Sync combatants back into party and monsters
      for (const [id, c] of Object.entries(transition.state.combatants)) {
        if (c.side === 'party') {
          nextState.party[id] = c;
        } else if (c.side === 'monster') {
          nextState.monsters[id] = c;
        }
      }

      events.push({
        type: 'MODE_CHANGED',
        fromMode: state.mode,
        toMode: 'combat',
      });
      events.push(...transition.events);
      break;
    }

    case 'COMBAT_MOVE': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute COMBAT_MOVE outside active combat');
      }

      const res = executeMoveCombatant(nextState.combat, {
        actorId: command.actorId,
        path: command.path,
        grid: nextState.grid,
      });
      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;

      const updated = res.state.combatants[command.actorId];
      if (updated) {
        if (updated.side === 'party') nextState.party[command.actorId] = updated;
        else nextState.monsters[command.actorId] = updated;
      }

      events.push(...res.events);
      break;
    }

    case 'DECLARE_ATTACK': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute DECLARE_ATTACK outside active combat');
      }

      const attacker = nextState.combat.combatants[command.actorId];
      const monsterAction = attacker?.monsterData?.actions?.find((a) => a.id === command.monsterActionId);
      let res: { state: CombatState; events: CombatEvent[] };

      if (monsterAction?.multiattack && monsterAction.multiattack.sequence.length > 0) {
        res = executeMonsterAction({
          state: nextState.combat,
          attackerId: command.actorId,
          actionId: command.monsterActionId!,
          targetId: command.targetId,
          grid: nextState.grid,
        });
      } else {
        res = executeWeaponAttack({
          state: nextState.combat,
          attackerId: command.actorId,
          targetId: command.targetId,
          attackProfileId: command.attackProfileId,
          monsterActionId: command.monsterActionId,
          versatileTwoHanded: command.twoHanded,
          isOffHand: command.isOffHand,
          grid: nextState.grid,
        });
      }

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;

      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'EXECUTE_MONSTER_ACTION': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute EXECUTE_MONSTER_ACTION outside active combat');
      }

      const res = executeMonsterAction({
        state: nextState.combat,
        attackerId: command.actorId,
        actionId: command.actionId,
        targetId: command.targetId,
        targetIds: command.targetIds,
        originCell: command.targetCell,
        grid: nextState.grid,
      });

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;

      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'DECLARE_CAST_SPELL': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute DECLARE_CAST_SPELL outside active combat');
      }

      const res = executeSpellCast({
        state: nextState.combat,
        casterId: command.actorId,
        spellId: command.spellId,
        slotLevel: command.slotLevel,
        targetIds: command.targetIds,
        originCell: command.targetCell,
        grid: nextState.grid,
      });

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;

      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'USE_STANDARD_ACTION': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute USE_STANDARD_ACTION outside active combat');
      }

      let res: { state: CombatState; events: CombatEvent[] };
      switch (command.action) {
        case 'dash':
          res = executeDash(nextState.combat, command.actorId);
          break;
        case 'disengage':
          res = executeDisengage(nextState.combat, command.actorId, command.asBonusAction);
          break;
        case 'dodge':
          res = executeDodge(nextState.combat, command.actorId);
          break;
        case 'stand_up':
          res = executeStandUp(nextState.combat, command.actorId);
          break;
        case 'action_surge':
          res = executeActionSurge(nextState.combat, command.actorId);
          break;
        case 'drop_concentration': {
          const concRes = breakConcentration(nextState.combat, command.actorId, 'manual');
          res = { state: concRes.state, events: concRes.events };
          break;
        }
        case 'help':
        case 'hide':
        case 'search': {
          res = {
            state: nextState.combat,
            events: [
              {
                type: 'ACTION_USED',
                actorId: command.actorId,
                actionName: command.action as any,
                cost: 'action',
              },
            ],
          };
          break;
        }
        default:
          throw new Error(`Unsupported standard action: ${(command as any).action}`);
      }

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      const updated = res.state.combatants[command.actorId];
      if (updated) {
        if (updated.side === 'party') nextState.party[command.actorId] = updated;
        else nextState.monsters[command.actorId] = updated;
      }

      events.push(...res.events);
      break;
    }

    case 'USE_GRAPPLE_OR_SHOVE': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute USE_GRAPPLE_OR_SHOVE outside active combat');
      }

      let res: { state: CombatState; events: CombatEvent[] };
      if (command.mode === 'grapple') {
        res = executeGrapple({
          state: nextState.combat,
          attackerId: command.actorId,
          targetId: command.targetId,
        });
      } else {
        res = executeShove({
          state: nextState.combat,
          attackerId: command.actorId,
          targetId: command.targetId,
          shoveType: command.mode === 'shove_prone' ? 'knock_prone' : 'push_away',
        });
      }

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'USE_CLASS_FEATURE': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute USE_CLASS_FEATURE outside active combat');
      }

      const res = executeActivatedAbility({
        state: nextState.combat,
        actorId: command.actorId,
        abilityId: command.featureId,
        targetId: command.targetIds?.[0],
        targetIds: command.targetIds,
        originCell: command.targetCell,
        grid: nextState.grid,
      });

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'RESOLVE_REACTION_PROMPT': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute RESOLVE_REACTION_PROMPT outside active combat');
      }

      const res = resolveReactionPrompt(nextState.combat, {
        promptId: command.promptId,
        reactorEntityId: command.reactorId,
        decision: command.decision,
      });

      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'END_TURN': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute END_TURN outside active combat');
      }

      const res = endTurn(nextState.combat);
      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }

      events.push(...res.events);
      break;
    }

    case 'SET_MARCHING_ORDER': {
      const partyIds = Object.keys(nextState.party);
      const current = nextState.marchingOrder ?? {
        order: partyIds,
        formation: 'single_file',
        leadExplorerId: partyIds[0] ?? 'hero-1',
      };
      const order = command.marchingOrder ?? current.order;
      const formation = command.formation ?? current.formation;
      const leadExplorerId = command.leadExplorerId ?? current.leadExplorerId;

      nextState.marchingOrder = {
        order,
        formation,
        leadExplorerId,
      };

      events.push({
        type: 'MARCHING_ORDER_CHANGED',
        order,
        formation,
        leadExplorerId,
      });
      break;
    }

    case 'EXPLORE_MOVE': {
      const actor = nextState.party[command.actorId];
      if (!actor) {
        throw new Error(`Exploration actor not found in party: ${command.actorId}`);
      }
      if (command.path.length === 0) {
        break;
      }

      const startPos = { ...actor.position };
      const isLead = nextState.marchingOrder?.leadExplorerId === command.actorId;
      const followMarchingOrder = command.followMarchingOrder ?? isLead;

      const executedPath: GridPoint[] = [];
      let movementHalted = false;
      let haltReason: 'trap_detected' | 'trap_triggered' | 'obstacle' | null = null;
      let haltPoint: GridPoint = startPos;

      for (const pt of command.path) {
        const cell = getGridCell(nextState.grid, pt.x, pt.y);
        if (!cell || !isCellPassable(cell)) {
          movementHalted = true;
          haltReason = 'obstacle';
          break;
        }

        // Advance actor position for this step
        executedPath.push(pt);
        actor.position = { x: pt.x, y: pt.y };
        haltPoint = pt;

        // Check passive perception detection against hidden props (Spec 04 Section 3.1)
        const observers = Object.values(nextState.party).filter(
          (c) => !c.isDead && c.currentHp > 0 && !c.conditions.includes('blinded'),
        );
        const passiveRes = checkPassivePerceptionForProps({
          grid: nextState.grid,
          observers,
          props: nextState.props,
        });
        events.push(...passiveRes.events);

        if (passiveRes.haltedByTrap) {
          movementHalted = true;
          haltReason = 'trap_detected';
          break;
        }

        // Check if actor stepped on an active (closed) trap
        const activeTrap = nextState.props.find(
          (p) => p.kind === 'trap' && p.x === pt.x && p.y === pt.y && p.state === 'closed',
        );
        if (activeTrap) {
          const trapRes = triggerTrapEffect({
            trap: activeTrap,
            target: actor,
            rngState: nextState.rngState,
          });
          nextState.rngState = trapRes.nextRngState;
          events.push(...trapRes.events);

          movementHalted = true;
          haltReason = 'trap_triggered';
          break;
        }
      }

      if (executedPath.length > 0) {
        events.push({
          type: 'ENTITY_MOVED',
          entityId: command.actorId,
          path: executedPath,
          mode: 'walk',
        });
      }

      if (movementHalted && haltReason) {
        events.push({
          type: 'MOVEMENT_HALTED',
          actorId: command.actorId,
          reason: haltReason,
          at: haltPoint,
        });
      }

      // If marching order is active, move followers
      if (followMarchingOrder && executedPath.length > 0 && nextState.marchingOrder) {
        const marchingPlan = calculateMarchingMovements({
          grid: nextState.grid,
          party: nextState.party,
          marchingOrder: nextState.marchingOrder,
          leadStartPos: startPos,
          leadActualPath: executedPath,
        });

        for (const fMove of marchingPlan.followerMovements) {
          const follower = nextState.party[fMove.actorId];
          if (!follower) continue;

          follower.position = { x: fMove.to.x, y: fMove.to.y };
          events.push({
            type: 'ENTITY_MOVED',
            entityId: fMove.actorId,
            path: fMove.path,
            mode: 'walk',
          });

          // Check if follower stepped on an active trap
          for (const cellPt of fMove.path) {
            const trap = nextState.props.find(
              (p) => p.kind === 'trap' && p.x === cellPt.x && p.y === cellPt.y && p.state === 'closed',
            );
            if (trap) {
              const trapRes = triggerTrapEffect({
                trap,
                target: follower,
                rngState: nextState.rngState,
              });
              nextState.rngState = trapRes.nextRngState;
              events.push(...trapRes.events);
              break;
            }
          }
        }
      }

      // Check room entry events for any party member whose room changed
      for (const member of Object.values(nextState.party)) {
        const memberCell = getGridCell(nextState.grid, member.position.x, member.position.y);
        if (memberCell?.roomId && memberCell.roomId !== member.roomId) {
          events.push({
            type: 'ROOM_ENTERED',
            actorId: member.id,
            roomId: memberCell.roomId,
            prevRoomId: member.roomId,
          });
          member.roomId = memberCell.roomId;
        }
      }

      break;
    }

    case 'INTERACT_PROP': {
      const interactionRes = resolvePropInteraction({
        state: nextState,
        actorId: command.actorId,
        propId: command.propId,
        interaction: command.interaction,
      });
      nextState = interactionRes.nextState;
      events.push(...interactionRes.events);
      break;
    }

    case 'EXPLORE_SEARCH': {
      const searchRes = resolveActiveSearch({
        state: nextState,
        actorId: command.actorId,
      });
      nextState = searchRes.nextState;
      events.push(...searchRes.events);
      break;
    }

    case 'START_REST': {
      const hpRecovered: Record<string, number> = {};
      for (const [id, char] of Object.entries(nextState.party)) {
        if (command.restType === 'long') {
          const diff = char.maxHp - char.currentHp;
          char.currentHp = char.maxHp;
          char.deathSaves = { successes: 0, failures: 0 };
          char.isDead = false;
          char.isStable = false;
          hpRecovered[id] = diff;
        } else {
          // Short rest recovery
          const spendCount = command.hitDiceToSpend?.[id] ?? 0;
          const recovered = Math.min(spendCount * 7, char.maxHp - char.currentHp);
          char.currentHp += recovered;
          hpRecovered[id] = recovered;
        }
      }
      events.push({
        type: 'REST_COMPLETED',
        restType: command.restType,
        hpRecovered,
      });
      break;
    }

    case 'EQUIP_LOADOUT':
    case 'UPDATE_PREPARED_SPELLS':
    case 'LEVEL_UP_CHARACTER': {
      // Progression commands - will update character sheets in party
      break;
    }
  }

  // Update Fog of War explored cells after action execution
  nextState = updateExploredCells(nextState);

  // Update multi-room discovery if dungeon floor is active
  if (nextState.dungeon) {
    const discovery = updateDungeonRoomDiscovery(nextState);
    nextState = discovery.nextState;
    events.push(...discovery.events);
  }

  return { nextState, events };
}
