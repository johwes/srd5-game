import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { getInventoryTotalWeightLb } from '../components/inventory/inventoryCategories.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { formatSignedNumber } from '../components/compendium/formatters.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function heroes() {
  return [
    getPregenCharacter('pregen-fighter')!,
    getPregenCharacter('pregen-rogue')!,
    getPregenCharacter('pregen-cleric')!,
  ];
}

function baseViewProps(list = heroes()) {
  return {
    heroes: list,
    activeHeroId: list[0]!.id,
    compendium,
    onSelectHero: vi.fn(),
    onClose: vi.fn(),
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onTransferItem: vi.fn(),
  };
}

function pickMelee(attacks: ReturnType<typeof computeDerivedCharacter>['weaponAttacks']) {
  return (
    attacks.find((a) => a.slot === 'main_hand' && a.rangeType === 'melee') ??
    attacks.find((a) => a.slot === 'off_hand' && a.rangeType === 'melee') ??
    attacks.find((a) => a.rangeType === 'melee') ??
    null
  );
}

describe('SRD-1503: Doll depth (weapon cards, weight bar, unequip)', () => {
  it('renders melee/ranged weapon cards matching derived to-hit/damage', () => {
    const list = heroes();
    const fighter = list[0]!;
    render(<CharacterView {...baseViewProps(list)} />);
    const prefix = `character-view-${fighter.id}`;
    const derived = computeDerivedCharacter(fighter, compendium);

    const melee = pickMelee(derived.weaponAttacks);
    expect(melee).not.toBeNull();
    expect(screen.getByTestId(`${prefix}-weapon-melee`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-weapon-melee-name`).textContent).toContain(melee!.name);
    expect(screen.getByTestId(`${prefix}-weapon-melee-tohit`).textContent).toContain(
      formatSignedNumber(melee!.toHitBonus),
    );
    expect(screen.getByTestId(`${prefix}-weapon-melee-tohit`).textContent).toContain('to hit');
    expect(screen.getByTestId(`${prefix}-weapon-melee-damage`).textContent).toContain(
      melee!.damageFormula,
    );
    expect(screen.getByTestId(`${prefix}-weapon-melee-damage`).textContent).toContain(
      melee!.damageType,
    );
    cleanup();

    // Ranged profile: the rogue pregen equips a shortbow (true ranged weapon).
    const rogue = list[1]!;
    const rogueDerived = computeDerivedCharacter(rogue, compendium);
    const ranged = rogueDerived.weaponAttacks.find((a) => a.rangeType === 'ranged') ?? null;
    expect(ranged).not.toBeNull();
    render(<CharacterView {...{ ...baseViewProps(list), activeHeroId: rogue.id }} />);
    const roguePrefix = `character-view-${rogue.id}`;
    expect(screen.getByTestId(`${roguePrefix}-weapon-ranged`)).toBeDefined();
    expect(screen.getByTestId(`${roguePrefix}-weapon-ranged-name`).textContent).toContain(
      ranged!.name,
    );
    expect(screen.getByTestId(`${roguePrefix}-weapon-ranged-tohit`).textContent).toContain(
      formatSignedNumber(ranged!.toHitBonus),
    );
    expect(screen.getByTestId(`${roguePrefix}-weapon-ranged-damage`).textContent).toContain(
      ranged!.damageFormula,
    );
  });

  it('shows ranged empty state when no ranged profile exists (cleric)', () => {
    const list = heroes();
    const cleric = list[2]!;
    const derived = computeDerivedCharacter(cleric, compendium);
    expect(derived.weaponAttacks.find((a) => a.rangeType === 'ranged') ?? null).toBeNull();
    render(<CharacterView {...{ ...baseViewProps(list), activeHeroId: cleric.id }} />);
    const prefix = `character-view-${cleric.id}`;
    expect(screen.getByTestId(`${prefix}-weapon-ranged-empty`).textContent).toMatch(/No ranged/);
    // Melee card still resolves (warhammer or unarmed fallback).
    expect(screen.getByTestId(`${prefix}-weapon-melee-name`)).toBeDefined();
  });

  it('weight capacity bar matches STR×15 (display only) with progressbar semantics', () => {
    const list = heroes();
    const fighter = list[0]!;
    render(<CharacterView {...baseViewProps(list)} />);
    const prefix = `character-view-${fighter.id}`;
    const derived = computeDerivedCharacter(fighter, compendium);
    const str = derived.abilities.str?.score ?? 10;
    const carried = getInventoryTotalWeightLb(fighter.inventory, compendium);
    const capacity = str * 15;

    expect(screen.getByTestId(`${prefix}-weight`).textContent).toContain(`${carried}`);
    expect(screen.getByTestId(`${prefix}-capacity`).textContent).toContain(`${capacity} lb. cap`);
    const bar = screen.getByTestId(`${prefix}-weight-bar`);
    expect(bar.getAttribute('role')).toBe('progressbar');
    const expectedPct = capacity > 0 ? Math.min(100, Math.round((carried / capacity) * 100)) : 0;
    expect(bar.getAttribute('aria-valuenow')).toBe(String(expectedPct));
    expect(bar.getAttribute('aria-label')).toMatch(/carrying capacity/i);
  });

  it('doll shows enlarged token on class-tinted backdrop with AC shield', () => {
    const list = heroes();
    render(<CharacterView {...baseViewProps(list)} />);
    const derived = computeDerivedCharacter(list[0]!, compendium);
    expect(screen.getByTestId('character-view-doll')).toBeDefined();
    expect(screen.getByTestId('character-view-doll-portrait').textContent).toContain(
      derived.name.charAt(0).toUpperCase(),
    );
    expect(screen.getByTestId('character-view-doll-ac').textContent).toContain(
      `${derived.armorClass.totalAc}`,
    );
  });

  it('click-to-unequip from the doll dispatches EQUIP with undefined (mouse + keyboard parity)', () => {
    const list = heroes();
    const props = baseViewProps(list);
    const fighter = list[0]!;
    render(<CharacterView {...props} />);
    const prefix = `character-view-${fighter.id}`;
    // Shield is equipped on the fighter pregen; the doll exposes an Unequip button per slot.
    const unequipBtn = screen.getByTestId(`${prefix}-unequip-shield`);
    expect(unequipBtn.tagName).toBe('BUTTON');
    fireEvent.click(unequipBtn);
    expect(props.onEquipItem).toHaveBeenCalledWith(fighter.id, 'shield', undefined);

    // Paperdoll slots themselves are keyboard-focusable buttons (Deck focus+Enter parity).
    const slotBtn = screen.getByTestId(`${prefix}-paperdoll-slot-shield`);
    expect(slotBtn.tagName).toBe('BUTTON');
  });
});
