import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  type DeepDescentRunState,
  type GraveyardEntry,
  startRogueliteRun,
} from '@srd5/engine';
import {
  RogueliteHud,
  ShrineModal,
  GraveyardModal,
  DungeonView,
  buildRogueliteSession,
} from '../components/dungeon/index.js';
import {
  saveGraveyardEntry,
  loadGraveyardEntries,
  getGraveyardHighScores,
  clearGraveyardEntries,
} from '../persistence/roguelitePersistence.js';
import { App } from '../App.js';

describe('SRD-509: Deep Descent Roguelite UI & Experience', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  const mockRunState: DeepDescentRunState = {
    runId: 'run-test-123',
    seed: 42,
    currentDepth: 3,
    maxDepthReached: 3,
    party: {},
    suppliesRemaining: 8,
    goldCollected: 140,
    monstersSlain: 9,
    totalXp: 1200,
    turnsTaken: 35,
    shrineBlessings: ['Shrine of the Blood God: +2 Attack Rolls for 3 floors'],
    activeCurses: [],
    restCount: { short: 1, long: 1 },
    score: 4850,
    isComplete: false,
  };

  describe('1. RogueliteHud Component', () => {
    it('renders depth, biome badge, rations, gold, score, and active blessings', () => {
      render(<RogueliteHud runState={mockRunState} />);

      expect(screen.getByTestId('roguelite-hud-bar')).toBeDefined();
      expect(screen.getByText(/Depth 3/i)).toBeDefined();
      expect(screen.getByText(/The Catacombs/i)).toBeDefined();
      expect(screen.getByText(/8 Rations/i)).toBeDefined();
      expect(screen.getByText(/140 GP/i)).toBeDefined();
      expect(screen.getByText(/4,850 pts/i)).toBeDefined();
      expect(screen.getByText(/9 Slain/i)).toBeDefined();
      expect(screen.getByText(/✦ Shrine of the Blood God/i)).toBeDefined();
    });

    it('displays warning style when rations are critically low (< 4)', () => {
      const lowRationsRun = { ...mockRunState, suppliesRemaining: 2 };
      render(<RogueliteHud runState={lowRationsRun} />);

      const rationsElement = screen.getByText(/2 Rations/i).closest('div');
      expect(rationsElement?.className).toContain('text-rose-400');
    });
  });

  describe('2. ShrineModal Component', () => {
    it('renders Shrine of the Blood God with risk and reward details', () => {
      const handleActivate = vi.fn();
      const handleClose = vi.fn();

      const bloodShrine = {
        id: 'prop-shrine-1',
        x: 5,
        y: 5,
        kind: 'shrine' as const,
        shrineType: 'shrine_blood_god',
        state: 'closed' as const,
        blocksMovement: false,
        blocksSight: false,
      };

      render(
        <ShrineModal
          isOpen={true}
          shrine={bloodShrine}
          actorName="Valeros the Fighter"
          onClose={handleClose}
          onActivate={handleActivate}
        />,
      );

      expect(screen.getByTestId('shrine-modal')).toBeDefined();
      expect(screen.getByText(/Shrine of the Blood God/i)).toBeDefined();
      expect(screen.getByText(/\+2 to all attack rolls for 3 dungeon floors/i)).toBeDefined();
      expect(screen.getByText(/Permanently reduces your maximum Hit Points by 15%/i)).toBeDefined();

      const activateBtn = screen.getByTestId('shrine-activate-button');
      expect(activateBtn.textContent).toMatch(/Make Blood Offering/i);

      fireEvent.click(activateBtn);
      expect(handleActivate).toHaveBeenCalledWith('prop-shrine-1');
      expect(handleClose).toHaveBeenCalled();
    });

    it('renders Fountain of Restoration and handles close without activation', () => {
      const handleActivate = vi.fn();
      const handleClose = vi.fn();

      const fountain = {
        id: 'prop-fountain-1',
        x: 6,
        y: 6,
        kind: 'shrine' as const,
        shrineType: 'fountain_restoration',
        state: 'closed' as const,
        blocksMovement: false,
        blocksSight: false,
      };

      render(
        <ShrineModal
          isOpen={true}
          shrine={fountain}
          actorName="Kyra the Cleric"
          onClose={handleClose}
          onActivate={handleActivate}
        />,
      );

      expect(screen.getByText(/Fountain of Restoration/i)).toBeDefined();
      expect(screen.getByText(/Restores all party members to maximum HP/i)).toBeDefined();

      const stepAwayBtn = screen.getByText(/Step Away/i);
      fireEvent.click(stepAwayBtn);
      expect(handleClose).toHaveBeenCalled();
      expect(handleActivate).not.toHaveBeenCalled();
    });
  });

  describe('3. GraveyardModal & Persistence', () => {
    beforeAll(() => {
      clearGraveyardEntries();
    });

    it('saves and loads graveyard entries and computes top high scores', () => {
      const entry1: GraveyardEntry = {
        runId: 'run-1',
        timestamp: new Date().toISOString(),
        depth: 4,
        score: 3200,
        monstersSlain: 8,
        goldCollected: 45,
        deathCause: 'Slain by Wight',
        livingPartyCount: 0,
        totalPartyCount: 4,
        partyNames: ['Hero A'],
        turnsTaken: 50,
      };

      const entry2: GraveyardEntry = {
        runId: 'run-2',
        timestamp: new Date().toISOString(),
        depth: 7,
        score: 7500,
        monstersSlain: 20,
        goldCollected: 210,
        deathCause: 'Incinerated in Magma Caverns',
        livingPartyCount: 0,
        totalPartyCount: 4,
        partyNames: ['Hero B'],
        turnsTaken: 90,
      };

      saveGraveyardEntry(entry1);
      saveGraveyardEntry(entry2);

      const loaded = loadGraveyardEntries();
      expect(loaded.length).toBeGreaterThanOrEqual(2);

      const highScores = getGraveyardHighScores(5);
      expect(highScores[0]!.score).toBe(7500);
      expect(highScores[1]!.score).toBe(3200);
    });

    it('renders GraveyardModal with score banner and hall of fame', () => {
      const handleNewRun = vi.fn();
      const handleExit = vi.fn();

      const currentEntry: GraveyardEntry = {
        runId: 'run-current',
        timestamp: new Date().toISOString(),
        depth: 5,
        score: 5200,
        monstersSlain: 14,
        goldCollected: 95,
        deathCause: 'Starved in The Sunken Tombs',
        livingPartyCount: 0,
        totalPartyCount: 4,
        partyNames: ['Fighter', 'Cleric'],
        turnsTaken: 65,
      };

      render(
        <GraveyardModal
          isOpen={true}
          currentEntry={currentEntry}
          onStartNewRun={handleNewRun}
          onExitToRoster={handleExit}
        />,
      );

      expect(screen.getByTestId('graveyard-modal')).toBeDefined();
      expect(screen.getByText(/The Descent Has Ended/i)).toBeDefined();
      expect(screen.getByText(/★ 5,200/i)).toBeDefined();
      expect(screen.getByText(/Starved in The Sunken Tombs/i)).toBeDefined();

      const newRunBtn = screen.getByTestId('graveyard-new-run-button');
      fireEvent.click(newRunBtn);
      expect(handleNewRun).toHaveBeenCalled();
    });
  });

  describe('4. DungeonView Roguelite Mode Integration', () => {
    it('mounts in roguelite mode and renders RogueliteHud at Depth 1', () => {
      const party = [getPregenCharacter('pregen-fighter')!];

      render(
        <DungeonView
          partyCharacters={party}
          compendium={defaultCompendium}
          gameMode="roguelite"
          onExitToRoster={vi.fn()}
        />,
      );

      expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
      expect(screen.getByTestId('roguelite-hud-bar')).toBeDefined();
      expect(screen.getAllByText(/Depth 1/i)[0]).toBeDefined();
      expect(screen.getAllByText(/The Catacombs/i)[0]).toBeDefined();
      expect(screen.getByText(/10 Rations/i)).toBeDefined();
    });
  });

  describe('5. App Navigation to Deep Descent', () => {
    it('switches to Deep Descent roguelite view when navigation button is clicked', () => {
      render(<App initialView="roster" />);

      const rogueliteNavBtn = screen.getByTestId('app-nav-roguelite');
      expect(rogueliteNavBtn).toBeDefined();

      fireEvent.click(rogueliteNavBtn);
      expect(rogueliteNavBtn.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('roguelite-hud-bar')).toBeDefined();
    });
  });
});
