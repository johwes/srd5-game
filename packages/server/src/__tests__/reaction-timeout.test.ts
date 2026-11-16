import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Combatant,
  type CombatState,
  type GameState,
  createInitialGameState,
  createTacticalGrid,
  executeWeaponAttack,
} from '@srd5/engine';
import { RoomServer } from '../room-server.js';
import { FakeSocket, makeHero } from './fixtures.js';

/**
 * Builds a real combat state paused at a Shield reaction prompt by running the
 * engine's weapon attack pipeline, so the interrupt context can be resumed.
 */
function makePendingPromptState(): GameState {
  const wizard: Combatant = {
    ...makeHero('wiz-1', 'Wizard', 5, 5),
    armorClass: 14,
    spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
    activeEffects: [
      {
        effectId: 'shield',
        name: 'Shield',
        requiresConcentration: false,
        remainingRounds: 10,
        modifiers: [],
      },
    ],
  };
  const orc: Combatant = {
    ...makeHero('orc-1', 'Orc', 5, 6),
    side: 'monster',
    armorClass: 11,
  };

  const combat: CombatState = {
    encounterId: 'enc-rxn',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: [
      { entityId: orc.id, initiative: 20, naturalRoll: 10, dexterityScore: 10, tieBreaker: 0 },
      { entityId: wizard.id, initiative: 15, naturalRoll: 10, dexterityScore: 12, tieBreaker: 0 },
    ],
    activeCombatantIndex: 0,
    activeCombatantId: orc.id,
    turnBudget: {
      action: 1,
      bonusAction: 1,
      reactionAvailable: true,
      movementRemainingFeet: 30,
      freeObjectInteraction: 1,
      bonusActionSpellCast: false,
      leveledActionSpellCast: false,
      attackActionTaken: false,
      extraAttacksRemaining: 0,
      disengaged: false,
      dodging: false,
    },
    combatants: { [orc.id]: orc, [wizard.id]: wizard },
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState: 42,
  };

  const attack = executeWeaponAttack({
    state: combat,
    attackerId: orc.id,
    targetId: wizard.id,
    customAttack: {
      name: 'Greataxe',
      attackType: 'melee_weapon',
      toHitBonus: 5,
      damageDice: '1d12',
      damageBonus: 3,
      damageType: 'slashing',
      reachFeet: 5,
    },
  });
  expect(attack.state.phase).toBe('reaction_prompt');
  expect(attack.state.pendingReactionPrompt?.reactorEntityId).toBe(wizard.id);

  const base = createInitialGameState({
    id: 'rxn-game',
    grid: createTacticalGrid(12, 12),
    party: [wizard],
    monsters: [orc],
    rngState: 42,
    slots: [
      { playerId: 'p1', displayName: 'Wizard Player', controlledCharacterIds: [wizard.id] },
      { playerId: 'p2', displayName: 'Orc Player', controlledCharacterIds: [orc.id] },
    ],
  });
  return { ...base, mode: 'combat', combat: attack.state };
}

