import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type DungeonFloorSpec,
  DungeonFloorSpecSchema,
  createDungeonGameState,
  reduceGame,
} from '../index.js';

function makePartyMember(
  id: string,
  name: string,
  x = 0,
  y = 0,
  passivePerception = 10,
): Combatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception,
    stealthModifier: 2,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
  };
}

function createSampleFloorSpec(): DungeonFloorSpec {
  const width = 12;
  const height = 12;
  const cells: DungeonFloorSpec['cells'] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Perimeter walls
      const isWall = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      // Dividing wall between room 1 (x: 1..5) and room 2 (x: 7..10), with doorway at (6, 5)
      const isDividingWall = x === 6 && y !== 5;

      let roomId: string | undefined;
      if (x >= 1 && x <= 5) roomId = 'room_entry';
      else if (x >= 7 && x <= 10) roomId = 'room_hallway';

      cells.push({
        x,
        y,
        roomId,
        terrain: isWall || isDividingWall ? 'wall_solid' : 'floor_stone',
        baseLight: 'bright',
        elevationFeet: 0,
      });
    }
  }

  return {
    id: 'floor_test_1',
    name: 'The Sunken Crypt - Floor 1',
    width,
    height,
    partySpawnCells: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
    cells,
    props: [
      {
        id: 'door_1',
        x: 6,
        y: 5,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
        lockDc: 12,
      },
    ],
    encounters: [
      {
        id: 'enc_1',
        roomId: 'room_hallway',
        triggered: false,
        monsters: [
          { monsterId: 'goblin', spawnX: 8, spawnY: 5 },
        ],
      },
    ],
    rooms: [
      {
        id: 'room_entry',
        name: 'Entry Antechamber',
        description: 'A damp stone room with ancient moss.',
        isSafeRoom: true,
      },
      {
        id: 'room_hallway',
        name: 'Guard Hallway',
        description: 'A long corridor patrolled by sentries.',
        isSafeRoom: false,
      },
    ],
  };
}

