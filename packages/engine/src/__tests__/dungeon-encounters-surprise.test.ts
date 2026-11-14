import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type DungeonFloorSpec,
  createDungeonGameState,
  reduceGame,
  triggerDungeonEncounter,
  checkDungeonEncounterTriggers,
  transitionCombatToExploration,
} from '../index.js';

function makeHero(
  id: string,
  name: string,
  x = 0,
  y = 0,
  options?: {
    passivePerception?: number;
    stealthModifier?: number;
    currentHp?: number;
  },
): Combatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: options?.currentHp ?? 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: options?.passivePerception ?? 10,
    stealthModifier: options?.stealthModifier ?? 2,
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

function createTestFloorSpec(options?: {
  doorState?: 'closed' | 'open';
  surpriseCondition?: { monstersStealthedDc?: number };
}): DungeonFloorSpec {
  const width = 12;
  const height = 12;
  const cells: DungeonFloorSpec['cells'] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isWall = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      // Dividing wall between room 1 (x: 1..5) and room 2 (x: 7..10), doorway at (6, 5)
      const isDividingWall = x === 6 && y !== 5;

      let roomId: string | undefined;
      if (x >= 1 && x <= 5) roomId = 'room_entry';
      else if (x >= 7 && x <= 10) roomId = 'room_guard';

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

  const doorState = options?.doorState ?? 'closed';

  return {
    id: 'floor_encounter_test',
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
        id: 'door_entry',
        x: 6,
        y: 5,
        kind: 'door',
        state: doorState,
        blocksMovement: doorState === 'closed',
        blocksSight: doorState === 'closed',
        lockDc: 12,
      },
    ],
    encounters: [
      {
        id: 'enc_guardians',
        roomId: 'room_guard',
        triggered: false,
        monsters: [
          { monsterId: 'goblin', spawnX: 8, spawnY: 5 },
          { monsterId: 'skeleton', spawnX: 9, spawnY: 5 },
        ],
        surpriseCondition: options?.surpriseCondition,
      },
    ],
    rooms: [
      {
        id: 'room_entry',
        name: 'Entry Antechamber',
        isSafeRoom: true,
      },
      {
        id: 'room_guard',
        name: 'Guard Barracks',
        isSafeRoom: false,
      },
    ],
  };
}

