import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  createInitialGameState,
  createTacticalGrid,
  reduceGame,
  setGridCells,
} from '../index.js';

function makeHero(id: string, name: string, x: number, y: number): Combatant {
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
    armorClass: 14,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
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

function makeGoblin(id: string, x: number, y: number): Combatant {
  return {
    id,
    name: 'Goblin',
    side: 'monster',
    size: 'small',
    position: { x, y },
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 9,
    stealthModifier: 6,
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

describe('SRD-311: reduceGame Authoritative Reducer', () => {
  it('initializes game in exploration mode with explored cells pre-seeded', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('fighter', 'Fighter', 1, 1);
    const state = createInitialGameState({
      grid,
      party: [hero],
    });

    expect(state.mode).toBe('exploration');
    expect(state.combat).toBeNull();
    expect(state.party['fighter']?.position).toEqual({ x: 1, y: 1 });
    expect(state.exploredCells['1,1']).toBe(true);
    expect(state.exploredCells['2,2']).toBe(true);
  });

  it('handles EXPLORE_MOVE and updates party member position and explored cells', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('fighter', 'Fighter', 1, 1);
    const state = createInitialGameState({ grid, party: [hero] });

    const { nextState, events } = reduceGame(state, {
      type: 'EXPLORE_MOVE',
      actorId: 'fighter',
      path: [
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ],
    });

    expect(nextState.party['fighter']?.position).toEqual({ x: 1, y: 3 });
    expect(nextState.exploredCells['1,3']).toBe(true);
    expect(events.some((e) => e.type === 'ENTITY_MOVED')).toBe(true);
  });

  it('triggers an armed trap when moving over it in exploration mode', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('fighter', 'Fighter', 1, 1);
    const state = createInitialGameState({
      grid,
      party: [hero],
      props: [
        {
          id: 'pit-trap',
          x: 1,
          y: 2,
          kind: 'trap',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
          trapDamageFormula: '1d6',
          trapDamageType: 'piercing',
        },
      ],
    });

    const { nextState, events } = reduceGame(state, {
      type: 'EXPLORE_MOVE',
      actorId: 'fighter',
      path: [{ x: 1, y: 2 }],
    });

    expect(nextState.props.find((p) => p.id === 'pit-trap')?.state).toBe('triggered');
    expect(nextState.party['fighter']!.currentHp).toBeLessThan(20);
    expect(events.some((e) => e.type === 'TRAP_TRIGGERED')).toBe(true);
  });

  it('handles INTERACT_PROP for opening and closing doors', () => {
    let grid = createTacticalGrid(10, 10);
    grid = setGridCells(grid, [
      { x: 2, y: 1, blocksMovement: true, blocksSight: true },
    ]);
    const hero = makeHero('fighter', 'Fighter', 1, 1);
    const state = createInitialGameState({
      grid,
      party: [hero],
      props: [
        {
          id: 'door-1',
          x: 2,
          y: 1,
          kind: 'door',
          state: 'closed',
          blocksMovement: true,
          blocksSight: true,
        },
      ],
    });

    // Open door
    const openRes = reduceGame(state, {
      type: 'INTERACT_PROP',
      actorId: 'fighter',
      propId: 'door-1',
      interaction: 'open',
    });

    const openedProp = openRes.nextState.props.find((p) => p.id === 'door-1');
    expect(openedProp?.state).toBe('open');
    expect(openedProp?.blocksMovement).toBe(false);
    expect(openedProp?.blocksSight).toBe(false);

    // Close door
    const closeRes = reduceGame(openRes.nextState, {
      type: 'INTERACT_PROP',
      actorId: 'fighter',
      propId: 'door-1',
      interaction: 'close',
    });

    const closedProp = closeRes.nextState.props.find((p) => p.id === 'door-1');
    expect(closedProp?.state).toBe('closed');
    expect(closedProp?.blocksMovement).toBe(true);
    expect(closedProp?.blocksSight).toBe(true);
  });

  it('transitions to combat mode on START_COMBAT and rolls initiative', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('fighter', 'Fighter', 1, 1);
    const goblin = makeGoblin('goblin-1', 5, 5);
    const state = createInitialGameState({
      grid,
      party: [hero],
      monsters: [goblin],
    });

    const { nextState, events } = reduceGame(state, {
      type: 'START_COMBAT',
      encounterId: 'test-encounter',
    });

    expect(nextState.mode).toBe('combat');
    expect(nextState.combat).not.toBeNull();
    expect(nextState.combat?.phase).toBe('active_turn');
    expect(nextState.combat?.round).toBe(1);
    expect(events.some((e) => e.type === 'MODE_CHANGED')).toBe(true);
    expect(events.some((e) => e.type === 'COMBAT_STARTED')).toBe(true);
  });
});
