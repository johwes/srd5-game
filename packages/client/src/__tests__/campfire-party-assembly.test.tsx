import React from 'react';
import {
  type CharacterBuildState,
  getPregenCharacter,
} from '@srd5/data';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import {
  CampaignSetupWizard,
  type CampaignLaunchConfig,
} from '../components/campaign/index.js';
import {
  createInMemoryRosterStorageAdapter,
  serializeCharacterToSrd5Json,
  serializeRosterToSrd5Json,
} from '../persistence/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-603: 4-Slot Campfire Party Assembly & Recruitment UI', () => {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const rogue = getPregenCharacter('pregen-rogue')!;
  const wizard = getPregenCharacter('pregen-wizard')!;
  const cleric = getPregenCharacter('pregen-cleric')!;

  describe('1. Campfire Lineup Layout & Default Iconic Population', () => {
    it('renders all 4 pedestals with role suggestions and default iconics', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      expect(screen.getByText('Campfire Party Assembly')).toBeDefined();
      expect(screen.getByTestId('wizard-party-slot-0')).toBeDefined();
      expect(screen.getByTestId('wizard-party-slot-1')).toBeDefined();
      expect(screen.getByTestId('wizard-party-slot-2')).toBeDefined();
      expect(screen.getByTestId('wizard-party-slot-3')).toBeDefined();

      // Check default iconics in slots
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Garrick Vance');
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Vex Tealeaf');
      expect(screen.getByTestId('wizard-party-slot-2').textContent).toContain('Lyra Silversun');
      expect(screen.getByTestId('wizard-party-slot-3').textContent).toContain('Bram Ironheart');

      // Check derived combat stats displayed on populated slots (HP, AC, Speed)
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Max HP');
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('AC');
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Speed');
    });

    it('clears all slots with Clear All button and displays empty slot placeholders', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      // Click Clear All
      fireEvent.click(screen.getByTestId('wizard-clear-all-slots-btn'));

      for (let i = 0; i < 4; i++) {
        expect(screen.getByTestId(`wizard-party-slot-${i}`).textContent).toContain(
          '(Empty Hero Slot)',
        );
      }

      // Shows party empty warning
      expect(screen.getByTestId('wizard-party-empty-warning').textContent).toContain(
        'You must have at least 1 hero in your party to embark',
      );

      // Next button should be disabled when party is empty
      expect(screen.getByTestId('wizard-nav-next')).toHaveProperty('disabled', true);
    });

    it('populates all 4 slots in one click with Quick-Pick All 4 Pregens button', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          initialParty={[]}
          onLaunch={vi.fn()}
        />,
      );

      // Initially slots are empty
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('(Empty Hero Slot)');

      // Click Quick-Pick All 4 Pregens
      fireEvent.click(screen.getByTestId('wizard-reset-iconics-btn'));

      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Garrick Vance');
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Vex Tealeaf');
      expect(screen.getByTestId('wizard-party-slot-2').textContent).toContain('Lyra Silversun');
      expect(screen.getByTestId('wizard-party-slot-3').textContent).toContain('Bram Ironheart');
    });
  });

  describe('2. Per-Slot Actions: Quick Pregen Pick & Clear Slot', () => {
    it('allows clearing an individual slot and quick-picking the matching pregen', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      // Clear slot 1 (Rogue)
      fireEvent.click(screen.getByTestId('wizard-clear-slot-1'));
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain(
        '(Empty Hero Slot)',
      );

      // Slot 1 should offer Quick Pregen button
      const quickRogueBtn = screen.getByTestId('wizard-slot-1-quick-pregen');
      expect(quickRogueBtn.textContent).toContain('Quick Rogue');

      // Click quick pick Rogue
      fireEvent.click(quickRogueBtn);
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Vex Tealeaf');
    });
  });

  describe('3. Character Vault Modal Import', () => {
    it('opens Vault modal, filters by search, and assigns hero to slot', () => {
      const customVeteran: CharacterBuildState = {
        ...fighter,
        id: 'hero-veteran-conan',
        name: 'Conan the Cimmerian',
        raceId: 'human',
        classes: [{ ...fighter.classes[0]!, classId: 'barbarian', level: 3 }],
      };

      render(
        <CampaignSetupWizard
          initialStage={3}
          availableRosterCharacters={[customVeteran, fighter, rogue]}
          onLaunch={vi.fn()}
        />,
      );

      // Clear slot 0
      fireEvent.click(screen.getByTestId('wizard-clear-slot-0'));

      // Open Vault modal from Slot 0
      fireEvent.click(screen.getByTestId('wizard-slot-0-vault-btn'));
      expect(screen.getByTestId('vault-selection-modal')).toBeDefined();
      expect(screen.getByText('Character Vault')).toBeDefined();

      // Search for Conan
      const searchInput = screen.getByTestId('vault-modal-search');
      fireEvent.change(searchInput, { target: { value: 'Conan' } });

      // Click Select Hero for Conan
      fireEvent.click(screen.getByTestId(`vault-modal-assign-${customVeteran.id}`));

      // Modal should be closed and Slot 0 should show Conan
      expect(screen.queryByTestId('vault-selection-modal')).toBeNull();
      expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain(
        'Conan the Cimmerian',
      );
    });

    it('closes Vault modal when Cancel or close button is clicked', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('wizard-clear-slot-2'));
      fireEvent.click(screen.getByTestId('wizard-slot-2-vault-btn'));
      expect(screen.getByTestId('vault-selection-modal')).toBeDefined();

      fireEvent.click(screen.getByTestId('vault-modal-close'));
      expect(screen.queryByTestId('vault-selection-modal')).toBeNull();
    });
  });

  describe('4. File Drop & .srd5.json File Import', () => {
    it('imports single character .srd5.json into targeted slot', async () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      // Clear slot 1
      fireEvent.click(screen.getByTestId('wizard-clear-slot-1'));

      const customHero: CharacterBuildState = {
        ...rogue,
        id: 'custom-file-rogue',
        name: 'Shadowstep Sylvia',
      };
      const jsonContent = serializeCharacterToSrd5Json(customHero);

      // Fire drop event on Slot 1
      const file = new File([jsonContent], 'sylvia.srd5.json', {
        type: 'application/json',
      });
      const slot1Element = screen.getByTestId('wizard-party-slot-1');

      fireEvent.drop(slot1Element, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain(
          'Shadowstep Sylvia',
        );
      });

      expect(screen.getByTestId('wizard-import-success').textContent).toContain(
        'Successfully imported "Shadowstep Sylvia" into Slot 2',
      );
    });

    it('displays error banner if imported file is invalid', async () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      const invalidFile = new File(['{ invalid json content '], 'bad.srd5.json', {
        type: 'application/json',
      });
      const slot0Element = screen.getByTestId('wizard-party-slot-0');

      fireEvent.drop(slot0Element, {
        dataTransfer: {
          files: [invalidFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('wizard-import-error')).toBeDefined();
      });
    });

    it('imports full party roster envelope into campfire slots', async () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      // Clear all slots first
      fireEvent.click(screen.getByTestId('wizard-clear-all-slots-btn'));

      const heroA: CharacterBuildState = { ...fighter, id: 'char-a', name: 'Alpha Warrior' };
      const heroB: CharacterBuildState = { ...rogue, id: 'char-b', name: 'Beta Scout' };

      const rosterJson = serializeRosterToSrd5Json({
        characters: [heroA, heroB],
        activePartyIds: ['char-a', 'char-b'],
      });

      const file = new File([rosterJson], 'roster.srd5.json', {
        type: 'application/json',
      });
      const slot0 = screen.getByTestId('wizard-party-slot-0');

      fireEvent.drop(slot0, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('wizard-party-slot-0').textContent).toContain('Alpha Warrior');
        expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain('Beta Scout');
      });

      expect(screen.getByTestId('wizard-import-success').textContent).toContain(
        'Successfully imported party roster of 2 heroes',
      );
    });
  });

  describe('5. Party Balance Synergy Badges & Soft Warnings', () => {
    it('displays synergy badges with checkmarks when roles are fulfilled', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      expect(screen.getByTestId('wizard-synergy-frontline').textContent).toContain('✓');
      expect(screen.getByTestId('wizard-synergy-scout').textContent).toContain('✓');
      expect(screen.getByTestId('wizard-synergy-divine').textContent).toContain('✓');
      expect(screen.getByTestId('wizard-synergy-arcane').textContent).toContain('✓');
    });

    it('displays undersized party warning and missing role warning when slots are cleared', () => {
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={vi.fn()}
        />,
      );

      // Clear Slot 3 (Divine Cleric) and Slot 2 (Arcane Wizard)
      fireEvent.click(screen.getByTestId('wizard-clear-slot-3'));
      fireEvent.click(screen.getByTestId('wizard-clear-slot-2'));

      // Check undersized warning (2/4 heroes)
      const undersizedWarn = screen.getByTestId('wizard-synergy-warning-undersized');
      expect(undersizedWarn.textContent).toContain('Undersized Party (2/4 heroes)');

      // Check missing divine healing warning
      const missingRoleWarn = screen.getByTestId('wizard-synergy-warning-roles');
      expect(missingRoleWarn.textContent).toContain('Missing Divine Healing');
    });
  });

  describe('6. Multiplayer Seat Assignment Hook', () => {
    it('configures seat type and player seat ID, passed in onLaunch slotAssignments', () => {
      let launchedConfig: CampaignLaunchConfig | null = null;
      render(
        <CampaignSetupWizard
          initialStage={3}
          onLaunch={(cfg) => {
            launchedConfig = cfg;
          }}
        />,
      );

      // Change Slot 1 to Remote Seat and Player 2 (Co-op)
      const seatTypeSelect = screen.getByTestId('wizard-slot-1-seat-type') as HTMLSelectElement;
      fireEvent.change(seatTypeSelect, { target: { value: 'network_remote' } });

      const seatIdInput = screen.getByTestId('wizard-slot-1-seat-id') as HTMLInputElement;
      fireEvent.change(seatIdInput, { target: { value: 'FriendSeat' } });

      // Navigate to Stage 4 and launch
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      fireEvent.click(screen.getByTestId('wizard-launch-cta'));

      expect(launchedConfig).not.toBeNull();
      expect(launchedConfig!.slotAssignments).toBeDefined();
      expect(launchedConfig!.slotAssignments!.length).toBe(4);
      expect(launchedConfig!.slotAssignments![1]?.seatType).toBe('network_remote');
      expect(launchedConfig!.slotAssignments![1]?.playerSeatId).toBe('FriendSeat');
      expect(launchedConfig!.slotAssignments![0]?.seatType).toBe('local');
    });
  });

  describe('7. "Roll New Hero" Builder Return Integration in App.tsx', () => {
    it('triggers onRollNewHero callback with slot index when Roll Hero button is clicked', () => {
      const onRollNewHero = vi.fn();
      render(
        <CampaignSetupWizard
          initialStage={3}
          onRollNewHero={onRollNewHero}
          onLaunch={vi.fn()}
        />,
      );

      // Clear slot 2
      fireEvent.click(screen.getByTestId('wizard-clear-slot-2'));

      // Click Roll Hero on slot 2
      fireEvent.click(screen.getByTestId('wizard-roll-hero-slot-2'));
      expect(onRollNewHero).toHaveBeenCalledWith(2);
    });

    it('navigates to Character Builder via App, displays return banner, and returns created hero to slot', async () => {
      const storage = createInMemoryRosterStorageAdapter();
      render(<App initialView="campaign_setup" storageAdapter={storage} />);

      // Advance to Stage 3 if not already there
      const step3Btn = screen.getByTestId('wizard-step-3');
      fireEvent.click(step3Btn);

      // Clear slot 1
      fireEvent.click(screen.getByTestId('wizard-clear-slot-1'));
      expect(screen.getByTestId('wizard-party-slot-1').textContent).toContain(
        '(Empty Hero Slot)',
      );

      // Click Roll Hero on Slot 1
      fireEvent.click(screen.getByTestId('wizard-roll-hero-slot-1'));

      // App should navigate to builder and show banner
      await waitFor(() => {
        expect(screen.getByTestId('builder-return-slot-banner')).toBeDefined();
      });
      expect(screen.getByTestId('builder-return-slot-banner').textContent).toContain(
        'Recruiting Hero for Campaign Party Slot 2',
      );

      // Clicking Cancel & Return to Setup returns cleanly to Stage 3
      fireEvent.click(screen.getByTestId('builder-cancel-return-btn'));
      await waitFor(() => {
        expect(screen.getByText('Campfire Party Assembly')).toBeDefined();
      });
    });
  });
});
