import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  type CombatState,
  type GameState,
  type PlayerSlotAssignment,
  type TacticalGrid,
  createInitialGameState,
  createTacticalGrid,
  createTurnBudget,
  setGridCells,
  startCombatEncounter,
} from '@srd5/engine';
import {
  getControlledEntityIds,
  playerControlsEntity,
  resolveEntityChainRoot,
} from '../ownership.js';
import { projectPlayerView, toPlayerViewCombatant } from '../fog.js';

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id,
    name: id,
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 30,
    maxHp: 30,
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
    ...overrides,
  } as Combatant;
}

function makeSummon(
  id: string,
  summonedByEntityId: string,
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, {
    isSummon: true,
    summonId: id,
    summonedByEntityId,
    summonControl: 'commanded',
    summonSourceName: 'Arcane Hand',
    ...overrides,
  });
}

function makeCombatState(combatants: Combatant[], activeId: string): CombatState {
  const started = startCombatEncounter({
    encounterId: 'summon-903',
    combatants,
    rngState: 424242,
  });
  const active = combatants.find((c) => c.id === activeId) ?? combatants[0]!;
  return {
    ...started.state,
    activeCombatantId: active.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex(
      (e) => e.entityId === active.id,
    ),
    turnBudget: createTurnBudget(active, false),
  };
}

function makeGameState(
  combatants: Combatant[],
  activeId: string,
  slots: PlayerSlotAssignment[],
  grid: TacticalGrid = createTacticalGrid(12, 12),
): GameState {
  const combat = makeCombatState(combatants, activeId);
  const base = createInitialGameState({
    id: 'summon-903-game',
    grid,
    party: combatants.filter((c) => c.side === 'party'),
    monsters: combatants.filter((c) => c.side === 'monster'),
    slots,
    rngState: 424242,
  });
  return { ...base, mode: 'combat', combat, rngState: combat.rngState };
}

describe('SRD-903: transitive summon ownership', () => {
  const caster = makeCombatant('caster', { position: { x: 1, y: 1 }, playerId: 'p1' });
  const hand = makeSummon('hand', 'caster', { position: { x: 2, y: 1 } });
  const blade = makeSummon('blade', 'hand', { position: { x: 3, y: 1 } });

  it('walks nested summonedByEntityId chains to the caster root', () => {
    const state = makeGameState(
      [caster, hand, blade],
      'caster',
      [{ playerId: 'p1', displayName: 'P1', controlledCharacterIds: ['caster'] }],
    );
    expect(resolveEntityChainRoot(state, 'blade')).toBe('caster');
    expect(resolveEntityChainRoot(state, 'hand')).toBe('caster');
    expect(resolveEntityChainRoot(state, 'caster')).toBe('caster');
  });

  it('grants summon control only to the player who controls the chain root', () => {
    const state = makeGameState(
      [caster, hand, blade],
      'caster',
      [
        { playerId: 'p1', displayName: 'P1', controlledCharacterIds: ['caster'] },
        { playerId: 'p2', displayName: 'P2', controlledCharacterIds: [] },
      ],
    );

    expect([...getControlledEntityIds(state, 'p1')].sort()).toEqual([
      'blade',
      'caster',
      'hand',
    ]);
    expect(playerControlsEntity(state, 'p1', 'blade')).toBe(true);
    expect(playerControlsEntity(state, 'p2', 'blade')).toBe(false);
    expect(getControlledEntityIds(state, 'p2').size).toBe(0);
  });

  it('breaks malformed ownership cycles instead of looping', () => {
    const a = makeSummon('a', 'b');
    const b = makeSummon('b', 'a');
    const state = makeGameState(
      [caster, a, b],
      'caster',
      [{ playerId: 'p1', displayName: 'P1', controlledCharacterIds: ['caster'] }],
    );
    expect(['a', 'b']).toContain(resolveEntityChainRoot(state, 'a'));
  });
});

