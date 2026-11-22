import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  computeDerivedCharacter,
  createMonsterCombatant,
  hasClaimableLoot,
  rollCorpseLoot,
} from '@srd5/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../components/inventory/CharacterView.js';
import {
  LootInventoryModal,
  formatLootProvenance,
} from '../components/dungeon/LootInventoryModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const compendium = defaultCompendium;

function twoHeroes() {
  const fighter = structuredClone(getPregenCharacter('pregen-fighter')!);
  const wizard = structuredClone(getPregenCharacter('pregen-wizard')!);
  // Controlled equippable extra so the equip leg never depends on pregen loadout.
  fighter.inventory.push({ instanceId: 'gate-dagger', itemId: 'dagger', quantity: 1 });
  return [fighter, wizard] as const;
}

/** Loot modal party shape (buildState-backed, mirroring DungeonView). */
function lootPartyFor(heroes: ReturnType<typeof twoHeroes>) {
  return Object.fromEntries(
    heroes.map((h) => [
      h.id,
      {
        id: h.id,
        name: h.name,
        characterSheet: {},
        buildState: {
          inventory: h.inventory,
          currency: h.currency,
          equippedSlots: h.equippedSlots,
          attunedItemInstanceIds: h.attunedItemInstanceIds,
        },
      },
    ]),
  ) as unknown as Record<string, never>;
}

