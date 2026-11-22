import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { InventoryGridCell } from '../components/inventory/InventoryGridCell.js';
import { INVENTORY_CELL_LONG_PRESS_MS } from '../components/inventory/inventoryCellTouch.js';

function heroesWithExtras() {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const wizard = getPregenCharacter('pregen-wizard')!;
  const armed = {
    ...fighter,
    inventory: [
      ...fighter.inventory,
      { instanceId: 'test-dagger', itemId: 'dagger', quantity: 1 },
      { instanceId: 'test-potion', itemId: 'potion-of-healing', quantity: 1 },
    ],
  };
  return [armed, wizard];
}

function baseViewProps(list = heroesWithExtras()) {
  return {
    heroes: list,
    activeHeroId: list[0]!.id,
    compendium: defaultCompendium,
    onSelectHero: vi.fn(),
    onClose: vi.fn(),
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onUseItem: vi.fn(),
    onTransferItem: vi.fn(),
    onDropItem: vi.fn(),
    onSplitStack: vi.fn(),
    onIdentifyItem: vi.fn(),
    onSellItem: vi.fn(),
  };
}

const touchAt = (x: number, y: number) => ({
  changedTouches: [{ clientX: x, clientY: y }],
  touches: [{ clientX: x, clientY: y }],
});

const touchEnd = () => ({
  changedTouches: [],
  touches: [],
});

describe('SRD-1504: touch parity (long-press menu, double-tap activate)', () => {
  describe('long-press (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      cleanup();
    });

    it('long-press on a backpack cell opens the same context menu as right-click', () => {
      const list = heroesWithExtras();
      const props = baseViewProps(list);
      render(<CharacterView {...props} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 50);
      });

      expect(screen.getByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeDefined();
    });

    it('the synthetic click after a long-press keeps the menu open (no toggle/dismiss)', () => {
      const list = heroesWithExtras();
      const props = baseViewProps(list);
      render(<CharacterView {...props} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 50);
      });
      expect(screen.getByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeDefined();

      // The OS delivers a click after touchend: it must not dismiss the menu
      // nor fire a select-driven action on its own (long-press already
      // selected the instance, mirroring right-click).
      fireEvent.click(cell);
      expect(props.onEquipItem).not.toHaveBeenCalled();
      expect(props.onUseItem).not.toHaveBeenCalled();
      expect(screen.getByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeDefined();

      // Menu actions still dispatch the shared handlers.
      fireEvent.click(screen.getByTestId(`${prefix}-ctx-equip-mainHand-test-dagger`));
      expect(props.onEquipItem).toHaveBeenCalledWith(list[0]!.id, 'mainHand', 'test-dagger');
    });

    it('dragging beyond the touch slop cancels the long-press', () => {
      const list = heroesWithExtras();
      render(<CharacterView {...baseViewProps(list)} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchMove(cell, touchAt(300, 400));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 500);
      });
      expect(screen.queryByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeNull();
    });

    it('a short tap never opens the menu; the tap click selects normally', () => {
      const list = heroesWithExtras();
      render(<CharacterView {...baseViewProps(list)} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchEnd(cell, touchEnd());
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 500);
      });
      expect(screen.queryByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeNull();

      fireEvent.click(cell);
      expect(screen.getByTestId(`${prefix}-actions-test-dagger`)).toBeDefined();
    });

    it('long-press on a party-strip cell opens the Send-to menu without selecting away', () => {
      const list = heroesWithExtras();
      render(<CharacterView {...{ ...baseViewProps(list), initialMode: 'party' }} />);
      const heroId = list[0]!.id;
      const cell = screen.getByTestId(`character-view-party-card-${heroId}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(120, 220));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 50);
      });

      expect(screen.getByTestId('character-view-party-ctx-menu-test-dagger')).toBeDefined();
      // Selecting via the menu path dispatches TRANSFER through engine state.
      fireEvent.click(
        screen.getByTestId(`character-view-party-ctx-send-${heroId}-to-${list[1]!.id}-test-dagger`),
      );
    });

    it('cell level: the click following a long-press is consumed, the next tap works', () => {
      const onSelect = vi.fn();
      const onMenu = vi.fn();
      render(
        <InventoryGridCell
          itemId="dagger"
          instanceId="cell-x"
          compendium={defaultCompendium}
          testIdPrefix="celltouch"
          onSelect={onSelect}
          onActivate={vi.fn()}
          onContextMenuInstance={onMenu}
        />,
      );
      const cell = screen.getByTestId('celltouch-cell-cell-x');
      fireEvent.touchStart(cell, touchAt(10, 10));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 50);
      });
      expect(onMenu).toHaveBeenCalledTimes(1);

      fireEvent.click(cell);
      expect(onSelect).not.toHaveBeenCalled();

      fireEvent.click(cell);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('display-only loot cells ignore long-press (tap-to-claim still works)', () => {
      const onSelect = vi.fn();
      render(
        <InventoryGridCell
          itemId="dagger"
          instanceId="loot-dagger"
          compendium={defaultCompendium}
          testIdPrefix="loot-touch"
          onSelect={onSelect}
        />,
      );
      const cell = screen.getByTestId('loot-touch-cell-loot-dagger');
      fireEvent.touchStart(cell, touchAt(50, 50));
      act(() => {
        vi.advanceTimersByTime(INVENTORY_CELL_LONG_PRESS_MS + 500);
      });
      fireEvent.touchEnd(cell, touchEnd());
      fireEvent.click(cell);
      expect(onSelect).toHaveBeenCalledWith('loot-dagger');
    });
  });

  describe('double-tap (real timers)', () => {
    afterEach(() => {
      cleanup();
    });

    it('double-tap equips an equippable cell (same as double-click)', () => {
      const list = heroesWithExtras();
      const props = baseViewProps(list);
      render(<CharacterView {...props} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchEnd(cell, touchEnd());
      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchEnd(cell, touchEnd());

      expect(props.onEquipItem).toHaveBeenCalledWith(list[0]!.id, 'mainHand', 'test-dagger');
    });

    it('double-tap uses a usable cell instead of equipping (same as double-click)', () => {
      const list = heroesWithExtras();
      const props = baseViewProps(list);
      render(<CharacterView {...props} />);
      const prefix = `character-view-${list[0]!.id}`;
      const cell = screen.getByTestId(`${prefix}-cell-test-potion`);

      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchEnd(cell, touchEnd());
      fireEvent.touchStart(cell, touchAt(100, 200));
      fireEvent.touchEnd(cell, touchEnd());

      expect(props.onUseItem).toHaveBeenCalledWith(list[0]!.id, 'test-potion');
      expect(props.onEquipItem).not.toHaveBeenCalled();
    });
  });
});
