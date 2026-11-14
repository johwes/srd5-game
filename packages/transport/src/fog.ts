import {
  type Combatant,
  type CombatState,
  type GameState,
  type GridPoint,
  type LightLevel,
  type TacticalGrid,
  applyDarkvision,
  getCellDistanceFeet,
  getCellLightLevel,
  hasLineOfSight,
  CREATURE_FOOTPRINT_CELLS,
} from '@srd5/engine';
import {
  type CellVisibility,
  type PlayerViewCell,
  type PlayerViewCombatant,
  type PlayerViewCombatState,
  type PlayerViewGrid,
  type PlayerViewProp,
  type PlayerViewState,
} from './types.js';

export interface ProjectPlayerViewOptions {
  /**
   * If true (default), party members share Line of Sight with each other.
   * If false, only characters in controlledCharacterIds contribute vision.
   */
  sharedVision?: boolean;
  /**
   * Maximum vision cutoff distance in feet (default 120 ft / 24 squares).
   */
  maxVisionRangeFeet?: number;
}

/**
 * Returns all grid coordinates occupied by a creature based on its size footprint.
 */
export function getCreatureFootprintPoints(
  position: GridPoint,
  size: string,
): GridPoint[] {
  const w = (CREATURE_FOOTPRINT_CELLS as Record<string, number>)[size] ?? 1;
  const points: GridPoint[] = [];
  for (let dy = 0; dy < w; dy++) {
    for (let dx = 0; dx < w; dx++) {
      points.push({ x: position.x + dx, y: position.y + dy });
    }
  }
  return points;
}

/**
 * Maps an authoritative Combatant to a sanitized PlayerViewCombatant.
 */
export function toPlayerViewCombatant(c: Combatant): PlayerViewCombatant {
  return {
    id: c.id,
    name: c.name,
    side: c.side,
    teamId: c.teamId,
    playerId: c.playerId,
    size: c.size,
    position: { x: c.position.x, y: c.position.y },
    speedFeet: c.speedFeet,
    currentHp: c.currentHp,
    maxHp: c.maxHp,
    tempHp: c.tempHp,
    armorClass: c.armorClass,
    conditions: [...c.conditions],
    isDead: c.isDead,
    isStable: c.isStable,
    reactionAvailable: c.reactionAvailable,
    characterSheet: c.characterSheet,
    levelUpAvailable: c.levelUpAvailable,
    buildState: c.buildState,
  };
}

/**
 * Computes all currently visible cells for a set of observers.
 */
export function computeVisibleGridCells(
  grid: TacticalGrid,
  observers: Combatant[],
  lightSources: GameState['lightSources'] = [],
  maxVisionFeet: number = 120,
): Map<string, { effectiveLight: LightLevel }> {
  const visibleMap = new Map<string, { effectiveLight: LightLevel }>();

  if (observers.length === 0) {
    return visibleMap;
  }

  // Pre-calculate observer sight properties
  const activeObservers = observers
    .filter(
      (c) =>
        !c.isDead &&
        c.currentHp > 0 &&
        !c.conditions.includes('blinded') &&
        !c.conditions.includes('unconscious'),
    )
    .map((obs) => {
      const darkvisionFeet =
        (obs.characterSheet as any)?.darkvisionFeet ??
        (obs.monsterData as any)?.darkvisionFeet ??
        (obs as any).darkvisionFeet ??
        0;
      return {
        combatant: obs,
        darkvisionFeet,
      };
    });

  if (activeObservers.length === 0) {
    return visibleMap;
  }

  for (const cell of grid.cells) {
    const targetPoint: GridPoint = { x: cell.x, y: cell.y };
    let bestLightRank = -1;
    let isVisible = false;

    for (const { combatant: obs, darkvisionFeet } of activeObservers) {
      const distFeet = getCellDistanceFeet(obs.position, targetPoint);
      if (distFeet > maxVisionFeet) continue;

      if (
        hasLineOfSight(
          grid,
          { id: obs.id, x: obs.position.x, y: obs.position.y, size: obs.size },
          { x: cell.x, y: cell.y, size: 'medium' },
        )
      ) {
        const baseLight = getCellLightLevel(grid, targetPoint, lightSources);
        const effLight = applyDarkvision(baseLight, distFeet, darkvisionFeet);

        // A cell is visible if illuminated (bright or dim) or darkvision penetrates darkness
        if (effLight !== 'darkness' || baseLight !== 'darkness') {
          isVisible = true;
          const rank = effLight === 'bright' ? 2 : effLight === 'dim' ? 1 : 0;
          if (rank > bestLightRank) {
            bestLightRank = rank;
          }
        }
      }
    }

    if (isVisible) {
      const effectiveLight: LightLevel =
        bestLightRank === 2 ? 'bright' : bestLightRank === 1 ? 'dim' : 'darkness';
      visibleMap.set(`${cell.x},${cell.y}`, { effectiveLight });
    }
  }

  return visibleMap;
}

/**
 * Projects the authoritative GameState into a Fog-of-War filtered PlayerViewState.
 * - Computes union of visible cells across player's party members.
 * - Marks cells 'unexplored', 'remembered', or 'visible'.
 * - Strips monsters located in 'unexplored' or 'remembered' fog.
 * - Strips hidden traps/secret doors that have not been discovered.
 * - Strips authoritative RNG state.
 */
