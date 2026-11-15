import React from 'react';
import { getPregenCharacter } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CampaignSetupWizard,
  type CampaignLaunchConfig,
} from '../components/campaign/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-602: CampaignSetupWizard (4-Stage "New Game" Launcher)', () => {
  const defaultFighter = getPregenCharacter('pregen-fighter')!;
  const defaultRogue = getPregenCharacter('pregen-rogue')!;
  const defaultWizard = getPregenCharacter('pregen-wizard')!;
  const defaultCleric = getPregenCharacter('pregen-cleric')!;

  describe('1. Wizard Initialization & Stage Stepper Navigation', () => {
    it('mounts on Stage 1 with stepper ribbon and Back to Title button', () => {
      const onBackToMenu = vi.fn();
      render(
        <CampaignSetupWizard
          onBackToMenu={onBackToMenu}
          onLaunch={vi.fn()}
        />,
      );

      expect(screen.getByTestId('campaign-setup-wizard')).toBeDefined();
      expect(screen.getByTestId('wizard-step-1')).toBeDefined();
      expect(screen.getByTestId('wizard-step-2')).toBeDefined();
      expect(screen.getByTestId('wizard-step-3')).toBeDefined();
      expect(screen.getByTestId('wizard-step-4')).toBeDefined();

      // Heading
      expect(screen.getByText('Select Your Adventure Mode')).toBeDefined();

      // Clicking Back on Stage 1 triggers onBackToMenu
      fireEvent.click(screen.getByTestId('wizard-nav-back'));
      expect(onBackToMenu).toHaveBeenCalledTimes(1);
    });

    it('navigates sequentially using Next and Back buttons', () => {
      render(
        <CampaignSetupWizard
          onLaunch={vi.fn()}
        />,
      );

      // Stage 1 -> Stage 2
      fireEvent.click(screen.getByTestId('wizard-nav-next'));
      expect(screen.getByText('Difficulty & Ruleset Configuration')).toBeDefined();

      // Stage 2 -> Stage 3
      fireEvent.click(screen.getByTestId('wizard-nav-next'));
      expect(screen.getByText('Campfire Party Assembly')).toBeDefined();

      // Stage 3 -> Stage 4
      fireEvent.click(screen.getByTestId('wizard-nav-next'));
      expect(screen.getByText('Narrative Prologue & Quest Briefing')).toBeDefined();

      // Back from Stage 4 -> Stage 3
      fireEvent.click(screen.getByTestId('wizard-nav-back'));
      expect(screen.getByText('Campfire Party Assembly')).toBeDefined();
    });

    it('allows jumping directly between stages via stepper buttons', () => {
      render(<CampaignSetupWizard onLaunch={vi.fn()} />);

      // Jump to step 3 directly
      fireEvent.click(screen.getByTestId('wizard-step-3'));
      expect(screen.getByText('Campfire Party Assembly')).toBeDefined();

      // Jump back to step 1
      fireEvent.click(screen.getByTestId('wizard-step-1'));
      expect(screen.getByText('Select Your Adventure Mode')).toBeDefined();
    });

    it('handles hardware Escape key to go back or return to title menu', () => {
      const onBackToMenu = vi.fn();
      render(
        <CampaignSetupWizard
          onBackToMenu={onBackToMenu}
          onLaunch={vi.fn()}
        />,
      );

      // Go to stage 2
      fireEvent.click(screen.getByTestId('wizard-step-2'));
      expect(screen.getByText('Difficulty & Ruleset Configuration')).toBeDefined();

      // Press Escape -> returns to stage 1
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByText('Select Your Adventure Mode')).toBeDefined();

      // Press Escape on stage 1 -> triggers onBackToMenu
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onBackToMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Stage 1: Adventure & Game Mode Selection', () => {
    it('presents all 3 modes with descriptions and features', () => {
      render(<CampaignSetupWizard onLaunch={vi.fn()} />);

      expect(screen.getByTestId('wizard-mode-card-campaign_kaelen')).toBeDefined();
      expect(screen.getByTestId('wizard-mode-card-deep_descent')).toBeDefined();
      expect(screen.getByTestId('wizard-mode-card-arena')).toBeDefined();

      expect(screen.getByText('The Sunken Crypt of Kaelen')).toBeDefined();
      expect(screen.getByText('The Deep Descent')).toBeDefined();
      expect(screen.getByText('The Arena')).toBeDefined();
    });

    it('allows selecting different modes and reflects selection in Stage 4 CTA and Prologue', () => {
      const onLaunch = vi.fn();
      render(<CampaignSetupWizard onLaunch={onLaunch} />);

      // Select Deep Descent
      fireEvent.click(screen.getByTestId('wizard-mode-card-deep_descent'));

      // Advance to Stage 4
      fireEvent.click(screen.getByTestId('wizard-step-4'));

      // Check narrative prologue reflects Deep Descent
      expect(screen.getByText('PROLOGUE: THE ENDLESS YAWNING ABYSS')).toBeDefined();
      expect(screen.getByText(/Maw of the World/i)).toBeDefined();
      expect(screen.getByTestId('wizard-launch-cta').textContent).toContain('DESCEND INTO THE DEPTHS');

      // Go back to Stage 1 and select The Arena
      fireEvent.click(screen.getByTestId('wizard-step-1'));
      fireEvent.click(screen.getByTestId('wizard-mode-card-arena'));

      // Advance to Stage 4
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      expect(screen.getByText('PROLOGUE: THE PROVING GROUNDS')).toBeDefined();
      expect(screen.getByTestId('wizard-launch-cta').textContent).toContain('ENTER THE ARENA');
    });
  });

  describe('3. Stage 2: Difficulty Presets & Custom Rules Drawer', () => {
    it('supports switching between Explorer, Standard, and Tactician presets', () => {
      render(<CampaignSetupWizard onLaunch={vi.fn()} />);
      fireEvent.click(screen.getByTestId('wizard-step-2'));

      expect(screen.getByTestId('wizard-preset-explorer')).toBeDefined();
      expect(screen.getByTestId('wizard-preset-standard')).toBeDefined();
      expect(screen.getByTestId('wizard-preset-tactician')).toBeDefined();

      // Click Tactician preset
      fireEvent.click(screen.getByTestId('wizard-preset-tactician'));

      // Check stage 4 summary reflects Tactician with permadeath
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      const summaryCard = screen.getByTestId('wizard-summary-card');
      expect(summaryCard.textContent).toContain('tactician Difficulty');
      expect(summaryCard.textContent).toContain('Permadeath: Iron Man (Enabled)');
    });

    it('expands custom rules drawer and adjusts individual parameters', () => {
      render(<CampaignSetupWizard onLaunch={vi.fn()} />);
      fireEvent.click(screen.getByTestId('wizard-step-2'));

      // Initially custom panel is collapsed
      expect(screen.queryByTestId('wizard-custom-rules-panel')).toBeNull();

      // Click customize button to expand
      fireEvent.click(screen.getByTestId('wizard-custom-rules-toggle'));
      expect(screen.getByTestId('wizard-custom-rules-panel')).toBeDefined();

      // Toggle permadeath checkbox
      const permadeathToggle = screen.getByTestId('wizard-toggle-permadeath') as HTMLInputElement;
      expect(permadeathToggle.checked).toBe(false);
      fireEvent.click(permadeathToggle);
      expect(permadeathToggle.checked).toBe(true);

      // Toggle friendly fire checkbox
      const friendlyFireToggle = screen.getByTestId('wizard-toggle-friendly-fire') as HTMLInputElement;
      expect(friendlyFireToggle.checked).toBe(true); // Standard preset defaults to true
      fireEvent.click(friendlyFireToggle);
      expect(friendlyFireToggle.checked).toBe(false);

      // Verify preset badge changes to "Custom Configuration"
      expect(screen.getByText('Custom Configuration')).toBeDefined();

      // Change death save rule to hardcore
      const deathSaveSelect = screen.getByTestId('wizard-select-death-save') as HTMLSelectElement;
      fireEvent.change(deathSaveSelect, { target: { value: 'hardcore' } });
      expect(deathSaveSelect.value).toBe('hardcore');

      // Advance to stage 4 and verify custom rules appear in launch payload
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      const summary = screen.getByTestId('wizard-summary-card');
      expect(summary.textContent).toContain('custom Difficulty');
      expect(summary.textContent).toContain('Permadeath: Iron Man (Enabled)');
    });
  });

  describe('4. Stage 3: Party Assembly & Synergy Calculation', () => {
    it('populates with 4 iconic SRD pregens and shows all 4 synergy badges by default', () => {
      render(<CampaignSetupWizard onLaunch={vi.fn()} />);
      fireEvent.click(screen.getByTestId('wizard-step-3'));

      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Garrick Vance');
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Vex Tealeaf');
      expect(screen.getByTestId('wizard-party-slot-2').textContent).toContain('Lyra Silversun');
      expect(screen.getByTestId('wizard-party-slot-3').textContent).toContain('Bram Ironheart');

      const synergy = screen.getByTestId('wizard-synergy-ribbon');
      expect(synergy.textContent).toContain('Frontline Anchor ✓');
      expect(synergy.textContent).toContain('Trap & Lock Specialist ✓');
      expect(synergy.textContent).toContain('Divine Healing ✓');
      expect(synergy.textContent).toContain('Arcane Utility ✓');
    });

    it('resets to 4 iconics when Reset button is clicked', () => {
      // Mount with only 1 custom hero
      render(
        <CampaignSetupWizard
          initialParty={[defaultFighter]}
          onLaunch={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('wizard-step-3'));

      // Slot 1 should be empty initially
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('(Empty Hero Slot)');

      // Click reset to iconics
      fireEvent.click(screen.getByTestId('wizard-reset-iconics-btn'));
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Vex Tealeaf');
      expect(screen.getByTestId('wizard-party-slot-2').textContent).toContain('Lyra Silversun');
      expect(screen.getByTestId('wizard-party-slot-3').textContent).toContain('Bram Ironheart');
    });

    it('allows swapping heroes when availableRosterCharacters are provided', () => {
      const extraHero = {
        ...defaultFighter,
        id: 'hero-barbarian-test',
        name: 'Conan the Barbarian',
        classes: [{ ...defaultFighter.classes[0]!, classId: 'barbarian', level: 1 }],
      };

      render(
        <CampaignSetupWizard
          availableRosterCharacters={[extraHero, defaultFighter, defaultRogue]}
          onLaunch={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTestId('wizard-step-3'));

      const slot0Select = screen.getByTestId('wizard-slot-0-select') as HTMLSelectElement;
      fireEvent.change(slot0Select, { target: { value: 'hero-barbarian-test' } });

      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Conan the Barbarian');
    });
  });

  describe('5. Stage 4: Narrative Prologue & Complete Launch Flow', () => {
    it('displays atmospheric lore, quest objectives, and triggers onLaunch with complete config', () => {
      let launchedConfig: CampaignLaunchConfig | null = null;
      const onLaunch = vi.fn((cfg: CampaignLaunchConfig) => {
        launchedConfig = cfg;
      });

      render(
        <CampaignSetupWizard
          initialMode="campaign_kaelen"
          initialPreset="standard"
          onLaunch={onLaunch}
        />,
      );

      // Navigate to Stage 4
      fireEvent.click(screen.getByTestId('wizard-step-4'));

      // Check lore briefing
      const parchment = screen.getByTestId('wizard-narrative-parchment');
      expect(parchment.textContent).toContain('Rain lashes against the crumbling stone ruins of the Blackwood Ridge');
      expect(parchment.textContent).toContain('Sunstone Relic');
      expect(parchment.textContent).toContain('High Priest Kaelen');

      // Click launch CTA
      const launchBtn = screen.getByTestId('wizard-launch-cta');
      expect(launchBtn.textContent).toContain('EMBARK INTO THE CRYPT ⚔️');
      fireEvent.click(launchBtn);

      expect(onLaunch).toHaveBeenCalledTimes(1);
      expect(launchedConfig).not.toBeNull();
      expect(launchedConfig!.mode).toBe('campaign_kaelen');
      expect(launchedConfig!.difficulty.preset).toBe('standard');
      expect(launchedConfig!.difficulty.permadeath).toBe(false);
      expect(launchedConfig!.difficulty.campSuppliesRequired).toBe(true);
      expect(launchedConfig!.party.length).toBe(4);
      expect(launchedConfig!.party[0]?.name).toBe('Garrick Vance');
    });
  });
});
