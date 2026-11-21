import { defaultCompendium } from '@srd5/data';
import type { InventoryItemInstance } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryView,
  PAPERDOLL_SLOTS,
  resolveEquippedInstanceId,
  type InventorySlotName,
} from '../components/inventory/InventoryView.js';
import { InventoryGridCell } from '../components/inventory/InventoryGridCell.js';
import {
  getInventoryFilterCategory,
  getInventoryItemWeightLb,
  getInventoryTotalWeightLb,
  isInventoryItemAttunable,
  isInventoryItemUsable,
} from '../components/inventory/inventoryCategories.js';
import {
  candidateSlotsForItem,
  compareItemToEquipped,
  getItemAcValue,
  suggestEquipSlot,
} from '../components/inventory/inventoryCompare.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function makeInv(itemId: string, instanceId: string, extra?: Partial<InventoryItemInstance>): InventoryItemInstance {
  return { instanceId, itemId, quantity: 1, ...extra };
}

function baseProps(overrides?: Partial<Parameters<typeof InventoryView>[0]>) {
  return {
    heroId: 'hero-1',
    heroName: 'Valeros',
    inventory: [
      makeInv('longsword', 'inst-sword'),
      makeInv('chain-shirt', 'inst-chain'),
      makeInv('potion-of-healing', 'inst-potion', { quantity: 2 }),
      makeInv('thieves-tools', 'inst-tools'),
      makeInv('cloak-of-protection', 'inst-cloak'),
    ] as InventoryItemInstance[],
    equippedSlots: {} as Record<string, string | undefined>,
    attunedItemInstanceIds: [] as string[],
    currency: { cp: 0, sp: 0, ep: 0, gp: 42, pp: 0 },
    compendium,
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onUseItem: vi.fn(),
    testIdPrefix: 'inventory',
    ...overrides,
  };
}

describe('SRD-1305: inventory category + compare helpers', () => {
  it('buckets items into the six filter categories', () => {
    expect(getInventoryFilterCategory('longsword', compendium)).toBe('weapons');
    expect(getInventoryFilterCategory('chain-shirt', compendium)).toBe('armor');
    expect(getInventoryFilterCategory('shield', compendium)).toBe('armor');
    expect(getInventoryFilterCategory('potion-of-healing', compendium)).toBe('potions');
    expect(getInventoryFilterCategory('antitoxin', compendium)).toBe('potions');
    expect(getInventoryFilterCategory('scroll-of-fireball', compendium)).toBe('scrolls');
    expect(getInventoryFilterCategory('thieves-tools', compendium)).toBe('tools');
    expect(getInventoryFilterCategory('cloak-of-protection', compendium)).toBe('other');
    expect(getInventoryFilterCategory('not-a-real-item', compendium)).toBe('other');
  });

  it('computes quantity-aware weight totals', () => {
    const inv = [makeInv('longsword', 'a'), makeInv('potion-of-healing', 'b', { quantity: 2 })];
    const total = getInventoryTotalWeightLb(inv, compendium);
    expect(total).toBe(
      getInventoryItemWeightLb('longsword', compendium) +
        2 * getInventoryItemWeightLb('potion-of-healing', compendium),
    );
    expect(getInventoryTotalWeightLb([], compendium)).toBe(0);
  });

  it('flags usable and attunable items', () => {
    expect(isInventoryItemUsable('potion-of-healing', compendium)).toBe(true);
    expect(isInventoryItemUsable('scroll-of-fireball', compendium)).toBe(true);
    expect(isInventoryItemUsable('wand-of-magic-missiles', compendium)).toBe(true);
    expect(isInventoryItemUsable('longsword', compendium)).toBe(false);
    expect(isInventoryItemAttunable('cloak-of-protection', compendium)).toBe(true);
    expect(isInventoryItemAttunable('longsword', compendium)).toBe(false);
  });

  it('suggests paperdoll slots per item', () => {
    expect(candidateSlotsForItem('longsword', compendium)).toEqual(['mainHand', 'offHand']);
    expect(candidateSlotsForItem('chain-shirt', compendium)).toEqual(['armor']);
    expect(candidateSlotsForItem('shield', compendium)).toEqual(['shield']);
    expect(suggestEquipSlot('shortbow', compendium)).toBe('ranged');
    expect(suggestEquipSlot('potion-of-healing', compendium)).toBeNull();
    expect(candidateSlotsForItem('cloak-of-protection', compendium)).toEqual([]);
  });

  it('produces +AC compare deltas with empty-slot and swap phrasing', () => {
    expect(getItemAcValue('chain-shirt', compendium)).toBeGreaterThan(0);
    expect(getItemAcValue('longsword', compendium)).toBe(0);
    const empty = compareItemToEquipped('chain-shirt', null, compendium);
    expect(empty.join(' ')).toMatch(/\+13 AC.*slot empty/);
    const swap = compareItemToEquipped('chain-shirt', 'leather-armor', compendium);
    expect(swap.join(' ')).toMatch(/\+2 AC vs equipped/);
    expect(compareItemToEquipped('longsword', 'shortbow', compendium)).toEqual([]);
  });

  it('resolves both equipped-slot key shapes', () => {
    expect(resolveEquippedInstanceId({ armor: 'a' }, 'armor')).toBe('a');
    expect(resolveEquippedInstanceId({ armorInstanceId: 'b' }, 'armor')).toBe('b');
    expect(resolveEquippedInstanceId({}, 'shield')).toBeUndefined();
    expect(resolveEquippedInstanceId(null, 'shield')).toBeUndefined();
  });
});