export function projectPlayerView(
  state: GameState,
  playerId: string,
  options: ProjectPlayerViewOptions = {},
): PlayerViewState {
  const sharedVision = options.sharedVision ?? true;
  const maxVisionRangeFeet = options.maxVisionRangeFeet ?? 120;

  const slot =
    state.slots.find((s) => s.playerId === playerId) ??
    state.slots[0] ?? {
      playerId,
      displayName: 'Player',
      controlledCharacterIds: Object.keys(state.party),
    };

  const controlledIds = new Set(slot.controlledCharacterIds);

  // 1. Identify Vision Observers
  const partyCombatants = Object.values(
    state.combat?.combatants ?? state.party,
  ).filter((c) => c.side === 'party');

  const observers = sharedVision
    ? partyCombatants
    : partyCombatants.filter((c) => controlledIds.has(c.id));

  // 2. Compute Visible Grid Cells
  const visibleCells = computeVisibleGridCells(
    state.grid,
    observers,
    state.lightSources,
    maxVisionRangeFeet,
  );

  // 3. Build PlayerViewGrid
  const viewCells: PlayerViewCell[] = state.grid.cells.map((cell) => {
    const key = `${cell.x},${cell.y}`;
    const visInfo = visibleCells.get(key);

    if (visInfo) {
      return {
        x: cell.x,
        y: cell.y,
        visibility: 'visible',
        terrain: cell.terrain,
        effectiveLight: visInfo.effectiveLight,
        elevationFeet: cell.elevationFeet,
        difficultTerrain: cell.difficultTerrain,
        blocksMovement: cell.blocksMovement,
        blocksSight: cell.blocksSight,
      };
    }

    if (state.exploredCells[key]) {
      return {
        x: cell.x,
        y: cell.y,
        visibility: 'remembered',
        terrain: cell.terrain,
        elevationFeet: cell.elevationFeet,
        blocksMovement: cell.blocksMovement,
        blocksSight: cell.blocksSight,
      };
    }

    return {
      x: cell.x,
      y: cell.y,
      visibility: 'unexplored',
    };
  });

  const playerViewGrid: PlayerViewGrid = {
    width: state.grid.width,
    height: state.grid.height,
    cells: viewCells,
  };

  // 4. Filter Combatants & Party
  const partyView: Record<string, PlayerViewCombatant> = {};
  for (const [id, c] of Object.entries(state.party)) {
    partyView[id] = toPlayerViewCombatant(c);
  }

  const combatantsView: Record<string, PlayerViewCombatant> = {};
  const allCombatants = state.combat
    ? Object.values(state.combat.combatants)
    : [...Object.values(state.party), ...Object.values(state.monsters)];

  const visibleMonsterIds = new Set<string>();

  for (const c of allCombatants) {
    if (c.side === 'party' || controlledIds.has(c.id)) {
      combatantsView[c.id] = toPlayerViewCombatant(c);
      continue;
    }

    // Hostile monsters or neutral entities must occupy at least one visible cell
    const footprint = getCreatureFootprintPoints(c.position, c.size);
    const isVisible = footprint.some((pt) => visibleCells.has(`${pt.x},${pt.y}`));

    if (isVisible) {
      visibleMonsterIds.add(c.id);
      combatantsView[c.id] = toPlayerViewCombatant(c);
    }
  }

  // 5. Filter Interactive Props
  const propsView: PlayerViewProp[] = [];
  for (const prop of state.props) {
    const key = `${prop.x},${prop.y}`;
    const isVisible = visibleCells.has(key);
    const isRemembered = state.exploredCells[key] === true;

    // Stripped if unexplored
    if (!isVisible && !isRemembered) {
      continue;
    }

    // Stripped if hidden trap or secret door not yet discovered
    const isHiddenSecret =
      (prop.kind === 'trap' || prop.kind === 'secret_door') &&
      prop.detectionDc !== undefined &&
      prop.discovered !== true;

    if (isHiddenSecret) {
      continue;
    }

    propsView.push({
      id: prop.id,
      x: prop.x,
      y: prop.y,
      kind: prop.kind,
      state: prop.state,
      blocksMovement: prop.blocksMovement,
      blocksSight: prop.blocksSight,
      shrineType: prop.shrineType,
    });
  }

  // 6. Filter Combat State
  let combatView: PlayerViewCombatState | null = null;
  if (state.combat) {
    const activeCombatantId = state.combat.activeCombatantId;
    const isMyTurn = activeCombatantId ? controlledIds.has(activeCombatantId) : false;

    const pendingPrompt = state.combat.pendingReactionPrompt;
    const isMyReaction = pendingPrompt
      ? controlledIds.has(pendingPrompt.reactorEntityId)
      : false;

    const initiativeOrder = state.combat.initiativeOrder.map((entry) => ({
      entityId: entry.entityId,
      initiative: entry.initiative,
      isVisible: controlledIds.has(entry.entityId) || visibleMonsterIds.has(entry.entityId),
    }));

    // Filter hazard zones: keep zones intersecting at least one visible cell
    const visibleHazardZones = Object.values(state.combat.hazardZones ?? {}).filter((zone) =>
      zone.cells.some((c) => visibleCells.has(`${c.x},${c.y}`)),
    );

    combatView = {
      encounterId: state.combat.encounterId,
      round: state.combat.round,
      phase: state.combat.phase,
      initiativeOrder,
      activeCombatantId,
      turnBudget: isMyTurn ? state.combat.turnBudget : null,
      outcome: state.combat.outcome,
      pendingReactionPrompt: isMyReaction ? pendingPrompt : null,
      hazardZones: visibleHazardZones,
    };
  }

  return {
    playerId: slot.playerId,
    mode: state.mode,
    grid: playerViewGrid,
    party: partyView,
    combatants: combatantsView,
    props: propsView,
    combat: combatView,
  };
}
