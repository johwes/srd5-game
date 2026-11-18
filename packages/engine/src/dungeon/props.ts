import { type AbilityId, defaultCompendium, type SrdCompendium } from '@srd5/data';
import { type Combatant } from '../combat/types.js';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import {
  type GridPoint,
  type TacticalGrid,
  setGridCell,
} from '../grid/model.js';
import { hasLineOfSight } from '../grid/vision.js';
import {
  type GameEvent,
  type GameState,
  type InteractiveProp,
} from '../state/types.js';

/**
 * Checks if two grid positions are adjacent (within 5 feet / 1 cell Chebyshev distance).
 * Standing on the same cell (distance 0) is also adjacent.
 */
export function isAdjacent(a: GridPoint, b: GridPoint): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;
}

/**
 * Computes an actor's total modifier for an ability or skill check or tool.
 */
export function getActorCheckBonus(
  actor: Combatant,
  checkType: 'thieves_tools' | 'perception' | 'investigation' | 'athletics' | AbilityId,
): number {
  switch (checkType) {
    case 'thieves_tools': {
      const dexMod = actor.characterSheet?.abilities.dex.modifier ?? actor.dexterityModifier;
      if (!actor.characterSheet) return dexMod;

      const tools = actor.characterSheet.proficiencies.tools ?? [];
      const hasTools =
        tools.includes('thieves_tools') ||
        tools.includes('thieves tools') ||
        tools.includes("thieves' tools");

      const expertise = actor.characterSheet.proficiencies.expertise ?? [];
      const hasExpertise =
        expertise.includes('thieves_tools') ||
        expertise.includes('thieves tools') ||
        expertise.includes("thieves' tools");

      if (hasExpertise) {
        return dexMod + actor.characterSheet.proficiencyBonus * 2;
      }
      if (hasTools) {
        return dexMod + actor.characterSheet.proficiencyBonus;
      }
      return dexMod;
    }

    case 'perception': {
      if (actor.characterSheet?.skills.perception) {
        return actor.characterSheet.skills.perception.totalBonus;
      }
      if (actor.monsterData?.skills?.perception !== undefined) {
        return actor.monsterData.skills.perception;
      }
      return actor.passivePerception - 10;
    }

    case 'investigation': {
      if (actor.characterSheet?.skills.investigation) {
        return actor.characterSheet.skills.investigation.totalBonus;
      }
      if (actor.monsterData?.skills?.investigation !== undefined) {
        return actor.monsterData.skills.investigation;
      }
      return actor.characterSheet?.abilities.int.modifier ?? 0;
    }

    case 'athletics': {
      if (actor.characterSheet?.skills.athletics) {
        return actor.characterSheet.skills.athletics.totalBonus;
      }
      if (actor.monsterData?.skills?.athletics !== undefined) {
        return actor.monsterData.skills.athletics;
      }
      return actor.strengthModifier ?? Math.floor(((actor.strengthScore ?? 10) - 10) / 2);
    }

    case 'str':
    case 'dex':
    case 'con':
    case 'int':
    case 'wis':
    case 'cha': {
      // Saving throw bonus
      if (actor.characterSheet?.savingThrows[checkType]) {
        return actor.characterSheet.savingThrows[checkType].totalBonus;
      }
      if (actor.monsterData?.savingThrows?.[checkType] !== undefined) {
        return actor.monsterData.savingThrows[checkType]!;
      }
      if (checkType === 'dex') return actor.dexterityModifier;
      if (checkType === 'str') return actor.strengthModifier ?? Math.floor(((actor.strengthScore ?? 10) - 10) / 2);
      if (checkType === 'con') return actor.characterSheet?.abilities.con.modifier ?? 0;
      if (checkType === 'int') return actor.characterSheet?.abilities.int.modifier ?? 0;
      if (checkType === 'wis') return actor.characterSheet?.abilities.wis.modifier ?? 0;
      if (checkType === 'cha') return actor.characterSheet?.abilities.cha.modifier ?? 0;
      return 0;
    }

    default:
      return 0;
  }
}

