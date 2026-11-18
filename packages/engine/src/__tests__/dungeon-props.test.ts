import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type DungeonFloorSpec,
  createDungeonGameState,
  reduceGame,
} from '../index.js';
import {
  checkPassivePerceptionForProps,
  getActorCheckBonus,
  getAvailablePropInteractions,
  isAdjacent,
  resolveActiveSearch,
  resolvePropInteraction,
  triggerTrapEffect,
} from '../dungeon/props.js';
import { rollD20 } from '../dice/evaluator.js';

function makePartyMember(options: {
  id: string;
  name: string;
  x?: number;
  y?: number;
  passivePerception?: number;
  currentHp?: number;
  maxHp?: number;
  dexScore?: number;
  dexMod?: number;
  strScore?: number;
  strMod?: number;
  tools?: string[];
  expertise?: string[];
  skills?: Record<string, { totalBonus: number }>;
  savingThrows?: Record<string, { totalBonus: number }>;
}): Combatant {
  const dexMod = options.dexMod ?? Math.floor(((options.dexScore ?? 14) - 10) / 2);
  const strMod = options.strMod ?? Math.floor(((options.strScore ?? 10) - 10) / 2);
  const hp = options.currentHp ?? options.maxHp ?? 20;

  return {
    id: options.id,
    name: options.name,
    side: 'party',
    size: 'medium',
    position: { x: options.x ?? 0, y: options.y ?? 0 },
    speedFeet: 30,
    currentHp: hp,
    maxHp: options.maxHp ?? 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: options.dexScore ?? 14,
    dexterityModifier: dexMod,
    strengthScore: options.strScore ?? 10,
    strengthModifier: strMod,
    initiativeBonus: dexMod,
    initiativeRollMode: 'normal',
    passivePerception: options.passivePerception ?? 12,
    stealthModifier: dexMod,
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
    characterSheet: {
      abilities: {
        str: { score: options.strScore ?? 10, modifier: strMod },
        dex: { score: options.dexScore ?? 14, modifier: dexMod },
        con: { score: 14, modifier: 2 },
        int: { score: 12, modifier: 1 },
        wis: { score: 14, modifier: 2 },
        cha: { score: 10, modifier: 0 },
      },
      proficiencyBonus: 2,
      proficiencies: {
        tools: options.tools ?? [],
        expertise: options.expertise ?? [],
        skills: [],
        armor: [],
        weapons: [],
        savingThrows: [],
      },
      skills: (options.skills ?? {
        perception: { totalBonus: (options.passivePerception ?? 12) - 10 },
        investigation: { totalBonus: 1 },
        athletics: { totalBonus: strMod },
      }) as any,
      savingThrows: (options.savingThrows ?? {
        str: { totalBonus: strMod },
        dex: { totalBonus: dexMod },
        con: { totalBonus: 2 },
        int: { totalBonus: 1 },
        wis: { totalBonus: 2 },
        cha: { totalBonus: 0 },
      }) as any,
      weaponAttacks: [
        {
          weaponId: 'shortsword',
          name: 'Shortsword',
          toHitBonus: dexMod + 2,
          damageFormula: `1d6+${dexMod}`,
          damageType: 'piercing',
          reachFeet: 5,
        } as any,
      ],
    } as any,
  };
}

function makeTestFloor(
  props: Array<Partial<DungeonFloorSpec['props'][number]> & { id: string; x: number; y: number; kind: any }> = [],
  partySpawnCells: Array<{ x: number; y: number }> = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ],
): DungeonFloorSpec {
  const width = 10;
  const height = 10;
  const cells: DungeonFloorSpec['cells'] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      cells.push({
        x,
        y,
        roomId: 'room_main',
        terrain: isWall ? 'wall_solid' : 'floor_stone',
        baseLight: 'bright',
        elevationFeet: 0,
      });
    }
  }

  const normalizedProps: DungeonFloorSpec['props'] = props.map((p) => ({
    state: 'closed',
    blocksMovement: false,
    blocksSight: false,
    ...p,
  }));

  return {
    id: 'floor_props_test',
    name: 'Interactive Props Test Floor',
    width,
    height,
    partySpawnCells,
    cells,
    props: normalizedProps,
    encounters: [],
    rooms: [
      {
        id: 'room_main',
        name: 'Main Chamber',
        description: 'Test Room',
        isSafeRoom: false,
      },
    ],
  };
}

