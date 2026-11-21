import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CampaignSetupWizard,
  WorldOptionsBanner,
  WorldOptionsForm,
  type CampaignLaunchConfig,
} from '../components/campaign/index.js';
import { RogueliteHud } from '../components/dungeon/RogueliteHud.js';
import { GraveyardModal } from '../components/dungeon/GraveyardModal.js';
import {
  DEFAULT_WORLD_OPTIONS,
  type DeepDescentRunState,
  type WorldOptions,
} from '@srd5/engine';

afterEach(() => {
  cleanup();
});

function makeRunState(worldOptions?: WorldOptions): DeepDescentRunState {
  return {
    runId: 'test_run',
    seed: worldOptions?.seed ?? 1337,
    currentDepth: 2,
    maxDepthReached: 2,
    party: {},
    suppliesRemaining: 8,
    goldCollected: 100,
    monstersSlain: 5,
    totalXp: 500,
    turnsTaken: 20,
    shrineBlessings: [],
    activeCurses: [],
    restCount: { short: 0, long: 1 },
    score: 2500,
    isComplete: false,
    ...(worldOptions ? { worldOptions } : {}),
  };
}

describe('SRD-1403: World-generation options (Civ setup screen) — client', () => {
  describe('WorldOptionsForm', () => {
    it('renders all four option rows plus seed controls for the Realm', () => {
      const onChange = vi.fn();
      render(<WorldOptionsForm value={{ ...DEFAULT_WORLD_OPTIONS }} onChange={onChange} />);
      expect(screen.getByTestId('world-options-form')).toBeDefined();
      expect(screen.getByTestId('world-scope-grand')).toBeDefined();
      expect(screen.getByTestId('world-wildness-wild')).toBeDefined();
      expect(screen.getByTestId('world-scarcity-scarce')).toBeDefined();
      expect(screen.getByTestId('world-war-total_war')).toBeDefined();
      expect(screen.getByTestId('world-seed-input')).toBeDefined();
      expect(screen.getByTestId('world-seed-daily-btn')).toBeDefined();
      expect(screen.getByTestId('world-seed-preview')).toBeDefined();
    });

    it('hides the war row for Descent-only setups', () => {
      render(
        <WorldOptionsForm
          value={{ ...DEFAULT_WORLD_OPTIONS }}
          onChange={vi.fn()}
          showWarIntensity={false}
        />,
      );
      expect(screen.queryByTestId('world-war-total_war')).toBeNull();
    });

    it('picks scope/wildness/scarcity and rolls the daily seed visibly', () => {
      let next: WorldOptions | null = null;
      const onChange = vi.fn((v: WorldOptions) => {
        next = v;
      });
      render(<WorldOptionsForm value={{ ...DEFAULT_WORLD_OPTIONS }} onChange={onChange} />);
      fireEvent.click(screen.getByTestId('world-scope-grand'));
      expect(onChange).toHaveBeenCalled();
      expect(next!.scope).toBe('grand');
      fireEvent.click(screen.getByTestId('world-wildness-calm'));
      expect(next!.wildness).toBe('calm');
      fireEvent.click(screen.getByTestId('world-seed-daily-btn'));
      expect(next!.seedSource).toBe('daily');
      expect(next!.dailyDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('WorldOptionsBanner', () => {
    it('renders the session config summary with the visible seed', () => {
      render(
        <WorldOptionsBanner
          options={{ ...DEFAULT_WORLD_OPTIONS, scope: 'grand', seed: 42, seedSource: 'manual' }}
        />,
      );
      const banner = screen.getByTestId('world-options-banner');
      expect(banner.textContent).toContain('Grand');
      expect(banner.textContent).toContain('42');
    });
  });

  describe('CampaignSetupWizard integration', () => {
    it('shows world options on Stage 2 for the Realm and carries them to launch', () => {
      let launched: CampaignLaunchConfig | null = null;
      render(
        <CampaignSetupWizard
          initialMode="realm"
          initialStage={2}
          onLaunch={(cfg) => {
            launched = cfg;
          }}
        />,
      );
      expect(screen.getByTestId('world-options-form')).toBeDefined();
      fireEvent.click(screen.getByTestId('world-scope-grand'));
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      expect(screen.getByTestId('wizard-world-summary')).toBeDefined();
      expect(screen.getByTestId('wizard-world-summary').textContent).toContain('grand');
      fireEvent.click(screen.getByTestId('wizard-launch-cta'));
      expect(launched).not.toBeNull();
      expect(launched!.worldOptions?.scope).toBe('grand');
      expect(launched!.mode).toBe('realm');
    });

    it('hides world options for the fixed Kaelen campaign and omits them from launch', () => {
      let launched: CampaignLaunchConfig | null = null;
      render(
        <CampaignSetupWizard
          initialMode="campaign_kaelen"
          initialStage={2}
          onLaunch={(cfg) => {
            launched = cfg;
          }}
        />,
      );
      expect(screen.queryByTestId('world-options-form')).toBeNull();
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      expect(screen.queryByTestId('wizard-world-summary')).toBeNull();
      fireEvent.click(screen.getByTestId('wizard-launch-cta'));
      expect(launched).not.toBeNull();
      expect(launched!.worldOptions).toBeUndefined();
    });
  });

  describe('HUD banner + run record + graveyard', () => {
    it('RogueliteHud shows the banner when the run carries options', () => {
      const { container } = render(
        <RogueliteHud
          runState={makeRunState({ ...DEFAULT_WORLD_OPTIONS, scope: 'grand', seed: 99, seedSource: 'manual' })}
        />,
      );
      expect(screen.getByTestId('world-options-banner')).toBeDefined();
      void container;
    });

    it('RogueliteHud omits the banner for legacy runs without options', () => {
      render(<RogueliteHud runState={makeRunState()} />);
      expect(screen.queryByTestId('world-options-banner')).toBeNull();
    });

    it('GraveyardModal renders the persisted world options run record', () => {
      render(
        <GraveyardModal
          isOpen
          currentEntry={{
            runId: 'run_1',
            timestamp: new Date().toISOString(),
            depth: 4,
            score: 4200,
            monstersSlain: 12,
            goldCollected: 300,
            deathCause: 'Slain',
            livingPartyCount: 2,
            totalPartyCount: 4,
            partyNames: ['A', 'B'],
            turnsTaken: 40,
            worldOptions: { ...DEFAULT_WORLD_OPTIONS, scope: 'grand', scarcity: 'scarce', seed: 6006, seedSource: 'manual' },
          }}
          onStartNewRun={vi.fn()}
          onExitToRoster={vi.fn()}
        />,
      );
      const record = screen.getByTestId('graveyard-world-options');
      expect(record.textContent).toContain('Grand');
      expect(record.textContent).toContain('Scarce');
    });
  });
});
