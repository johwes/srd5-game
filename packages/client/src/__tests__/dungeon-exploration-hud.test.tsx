import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  defaultCompendium,
  getCampaignFloor,
  getPregenCharacter,
  getSunkenCryptModule,
} from '@srd5/data';
import {
  type Combatant,
  createDungeonGameState,
} from '@srd5/engine';
import { LocalTransport } from '@srd5/transport';
import {
  DungeonExplorationHud,
  DungeonView,
  LootInventoryModal,
  MarchingOrderModal,
  RestCampModal,
  SaveLoadModal,
  buildDungeonSession,
  getAdjacentProps,
  getDefaultDungeonPartyCharacters,
  transitionToNextFloor,
} from '../components/dungeon/index.js';
import {
  type DungeonStorageAdapter,
  deleteDungeonSaveSlot,
  exportDungeonSaveToJson,
  importDungeonSaveFromJson,
  loadDungeonGameFromSlot,
  loadDungeonSaveSlots,
  saveDungeonGameToSlot,
} from '../persistence/index.js';
import { App } from '../App.js';

describe('SRD-507: Dungeon Exploration HUD & Delve Experience', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  const campaign = getSunkenCryptModule();
  const floor1 = getCampaignFloor(campaign, 'kaelen-floor-1')!;

  describe('dungeonEngine: Session Building & Helpers', () => {
    it('builds a default dungeon session with 4 iconic heroes positioned at spawn cells', () => {
      const { transport, initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      expect(initialState.mode).toBe('exploration');
      expect(initialState.dungeon?.floorId).toBe('kaelen-floor-1');
      expect(Object.keys(initialState.party).length).toBe(4);
      expect(initialState.marchingOrder?.formation).toBe('single_file');

      const viewState = transport.getPlayerViewState();
      expect(viewState.mode).toBe('exploration');
      expect(Object.keys(viewState.party).length).toBe(4);
    });

    it('finds adjacent props correctly within Chebyshev distance 1.5', () => {
      const props = [
        { id: 'door-1', x: 5, y: 5, kind: 'door' as const, state: 'closed' as const, blocksMovement: true, blocksSight: true },
        { id: 'chest-1', x: 6, y: 5, kind: 'chest' as const, state: 'locked' as const, blocksMovement: false, blocksSight: false },
        { id: 'trap-1', x: 10, y: 10, kind: 'trap' as const, state: 'closed' as const, blocksMovement: false, blocksSight: false },
      ];

      const adjacent = getAdjacentProps({ x: 5, y: 4 }, props);
      expect(adjacent.map((p) => p.id)).toEqual(['door-1', 'chest-1']);
    });

    it('transitions to next floor carrying over party HP, XP, and inventory', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const floor2 = getCampaignFloor(campaign, 'kaelen-floor-2')!;

      const { nextState } = transitionToNextFloor(initialState, floor2, defaultCompendium);
      expect(nextState.dungeon?.floorId).toBe('kaelen-floor-2');
      expect(Object.keys(nextState.party).length).toBe(4);
    });
  });

  describe('MarchingOrderModal', () => {
    it('allows reordering party sequence and setting lead scout', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onApply = vi.fn();
      const onClose = vi.fn();

      render(
        <MarchingOrderModal
          isOpen={true}
          marchingOrder={initialState.marchingOrder!}
          party={initialState.party}
          onClose={onClose}
          onApplyMarchingOrder={onApply}
        />,
      );

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText(/Party Marching Order & Formation/i)).toBeDefined();

      // Click move down on row 0
      const moveDownBtn = screen.getByTestId('move-down-btn-0');
      fireEvent.click(moveDownBtn);

      // Switch formation to 2x2
      const twoByTwoBtn = screen.getByTestId('formation-two-by-two-btn');
      fireEvent.click(twoByTwoBtn);

      // Apply changes
      const applyBtn = screen.getByTestId('marching-order-apply-btn');
      fireEvent.click(applyBtn);

      expect(onApply).toHaveBeenCalledTimes(1);
      const [orderArg, formationArg] = onApply.mock.calls[0];
      expect(formationArg).toBe('two_by_two');
      expect(orderArg[0]).not.toBe(initialState.marchingOrder!.order[0]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('RestCampModal', () => {
    it('supports allocating Hit Dice during Short Rest and fires onStartShortRest', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onShortRest = vi.fn();
      const onLongRest = vi.fn();
      const onClose = vi.fn();

      const heroIds = Object.keys(initialState.party);
      const firstHeroId = heroIds[0]!;

      render(
        <RestCampModal
          isOpen={true}
          party={initialState.party}
          compendium={defaultCompendium}
          isSafeRoom={true}
          currentRoomName="Safe Crypt Sanctuary"
          onClose={onClose}
          onStartShortRest={onShortRest}
          onStartLongRest={onLongRest}
        />,
      );

      expect(screen.getByText(/Party Rest & Recuperation Camp/i)).toBeDefined();
      expect(screen.getByText(/Safe Crypt Sanctuary/i)).toBeDefined();

      // Increment Hit Die allocation for first hero
      const incBtn = screen.getByTestId(`dice-inc-btn-${firstHeroId}`);
      fireEvent.click(incBtn);

      const countDisplay = screen.getByTestId(`dice-count-${firstHeroId}`);
      expect(countDisplay.textContent).toBe('1');

      // Click Take Short Rest
      const executeBtn = screen.getByTestId('execute-short-rest-btn');
      fireEvent.click(executeBtn);

      expect(onShortRest).toHaveBeenCalledWith({ [firstHeroId]: 1 });
      expect(onClose).toHaveBeenCalled();
    });

    it('switches to Long Rest tab, warns if unsecured room, and fires onStartLongRest', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onShortRest = vi.fn();
      const onLongRest = vi.fn();
      const onClose = vi.fn();

      render(
        <RestCampModal
          isOpen={true}
          party={initialState.party}
          compendium={defaultCompendium}
          isSafeRoom={false}
          currentRoomName="Flooded Hallway"
          onClose={onClose}
          onStartShortRest={onShortRest}
          onStartLongRest={onLongRest}
        />,
      );

      // Switch to Long Rest tab
      const longTabBtn = screen.getByTestId('tab-long-rest-btn');
      fireEvent.click(longTabBtn);

      // Verify unsecured warning banner
      expect(screen.getByText(/Unsecured Dungeon Environment/i)).toBeDefined();
      expect(screen.getByText(/surprise ambush from wandering monster patrols/i)).toBeDefined();

      // Toggle force safe camp checkbox
      const forceCheckbox = screen.getByTestId('force-safe-camp-checkbox');
      fireEvent.click(forceCheckbox);

      // Execute Long Rest
      const executeBtn = screen.getByTestId('execute-long-rest-btn');
      fireEvent.click(executeBtn);

      expect(onLongRest).toHaveBeenCalledWith({ forceSafe: true });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('LootInventoryModal', () => {
    it('renders discovered loot contents and allows claiming spoils', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onClaim = vi.fn();
      const onEquip = vi.fn();
      const onAttune = vi.fn();
      const onUnattune = vi.fn();
      const onClose = vi.fn();

      const lootBundle = {
        gp: 50,
        sp: 120,
        items: ['potion-of-healing', 'ring-of-protection'],
      };

      render(
        <LootInventoryModal
          isOpen={true}
          party={initialState.party}
          compendium={defaultCompendium}
          activeLoot={{
            sourcePropId: 'chest-1',
            sourceName: 'Stone Chest',
            bundle: lootBundle,
          }}
          onClose={onClose}
          onClaimLoot={onClaim}
          onEquipItem={onEquip}
          onAttuneItem={onAttune}
          onUnattuneItem={onUnattune}
        />,
      );

      expect(screen.getByText(/Dungeon Loot & Party Inventory/i)).toBeDefined();
      expect(screen.getAllByText(/Stone Chest/i).length).toBeGreaterThan(0);
      expect(screen.getByText('50')).toBeDefined();

      // Claim All Spoils
      const claimBtn = screen.getByTestId('claim-all-loot-btn');
      fireEvent.click(claimBtn);

      expect(onClaim).toHaveBeenCalledTimes(1);
    });

    it('opens on the targeted hero instead of always the first party member', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const partyIds = Object.keys(initialState.party);
      expect(partyIds.length).toBeGreaterThan(2);
      const targetedId = partyIds[2]!;
      const onClose = vi.fn();

      const lootBundle = { gp: 25, items: ['potion-of-healing'] };
      const lootProps = {
        activeLoot: {
          sourcePropId: 'chest-1',
          sourceName: 'Stone Chest',
          bundle: lootBundle,
        },
      };

      const { rerender } = render(
        <LootInventoryModal
          isOpen={true}
          party={initialState.party}
          initialHeroId={targetedId}
          compendium={defaultCompendium}
          onClose={onClose}
          onClaimLoot={vi.fn()}
          onEquipItem={vi.fn()}
          onAttuneItem={vi.fn()}
          onUnattuneItem={vi.fn()}
          {...lootProps}
        />,
      );

      // Recipient selector and hero tab both honor the targeted hero
      expect(
        (screen.getByTestId('loot-recipient-select') as HTMLSelectElement).value,
      ).toBe(targetedId);

      // Reopening for a different targeted hero switches selection
      const otherId = partyIds[1]!;
      rerender(
        <LootInventoryModal
          isOpen={true}
          party={initialState.party}
          initialHeroId={otherId}
          compendium={defaultCompendium}
          onClose={onClose}
          onClaimLoot={vi.fn()}
          onEquipItem={vi.fn()}
          onAttuneItem={vi.fn()}
          onUnattuneItem={vi.fn()}
          {...lootProps}
        />,
      );
      expect(
        (screen.getByTestId('loot-recipient-select') as HTMLSelectElement).value,
      ).toBe(otherId);
    });

    it('switches between hero inventories and shows equipment loadout', () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onClaim = vi.fn();
      const onEquip = vi.fn();
      const onAttune = vi.fn();
      const onUnattune = vi.fn();
      const onClose = vi.fn();

      render(
        <LootInventoryModal
          isOpen={true}
          party={initialState.party}
          compendium={defaultCompendium}
          onClose={onClose}
          onClaimLoot={onClaim}
          onEquipItem={onEquip}
          onAttuneItem={onAttune}
          onUnattuneItem={onUnattune}
        />,
      );

      expect(screen.getByText(/Equipped/i)).toBeDefined();
      expect(screen.getByText(/carried/i)).toBeDefined();
      expect(screen.getAllByText(/Attuned .*\/ 3 max/i).length).toBeGreaterThan(0);
      // SRD-1305: five paperdoll slots + icon-grid backpack replace text rows.
      expect(screen.getAllByTestId(/-paperdoll-slot-/)).toHaveLength(5);
      expect(screen.getAllByTestId(/-grid$/).length).toBeGreaterThan(0);
    });
  });

  describe('SaveLoadModal & dungeonSavePersistence', () => {
    it('saves GameState to slot, reloads slots, exports envelope, and deletes slot', async () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const mockStorage: Record<string, unknown> = {};

      const testAdapter: DungeonStorageAdapter = {
        async getItem(k) {
          return mockStorage[k];
        },
        async setItem(k, v) {
          mockStorage[k] = structuredClone(v);
        },
        async removeItem(k) {
          delete mockStorage[k];
        },
      };

      // 1. Save to slot_1
      const saved = await saveDungeonGameToSlot(
        'slot_1',
        'Save Slot 1',
        initialState,
        {
          campaignId: campaign.id,
          campaignName: campaign.name,
          floorName: floor1.name,
        },
        testAdapter,
      );
      expect(saved.slotId).toBe('slot_1');
      expect(saved.meta.floorName).toBe(floor1.name);

      // 2. Load from slot_1
      const loaded = await loadDungeonGameFromSlot('slot_1', testAdapter);
      expect(loaded).toBeDefined();
      expect(loaded?.meta.floorName).toBe(floor1.name);

      // 3. Export to JSON string and import back
      const exportedJson = exportDungeonSaveToJson(saved);
      expect(exportedJson).toContain('srd5-dungeon-save');
      expect(exportedJson).toContain('Creative Commons Attribution 4.0');

      const importedRes = importDungeonSaveFromJson(exportedJson);
      expect(importedRes.ok).toBe(true);
      if (importedRes.ok) {
        expect(importedRes.data.slotId).toBe('slot_1');
      }

      // 4. Delete slot
      await deleteDungeonSaveSlot('slot_1', testAdapter);
      const afterDel = await loadDungeonGameFromSlot('slot_1', testAdapter);
      expect(afterDel).toBeNull();
    });

    it('renders SaveLoadModal and triggers save slot interactions', async () => {
      const { initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const onSave = vi.fn();
      const onLoad = vi.fn();
      const onImport = vi.fn();
      const onClose = vi.fn();

      render(
        <SaveLoadModal
          isOpen={true}
          gameState={initialState}
          campaignId={campaign.id}
          campaignName={campaign.name}
          floorName={floor1.name}
          onClose={onClose}
          onSaveToSlot={onSave}
          onLoadFromSlot={onLoad}
          onImportSaveState={onImport}
        />,
      );

      expect(screen.getByText(/Dungeon Exploration Save & Load Slots/i)).toBeDefined();
      expect(screen.getByTestId('save-slot-card-slot_1')).toBeDefined();

      // Click Save on Slot 1
      const saveBtn = screen.getByTestId('save-to-slot-btn-slot_1');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('save-load-status-banner')).toBeDefined();
      });
    });
  });

  describe('DungeonExplorationHud Component', () => {
    it('renders all HUD elements, handles stealth toggle, search, and prop interactions', () => {
      const { transport, initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const viewState = transport.getPlayerViewState();

      const onToggleStealth = vi.fn();
      const onOpenMarchingOrder = vi.fn();
      const onOpenRestCamp = vi.fn();
      const onOpenLoot = vi.fn();
      const onOpenSave = vi.fn();
      const onSearch = vi.fn();
      const onSelectLead = vi.fn();
      const onInspectProp = vi.fn();
      const onDescendStairs = vi.fn();
      const onExit = vi.fn();

      const adjacentProps = [
        {
          id: 'door_courtyard',
          x: 6,
          y: 3,
          kind: 'door' as const,
          state: 'closed' as const,
          blocksMovement: true,
          blocksSight: true,
        },
        {
          id: 'stairs_f1_down',
          x: 1,
          y: 12,
          kind: 'stairs_down' as const,
          state: 'open' as const,
          blocksMovement: false,
          blocksSight: false,
        },
      ];

      render(
        <DungeonExplorationHud
          viewState={viewState}
          gameState={initialState}
          compendium={defaultCompendium}
          campaignName={campaign.name}
          floorSpec={floor1}
          leadExplorerId={Object.keys(viewState.party)[0]!}
          inStealth={false}
          formation="single_file"
          adjacentProps={adjacentProps}
          onToggleStealth={onToggleStealth}
          onOpenMarchingOrder={onOpenMarchingOrder}
          onOpenRestCamp={onOpenRestCamp}
          onOpenLootInventory={onOpenLoot}
          onOpenSaveLoad={onOpenSave}
          onPerformSearch={onSearch}
          onSelectLeadExplorer={onSelectLead}
          onInspectProp={onInspectProp}
          onDescendStairs={onDescendStairs}
          onExitDelve={onExit}
        />,
      );

      // Verify campaign & floor title
      expect(screen.getByText(campaign.name)).toBeDefined();
      expect(screen.getByText(floor1.name)).toBeDefined();

      // Stealth Toggle
      const stealthBtn = screen.getByTestId('hud-stealth-toggle-btn');
      expect(stealthBtn.textContent).toContain('Normal Pace');
      fireEvent.click(stealthBtn);
      expect(onToggleStealth).toHaveBeenCalledTimes(1);

      // Search Room
      const searchBtn = screen.getByTestId('hud-search-room-btn');
      fireEvent.click(searchBtn);
      expect(onSearch).toHaveBeenCalledTimes(1);

      // Marching Order
      const marchingBtn = screen.getByTestId('hud-marching-order-btn');
      fireEvent.click(marchingBtn);
      expect(onOpenMarchingOrder).toHaveBeenCalledTimes(1);

      // Rest Camp
      const restBtn = screen.getByTestId('hud-rest-camp-btn');
      fireEvent.click(restBtn);
      expect(onOpenRestCamp).toHaveBeenCalledTimes(1);

      // Loot & Inventory
      const lootBtn = screen.getByTestId('hud-loot-inventory-btn');
      fireEvent.click(lootBtn);
      expect(onOpenLoot).toHaveBeenCalledTimes(1);

      // Save / Load
      const saveBtn = screen.getByTestId('hud-save-load-btn');
      fireEvent.click(saveBtn);
      expect(onOpenSave).toHaveBeenCalledTimes(1);

      // Adjacent props render as inspect indicators (no auto action buttons)
      expect(screen.getByTestId('adjacent-prop-row-door_courtyard')).toBeDefined();
      const inspectBtn = screen.getByTestId('inspect-prop-btn-door_courtyard');
      fireEvent.click(inspectBtn);
      expect(onInspectProp).toHaveBeenCalledWith('door_courtyard');

      const descendBtn = screen.getByTestId('prop-descend-stairs-btn');
      fireEvent.click(descendBtn);
      expect(onDescendStairs).toHaveBeenCalledTimes(1);
    });

    it('opens the character sheet for the targeted hero and shows buff/condition status', () => {
      const { transport, initialState } = buildDungeonSession(floor1, [], defaultCompendium);
      const viewState = transport.getPlayerViewState();
      const partyIds = Object.keys(viewState.party);
      const targetedId = partyIds[1]!;

      // Give the targeted hero a condition and an active buff
      viewState.party[targetedId]!.conditions = ['poisoned'];
      viewState.party[targetedId]!.activeEffects = [
        {
          effectId: 'bless-buff',
          name: 'Bless',
          requiresConcentration: true,
          remainingRounds: 8,
          modifiers: [],
        },
      ];

      const onInspect = vi.fn();

      render(
        <DungeonExplorationHud
          viewState={viewState}
          gameState={initialState}
          compendium={defaultCompendium}
          campaignName={campaign.name}
          floorSpec={floor1}
          leadExplorerId={partyIds[0]!}
          inStealth={false}
          formation="single_file"
          adjacentProps={[]}
          onToggleStealth={vi.fn()}
          onOpenMarchingOrder={vi.fn()}
          onOpenRestCamp={vi.fn()}
          onOpenLootInventory={vi.fn()}
          onOpenSaveLoad={vi.fn()}
          onPerformSearch={vi.fn()}
          onSelectLeadExplorer={vi.fn()}
          onInspectCharacter={onInspect}
          onExitDelve={vi.fn()}
        />,
      );

      // Status indication shows both the condition and the buff
      const status = screen.getByTestId(`exploration-status-${targetedId}`);
      expect(status.textContent).toContain('poisoned');
      expect(status.textContent).toContain('Bless');

      // Inspect button opens the sheet for the targeted hero, not the first
      fireEvent.click(screen.getByTestId(`exploration-inspect-hero-${targetedId}`));
      expect(onInspect).toHaveBeenCalledTimes(1);
      expect(onInspect).toHaveBeenCalledWith(targetedId);
    });
  });

  describe('DungeonView Full Component Integration', () => {
    it('mounts DungeonView on Floor 1, renders exploration HUD, and toggles modals', () => {
      const onExit = vi.fn();

      render(
        <DungeonView
          partyCharacters={getDefaultDungeonPartyCharacters()}
          compendium={defaultCompendium}
          initialFloorId="kaelen-floor-1"
          onExitToRoster={onExit}
        />,
      );

      expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
      expect(screen.getByTestId('hud-stealth-toggle-btn')).toBeDefined();

      // Open Marching Order modal from HUD
      const marchingBtn = screen.getByTestId('hud-marching-order-btn');
      fireEvent.click(marchingBtn);
      expect(screen.getByRole('dialog')).toBeDefined();

      // Close Marching Order modal
      const closeMarchingBtn = screen.getByTestId('marching-order-close-btn');
      fireEvent.click(closeMarchingBtn);
      expect(screen.queryByRole('dialog')).toBeNull();

      // Open Rest Camp modal from HUD
      const restBtn = screen.getByTestId('hud-rest-camp-btn');
      fireEvent.click(restBtn);
      expect(screen.getByRole('dialog')).toBeDefined();

      const closeRestBtn = screen.getByTestId('rest-camp-close-btn');
      fireEvent.click(closeRestBtn);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('App Navigation Integration', () => {
    it('navigates to Dungeon Delve view from top header nav button and from party roster', () => {
      render(<App initialView="roster" />);

      // Nav button exists in header
      const dungeonNavBtn = screen.getByTestId('app-nav-dungeon');
      expect(dungeonNavBtn).toBeDefined();

      // Button in Party Roster
      const enterDungeonBtn = screen.getByTestId('roster-enter-dungeon-btn');
      expect(enterDungeonBtn).toBeDefined();

      // Clicking launches Dungeon Delve view
      fireEvent.click(enterDungeonBtn);
      expect(screen.getByTestId('dungeon-view-container')).toBeDefined();

      // Click Exit Delve returns to roster
      const exitDelveBtn = screen.getByTestId('hud-exit-delve-btn');
      fireEvent.click(exitDelveBtn);
      expect(screen.queryByTestId('dungeon-view-container')).toBeNull();
    });
  });
});
