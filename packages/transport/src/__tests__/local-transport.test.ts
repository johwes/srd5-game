import { describe, expect, it, vi } from 'vitest';
import {
  type Combatant,
  createInitialGameState,
  createTacticalGrid,
} from '@srd5/engine';
import { createLocalTransport } from '../local.js';
import type { GameEvent, PlayerViewState } from '../types.js';

function makePartyMember(id: string, name: string, x: number, y: number): Combatant {
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

function makeMonster(id: string, name: string, x: number, y: number): Combatant {
  return {
    id,
    name,
    side: 'monster',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 15,
    maxHp: 15,
    tempHp: 0,
    armorClass: 13,
    dexterityScore: 12,
    dexterityModifier: 1,
    initiativeBonus: 1,
    initiativeRollMode: 'normal',
    passivePerception: 10,
    stealthModifier: 1,
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

describe('SRD-311: LocalTransport Implementation', () => {
  it('connects, returns slot assignments, and provides projected player view', async () => {
    const grid = createTacticalGrid(8, 8);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    const state = createInitialGameState({ grid, party: [hero] });

    const transport = createLocalTransport({
      initialState: state,
      defaultPlayerId: 'player-1',
    });

    expect(transport.isConnected()).toBe(false);
    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    const slots = transport.getSlotAssignments();
    expect(slots.length).toBe(1);
    expect(slots[0]?.playerId).toBe('player-1');
    expect(slots[0]?.controlledCharacterIds).toContain('hero-1');

    const viewState = transport.getPlayerViewState();
    expect(viewState.playerId).toBe('player-1');
    expect(viewState.party['hero-1']?.position).toEqual({ x: 2, y: 2 });
  });

  it('notifies subscribers on command dispatch with projected state and emitted events', async () => {
    const grid = createTacticalGrid(8, 8);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    const state = createInitialGameState({ grid, party: [hero] });

    const transport = createLocalTransport({ initialState: state });
    await transport.connect();

    const listener = vi.fn((_view: PlayerViewState, _events: GameEvent[]) => {});
    const unsubscribe = transport.subscribe(listener);

    const { viewState, events } = await transport.dispatch({
      type: 'EXPLORE_MOVE',
      actorId: 'hero-1',
      path: [{ x: 2, y: 3 }],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'ENTITY_MOVED')).toBe(true);
    expect(viewState.party['hero-1']?.position).toEqual({ x: 2, y: 3 });

    // Test unsubscribe
    unsubscribe();
    await transport.dispatch({
      type: 'EXPLORE_MOVE',
      actorId: 'hero-1',
      path: [{ x: 2, y: 4 }],
    });

    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it('runs an interactive combat sequence end-to-end through LocalTransport', async () => {
    const grid = createTacticalGrid(8, 8);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    const goblin = makeMonster('goblin-1', 'Goblin', 3, 2);
    const state = createInitialGameState({
      grid,
      party: [hero],
      monsters: [goblin],
    });

    const transport = createLocalTransport({ initialState: state });
    await transport.connect();

    // 1. Start combat
    const startRes = await transport.dispatch({
      type: 'START_COMBAT',
      encounterId: 'arena-skirmish',
    });

    expect(startRes.viewState.mode).toBe('combat');
    expect(startRes.viewState.combat).not.toBeNull();
    expect(startRes.viewState.combat?.phase).toBe('active_turn');

    // 2. Standard action (e.g. Dodge)
    const activeActorId = startRes.viewState.combat!.activeCombatantId!;
    const dodgeRes = await transport.dispatch({
      type: 'USE_STANDARD_ACTION',
      actorId: activeActorId,
      action: 'dodge',
    });

    expect(dodgeRes.events.length).toBeGreaterThan(0);

    // 3. End Turn
    const endTurnRes = await transport.dispatch({
      type: 'END_TURN',
      actorId: activeActorId,
    });

    expect(endTurnRes.events.some((e) => e.type === 'TURN_ENDED')).toBe(true);
    expect(endTurnRes.viewState.combat?.activeCombatantId).not.toBe(activeActorId);
  });
});
