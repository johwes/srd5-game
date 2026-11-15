import React from 'react';
import {
  SRD_LEGAL_ATTRIBUTION,
  getPregenCharacter,
} from '@srd5/data';
import { type GameState } from '@srd5/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import {
  TitleMenuView,
  TitleMenuCreditsModal,
  TitleMenuSettingsModal,
  TitleMenuLoadModal,
} from '../components/title/index.js';
import {
  type DungeonStorageAdapter,
  type DungeonSaveSlotData,
  DEFAULT_APP_SETTINGS,
  saveAppSettings,
} from '../persistence/index.js';

afterEach(() => {
  cleanup();
});

function createMockDungeonStorage(
  initialSaves: Record<string, DungeonSaveSlotData> = {},
): DungeonStorageAdapter {
  const store: Record<string, unknown> = {
    'srd5:dungeon-saves:v1': initialSaves,
  };
  return {
    getItem: vi.fn(async (key: string) => store[key]),
    setItem: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };
}

function createSampleSaveSlot(slotId = 'slot_1'): DungeonSaveSlotData {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const rogue = getPregenCharacter('pregen-rogue')!;

  const mockGameState = {
    mode: 'exploration',
    party: {
      [fighter.id]: {
        id: fighter.id,
        name: fighter.name,
        currentHp: 12,
        maxHp: 12,
        characterSheet: fighter,
      },
      [rogue.id]: {
        id: rogue.id,
        name: rogue.name,
        currentHp: 9,
        maxHp: 9,
        characterSheet: rogue,
      },
    },
    dungeon: {
      floorId: 'kaelen-floor-1',
      rooms: {
        'room-entry': {
          id: 'room-entry',
          name: 'The Weeping Antechamber',
        },
      },
    },
  } as unknown as GameState;

  return {
    version: 1,
    slotId,
    slotName: 'Save Slot 1',
    savedAt: new Date('2026-11-15T10:00:00Z').toISOString(),
    campaignId: 'sunken-crypt-kaelen',
    campaignName: 'The Sunken Crypt of Kaelen',
    floorId: 'kaelen-floor-1',
    gameState: mockGameState,
    meta: {
      slotId,
      slotName: 'Save Slot 1',
      savedAt: new Date('2026-11-15T10:00:00Z').toISOString(),
      campaignId: 'sunken-crypt-kaelen',
      campaignName: 'The Sunken Crypt of Kaelen',
      floorId: 'kaelen-floor-1',
      floorName: 'Crypt Upper Level',
      currentRoomName: 'The Weeping Antechamber',
      mode: 'exploration',
      partySummary: [
        {
          id: fighter.id,
          name: fighter.name,
          className: 'Fighter 1',
          level: 1,
          currentHp: 12,
          maxHp: 12,
        },
        {
          id: rogue.id,
          name: rogue.name,
          className: 'Rogue 1',
          level: 1,
          currentHp: 9,
          maxHp: 9,
        },
      ],
    },
  };
}

