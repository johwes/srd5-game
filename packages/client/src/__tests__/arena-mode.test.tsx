import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  createArenaGrid,
  getMonstersForWave,
  buildArenaPveEncounter,
  buildArenaPvpEncounter,
  applyArenaBreather,
  spawnNextWave,
  evaluateArenaOutcome,
  getDefaultPartyCharacters,
} from '../components/arena/arenaEngine.js';
import { ArenaSetupView } from '../components/arena/ArenaSetupView.js';
import { ArenaCombatView } from '../components/arena/ArenaCombatView.js';
import { ArenaView } from '../components/arena/ArenaView.js';
import { App } from '../App.js';
import type { ArenaConfig } from '../components/arena/types.js';

describe('SRD-408: The Arena Mode (PvE Skirmish, Endless Waves & Hot-Seat PvP 1v1)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  describe('arenaEngine: Tactical Maps and Obstacles', () => {
    it('creates open_sands with stone floor and no movement blocking obstacles', () => {
      const grid = createArenaGrid(12, 12, 'open_sands');
      expect(grid.width).toBe(12);
      expect(grid.height).toBe(12);
      expect(grid.cells.every((c) => !c.blocksMovement)).toBe(true);
    });

    it('creates pillars environment with 4 solid sight and movement blocking pillars', () => {
      const grid = createArenaGrid(12, 12, 'pillars');
      const blockingCells = grid.cells.filter(
        (c) => c.blocksMovement && c.blocksSight,
      );
      expect(blockingCells.length).toBe(4);
      expect(blockingCells.every((c) => c.terrain === 'wall_solid')).toBe(true);
    });

    it('themes each environment with a distinct floor so the map reads differently', () => {
      expect(
        createArenaGrid(12, 12, 'open_sands').cells.every(
          (c) => c.terrain === 'floor_sand',
        ),
      ).toBe(true);

      const chasmGrid = createArenaGrid(12, 12, 'chasm_bridge');
      const chasmBase = chasmGrid.cells.filter((c) => c.terrain === 'floor_basalt');
      expect(chasmBase.length).toBeGreaterThan(0);

      const lavaGrid = createArenaGrid(12, 12, 'hazards_lava');
      const lavaBase = lavaGrid.cells.filter((c) => c.terrain === 'floor_basalt');
      expect(lavaBase.length).toBeGreaterThan(0);
    });

    it('creates chasm_bridge environment with movement blocking chasm and central bridge', () => {
      const width = 12;
      const height = 12;
      const grid = createArenaGrid(width, height, 'chasm_bridge');
      const midY = Math.floor(height / 2);
      const bridgeX1 = Math.floor(width / 2) - 1;
      const bridgeX2 = Math.floor(width / 2);

      for (let x = 0; x < width; x++) {
        const cell = grid.cells.find((c) => c.x === x && c.y === midY);
        expect(cell).toBeDefined();
        if (x === bridgeX1 || x === bridgeX2) {
          expect(Boolean(cell?.blocksMovement)).toBe(false);
          expect(cell?.terrain).toBe('floor_wood');
        } else {
          expect(cell?.blocksMovement).toBe(true);
          expect(Boolean(cell?.blocksSight)).toBe(false);
          expect(cell?.terrain).toBe('chasm');
        }
      }
    });

    it('creates hazards_lava environment with difficult terrain lava pools in corners', () => {
      const grid = createArenaGrid(12, 12, 'hazards_lava');
      const lavaCells = grid.cells.filter(
        (c) => c.terrain === 'lava' && c.difficultTerrain,
      );
      expect(lavaCells.length).toBeGreaterThan(0);
    });
  });

  describe('arenaEngine: PvE Wave and Encounter Generation', () => {
    it('scales monster count and compositions across difficulty tiers and wave numbers', () => {
      const wave1Easy = getMonstersForWave(defaultCompendium, 1, 'easy');
      const wave1Deadly = getMonstersForWave(defaultCompendium, 1, 'deadly');
      expect(wave1Deadly.length).toBeGreaterThan(wave1Easy.length);

      const wave2 = getMonstersForWave(defaultCompendium, 2, 'medium');
      expect(wave2.length).toBeGreaterThan(0);

      const wave3 = getMonstersForWave(defaultCompendium, 3, 'medium');
      expect(wave3).toContain('ogre');

      // Custom override takes precedence
      const custom = getMonstersForWave(defaultCompendium, 1, 'medium', ['wolf', 'goblin']);
      expect(custom).toEqual(['wolf', 'goblin']);
    });

    it('buildArenaPveEncounter initializes heroes and monsters on opposite sides and starts combat', () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'arena-test-pve',
        name: 'Test PvE Arena',
        mode: 'custom_skirmish',
        mapId: 'arena-12x12-pillars',
        gridWidth: 12,
        gridHeight: 12,
        environmentObstacles: 'pillars',
        pveSettings: {
          difficultyTier: 'medium',
          waveCount: 1,
          restFrequencyWaves: 2,
        },
      };

      const { state, transport } = buildArenaPveEncounter(config, party, 1, defaultCompendium);
      expect(state.mode).toBe('combat');
      expect(state.combat).not.toBeNull();
      expect(Object.keys(state.party).length).toBe(4);
      expect(Object.keys(state.monsters).length).toBeGreaterThan(0);

      // Heroes along bottom edge, monsters along top edge
      const heroPositions = Object.values(state.party).map((h) => h.position);
      const monsterPositions = Object.values(state.monsters).map((m) => m.position);
      expect(heroPositions.every((p) => p.y === 10)).toBe(true);
      expect(monsterPositions.every((p) => p.y === 1)).toBe(true);

      const view = transport.getPlayerViewState();
      expect(view.mode).toBe('combat');
      expect(view.combat).not.toBeNull();
      expect(Object.keys(view.combatants).length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('arenaEngine: PvP Duel Setup & Allegiance Matrix', () => {
    it('buildArenaPvpEncounter configures dynamic teamId slots with mutual hostility', () => {
      const heroFighter = getPregenCharacter('pregen-fighter')!;
      const heroWizard = getPregenCharacter('pregen-wizard')!;
      const heroRogue = getPregenCharacter('pregen-rogue')!;
      const heroCleric = getPregenCharacter('pregen-cleric')!;

      const config: ArenaConfig = {
        id: 'arena-test-pvp',
        name: 'Test PvP Duel',
        mode: 'pvp_duel',
        mapId: 'arena-12x12-open',
        gridWidth: 12,
        gridHeight: 12,
        environmentObstacles: 'open_sands',
        pvpSettings: {
          teamA: {
            playerId: 'player_red',
            teamId: 'team_red',
            teamName: 'Red Dragons',
            color: '#ef4444',
            roster: [heroFighter, heroWizard],
          },
          teamB: {
            playerId: 'player_blue',
            teamId: 'team_blue',
            teamName: 'Blue Wyverns',
            color: '#3b82f6',
            roster: [heroRogue, heroCleric],
          },
          fogOfWar: 'none',
        },
      };

      const { state, transport } = buildArenaPvpEncounter(config, defaultCompendium);
      expect(state.mode).toBe('combat');
      expect(state.combat).not.toBeNull();
      expect(state.slots.length).toBe(2);
      expect(state.slots[0].playerId).toBe('player_red');
      expect(state.slots[1].playerId).toBe('player_blue');

      // Check team allegiances
      const teamRedCombatants = Object.values(state.party);
      const teamBlueCombatants = Object.values(state.monsters);
      expect(teamRedCombatants.every((c) => c.teamId === 'team_red')).toBe(true);
      expect(teamBlueCombatants.every((c) => c.teamId === 'team_blue')).toBe(true);

      // Check mutual hostility matrix
      const matrix = state.combat?.dispositionMatrix;
      expect(matrix?.team_red?.team_blue).toBe('hostile');
      expect(matrix?.team_blue?.team_red).toBe('hostile');

      const view = transport.getPlayerViewState();
      expect(view.mode).toBe('combat');
      expect(view.combat).not.toBeNull();
    });
  });

  describe('arenaEngine: Breather Rest & Wave Progression', () => {
    it('applyArenaBreather restores 50% HP, spell slots, and clears temporary conditions for living heroes', () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'arena-test-breather',
        name: 'Breather Test',
        mode: 'endless_waves',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
      };

      const { state } = buildArenaPveEncounter(config, party, 1, defaultCompendium);
      const hero = Object.values(state.party)[0];

      // Simulate damage, expended spell slots, and condition
      state.party[hero.id] = {
        ...hero,
        currentHp: 2,
        conditions: ['poisoned', 'prone'],
        spellSlots: {
          '1': { max: 2, expended: 2, available: 0 },
        },
      };

      const restedState = applyArenaBreather(state);
      const restedHero = restedState.party[hero.id];

      // Should heal 50% max HP
      const expectedHp = Math.min(hero.maxHp, 2 + Math.ceil(hero.maxHp * 0.5));
      expect(restedHero.currentHp).toBe(expectedHp);
      expect(restedHero.conditions).not.toContain('poisoned');
      expect(restedHero.conditions).not.toContain('prone');
      expect(restedHero.spellSlots?.['1'].available).toBe(2);
      expect(restedHero.spellSlots?.['1'].expended).toBe(0);
    });

    it('spawnNextWave re-initializes monsters and rolls new initiative', () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'arena-test-wave',
        name: 'Wave Test',
        mode: 'endless_waves',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
      };

      const { state } = buildArenaPveEncounter(config, party, 1, defaultCompendium);
      const wave2State = spawnNextWave(state, 2, config, defaultCompendium, 100);

      expect(wave2State.mode).toBe('combat');
      expect(wave2State.combat).not.toBeNull();
      expect(wave2State.combat?.encounterId).toBe('arena-wave-2');
      expect(Object.keys(wave2State.monsters).length).toBeGreaterThan(0);
    });

    it('evaluateArenaOutcome accurately detects victory, defeat, wave_cleared, and PvP winners', () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'arena-test-outcome',
        name: 'Outcome Test',
        mode: 'custom_skirmish',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
      };

      const { transport } = buildArenaPveEncounter(config, party, 1, defaultCompendium);
      const view = transport.getPlayerViewState();

      // Initially in progress
      expect(evaluateArenaOutcome(view, 'custom_skirmish').status).toBe('in_progress');

      // Kill all monsters -> victory in custom skirmish
      const victoryView = {
        ...view,
        combatants: Object.fromEntries(
          Object.entries(view.combatants).map(([id, c]) => [
            id,
            (c.teamId ?? c.side) === 'party' ? c : { ...c, currentHp: 0, isDead: true },
          ]),
        ),
      };
      expect(evaluateArenaOutcome(victoryView, 'custom_skirmish').status).toBe('victory');
      expect(evaluateArenaOutcome(victoryView, 'endless_waves').status).toBe('wave_cleared');

      // Kill all party -> defeat
      const defeatView = {
        ...view,
        combatants: Object.fromEntries(
          Object.entries(view.combatants).map(([id, c]) => [
            id,
            (c.teamId ?? c.side) === 'party' ? { ...c, currentHp: 0, isDead: true } : c,
          ]),
        ),
      };
      expect(evaluateArenaOutcome(defeatView, 'custom_skirmish').status).toBe('defeat');

      // PvP evaluation
      const pvpView = {
        ...view,
        combatants: {
          red1: {
            id: 'red1',
            name: 'Red Fighter',
            side: 'party' as const,
            teamId: 'team_red',
            size: 'medium' as const,
            position: { x: 0, y: 0 },
            speedFeet: 30,
            maxHp: 20,
            currentHp: 20,
            tempHp: 0,
            armorClass: 16,
            conditions: [],
            isDead: false,
            isStable: false,
            isProne: false,
          },
          blue1: {
            id: 'blue1',
            name: 'Blue Wizard',
            side: 'monster' as const,
            teamId: 'team_blue',
            size: 'medium' as const,
            position: { x: 5, y: 5 },
            speedFeet: 30,
            maxHp: 15,
            currentHp: 0,
            tempHp: 0,
            armorClass: 12,
            conditions: [],
            isDead: true,
            isStable: false,
            isProne: false,
          },
        },
      };

      const pvpResult = evaluateArenaOutcome(pvpView, 'pvp_duel', {
        teamA: { playerId: 'p1', teamId: 'team_red', teamName: 'Team Red', color: '#f00', roster: [] },
        teamB: { playerId: 'p2', teamId: 'team_blue', teamName: 'Team Blue', color: '#00f', roster: [] },
        fogOfWar: 'none',
      });
      expect(pvpResult.status).toBe('victory');
      expect(pvpResult.winnerTeamId).toBe('team_red');
      expect(pvpResult.winnerName).toBe('Team Red');
    });
  });

  describe('ArenaSetupView UI', () => {
    it('renders mode tabs and toggles between Skirmish, Endless Waves, and PvP Duel', () => {
      const onLaunch = vi.fn();
      render(<ArenaSetupView onLaunchArena={onLaunch} />);

      expect(screen.getByTestId('arena-setup-view')).toBeDefined();
      expect(screen.getByTestId('arena-mode-skirmish')).toBeDefined();
      expect(screen.getByTestId('arena-mode-endless')).toBeDefined();
      expect(screen.getByTestId('arena-mode-pvp')).toBeDefined();

      // Switch to Endless Waves
      fireEvent.click(screen.getByTestId('arena-mode-endless'));
      expect(screen.getByText(/Begin Endless Wave Gauntlet/i)).toBeDefined();

      // Switch to PvP Duel
      fireEvent.click(screen.getByTestId('arena-mode-pvp'));
      expect(screen.getByText(/Player 1 · Team Red/i)).toBeDefined();

      // Launch PvP Duel
      fireEvent.click(screen.getByTestId('launch-arena-button'));
      expect(onLaunch).toHaveBeenCalledTimes(1);
      const config = onLaunch.mock.calls[0][0] as ArenaConfig;
      expect(config.mode).toBe('pvp_duel');
      expect(config.pvpSettings?.teamA.teamId).toBe('team_red');
      expect(config.pvpSettings?.teamB.teamId).toBe('team_blue');
    });

    it('allows changing grid size, environment obstacles, and difficulty tiers', () => {
      const onLaunch = vi.fn();
      render(<ArenaSetupView onLaunchArena={onLaunch} />);

      // Change grid size to 18x18
      fireEvent.click(screen.getByTestId('grid-size-18'));

      // Change environment to chasm_bridge
      fireEvent.click(screen.getByTestId('env-chasm_bridge'));

      // Change difficulty to deadly
      fireEvent.click(screen.getByTestId('difficulty-deadly'));

      fireEvent.click(screen.getByTestId('launch-arena-button'));
      const config = onLaunch.mock.calls[0][0] as ArenaConfig;
      expect(config.gridWidth).toBe(18);
      expect(config.gridHeight).toBe(18);
      expect(config.environmentObstacles).toBe('chasm_bridge');
      expect(config.pveSettings?.difficultyTier).toBe('deadly');
    });
  });

  describe('ArenaCombatView & ArenaView UI Integration', () => {
    it('renders ArenaCombatView with Tactical HUD and viewport canvas in PvE mode', () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'test-combat-view',
        name: 'The Arena — Custom Skirmish',
        mode: 'custom_skirmish',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
        pveSettings: {
          difficultyTier: 'medium',
          waveCount: 1,
          restFrequencyWaves: 2,
        },
      };

      const onExit = vi.fn();
      render(
        <ArenaCombatView
          config={config}
          partyCharacters={party}
          onExitToSetup={onExit}
        />,
      );

      expect(screen.getByTestId('arena-combat-view')).toBeDefined();
      expect(screen.getByTestId('tactical-combat-hud')).toBeDefined();
      expect(screen.getByTestId('tactical-canvas-viewport')).toBeDefined();

      // Exit button returns to setup
      fireEvent.click(screen.getByTestId('arena-exit-button'));
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('renders ArenaCombatView in PvP mode with PvP Turn Indicator', () => {
      const heroFighter = getPregenCharacter('pregen-fighter')!;
      const heroWizard = getPregenCharacter('pregen-wizard')!;
      const heroRogue = getPregenCharacter('pregen-rogue')!;
      const heroCleric = getPregenCharacter('pregen-cleric')!;

      const config: ArenaConfig = {
        id: 'test-pvp-view',
        name: 'Red Dragons vs Blue Wyverns',
        mode: 'pvp_duel',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
        pvpSettings: {
          teamA: {
            playerId: 'player_red',
            teamId: 'team_red',
            teamName: 'Red Dragons',
            color: '#ef4444',
            roster: [heroFighter, heroWizard],
          },
          teamB: {
            playerId: 'player_blue',
            teamId: 'team_blue',
            teamName: 'Blue Wyverns',
            color: '#3b82f6',
            roster: [heroRogue, heroCleric],
          },
          fogOfWar: 'none',
        },
      };

      render(
        <ArenaCombatView
          config={config}
          onExitToSetup={vi.fn()}
        />,
      );

      expect(screen.getByTestId('pvp-turn-indicator')).toBeDefined();
      expect(screen.getAllByText(/Red Dragons/i).length).toBeGreaterThan(0);
    });

    it('targeting clicks commit the armed action without popping the enemy info card', async () => {
      const party = getDefaultPartyCharacters();
      const config: ArenaConfig = {
        id: 'test-target-no-select',
        name: 'The Arena — Custom Skirmish',
        mode: 'custom_skirmish',
        mapId: 'arena-10x10-open',
        gridWidth: 10,
        gridHeight: 10,
        environmentObstacles: 'open_sands',
        pveSettings: {
          difficultyTier: 'medium',
          waveCount: 1,
          restFrequencyWaves: 2,
        },
      };

      render(
        <ArenaCombatView
          config={config}
          partyCharacters={party}
          onExitToSetup={vi.fn()}
        />,
      );

      // Active combatant is the party wizard — arm a ranged cantrip
      fireEvent.click(screen.getByTestId('hotbar-tab-spells'));
      fireEvent.click(screen.getByTestId('spell-filter-0'));
      fireEvent.click(screen.getByTestId('spell-cast-btn-fire-bolt'));
      expect(screen.getByTestId('targeting-commit-bar')).toBeDefined();

      // Clicking an enemy portrait commits the target (no enemy card popup).
      // Ribbon cards route through the same targeting handler as tokens.
      const foeCards = screen
        .getAllByTestId(/initiative-card-/)
        .filter((el) => /goblin|wolf/i.test(el.getAttribute('data-testid') ?? ''));
      expect(foeCards.length).toBeGreaterThan(0);
      fireEvent.click(foeCards[0]!);

      await waitFor(() =>
        expect(screen.queryByTestId('targeting-commit-bar')).toBeNull(),
      );
      expect(screen.queryByTestId('selected-enemy-card')).toBeNull();
    });

    it('ArenaView toggles between Setup and Combat views seamlessly', () => {      render(<ArenaView />);

      // Initially renders setup
      expect(screen.getByTestId('arena-setup-view')).toBeDefined();

      // Launch arena
      fireEvent.click(screen.getByTestId('launch-arena-button'));

      // Transitions to active combat
      expect(screen.getByTestId('arena-combat-view')).toBeDefined();

      // Exit back to setup
      fireEvent.click(screen.getByTestId('arena-exit-button'));
      expect(screen.getByTestId('arena-setup-view')).toBeDefined();
    });
  });

  describe('App Navigation and Roster integration', () => {
    it('navigates to The Arena from global App navigation bar', () => {
      render(<App initialView="roster" />);

      const arenaNavBtn = screen.getByTestId('app-nav-arena');
      expect(arenaNavBtn).toBeDefined();

      fireEvent.click(arenaNavBtn);
      expect(screen.getByTestId('arena-setup-view')).toBeDefined();
    });

    it('navigates to The Arena from Party Roster View Enter Arena button', () => {
      render(<App initialView="roster" />);

      const enterArenaBtn = screen.getByTestId('roster-enter-arena-btn');
      expect(enterArenaBtn).toBeDefined();

      fireEvent.click(enterArenaBtn);
      expect(screen.getByTestId('arena-setup-view')).toBeDefined();
    });
  });
});
