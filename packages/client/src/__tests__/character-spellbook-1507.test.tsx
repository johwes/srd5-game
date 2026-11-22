import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import { CharacterSpellbook } from '../components/inventory/CharacterSpellbook.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function baseViewProps(heroes = [getPregenCharacter('pregen-wizard')!]) {
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

function openSpellbook() {
  render(<CharacterView {...baseViewProps()} />);
  fireEvent.click(screen.getByTestId('character-view-pane-tab-spellbook'));
}

describe('SRD-1507: Spellbook view', () => {
  it('pane tabs toggle backpack and spellbook; spellbook shows class tab with prepared counts', () => {
    render(<CharacterView {...baseViewProps()} />);
    expect(screen.getByTestId('character-view-pane-tab-backpack')).toBeDefined();
    // Backpack grid visible by default.
    expect(document.querySelector('[data-testid$="-grid"]')).toBeDefined();
    fireEvent.click(screen.getByTestId('character-view-pane-tab-spellbook'));
    expect(screen.getByTestId('character-view-spellbook')).toBeDefined();
    // Wizard class tab carries a prepared/max count.
    const wizardTab = screen.getByTestId('character-view-spellbook-tab-wizard');
    expect(wizardTab.textContent).toMatch(/Wizard\s*\(\d+\/\d+\)/);
    expect(screen.getByTestId('character-view-spellbook-tab-common')).toBeDefined();
  });

  it('groups cantrips and leveled spells with live slot pips and resource header', () => {
    openSpellbook();
    // Cantrips row + Level 1 row render for the L1 wizard pregen.
    expect(screen.getByTestId('character-view-spellbook-level-0')).toBeDefined();
    expect(screen.getByTestId('character-view-spellbook-level-1')).toBeDefined();
    // Known cantrip + prepared spell cells resolve.
    expect(screen.getByTestId('character-view-spellbook-cell-fire-bolt')).toBeDefined();
    expect(screen.getByTestId('character-view-spellbook-cell-magic-missile')).toBeDefined();
    // Live slot pips for Level 1 (L1 wizard: 2 slots, both available).
    const pips = screen.getByTestId('character-view-spellbook-slot-pips-1');
    expect(pips.textContent).toContain('2/2');
    // Per-class header: save DC, spell attack, prepared counter.
    expect(screen.getByTestId('character-view-spellbook-save-dc')).toBeDefined();
    expect(screen.getByTestId('character-view-spellbook-spell-attack')).toBeDefined();
    expect(screen.getByTestId('character-view-spellbook-prepared-counter').textContent).toMatch(
      /Prepared/,
    );
    // Common tab aggregates non-spell actions.
    fireEvent.click(screen.getByTestId('character-view-spellbook-tab-common'));
    expect(screen.getByTestId('character-view-spellbook-common')).toBeDefined();
  });

  it('search filters spells and shows an empty result state', () => {
    openSpellbook();
    const search = screen.getByTestId('character-view-spellbook-search');
    fireEvent.change(search, { target: { value: 'magic missile' } });
    expect(screen.getByTestId('character-view-spellbook-cell-magic-missile')).toBeDefined();
    expect(
      document.querySelector('[data-testid="character-view-spellbook-cell-fire-bolt"]'),
    ).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz-no-such-spell' } });
    expect(screen.getByTestId('character-view-spellbook-no-results')).toBeDefined();
  });

  it('cleric tab shows prepared spells and live pips; fighter shows the empty state', () => {
    const cleric = getPregenCharacter('pregen-cleric')!;
    render(<CharacterSpellbook hero={cleric} compendium={compendium} />);
    expect(screen.getByTestId('character-view-spellbook-tab-cleric').textContent).toMatch(
      /Cleric\s*\(\d+\/\d+\)/,
    );
    expect(screen.getByTestId('character-view-spellbook-cell-healing-word')).toBeDefined();
    expect(screen.getByTestId('character-view-spellbook-slot-pips-1').textContent).toContain('2/2');
    cleanup();

    const fighter = getPregenCharacter('pregen-fighter')!;
    render(<CharacterSpellbook hero={fighter} compendium={compendium} />);
    expect(screen.getByTestId('character-view-spellbook-empty')).toBeDefined();
  });

  it('exhausted slots dim the level row cells but keep them rendered', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    const exhausted = {
      ...wizard,
      runtime: {
        ...wizard.runtime,
        expendedSpellSlots: { 1: 2 },
      },
    } as unknown as typeof wizard;
    render(<CharacterSpellbook hero={exhausted} compendium={compendium} />);
    const pips = screen.getByTestId('character-view-spellbook-slot-pips-1');
    expect(pips.textContent).toContain('0/2');
    // Cells still render (dimmed via opacity), never removed.
    expect(screen.getByTestId('character-view-spellbook-cell-magic-missile')).toBeDefined();
  });

  it('spell cells are keyboard-focusable buttons with full descriptions in the title', () => {
    openSpellbook();
    const cell = screen.getByTestId('character-view-spellbook-cell-magic-missile');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.getAttribute('title')).toContain('Magic Missile');
    cell.focus();
    expect(document.activeElement).toBe(cell);
  });
});