describe('SRD-903: summon Fog-of-War projection', () => {
  const slots: PlayerSlotAssignment[] = [
    { playerId: 'p1', displayName: 'P1', controlledCharacterIds: ['caster'] },
    { playerId: 'p2', displayName: 'P2', controlledCharacterIds: [] },
  ];

  it('projects summon metadata onto player-view combatants', () => {
    const caster = makeCombatant('caster', { position: { x: 1, y: 1 } });
    const hand = makeSummon('hand', 'caster', { position: { x: 2, y: 1 } });
    const state = makeGameState([caster, hand], 'caster', slots);

    const view = projectPlayerView(state, 'p1');
    expect(view.combatants['hand']).toMatchObject({
      isSummon: true,
      summonedByEntityId: 'caster',
    });
    expect(view.combatants['caster']?.isSummon).toBeUndefined();

    const projected = toPlayerViewCombatant(hand);
    expect(projected.isSummon).toBe(true);
    expect(projected.summonedByEntityId).toBe('caster');
  });

  it('gives the summon owner the active turn, budget and initiative visibility', () => {
    const caster = makeCombatant('caster', { position: { x: 1, y: 1 } });
    const hand = makeSummon('hand', 'caster', { position: { x: 2, y: 1 } });
    const state = makeGameState([caster, hand], 'hand', slots);

    const ownerView = projectPlayerView(state, 'p1');
    const otherView = projectPlayerView(state, 'p2');

    expect(ownerView.combat?.activeCombatantId).toBe('hand');
    expect(ownerView.combat?.turnBudget).not.toBeNull();
    expect(otherView.combat?.turnBudget).toBeNull();

    const ownerEntry = ownerView.combat?.initiativeOrder.find((e) => e.entityId === 'hand');
    const otherEntry = otherView.combat?.initiativeOrder.find((e) => e.entityId === 'hand');
    expect(ownerEntry?.isVisible).toBe(true);
    expect(otherEntry?.isVisible).toBe(false);
  });

  it('routes a reaction prompt for a summon to its controlling player', () => {
    const caster = makeCombatant('caster', { position: { x: 1, y: 1 } });
    const hand = makeSummon('hand', 'caster', { position: { x: 2, y: 1 } });
    const state = makeGameState([caster, hand], 'caster', slots);
    state.combat!.phase = 'reaction_prompt';
    state.combat!.pendingReactionPrompt = {
      promptId: 'reaction-1',
      reactorEntityId: 'hand',
      triggerType: 'attack_roll_hit',
      triggerDescription: 'Enemy hits the Arcane Hand',
      availableReactions: [],
      timeoutMs: 30000,
    };

    const ownerView = projectPlayerView(state, 'p1', {
      reactionPromptDeadline: 1700000000000,
    });
    const otherView = projectPlayerView(state, 'p2', {
      reactionPromptDeadline: 1700000000000,
    });

    expect(ownerView.combat?.pendingReactionPrompt?.promptId).toBe('reaction-1');
    expect(ownerView.combat?.reactionPromptDeadline).toBe(1700000000000);
    expect(otherView.combat?.pendingReactionPrompt).toBeNull();
  });

  it('projects enemy summons only where normal visibility allows', () => {
    let grid = createTacticalGrid(12, 12);
    grid = setGridCells(
      grid,
      Array.from({ length: 12 }, (_, y) => ({
        x: 5,
        y,
        terrain: 'wall_solid' as const,
        blocksSight: true,
        blocksMovement: true,
      })),
    );
    const caster = makeCombatant('caster', { position: { x: 1, y: 1 } });
    const visibleSummon = makeSummon('seen', 'enemy', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 2, y: 1 },
    });
    const hiddenSummon = makeSummon('hidden', 'enemy', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 8, y: 1 },
    });
    const state = makeGameState(
      [caster, visibleSummon, hiddenSummon],
      'caster',
      slots,
      grid,
    );

    const view = projectPlayerView(state, 'p1');
    expect(view.combatants['seen']).toBeDefined();
    expect(view.combatants['hidden']).toBeUndefined();
  });
});