describe('SRD-501: DungeonFloorSpec schema, multi-room state & marching order', () => {
  describe('1. DungeonFloorSpecSchema validation', () => {
    it('validates a complete, correctly formatted DungeonFloorSpec', () => {
      const spec = createSampleFloorSpec();
      const parsed = DungeonFloorSpecSchema.parse(spec);
      expect(parsed.id).toBe('floor_test_1');
      expect(parsed.width).toBe(12);
      expect(parsed.height).toBe(12);
      expect(parsed.partySpawnCells).toHaveLength(4);
      expect(parsed.rooms).toHaveLength(2);
      expect(parsed.props).toHaveLength(1);
    });

    it('rejects an invalid floor specification (missing spawn cells or negative dimensions)', () => {
      const invalidSpec = {
        id: 'bad_floor',
        name: 'Broken',
        width: -5,
        height: 10,
        partySpawnCells: [],
        cells: [],
      };
      const result = DungeonFloorSpecSchema.safeParse(invalidSpec);
      expect(result.success).toBe(false);
    });
  });

  describe('2. createDungeonGameState initialization', () => {
    it('initializes game state with grid, props, party placement, and room state', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_cleric', 'Kyra'),
        makePartyMember('hero_rogue', 'Merisiel'),
        makePartyMember('hero_wizard', 'Ezren'),
      ];

      const state = createDungeonGameState({
        floor: spec,
        party,
        formation: 'single_file',
      });

      expect(state.mode).toBe('exploration');
      expect(state.dungeon).toBeDefined();
      expect(state.dungeon?.floorId).toBe('floor_test_1');
      expect(state.dungeon?.name).toBe('The Sunken Crypt - Floor 1');
      expect(state.marchingOrder?.formation).toBe('single_file');
      expect(state.marchingOrder?.leadExplorerId).toBe('hero_fighter');

      // Party members placed on spawn cells
      expect(state.party['hero_fighter']?.position).toEqual({ x: 2, y: 2 });
      expect(state.party['hero_cleric']?.position).toEqual({ x: 2, y: 3 });
      expect(state.party['hero_rogue']?.position).toEqual({ x: 3, y: 2 });
      expect(state.party['hero_wizard']?.position).toEqual({ x: 3, y: 3 });

      // Room tracking initialized
      expect(state.party['hero_fighter']?.roomId).toBe('room_entry');
      const entryRoom = state.dungeon?.rooms['room_entry'];
      expect(entryRoom).toBeDefined();
      expect(entryRoom?.discovered).toBe(true);
      expect(entryRoom?.isSafeRoom).toBe(true);

      // Connected hallway behind closed door should not yet be discovered
      const hallway = state.dungeon?.rooms['room_hallway'];
      expect(hallway).toBeDefined();
      expect(hallway?.discovered).toBe(false);

      // Door prop blocks movement on the grid
      const doorCell = state.grid.cells[5 * state.grid.width + 6];
      expect(doorCell?.blocksMovement).toBe(true);
      expect(doorCell?.blocksSight).toBe(true);
    });
  });

  describe('3. Marching Order Movement in Exploration Mode', () => {
    it('moves followers in single_file formation trailing behind the leader', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_cleric', 'Kyra'),
        makePartyMember('hero_rogue', 'Merisiel'),
        makePartyMember('hero_wizard', 'Ezren'),
      ];

      const initial = createDungeonGameState({
        floor: spec,
        party,
        formation: 'single_file',
        marchingOrder: ['hero_fighter', 'hero_cleric', 'hero_rogue', 'hero_wizard'],
      });

      // Leader moves from (2,2) -> (3,2) -> (4,2) -> (5,2)
      const moveResult = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_fighter',
        path: [
          { x: 3, y: 2 },
          { x: 4, y: 2 },
          { x: 5, y: 2 },
        ],
      });

      // Leader ends at (5,2)
      expect(moveResult.nextState.party['hero_fighter']?.position).toEqual({ x: 5, y: 2 });

      // In single file trail, followers step into previous leader positions:
      // Follower 1 (Cleric) takes 1 step behind leader: (4,2)
      expect(moveResult.nextState.party['hero_cleric']?.position).toEqual({ x: 4, y: 2 });
      // Follower 2 (Rogue) takes 2 steps behind leader: (3,2)
      expect(moveResult.nextState.party['hero_rogue']?.position).toEqual({ x: 3, y: 2 });
      // Follower 3 (Wizard) takes 3 steps behind leader: (2,2)
      expect(moveResult.nextState.party['hero_wizard']?.position).toEqual({ x: 2, y: 2 });

      // Check emitted ENTITY_MOVED events for all moving party members (Leader, Cleric, Wizard moved; Rogue was already at (3,2))
      const movedEvents = moveResult.events.filter((e) => e.type === 'ENTITY_MOVED');
      expect(movedEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('moves followers in two_by_two box formation flanking and trailing the leader', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_cleric', 'Kyra'),
        makePartyMember('hero_rogue', 'Merisiel'),
        makePartyMember('hero_wizard', 'Ezren'),
      ];

      const initial = createDungeonGameState({
        floor: spec,
        party,
        formation: 'two_by_two',
        marchingOrder: ['hero_fighter', 'hero_cleric', 'hero_rogue', 'hero_wizard'],
      });

      // Leader moves east from (2,2) to (3,2)
      const moveResult = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_fighter',
        path: [{ x: 3, y: 2 }],
      });

      // In two_by_two facing east:
      // Leader: (3, 2)
      // Slot 1 (Kyra): Flank at lead + right = (3, 3)
      // Slot 2 (Merisiel): Rear left at lead + behind = (2, 2)
      // Slot 3 (Ezren): Rear right at lead + behind + right = (2, 3)
      expect(moveResult.nextState.party['hero_fighter']?.position).toEqual({ x: 3, y: 2 });
      expect(moveResult.nextState.party['hero_cleric']?.position).toEqual({ x: 3, y: 3 });
      expect(moveResult.nextState.party['hero_rogue']?.position).toEqual({ x: 2, y: 2 });
      expect(moveResult.nextState.party['hero_wizard']?.position).toEqual({ x: 2, y: 3 });
    });

    it('allows reconfiguring marching order and formation via SET_MARCHING_ORDER', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_rogue', 'Merisiel'),
      ];

      const initial = createDungeonGameState({ floor: spec, party });

      const setOrderRes = reduceGame(initial, {
        type: 'SET_MARCHING_ORDER',
        marchingOrder: ['hero_rogue', 'hero_fighter'],
        formation: 'two_by_two',
        leadExplorerId: 'hero_rogue',
      });

      expect(setOrderRes.nextState.marchingOrder?.leadExplorerId).toBe('hero_rogue');
      expect(setOrderRes.nextState.marchingOrder?.formation).toBe('two_by_two');
      expect(setOrderRes.nextState.marchingOrder?.order).toEqual(['hero_rogue', 'hero_fighter']);

      const changedEvent = setOrderRes.events.find((e) => e.type === 'MARCHING_ORDER_CHANGED');
      expect(changedEvent).toBeDefined();
    });

    it('allows moving an individual hero freely when followMarchingOrder is false', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_rogue', 'Merisiel'),
      ];

      const initial = createDungeonGameState({ floor: spec, party });

      // Move rogue scout alone
      const scoutMove = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_rogue',
        path: [{ x: 3, y: 3 }, { x: 4, y: 3 }],
        followMarchingOrder: false,
      });

      // Rogue moved
      expect(scoutMove.nextState.party['hero_rogue']?.position).toEqual({ x: 4, y: 3 });
      // Fighter stayed at spawn
      expect(scoutMove.nextState.party['hero_fighter']?.position).toEqual({ x: 2, y: 2 });
    });
  });

  describe('4. Multi-room discovery & room entry events', () => {
    it('discovers rooms and emits ROOM_DISCOVERED and ROOM_ENTERED as party opens doors and enters', () => {
      const spec = createSampleFloorSpec();
      const party = [
        makePartyMember('hero_fighter', 'Valeros'),
        makePartyMember('hero_rogue', 'Merisiel'),
      ];

      let state = createDungeonGameState({ floor: spec, party });
      expect(state.dungeon?.rooms['room_hallway']?.discovered).toBe(false);

      // Move leader close to the door at (6, 5)
      state = reduceGame(state, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_fighter',
        path: [
          { x: 3, y: 2 },
          { x: 4, y: 3 },
          { x: 5, y: 4 },
          { x: 5, y: 5 },
        ],
      }).nextState;

      // Open the door at (6, 5)
      const openDoorRes = reduceGame(state, {
        type: 'INTERACT_PROP',
        actorId: 'hero_fighter',
        propId: 'door_1',
        interaction: 'open',
      });
      state = openDoorRes.nextState;

      // With the door open, LoS extends into room_hallway, discovering it!
      expect(state.dungeon?.rooms['room_hallway']?.discovered).toBe(true);
      const roomDiscEvent = openDoorRes.events.find(
        (e) => e.type === 'ROOM_DISCOVERED' && (e as any).roomId === 'room_hallway',
      );
      expect(roomDiscEvent).toBeDefined();

      // Step through the door into room_hallway at (7, 5)
      const enterHallwayRes = reduceGame(state, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_fighter',
        path: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
        ],
      });

      expect(enterHallwayRes.nextState.party['hero_fighter']?.roomId).toBe('room_hallway');
      const roomEnteredEvent = enterHallwayRes.events.find(
        (e) => e.type === 'ROOM_ENTERED' && (e as any).roomId === 'room_hallway',
      );
      expect(roomEnteredEvent).toBeDefined();
    });
  });

  describe('5. Passive Perception & Trap Halting', () => {
    it('halts party movement immediately when a hidden trap is detected within 15ft with LoS', () => {
      const spec = createSampleFloorSpec();
      // Add a hidden pressure-plate trap at (4, 2)
      spec.props.push({
        id: 'trap_spear_1',
        x: 4,
        y: 2,
        kind: 'trap',
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
        detectionDc: 12,
        trapDamageFormula: '2d6',
        discovered: false,
      });

      // Hero has high passive perception (14 >= 12)
      const party = [
        makePartyMember('hero_ranger', 'Strider', 2, 2, 14),
      ];

      const initial = createDungeonGameState({ floor: spec, party });
      expect(initial.props.find((p) => p.id === 'trap_spear_1')?.discovered).toBe(false);

      // Hero attempts to walk through (3, 2) and (4, 2) and (5, 2)
      const moveRes = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_ranger',
        path: [
          { x: 3, y: 2 },
          { x: 4, y: 2 },
          { x: 5, y: 2 },
        ],
      });

      // Trap should be discovered!
      const trap = moveRes.nextState.props.find((p) => p.id === 'trap_spear_1');
      expect(trap?.discovered).toBe(true);

      // SECRET_DISCOVERED event should be emitted
      const secretEvent = moveRes.events.find((e) => e.type === 'SECRET_DISCOVERED');
      expect(secretEvent).toBeDefined();
      expect((secretEvent as any).propId).toBe('trap_spear_1');

      // Movement halts immediately at (3, 2), before stepping onto the trap at (4, 2)!
      const haltEvent = moveRes.events.find((e) => e.type === 'MOVEMENT_HALTED');
      expect(haltEvent).toBeDefined();
      expect((haltEvent as any).reason).toBe('trap_detected');
      expect((haltEvent as any).at).toEqual({ x: 3, y: 2 });

      expect(moveRes.nextState.party['hero_ranger']?.position).toEqual({ x: 3, y: 2 });
      // Trap remains untriggered and hero takes 0 damage
      expect(trap?.state).toBe('closed');
      expect(moveRes.nextState.party['hero_ranger']?.currentHp).toBe(20);
    });

    it('triggers trap and applies damage when hero with low Passive Perception steps on it', () => {
      const spec = createSampleFloorSpec();
      spec.props.push({
        id: 'trap_pit_1',
        x: 4,
        y: 2,
        kind: 'trap',
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
        detectionDc: 15,
        trapDamageFormula: '1d6+2',
        discovered: false,
      });

      // Hero has low passive perception (9 < 15)
      const party = [
        makePartyMember('hero_barbarian', 'Conan', 2, 2, 9),
      ];

      const initial = createDungeonGameState({ floor: spec, party, rngState: 42 });

      // Barbarian walks through the trap cell at (4, 2)
      const moveRes = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero_barbarian',
        path: [
          { x: 3, y: 2 },
          { x: 4, y: 2 },
          { x: 5, y: 2 },
        ],
      });

      // Trap triggers on (4, 2)
      const trap = moveRes.nextState.props.find((p) => p.id === 'trap_pit_1');
      expect(trap?.state).toBe('triggered');
      expect(trap?.discovered).toBe(true);

      const trapTriggerEvent = moveRes.events.find((e) => e.type === 'TRAP_TRIGGERED');
      expect(trapTriggerEvent).toBeDefined();
      expect((trapTriggerEvent as any).targetId).toBe('hero_barbarian');
      expect((trapTriggerEvent as any).damage).toBeGreaterThan(0);

      // Barbarian took damage
      expect(moveRes.nextState.party['hero_barbarian']?.currentHp).toBeLessThan(20);

      // Movement halted at trap cell (4, 2)
      expect(moveRes.nextState.party['hero_barbarian']?.position).toEqual({ x: 4, y: 2 });
    });
  });
});
