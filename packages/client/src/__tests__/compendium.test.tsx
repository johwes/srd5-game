import { defaultCompendium } from '@srd5/data';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompendiumBrowser } from '../components/compendium/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-109: SRD 5.1 Compendium Browser UI', () => {
  it('renders category tabs with accurate bundled SRD 5.1 entity counts', () => {
    render(<CompendiumBrowser />);

    expect(screen.getByTestId('compendium-tab-races').textContent).toContain(
      String(defaultCompendium.races.length),
    );
    expect(screen.getByTestId('compendium-tab-classes').textContent).toContain(
      String(defaultCompendium.classes.length),
    );
    expect(screen.getByTestId('compendium-tab-spells').textContent).toContain(
      String(defaultCompendium.spells.length),
    );
    expect(screen.getByTestId('compendium-tab-equipment').textContent).toContain(
      String(defaultCompendium.equipment.length),
    );
    expect(screen.getByTestId('compendium-tab-magic_items').textContent).toContain(
      String(defaultCompendium.magicItems.length),
    );
    expect(screen.getByTestId('compendium-tab-monsters').textContent).toContain(
      String(defaultCompendium.monsters.length),
    );
  });

  it('browses, searches, and filters SRD 5.1 Races and displays racial traits and subraces', () => {
    render(<CompendiumBrowser initialTab="races" />);

    // Default tab is Races; verify all 9 SRD races are listed
    expect(screen.getByTestId('compendium-result-count').textContent).toContain('9');

    // Select Dwarf and inspect its detail panel (including Hill Dwarf subrace)
    fireEvent.click(screen.getByTestId('compendium-item-dwarf'));
    const detailPane = screen.getByTestId('compendium-detail-race');
    expect(within(detailPane).getByText('Dwarf')).toBeDefined();
    expect(within(detailPane).getByText('Hill Dwarf')).toBeDefined();
    expect(within(detailPane).getByText('Dwarven Resilience')).toBeDefined();

    // Filter by Small size -> Halfling and Gnome
    const sizeSelect = screen.getByLabelText('Filter races by size');
    fireEvent.change(sizeSelect, { target: { value: 'small' } });
    expect(screen.getByTestId('compendium-result-count').textContent).toContain('2');
    expect(screen.getByTestId('compendium-item-halfling')).toBeDefined();
    expect(screen.getByTestId('compendium-item-gnome')).toBeDefined();

    // Reset filters restores all 9 races
    fireEvent.click(screen.getByTestId('compendium-reset-filters'));
    expect(screen.getByTestId('compendium-result-count').textContent).toContain('9');
  });

  it('browses, searches, and filters SRD 5.1 Classes with L1-20 progression and subclasses', () => {
    render(<CompendiumBrowser />);

    fireEvent.click(screen.getByTestId('compendium-tab-classes'));
    expect(screen.getByTestId('compendium-result-count').textContent).toContain('12');

    // Filter by d10 Hit Die (Fighter, Paladin, Ranger)
    const hitDieSelect = screen.getByLabelText('Filter classes by hit die');
    fireEvent.change(hitDieSelect, { target: { value: '10' } });
    expect(screen.getByTestId('compendium-result-count').textContent).toContain('3');

    // Select Fighter and verify L1-20 progression table & Champion subclass
    fireEvent.click(screen.getByTestId('compendium-item-fighter'));
    const detailPane = screen.getByTestId('compendium-detail-class');
    expect(within(detailPane).getByText('Fighter')).toBeDefined();
    expect(within(detailPane).getAllByText(/Champion/i).length).toBeGreaterThan(0);
    expect(within(detailPane).getAllByText(/Action Surge/i).length).toBeGreaterThan(0);
    expect(within(detailPane).getByText(/Level 1–20 Progression Table/i)).toBeDefined();
  });

  it('browses, searches, and filters SRD 5.1 Spells by level, school, class, and search query', () => {
    render(<CompendiumBrowser />);

    fireEvent.click(screen.getByTestId('compendium-tab-spells'));

    // Filter by 3rd Level + Evocation + Wizard
    fireEvent.change(screen.getByLabelText('Filter spells by level'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Filter spells by school'), {
      target: { value: 'evocation' },
    });
    fireEvent.change(screen.getByLabelText('Filter spells by class'), {
      target: { value: 'wizard' },
    });

    // Search for "Fireball"
    fireEvent.change(screen.getByTestId('compendium-search-input'), {
      target: { value: 'Fireball' },
    });

    expect(screen.getByTestId('compendium-item-fireball')).toBeDefined();
    const detailPane = screen.getByTestId('compendium-detail-spell');
    expect(within(detailPane).getByText('Fireball')).toBeDefined();
    expect(within(detailPane).getAllByText(/3rd Level/i).length).toBeGreaterThan(0);
    expect(within(detailPane).getByText(/150 ft \(20-ft sphere\)/i)).toBeDefined();
  });

  it('browses, searches, and filters SRD 5.1 Equipment across Weapons, Armor, and Packs', () => {
    render(<CompendiumBrowser />);

    fireEvent.click(screen.getByTestId('compendium-tab-equipment'));

    // Filter to Weapons -> Martial
    fireEvent.change(screen.getByLabelText('Filter equipment by kind'), {
      target: { value: 'weapon' },
    });
    fireEvent.change(screen.getByLabelText('Filter equipment by weapon category'), {
      target: { value: 'martial' },
    });
    fireEvent.change(screen.getByTestId('compendium-search-input'), {
      target: { value: 'Longsword' },
    });

    expect(screen.getByTestId('compendium-item-longsword')).toBeDefined();
    const detailPane = screen.getByTestId('compendium-detail-equipment');
    expect(within(detailPane).getByText('Longsword')).toBeDefined();
    expect(within(detailPane).getByText(/1d8 slashing/i)).toBeDefined();
    expect(within(detailPane).getByText(/Versatile 1d10/i)).toBeDefined();
  });

  it('browses, searches, and filters SRD 5.1 Magic Items by rarity, category, and attunement', () => {
    render(<CompendiumBrowser />);

    fireEvent.click(screen.getByTestId('compendium-tab-magic_items'));

    // Filter to Uncommon Wondrous Items
    fireEvent.change(screen.getByLabelText('Filter magic items by category'), {
      target: { value: 'wondrous' },
    });
    fireEvent.change(screen.getByLabelText('Filter magic items by rarity'), {
      target: { value: 'uncommon' },
    });
    fireEvent.change(screen.getByTestId('compendium-search-input'), {
      target: { value: 'Bag of Holding' },
    });

    expect(screen.getByTestId('compendium-item-bag-of-holding')).toBeDefined();
    const detailPane = screen.getByTestId('compendium-detail-magic-item');
    expect(within(detailPane).getByText('Bag of Holding')).toBeDefined();
    expect(within(detailPane).getByText('Uncommon')).toBeDefined();
  });

  it('browses, searches, and filters SRD 5.1 Monsters and renders full 5e stat blocks', () => {
    render(<CompendiumBrowser />);

    fireEvent.click(screen.getByTestId('compendium-tab-monsters'));

    // Filter by Challenge Rating 1/4 and Skirmisher AI archetype -> Goblin
    fireEvent.change(screen.getByLabelText('Filter monsters by challenge rating'), {
      target: { value: '0.25' },
    });
    fireEvent.change(screen.getByLabelText('Filter monsters by AI archetype'), {
      target: { value: 'skirmisher' },
    });
    fireEvent.change(screen.getByTestId('compendium-search-input'), {
      target: { value: 'Goblin' },
    });

    expect(screen.getByTestId('compendium-item-goblin')).toBeDefined();
    fireEvent.click(screen.getByTestId('compendium-item-goblin'));

    const detailPane = screen.getByTestId('compendium-detail-monster');
    expect(within(detailPane).getByText('Goblin')).toBeDefined();
    expect(within(detailPane).getByText(/CR 1\/4/i)).toBeDefined();
    expect(within(detailPane).getByText(/Nimble Escape/i)).toBeDefined();
    expect(within(detailPane).getByText(/Scimitar/i)).toBeDefined();
  });
});