describe('SRD-502: Interactive Props Engine', () => {
  describe('1. Adjacency and Check Bonus Utilities', () => {
    it('correctly calculates Chebyshev adjacency (within 5 feet / 1 cell)', () => {
      expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true);
      expect(isAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true); // diagonal 5ft
      expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(true); // same cell
      expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 3 })).toBe(false); // 2 cells away
      expect(isAdjacent({ x: 1, y: 1 }, { x: 3, y: 3 })).toBe(false);
    });

    it('calculates thieves tools bonus with proficiency and expertise', () => {
      const rogueProf = makePartyMember({
        id: 'rogue_1',
        name: 'Rogue Proficient',
        dexMod: 3,
        tools: ['thieves_tools'],
      });
      // DEX 3 + prof 2 = 5
      expect(getActorCheckBonus(rogueProf, 'thieves_tools')).toBe(5);

      const rogueExpert = makePartyMember({
        id: 'rogue_2',
        name: 'Rogue Expert',
        dexMod: 3,
        tools: ['thieves_tools'],
        expertise: ['thieves_tools'],
      });
      // DEX 3 + prof 2 * 2 = 7
      expect(getActorCheckBonus(rogueExpert, 'thieves_tools')).toBe(7);

      const fighterUnprof = makePartyMember({
        id: 'fighter',
        name: 'Fighter',
        dexMod: 1,
        tools: [],
      });
      // Only DEX mod
      expect(getActorCheckBonus(fighterUnprof, 'thieves_tools')).toBe(1);
    });
  });

  describe('2. Standard Doors (Open / Close)', () => {
    it('opens and closes an unlocked door, updating blocksMovement, blocksSight, and grid cells', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'door_1',
            x: 2,
            y: 2,
            kind: 'door',
            state: 'closed',
            blocksMovement: true,
            blocksSight: true,
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const party = [makePartyMember({ id: 'hero_1', name: 'Hero' })];
      const state = createDungeonGameState({ floor, party });

      // Initially closed and blocks
      expect(state.props[0].state).toBe('closed');
      expect(state.props[0].blocksMovement).toBe(true);
      expect(state.grid.cells[2 * 10 + 2].blocksMovement).toBe(true);

      // Open door
      const openRes = reduceGame(state, {
        type: 'INTERACT_PROP',
        actorId: 'hero_1',
        propId: 'door_1',
        interaction: 'open',
      });

      expect(openRes.nextState.props[0].state).toBe('open');
      expect(openRes.nextState.props[0].blocksMovement).toBe(false);
      expect(openRes.nextState.props[0].blocksSight).toBe(false);
      expect(openRes.nextState.grid.cells[2 * 10 + 2].blocksMovement).toBe(false);
      expect(openRes.nextState.grid.cells[2 * 10 + 2].blocksSight).toBe(false);
      expect(openRes.events).toContainEqual(
        expect.objectContaining({
          type: 'PROP_STATE_CHANGED',
          propId: 'door_1',
          prevState: 'closed',
          nextState: 'open',
          actorId: 'hero_1',
        }),
      );

      // Close door
      const closeRes = reduceGame(openRes.nextState, {
        type: 'INTERACT_PROP',
        actorId: 'hero_1',
        propId: 'door_1',
        interaction: 'close',
      });

      expect(closeRes.nextState.props[0].state).toBe('closed');
      expect(closeRes.nextState.props[0].blocksMovement).toBe(true);
      expect(closeRes.nextState.props[0].blocksSight).toBe(true);
      expect(closeRes.nextState.grid.cells[2 * 10 + 2].blocksMovement).toBe(true);
    });

    it('rejects opening a door if the actor is not adjacent', () => {
      const floor = makeTestFloor(
        [{ id: 'door_far', x: 5, y: 5, kind: 'door', state: 'closed', blocksMovement: true }],
        [{ x: 1, y: 1 }],
      );
      const party = [makePartyMember({ id: 'hero_1', name: 'Hero' })];
      const state = createDungeonGameState({ floor, party });

      expect(() =>
        reduceGame(state, {
          type: 'INTERACT_PROP',
          actorId: 'hero_1',
          propId: 'door_far',
          interaction: 'open',
        }),
      ).toThrow(/not adjacent/);
    });

    it('refuses to open a locked door without unlocking or forcing', () => {
      const floor = makeTestFloor(
        [{ id: 'door_locked', x: 2, y: 2, kind: 'door', state: 'locked', lockDc: 15 }],
        [{ x: 2, y: 1 }],
      );
      const party = [makePartyMember({ id: 'hero_1', name: 'Hero' })];
      const state = createDungeonGameState({ floor, party });

      expect(() =>
        reduceGame(state, {
          type: 'INTERACT_PROP',
          actorId: 'hero_1',
          propId: 'door_locked',
          interaction: 'open',
        }),
      ).toThrow(/is locked/);
    });
  });

  describe('3. Locked Chests & Lockpicking', () => {
    it('allows a proficient character to pick a lock and acquire loot on opening', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'chest_1',
            x: 2,
            y: 2,
            kind: 'chest',
            state: 'locked',
            lockDc: 10,
            lootTable: {
              cp: 50,
              sp: 20,
              gp: 10,
              items: ['potion_of_healing'],
            },
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const rogue = makePartyMember({
        id: 'rogue',
        name: 'Rogue',
        dexMod: 4,
        tools: ['thieves_tools'],
      });
      const state = createDungeonGameState({ floor, party: [rogue] });

      // Attempt pick_lock with DC 10 (modifier is +6 with prof 2, roll will succeed easily)
      let current = state;
      let picked = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        const res = reduceGame(current, {
          type: 'INTERACT_PROP',
          actorId: 'rogue',
          propId: 'chest_1',
          interaction: 'pick_lock',
        });
        current = res.nextState;
        const checkEvt = res.events.find(
          (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'thieves_tools',
        );
        expect(checkEvt).toBeDefined();

        if (current.props[0].state === 'closed') {
          picked = true;
          break;
        }
      }

      expect(picked).toBe(true);

      // Now open the unlocked chest
      const openRes = reduceGame(current, {
        type: 'INTERACT_PROP',
        actorId: 'rogue',
        propId: 'chest_1',
        interaction: 'open',
      });

      expect(openRes.nextState.props[0].state).toBe('open');
      const lootEvt = openRes.events.find((e) => e.type === 'LOOT_ACQUIRED');
      expect(lootEvt).toBeDefined();
      expect((lootEvt as any).loot.gp).toBe(10);
      expect((lootEvt as any).loot.items).toContain('potion_of_healing');
    });
  });

  describe('4. Forcing Open & Attacking Props', () => {
    it('forces open a locked chest via Athletics vs lockDc + 2', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'chest_sturdy',
            x: 2,
            y: 2,
            kind: 'chest',
            state: 'locked',
            lockDc: 10, // force DC = 12
            lootTable: { gp: 25 },
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const barb = makePartyMember({
        id: 'barb',
        name: 'Barbarian',
        strScore: 18,
        strMod: 4,
        skills: { athletics: { totalBonus: 6 } } as any,
      });
      let current = createDungeonGameState({ floor, party: [barb] });
      let forced = false;

      for (let i = 0; i < 5; i++) {
        const res = reduceGame(current, {
          type: 'INTERACT_PROP',
          actorId: 'barb',
          propId: 'chest_sturdy',
          interaction: 'force_open',
        });
        current = res.nextState;
        if (current.props[0].state === 'destroyed') {
          forced = true;
          expect(res.events).toContainEqual(
            expect.objectContaining({ type: 'LOOT_ACQUIRED' }),
          );
          break;
        }
      }

      expect(forced).toBe(true);
    });

    it('destroys a prop by attacking it until HP drops to 0', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'weak_door',
            x: 2,
            y: 2,
            kind: 'door',
            state: 'locked',
            ac: 10,
            hp: 8,
            blocksMovement: true,
            blocksSight: true,
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const fighter = makePartyMember({
        id: 'fighter',
        name: 'Fighter',
        dexMod: 3,
      });
      let current = createDungeonGameState({ floor, party: [fighter] });

      // Attack multiple times until destroyed
      for (let i = 0; i < 5; i++) {
        if (current.props[0].state === 'destroyed') break;
        const res = reduceGame(current, {
          type: 'INTERACT_PROP',
          actorId: 'fighter',
          propId: 'weak_door',
          interaction: 'attack',
        });
        current = res.nextState;
      }

      expect(current.props[0].state).toBe('destroyed');
      expect(current.props[0].blocksMovement).toBe(false);
      expect(current.props[0].blocksSight).toBe(false);
    });
  });

  describe('5. Secret Doors (Passive & Active Detection)', () => {
    it('cannot be opened before being discovered', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'secret_1',
            x: 2,
            y: 2,
            kind: 'secret_door',
            state: 'closed',
            detectionDc: 15,
            discovered: false,
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const hero = makePartyMember({ id: 'hero_1', name: 'Hero' });
      const state = createDungeonGameState({ floor, party: [hero] });

      expect(() =>
        reduceGame(state, {
          type: 'INTERACT_PROP',
          actorId: 'hero_1',
          propId: 'secret_1',
          interaction: 'open',
        }),
      ).toThrow(/Cannot open undiscovered secret door/);
    });

    it('detects a secret door via passive perception when moving within 15ft with line of sight', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'secret_hall',
            x: 5,
            y: 5,
            kind: 'secret_door',
            state: 'closed',
            detectionDc: 14,
            discovered: false,
          },
        ],
        [{ x: 1, y: 5 }],
      );
      // Ranger with Passive Perception 15 starting at (1, 5)
      const ranger = makePartyMember({
        id: 'ranger',
        name: 'Ranger',
        passivePerception: 15,
      });
      const state = createDungeonGameState({ floor, party: [ranger] });

      // Move ranger to (3, 5) which is within 2 cells (10ft) of (5, 5)
      const moveRes = reduceGame(state, {
        type: 'EXPLORE_MOVE',
        actorId: 'ranger',
        path: [
          { x: 2, y: 5 },
          { x: 3, y: 5 },
        ],
        followMarchingOrder: false,
      });

      expect(moveRes.nextState.props[0].discovered).toBe(true);
      expect(moveRes.events).toContainEqual(
        expect.objectContaining({
          type: 'SECRET_DISCOVERED',
          propId: 'secret_hall',
          finderId: 'ranger',
          kind: 'secret_door',
        }),
      );
    });

    it('detects a secret door via active EXPLORE_SEARCH roll', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'secret_vault',
            x: 3,
            y: 3,
            kind: 'secret_door',
            state: 'closed',
            detectionDc: 10,
            discovered: false,
          },
        ],
        [{ x: 2, y: 2 }],
      );
      const wizard = makePartyMember({
        id: 'wizard',
        name: 'Wizard',
        passivePerception: 8, // Low passive, won't auto-detect
        skills: {
          perception: { totalBonus: -1 },
          investigation: { totalBonus: 5 }, // High investigation
        } as any,
      });
      let current = createDungeonGameState({ floor, party: [wizard] });
      expect(current.props[0].discovered).toBe(false);

      const searchRes = reduceGame(current, {
        type: 'EXPLORE_SEARCH',
        actorId: 'wizard',
      });

      const checkEvt = searchRes.events.find(
        (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'investigation',
      );
      expect(checkEvt).toBeDefined();
      expect(searchRes.nextState.props[0].discovered).toBe(true);
    });
  });

  describe('6. Traps (Detection, Triggering, Disarming & Saves)', () => {
    it('halts party movement when passive perception detects a hidden trap within 15ft', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'pit_trap',
            x: 4,
            y: 2,
            kind: 'trap',
            state: 'closed',
            detectionDc: 12,
            discovered: false,
            trapDamageFormula: '1d6',
          },
        ],
        [{ x: 1, y: 2 }],
      );
      const cleric = makePartyMember({
        id: 'cleric',
        name: 'Cleric',
        passivePerception: 14,
      });
      const state = createDungeonGameState({ floor, party: [cleric] });

      // Move toward the trap to (5, 2) which would cross (4, 2)
      // Path: (2, 2) -> (3, 2) -> (4, 2) -> (5, 2)
      // At (2, 2), distance to (4, 2) is 2 cells (10ft <= 15ft) with LoS!
      const moveRes = reduceGame(state, {
        type: 'EXPLORE_MOVE',
        actorId: 'cleric',
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 4, y: 2 },
          { x: 5, y: 2 },
        ],
        followMarchingOrder: false,
      });

      // Party should have stopped before walking onto the trap
      expect(moveRes.nextState.props[0].discovered).toBe(true);
      expect(moveRes.events).toContainEqual(
        expect.objectContaining({
          type: 'MOVEMENT_HALTED',
          actorId: 'cleric',
          reason: 'trap_detected',
        }),
      );
      // Hero position is halted before (4, 2)
      expect(moveRes.nextState.party['cleric'].position.x).toBeLessThan(4);
    });

    it('triggers trap when stepped on directly without detection, rolling damage and saving throw', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'spear_trap',
            x: 2,
            y: 2,
            kind: 'trap',
            state: 'closed',
            discovered: true, // already revealed or stepping onto it
            trapDamageFormula: '2d6',
            trapDamageType: 'piercing',
            trapSaveDc: 12,
            trapSaveAbility: 'dex',
            trapHalfDamageOnSave: true,
          },
        ],
        [{ x: 1, y: 2 }],
      );
      const victim = makePartyMember({
        id: 'victim',
        name: 'Victim',
        currentHp: 20,
        maxHp: 20,
        dexMod: 2,
      });
      const state = createDungeonGameState({ floor, party: [victim] });

      // Step directly onto (2, 2)
      const stepRes = reduceGame(state, {
        type: 'EXPLORE_MOVE',
        actorId: 'victim',
        path: [{ x: 2, y: 2 }],
        followMarchingOrder: false,
      });

      expect(stepRes.nextState.props[0].state).toBe('triggered');
      const trapEvt = stepRes.events.find((e) => e.type === 'TRAP_TRIGGERED');
      expect(trapEvt).toBeDefined();
      expect((trapEvt as any).damage).toBeGreaterThan(0);
      expect(stepRes.nextState.party['victim'].currentHp).toBeLessThan(20);
    });

    it('allows a rogue to successfully disarm a discovered trap', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'dart_trap',
            x: 2,
            y: 2,
            kind: 'trap',
            state: 'closed',
            discovered: true,
            disarmDc: 10,
            trapDamageFormula: '1d4',
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const rogue = makePartyMember({
        id: 'rogue',
        name: 'Rogue',
        dexMod: 4,
        tools: ['thieves_tools'],
      });
      let current = createDungeonGameState({ floor, party: [rogue] });
      let disarmed = false;

      for (let i = 0; i < 5; i++) {
        const res = reduceGame(current, {
          type: 'INTERACT_PROP',
          actorId: 'rogue',
          propId: 'dart_trap',
          interaction: 'disarm_trap',
        });
        current = res.nextState;
        if (current.props[0].state === 'disarmed') {
          disarmed = true;
          expect(res.events).toContainEqual(
            expect.objectContaining({
              type: 'PROP_STATE_CHANGED',
              nextState: 'disarmed',
            }),
          );
          break;
        }
      }

      expect(disarmed).toBe(true);
    });

    it('triggers trap when failing a disarm check by 5 or more (SRD rule)', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'lethal_trap',
            x: 2,
            y: 2,
            kind: 'trap',
            state: 'closed',
            discovered: true,
            disarmDc: 20, // Very high DC
            trapDamageFormula: '1d6',
          },
        ],
        [{ x: 2, y: 1 }],
      );
      // Fighter with -2 DEX trying to disarm DC 20 with no tools
      const clumsy = makePartyMember({
        id: 'clumsy',
        name: 'Clumsy',
        dexMod: -2,
        tools: [],
      });
      let current = createDungeonGameState({ floor, party: [clumsy] });

      // Rolling <= 15 (DC 20 - 5) will trigger it. Natural roll <= 17 with -2 mod is <= 15.
      let triggered = false;
      for (let i = 0; i < 5; i++) {
        const res = reduceGame(current, {
          type: 'INTERACT_PROP',
          actorId: 'clumsy',
          propId: 'lethal_trap',
          interaction: 'disarm_trap',
        });
        current = res.nextState;
        const checkEvt = res.events.find(
          (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'thieves_tools',
        );
        if (checkEvt && (checkEvt as any).triggered) {
          triggered = true;
          expect(current.props[0].state).toBe('triggered');
          expect(res.events).toContainEqual(
            expect.objectContaining({ type: 'TRAP_TRIGGERED' }),
          );
          break;
        }
      }

      expect(triggered).toBe(true);
    });

    it('triggers trap when opening a trapped chest without disarming first', () => {
      const floor = makeTestFloor(
        [
          {
            id: 'trapped_chest',
            x: 2,
            y: 2,
            kind: 'chest',
            state: 'closed',
            trapDamageFormula: '2d4',
            trapDamageType: 'poison',
            lootTable: { gp: 50 },
          },
        ],
        [{ x: 2, y: 1 }],
      );
      const greedy = makePartyMember({
        id: 'greedy',
        name: 'Greedy',
        currentHp: 20,
      });
      const state = createDungeonGameState({ floor, party: [greedy] });

      const openRes = reduceGame(state, {
        type: 'INTERACT_PROP',
        actorId: 'greedy',
        propId: 'trapped_chest',
        interaction: 'open',
      });

      // Trap triggers on the actor opening it
      expect(openRes.events).toContainEqual(
        expect.objectContaining({
          type: 'TRAP_TRIGGERED',
          propId: 'trapped_chest',
          targetId: 'greedy',
          damageType: 'poison',
        }),
      );
      // But chest still opens and loot is acquired
      expect(openRes.nextState.props[0].state).toBe('open');
      expect(openRes.events).toContainEqual(
        expect.objectContaining({ type: 'LOOT_ACQUIRED' }),
      );
      expect(openRes.nextState.party['greedy'].currentHp).toBeLessThan(20);
    });
  });

  describe('7. SRD-510: Click-to-Inspect Action Options', () => {
    const rogue = () =>
      makePartyMember({
        id: 'sneak',
        name: 'Sneak',
        tools: ['thieves_tools'],
        skills: {
          perception: { totalBonus: 5 },
          investigation: { totalBonus: 3 },
          athletics: { totalBonus: 2 },
        },
      });

    it('offers Open + Search for a closed door, Close for an open door', () => {
      const closed = getAvailablePropInteractions(
        { id: 'd', kind: 'door', state: 'closed' },
        rogue(),
      );
      expect(closed.map((o) => o.interaction)).toEqual(['open', 'listen', 'search']);
      const open = getAvailablePropInteractions(
        { id: 'd', kind: 'door', state: 'open' },
        rogue(),
      );
      expect(open.map((o) => o.interaction)).toEqual(['close', 'listen', 'search']);
    });

    it('offers Pick Lock / Force Open with DC hints for locked doors and chests', () => {
      const opts = getAvailablePropInteractions(
        { id: 'd', kind: 'door', state: 'locked', lockDc: 15 },
        rogue(),
      );
      const kinds = opts.map((o) => o.interaction);
      expect(kinds).toEqual(['pick_lock', 'force_open', 'listen', 'search']);
      expect(opts[0]).toMatchObject({ label: 'Pick Lock' });
      expect(opts[0]!.checkHint).toContain('DC 15');
      expect(opts[1]!.checkHint).toContain('DC 17');
    });

    it('warns about trapped chests and offers disarm for found traps', () => {
      const chest = getAvailablePropInteractions(
        { id: 'c', kind: 'chest', state: 'closed', trapDamageFormula: '2d6' },
        rogue(),
      );
      expect(chest.some((o) => o.riskHint !== undefined)).toBe(true);
      const trap = getAvailablePropInteractions(
        { id: 't', kind: 'trap', state: 'closed', disarmDc: 12, discovered: true },
        rogue(),
      );
      expect(trap.map((o) => o.interaction)).toEqual(['disarm_trap', 'search']);
      expect(trap[0]!.checkHint).toContain('DC 12');
    });

    it('hides actions for undiscovered secrets, destroyed husks, and stairs', () => {
      const hero = rogue();
      expect(
        getAvailablePropInteractions({ id: 's', kind: 'secret_door', state: 'closed' }, hero),
      ).toEqual([]);
      expect(
        getAvailablePropInteractions({ id: 't', kind: 'trap', state: 'closed' }, hero),
      ).toEqual([]);
      expect(
        getAvailablePropInteractions({ id: 'd', kind: 'door', state: 'destroyed' }, hero),
      ).toEqual([]);
      expect(
        getAvailablePropInteractions({ id: 'st', kind: 'stairs_down', state: 'open' }, hero),
      ).toEqual([]);
    });

    it('offers Use Shrine for shrines and Pull for levers', () => {
      const hero = rogue();
      expect(
        getAvailablePropInteractions({ id: 'sh', kind: 'shrine', state: 'open' }, hero).map((o) => o.interaction),
      ).toEqual(['open']);
      expect(
        getAvailablePropInteractions({ id: 'lv', kind: 'lever', state: 'closed' }, hero)[0]?.label,
      ).toBe('Pull Lever');
    });
  });

  describe('8. SRD-511: Listen at Doors', () => {
    const makeListenFloor = (
      encounters: Array<{
        id: string;
        roomId: string;
        monsters: Array<{ monsterId: string }>;
      }> = [],
    ): DungeonFloorSpec => {
      const cells: DungeonFloorSpec['cells'] = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const isWall = x === 0 || x === 9 || y === 0 || y === 9;
          cells.push({
            x,
            y,
            roomId: x <= 4 ? 'room_a' : 'room_b',
            terrain: isWall ? 'wall_solid' : 'floor_stone',
            baseLight: 'bright',
            elevationFeet: 0,
          });
        }
      }
      return {
        id: 'listen_test_floor',
        name: 'Listening Test Floor',
        width: 10,
        height: 10,
        partySpawnCells: [{ x: 3, y: 4 }],
        cells,
        props: [
          {
            id: 'door_ab',
            x: 4,
            y: 4,
            kind: 'door',
            state: 'closed',
            blocksMovement: true,
            blocksSight: true,
            listenDc: 10,
          },
        ],
        encounters: encounters.map((e) => ({
          ...e,
          triggered: false,
          monsters: e.monsters.map((m) => ({ ...m, spawnX: 6, spawnY: 4 })),
        })),
        rooms: [
          { id: 'room_a', name: 'Antechamber', description: 'West', isSafeRoom: false },
          { id: 'room_b', name: 'Guardroom', description: 'East', isSafeRoom: false },
        ],
      };
    };

    const listenState = (floor: DungeonFloorSpec, perceptionBonus: number, rngState: number) => {
      const listener = makePartyMember({
        id: 'listener',
        name: 'Listener',
        x: 3,
        y: 4,
        skills: {
          perception: { totalBonus: perceptionBonus },
          investigation: { totalBonus: 0 },
          athletics: { totalBonus: 0 },
        },
      });
      return createDungeonGameState({ floor, party: [listener], rngState });
    };

    it('reports silence when nothing lurks beyond, without triggering encounters', () => {
      const state = listenState(makeListenFloor(), 20, 7);
      const res = reduceGame(state, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_ab',
      });
      const check = res.events.find((e) => e.type === 'CHECK_RESOLVED');
      expect(check).toMatchObject({ checkType: 'perception', success: true });
      expect((check as unknown as { note?: string }).note).toMatch(/Nothing stirs/);
      expect(res.nextState.dungeon!.encounters.every((e) => !e.triggered)).toBe(true);
      expect(res.nextState.party['listener']!.currentHp).toBe(20);
    });

    it('misreads on a bad failure and hears faint sounds on a near miss', () => {
      const silent = listenState(
        makeListenFloor([{ id: 'enc-g', roomId: 'room_b', monsters: [{ monsterId: 'goblin' }] }]),
        -15,
        99,
      );
      const silentRes = reduceGame(silent, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_ab',
      });
      expect(
        (silentRes.events.find((e) => e.type === 'CHECK_RESOLVED') as unknown as { note?: string } | undefined)?.note,
      ).toMatch(/Stillness/);

      let nearMissSeed = -1;
      for (let s = 1; s < 500; s++) {
        const r = rollD20(s, { modifier: 4, mode: 'normal' });
        if (r.total >= 6 && r.total <= 9) {
          nearMissSeed = s;
          break;
        }
      }
      expect(nearMissSeed).toBeGreaterThan(0);
      const faint = listenState(
        makeListenFloor([{ id: 'enc-g', roomId: 'room_b', monsters: [{ monsterId: 'goblin' }] }]),
        4,
        nearMissSeed,
      );
      const faintRes = reduceGame(faint, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_ab',
      });
      const faintCheck = faintRes.events.find((e) => e.type === 'CHECK_RESOLVED') as
        | { success: boolean; note?: string }
        | undefined;
      expect(faintCheck?.success).toBe(false);
      expect(faintCheck?.note).toMatch(/Faint/);
    });

    it('describes occupant character on success and counts on a decisive success', () => {
      let successSeed = -1;
      for (let s = 1; s < 500; s++) {
        const r = rollD20(s, { modifier: 4, mode: 'normal' });
        if (r.total >= 10 && r.total <= 14) {
          successSeed = s;
          break;
        }
      }
      expect(successSeed).toBeGreaterThan(0);
      const heard = listenState(
        makeListenFloor([{ id: 'enc-g', roomId: 'room_b', monsters: [{ monsterId: 'goblin' }] }]),
        4,
        successSeed,
      );
      const heardRes = reduceGame(heard, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_ab',
      });
      const heardCheck = heardRes.events.find((e) => e.type === 'CHECK_RESOLVED') as
        | { success: boolean; note?: string }
        | undefined;
      expect(heardCheck?.success).toBe(true);
      expect(heardCheck?.note).toMatch(/muffled voices/);

      const counted = listenState(
        makeListenFloor([
          {
            id: 'enc-s',
            roomId: 'room_b',
            monsters: [{ monsterId: 'skeleton' }, { monsterId: 'skeleton' }, { monsterId: 'skeleton' }],
          },
        ]),
        20,
        7,
      );
      const countedRes = reduceGame(counted, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_ab',
      });
      const countedCheck = countedRes.events.find((e) => e.type === 'CHECK_RESOLVED') as
        | { success: boolean; note?: string }
        | undefined;
      expect(countedCheck?.success).toBe(true);
      expect(countedCheck?.note).toMatch(/three movers|two or three/);
      expect(countedCheck?.note).toMatch(/bone/);
      expect(countedRes.nextState.dungeon!.encounters.every((e) => !e.triggered)).toBe(true);
    });

    it('rejects listening at non-doors and from out of reach', () => {
      const floor = makeListenFloor();
      floor.props = [
        {
          id: 'crate',
          x: 3,
          y: 5,
          kind: 'chest',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
        },
      ];
      const state = listenState(floor, 20, 7);
      expect(() =>
        reduceGame(state, { type: 'LISTEN_AT_DOOR', actorId: 'listener', propId: 'crate' }),
      ).toThrow(/only listen at doors/);

      const farFloor = makeListenFloor();
      const farState = listenState(farFloor, 20, 7);
      (farState.party['listener'] as Combatant).position = { x: 1, y: 1 };
      expect(() =>
        reduceGame(farState, { type: 'LISTEN_AT_DOOR', actorId: 'listener', propId: 'door_ab' }),
      ).toThrow(/not adjacent/);
    });

    it('exposes Listen in the interaction card options for doors', () => {
      const rogue = makePartyMember({ id: 'r', name: 'R', tools: ['thieves_tools'] });
      const opts = getAvailablePropInteractions(
        { id: 'd', kind: 'door', state: 'closed', listenDc: 12 },
        rogue,
      );
      const listen = opts.find((o) => o.interaction === 'listen');
      expect(listen?.label).toBe('Listen');
      expect(listen?.checkHint).toMatch(/DC 12/);
    });
  });
});


