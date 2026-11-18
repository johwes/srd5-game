import {
  type Combatant,
} from '../combat/types.js';
import {
  type GridCell,
  type GridPoint,
  type TacticalGrid,
  setGridCell,
} from '../grid/model.js';
import {
  type GameEvent,
  type GameState,
  type InteractiveProp,
  type PlayerSlotAssignment,
} from '../state/types.js';
import { updateExploredCells } from '../state/reducer.js';
import {
  type DungeonFloorSpec,
  type DungeonRoomSpec,
  type MarchingFormation,
  type MarchingOrderConfig,
  DungeonFloorSpecSchema,
} from './schemas.js';

/**
 * Runtime state of a logical dungeon room on a floor.
 */
export interface DungeonRoomState {
  id: string;
  name: string;
  description?: string;
  isSafeRoom: boolean;
  discovered: boolean;
  explored: boolean;
  cleared: boolean;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  cellCount: number;
  exploredCellCount: number;
}

/**
 * Authoritative multi-room dungeon floor state on the engine.
 */
export interface DungeonFloorState {
  floorId: string;
  name: string;
  width: number;
  height: number;
  rooms: Record<string, DungeonRoomState>;
  encounters: DungeonFloorSpec['encounters'];
  partySpawnCells: GridPoint[];
}

/**
 * Initializes runtime multi-room floor state from a DungeonFloorSpec.
 */
export function initDungeonFloorState(spec: DungeonFloorSpec): DungeonFloorState {
  const rooms: Record<string, DungeonRoomState> = {};

  // First, initialize declared rooms from spec
  if (spec.rooms) {
    for (const r of spec.rooms) {
      rooms[r.id] = {
        id: r.id,
        name: r.name,
        description: r.description,
        isSafeRoom: r.isSafeRoom ?? false,
        discovered: false,
        explored: false,
        cleared: false,
        bounds: r.bounds
          ? {
              minX: r.bounds.x,
              minY: r.bounds.y,
              maxX: r.bounds.x + r.bounds.width - 1,
              maxY: r.bounds.y + r.bounds.height - 1,
            }
          : undefined,
        cellCount: 0,
        exploredCellCount: 0,
      };
    }
  }

  // Scan cells to count cells per room and calculate/adjust bounds
  for (const c of spec.cells) {
    if (!c.roomId) continue;

    if (!rooms[c.roomId]) {
      rooms[c.roomId] = {
        id: c.roomId,
        name: `Room ${c.roomId}`,
        isSafeRoom: false,
        discovered: false,
        explored: false,
        cleared: false,
        cellCount: 0,
        exploredCellCount: 0,
      };
    }

    const room = rooms[c.roomId]!;
    room.cellCount += 1;

    if (!room.bounds) {
      room.bounds = { minX: c.x, minY: c.y, maxX: c.x, maxY: c.y };
    } else {
      room.bounds.minX = Math.min(room.bounds.minX, c.x);
      room.bounds.minY = Math.min(room.bounds.minY, c.y);
      room.bounds.maxX = Math.max(room.bounds.maxX, c.x);
      room.bounds.maxY = Math.max(room.bounds.maxY, c.y);
    }
  }

  return {
    floorId: spec.id,
    name: spec.name,
    width: spec.width,
    height: spec.height,
    rooms,
    encounters: structuredClone(spec.encounters),
    partySpawnCells: spec.partySpawnCells.map((p) => ({ x: p.x, y: p.y })),
  };
}

export interface CreateDungeonGameOptions {
  id?: string;
  floor: DungeonFloorSpec;
  party: Combatant[];
  marchingOrder?: string[];
  formation?: MarchingFormation;
  leadExplorerId?: string;
  slots?: PlayerSlotAssignment[];
  rngState?: number;
  partyInStealth?: boolean;
}

/**
 * Creates an authoritative GameState initialized with a DungeonFloorSpec in Exploration mode.
 */