/**
 * A single interactable option for the click-to-inspect prop card
 * (Spec 04 §3.2). Mirrors the gating in `resolvePropInteraction` so the UI
 * only offers actions the engine will accept.
 */
export type PropInteractionKind =
  | 'open'
  | 'close'
  | 'pick_lock'
  | 'disarm_trap'
  | 'force_open'
  | 'listen'
  | 'search'
  | 'attack';

export interface PropInteractionOption {
  interaction: PropInteractionKind;
  label: string;
  /** Human-readable check preview, e.g. "DEX +3 vs DC 15". */
  checkHint?: string;
  /** Heads-up shown alongside the action, e.g. a suspected trap. */
  riskHint?: string;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Lists the interaction options for one prop and actor, gated by prop kind
 * and state. Returns an empty list for props the party cannot meaningfully
 * act on (undiscovered secrets, destroyed husks, disarmed traps, stairs,
 * which keep their dedicated HUD flows).
 */
export function getAvailablePropInteractions(
  prop: Pick<
    InteractiveProp,
    | 'id'
    | 'kind'
    | 'state'
    | 'lockDc'
    | 'listenDc'
    | 'detectionDc'
    | 'disarmDc'
    | 'trapDamageFormula'
    | 'discovered'
  >,
  actor?: Pick<Combatant, 'id'> & Partial<Combatant>,
): PropInteractionOption[] {
  if (prop.kind === 'secret_door' && !prop.discovered) return [];
  if (prop.state === 'destroyed') return [];
  if (prop.kind === 'stairs_down' || prop.kind === 'stairs_up') return [];
  if ((prop.kind === 'trap' || prop.kind === 'secret_door') && prop.discovered === false) return [];

  const options: PropInteractionOption[] = [];
  const trapped =
    prop.trapDamageFormula !== undefined &&
    prop.state !== 'disarmed' &&
    prop.state !== 'triggered';
  const riskHint = trapped ? 'May be trapped — consider disarming or searching first.' : undefined;

  const toolsBonus = actor ? getActorCheckBonus(actor as Combatant, 'thieves_tools') : undefined;
  const athleticsBonus = actor ? getActorCheckBonus(actor as Combatant, 'athletics') : undefined;
  const searchBonus = actor
    ? Math.max(
        getActorCheckBonus(actor as Combatant, 'perception'),
        getActorCheckBonus(actor as Combatant, 'investigation'),
      )
    : undefined;
  const listenBonus = actor ? getActorCheckBonus(actor as Combatant, 'perception') : undefined;

  switch (prop.kind) {
    case 'door':
    case 'secret_door': {
      if (prop.state === 'locked') {
        const lockDc = prop.lockDc ?? 15;
        options.push({
          interaction: 'pick_lock',
          label: 'Pick Lock',
          checkHint:
            toolsBonus !== undefined ? `DEX (Thieves' Tools) ${signed(toolsBonus)} vs DC ${lockDc}` : `DC ${lockDc}`,
          ...(riskHint ? { riskHint } : {}),
        });
        options.push({
          interaction: 'force_open',
          label: 'Force Open',
          checkHint:
            athleticsBonus !== undefined
              ? `STR (Athletics) ${signed(athleticsBonus)} vs DC ${lockDc + 2}`
              : `DC ${lockDc + 2} (loud!)`,
          ...(riskHint ? { riskHint } : {}),
        });
      } else if (prop.state === 'closed') {
        options.push({
          interaction: 'open',
          label: 'Open',
          ...(riskHint ? { riskHint } : {}),
        });
      } else if (prop.state === 'open') {
        options.push({ interaction: 'close', label: 'Close' });
      }
      options.push({
        interaction: 'listen',
        label: 'Listen',
        checkHint:
          listenBonus !== undefined
            ? `WIS (Perception) ${signed(listenBonus)} vs DC ${prop.listenDc ?? 12}`
            : undefined,
      });
      options.push({
        interaction: 'search',
        label: 'Search',
        checkHint:
          searchBonus !== undefined
            ? `Perception/Investigation ${signed(searchBonus)} vs DC ${prop.detectionDc ?? 10}`
            : undefined,
      });
      return options;
    }
    case 'chest': {
      if (prop.state === 'locked') {
        const lockDc = prop.lockDc ?? 15;
        options.push({
          interaction: 'pick_lock',
          label: 'Pick Lock',
          checkHint:
            toolsBonus !== undefined ? `DEX (Thieves' Tools) ${signed(toolsBonus)} vs DC ${lockDc}` : `DC ${lockDc}`,
          ...(riskHint ? { riskHint } : {}),
        });
        options.push({
          interaction: 'force_open',
          label: 'Force Open',
          checkHint:
            athleticsBonus !== undefined
              ? `STR (Athletics) ${signed(athleticsBonus)} vs DC ${lockDc + 2}`
              : `DC ${lockDc + 2} (loud!)`,
          ...(riskHint ? { riskHint } : {}),
        });
      } else if (prop.state === 'closed') {
        options.push({
          interaction: 'open',
          label: 'Open',
          ...(riskHint ? { riskHint } : {}),
        });
      }
      if (prop.state !== 'open') {
        options.push({
          interaction: 'search',
          label: 'Search',
          checkHint:
            searchBonus !== undefined
              ? `Perception/Investigation ${signed(searchBonus)} vs DC ${prop.detectionDc ?? 10}`
              : undefined,
        });
      }
      return options;
    }
    case 'trap': {
      if (prop.discovered && prop.state !== 'disarmed' && prop.state !== 'triggered') {
        const disarmDc = prop.disarmDc ?? 15;
        options.push({
          interaction: 'disarm_trap',
          label: 'Disarm Trap',
          checkHint:
            toolsBonus !== undefined
              ? `DEX (Thieves' Tools) ${signed(toolsBonus)} vs DC ${disarmDc} (fail by 5+ triggers it)`
              : `DC ${disarmDc}`,
        });
        options.push({ interaction: 'search', label: 'Search' });
      }
      return options;
    }
    case 'lever': {
      options.push({
        interaction: 'open',
        label: prop.state === 'open' ? 'Reset Lever' : 'Pull Lever',
      });
      return options;
    }
    case 'shrine': {
      // Shrines resolve through the dedicated shrine modal, not INTERACT_PROP.
      options.push({ interaction: 'open', label: 'Use Shrine' });
      return options;
    }
    default:
      return options;
  }
}
export function triggerTrapEffect(options: {
  trap: InteractiveProp;
  target: Combatant;
  rngState: number;
}): {
  nextRngState: number;
  damage: number;
  events: GameEvent[];
  saveMade: boolean;
  saveSuccess: boolean;
} {
  const { trap, target } = options;
  let currentRng = options.rngState;
  const events: GameEvent[] = [];

  let rawDamage = 0;
  if (trap.trapDamageFormula) {
    const rollRes = rollDamage(currentRng, trap.trapDamageFormula);
    rawDamage = rollRes.total;
    currentRng = rollRes.nextState;
  }

  let finalDamage = rawDamage;
  let saveMade = false;
  let saveSuccess = false;

  // Handle saving throw if specified
  if (trap.trapSaveDc && trap.trapSaveAbility) {
    saveMade = true;
    const saveBonus = getActorCheckBonus(target, trap.trapSaveAbility);
    const saveRes = rollD20(currentRng, { modifier: saveBonus, mode: 'normal' });
    currentRng = saveRes.nextState;
    saveSuccess = saveRes.total >= trap.trapSaveDc;

    events.push({
      type: 'CHECK_RESOLVED',
      actorId: target.id,
      checkType: 'saving_throw',
      targetId: trap.id,
      dc: trap.trapSaveDc,
      roll: saveRes.naturalRoll,
      modifier: saveBonus,
      total: saveRes.total,
      success: saveSuccess,
    });

    if (saveSuccess) {
      finalDamage = (trap.trapHalfDamageOnSave ?? true) ? Math.floor(rawDamage / 2) : 0;
    }
  }

  if (finalDamage > 0) {
    target.currentHp = Math.max(0, target.currentHp - finalDamage);
  }

  trap.state = 'triggered';
  trap.discovered = true;

  events.push({
    type: 'TRAP_TRIGGERED',
    propId: trap.id,
    targetId: target.id,
    damage: finalDamage,
    damageType: trap.trapDamageType ?? 'piercing',
    saveMade,
    saveSuccess,
  });

  return {
    nextRngState: currentRng,
    damage: finalDamage,
    events,
    saveMade,
    saveSuccess,
  };
}

/**
 * SRD-511: Listen at a door. An adjacent hero makes a WIS (Perception) check
 * against the prop's listenDc (default 12). Hints are derived deterministically
 * from *untriggered* encounters in rooms neighboring the prop — listening never
 * triggers encounters, costs no resources, and works through closed doors.
 */
export function listenAtDoor(options: {
  state: GameState;
  actorId: string;
  propId: string;
  compendium?: SrdCompendium;
}): { nextState: GameState; events: GameEvent[]; hint: string } {
  const { state, actorId, propId } = options;
  if (state.mode !== 'exploration') {
    throw new Error('Listening at doors is an exploration activity');
  }

  const actor = state.party[actorId];
  if (!actor || actor.isDead || actor.currentHp <= 0) {
    throw new Error(`Listening actor not found or down: ${actorId}`);
  }
  const prop = state.props.find((p) => p.id === propId);
  if (!prop) {
    throw new Error(`Interactive prop not found: ${propId}`);
  }
  if (prop.kind !== 'door' && !(prop.kind === 'secret_door' && prop.discovered)) {
    throw new Error(`You can only listen at doors (not ${prop.kind})`);
  }
  if (!isAdjacent(actor.position, { x: prop.x, y: prop.y })) {
    throw new Error(`Actor ${actorId} is not adjacent to prop ${propId}`);
  }

  const nextState = structuredClone(state);
  let rngState = nextState.rngState;
  const dc = prop.listenDc ?? 12;
  const bonus = getActorCheckBonus(nextState.party[actorId]!, 'perception');
  const rollRes = rollD20(rngState, { modifier: bonus, mode: 'normal' });
  rngState = rollRes.nextState;
  nextState.rngState = rngState;
  const success = rollRes.total >= dc;
  const margin = rollRes.total - dc;

  // Neighboring rooms: any roomId touching the prop's 8 neighbors (plus its
  // own cell). Sounds carry from untriggered encounters in those rooms.
  const neighborRooms = new Set<string>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cell = nextState.grid.cells.find(
        (c) => c.x === prop.x + dx && c.y === prop.y + dy,
      );
      if (cell?.roomId) neighborRooms.add(cell.roomId);
    }
  }
  const nearby = (nextState.dungeon?.encounters ?? []).filter(
    (e) => !e.triggered && e.roomId !== undefined && neighborRooms.has(e.roomId),
  );
  const monsterCount = nearby.reduce((sum, e) => sum + (e.monsters?.length ?? 0), 0);

  let hint: string;
  if (monsterCount === 0) {
    hint = 'Nothing stirs beyond the door.';
  } else if (margin <= -5) {
    hint = 'Stillness. Nothing stirs beyond.';
  } else if (!success) {
    hint = 'Faint, undecipherable sounds on the other side.';
  } else {
    const compendium = options.compendium ?? defaultCompendium;
    const typeCounts = new Map<string, number>();
    for (const enc of nearby) {
      for (const m of enc.monsters ?? []) {
        const kind = compendium.getMonster(m.monsterId)?.type ?? 'unknown';
        typeCounts.set(kind, (typeCounts.get(kind) ?? 0) + 1);
      }
    }
    const topType = [...typeCounts.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0]?.[0] ?? 'unknown';
    const character: Record<string, string> = {
      undead: 'dry scraping and the clack of old bone',
      beast: 'bestial snuffling and skittering claws',
      humanoid: 'muffled voices, arguing in low tones',
      fiend: 'a heat-shimmer hiss and whispered malice',
      monstrosity: 'heavy, uneven footfalls',
      giant: 'slow, ponderous footfalls',
      ooze: 'wet, sucking movement',
    };
    const sounds = character[topType] ?? 'strange movement and breathing';
    if (margin >= 5) {
      const band =
        monsterCount <= 1 ? 'a single mover' : monsterCount <= 3 ? 'two or three movers' : 'a group of movers (four or more)';
      hint = `You make out ${band} — ${sounds}.`;
    } else {
      hint = `You hear ${sounds} beyond the door.`;
    }
  }

  const events: GameEvent[] = [
    {
      type: 'CHECK_RESOLVED',
      actorId,
      checkType: 'perception',
      targetId: prop.id,
      dc,
      roll: rollRes.naturalRoll,
      modifier: bonus,
      total: rollRes.total,
      success,
      note: hint,
    },
  ];

  return { nextState, events, hint };
}