describe('SRD-601: Title Screen & Main Menu (TitleMenuView)', () => {
  describe('1. Default App Launch & Dark Fantasy Presentation', () => {
    it('defaults to TitleMenuView on launch with CRPG branding and statutory attribution', async () => {
      render(<App />);

      expect(screen.getByTestId('title-menu-view')).toBeDefined();
      expect(screen.getByText('DUNGEONS OF KAELEN')).toBeDefined();
      expect(screen.getByText(/SRD 5.1 Tactical Dungeon Crawler/i)).toBeDefined();
      expect(screen.getByText(SRD_LEGAL_ATTRIBUTION)).toBeDefined();

      // Core action buttons are present
      expect(screen.getByTestId('title-menu-continue-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-new-game-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-load-game-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-vault-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-builder-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-compendium-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-settings-btn')).toBeDefined();
      expect(screen.getByTestId('title-menu-credits-btn')).toBeDefined();
    });

    it('disables Continue button when no saved game exists', async () => {
      const mockStorage = createMockDungeonStorage({});
      render(<TitleMenuView storageAdapter={mockStorage} />);

      await waitFor(() => {
        const continueBtn = screen.getByTestId('title-menu-continue-btn') as HTMLButtonElement;
        expect(continueBtn.disabled).toBe(true);
        expect(continueBtn.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText(/\(No Saved Game Found\)/i)).toBeDefined();
      });
    });

    it('enables Continue button with floor and party metadata when active save exists', async () => {
      const sampleSave = createSampleSaveSlot('slot_1');
      const mockStorage = createMockDungeonStorage({ slot_1: sampleSave });
      const onContinue = vi.fn();

      render(<TitleMenuView storageAdapter={mockStorage} onContinue={onContinue} />);

      await waitFor(() => {
        const continueBtn = screen.getByTestId('title-menu-continue-btn') as HTMLButtonElement;
        expect(continueBtn.disabled).toBe(false);
      });

      expect(screen.getByText(/The Sunken Crypt of Kaelen — Crypt Upper Level · 2 Heroes/i)).toBeDefined();

      fireEvent.click(screen.getByTestId('title-menu-continue-btn'));
      expect(onContinue).toHaveBeenCalledWith(sampleSave);
    });
  });

  describe('2. Navigation to App Views', () => {
    it('navigates to Character Vault (Party Roster) and back to Title Menu', () => {
      render(<App />);

      fireEvent.click(screen.getByTestId('title-menu-vault-btn'));
      expect(screen.getByTestId('party-roster-view')).toBeDefined();

      fireEvent.click(screen.getByTestId('app-nav-title'));
      expect(screen.getByTestId('title-menu-view')).toBeDefined();
    });

    it('navigates to 7-Step Character Builder and back to Title Menu', () => {
      render(<App />);

      fireEvent.click(screen.getByTestId('title-menu-builder-btn'));
      expect(screen.getByTestId('character-builder-wizard')).toBeDefined();

      fireEvent.click(screen.getByTestId('app-nav-title'));
      expect(screen.getByTestId('title-menu-view')).toBeDefined();
    });

    it('navigates to SRD 5.1 Compendium and back to Title Menu', () => {
      render(<App />);

      fireEvent.click(screen.getByTestId('title-menu-compendium-btn'));
      expect(screen.getByTestId('compendium-browser')).toBeDefined();

      fireEvent.click(screen.getByTestId('app-nav-title'));
      expect(screen.getByTestId('title-menu-view')).toBeDefined();
    });

    it('navigates to New Game / Campaign Setup Wizard from Title Menu and embarks into Dungeon', () => {
      render(<App />);

      fireEvent.click(screen.getByTestId('title-menu-new-game-btn'));
      expect(screen.getByTestId('campaign-setup-wizard')).toBeDefined();

      // Step through wizard to stage 4 and embark
      fireEvent.click(screen.getByTestId('wizard-step-4'));
      fireEvent.click(screen.getByTestId('wizard-launch-cta'));
      expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
    });
  });

  describe('3. Settings & Options Modal', () => {
    it('opens and adjusts audio, animations, UI scaling, and grid options', () => {
      const onSaveSettings = vi.fn();
      const onResetSettings = vi.fn();

      render(
        <TitleMenuSettingsModal
          isOpen={true}
          settings={DEFAULT_APP_SETTINGS}
          onClose={vi.fn()}
          onSaveSettings={onSaveSettings}
          onResetSettings={onResetSettings}
        />,
      );

      expect(screen.getByTestId('title-menu-settings-modal')).toBeDefined();

      // Master volume
      const masterVol = screen.getByTestId('title-menu-settings-master-vol') as HTMLInputElement;
      fireEvent.change(masterVol, { target: { value: '95' } });
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ masterVolume: 95 }),
      );

      // Animation speed
      const animSpeed = screen.getByTestId('title-menu-settings-anim-speed') as HTMLSelectElement;
      fireEvent.change(animSpeed, { target: { value: 'fast' } });
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ animationSpeed: 'fast' }),
      );

      // UI scale
      const uiScale = screen.getByTestId('title-menu-settings-ui-scale') as HTMLSelectElement;
      fireEvent.change(uiScale, { target: { value: '110%' } });
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: '110%' }),
      );

      // Dice tray toggle
      const diceToggle = screen.getByTestId('title-menu-settings-dice-toggle') as HTMLInputElement;
      fireEvent.click(diceToggle);
      expect(onSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ diceTray3d: false }),
      );

      // Reset to defaults
      fireEvent.click(screen.getByTestId('title-menu-settings-reset-btn'));
      expect(onResetSettings).toHaveBeenCalled();
    });

    it('closes Settings modal on Escape key or Done button', () => {
      const onClose = vi.fn();
      render(
        <TitleMenuSettingsModal
          isOpen={true}
          settings={DEFAULT_APP_SETTINGS}
          onClose={onClose}
          onSaveSettings={vi.fn()}
          onResetSettings={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Done/i }));
      expect(onClose).toHaveBeenCalled();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('4. Credits & Statutory CC-BY-4.0 Modal', () => {
    it('displays statutory SRD 5.1 notice, CC0 Kenney assets, and game-icons attribution', () => {
      const onClose = vi.fn();
      render(<TitleMenuCreditsModal isOpen={true} onClose={onClose} />);

      expect(screen.getByTestId('title-menu-credits-modal')).toBeDefined();
      expect(screen.getByText(SRD_LEGAL_ATTRIBUTION)).toBeDefined();
      expect(screen.getByText(/Kenney Tiny Dungeon/i)).toBeDefined();
      expect(screen.getByText(/Game-Icons\.net/i)).toBeDefined();
      expect(screen.getByText(/DawnLike 16x16 Tileset/i)).toBeDefined();

      fireEvent.click(screen.getByTestId('title-menu-credits-close-btn'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('5. Load Game Modal & Slot Management', () => {
    it('displays saved slots with party details, and loads selected slot', async () => {
      const sampleSave = createSampleSaveSlot('slot_1');
      const mockStorage = createMockDungeonStorage({ slot_1: sampleSave });
      const onSelectSlot = vi.fn();
      const onClose = vi.fn();

      render(
        <TitleMenuLoadModal
          isOpen={true}
          storageAdapter={mockStorage}
          onClose={onClose}
          onSelectSlot={onSelectSlot}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('title-menu-load-modal')).toBeDefined();
        expect(screen.getByTestId('load-slot-slot_1-btn')).toBeDefined();
      });

      expect(screen.getByText('Garrick Vance')).toBeDefined();
      expect(screen.getByText(/12\/12 HP/i)).toBeDefined();

      fireEvent.click(screen.getByTestId('load-slot-slot_1-btn'));
      expect(onSelectSlot).toHaveBeenCalledWith(sampleSave);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
