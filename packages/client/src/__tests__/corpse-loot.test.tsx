import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Container } from 'pixi.js';
import { defaultCompendium } from '@srd5/data';
import {
  getAvailablePropInteractions,
  type Combatant,
  type InteractiveProp,
} from '@srd5/engine';
import { PropRenderer, resolvePropFrameKey } from '../canvas/layers/PropLayer.js';
import { PropInteractionCard } from '../components/dungeon/PropInteractionCard.js';
import {
  LootInventoryModal,
  formatLootProvenance,
} from '../components/dungeon/LootInventoryModal.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;

function makeHeroActor(skillBonus: number): Combatant {
  return {
    id: 'hero-1',
    name: 'Valeros',
    position: { x: 1, y: 1 },
    characterSheet: {
      skills: {
        investigation: { totalBonus: skillBonus },
        survival: { totalBonus: skillBonus },
      },
      abilities: {
        str: { modifier: 0 },
        dex: { modifier: 2 },
        con: { modifier: 2 },
        int: { modifier: 1 },
        wis: { modifier: 2 },
        cha: { modifier: 0 },
      },
      proficiencyBonus: 2,
      proficiencies: {},
    },
  } as unknown as Combatant;
}

function makeCorpseProp(overrides?: Partial<InteractiveProp>): InteractiveProp {
  return {
    id: 'corpse-goblin-1',
    x: 2,
    y: 1,
    kind: 'corpse',
    state: 'open',
    blocksMovement: false,
    blocksSight: false,
    discovered: true,
    monsterId: 'goblin-1',
    label: 'Remains of Goblin',
    searched: false,
    searchDc: 10,
    lootTable: {
      gp: 12,
      items: ['acid-vial'],
      origin: 'monster_drop',
      sourceName: 'Goblin',
    },
    ...overrides,
  };
}

describe('SRD-1307: corpse canvas presentation', () => {
  it('resolves no atlas frame (procedural skull) and renders a node', () => {
    expect(resolvePropFrameKey('corpse', 'open')).toBeNull();
    const parent = new Container();
    const renderer = new PropRenderer(parent);
    renderer.render({
      props: [
        {
          id: 'corpse-goblin-1',
          x: 1,
          y: 1,
          kind: 'corpse',
          state: 'open',
          discovered: true,
        },
      ],
      cellSize: 48,
    });
    expect(
      renderer.container.children.find((c) => c.label === 'PropNode:corpse-goblin-1'),
    ).toBeDefined();
    renderer.destroy();
  });
});

describe('SRD-1307: drop provenance formatting', () => {
  it('attributes slain-foe drops, war awards, and caches distinctly', () => {
    expect(formatLootProvenance('monster_drop', 'Goblin')).toBe('Slain foe drop — Goblin');
    expect(formatLootProvenance('monster_drop')).toBe('Slain foe drop');
    expect(formatLootProvenance('war_award')).toBe('War spoils award');
    expect(formatLootProvenance('cache', 'Old Chest')).toBe('Old Chest');
    expect(formatLootProvenance('cache')).toBe('Discovered cache');
  });
});

describe('SRD-1307: corpse interaction card', () => {
  it('shows the remains label, Search the Fallen, and the Take Spoils shortcut', () => {
    const prop = makeCorpseProp();
    const options = getAvailablePropInteractions(prop, makeHeroActor(5));
    expect(options.map((o) => o.interaction)).toEqual(['search']);
    expect(options[0]!.label).toBe('Search the Fallen');

    const onInteract = vi.fn();
    const onTakeLoot = vi.fn();
    render(
      <PropInteractionCard
        prop={prop}
        options={options}
        onInteract={onInteract}
        onClose={vi.fn()}
        onTakeLoot={onTakeLoot}
        resultNote="Keen Eye (Investigation): +12 gp searched from the fallen."
      />,
    );
    expect(screen.getByText('Remains of Goblin')).toBeDefined();
    expect(screen.getByTestId('prop-action-search-corpse-goblin-1').textContent).toContain(
      'Search the Fallen',
    );
    // Skill attribution renders with the inspect icon, not the listen ear.
    expect(screen.getByTestId('prop-listen-result-corpse-goblin-1').textContent).toContain('🔍');
    fireEvent.click(screen.getByTestId('prop-action-search-corpse-goblin-1'));
    expect(onInteract).toHaveBeenCalledWith('corpse-goblin-1', 'search');
    fireEvent.click(screen.getByTestId('prop-take-loot-corpse-goblin-1'));
    expect(onTakeLoot).toHaveBeenCalledWith('corpse-goblin-1');
  });

  it('offers no search once the fallen have been searched', () => {
    const prop = makeCorpseProp({ searched: true });
    expect(getAvailablePropInteractions(prop, makeHeroActor(5))).toEqual([]);
  });
});

describe('SRD-1307: per-corpse loot card (modal)', () => {
  function makeParty() {
    const hero = {
      id: 'hero-1',
      name: 'Valeros',
      characterSheet: {},
      buildState: {
        inventory: [],
        currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        equippedSlots: {},
        attunedItemInstanceIds: [],
      },
    };
    return { 'hero-1': hero } as unknown as Record<string, Combatant>;
  }

  it('shows provenance, grid cells, and claims into the recipient inventory', () => {
    const onClaimLoot = vi.fn();
    render(
      <LootInventoryModal
        isOpen={true}
        party={makeParty()}
        initialHeroId="hero-1"
        compendium={compendium}
        activeLoot={{
          sourcePropId: 'corpse-goblin-1',
          sourceName: 'Remains of Goblin',
          bundle: {
            gp: 12,
            items: ['acid-vial'],
            origin: 'monster_drop',
            sourceName: 'Goblin',
          },
        }}
        onClose={vi.fn()}
        onClaimLoot={onClaimLoot}
        onEquipItem={vi.fn()}
        onAttuneItem={vi.fn()}
        onUnattuneItem={vi.fn()}
      />,
    );

    expect(screen.getByTestId('discovered-loot-provenance').textContent).toContain(
      'Slain foe drop — Goblin',
    );
    expect(
      screen.getByTestId('discovered-loot-cell-discovered-acid-vial-0'),
    ).toBeDefined();
    // Provenance rides on the cell tooltip.
    expect(
      screen.getByTestId(
        'discovered-loot-cell-discovered-acid-vial-0-tooltip-acid-vial-provenance',
      ).textContent,
    ).toContain('Slain foe drop — Goblin');

    fireEvent.click(screen.getByTestId('claim-all-loot-btn'));
    expect(onClaimLoot).toHaveBeenCalledWith(
      'hero-1',
      'corpse-goblin-1',
      expect.objectContaining({ origin: 'monster_drop', gp: 12 }),
    );
  });
});
