import React from 'react';
import { getPregenCharacter } from '@srd5/data';
import { type GameState } from '@srd5/engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PauseMenuModal } from '../components/system/index.js';
import { DungeonView } from '../components/dungeon/index.js';
import {
  type DungeonStorageAdapter,
  type DungeonSaveSlotData,
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

function createSampleGameState(): GameState {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const rogue = getPregenCharacter('pregen-rogue')!;

  return {
    version: 1,
    mode: 'exploration',
    round: 1,
    turnBudget: { actionRemaining: true, bonusActionRemaining: true, movementRemainingFeet: 30, reactionRemaining: true },
    rngState: 42,
    grid: { width: 10, height: 10, cells: [] },
    dungeon: {
      floorId: 'kaelen-floor-1',
      rooms: {
        'room-1': { id: 'room-1', name: 'Crypt Antechamber', isSafeRoom: false, bounds: { x: 0, y: 0, width: 5, height: 5 } },
      },
      doors: {},
      chests: {},
      traps: {},
      stairsDown: { x: 9, y: 9 },
      stairsUp: { x: 0, y: 0 },
    },
    party: {
      'hero-1': {
        id: 'hero-1',
        name: 'Valeros',
        side: 'party',
        currentHp: 12,
        maxHp: 12,
        tempHp: 0,
        position: { x: 2, y: 2 },
        size: { width: 1, height: 1 },
        reachFeet: 5,
        ac: 18,
        conditions: [],
        characterSheet: {
          totalLevel: 1,
          classes: [{ classId: 'fighter', level: 1 }],
          armorClass: { totalAc: 18 },
        } as any,
      } as any,
      'hero-2': {
        id: 'hero-2',
        name: 'Merisiel',
        side: 'party',
        currentHp: 7,
        maxHp: 9,
        tempHp: 0,
        position: { x: 2, y: 3 },
        size: { width: 1, height: 1 },
        reachFeet: 5,
        ac: 15,
        conditions: ['poisoned'],
        characterSheet: {
          totalLevel: 1,
          classes: [{ classId: 'rogue', level: 1 }],
          armorClass: { totalAc: 15 },
        } as any,
      } as any,
    },
    monsters: {},
    props: [],
    hazards: [],
    activeCombatantId: null,
    initiativeOrder: [],
  } as unknown as GameState;
}

describe('SRD-604: Universal In-Game Pause / System Menu (PauseMenuModal)', () => {
  it('1. Renders PauseMenuModal with title, location, and primary action buttons when open', () => {
    const handleClose = vi.fn();
    const handleExit = vi.fn();
    const mockState = createSampleGameState();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose}
        gameState={mockState}
        campaignName="The Sunken Crypt of Kaelen"
        floorName="Floor 1: Hall of Whispers"
        onExitToTitle={handleExit}
      />,
    );

    expect(screen.getByTestId('pause-menu-modal')).toBeDefined();
    expect(screen.getByText('System Menu & Pause')).toBeDefined();
    expect(screen.getByText(/The Sunken Crypt of Kaelen · Floor 1: Hall of Whispers/i)).toBeDefined();

    expect(screen.getByTestId('pause-menu-resume-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-quicksave-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-save-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-load-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-party-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-settings-btn')).toBeDefined();
    expect(screen.getByTestId('pause-menu-exit-btn')).toBeDefined();
  });

  it('2. Resumes game when clicking Resume button, Close button, or pressing Escape key on main view', () => {
    const handleClose = vi.fn();
    const mockState = createSampleGameState();

    const { rerender } = render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose}
        gameState={mockState}
        onExitToTitle={vi.fn()}
      />,
    );

    // Clicking Resume
    fireEvent.click(screen.getByTestId('pause-menu-resume-btn'));
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Clicking Close (✕)
    fireEvent.click(screen.getByTestId('pause-menu-close-btn'));
    expect(handleClose).toHaveBeenCalledTimes(2);

    // Pressing Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(3);

    // Does not render when isOpen is false
    rerender(
      <PauseMenuModal
        isOpen={false}
        onClose={handleClose}
        gameState={mockState}
        onExitToTitle={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('pause-menu-modal')).toBeNull();
  });

  it('3. Quicksaves game to storage with status feedback notification', async () => {
    const mockStorage = createMockDungeonStorage();
    const mockState = createSampleGameState();
    const handleQuickSave = vi.fn();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={vi.fn()}
        gameState={mockState}
        storageAdapter={mockStorage}
        onQuickSave={handleQuickSave}
        onExitToTitle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('pause-menu-quicksave-btn'));

    await waitFor(() => {
      expect(handleQuickSave).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('pause-menu-status-msg').textContent).toMatch(/Game quicksaved successfully/i);
    });
  });

  it('4. Navigates to Save Game view, displays slots, and saves to chosen slot', async () => {
    const mockStorage = createMockDungeonStorage();
    const mockState = createSampleGameState();
    const handleSaveToSlot = vi.fn();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={vi.fn()}
        gameState={mockState}
        storageAdapter={mockStorage}
        onSaveToSlot={handleSaveToSlot}
        onExitToTitle={vi.fn()}
      />,
    );

    // Click Save Game...
    fireEvent.click(screen.getByTestId('pause-menu-save-btn'));
    expect(screen.getByTestId('pause-save-view')).toBeDefined();

    // Click Save on Slot 1
    fireEvent.click(screen.getByTestId('pause-save-slot-slot_1'));

    await waitFor(() => {
      expect(handleSaveToSlot).toHaveBeenCalledWith('slot_1', 'Save Slot 1');
      expect(screen.getByTestId('pause-menu-status-msg').textContent).toMatch(/Game saved to Save Slot 1/i);
    });

    // Press Escape returns to main pause menu
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('pause-menu-main-view')).toBeDefined();
  });

  it('5. Navigates to Load Game view, lists saved slots, and triggers onLoadFromSlot', async () => {
    const mockSlot: DungeonSaveSlotData = {
      version: 1,
      slotId: 'slot_2',
      slotName: 'Deep Crypt Safehouse',
      savedAt: '2026-11-15T12:00:00Z',
      campaignId: 'campaign_kaelen',
      campaignName: 'The Sunken Crypt of Kaelen',
      floorId: 'kaelen-floor-2',
      gameState: createSampleGameState(),
      meta: {
        slotId: 'slot_2',
        slotName: 'Deep Crypt Safehouse',
        savedAt: '2026-11-15T12:00:00Z',
        campaignId: 'campaign_kaelen',
        campaignName: 'The Sunken Crypt of Kaelen',
        floorId: 'kaelen-floor-2',
        floorName: 'Floor 2: Flooded Sepulcher',
        mode: 'exploration',
        partySummary: [
          { id: 'hero-1', name: 'Valeros', className: 'fighter 1', level: 1, currentHp: 12, maxHp: 12 },
        ],
      },
    };

    const mockStorage = createMockDungeonStorage({ slot_2: mockSlot });
    const handleLoadFromSlot = vi.fn();
    const handleClose = vi.fn();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose}
        gameState={createSampleGameState()}
        storageAdapter={mockStorage}
        onLoadFromSlot={handleLoadFromSlot}
        onExitToTitle={vi.fn()}
      />,
    );

    // Enter Load Game view
    fireEvent.click(screen.getByTestId('pause-menu-load-btn'));
    expect(screen.getByTestId('pause-load-view')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByTestId('pause-load-slot-slot_2')).toBeDefined();
    });

    // Click Load
    fireEvent.click(screen.getByTestId('pause-load-slot-slot_2'));

    await waitFor(() => {
      expect(handleLoadFromSlot).toHaveBeenCalledWith('slot_2');
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  it('6. Inspects party members and conditions in Party Sheet view', () => {
    const mockState = createSampleGameState();
    const handleOpenSheet = vi.fn();
    const handleOpenInventory = vi.fn();
    const handleClose = vi.fn();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose}
        gameState={mockState}
        onOpenCharacterSheet={handleOpenSheet}
        onOpenInventory={handleOpenInventory}
        onExitToTitle={vi.fn()}
      />,
    );

    // Open Party View
    fireEvent.click(screen.getByTestId('pause-menu-party-btn'));
    expect(screen.getByTestId('pause-party-view')).toBeDefined();

    // Verify heroes
    expect(screen.getByTestId('pause-hero-card-hero-1').textContent).toContain('Valeros');
    expect(screen.getByTestId('pause-hero-card-hero-1').textContent).toContain('12 / 12 HP');
    expect(screen.getByTestId('pause-hero-card-hero-1').textContent).toContain('AC 18');

    expect(screen.getByTestId('pause-hero-card-hero-2').textContent).toContain('Merisiel');
    expect(screen.getByTestId('pause-hero-card-hero-2').textContent).toContain('7 / 9 HP');
    expect(screen.getByTestId('pause-hero-card-hero-2').textContent).toContain('poisoned');

    // Inspect hero 1
    fireEvent.click(screen.getByTestId('pause-inspect-hero-hero-1'));
    expect(handleOpenSheet).toHaveBeenCalledWith('hero-1');
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Reopen and check inventory trigger
    cleanup();
    const handleClose2 = vi.fn();
    render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose2}
        gameState={mockState}
        onOpenCharacterSheet={handleOpenSheet}
        onOpenInventory={handleOpenInventory}
        onExitToTitle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('pause-menu-party-btn'));
    fireEvent.click(screen.getByTestId('pause-open-inventory-btn'));
    expect(handleOpenInventory).toHaveBeenCalledTimes(1);
    expect(handleClose2).toHaveBeenCalledTimes(1);
  });

  it('7. Adjusts settings and resets to default in Settings & Options view', () => {
    render(
      <PauseMenuModal
        isOpen={true}
        onClose={vi.fn()}
        gameState={createSampleGameState()}
        onExitToTitle={vi.fn()}
      />,
    );

    // Navigate to Settings
    fireEvent.click(screen.getByTestId('pause-menu-settings-btn'));
    expect(screen.getByTestId('pause-settings-view')).toBeDefined();

    // Change master volume
    const masterSlider = screen.getByTestId('pause-settings-master-vol') as HTMLInputElement;
    fireEvent.change(masterSlider, { target: { value: '95' } });
    expect(screen.getByText('95%')).toBeDefined();

    // Change animation speed to instant
    const instantBtn = screen.getByTestId('pause-settings-speed-instant');
    fireEvent.click(instantBtn);
    expect(instantBtn.className).toContain('bg-amber-500');

    // Toggle Fast AI
    const fastAiCheckbox = screen.getByTestId('pause-settings-fast-ai') as HTMLInputElement;
    fireEvent.click(fastAiCheckbox);
    expect(fastAiCheckbox.checked).toBe(true);

    // Click reset to defaults
    fireEvent.click(screen.getByTestId('pause-settings-reset-btn'));
    expect(screen.getByTestId('pause-menu-status-msg').textContent).toMatch(/Settings reset to defaults/i);
  });

  it('8. Prompts confirmation when choosing Exit to Title Menu and safely exits on confirmation', () => {
    const handleExit = vi.fn();
    const handleClose = vi.fn();

    render(
      <PauseMenuModal
        isOpen={true}
        onClose={handleClose}
        gameState={createSampleGameState()}
        onExitToTitle={handleExit}
      />,
    );

    // Click Exit to Title Menu
    fireEvent.click(screen.getByTestId('pause-menu-exit-btn'));
    expect(screen.getByTestId('pause-exit-confirm-dialog')).toBeDefined();
    expect(
      screen.getByText(/Any unsaved progress since your last rest or quicksave will be lost/i),
    ).toBeDefined();

    // Click Cancel returns to main menu without exiting
    fireEvent.click(screen.getByTestId('pause-exit-cancel-btn'));
    expect(handleExit).not.toHaveBeenCalled();
    expect(screen.getByTestId('pause-menu-main-view')).toBeDefined();

    // Re-enter confirmation and confirm exit
    fireEvent.click(screen.getByTestId('pause-menu-exit-btn'));
    fireEvent.click(screen.getByTestId('pause-exit-confirm-btn'));

    expect(handleExit).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('9. Integrates seamlessly in DungeonView: Esc key and Menu button open PauseMenuModal', async () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const rogue = getPregenCharacter('pregen-rogue')!;
    const mockStorage = createMockDungeonStorage();
    const handleExitToRoster = vi.fn();

    render(
      <DungeonView
        partyCharacters={[fighter, rogue]}
        storageAdapter={mockStorage}
        onExitToRoster={handleExitToRoster}
      />,
    );

    // Exploration HUD menu button is present
    const menuBtn = screen.getByTestId('hud-pause-menu-btn');
    expect(menuBtn).toBeDefined();

    // Clicking Menu button opens PauseMenuModal
    fireEvent.click(menuBtn);
    expect(screen.getByTestId('pause-menu-modal')).toBeDefined();

    // Pressing Esc on main pause view resumes game
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('pause-menu-modal')).toBeNull();
    });

    // Pressing Esc in gameplay opens PauseMenuModal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('pause-menu-modal')).toBeDefined();

    // From PauseMenuModal, clicking Exit -> Confirm Exit triggers onExitToRoster
    fireEvent.click(screen.getByTestId('pause-menu-exit-btn'));
    fireEvent.click(screen.getByTestId('pause-exit-confirm-btn'));
    expect(handleExitToRoster).toHaveBeenCalledTimes(1);
  });
});