function setup(timeoutMs = 1000) {
  const server = new RoomServer({
    generateRoomId: () => 'RXN001',
    reactionPromptTimeoutMs: timeoutMs,
  });
  const host = new FakeSocket();
  const coop = new FakeSocket();
  const detachHost = server.attachSocket(host);
  const detachCoop = server.attachSocket(coop);
  host.push({
    type: 'CREATE_ROOM',
    requestId: 'create',
    roomId: 'RXN001',
    initialState: makePendingPromptState(),
    host: { playerId: 'p1', displayName: 'Wizard Player' },
  });
  coop.push({
    type: 'JOIN_ROOM',
    requestId: 'join',
    roomId: 'RXN001',
    player: { playerId: 'p2', displayName: 'Orc Player' },
    requestedCharacterIds: ['orc-1'],
  });
  const room = server.getRoom('RXN001')!;
  return { server, host, coop, room, detachHost, detachCoop };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SRD-703: multiplayer reaction prompt timers', () => {
  it('auto-passes an unanswered prompt and broadcasts the resumed state', async () => {
    vi.useFakeTimers();
    const { server, host, coop, room, detachHost, detachCoop } = setup();
    const promptId = room.getPendingReactionPrompt()!.promptId;

    server.maybeScheduleReactionTimer(room);
    expect(room.getReactionPromptDeadline()).toBeGreaterThanOrEqual(Date.now());

    // Only the reactor's projection carries the server deadline.
    host.clear();
    coop.clear();
    host.push({ type: 'GET_STATE', requestId: 'owner-state' });
    coop.push({ type: 'GET_STATE', requestId: 'other-state' });
    expect(host.last('STATE_SNAPSHOT')?.viewState.combat?.pendingReactionPrompt?.promptId).toBe(
      promptId,
    );
    expect(host.last('STATE_SNAPSHOT')?.viewState.combat?.reactionPromptDeadline).toBe(
      room.getReactionPromptDeadline(),
    );
    expect(coop.last('STATE_SNAPSHOT')?.viewState.combat?.pendingReactionPrompt).toBeNull();
    expect(coop.last('STATE_SNAPSHOT')?.viewState.combat?.reactionPromptDeadline).toBeNull();

    host.clear();
    coop.clear();
    await vi.advanceTimersByTimeAsync(1000);

    expect(room.getPendingReactionPrompt()).toBeNull();
    expect(room.getReactionPromptDeadline()).toBeNull();
    const update = host.last('STATE_UPDATE');
    expect(update).toBeDefined();
    expect(update?.events.some((e) => e.type === 'REACTION_RESOLVED')).toBe(true);
    expect(update?.viewState.combat?.pendingReactionPrompt).toBeNull();
    // Every member receives the resumed state, each with its own projection.
    expect(coop.last('STATE_UPDATE')?.viewState.playerId).toBe('p2');
    expect(host.last('STATE_UPDATE')?.viewState.playerId).toBe('p1');

    detachHost();
    detachCoop();
  });

  it('cancels the timer when the reactor answers the prompt', async () => {
    vi.useFakeTimers();
    const { server, host, room, detachHost, detachCoop } = setup();
    const promptId = room.getPendingReactionPrompt()!.promptId;
    server.maybeScheduleReactionTimer(room);

    host.clear();
    host.push({
      type: 'DISPATCH_COMMAND',
      requestId: 'reply',
      command: {
        type: 'RESOLVE_REACTION_PROMPT',
        promptId,
        reactorId: 'wiz-1',
        decision: { execute: false },
      },
    });
    expect(host.last('STATE_UPDATE')?.viewState.combat?.pendingReactionPrompt).toBeNull();
    expect(room.getReactionPromptDeadline()).toBeNull();

    host.clear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.ofType('STATE_UPDATE')).toHaveLength(0);

    detachHost();
    detachCoop();
  });

  it('honours the prompt-level timeoutMs over the server default', async () => {
    vi.useFakeTimers();
    const { server, host, room, detachHost, detachCoop } = setup(1000);
    const authoritative = room.getAuthoritativeState();
    authoritative.combat!.pendingReactionPrompt!.timeoutMs = 250;
    room.setAuthoritativeState(authoritative);
    server.maybeScheduleReactionTimer(room);

    host.clear();
    await vi.advanceTimersByTimeAsync(250);
    expect(room.getPendingReactionPrompt()).toBeNull();
    expect(host.ofType('STATE_UPDATE')).toHaveLength(1);

    detachHost();
    detachCoop();
  });

  it('does not auto-pass when auto-resolution is disabled', async () => {
    vi.useFakeTimers();
    const server = new RoomServer({
      generateRoomId: () => 'RXN002',
      autoResolveReactionPrompts: false,
      reactionPromptTimeoutMs: 100,
    });
    const socket = new FakeSocket();
    const detach = server.attachSocket(socket);
    socket.push({
      type: 'CREATE_ROOM',
      requestId: 'create',
      roomId: 'RXN002',
      initialState: makePendingPromptState(),
      host: { playerId: 'p1' },
    });
    const room = server.getRoom('RXN002')!;
    server.maybeScheduleReactionTimer(room);

    await vi.advanceTimersByTimeAsync(500);
    expect(room.getPendingReactionPrompt()).not.toBeNull();

    detach();
  });
});
