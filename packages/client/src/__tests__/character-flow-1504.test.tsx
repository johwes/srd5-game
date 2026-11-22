import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { sortInventoryInstances } from '../components/inventory/inventorySort.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function heroesWithExtras() {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const wizard = getPregenCharacter('pregen-wizard')!;
  // Controlled extras: an equippable melee weapon + a usable non-equippable potion.
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

function orderedGridCellIds(gridTestId: string, cellPrefix: string): string[] {
  const grid = screen.getByTestId(gridTestId);
  return Array.from(grid.querySelectorAll(':scope > button'))
    .map((el) => el.getAttribute('data-testid')!)
    .filter((id) => id.startsWith(`${cellPrefix}-cell-`))
    .map((id) => id.replace(`${cellPrefix}-cell-`, ''));
}

function baseViewProps(list = heroesWithExtras()) {
  return {
    heroes: list,
    activeHeroId: list[0]!.id,
    compendium,
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

describe('SRD-1504: Flow parity (double-click, context menu, sort)', () => {
  it('backpack sort control is a native select with all five keys and reorders the grid', () => {
    const list = heroesWithExtras();
    render(<CharacterView {...baseViewProps(list)} />);
    const prefix = `character-view-${list[0]!.id}`;
    const sort = screen.getByTestId(`${prefix}-sort`);
    expect(sort.tagName).toBe('SELECT');
    const options = within(sort as HTMLSelectElement)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['newest', 'name', 'type', 'value', 'weight']);

    // Name sort: DOM cell order matches the pure sort helper exactly.
    fireEvent.change(sort, { target: { value: 'name' } });
    const expected = sortInventoryInstances(list[0]!.inventory, 'name', compendium).map(
      (i) => i.instanceId,
    );
    expect(orderedGridCellIds(`${prefix}-grid`, prefix)).toEqual(expected);

    // Value sort puts the most expensive item first (chain mail > dagger).
    fireEvent.change(sort, { target: { value: 'value' } });
    expect(orderedGridCellIds(`${prefix}-grid`, prefix)[0]).toBe('fighter-chain-mail');

    // Newest restores acquisition order.
    fireEvent.change(sort, { target: { value: 'newest' } });
    expect(orderedGridCellIds(`${prefix}-grid`, prefix)).toEqual(
      list[0]!.inventory.map((i) => i.instanceId),
    );
  });

  it('double-click equips an equippable cell into its suggested slot', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${list[0]!.id}`;
    fireEvent.doubleClick(screen.getByTestId(`${prefix}-cell-test-dagger`));
    expect(props.onEquipItem).toHaveBeenCalledWith(list[0]!.id, 'mainHand', 'test-dagger');
  });

  it('double-click uses a usable non-equippable cell instead of equipping', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${list[0]!.id}`;
    fireEvent.doubleClick(screen.getByTestId(`${prefix}-cell-test-potion`));
    expect(props.onUseItem).toHaveBeenCalledWith(list[0]!.id, 'test-potion');
    expect(props.onEquipItem).not.toHaveBeenCalled();
  });

  it('right-click opens a context menu whose items dispatch the same handlers; backdrop dismisses', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${list[0]!.id}`;

    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-dagger`));
    const menu = screen.getByTestId(`${prefix}-ctx-menu-test-dagger`);
    expect(menu.getAttribute('role')).toBe('menu');
    // Every menu action is a focusable menuitem button (Deck keyboard parity via action bar + tab).
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item.tagName).toBe('BUTTON');
    }
    // Equip via the menu.
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-equip-mainHand-test-dagger`));
    expect(props.onEquipItem).toHaveBeenCalledWith(list[0]!.id, 'mainHand', 'test-dagger');
    expect(screen.queryByTestId(`${prefix}-ctx-menu-test-dagger`)).toBeNull();

    // Send-to-hero via the menu.
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-dagger`));
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-send-${list[1]!.id}-test-dagger`));
    expect(props.onTransferItem).toHaveBeenCalledWith(list[0]!.id, 'test-dagger', list[1]!.id);

    // Backdrop click dismisses without dispatching.
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-potion`));
    expect(screen.getByTestId(`${prefix}-ctx-menu-test-potion`)).toBeDefined();
    props.onDropItem.mockClear();
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-backdrop`));
    expect(screen.queryByTestId(`${prefix}-ctx-menu-test-potion`)).toBeNull();
    expect(props.onDropItem).not.toHaveBeenCalled();

    // Esc dismisses the menu without closing the Character view.
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-potion`));
    expect(screen.getByTestId(`${prefix}-ctx-menu-test-potion`)).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId(`${prefix}-ctx-menu-test-potion`)).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('context menu exposes Use, Drop, Sell-info, and Split for eligible stacks', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${list[0]!.id}`;

    // Potion: Use + Drop + Sell (½ value info in the label).
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-potion`));
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-use-test-potion`));
    expect(props.onUseItem).toHaveBeenCalledWith(list[0]!.id, 'test-potion');

    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-potion`));
    const sellBtn = screen.getByTestId(`${prefix}-ctx-sell-test-potion`);
    expect(sellBtn.textContent).toMatch(/Sell \(½ value/);
    fireEvent.click(sellBtn);
    expect(props.onSellItem).toHaveBeenCalledWith(list[0]!.id, 'test-potion');

    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-test-potion`));
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-drop-test-potion`));
    expect(props.onDropItem).toHaveBeenCalledWith(list[0]!.id, 'test-potion');

    // Multi-quantity stack (incense ×5): Split with quantity input.
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-fighter-incense`));
    const qty = screen.getByTestId(`${prefix}-ctx-split-qty-fighter-incense`);
    expect(qty.tagName).toBe('INPUT');
    fireEvent.change(qty, { target: { value: 2 } });
    fireEvent.click(screen.getByTestId(`${prefix}-ctx-split-fighter-incense`));
    expect(props.onSplitStack).toHaveBeenCalledWith(list[0]!.id, 'fighter-incense', 2);
  });

  it('single click/Enter still selects (action bar parity): cells and slots are buttons', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${list[0]!.id}`;
    const cell = screen.getByTestId(`${prefix}-cell-test-dagger`);
    expect(cell.tagName).toBe('BUTTON');
    fireEvent.click(cell);
    // Action bar appears with the same Equip handler as the context menu.
    const equipBtn = screen.getByTestId(`${prefix}-equip-test-dagger-mainHand`);
    expect(equipBtn.tagName).toBe('BUTTON');
    fireEvent.click(equipBtn);
    expect(props.onEquipItem).toHaveBeenCalledWith(list[0]!.id, 'mainHand', 'test-dagger');
  });

  it('party strip has a shared sort control and a right-click Send-to menu; Esc keeps the view open', () => {
    const list = heroesWithExtras();
    const props = baseViewProps(list);
    render(<CharacterView {...{ ...props, initialMode: 'party' }} />);
    const stripSort = screen.getByTestId('character-view-party-sort');
    expect(stripSort.tagName).toBe('SELECT');
    expect(
      within(stripSort as HTMLSelectElement)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(['newest', 'name', 'type', 'value', 'weight']);

    // Sort applies inside each hero card grid.
    fireEvent.change(stripSort, { target: { value: 'name' } });
    const heroId = list[0]!.id;
    expect(
      orderedGridCellIds(
        `character-view-party-card-${heroId}-grid`,
        `character-view-party-card-${heroId}`,
      ),
    ).toEqual(
      sortInventoryInstances(list[0]!.inventory, 'name', compendium).map((i) => i.instanceId),
    );

    // Right-click a party cell: Send-to menu dispatches TRANSFER via engine state.
    const partyCell = screen.getByTestId(`character-view-party-card-${heroId}-cell-test-dagger`);
    fireEvent.contextMenu(partyCell);
    const menu = screen.getByTestId('character-view-party-ctx-menu-test-dagger');
    expect(menu.getAttribute('role')).toBe('menu');
    fireEvent.click(
      screen.getByTestId(`character-view-party-ctx-send-${heroId}-to-${list[1]!.id}-test-dagger`),
    );
    expect(props.onTransferItem).toHaveBeenCalledWith(heroId, 'test-dagger', list[1]!.id);
    expect(screen.queryByTestId('character-view-party-ctx-menu-test-dagger')).toBeNull();

    // Esc with the menu open dismisses the menu, not the Character view.
    fireEvent.contextMenu(partyCell);
    expect(screen.getByTestId('character-view-party-ctx-menu-test-dagger')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('character-view-party-ctx-menu-test-dagger')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