describe('SRD-503: Exploration-to-Combat transition and Stealth/Surprise checks', () => {
  describe('1. Line of Sight Encounter Trigger during Movement', () => {
    it('halts exploration movement and transitions to combat immediately upon spotting monsters', () => {
      // With open door, monsters at (8, 5) are blocked by the dividing wall until hero moves into line of sight
      const floor = createTestFloorSpec({ doorState: 'open' });
      const party = [
        makeHero('hero-lead', 'Fighter', 2, 5),
        makeHero('hero-2', 'Cleric', 1, 5),
      ];

      const initial = createDungeonGameState({
        floor,
        party,
        marchingOrder: ['hero-lead', 'hero-2'],
        leadExplorerId: 'hero-lead',
      });

      expect(initial.mode).toBe('exploration');
      expect(initial.combat).toBeNull();
      expect(initial.dungeon?.encounters[0]?.triggered).toBe(false);

      // Hero moves from (2, 5) towards (6, 5) doorway
      // At (2, 5) -> (3, 5) -> (4, 5) -> (5, 5), unobstructed line of sight to (8, 5) is established!
      const moveRes = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero-lead',
        path: [
          { x: 3, y: 5 },
          { x: 4, y: 5 },
          { x: 5, y: 5 },
        ],
      });

      // Movement should have halted when the encounter was spotted
      const haltEvent = moveRes.events.find((e) => e.type === 'MOVEMENT_HALTED');
      expect(haltEvent).toBeDefined();
      expect(haltEvent?.reason).toBe('encounter_spotted');

      // Mode should have transitioned to combat
      expect(moveRes.nextState.mode).toBe('combat');
      expect(moveRes.nextState.combat).not.toBeNull();
      expect(moveRes.nextState.dungeon?.encounters[0]?.triggered).toBe(true);

      // Verification of emitted events
      const encounterEvent = moveRes.events.find((e) => e.type === 'ENCOUNTER_TRIGGERED');
      expect(encounterEvent).toBeDefined();
      expect(encounterEvent?.encounterId).toBe('enc_guardians');
      expect(encounterEvent?.roomId).toBe('room_guard');
      expect(encounterEvent?.monsterIds).toHaveLength(2);

      const modeEvent = moveRes.events.find(
        (e) => e.type === 'MODE_CHANGED' && e.toMode === 'combat',
      );
      expect(modeEvent).toBeDefined();

      const combatStarted = moveRes.events.find((e) => e.type === 'COMBAT_STARTED');
      expect(combatStarted).toBeDefined();

      // Monsters should be present in state.monsters and combat state
      expect(Object.keys(moveRes.nextState.monsters)).toHaveLength(2);
      expect(moveRes.nextState.monsters['enc_guardians-goblin-1']).toBeDefined();
      expect(moveRes.nextState.monsters['enc_guardians-skeleton-2']).toBeDefined();
    });

    it('does not trigger encounter if sight is blocked by a closed door', () => {
      const floor = createTestFloorSpec({ doorState: 'closed' });
      const party = [makeHero('hero-1', 'Fighter', 2, 5)];

      const initial = createDungeonGameState({ floor, party });
      expect(initial.mode).toBe('exploration');

      // Move up to the closed door at (5, 5)
      const moveRes = reduceGame(initial, {
        type: 'EXPLORE_MOVE',
        actorId: 'hero-1',
        path: [
          { x: 3, y: 5 },
          { x: 4, y: 5 },
          { x: 5, y: 5 },
        ],
      });

      // Movement succeeds, closed door blocks Line of Sight so encounter is NOT triggered
      expect(moveRes.nextState.mode).toBe('exploration');
      expect(moveRes.nextState.combat).toBeNull();
      expect(moveRes.nextState.dungeon?.encounters[0]?.triggered).toBe(false);
      expect(moveRes.events.some((e) => e.type === 'ENCOUNTER_TRIGGERED')).toBe(false);
    });
  });

  describe('2. Door Opening Encounter Trigger', () => {
    it('triggers encounter immediately when opening a door establishes Line of Sight to monsters', () => {
      const floor = createTestFloorSpec({ doorState: 'closed' });
      // Spawn party at (5, 5), adjacent to door at (6, 5)
      floor.partySpawnCells = [{ x: 5, y: 5 }];
      const party = [makeHero('hero-1', 'Rogue', 5, 5)];

      const initial = createDungeonGameState({ floor, party });
      expect(initial.mode).toBe('exploration');

      // Hero opens door at (6, 5)
      const openRes = reduceGame(initial, {
        type: 'INTERACT_PROP',
        actorId: 'hero-1',
        propId: 'door_entry',
        interaction: 'open',
      });

      // Door is now open
      const propEvent = openRes.events.find((e) => e.type === 'PROP_STATE_CHANGED');
      expect(propEvent).toBeDefined();
      expect(propEvent?.nextState).toBe('open');

      // Opening door unblocks Line of Sight into room_guard, immediately transitioning to combat!
      expect(openRes.nextState.mode).toBe('combat');
      expect(openRes.nextState.combat).not.toBeNull();
      expect(openRes.nextState.dungeon?.encounters[0]?.triggered).toBe(true);

      const encounterEvent = openRes.events.find((e) => e.type === 'ENCOUNTER_TRIGGERED');
      expect(encounterEvent).toBeDefined();
      expect(encounterEvent?.encounterId).toBe('enc_guardians');
    });
  });

  describe('3. Stealth Mode & Surprise Checks (SRD 5.1 Rules)', () => {
    it('allows toggling party stealth mode in exploration', () => {
      const floor = createTestFloorSpec();
      const party = [makeHero('hero-1', 'Ranger', 2, 2)];
      const initial = createDungeonGameState({ floor, party });

      expect(initial.partyInStealth).toBe(false);

      const toggleRes = reduceGame(initial, {
        type: 'SET_PARTY_STEALTH',
        inStealth: true,
      });

      expect(toggleRes.nextState.partyInStealth).toBe(true);
      const stealthEvent = toggleRes.events.find((e) => e.type === 'PARTY_STEALTH_CHANGED');
      expect(stealthEvent).toBeDefined();
      expect(stealthEvent?.inStealth).toBe(true);
    });

    it('surprises monsters when party is in stealth and every hero beats monster passive perception', () => {
      const floor = createTestFloorSpec();
      // Goblin has passive perception 9, Skeleton has passive perception 9
      const party = [
        makeHero('hero-rogue', 'Rogue', 2, 2, { stealthModifier: 8 }),
        makeHero('hero-monk', 'Monk', 2, 3, { stealthModifier: 6 }),
      ];

      const initial = createDungeonGameState({
        floor,
        party,
        partyInStealth: true,
      });

      // Trigger encounter with deterministic high stealth rolls (15 and 14 >= 9)
      const triggerRes = triggerDungeonEncounter(initial, 'enc_guardians', {
        partyStealthRolls: {
          'hero-rogue': 18,
          'hero-monk': 16,
        },
      });

      expect(triggerRes.nextState.mode).toBe('combat');
      const surpriseEvent = triggerRes.events.find((e) => e.type === 'SURPRISE_DETERMINED');
      expect(surpriseEvent).toBeDefined();

      // All monsters should be surprised
      const encounterEvent = triggerRes.events.find((e) => e.type === 'ENCOUNTER_TRIGGERED');
      expect(encounterEvent?.isSurprisedMonsters).toBe(true);
      expect(encounterEvent?.isSurprisedParty).toBe(false);

      const goblin = triggerRes.nextState.monsters['enc_guardians-goblin-1'];
      const skeleton = triggerRes.nextState.monsters['enc_guardians-skeleton-2'];
      expect(goblin?.isSurprised).toBe(true);
      expect(skeleton?.isSurprised).toBe(true);
    });

    it('does not surprise monsters if any party member fails the stealth check', () => {
      const floor = createTestFloorSpec();
      const party = [
        makeHero('hero-rogue', 'Rogue', 2, 2),
        makeHero('hero-clumsy', 'Clumsy Paladin', 2, 3),
      ];

      const initial = createDungeonGameState({
        floor,
        party,
        partyInStealth: true,
      });

      // Rogue rolls 18 (beats 9), but Clumsy Paladin rolls 6 (fails against 9)
      const triggerRes = triggerDungeonEncounter(initial, 'enc_guardians', {
        partyStealthRolls: {
          'hero-rogue': 18,
          'hero-clumsy': 6,
        },
      });

      const encounterEvent = triggerRes.events.find((e) => e.type === 'ENCOUNTER_TRIGGERED');
      expect(encounterEvent?.isSurprisedMonsters).toBe(false);

      const goblin = triggerRes.nextState.monsters['enc_guardians-goblin-1'];
      expect(goblin?.isSurprised).toBe(false);
    });

    it('surprises party members whose passive perception is lower than monster ambush stealth DC', () => {
      // Ambushing monsters with DC 14
      const floor = createTestFloorSpec({
        surpriseCondition: { monstersStealthedDc: 14 },
      });

      const party = [
        makeHero('hero-inattentive', 'Fighter', 2, 2, { passivePerception: 10 }), // 10 < 14 -> Surprised
        makeHero('hero-alert', 'Perceptive Cleric', 2, 3, { passivePerception: 16 }), // 16 >= 14 -> Not Surprised
      ];

      const initial = createDungeonGameState({ floor, party });

      const triggerRes = triggerDungeonEncounter(initial, 'enc_guardians');

      const encounterEvent = triggerRes.events.find((e) => e.type === 'ENCOUNTER_TRIGGERED');
      expect(encounterEvent?.isSurprisedParty).toBe(true);

      const inattentive = triggerRes.nextState.party['hero-inattentive'];
      const alert = triggerRes.nextState.party['hero-alert'];

      expect(inattentive?.isSurprised).toBe(true);
      expect(alert?.isSurprised).toBe(false);
    });
  });

  describe('4. Combat to Exploration Transition & Room Clearance', () => {
    it('transitions back to exploration mode and marks room as cleared when monsters are defeated', () => {
      const floor = createTestFloorSpec();
      const party = [makeHero('hero-1', 'Fighter', 5, 5)];

      const initial = createDungeonGameState({ floor, party });
      const combatRes = triggerDungeonEncounter(initial, 'enc_guardians');
      expect(combatRes.nextState.mode).toBe('combat');
      expect(combatRes.nextState.dungeon?.rooms['room_guard']?.cleared).toBe(false);

      // Defeat all monsters in the encounter
      for (const m of Object.values(combatRes.nextState.monsters)) {
        m.currentHp = 0;
        m.isDead = true;
      }

      // Transition combat back to exploration
      const transRes = transitionCombatToExploration(combatRes.nextState);

      expect(transRes.nextState.mode).toBe('exploration');
      expect(transRes.nextState.combat).toBeNull();

      // Guard room should now be marked as cleared!
      expect(transRes.nextState.dungeon?.rooms['room_guard']?.cleared).toBe(true);
      const roomClearedEvent = transRes.events.find((e) => e.type === 'ROOM_CLEARED');
      expect(roomClearedEvent).toBeDefined();
      expect(roomClearedEvent?.roomId).toBe('room_guard');

      const modeEvent = transRes.events.find(
        (e) => e.type === 'MODE_CHANGED' && e.toMode === 'exploration',
      );
      expect(modeEvent).toBeDefined();
    });

    it('supports ending combat via the END_COMBAT command', () => {
      const floor = createTestFloorSpec();
      const party = [makeHero('hero-1', 'Fighter', 5, 5)];
      const initial = createDungeonGameState({ floor, party });
      const combatRes = triggerDungeonEncounter(initial, 'enc_guardians');

      // Defeat monsters
      for (const m of Object.values(combatRes.nextState.monsters)) {
        m.currentHp = 0;
        m.isDead = true;
      }

      const endRes = reduceGame(combatRes.nextState, { type: 'END_COMBAT' });
      expect(endRes.nextState.mode).toBe('exploration');
      expect(endRes.nextState.combat).toBeNull();
      expect(endRes.events.some((e) => e.type === 'MODE_CHANGED' && e.toMode === 'exploration')).toBe(
        true,
      );
    });
  });
});
