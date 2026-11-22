import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import { getInventoryTotalWeightLb } from '../components/inventory/inventoryCategories.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function twoHeroes() {
  const fighter = getPregenCharacter('pregen-fighter')!;
  const wizard = getPregenCharacter('pregen-wizard')!;
  return [fighter, wizard];
}

function baseViewProps(heroes = twoHeroes()) {
  return {
    heroes,
    activeHeroId: heroes[0]!.id,
    compendium,
    onSelectHero: vi.fn(),
    onClose: vi.fn(),
    onEquipItem: vi.fn(),
    onAttuneItem: vi.fn(),
    onUnattuneItem: vi.fn(),
    onTransferItem: vi.fn(),
  };
}

function openPartyMode(heroes = twoHeroes()) {
  const props = baseViewProps(heroes);
  render(<CharacterView {...props} />);
  const partyBtn = screen.getByTestId('character-view-mode-party');
  expect(partyBtn.tagName).toBe('BUTTON');
  fireEvent.click(partyBtn);
  return props;
}

describe('SRD-1502: Party strip mode', () => {
  it('toggles Character/Party modes and shows one card per hero with per-hero + total gold', () => {
    const heroes = twoHeroes();
    openPartyMode(heroes);
    // Strip container + one card per hero.
    expect(screen.getByTestId('character-view-party-strip')).toBeDefined();
    for (const h of heroes) {
      expect(screen.getByTestId(`character-view-party-card-${h.id}`)).toBeDefined();
      expect(
        screen.getByTestId(`character-view-party-card-${h.id}-gold`).textContent,
      ).toContain(`${h.currency?.gp ?? 0} gp`);
      expect(screen.getByTestId(`character-view-party-card-${h.id}-hp`)).toBeDefined();
      expect(screen.getByTestId(`character-view-party-card-${h.id}-ac`)).toBeDefined();
      expect(screen.getByTestId(`character-view-party-card-${h.id}-grid`)).toBeDefined();
      expect(screen.getByTestId(`character-view-party-card-${h.id}-weight`)).toBeDefined();
    }
    // Party gold total stays in the header in both modes (sum of purses).
    const expectedTotal = heroes.reduce((s, h) => s + (h.currency?.gp ?? 0), 0);
    expect(screen.getByTestId('character-view-header-party-gold').textContent).toContain(
      `${expectedTotal} gp`,
    );
    // Back to character mode restores the 3-pane.
    fireEvent.click(screen.getByTestId('character-view-mode-character'));
    expect(screen.getByTestId(`character-view-${heroes[0]!.id}-grid`)).toBeDefined();
  });

  it('weight bar matches STR×15 (display only) per hero', () => {
    const heroes = twoHeroes();
    openPartyMode(heroes);
    for (const h of heroes) {
      const derived = computeDerivedCharacter(h, compendium);
      const str = derived.abilities.str?.score ?? 10;
      const carried = getInventoryTotalWeightLb(h.inventory, compendium);
      const weightText = screen.getByTestId(
        `character-view-party-card-${h.id}-weight`,
      ).textContent!;
      expect(weightText).toContain(`${carried}`);
      expect(weightText).toContain(`${str * 15} lb`);
      // Progressbar exposes the same capacity math to AT.
      const bar = screen.getByTestId(`character-view-party-card-${h.id}-weight-bar`);
      expect(bar.getAttribute('role')).toBe('progressbar');
    }
  });

  it('shared search/filter applies to every hero card', () => {
    const heroes = twoHeroes();
    openPartyMode(heroes);
    // Shared search narrows all cards at once.
    const search = screen.getByTestId('character-view-party-search');
    fireEvent.change(search, { target: { value: 'zzz-no-such-item' } });
    for (const h of heroes) {
      expect(
        screen.getByTestId(`character-view-party-card-${h.id}-grid-empty`).textContent,
      ).toMatch(/No items match|Backpack is empty/);
    }
    // Clearing search restores the first hero's backpack cells.
    fireEvent.change(search, { target: { value: '' } });
    const cells = document.querySelectorAll(
      `[data-testid^="character-view-party-card-${heroes[0]!.id}-cell-"]`,
    );
    expect(cells.length).toBeGreaterThan(0);
    // Shared filter buttons exist and are keyboard-focusable buttons.
    const allBtn = screen.getByTestId('character-view-party-filter-all');
    expect(allBtn.tagName).toBe('BUTTON');
    fireEvent.click(screen.getByTestId('character-view-party-filter-weapons'));
    expect(
      screen.getByTestId('character-view-party-filter-weapons').getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('click → Send to <hero> dispatches TRANSFER_ITEM with (from, instance, to)', () => {
    const heroes = twoHeroes();
    const props = openPartyMode(heroes);
    const from = heroes[0]!;
    const to = heroes[1]!;
    const instanceId = from.inventory[0]!.instanceId;
    // Cells are real buttons (Deck focus+Enter parity).
    const cell = screen.getByTestId(
      `character-view-party-card-${from.id}-cell-${instanceId}`,
    );
    expect(cell.tagName).toBe('BUTTON');
    fireEvent.click(cell);
    const sendBtn = screen.getByTestId(
      `character-view-party-send-${from.id}-to-${to.id}-${instanceId}`,
    );
    expect(sendBtn.tagName).toBe('BUTTON');
    fireEvent.click(sendBtn);
    expect(props.onTransferItem).toHaveBeenCalledWith(from.id, instanceId, to.id);
  });

  it('engine-state re-render proof: TRANSFER_ITEM updates both heroes grids', () => {
    const heroes = twoHeroes();
    const from = heroes[0]!;
    const to = heroes[1]!;
    const moving = from.inventory.find((i) => {
      // Move an unequipped backpack item so the engine transfer succeeds.
      const equipped = new Set(Object.values(from.equippedSlots ?? {}).filter(Boolean));
      return !equipped.has(i.instanceId);
    })!;
    const props = baseViewProps(heroes);
    const { rerender } = render(<CharacterView {...props} />);
    fireEvent.click(screen.getByTestId('character-view-mode-party'));
    expect(
      screen.getByTestId(`character-view-party-card-${from.id}-cell-${moving.instanceId}`),
    ).toBeDefined();

    // Simulate the authoritative engine move, then re-render from engine state.
    const nextFrom = {
      ...from,
      inventory: from.inventory.filter((i) => i.instanceId !== moving.instanceId),
    };
    const nextTo = { ...to, inventory: [...to.inventory, { ...moving }] };
    rerender(
      <CharacterView {...props} heroes={[nextFrom, nextTo]} activeHeroId={nextFrom.id} />,
    );
    // Source card no longer shows the item; destination card does.
    expect(
      document.querySelector(
        `[data-testid="character-view-party-card-${from.id}-cell-${moving.instanceId}"]`,
      ),
    ).toBeNull();
    expect(
      screen.getByTestId(`character-view-party-card-${to.id}-cell-${moving.instanceId}`),
    ).toBeDefined();
    // Per-hero gold still renders from engine state after the move.
    expect(
      screen.getByTestId(`character-view-party-card-${to.id}-gold`).textContent,
    ).toContain(`${nextTo.currency?.gp ?? 0} gp`);
  });

  it('closes on Esc from party mode (same dismissal rule)', () => {
    const props = openPartyMode();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