/**
 * Checks passive perception against hidden props within 15ft (3 cells) with Line of Sight.
 */
export function checkPassivePerceptionForProps(options: {
  grid: TacticalGrid;
  observers: Combatant[];
  props: InteractiveProp[];
}): {
  events: GameEvent[];
  discoveredProps: InteractiveProp[];
  haltedByTrap: boolean;
} {
  const { grid, observers, props } = options;
  const events: GameEvent[] = [];
  const discoveredProps: InteractiveProp[] = [];
  let haltedByTrap = false;

  const validObservers = observers.filter(
    (o) => !o.isDead && o.currentHp > 0 && !o.conditions.includes('blinded'),
  );
  if (validObservers.length === 0) {
    return { events, discoveredProps, haltedByTrap };
  }

  for (const prop of props) {
    if (prop.discovered || prop.detectionDc === undefined) continue;

    for (const obs of validObservers) {
      const dist = Math.max(
        Math.abs(obs.position.x - prop.x),
        Math.abs(obs.position.y - prop.y),
      );
      // 15 feet = 3 cells on a 5-ft grid
      if (dist <= 3) {
        const canSee = hasLineOfSight(
          grid,
          { id: obs.id, x: obs.position.x, y: obs.position.y, size: obs.size },
          { id: prop.id, x: prop.x, y: prop.y, size: 'medium' },
        );

        if (canSee && obs.passivePerception >= prop.detectionDc) {
          prop.discovered = true;
          discoveredProps.push(prop);
          events.push({
            type: 'SECRET_DISCOVERED',
            propId: prop.id,
            finderId: obs.id,
            kind: prop.kind,
          });

          if (prop.kind === 'trap') {
            haltedByTrap = true;
          }
          break;
        }
      }
    }
  }

  return { events, discoveredProps, haltedByTrap };
}

