import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  calculateBossRushScore,
  computeDailyDescentSeed,
  getDailyDescentDateString,
  getDailyDescentSeed,
} from '@srd5/engine';
import { TitleMenuView } from '../components/title/TitleMenuView.js';
import { CampaignSetupWizard } from '../components/campaign/CampaignSetupWizard.js';
import { ArenaSetupView } from '../components/arena/ArenaSetupView.js';
import { PartyRosterView } from '../components/roster/PartyRosterView.js';
import {
  clearGraveyardEntries,
  createDefaultRosterData,
  hasAttemptedDailyDescent,
  saveGraveyardEntry,
} from '../persistence/index.js';
import { buildRogueliteSession } from '../components/dungeon/dungeonEngine.js';
import { buildArenaPveEncounter } from '../components/arena/arenaEngine.js';

describe('Remix Modes Client Suite (SRD-1005)', () => {
  beforeEach(() => {
    clearGraveyardEntries();
  });

  describe('Daily Descent UI & Session Integration', () => {
    it('renders the Daily Descent button on TitleMenuView with date and seed', () => {
      const onDailyDescent = vi.fn();
      render(
        <TitleMenuView
          onDailyDescent={onDailyDescent}
          activeSave={null}
        />,
      );

      const dailyBtn = screen.getByTestId('title-menu-daily-descent-btn');
      expect(dailyBtn).toBeDefined();
      expect(dailyBtn.textContent).toContain('Daily Descent');

      const expectedDate = getDailyDescentDateString();
      const expectedSeed = getDailyDescentSeed();
      expect(dailyBtn.textContent).toContain(expectedDate);
      expect(dailyBtn.textContent).toContain(expectedSeed.toString(16).toUpperCase());

      fireEvent.click(dailyBtn);
      expect(onDailyDescent).toHaveBeenCalledTimes(1);
    });

    it('detects whether Daily Descent has been attempted in local graveyard storage', () => {
      const today = getDailyDescentDateString();
      expect(hasAttemptedDailyDescent(today)).toBe(false);

      saveGraveyardEntry({
        runId: `daily_${today}_1234`,
        timestamp: `${today}T12:00:00.000Z`,
        depth: 5,
        score: 9800,
        monstersSlain: 15,
        goldCollected: 400,
        deathCause: 'Slain in Arena',
        livingPartyCount: 0,
        totalPartyCount: 4,
        partyNames: ['Garrick'],
        turnsTaken: 50,
        isDaily: true,
        dailyDate: today,
        mode: 'daily_descent',
      });

      expect(hasAttemptedDailyDescent(today)).toBe(true);
    });

    it('builds a Daily Descent roguelite session with isDaily metadata', () => {
      const session = buildRogueliteSession([], defaultCompendium, undefined, {
        isDaily: true,
      });

      expect(session.session.runState.isDaily).toBe(true);
      expect(session.session.runState.mode).toBe('daily_descent');
      expect(session.session.runState.dailyDate).toBe(getDailyDescentDateString());
    });
  });

  describe('Draft Party Generator in UI', () => {
    it('renders Draft Party button in CampaignSetupWizard and populates 4 rolled heroes', async () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      const draftBtn = screen.getByTestId('wizard-draft-party-btn');
      expect(draftBtn).toBeDefined();
      expect(draftBtn.textContent).toContain('Draft Party');

      fireEvent.click(draftBtn);

      await waitFor(() => {
        const success = screen.getByTestId('wizard-import-success');
        expect(success).toBeDefined();
        expect(success.textContent).toContain('Drafted 4');
      });
    });

    it('renders Draft Party button in PartyRosterView and updates active party', () => {
      const onUpdateRoster = vi.fn();
      const mockRoster = createDefaultRosterData();

      render(
        <PartyRosterView
          roster={mockRoster}
          compendium={defaultCompendium}
          onUpdateRoster={onUpdateRoster}
          onResetToIconics={vi.fn()}
          onInspectCharacter={vi.fn()}
          onLevelUpCharacter={vi.fn()}
        />,
      );

      const draftBtn = screen.getByTestId('roster-draft-party-btn');
      expect(draftBtn).toBeDefined();

      fireEvent.click(draftBtn);

      expect(onUpdateRoster).toHaveBeenCalledTimes(1);
      const updatedRoster = onUpdateRoster.mock.calls[0]![0];
      expect(updatedRoster.activePartyIds.length).toBe(4);
      expect(updatedRoster.characters.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Boss Rush Gauntlet in Arena UI', () => {
    it('renders Boss Rush mode in ArenaSetupView and selects it', () => {
      const onLaunchArena = vi.fn();
      render(
        <ArenaSetupView
          compendium={defaultCompendium}
          onLaunchArena={onLaunchArena}
        />,
      );

      const bossRushTab = screen.getByTestId('arena-mode-boss-rush');
      expect(bossRushTab).toBeDefined();
      expect(bossRushTab.textContent).toContain('Boss Rush');

      fireEvent.click(bossRushTab);

      const launchBtn = screen.getByTestId('launch-arena-button');
      expect(launchBtn.textContent).toContain('Enter Boss Rush Gauntlet');

      fireEvent.click(launchBtn);

      expect(onLaunchArena).toHaveBeenCalledTimes(1);
      const config = onLaunchArena.mock.calls[0]![0];
      expect(config.mode).toBe('boss_rush');
      expect(config.pveSettings?.waveCount).toBe(7);
      expect(config.pveSettings?.restFrequencyWaves).toBe(1);
    });

    it('builds Wave 1 Boss Rush encounter with Minotaur & Knight', () => {
      const encounter = buildArenaPveEncounter(
        {
          id: 'test-boss-rush',
          name: 'The Arena — Boss Rush Gauntlet',
          mode: 'boss_rush',
          mapId: 'arena-test',
          gridWidth: 20,
          gridHeight: 20,
          environmentObstacles: 'pillars',
          pveSettings: {
            difficultyTier: 'medium',
            waveCount: 7,
            restFrequencyWaves: 1,
          },
        },
        [getPregenCharacter('pregen-fighter')!],
        1,
        defaultCompendium,
      );

      const monsters = Object.values(encounter.state.monsters);
      expect(monsters.length).toBe(2);
      const names = monsters.map((m) => m.name);
      expect(names.some((n) => n.toLowerCase().includes('minotaur'))).toBe(true);
      expect(names.some((n) => n.toLowerCase().includes('knight'))).toBe(true);
    });
  });
});
