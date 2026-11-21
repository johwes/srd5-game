import { defaultCompendium } from '@srd5/data';
import type { InventoryItemInstance } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../components/inventory/InventoryView.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function makeInv(itemId: string, instanceId: string, extra?: Partial<InventoryItemInstance>): InventoryItemInstance {
  return { instanceId, itemId, quantity: 1, ...extra };
}

function stretchProps(overrides?: Record<string, unknown>) {
  return {
    heroId: 'hero-1',
    heroName: 'Valeros',
    inventory: [
      makeInv('potion-of-healing', 'inst-potion', { quantity: 3 }),
      makeInv('longsword', 'inst-sword'),
      makeInv('cloak-of-protection', 'inst-cloak', { isMagicItem: true, identified: false }),
    ] as InventoryItemInstance[],
    equippedSlots: {} as Record<string, string | undefined>,
    attunedItemInstanceIds: [] as string[],
    currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
    compendium,
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onUseItem: vi.fn(),
    partyHeroes: [
      { id: 'hero-1', name: 'Valeros' },
      { id: 'hero-2', name: 'Merisiel' },
    ],
    strScore: 8,
    onTransferItem: vi.fn(),
    onDropItem: vi.fn(),
    onSplitStack: vi.fn(),
    onIdentifyItem: vi.fn(),
    onSellItem: vi.fn(),
    testIdPrefix: 'inventory',
    ...overrides,
  };
}

describe('SRD-1306: InventoryView stretch actions', () => {
  it('shows capacity vs STR and an encumbered display badge (no enforcement)', () => {
    // STR 8 -> 120 lb cap; plate armor (65 lb) x2 exceeds it.
    const props = stretchProps({
      inventory: [
        makeInv('plate-armor', 'plate-1'),
        makeInv('plate-armor', 'plate-2'),
      ],
    });
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    expect(screen.getByTestId(`${prefix}-capacity`).textContent).toContain('/ 120 lb. cap');
    expect(screen.getByTestId(`${prefix}-capacity`).textContent).toContain('encumbered (display only)');
  });

  it('renders equip restriction issues when provided', () => {
    const props = stretchProps({
      equipIssues: [{ slot: 'armor', message: "missing heavy armor proficiency for 'plate-armor'", severity: 'error' as const }],
    });
    render(<InventoryView {...props} />);
    expect(screen.getByTestId('inventory-hero-1-equip-issues').textContent).toContain('missing heavy armor');
  });

  it('masks unidentified items and identifies on click', () => {
    const props = stretchProps();
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-cloak`));
    expect(screen.getByTestId(`${prefix}-unidentified-inst-cloak`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`${prefix}-identify-inst-cloak`));
    expect(props.onIdentifyItem).toHaveBeenCalledWith('inst-cloak');
  });

  it('drops and sells the selected stack', () => {
    const props = stretchProps();
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-sword`));
    fireEvent.click(screen.getByTestId(`${prefix}-drop-inst-sword`));
    expect(props.onDropItem).toHaveBeenCalledWith('inst-sword');
    fireEvent.click(screen.getByTestId(`${prefix}-sell-inst-sword`));
    expect(props.onSellItem).toHaveBeenCalledWith('inst-sword');
  });

  it('splits stacks with a quantity input and gives to a target hero', () => {
    const props = stretchProps();
    render(<InventoryView {...props} />);
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-potion`));
    const qty = screen.getByTestId(`${prefix}-split-qty-inst-potion`) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '2' } });
    fireEvent.click(screen.getByTestId(`${prefix}-split-inst-potion`));
    expect(props.onSplitStack).toHaveBeenCalledWith('inst-potion', 2);

    // Give flow: pick a target then confirm.
    fireEvent.change(screen.getByTestId(`${prefix}-give-target-inst-potion`), {
      target: { value: 'hero-2' },
    });
    fireEvent.click(screen.getByTestId(`${prefix}-give-inst-potion`));
    expect(props.onTransferItem).toHaveBeenCalledWith('inst-potion', 'hero-2');
  });

  it('hides stretch controls when callbacks are unset (back-compat)', () => {
    render(
      <InventoryView
        heroId="hero-1"
        heroName="Valeros"
        inventory={[makeInv('longsword', 'inst-sword')]}
        equippedSlots={{}}
        attunedItemInstanceIds={[]}
        compendium={compendium}
        onEquipItem={vi.fn()}
        onAttuneItem={vi.fn()}
        onUnattuneItem={vi.fn()}
        testIdPrefix="inventory"
      />,
    );
    const prefix = 'inventory-hero-1';
    fireEvent.click(screen.getByTestId(`${prefix}-cell-inst-sword`));
    expect(screen.queryByTestId(`${prefix}-drop-inst-sword`)).toBeNull();
    expect(screen.queryByTestId(`${prefix}-sell-inst-sword`)).toBeNull();
    expect(screen.queryByTestId(`${prefix}-capacity`)).toBeNull();
  });
});