/**
 * Executes an active Search action (WIS Perception or INT Investigation, using higher).
 */
export function resolveActiveSearch(options: {
  state: GameState;
  actorId: string;
  propId?: string;
}): {
  nextState: GameState;
  events: GameEvent[];
} {
  const { state, actorId, propId } = options;
  const actor = state.party[actorId] ?? state.combat?.combatants[actorId];
  if (!actor) {
    throw new Error(`Actor not found for search: ${actorId}`);
  }

  const nextState = structuredClone(state);
  const nextActor = nextState.party[actorId] ?? nextState.combat?.combatants[actorId];
  const events: GameEvent[] = [];

  const perceptionBonus = getActorCheckBonus(actor, 'perception');
  const investigationBonus = getActorCheckBonus(actor, 'investigation');
  const useInvestigation = investigationBonus > perceptionBonus;
  const searchBonus = Math.max(perceptionBonus, investigationBonus);
  const checkType = useInvestigation ? 'investigation' : 'perception';

  const rollRes = rollD20(nextState.rngState, { modifier: searchBonus, mode: 'normal' });
  nextState.rngState = rollRes.nextState;

  if (propId && propId !== 'room' && propId !== 'all') {
    const prop = nextState.props.find((p) => p.id === propId);
    if (!prop) {
      throw new Error(`Interactive prop not found for search: ${propId}`);
    }

    const dc = prop.detectionDc ?? 10;
    const success = rollRes.total >= dc;

    events.push({
      type: 'CHECK_RESOLVED',
      actorId,
      checkType,
      targetId: prop.id,
      dc,
      roll: rollRes.naturalRoll,
      modifier: searchBonus,
      total: rollRes.total,
      success,
    });

    if (success && !prop.discovered) {
      prop.discovered = true;
      events.push({
        type: 'SECRET_DISCOVERED',
        propId: prop.id,
        finderId: actorId,
        kind: prop.kind,
      });
    }
  } else {
    // Room or 30-ft vicinity search
    const actorRoomId = nextActor?.roomId;
    let anyDiscovered = false;

    for (const prop of nextState.props) {
      if (prop.discovered || prop.detectionDc === undefined) continue;

      const dist = Math.max(
        Math.abs(actor.position.x - prop.x),
        Math.abs(actor.position.y - prop.y),
      );

      // Same room or within 30 ft (6 cells)
      const sameRoom = actorRoomId && state.grid.cells[prop.y * state.grid.width + prop.x]?.roomId === actorRoomId;
      const withinRange = dist <= 6;

      if (sameRoom || withinRange) {
        const canSee = hasLineOfSight(
          nextState.grid,
          { id: actor.id, x: actor.position.x, y: actor.position.y, size: actor.size },
          { id: prop.id, x: prop.x, y: prop.y, size: 'medium' },
        );

        if (canSee && rollRes.total >= prop.detectionDc) {
          prop.discovered = true;
          anyDiscovered = true;
          events.push({
            type: 'SECRET_DISCOVERED',
            propId: prop.id,
            finderId: actorId,
            kind: prop.kind,
          });
        }
      }
    }

    events.push({
      type: 'CHECK_RESOLVED',
      actorId,
      checkType,
      roll: rollRes.naturalRoll,
      modifier: searchBonus,
      total: rollRes.total,
      success: anyDiscovered || rollRes.total >= 10,
    });
  }

  return { nextState, events };
}

