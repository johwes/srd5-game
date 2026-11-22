import {
  type SrdCompendium,
} from '@srd5/data';
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
import { isCombatantEligibleForTurn } from '../combat/initiative.js';
import { executeWeaponAttack, executeGrapple, executeShove } from '../combat/attack.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { executeSpellCast } from '../combat/spellcasting.js';
import { executeOutOfCombatSpellCast } from '../combat/out-of-combat-casting.js';
import { executeActivatedAbility } from '../combat/features.js';
import { resolveReactionPrompt } from '../combat/reactions.js';
import { breakConcentration } from '../combat/concentration.js';
import { dismissSummon, executeSummonAction } from '../combat/summon.js';
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
  listenAtDoor,
  resolveActiveSearch,
  resolvePropInteraction,
  resolveKnockOnProp,
} from '../dungeon/props.js';
import { resolveTheftAttempt } from '../dungeon/theft.js';
import { resolveRecallAttempt } from '../dungeon/recall.js';
import {
  resolveAnimalHandlingAttempt,
  resolveCombatHide,
  resolveDiagnoseAttempt,
  resolveInsightContest,
  resolveIntimidationAttempt,
  resolveNatureLoreAttempt,
  resolvePerformanceAttempt,
  resolveStabilizeAttempt,
} from '../social/contests.js';
import { senseDetectMagic } from '../combat/marker-spells.js';
import {
  checkDungeonEncounterTriggers,
  triggerDungeonEncounter,
  transitionCombatToExploration,
} from '../dungeon/encounters.js';
import { resolveRest } from '../dungeon/rest.js';
import { claimPropLoot, claimPropLootItem, claimPropLootCoins, awardLootToCharacter } from '../dungeon/loot.js';
import {
  dropInventoryItem,
  identifyInventoryItem,
  sellInventoryItem,
  splitInventoryStack,
  transferInventoryItem,
  validateEquipLoadout,
} from '../dungeon/inventory-management.js';
import { findInventoryItemGrantingAbility, resolveUseItem } from '../dungeon/use-item.js';
import { attuneMagicItem, unattuneMagicItem } from '../character/attunement.js';
import { activateShrine } from '../dungeon/roguelite.js';
import { applyBetweenCombatLevelUp } from '../dungeon/level-up-flow.js';
import { computeDerivedCharacter } from '../character/derived.js';
import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type InteractiveProp,
  type PlayerSlotAssignment,
} from './types.js';
import { spawnWarReinforcements } from '../overworld/war-squads.js';

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
export function reduceGame(
  state: GameState,
  command: GameCommand,
  options?: { compendium?: SrdCompendium },
): ReduceGameResult {
  const events: GameEvent[] = [];
  let nextState: GameState = structuredClone(state);

  switch (command.type) {
    case 'START_COMBAT': {
      // Default roster excludes pre-dead monsters (prior-encounter corpses);
      // startCombatEncounter applies the same eligibility filter defensively.
      const combatantsList =
        command.combatants ??
        [
          ...Object.values(nextState.party),
          ...Object.values(nextState.monsters).filter((m) => !m.isDead && m.currentHp > 0),
        ];

      const transition = startCombatEncounter({
        encounterId: command.encounterId ?? `encounter-${Date.now()}`,
        combatants: combatantsList,
        rngState: command.rngState ?? nextState.rngState,
        dispositionMatrix: command.dispositionMatrix,
        props: nextState.props,
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
      // SRD-1203: out-of-combat (exploration/social) casting path for
      // non-hostile utility, buff, and healing spells. Combat casts keep the
      // initiative-bound resolver below.
      if (nextState.mode !== 'combat' || !nextState.combat) {
        // SRD-1204: Knock resolves through the prop hook (unlock + alert),
        // not the combatant-buff path — it targets a lock, not a creature.
        if (command.spellId === 'knock') {
          const caster = nextState.party[command.actorId] ?? nextState.monsters[command.actorId];
          if (!caster) throw new Error(`Caster ${command.actorId} not found`);
          const slotLevel = command.slotLevel ?? 2;
          const pool = caster.spellSlots?.[String(slotLevel)];
          if (caster.spellSlots && (!pool || pool.available <= 0)) {
            throw new Error(`No level ${slotLevel} spell slots available for ${caster.name}`);
          }
          const targetCell = command.targetCell;
          const propAtCell = targetCell
            ? nextState.props.find((p) => p.x === targetCell.x && p.y === targetCell.y)
            : nextState.props.find((p) => p.state === 'locked');
          if (!propAtCell) {
            throw new Error('Knock requires a target lock: pass targetCell of a locked door/chest/furniture');
          }
          // Expend the slot on the authoritative party copy.
          if (nextState.party[command.actorId]?.spellSlots?.[String(slotLevel)]) {
            const sp = nextState.party[command.actorId]!.spellSlots![String(slotLevel)]!;
            nextState.party[command.actorId]!.spellSlots![String(slotLevel)] = {
              ...sp,
              expended: sp.expended + 1,
              available: Math.max(0, sp.available - 1),
            };
          }
          events.push({
            type: 'SPELL_CAST',
            actorId: command.actorId,
            spellId: 'knock',
            spellName: 'Knock',
            spellLevel: 2,
            castAtLevel: slotLevel,
            actionCost: 'action',
            slotExpended: slotLevel,
            targetEntityIds: [],
          });
          const knockRes = resolveKnockOnProp({
            state: nextState,
            actorId: command.actorId,
            propId: propAtCell.id,
          });
          nextState = knockRes.nextState;
          events.push(...knockRes.events);
          break;
        }
        const res = executeOutOfCombatSpellCast({
          party: nextState.party,
          monsters: nextState.monsters,
          casterId: command.actorId,
          spellId: command.spellId,
          slotLevel: command.slotLevel,
          targetIds: command.targetIds,
          castAsRitual: command.castAsRitual,
          rngState: nextState.rngState,
          grid: nextState.grid,
        });

        nextState.party = res.party;
        nextState.monsters = res.monsters;
        nextState.rngState = res.rngState;

        events.push(...res.events);
        // SRD-1204: Detect Magic is a real sense — append the aura sweep so
        // the cast reveals (not just buffs) nearby magic.
        if (command.spellId === 'detect-magic') {
          const casterPos = nextState.party[command.actorId]?.position;
          const propAuras = (nextState.props ?? [])
            .filter((p) => {
              if (p.kind !== 'shrine' && p.trapDamageFormula === undefined) return false;
              if (!casterPos) return true;
              return Math.max(Math.abs(casterPos.x - p.x), Math.abs(casterPos.y - p.y)) * 5 <= 30;
            })
            .map((p) => ({
              kind: 'prop' as const,
              id: p.id,
              label: p.kind === 'shrine' ? `Consecrated shrine (${p.id})` : `Warded trap (${p.id})`,
            }));
          const combatLike = {
            encounterId: 'exploration',
            round: 0,
            phase: 'active_turn',
            initiativeOrder: [],
            activeCombatantIndex: 0,
            activeCombatantId: command.actorId,
            turnBudget: null,
            combatants: { ...nextState.party, ...nextState.monsters },
            surprisedCombatantIds: [],
            outcome: 'in_progress',
            rngState: nextState.rngState,
          } as never;
          const sense = senseDetectMagic(combatLike, command.actorId, { propAuras });
          events.push({
            type: 'DETECT_MAGIC_SENSED',
            observerId: command.actorId,
            rangeFeet: sense.rangeFeet,
            auraCount: sense.auraCount,
            auras: sense.auras,
          });
        }
        break;
      }

      const res = executeSpellCast({
        state: nextState.combat,
        casterId: command.actorId,
        spellId: command.spellId,
        slotLevel: command.slotLevel,
        targetIds: command.targetIds,
        originCell: command.targetCell,
        grid: nextState.grid,
        // SRD-410: self-emanation cones/lines aim by direction (e.g. Burning
        // Hands toward the picked point). Without this every cone resolves east.
        direction:
          command.directionRad !== undefined
            ? { x: Math.cos(command.directionRad), y: Math.sin(command.directionRad) }
            : undefined,
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
          res = executeDash(nextState.combat, command.actorId, command.asBonusAction ?? false);
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
        case 'hide': {
          // SRD-1208: real Stealth vs hostile passive Perception → hidden.
          const hideRes = resolveCombatHide({
            state: nextState,
            actorId: command.actorId,
            asBonusAction: command.asBonusAction ?? false,
          });
          nextState = hideRes.nextState;
          // CHECK_RESOLVED is a GameEvent (not a CombatEvent): push it now and
          // route only CombatEvents through the shared tail below.
          const combatOnly = hideRes.events.filter((e) => e.type !== 'CHECK_RESOLVED');
          events.push(...hideRes.events.filter((e) => e.type === 'CHECK_RESOLVED'));
          res = { state: nextState.combat!, events: combatOnly as CombatEvent[] };
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

      // Consumable/item-granted abilities (potions, scrolls, wands, charged
      // gear) must go through USE_ITEM so stacks are decremented and charges
      // are spent. The derived sheet merges item abilities into
      // activatedAbilities with no source tag, so without this guard a bare
      // USE_CLASS_FEATURE would trigger them for free (infinite potions).
      const featureActor = nextState.combat.combatants[command.actorId];
      const featureGrant = featureActor?.buildState
        ? findInventoryItemGrantingAbility(
            featureActor.buildState.inventory,
            command.featureId,
            options?.compendium,
          )
        : undefined;
      if (featureGrant) {
        throw new Error(
          `"${command.featureId}" is granted by ${featureGrant.itemName} — use USE_ITEM (instance ${featureGrant.instanceId}) so the stack/charge is consumed`,
        );
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

    case 'USE_ITEM': {
      const useRes = resolveUseItem(
        nextState,
        { actorId: command.actorId, itemInstanceId: command.itemInstanceId, targetId: command.targetId },
        options?.compendium,
      );
      nextState = useRes.nextState;
      events.push(...useRes.events);
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

      // In dungeon mode, if all monsters are defeated, transition back to exploration
      if (
        nextState.dungeon &&
        res.state.phase === 'combat_ended' &&
        res.state.outcome === 'party_victory'
      ) {
        const combatEndRes = transitionCombatToExploration(nextState);
        nextState = combatEndRes.nextState;
        events.push(...combatEndRes.events);
      }
      break;
    }

    case 'SPAWN_REINFORCEMENTS': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute SPAWN_REINFORCEMENTS outside active combat');
      }
      const res = spawnWarReinforcements(nextState, command.combatants, { wave: command.wave });
      nextState = res.nextState;
      events.push(...res.events);
      break;
    }

    case 'DISMISS_SUMMON': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute DISMISS_SUMMON outside active combat');
      }

      const res = dismissSummon(nextState.combat, command.actorId, {
        summonId: command.summonId,
        summonEntityId: command.summonEntityId,
      });
      nextState.combat = res.state;
      nextState.rngState = res.state.rngState;
      for (const [id, c] of Object.entries(res.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }
      // Remove despawned summons from the party/monster mirrors.
      const despawnedSummonIds = res.events
        .filter((e) => e.type === 'SUMMON_EXPIRED')
        .map((e) => (e.type === 'SUMMON_EXPIRED' ? e.entityId : ''));
      for (const id of despawnedSummonIds) {
        delete nextState.party[id];
        delete nextState.monsters[id];
      }

      events.push(...res.events);
      break;
    }

    case 'USE_SUMMON_ACTION': {
      if (nextState.mode !== 'combat' || !nextState.combat) {
        throw new Error('Cannot execute USE_SUMMON_ACTION outside active combat');
      }

      const res = executeSummonAction(nextState.combat, {
        summonId: command.actorId,
        actionId: command.actionId,
        targetId: command.targetId,
        targetIds: command.targetIds,
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
      let haltReason: 'trap_detected' | 'trap_triggered' | 'obstacle' | 'encounter_spotted' | null = null;
      let haltPoint: GridPoint = startPos;
      let spottedEncounterId: string | undefined;

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

        // Check untriggered encounters (Spec 04 Section 3.1 & SRD-503)
        const encCheck = checkDungeonEncounterTriggers(nextState);
        if (encCheck.triggered) {
          movementHalted = true;
          haltReason = 'encounter_spotted';
          spottedEncounterId = encCheck.encounterId;
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

      // If an unspawned encounter was spotted during movement, transition to combat now
      if (spottedEncounterId) {
        const triggerRes = triggerDungeonEncounter(nextState, spottedEncounterId);
        nextState = triggerRes.nextState;
        events.push(...triggerRes.events);
      }

      break;
    }

    case 'INTERACT_PROP': {
      const targetProp = nextState.props.find((p) => p.id === command.propId);
      if (targetProp && targetProp.kind === 'shrine') {
        const dummyRun = {
          runId: 'shrine_use',
          seed: nextState.rngState,
          currentDepth: 1,
          maxDepthReached: 1,
          party: nextState.party,
          suppliesRemaining: 10,
          goldCollected: 0,
          monstersSlain: 0,
          totalXp: 0,
          turnsTaken: 0,
          shrineBlessings: [],
          activeCurses: [],
          restCount: { short: 0, long: 0 },
          score: 0,
          isComplete: false,
        };
        const shrineRes = activateShrine(dummyRun, nextState, command.propId, command.actorId);
        nextState = shrineRes.nextGameState;
        events.push(...shrineRes.events);
        break;
      }

      const interactionRes = resolvePropInteraction({
        state: nextState,
        actorId: command.actorId,
        propId: command.propId,
        interaction: command.interaction,
      });
      nextState = interactionRes.nextState;
      events.push(...interactionRes.events);

      // Opening a door/secret door may establish Line of Sight to an untriggered encounter
      if (
        (command.interaction === 'open' ||
          command.interaction === 'force_open' ||
          command.interaction === 'pick_lock') &&
        nextState.mode === 'exploration'
      ) {
        const encCheck = checkDungeonEncounterTriggers(nextState);
        if (encCheck.triggered) {
          nextState = encCheck.nextState;
          events.push(...encCheck.events);
        }
      }
      break;
    }

    case 'ACTIVATE_SHRINE': {
      const dummyRun = {
        runId: 'shrine_use',
        seed: nextState.rngState,
        currentDepth: 1,
        maxDepthReached: 1,
        party: nextState.party,
        suppliesRemaining: 10,
        goldCollected: 0,
        monstersSlain: 0,
        totalXp: 0,
        turnsTaken: 0,
        shrineBlessings: [],
        activeCurses: [],
        restCount: { short: 0, long: 0 },
        score: 0,
        isComplete: false,
      };
      const shrineRes = activateShrine(dummyRun, nextState, command.shrineId, command.actorId, {
        offering: command.offering,
      });
      nextState = shrineRes.nextGameState;
      events.push(...shrineRes.events);
      break;
    }

    case 'SET_PARTY_STEALTH': {
      nextState.partyInStealth = command.inStealth;
      events.push({
        type: 'PARTY_STEALTH_CHANGED',
        inStealth: command.inStealth,
      });
      break;
    }

    case 'TRIGGER_DUNGEON_ENCOUNTER': {
      const encRes = triggerDungeonEncounter(nextState, command.encounterId, {
        explicitSurprisedEntityIds: command.explicitSurprisedEntityIds,
      });
      nextState = encRes.nextState;
      events.push(...encRes.events);
      break;
    }

    case 'END_COMBAT': {
      const endRes = transitionCombatToExploration(nextState);
      nextState = endRes.nextState;
      events.push(...endRes.events);
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

    case 'LISTEN_AT_DOOR': {
      const listenRes = listenAtDoor({
        state: nextState,
        actorId: command.actorId,
        propId: command.propId,
        compendium: options?.compendium,
      });
      nextState = listenRes.nextState;
      events.push(...listenRes.events);
      break;
    }

    case 'ATTEMPT_THEFT': {
      const theftRes = resolveTheftAttempt({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        kind: command.kind,
        liftWhat: command.liftWhat,
        asBonusAction: command.asBonusAction,
        dcOverride: command.dcOverride,
      });
      nextState = theftRes.nextState;
      // Sync combat rng + mirrors (resolveTheftAttempt already mirrors).
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...theftRes.events);
      break;
    }

    case 'ATTEMPT_RECALL': {
      const recallRes = resolveRecallAttempt({
        state: nextState,
        actorId: command.actorId,
        spec: { skill: command.skill, dc: command.dc, reward: command.reward },
        roomId: command.roomId,
      });
      nextState = recallRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...recallRes.events);
      break;
    }

    // SRD-1208: contested and missing skill verbs (Spec 11 §3.3).
    case 'CONTEST_INSIGHT': {
      const contestRes = resolveInsightContest({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        ...(command.speakerDeceptionTotal !== undefined
          ? { speakerDeceptionTotal: command.speakerDeceptionTotal }
          : {}),
        ...(command.speakerDeceptionModifierOverride !== undefined
          ? { speakerDeceptionModifierOverride: command.speakerDeceptionModifierOverride }
          : {}),
        ...(command.asBonusAction !== undefined ? { asBonusAction: command.asBonusAction } : {}),
      });
      nextState = contestRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...contestRes.events);
      break;
    }

    case 'ATTEMPT_STABILIZE': {
      const stabRes = resolveStabilizeAttempt({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        ...(command.asBonusAction !== undefined ? { asBonusAction: command.asBonusAction } : {}),
        ...(command.hasHealersKitOverride !== undefined
          ? { hasHealersKitOverride: command.hasHealersKitOverride }
          : {}),
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = stabRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...stabRes.events);
      break;
    }

    case 'DIAGNOSE_AILMENT': {
      const diagRes = resolveDiagnoseAttempt({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = diagRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...diagRes.events);
      break;
    }

    case 'ATTEMPT_INTIMIDATION': {
      const intimRes = resolveIntimidationAttempt({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        ...(command.asBonusAction !== undefined ? { asBonusAction: command.asBonusAction } : {}),
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = intimRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...intimRes.events);
      break;
    }

    case 'ATTEMPT_ANIMAL_HANDLING': {
      const handleRes = resolveAnimalHandlingAttempt({
        state: nextState,
        actorId: command.actorId,
        targetId: command.targetId,
        ...(command.intent !== undefined ? { intent: command.intent } : {}),
        ...(command.asBonusAction !== undefined ? { asBonusAction: command.asBonusAction } : {}),
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = handleRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...handleRes.events);
      break;
    }

    case 'ATTEMPT_NATURE_LORE': {
      const natureRes = resolveNatureLoreAttempt({
        state: nextState,
        actorId: command.actorId,
        ...(command.subject !== undefined ? { subject: command.subject } : {}),
        ...(command.dc !== undefined ? { dc: command.dc } : {}),
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = natureRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...natureRes.events);
      break;
    }

    case 'ATTEMPT_PERFORMANCE': {
      const perfRes = resolvePerformanceAttempt({
        state: nextState,
        actorId: command.actorId,
        ...(command.targetId !== undefined ? { targetId: command.targetId } : {}),
        ...(command.intent !== undefined ? { intent: command.intent } : {}),
        ...(command.asBonusAction !== undefined ? { asBonusAction: command.asBonusAction } : {}),
        ...(command.dc !== undefined ? { dc: command.dc } : {}),
        ...(command.dcOverride !== undefined ? { dcOverride: command.dcOverride } : {}),
      });
      nextState = perfRes.nextState;
      if (nextState.combat) {
        nextState.rngState = nextState.combat.rngState ?? nextState.rngState;
      }
      events.push(...perfRes.events);
      break;
    }

    case 'START_REST': {
      const restRes = resolveRest(nextState, command, { compendium: options?.compendium });
      nextState = restRes.nextState;
      events.push(...restRes.events);
      break;
    }

    case 'UPDATE_PREPARED_SPELLS': {
      const hero = nextState.party[command.characterId];
      if (hero?.characterSheet?.spellcasting) {
        hero.characterSheet.spellcasting.preparedOrKnownSpellIds = [...command.preparedSpellIds];
        events.push({
          type: 'PREPARED_SPELLS_UPDATED',
          characterId: command.characterId,
          preparedSpellIds: [...command.preparedSpellIds],
        });
      }
      break;
    }

    case 'CLAIM_LOOT': {
      if (command.propId) {
        if (command.itemIndex !== undefined) {
          const itemRes = claimPropLootItem(
            nextState,
            command.propId,
            command.characterId,
            command.itemIndex,
            options?.compendium,
          );
          nextState = itemRes.nextState;
          events.push(...itemRes.events);
        } else if (command.takeCoins) {
          const coinRes = claimPropLootCoins(
            nextState,
            command.propId,
            command.characterId,
            options?.compendium,
          );
          nextState = coinRes.nextState;
          events.push(...coinRes.events);
        } else {
          const claimRes = claimPropLoot(
            nextState,
            command.propId,
            command.characterId,
            options?.compendium,
          );
          nextState = claimRes.nextState;
          events.push(...claimRes.events);
        }
      } else if (command.loot) {
        const hero = nextState.party[command.characterId];
        if (hero?.buildState) {
          const nextBuild = awardLootToCharacter(hero.buildState, command.loot, options?.compendium);
          const nextSheet = computeDerivedCharacter(nextBuild, options?.compendium);
          nextState = {
            ...nextState,
            party: {
              ...nextState.party,
              [hero.id]: {
                ...hero,
                buildState: nextBuild,
                characterSheet: nextSheet,
              },
            },
          };
          events.push({
            type: 'LOOT_ACQUIRED',
            actorId: hero.id,
            propId: 'direct',
            loot: command.loot,
          });
          events.push({
            type: 'INVENTORY_UPDATED',
            characterId: hero.id,
            inventory: nextBuild.inventory,
            currency: nextBuild.currency,
          });
        }
      }
      break;
    }

    case 'ATTUNE_ITEM': {
      const hero = nextState.party[command.characterId];
      if (hero?.buildState) {
        const nextBuild = attuneMagicItem(
          hero.buildState,
          command.itemInstanceId,
          options?.compendium,
        );
        const nextSheet = computeDerivedCharacter(nextBuild, options?.compendium);
        nextState = {
          ...nextState,
          party: {
            ...nextState.party,
            [hero.id]: {
              ...hero,
              buildState: nextBuild,
              characterSheet: nextSheet,
              armorClass: nextSheet.armorClass.totalAc,
            },
          },
        };
        events.push({
          type: 'ATTUNEMENT_CHANGED',
          characterId: hero.id,
          attunedItemInstanceIds: nextBuild.attunedItemInstanceIds,
        });
      }
      break;
    }

    case 'UNATTUNE_ITEM': {
      const hero = nextState.party[command.characterId];
      if (hero?.buildState) {
        const nextBuild = unattuneMagicItem(hero.buildState, command.itemInstanceId);
        const nextSheet = computeDerivedCharacter(nextBuild, options?.compendium);
        nextState = {
          ...nextState,
          party: {
            ...nextState.party,
            [hero.id]: {
              ...hero,
              buildState: nextBuild,
              characterSheet: nextSheet,
              armorClass: nextSheet.armorClass.totalAc,
            },
          },
        };
        events.push({
          type: 'ATTUNEMENT_CHANGED',
          characterId: hero.id,
          attunedItemInstanceIds: nextBuild.attunedItemInstanceIds,
        });
      }
      break;
    }

    case 'EQUIP_LOADOUT': {
      const hero = nextState.party[command.characterId];
      if (hero?.buildState) {
        // One instance cannot occupy two slots. The command carries the full
        // slot map, so a slot whose value differs from current state is the
        // intended change and wins: apply changes in canonical slot order,
        // clearing the moved instance everywhere else first (e.g. the same
        // handaxe lingering in main hand after moving it to ranged).
        const incoming = { ...(command.equippedSlots as Record<string, string | undefined>) };
        const current = hero.buildState.equippedSlots as Record<string, string | undefined>;
        const canonical = [
          'armorInstanceId',
          'shieldInstanceId',
          'mainHandInstanceId',
          'offHandInstanceId',
          'rangedInstanceId',
        ];
        const mergedSlots: Record<string, string | undefined> = { ...current };
        for (const slot of canonical) {
          if (!(slot in incoming)) continue;
          const id = incoming[slot];
          if (mergedSlots[slot] === id) continue;
          if (typeof id === 'string' && id.length > 0) {
            for (const other of Object.keys(mergedSlots)) {
              if (other !== slot && mergedSlots[other] === id) delete mergedSlots[other];
            }
            mergedSlots[slot] = id;
          } else {
            delete mergedSlots[slot];
          }
        }
        // SRD-1306: enforce armor/shield proficiency + slot fit; STR and
        // weapon proficiency surface as warnings (penalties, not blocks).
        const validation = validateEquipLoadout(
          { ...hero.buildState, equippedSlots: mergedSlots },
          mergedSlots as Record<string, string | undefined>,
          options?.compendium,
        );
        if (!validation.ok) {
          throw new Error(
            `Invalid loadout: ${validation.errors.map((e) => e.message).join('; ')}`,
          );
        }
        const nextBuild = {
          ...hero.buildState,
          equippedSlots: mergedSlots,
        };
        const nextSheet = computeDerivedCharacter(nextBuild, options?.compendium);
        nextState = {
          ...nextState,
          party: {
            ...nextState.party,
            [hero.id]: {
              ...hero,
              buildState: nextBuild,
              characterSheet: nextSheet,
              armorClass: nextSheet.armorClass.totalAc,
            },
          },
        };
      }
      break;
    }

    case 'TRANSFER_ITEM': {
      const transferRes = transferInventoryItem(
        nextState,
        command.fromCharacterId,
        command.toCharacterId,
        command.itemInstanceId,
        command.quantity,
        options?.compendium,
      );
      nextState = transferRes.nextState;
      events.push(...transferRes.events);
      const movedHero = nextState.party[command.toCharacterId];
      const movedInst = movedHero?.buildState?.inventory.find(
        (i) => i.instanceId === transferRes.movedInstanceId,
      );
      events.push({
        type: 'ITEM_TRANSFERRED',
        fromCharacterId: command.fromCharacterId,
        toCharacterId: command.toCharacterId,
        itemInstanceId: transferRes.movedInstanceId,
        itemId: movedInst?.itemId ?? command.itemInstanceId,
        quantity: transferRes.movedQuantity,
      });
      break;
    }

    case 'DROP_ITEM': {
      const dropRes = dropInventoryItem(
        nextState,
        command.characterId,
        command.itemInstanceId,
        command.quantity,
        options?.compendium,
      );
      nextState = dropRes.nextState;
      events.push(...dropRes.events);
      events.push({
        type: 'ITEM_DROPPED',
        characterId: command.characterId,
        itemInstanceId: command.itemInstanceId,
        itemId: dropRes.droppedItemId,
        quantity: dropRes.droppedQuantity,
      });
      // Mirror the refreshed sheet/AC onto the combatant copy.
      {
        const hero = nextState.party[command.characterId];
        if (hero?.buildState) {
          const sheet = computeDerivedCharacter(hero.buildState, options?.compendium);
          nextState = {
            ...nextState,
            party: {
              ...nextState.party,
              [hero.id]: { ...hero, characterSheet: sheet, armorClass: sheet.armorClass.totalAc },
            },
          };
        }
      }
      break;
    }

    case 'SPLIT_ITEM_STACK': {
      const hero = nextState.party[command.characterId];
      if (!hero?.buildState) throw new Error(`Character '${command.characterId}' not found in party`);
      const { nextInventory, splitInstance } = splitInventoryStack(
        hero.buildState.inventory,
        command.itemInstanceId,
        command.quantity,
      );
      const nextBuild = { ...hero.buildState, inventory: nextInventory };
      const nextSheet = computeDerivedCharacter(nextBuild, options?.compendium);
      nextState = {
        ...nextState,
        party: {
          ...nextState.party,
          [hero.id]: {
            ...hero,
            buildState: nextBuild,
            characterSheet: nextSheet,
            armorClass: nextSheet.armorClass.totalAc,
          },
        },
      };
      events.push({
        type: 'INVENTORY_UPDATED',
        characterId: hero.id,
        inventory: nextInventory,
        currency: nextBuild.currency,
      });
      events.push({
        type: 'ITEM_STACK_SPLIT',
        characterId: hero.id,
        sourceInstanceId: command.itemInstanceId,
        newInstanceId: splitInstance.instanceId,
        itemId: splitInstance.itemId,
        splitQuantity: command.quantity,
      });
      break;
    }

    case 'IDENTIFY_ITEM': {
      const idRes = identifyInventoryItem(
        nextState,
        command.characterId,
        command.itemInstanceId,
        options?.compendium,
      );
      nextState = idRes.nextState;
      events.push(...idRes.events);
      const inst = nextState.party[command.characterId]?.buildState?.inventory.find(
        (i) => i.instanceId === command.itemInstanceId,
      );
      events.push({
        type: 'ITEM_IDENTIFIED',
        characterId: command.characterId,
        itemInstanceId: command.itemInstanceId,
        itemId: inst?.itemId ?? command.itemInstanceId,
      });
      break;
    }

    case 'SELL_ITEM': {
      const preSaleInst = nextState.party[command.characterId]?.buildState?.inventory.find(
        (i) => i.instanceId === command.itemInstanceId,
      );
      const saleRes = sellInventoryItem(
        nextState,
        command.characterId,
        command.itemInstanceId,
        command.quantity,
        options?.compendium,
      );
      nextState = saleRes.nextState;
      events.push(...saleRes.events);
      events.push({
        type: 'ITEM_SOLD',
        characterId: command.characterId,
        itemInstanceId: command.itemInstanceId,
        itemId: preSaleInst?.itemId ?? command.itemInstanceId,
        quantity: command.quantity ?? preSaleInst?.quantity ?? 1,
        goldEarned: saleRes.goldEarned,
      });
      break;
    }

    case 'LEVEL_UP_CHARACTER': {
      const lvlRes = applyBetweenCombatLevelUp(
        nextState,
        command.characterId,
        command.levelUpRequest,
        options?.compendium,
      );
      nextState = lvlRes.nextState;
      events.push(...lvlRes.events);
      break;
    }
  }

  // Auto-advance past a defeated active combatant: if the turn owner died
  // mid-turn (opportunity attack, hazard zone, readied action), their turn
  // ends immediately per SRD 5.1 instead of stalling on the corpse until
  // someone presses End Turn. Skipped while a reaction prompt is pending
  // or combat has already ended.
  if (
    nextState.mode === 'combat' &&
    nextState.combat &&
    nextState.combat.phase === 'active_turn' &&
    !nextState.combat.pendingReactionPrompt &&
    !nextState.combat.reactionInterruptContext &&
    nextState.combat.activeCombatantId
  ) {
    const active = nextState.combat.combatants[nextState.combat.activeCombatantId];
    if (active && !isCombatantEligibleForTurn(active)) {
      const advRes = endTurn(nextState.combat);
      nextState.combat = advRes.state;
      nextState.rngState = advRes.state.rngState;
      for (const [id, c] of Object.entries(advRes.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }
      events.push(...advRes.events);
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
