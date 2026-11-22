import { defaultCompendium, getPregenCharacter, type CharacterBuildState } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../components/inventory/InventoryView.js';
import { CharacterView } from '../components/inventory/CharacterView.js';
import {
  ALL_ENGINE_SLOT_KEYS,
  engineKeyForSlot,
  resolveActiveWeaponSet,
  resolveSetAwareEquippedInstanceId,
} from '../components/inventory/weaponSets.js';
import { CharacterSheetDrawer } from '../components/roster/CharacterSheetDrawer.js';
import { autoEquipInventoryItems } from '../components/builder/builderState.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function makeFighterWithSets(): CharacterBuildState {
  const fighter = getPregenCharacter('pregen-fighter')!;
  return {
    ...structuredClone(fighter),
    id: 'fig-sets',
    inventory: [
      { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
      { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
    ],
    equippedSlots: {
      activeWeaponSet: 'primary',
      mainHandInstanceId: 'inst-sword',
      secondaryRangedInstanceId: 'inst-bow',
    },
    attunedItemInstanceIds: [],
  };
}

describe('SRD-1704: weapon-set slot helpers', () => {
  it('defaults legacy saves to the primary set', () => {
    expect(resolveActiveWeaponSet({})).toBe('primary');
    expect(resolveActiveWeaponSet(null)).toBe('primary');
    expect(resolveActiveWeaponSet({ activeWeaponSet: 'secondary' })).toBe('secondary');
  });

  it('maps short slots to the visible set engine keys (armor/shield shared)', () => {
    expect(engineKeyForSlot('armor', 'secondary')).toBe('armorInstanceId');
    expect(engineKeyForSlot('shield', 'secondary')).toBe('shieldInstanceId');
    expect(engineKeyForSlot('mainHand', 'primary')).toBe('mainHandInstanceId');
    expect(engineKeyForSlot('mainHand', 'secondary')).toBe('secondaryMainHandInstanceId');
    expect(engineKeyForSlot('offHand', 'secondary')).toBe('secondaryOffHandInstanceId');
    expect(engineKeyForSlot('ranged', 'secondary')).toBe('secondaryRangedInstanceId');
    expect(ALL_ENGINE_SLOT_KEYS).toContain('secondaryRangedInstanceId');
  });

  it('reads the visible set occupant (armor shared across sets)', () => {
    const slots = {
      armorInstanceId: 'inst-mail',
      mainHandInstanceId: 'inst-sword',
      secondaryRangedInstanceId: 'inst-bow',
    };
    expect(resolveSetAwareEquippedInstanceId(slots, 'armor', 'secondary')).toBe('inst-mail');
    expect(resolveSetAwareEquippedInstanceId(slots, 'ranged', 'primary')).toBeUndefined();
    expect(resolveSetAwareEquippedInstanceId(slots, 'ranged', 'secondary')).toBe('inst-bow');
    expect(resolveSetAwareEquippedInstanceId(slots, 'mainHand', 'secondary')).toBeUndefined();
  });
});

describe('SRD-1704: builder auto-equip fills both sets', () => {
  it('deals melee to Set I and the remainder to Set II with no shared instances', () => {
    const inventory = [
      { instanceId: 'inv-sword', itemId: 'longsword', quantity: 1 },
      { instanceId: 'inv-dagger', itemId: 'dagger', quantity: 1 },
      { instanceId: 'inv-bow', itemId: 'shortbow', quantity: 1 },
      { instanceId: 'inv-mace', itemId: 'mace', quantity: 1 },
    ];
    const slots = autoEquipInventoryItems(inventory, compendium);
    expect(slots.activeWeaponSet).toBe('primary');
    expect(slots.mainHandInstanceId).toBe('inv-sword');
    expect(slots.rangedInstanceId).toBe('inv-bow');
    // The leftover mace lands in the secondary main hand.
    expect(slots.secondaryMainHandInstanceId).toBe('inv-mace');
    const used = Object.values(slots).filter((v): v is string => typeof v === 'string' && v !== 'primary' && v !== 'secondary');
    expect(new Set(used).size).toBe(used.length);
  });

  it('fills a secondary ranged set when the primary set is melee-only', () => {
    const inventory = [
      { instanceId: 'inv-axe', itemId: 'greataxe', quantity: 1 },
      { instanceId: 'inv-light', itemId: 'light-crossbow', quantity: 1 },
    ];
    const slots = autoEquipInventoryItems(inventory, compendium);
    expect(slots.mainHandInstanceId).toBe('inv-axe');
    // Greataxe is two-handed: no off-hand, and the crossbow serves primary ranged...
    expect(slots.rangedInstanceId).toBe('inv-light');
    // ...leaving nothing for the secondary set, but nothing is double-booked.
    const used = Object.values(slots).filter((v): v is string => typeof v === 'string' && v !== 'primary' && v !== 'secondary');
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('SRD-1704: InventoryView set toggle + per-set paperdoll', () => {
  function viewProps(overrides?: Record<string, unknown>) {
    return {
      heroId: 'fig-sets',
      heroName: 'Sets Fighter',
      inventory: [
        { instanceId: 'inst-sword', itemId: 'longsword', quantity: 1 },
        { instanceId: 'inst-bow', itemId: 'shortbow', quantity: 1 },
      ],
      equippedSlots: {
        activeWeaponSet: 'primary',
        mainHandInstanceId: 'inst-sword',
        secondaryRangedInstanceId: 'inst-bow',
      } as Record<string, string | undefined>,
      attunedItemInstanceIds: [] as string[],
      currency: { gp: 0 },
      compendium,
      onEquipItem: vi.fn(),
      onAttuneItem: vi.fn(),
      onUnattuneItem: vi.fn(),
      testIdPrefix: 'inventory',
      ...overrides,
    };
  }

  it('renders the Set I/Set II toggle and the primary set by default', () => {
    render(<InventoryView {...viewProps()} />);
    const prefix = 'inventory-fig-sets';
    expect(screen.getByTestId(`${prefix}-weapon-set-toggle`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-weapon-set-primary`).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`${prefix}-weapon-set-secondary`).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId(`${prefix}-paperdoll-slot-mainHand`).textContent).toContain('Longsword');
    expect(screen.getByTestId(`${prefix}-paperdoll-slot-ranged`).textContent).toContain('Empty');
  });

  it('notifies the parent on toggle and renders the secondary set when active', () => {
    const onSwap = vi.fn();
    const { rerender } = render(<InventoryView {...viewProps({ onSwapWeaponSet: onSwap })} />);
    const prefix = 'inventory-fig-sets';
    fireEvent.click(screen.getByTestId(`${prefix}-weapon-set-secondary`));
    expect(onSwap).toHaveBeenCalledWith('secondary');

    rerender(
      <InventoryView
        {...viewProps({
          onSwapWeaponSet: onSwap,
          activeWeaponSet: 'secondary' as const,
          equippedSlots: {
            activeWeaponSet: 'secondary',
            mainHandInstanceId: 'inst-sword',
            secondaryRangedInstanceId: 'inst-bow',
          } as Record<string, string | undefined>,
        })}
      />,
    );
    expect(screen.getByTestId(`${prefix}-weapon-set-secondary`).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId(`${prefix}-paperdoll-slot-mainHand`).textContent).toContain('Empty');
    expect(screen.getByTestId(`${prefix}-paperdoll-slot-ranged`).textContent).toContain('Shortbow');
    expect(screen.getByTestId(`${prefix}-weapon-set-label`).textContent).toContain('Set II');
  });

  it('keeps equip/unequip signatures on short slot names (no testid regressions)', () => {
    const onEquip = vi.fn();
    render(<InventoryView {...viewProps({ onEquipItem: onEquip })} />);
    const prefix = 'inventory-fig-sets';
    // Unequip from the primary main-hand slot still uses the short name.
    fireEvent.click(screen.getByTestId(`${prefix}-unequip-mainHand`));
    expect(onEquip).toHaveBeenCalledWith('mainHand', undefined);
  });
});

describe('SRD-1704: CharacterView swap plumbing', () => {
  it('forwards the InventoryView toggle to onSwapWeaponSet for the active hero', () => {
    const hero = makeFighterWithSets();
    const onSwap = vi.fn();
    render(
      <CharacterView
        heroes={[hero]}
        activeHeroId={hero.id}
        compendium={compendium}
        onSelectHero={vi.fn()}
        onClose={vi.fn()}
        onEquipItem={vi.fn()}
        onAttuneItem={vi.fn()}
        onUnattuneItem={vi.fn()}
        onSwapWeaponSet={onSwap}
      />,
    );
    const toggle = screen.getByTestId(`character-view-${hero.id}-weapon-set-secondary`);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onSwap).toHaveBeenCalledWith(hero.id, 'secondary');
  });
});

describe('SRD-1704: sheet drawer per-set paperdoll', () => {
  it('toggles to Set II and equips into the secondary slots', () => {
    let current = makeFighterWithSets();
    const onUpdate = vi.fn((updated: CharacterBuildState) => {
      current = updated;
    });
    const { rerender } = render(
      <CharacterSheetDrawer character={current} compendium={compendium} onClose={vi.fn()} onUpdateCharacter={onUpdate} />,
    );
    fireEvent.click(screen.getByTestId('sheet-tab-equipment'));
    expect(screen.getByTestId('sheet-weapon-set-primary').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('sheet-paperdoll-slot-mainHand').textContent).toContain('Longsword');

    fireEvent.click(screen.getByTestId('sheet-weapon-set-secondary'));
    expect(onUpdate).toHaveBeenCalled();
    const swapped = onUpdate.mock.calls[onUpdate.mock.calls.length - 1]![0] as CharacterBuildState;
    expect(swapped.equippedSlots.activeWeaponSet).toBe('secondary');

    rerender(
      <CharacterSheetDrawer character={swapped} compendium={compendium} onClose={vi.fn()} onUpdateCharacter={onUpdate} />,
    );
    fireEvent.click(screen.getByTestId('sheet-tab-equipment'));
    expect(screen.getByTestId('sheet-weapon-set-label').textContent).toContain('Set II');
    // Primary longsword is not in the visible Set II main hand; the Set II bow shows in ranged.
    expect(screen.getByTestId('sheet-paperdoll-slot-mainHand').textContent).toContain('Unarmed Strike Only');
    expect(screen.getByTestId('sheet-paperdoll-slot-ranged').textContent).toContain('Shortbow');
  });
});