/**
 * Resolves an interactive prop action (open, close, pick_lock, disarm_trap, force_open, search, attack).
 */
export function resolvePropInteraction(options: {
  state: GameState;
  actorId: string;
  propId: string;
  interaction: 'open' | 'close' | 'pick_lock' | 'disarm_trap' | 'force_open' | 'search' | 'attack';
}): {
  nextState: GameState;
  events: GameEvent[];
} {
  const { state, actorId, propId, interaction } = options;

  if (interaction === 'search') {
    return resolveActiveSearch({ state, actorId, propId });
  }

  const nextState = structuredClone(state);
  const actor = nextState.party[actorId] ?? nextState.combat?.combatants[actorId];
  if (!actor) {
    throw new Error(`Actor not found for prop interaction: ${actorId}`);
  }

  const prop = nextState.props.find((p) => p.id === propId);
  if (!prop) {
    throw new Error(`Interactive prop not found: ${propId}`);
  }

  // Physical interactions require Chebyshev adjacency (within 5 feet / 1 cell)
  if (!isAdjacent(actor.position, { x: prop.x, y: prop.y })) {
    throw new Error(
      `Actor ${actorId} at (${actor.position.x}, ${actor.position.y}) is not adjacent to prop ${propId} at (${prop.x}, ${prop.y})`,
    );
  }

  const events: GameEvent[] = [];
  const prevState = prop.state;

  switch (interaction) {
    case 'open': {
      if (prop.kind === 'secret_door' && !prop.discovered) {
        throw new Error(`Cannot open undiscovered secret door: ${prop.id}`);
      }
      if (prop.state === 'locked') {
        throw new Error(`Prop ${prop.id} is locked. Pick lock or force open first.`);
      }
      if (prop.state === 'open') {
        return { nextState, events };
      }
      if (prop.state === 'destroyed') {
        return { nextState, events };
      }

      // Trapped prop check (e.g. trapped chest or door)
      if (
        (prop.trapDamageFormula) &&
        prop.state !== 'disarmed' &&
        prop.state !== 'triggered'
      ) {
        const trapRes = triggerTrapEffect({
          trap: prop,
          target: actor,
          rngState: nextState.rngState,
        });
        nextState.rngState = trapRes.nextRngState;
        events.push(...trapRes.events);
      }

      prop.state = 'open';
      if (prop.kind === 'door' || prop.kind === 'secret_door') {
        prop.blocksMovement = false;
        prop.blocksSight = false;
        nextState.grid = setGridCell(nextState.grid, {
          x: prop.x,
          y: prop.y,
          blocksMovement: false,
          blocksSight: false,
        });
      }

      events.push({
        type: 'PROP_STATE_CHANGED',
        propId: prop.id,
        prevState,
        nextState: 'open',
        actorId,
      });

      // Award loot if chest contains loot table
      if (prop.lootTable) {
        events.push({
          type: 'LOOT_ACQUIRED',
          actorId,
          propId: prop.id,
          loot: structuredClone(prop.lootTable),
        });
      }
      break;
    }

    case 'close': {
      if (prop.state !== 'open') {
        return { nextState, events };
      }

      prop.state = 'closed';
      if (prop.kind === 'door' || prop.kind === 'secret_door') {
        prop.blocksMovement = true;
        prop.blocksSight = true;
        nextState.grid = setGridCell(nextState.grid, {
          x: prop.x,
          y: prop.y,
          blocksMovement: true,
          blocksSight: true,
        });
      }

      events.push({
        type: 'PROP_STATE_CHANGED',
        propId: prop.id,
        prevState,
        nextState: 'closed',
        actorId,
      });
      break;
    }

    case 'pick_lock': {
      if (prop.state !== 'locked') {
        throw new Error(`Prop ${prop.id} is not locked`);
      }

      const lockDc = prop.lockDc ?? 15;
      const mod = getActorCheckBonus(actor, 'thieves_tools');
      const rollRes = rollD20(nextState.rngState, { modifier: mod, mode: 'normal' });
      nextState.rngState = rollRes.nextState;
      const success = rollRes.total >= lockDc;

      events.push({
        type: 'CHECK_RESOLVED',
        actorId,
        checkType: 'thieves_tools',
        targetId: prop.id,
        dc: lockDc,
        roll: rollRes.naturalRoll,
        modifier: mod,
        total: rollRes.total,
        success,
      });

      if (success) {
        prop.state = 'closed'; // Unlocked
        events.push({
          type: 'PROP_STATE_CHANGED',
          propId: prop.id,
          prevState: 'locked',
          nextState: 'closed',
          actorId,
        });
      }
      break;
    }

    case 'disarm_trap': {
      if (!prop.discovered) {
        throw new Error(`Cannot disarm undiscovered trap: ${prop.id}`);
      }
      if (prop.kind !== 'trap' && !prop.trapDamageFormula) {
        throw new Error(`Prop ${prop.id} is not a trap`);
      }
      if (prop.state === 'disarmed' || prop.state === 'triggered') {
        return { nextState, events };
      }

      const disarmDc = prop.disarmDc ?? 15;
      const mod = getActorCheckBonus(actor, 'thieves_tools');
      const rollRes = rollD20(nextState.rngState, { modifier: mod, mode: 'normal' });
      nextState.rngState = rollRes.nextState;
      const success = rollRes.total >= disarmDc;

      if (success) {
        prop.state = 'disarmed';
        events.push({
          type: 'CHECK_RESOLVED',
          actorId,
          checkType: 'thieves_tools',
          targetId: prop.id,
          dc: disarmDc,
          roll: rollRes.naturalRoll,
          modifier: mod,
          total: rollRes.total,
          success: true,
        });
        events.push({
          type: 'PROP_STATE_CHANGED',
          propId: prop.id,
          prevState,
          nextState: 'disarmed',
          actorId,
        });
      } else {
        // SRD 5.1 rule: failing disarm check by 5 or more triggers the trap!
        const triggered = rollRes.total <= disarmDc - 5;
        events.push({
          type: 'CHECK_RESOLVED',
          actorId,
          checkType: 'thieves_tools',
          targetId: prop.id,
          dc: disarmDc,
          roll: rollRes.naturalRoll,
          modifier: mod,
          total: rollRes.total,
          success: false,
          triggered,
        });

        if (triggered) {
          const trapRes = triggerTrapEffect({
            trap: prop,
            target: actor,
            rngState: nextState.rngState,
          });
          nextState.rngState = trapRes.nextRngState;
          events.push(...trapRes.events);
          events.push({
            type: 'PROP_STATE_CHANGED',
            propId: prop.id,
            prevState,
            nextState: 'triggered',
            actorId,
          });
        }
      }
      break;
    }

    case 'force_open': {
      if (prop.state === 'open' || prop.state === 'destroyed') {
        return { nextState, events };
      }

      // Spec 04 Section 3.1: STR (Athletics) vs lockDc + 2
      const forceDc = (prop.lockDc ?? 12) + 2;
      const mod = getActorCheckBonus(actor, 'athletics');
      const rollRes = rollD20(nextState.rngState, { modifier: mod, mode: 'normal' });
      nextState.rngState = rollRes.nextState;
      const success = rollRes.total >= forceDc;

      events.push({
        type: 'CHECK_RESOLVED',
        actorId,
        checkType: 'athletics',
        targetId: prop.id,
        dc: forceDc,
        roll: rollRes.naturalRoll,
        modifier: mod,
        total: rollRes.total,
        success,
      });

      if (success) {
        prop.state = 'destroyed';
        if (prop.kind === 'door' || prop.kind === 'secret_door') {
          prop.blocksMovement = false;
          prop.blocksSight = false;
          nextState.grid = setGridCell(nextState.grid, {
            x: prop.x,
            y: prop.y,
            blocksMovement: false,
            blocksSight: false,
          });
        }

        events.push({
          type: 'PROP_STATE_CHANGED',
          propId: prop.id,
          prevState,
          nextState: 'destroyed',
          actorId,
        });

        if (prop.lootTable) {
          events.push({
            type: 'LOOT_ACQUIRED',
            actorId,
            propId: prop.id,
            loot: structuredClone(prop.lootTable),
          });
        }
      }
      break;
    }

    case 'attack': {
      if (prop.state === 'destroyed') {
        return { nextState, events };
      }

      const objectAc = prop.ac ?? 15;
      const currentHp = prop.hp ?? 15;

      // Determine attack bonus and damage formula
      const attackBonus =
        actor.characterSheet?.weaponAttacks?.[0]?.toHitBonus ??
        actor.strengthModifier ??
        2;
      const damageFormula =
        actor.characterSheet?.weaponAttacks?.[0]?.damageFormula ??
        '1d8+2';

      const toHitRes = rollD20(nextState.rngState, { modifier: attackBonus, mode: 'normal' });
      nextState.rngState = toHitRes.nextState;
      const hit = toHitRes.total >= objectAc;

      if (hit) {
        const dmgRes = rollDamage(nextState.rngState, damageFormula);
        nextState.rngState = dmgRes.nextState;
        const newHp = Math.max(0, currentHp - dmgRes.total);
        prop.hp = newHp;

        events.push({
          type: 'CHECK_RESOLVED',
          actorId,
          checkType: 'attack',
          targetId: prop.id,
          dc: objectAc,
          roll: toHitRes.naturalRoll,
          modifier: attackBonus,
          total: toHitRes.total,
          success: true,
        });

        if (newHp <= 0) {
          prop.state = 'destroyed';
          if (prop.kind === 'door' || prop.kind === 'secret_door') {
            prop.blocksMovement = false;
            prop.blocksSight = false;
            nextState.grid = setGridCell(nextState.grid, {
              x: prop.x,
              y: prop.y,
              blocksMovement: false,
              blocksSight: false,
            });
          }

          events.push({
            type: 'PROP_STATE_CHANGED',
            propId: prop.id,
            prevState,
            nextState: 'destroyed',
            actorId,
          });

          if (prop.lootTable) {
            events.push({
              type: 'LOOT_ACQUIRED',
              actorId,
              propId: prop.id,
              loot: structuredClone(prop.lootTable),
            });
          }
        }
      } else {
        events.push({
          type: 'CHECK_RESOLVED',
          actorId,
          checkType: 'attack',
          targetId: prop.id,
          dc: objectAc,
          roll: toHitRes.naturalRoll,
          modifier: attackBonus,
          total: toHitRes.total,
          success: false,
        });
      }
      break;
    }
  }

  return { nextState, events };
}