function baseViewProps(list = [...twoHeroes()]) {
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

describe('SRD-1506: Flow verification gate (kill → Take → equip → party move)', () => {
  it('kill leg: slain goblin rolls a deterministic monster_drop bundle (no Math.random)', () => {
    const data = compendium.requireMonster('goblin');
    const dead = createMonsterCombatant(data, 'goblin-1', { x: 4, y: 4 });
    dead.isDead = true;
    dead.currentHp = 0;
    const first = rollCorpseLoot(dead, 999, compendium);
    const second = rollCorpseLoot(dead, 999, compendium);
    expect(first.loot).toEqual(second.loot);
    expect(first.nextRng).toBe(second.nextRng);
    expect(hasClaimableLoot(first.loot)).toBe(true);
    expect(first.loot.origin).toBe('monster_drop');
    expect(first.loot.sourceName).toBe(dead.name);
    expect(formatLootProvenance(first.loot.origin!, first.loot.sourceName)).toContain(
      'Slain foe drop',
    );
  });

  it('loot-box Take leg: Claim All dispatches provenance-tagged CLAIM_LOOT and engine state re-renders it into the hero grid', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [fighter, wizard] = twoHeroes();
    const bundle = { gp: 12, items: ['acid-vial'], origin: 'monster_drop', sourceName: 'Goblin' };
    const onClaimLoot = vi.fn();

    render(
      <LootInventoryModal
        isOpen
        party={lootPartyFor([fighter, wizard])}
        initialHeroId={fighter.id}
        compendium={compendium}
        activeLoot={{
          sourcePropId: 'corpse-goblin-1',
          sourceName: 'Remains of Goblin',
          bundle,
        }}
        onClose={vi.fn()}
        onClaimLoot={onClaimLoot}
        onEquipItem={vi.fn()}
        onAttuneItem={vi.fn()}
        onUnattuneItem={vi.fn()}
      />,
    );

    // Provenance attribution rides the slain-foe path (never war-award/cached).
    expect(screen.getByTestId('discovered-loot-provenance').textContent).toContain(
      'Slain foe drop — Goblin',
    );
    fireEvent.click(screen.getByTestId('claim-all-loot-btn'));
    expect(onClaimLoot).toHaveBeenCalledWith(fighter.id, 'corpse-goblin-1', bundle);

    // Simulate the authoritative CLAIM_LOOT result: item + gold land on the hero.
    cleanup();
    const nextFighter = {
      ...fighter,
      inventory: [...fighter.inventory, { instanceId: 'loot-acid-vial-0', itemId: 'acid-vial', quantity: 1 }],
      currency: { ...(fighter.currency ?? {}), gp: (fighter.currency?.gp ?? 0) + 12 },
    };
    const props = baseViewProps([nextFighter, wizard]);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${nextFighter.id}`;
    expect(screen.getByTestId(`${prefix}-cell-loot-acid-vial-0`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-currency`).textContent).toContain(
      `${nextFighter.currency?.gp} gp`,
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('Character-view equip leg: double-click equips from the grid and engine state re-renders the paperdoll + weapon card math', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [fighter, wizard] = twoHeroes();
    const props = baseViewProps([fighter, wizard]);
    const { rerender } = render(<CharacterView {...props} />);
    const prefix = `character-view-${fighter.id}`;

    // Double-click the Gate dagger → EQUIP dispatches into the suggested slot.
    fireEvent.doubleClick(screen.getByTestId(`${prefix}-cell-gate-dagger`));
    expect(props.onEquipItem).toHaveBeenCalledWith(fighter.id, 'mainHand', 'gate-dagger');

    // Simulate the authoritative EQUIP_LOADOUT result and re-render from engine state.
    const nextFighter = {
      ...fighter,
      equippedSlots: { ...fighter.equippedSlots, mainHandInstanceId: 'gate-dagger' },
    };
    rerender(<CharacterView {...props} heroes={[nextFighter, wizard]} activeHeroId={nextFighter.id} />);
    const derived = computeDerivedCharacter(nextFighter, compendium);
    const melee =
      derived.weaponAttacks.find((a) => a.rangeType === 'melee') ?? derived.weaponAttacks[0];
    expect(melee).toBeDefined();
    expect(screen.getByTestId(`${prefix}-weapon-melee-name`).textContent).toContain(melee!.name);
    expect(screen.getByTestId(`${prefix}-weapon-melee-tohit`).textContent).toContain(
      melee!.toHitBonus >= 0 ? `+${melee!.toHitBonus}` : `${melee!.toHitBonus}`,
    );
    expect(screen.getByTestId(`${prefix}-weapon-melee-damage`).textContent).toContain(
      melee!.damageFormula,
    );
    // Paperdoll slot stays a focusable button (Deck parity) after the equip.
    expect(screen.getByTestId(`${prefix}-paperdoll-slot-mainHand`).tagName).toBe('BUTTON');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('party-strip move leg: Send-to-hero transfers via TRANSFER_ITEM and both grids re-render from engine state', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [fighter, wizard] = twoHeroes();
    const props = baseViewProps([fighter, wizard]);
    const { rerender } = render(<CharacterView {...props} initialMode="party" />);

    const from = fighter;
    const to = wizard;
    const moving = from.inventory.find((i) => i.instanceId === 'gate-dagger')!;
    const fromCell = `character-view-party-card-${from.id}-cell-${moving.instanceId}`;
    expect(screen.getByTestId(fromCell).tagName).toBe('BUTTON');
    fireEvent.click(screen.getByTestId(fromCell));
    const sendBtn = screen.getByTestId(
      `character-view-party-send-${from.id}-to-${to.id}-${moving.instanceId}`,
    );
    expect(sendBtn.tagName).toBe('BUTTON');
    fireEvent.click(sendBtn);
    expect(props.onTransferItem).toHaveBeenCalledWith(from.id, moving.instanceId, to.id);

    // Simulate the authoritative TRANSFER_ITEM result and re-render from engine state.
    const nextFrom = {
      ...from,
      inventory: from.inventory.filter((i) => i.instanceId !== moving.instanceId),
    };
    const nextTo = { ...to, inventory: [...to.inventory, { ...moving }] };
    rerender(
      <CharacterView {...props} heroes={[nextFrom, nextTo]} activeHeroId={nextFrom.id} />,
    );
    expect(
      document.querySelector(
        `[data-testid="character-view-party-card-${from.id}-cell-${moving.instanceId}"]`,
      ),
    ).toBeNull();
    expect(
      screen.getByTestId(`character-view-party-card-${to.id}-cell-${moving.instanceId}`),
    ).toBeDefined();
    // Per-hero + party-total gold still render from engine state after the move.
    const expectedTotal = [nextFrom, nextTo].reduce((s, h) => s + (h.currency?.gp ?? 0), 0);
    expect(screen.getByTestId('character-view-header-party-gold').textContent).toContain(
      `${expectedTotal} gp`,
    );
    expect(screen.getByTestId(`character-view-party-card-${to.id}-gold`).textContent).toContain(
      `${nextTo.currency?.gp ?? 0} gp`,
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('gate invariants: dialog semantics, rail tabs, sort, context menu, Esc, overflow guards, zero console errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [fighter, wizard] = twoHeroes();
    const props = baseViewProps([fighter, wizard]);
    render(<CharacterView {...props} />);
    const prefix = `character-view-${fighter.id}`;

    // Dialog semantics for the fullscreen shell.
    const dialog = screen.getByTestId('character-view');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Overflow guards: bounded panel + scrollable panes (pixel overflow asserted at 1280×800 in e2e).
    expect(screen.getByTestId('character-view-panel').className).toMatch(/max-h-\[92vh\]/);
    expect(screen.getByTestId('character-view-panel').className).toMatch(/overflow-hidden/);
    expect(screen.getByTestId('character-view-inventory-pane').className).toMatch(/overflow-y-auto/);
    expect(screen.getByTestId('character-view-rail').className).toMatch(/overflow-y-auto/);

    // Stats rail: Build / Skills / Attributes tabs are keyboard-focusable buttons.
    for (const tab of ['build', 'skills', 'attributes'] as const) {
      const btn = screen.getByTestId(`character-view-rail-tab-${tab}`);
      expect(btn.tagName).toBe('BUTTON');
      fireEvent.click(btn);
      expect(screen.getByTestId(`character-view-rail-panel-${tab}`)).toBeDefined();
    }
    // Skills tab lists all 18 skills; attributes tab lists all 6 abilities.
    fireEvent.click(screen.getByTestId('character-view-rail-tab-skills'));
    expect(screen.getByTestId('character-view-rail-skill-perception')).toBeDefined();
    fireEvent.click(screen.getByTestId('character-view-rail-tab-attributes'));
    expect(screen.getByTestId('character-view-rail-ability-str')).toBeDefined();

    // Back to the backpack: sort control is a native select with all five keys.
    const sort = screen.getByTestId(`${prefix}-sort`);
    expect(sort.tagName).toBe('SELECT');
    expect(
      within(sort as HTMLSelectElement)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(['newest', 'name', 'type', 'value', 'weight']);

    // Doll + weapon cards + weight bar surfaces (screenshot anchors for the e2e).
    expect(screen.getByTestId('character-view-doll')).toBeDefined();
    expect(screen.getByTestId(`${prefix}-weapon-melee`)).toBeDefined();
    expect(screen.getByTestId(`${prefix}-weight-bar`).getAttribute('role')).toBe('progressbar');

    // Context menu opens on right-click, dispatches, and Esc dismisses it without closing the view.
    fireEvent.contextMenu(screen.getByTestId(`${prefix}-cell-gate-dagger`));
    expect(screen.getByTestId(`${prefix}-ctx-menu-gate-dagger`).getAttribute('role')).toBe('menu');
    for (const item of within(screen.getByTestId(`${prefix}-ctx-menu-gate-dagger`)).getAllByRole('menuitem')) {
      expect(item.tagName).toBe('BUTTON');
    }
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId(`${prefix}-ctx-menu-gate-dagger`)).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();

    // Party strip surface anchor: toggle modes and confirm the strip renders.
    fireEvent.click(screen.getByTestId('character-view-mode-party'));
    expect(screen.getByTestId('character-view-party-strip')).toBeDefined();
    for (const h of [fighter, wizard]) {
      expect(screen.getByTestId(`character-view-party-card-${h.id}-grid`)).toBeDefined();
    }

    // Esc with no menu open closes the fullscreen view.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
