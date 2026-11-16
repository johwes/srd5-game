import { describe, expect, it } from 'vitest';
import {
  type Combatant,
  createInitialGameState,
  createTacticalGrid,
  reduceGame,
  setGridCells,
} from '@srd5/engine';
import { projectPlayerView } from '../fog.js';

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

describe('SRD-311: projectPlayerView Fog-of-War State Filter', () => {
  it('correctly classifies visible, remembered, and unexplored cells', () => {
    // 10x10 map with a solid dividing wall at x = 5 (from y = 0 to 9)
    let grid = createTacticalGrid(10, 10);
    grid = setGridCells(
      grid,
      Array.from({ length: 10 }, (_, y) => ({
        x: 5,
        y,
        terrain: 'wall_solid' as const,
        blocksSight: true,
        blocksMovement: true,
      })),
    );

    const hero = makePartyMember('hero-1', 'Hero', 2, 5);
    const state = createInitialGameState({
      grid,
      party: [hero],
    });

    const view = projectPlayerView(state, 'player-1');

    // Cell at (3, 5) is on hero's side: visible
    const visibleCell = view.grid.cells.find((c) => c.x === 3 && c.y === 5);
    expect(visibleCell?.visibility).toBe('visible');

    // Cell behind wall at (7, 5) was never seen: unexplored
    const unexploredCell = view.grid.cells.find((c) => c.x === 7 && c.y === 5);
    expect(unexploredCell?.visibility).toBe('unexplored');
    expect(unexploredCell?.terrain).toBeUndefined();

    // Now manually mark (7, 5) as previously explored in state
    state.exploredCells['7,5'] = true;
    const viewRemembered = projectPlayerView(state, 'player-1');
    const rememberedCell = viewRemembered.grid.cells.find((c) => c.x === 7 && c.y === 5);
    expect(rememberedCell?.visibility).toBe('remembered');
    expect(rememberedCell?.terrain).toBe('floor_stone');
  });

  it('completely strips monsters in unexplored or remembered fog from combatants payload', () => {
    let grid = createTacticalGrid(10, 10);
    // Wall down x = 5
    grid = setGridCells(
      grid,
      Array.from({ length: 10 }, (_, y) => ({
        x: 5,
        y,
        terrain: 'wall_solid' as const,
        blocksSight: true,
      })),
    );

    const hero = makePartyMember('hero-1', 'Hero', 2, 5);
    const visibleGoblin = makeMonster('goblin-seen', 'Goblin Front', 3, 5);
    const hiddenGoblin = makeMonster('goblin-hidden', 'Goblin Behind Wall', 7, 5);

    const state = createInitialGameState({
      grid,
      party: [hero],
      monsters: [visibleGoblin, hiddenGoblin],
    });

    // Mark the hidden goblin's cell as remembered from an earlier room visit
    state.exploredCells['7,5'] = true;

    const view = projectPlayerView(state, 'player-1');

    // Hero is visible
    expect(view.combatants['hero-1']).toBeDefined();
    // Visible goblin is in LoS
    expect(view.combatants['goblin-seen']).toBeDefined();
    // Hidden goblin behind the wall is stripped from payload (even though cell is 'remembered')
    expect(view.combatants['goblin-hidden']).toBeUndefined();
  });

  it('strips hidden traps with detectionDc unless discovered', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);

    const state = createInitialGameState({
      grid,
      party: [hero],
      props: [
        {
          id: 'unspotted-trap',
          x: 2,
          y: 4,
          kind: 'trap',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
          detectionDc: 15,
          discovered: false,
        },
        {
          id: 'spotted-trap',
          x: 2,
          y: 3,
          kind: 'trap',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
          detectionDc: 10,
          discovered: true,
        },
      ],
    });

    const view = projectPlayerView(state, 'player-1');

    // Discovered trap is included
    expect(view.props.some((p) => p.id === 'spotted-trap')).toBe(true);
    // Undiscovered trap is completely stripped so network packets cannot cheat
    expect(view.props.some((p) => p.id === 'unspotted-trap')).toBe(false);
  });

  it('never leaks authoritative rngState or unowned private turn budget', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    const goblin = makeMonster('goblin-1', 'Goblin', 3, 2);

    let state = createInitialGameState({
      grid,
      party: [hero],
      monsters: [goblin],
      slots: [
        {
          playerId: 'player-1',
          displayName: 'Player One',
          controlledCharacterIds: ['hero-1'],
        },
      ],
      rngState: 999888777,
    });

    // Start combat
    state = reduceGame(state, {
      type: 'START_COMBAT',
      encounterId: 'combat-1',
    }).nextState;

    const view = projectPlayerView(state, 'player-1');

    // rngState must not exist on view
    expect((view as any).rngState).toBeUndefined();

    // Turn budget is only provided if active combatant belongs to player-1
    if (state.combat?.activeCombatantId === 'hero-1') {
      expect(view.combat?.turnBudget).not.toBeNull();
    } else {
      expect(view.combat?.turnBudget).toBeNull();
    }
  });

  it('unconscious or blinded observers have no vision', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    hero.conditions.push('blinded');

    const state = createInitialGameState({
      grid,
      party: [hero],
    });

    const view = projectPlayerView(state, 'player-1');
    const visibleCount = view.grid.cells.filter((c) => c.visibility === 'visible').length;
    expect(visibleCount).toBe(0);
  });

  it('honours per-player exploredCells instead of the shared authoritative memory (SRD-703)', () => {
    let grid = createTacticalGrid(10, 10);
    grid = setGridCells(
      grid,
      Array.from({ length: 10 }, (_, y) => ({
        x: 5,
        y,
        terrain: 'wall_solid' as const,
        blocksSight: true,
        blocksMovement: true,
      })),
    );
    const hero = makePartyMember('hero-1', 'Hero', 2, 5);
    const state = createInitialGameState({ grid, party: [hero] });
    // The global state claims a cell behind the wall was explored.
    state.exploredCells['7,5'] = true;

    const defaultView = projectPlayerView(state, 'player-1');
    expect(defaultView.grid.cells.find((c) => c.x === 7 && c.y === 5)?.visibility).toBe(
      'remembered',
    );

    // A player who never visited that cell gets an isolated memory override.
    const isolatedView = projectPlayerView(state, 'player-1', { exploredCells: {} });
    expect(isolatedView.grid.cells.find((c) => c.x === 7 && c.y === 5)?.visibility).toBe(
      'unexplored',
    );
  });

  it('projects the reaction deadline only to the controlling player (SRD-703)', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    const goblin = makeMonster('goblin-1', 'Goblin', 3, 2);
    let state = createInitialGameState({
      grid,
      party: [hero],
      monsters: [goblin],
      slots: [
        { playerId: 'player-1', displayName: 'P1', controlledCharacterIds: ['hero-1'] },
        { playerId: 'player-2', displayName: 'P2', controlledCharacterIds: ['goblin-1'] },
      ],
    });
    state = reduceGame(state, { type: 'START_COMBAT', encounterId: 'combat-rxn' }).nextState;
    state.combat!.phase = 'reaction_prompt';
    state.combat!.pendingReactionPrompt = {
      promptId: 'prompt-1',
      reactorEntityId: 'hero-1',
      triggerType: 'attack_roll_hit',
      triggerDescription: 'Goblin hits Hero',
      availableReactions: [
        {
          id: 'shield',
          label: 'Cast Shield',
          reactionType: 'shield',
          slotLevel: 1,
        },
      ],
      timeoutMs: 30000,
    };

    const ownerView = projectPlayerView(state, 'player-1', {
      reactionPromptDeadline: 1700000000000,
    });
    const otherView = projectPlayerView(state, 'player-2', {
      reactionPromptDeadline: 1700000000000,
    });

    expect(ownerView.combat?.pendingReactionPrompt?.promptId).toBe('prompt-1');
    expect(ownerView.combat?.reactionPromptDeadline).toBe(1700000000000);
    expect(otherView.combat?.pendingReactionPrompt).toBeNull();
    expect(otherView.combat?.reactionPromptDeadline).toBeNull();
  });

  it('projects active buffs and concentration so the client can show status', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makePartyMember('hero-1', 'Hero', 2, 2);
    hero.conditions.push('poisoned');
    hero.activeEffects = [
      {
        effectId: 'bless-buff',
        name: 'Bless',
        requiresConcentration: true,
        remainingRounds: 8,
        modifiers: [],
      },
    ];
    hero.concentratingOn = {
      sourceId: 'bless',
      sourceName: 'Bless',
      targetEntityIds: ['hero-1'],
      remainingRounds: 8,
    };

    const state = createInitialGameState({
      grid,
      party: [hero],
    });

    const view = projectPlayerView(state, 'player-1');
    expect(view.party['hero-1']?.conditions).toContain('poisoned');
    expect(view.party['hero-1']?.activeEffects).toHaveLength(1);
    expect(view.party['hero-1']?.activeEffects?.[0]?.name).toBe('Bless');
    expect(view.party['hero-1']?.concentratingOn?.sourceId).toBe('bless');
  });
});