describe('SRD-512: Furniture Props', () => {
  const rogue = () =>
    makePartyMember({
      id: 'sneak',
      name: 'Sneak',
      tools: ['thieves_tools'],
      skills: {
        perception: { totalBonus: 5 },
        investigation: { totalBonus: 3 },
        athletics: { totalBonus: 2 },
      },
    });

  it('offers Search (+ inspect) on furniture and lockpicking on locked drawers', () => {
    const desk = getAvailablePropInteractions(
      { id: 'desk', kind: 'furniture', state: 'closed', furnitureType: 'desk', detectionDc: 12 },
      rogue(),
    );
    expect(desk.map((o) => o.interaction)).toEqual(['open', 'search']);
    expect(desk[0]!.label).toBe('Search');
    const locked = getAvailablePropInteractions(
      { id: 'drawer', kind: 'furniture', state: 'locked', furnitureType: 'desk', lockDc: 13 },
      rogue(),
    );
    expect(locked.map((o) => o.interaction)).toEqual(['pick_lock', 'force_open', 'search']);
    expect(locked[0]!.checkHint).toContain('DC 13');
  });

  it('offers nothing actionable on destroyed furniture', () => {
    expect(
      getAvailablePropInteractions({ id: 'rubble', kind: 'furniture', state: 'destroyed' }, rogue()),
    ).toEqual([]);
  });
});