export function createDungeonGameState(options: CreateDungeonGameOptions): GameState {
  const floor = DungeonFloorSpecSchema.parse(options.floor);

  // Build grid cells
  const cellMap = new Map<string, GridCell>();
  for (const c of floor.cells) {
    cellMap.set(`${c.x},${c.y}`, {
      x: c.x,
      y: c.y,
      roomId: c.roomId,
      terrain: c.terrain,
      baseLight: c.baseLight,
      elevationFeet: c.elevationFeet ?? 0,
      blocksMovement: false,
      blocksSight: false,
    });
  }

  // Ensure full width x height grid cells exist (fill missing with void)
  const fullCells: GridCell[] = [];
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const existing = cellMap.get(`${x},${y}`);
      if (existing) {
        fullCells.push(existing);
      } else {
        fullCells.push({
          x,
          y,
          terrain: 'void',
          baseLight: 'darkness',
          elevationFeet: 0,
          blocksMovement: true,
          blocksSight: true,
        });
      }
    }
  }

  let grid: TacticalGrid = {
    width: floor.width,
    height: floor.height,
    cells: fullCells,
  };

  // Build interactive props and update grid blockers
  const props: InteractiveProp[] = [];
  for (const p of floor.props) {
    props.push({
      id: p.id,
      x: p.x,
      y: p.y,
      kind: p.kind,
      state: p.state,
      shrineType: p.shrineType,
      blocksMovement: p.blocksMovement ?? false,
      blocksSight: p.blocksSight ?? false,
      lockDc: p.lockDc,
      detectionDc: p.detectionDc,
      disarmDc: p.disarmDc,
      listenDc: p.listenDc,
      discovered: p.discovered ?? (p.detectionDc === undefined),
      ac: p.ac,
      hp: p.hp,
      maxHp: p.hp,
      trapDamageFormula: p.trapDamageFormula,
      trapDamageType: p.trapDamageType,
      trapSaveDc: p.trapSaveDc,
      trapSaveAbility: p.trapSaveAbility,
      trapHalfDamageOnSave: p.trapHalfDamageOnSave,
      lootTable: p.lootTable ? structuredClone(p.lootTable) : undefined,
    });

    if (p.blocksMovement || p.blocksSight) {
      grid = setGridCell(grid, {
        x: p.x,
        y: p.y,
        blocksMovement: p.blocksMovement,
        blocksSight: p.blocksSight,
      });
    }
  }

  // Establish marching order
  const partyIds = options.party.map((p) => p.id);
  const order = options.marchingOrder && options.marchingOrder.length > 0
    ? options.marchingOrder
    : partyIds;
  const leadExplorerId = options.leadExplorerId ?? order[0] ?? partyIds[0] ?? 'hero-1';
  const formation: MarchingFormation = options.formation ?? 'single_file';

  const marchingConfig: MarchingOrderConfig = {
    order,
    formation,
    leadExplorerId,
  };

  // Position party members according to spawn cells
  const partyMap: Record<string, Combatant> = {};
  for (let i = 0; i < options.party.length; i++) {
    const raw = options.party[i]!;
    const spawnPoint = floor.partySpawnCells[i] ?? floor.partySpawnCells[0] ?? { x: 0, y: 0 };
    const cell = cellMap.get(`${spawnPoint.x},${spawnPoint.y}`);

    partyMap[raw.id] = {
      ...raw,
      side: 'party',
      position: { x: spawnPoint.x, y: spawnPoint.y },
      roomId: cell?.roomId,
    };
  }

  const dungeonState = initDungeonFloorState(floor);

  const slots = options.slots ?? [
    {
      playerId: 'player-1',
      displayName: 'Party Leader',
      controlledCharacterIds: partyIds,
    },
  ];

  let state: GameState = {
    id: options.id ?? `dungeon-${floor.id}-${Date.now()}`,
    mode: 'exploration',
    grid,
    combat: null,
    party: partyMap,
    monsters: {},
    props,
    lightSources: [],
    exploredCells: {},
    slots,
    rngState: options.rngState ?? 123456789,
    dungeon: dungeonState,
    marchingOrder: marchingConfig,
    partyInStealth: options.partyInStealth ?? false,
  };

  // Seed fog of war explored cells from initial party positions
  state = updateExploredCells(state);

  // Discover initial rooms containing explored cells
  const discoveryResult = updateDungeonRoomDiscovery(state);
  return discoveryResult.nextState;
}

/**
 * Checks all rooms against the current exploredCells and updates discovered/explored state.
 */
export function updateDungeonRoomDiscovery(state: GameState): {
  nextState: GameState;
  events: GameEvent[];
} {
  if (!state.dungeon) {
    return { nextState: state, events: [] };
  }

  const events: GameEvent[] = [];
  const nextRooms = { ...state.dungeon.rooms };

  // Count explored cells per room
  const exploredCounts: Record<string, number> = {};
  for (const cellKey of Object.keys(state.exploredCells)) {
    const [xs, ys] = cellKey.split(',');
    if (xs === undefined || ys === undefined) continue;
    const x = parseInt(xs, 10);
    const y = parseInt(ys, 10);
    const gridCell = state.grid.cells[y * state.grid.width + x];
    if (gridCell?.roomId) {
      exploredCounts[gridCell.roomId] = (exploredCounts[gridCell.roomId] ?? 0) + 1;
    }
  }

  for (const [roomId, room] of Object.entries(nextRooms)) {
    const count = exploredCounts[roomId] ?? 0;
    const updated = { ...room, exploredCellCount: count };

    if (count > 0 && !updated.discovered) {
      updated.discovered = true;
      events.push({
        type: 'ROOM_DISCOVERED',
        roomId: updated.id,
        roomName: updated.name,
      });
    }

    if (updated.cellCount > 0 && count >= updated.cellCount && !updated.explored) {
      updated.explored = true;
    }

    nextRooms[roomId] = updated;
  }

  return {
    nextState: {
      ...state,
      dungeon: {
        ...state.dungeon,
        rooms: nextRooms,
      },
    },
    events,
  };
}