describe('SRD-1305: InventoryView paperdoll + backpack grid', () => {
  it('renders all 5 paperdoll slots plus the backpack grid with stack counts', () => {
    render(<InventoryView {...baseProps()} />);
    const prefix = 'inventory-hero-1';
    for (const slot of PAPERDOLL_SLOTS) {
      expect(screen.getByTestId(`${prefix}-paperdoll-slot-${slot}`)).toBeDefined();
    }
    expect(screen.getByTestId(`${prefix}-grid`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-cell-inst-sword`)).toBeDefined();
    // Stack badge on the x2 potion stack, hidden on singletons.
    expect(screen.getByTestId(`${prefix}-cell-inst-potion-stack`).textContent).toContain('2');
    expect(screen.queryByTestId(`${prefix}-cell-inst-sword-stack`)).toBeNull();
    // Currency + weight strip.
    expect(screen.getByTestId(`${prefix}-currency`).textContent).toContain('42');
    expect(screen.getByTestId(`${prefix}-weight`).textContent).toContain('lb.');
    expect(screen.getByTestId(`${prefix}-attunement-count`).textContent).toContain('0 / 3');
  });

  it('filters by category and searches by name', () => {
    render(<InventoryView {...baseProps()} />);
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-filter-weapons`));
    expect(screen.getByTestId(`${prefix}-cell-inst-sword`)).toBeDefined();
    expect(screen.queryByTestId(`${prefix}-cell-inst-potion`)).toBeNull();
    expect(screen.queryByTestId(`${prefix}-cell-inst-tools`)).toBeNull();

    fireEvent.click(screen.getByTestId(`${prefix}-filter-all`));
    fireEvent.change(screen.getByTestId(`${prefix}-search`), { target: { value: 'cloak' } });
    expect(screen.getByTestId(`${prefix}-cell-inst-cloak`)).toBeDefined();
    expect(screen.queryByTestId(`${prefix}-cell-inst-sword`)).toBeNull();

    fireEvent.change(screen.getByTestId(`${prefix}-search`), { target: { value: 'zzz-no-match' } });
    expect(screen.getByTestId(`${prefix}-grid-empty`)).toBeDefined();
  });

  it('selects a cell to reveal the action bar with equip slots + compare delta', () => {
    const props = baseProps();
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-chain`));

    const actions = screen.getByTestId(`${prefix}-actions-inst-chain`);
    expect(actions).toBeDefined();
    // Equippable armor offers the armor slot; compare shows +AC for empty slot.
    expect(screen.getByTestId(`${prefix}-equip-inst-chain-armor`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-compare-inst-chain`).textContent).toMatch(/\+13 AC/);
    // Not-attunable mundane armor shows no attune button but also no use button.
    expect(screen.queryByTestId(`${prefix}-attune-inst-chain`)).toBeNull();
    expect(screen.queryByTestId(`${prefix}-use-inst-chain`)).toBeNull();

    fireEvent.click(screen.getByTestId(`${prefix}-equip-inst-chain-armor`));
    expect(props.onEquipItem).toHaveBeenCalledWith('armor', 'inst-chain');
  });

  it('supports keyboard focus + Enter selection (Deck parity)', () => {
    render(<InventoryView {...baseProps()} />);
    const prefix = 'inventory-hero-1';
    const cell = screen.getByTestId(`${prefix}-cell-inst-sword`);
    expect(cell.tagName).toBe('BUTTON');
    cell.focus();
    expect(document.activeElement).toBe(cell);
    fireEvent.keyDown(cell, { key: 'Enter', code: 'Enter' });
    fireEvent.click(cell); // Enter on a button fires click
    expect(screen.getByTestId(`${prefix}-actions-inst-sword`)).toBeDefined();
    const equipBtn = screen.getByTestId(`${prefix}-equip-inst-sword-mainHand`);
    expect(equipBtn.tagName).toBe('BUTTON');
  });

  it('shows Use for potions and Attune for attunables, honoring the 3-max cap', () => {
    const props = baseProps();
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';

    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-potion`));
    fireEvent.click(screen.getByTestId(`${prefix}-use-inst-potion`));
    expect(props.onUseItem).toHaveBeenCalledWith('inst-potion');

    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-cloak`));
    fireEvent.click(screen.getByTestId(`${prefix}-attune-inst-cloak`));
    expect(props.onAttuneItem).toHaveBeenCalledWith('inst-cloak');

    // At the cap the attune button disables with a max label.
    cleanup();
    const capped = baseProps({
      attunedItemInstanceIds: ['x1', 'x2', 'inst-cloak'],
      inventory: [
        makeInv('cloak-of-protection', 'inst-cloak'),
        makeInv('flame-tongue', 'inst-flame'),
      ],
    });
    render(<InventoryView {...capped} />);
    const cappedPrefix = 'inventory-hero-1';
    // Cloak attuned: pip + unattune action.
    expect(screen.getByTestId(`${cappedPrefix}-cell-inst-cloak-attuned`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`${cappedPrefix}-cell-inst-cloak`));
    fireEvent.click(screen.getByTestId(`${cappedPrefix}-unattune-inst-cloak`));
    expect(capped.onUnattuneItem).toHaveBeenCalledWith('inst-cloak');
    // Flame tongue unattuned but capped: disabled attune.
    fireEvent.click(screen.getByTestId(`${cappedPrefix}-cell-inst-flame`));
    const attuneBtn = screen.getByTestId(`${cappedPrefix}-attune-inst-flame`);
    expect((attuneBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders occupants on the paperdoll with unequip + click-then-click equip', () => {
    const props = baseProps({
      equippedSlots: { armorInstanceId: 'inst-chain' },
    });
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    const slot = screen.getByTestId(`${prefix}-paperdoll-slot-armor`);
    expect(slot.getAttribute('aria-label')).toContain('Chain Shirt');

    // Long-form engine keys resolve (regression: modal read short keys only).
    fireEvent.click(screen.getByTestId(`${prefix}-unequip-armor`));
    expect(props.onEquipItem).toHaveBeenCalledWith('armor', undefined);

    // Click-then-click: select the longsword, then click the mainHand slot.
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-sword`));
    fireEvent.click(screen.getByTestId(`${prefix}-paperdoll-slot-mainHand`));
    expect(props.onEquipItem).toHaveBeenCalledWith('mainHand', 'inst-sword');
  });

  it('marks paperdoll attunement pips and draggability', () => {
    render(
      <InventoryView
        {...baseProps({
          equippedSlots: { armor: 'inst-chain' } as Record<string, string | undefined>,
          attunedItemInstanceIds: ['inst-cloak'],
          inventory: [
            makeInv('chain-shirt', 'inst-chain'),
            makeInv('cloak-of-protection', 'inst-cloak'),
            makeInv('longsword', 'inst-sword'),
          ],
        })}
      />,
    );
    const prefix = 'inventory-hero-1';
    // Cloak attuned in the backpack shows the pip.
    expect(screen.getByTestId(`${prefix}-cell-inst-cloak-attuned`)).toBeDefined();
    // Equippable cells are drag sources; potions are not.
    expect(screen.getByTestId(`${prefix}-cell-inst-sword`).getAttribute('draggable')).toBe('true');
    const slots: InventorySlotName[] = [...PAPERDOLL_SLOTS];
    expect(slots).toHaveLength(5);
  });
});

describe('SRD-1305: InventoryGridCell reuse for discovered loot', () => {
  it('renders a loot-grid cell with icon, rarity, and tooltip', () => {
    render(
      <InventoryGridCell
        itemId="cloak-of-protection"
        instanceId="discovered-cloak-of-protection-0"
        compendium={compendium}
        testIdPrefix="discovered-loot"
      />,
    );
    const cell = screen.getByTestId('discovered-loot-cell-discovered-cloak-of-protection-0');
    expect(cell.tagName).toBe('BUTTON');
    expect(
      screen.getByTestId(
        'discovered-loot-cell-discovered-cloak-of-protection-0-rarity',
      ),
    ).toBeDefined();
    expect(
      screen.getByTestId(
        'discovered-loot-cell-discovered-cloak-of-protection-0-tooltip-cloak-of-protection',
      ).textContent,
    ).toContain('Game effect:');
  });
});
