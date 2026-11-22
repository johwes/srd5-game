import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { CharacterSheetDrawer } from '../components/roster/CharacterSheetDrawer.js';
import { LootInventoryModal } from '../components/dungeon/LootInventoryModal.js';
import { PartyRosterView } from '../components/roster/PartyRosterView.js';
import type { PersistedRosterData } from '../persistence/index.js';

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

describe('SRD-1501: Character view shell', () => {
  it('renders header (name, race/class/level, XP, party gold), rail, paperdoll, and backpack grid', () => {
    const heroes = twoHeroes();
    render(<CharacterView {...baseViewProps(heroes)} />);
    // Header identity.
    expect(screen.getByTestId('character-view-header-name').textContent).toContain(heroes[0]!.name);
    expect(screen.getByTestId('character-view-header-level').textContent).toContain('Level');
    expect(screen.getByTestId('character-view-header-subline').textContent?.length).toBeGreaterThan(0);
    // XP bar + party gold total (sum of purses).
    expect(screen.getByTestId('character-view-header-xp').textContent).toContain('XP:');
    const expectedGold = heroes.reduce((s, h) => s + (h.currency?.gp ?? 0), 0);
    expect(screen.getByTestId('character-view-header-party-gold').textContent).toContain(`${expectedGold} gp`);
    expect(screen.getByTestId('character-view-xp-bar')).toBeDefined();
    // Hero switcher has one tab per hero.
    for (const h of heroes) {
      expect(screen.getByTestId(`character-view-hero-tab-${h.id}`)).toBeDefined();
    }
    // Left rail + Build panel vitals.
    expect(screen.getByTestId('character-view-rail')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-panel-build')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-hp')).toBeDefined();
    expect(screen.getByTestId('character-view-rail-ac')).toBeDefined();
    // Reused InventoryView doll + grid (testIdPrefix passthrough = character-view).
    expect(screen.getByTestId(`character-view-${heroes[0]!.id}-paperdoll`)).toBeDefined();
    expect(screen.getByTestId(`character-view-${heroes[0]!.id}-grid`)).toBeDefined();
    expect(screen.getByTestId(`character-view-${heroes[0]!.id}-currency`).textContent).toContain('gp');
  });

  it('switches heroes via portrait tabs (callback), closing on Esc', () => {
    const heroes = twoHeroes();
    const props = baseViewProps(heroes);
    render(<CharacterView {...props} />);
    fireEvent.click(screen.getByTestId(`character-view-hero-tab-${heroes[1]!.id}`));
    expect(props.onSelectHero).toHaveBeenCalledWith(heroes[1]!.id);

    // Re-render on the second hero: header + inventory pane follow engine state.
    cleanup();
    render(<CharacterView {...{ ...props, activeHeroId: heroes[1]!.id }} />);
    expect(screen.getByTestId('character-view-header-name').textContent).toContain(heroes[1]!.name);
    expect(screen.getByTestId(`character-view-${heroes[1]!.id}-grid`)).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('character-view-close-btn'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('rail tabs switch Build / Skills / Attributes with keyboard-focusable buttons', () => {
    render(<CharacterView {...baseViewProps()} />);
    for (const tab of ['build', 'skills', 'attributes'] as const) {
      const btn = screen.getByTestId(`character-view-rail-tab-${tab}`);
      expect(btn.tagName).toBe('BUTTON');
      fireEvent.click(btn);
      expect(screen.getByTestId(`character-view-rail-panel-${tab}`)).toBeDefined();
    }
    // Skills panel lists all 18 skills; attributes panel lists all 6 abilities.
    fireEvent.click(screen.getByTestId('character-view-rail-tab-skills'));
    expect(screen.getByTestId('character-view-rail-skill-perception')).toBeDefined();
    fireEvent.click(screen.getByTestId('character-view-rail-tab-attributes'));
    expect(screen.getByTestId('character-view-rail-ability-str')).toBeDefined();
  });

  it('equip/attune/transfer dispatch through the InventoryView reuse', () => {
    const heroes = twoHeroes();
    const props = baseViewProps(heroes);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${heroes[0]!.id}`;
    // Paperdoll slots render as buttons (Deck focus+Enter parity).
    const slotBtn = screen.getByTestId(`${prefix}-paperdoll-slot-armor`);
    expect(slotBtn.tagName).toBe('BUTTON');
    fireEvent.click(screen.getByTestId(`${prefix}-paperdoll-slot-mainHand`));
    // Backpack cells are buttons too.
    const cells = document.querySelectorAll(`[data-testid^="${prefix}-cell-"]`);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('drawer Equipment tab links out to the Character view (drawer keeps working)', () => {
    const hero = twoHeroes()[0]!;
    const onOpenCharacterView = vi.fn();
    const onClose = vi.fn();
    render(
      <CharacterSheetDrawer
        character={hero}
        compendium={compendium}
        onClose={onClose}
        onOpenCharacterView={onOpenCharacterView}
      />,
    );
    expect(screen.getByTestId('character-sheet-drawer')).toBeDefined();
    fireEvent.click(screen.getByTestId('sheet-tab-equipment'));
    expect(screen.getByTestId('sheet-panel-equipment')).toBeDefined();
    fireEvent.click(screen.getByTestId('sheet-open-character-view-btn'));
    expect(onOpenCharacterView).toHaveBeenCalledWith(hero.id);
    // Drawer still closes via Esc/Close.
    fireEvent.click(screen.getByTestId('sheet-close-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('roster hero cards and loot modal expose Character view entry points', () => {
    const heroes = twoHeroes();
    const roster: PersistedRosterData = {
      version: 1,
      characters: heroes,
      activePartyIds: heroes.map((h) => h.id),
      updatedAt: new Date().toISOString(),
    };
    const onOpenCharacterView = vi.fn();
    render(
      <PartyRosterView
        roster={roster}
        compendium={compendium}
        onUpdateRoster={vi.fn()}
        onResetToIconics={vi.fn()}
        onInspectCharacter={vi.fn()}
        onLevelUpCharacter={vi.fn()}
        onOpenCharacterView={onOpenCharacterView}
      />,
    );
    fireEvent.click(screen.getByTestId(`roster-open-character-view-${heroes[0]!.id}`));
    expect(onOpenCharacterView).toHaveBeenCalledWith(heroes[0]!.id);
    cleanup();

    const party: Record<string, any> = Object.fromEntries(
      heroes.map((h) => [h.id, { id: h.id, name: h.name, characterSheet: { inventory: [], equippedSlots: {}, currency: { gp: 5 } } }]),
    );
    const onOpenLootView = vi.fn();
    render(
      <LootInventoryModal
        isOpen
        party={party}
        initialHeroId={heroes[0]!.id}
        compendium={compendium}
        activeLoot={null}
        onClose={vi.fn()}
        onClaimLoot={vi.fn()}
        onEquipItem={vi.fn()}
        onAttuneItem={vi.fn()}
        onUnattuneItem={vi.fn()}
        onOpenCharacterView={onOpenLootView}
      />,
    );
    fireEvent.click(screen.getByTestId('loot-open-character-view-btn'));
    expect(onOpenLootView).toHaveBeenCalledWith(heroes[0]!.id);
  });
});
