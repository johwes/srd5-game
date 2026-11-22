import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  generateDungeonFloor,
  reduceGame,
  type DungeonFloorSpec,
} from '@srd5/engine';
import { DungeonView } from '../components/dungeon/index.js';
import {
  buildDungeonSession,
  getDefaultDungeonPartyCharacters,
} from '../components/dungeon/dungeonEngine.js';
import {
  AnchoredLootBoxPanel,
  clampLootBoxPosition,
} from '../components/dungeon/AnchoredLootBoxPanel.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;
const heroes = [
  { id: 'hero-1', name: 'Valeros' },
  { id: 'hero-2', name: 'Merisiel' },
];

function baseProps(overrides = {}) {
  return {
    loot: {
      sourcePropId: 'corpse-goblin-1',
      sourceName: 'Remains of Goblin',
      bundle: {
        gp: 12,
        items: ['acid-vial', 'dagger'],
        origin: 'monster_drop',
        sourceName: 'Goblin',
      },
    },
    compendium,
    partyHeroes: heroes,
    selectedHeroId: 'hero-1',
    onSelectHero: vi.fn(),
    anchor: { x: 400, y: 300 },
    viewportWidth: 1280,
    viewportHeight: 800,
    onClaimItem: vi.fn(),
    onClaimGold: vi.fn(),
    onClaimAll: vi.fn(),
    onManage: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('SRD-1510: clampLootBoxPosition (viewport clamping)', () => {
  it('offsets down-right of the container projection', () => {
    const pos = clampLootBoxPosition({ x: 400, y: 300 }, 1280, 800);
    expect(pos.left).toBe(416);
    expect(pos.top).toBe(316);
  });

  it('clamps a bottom-right anchor inside the 1280x800 viewport', () => {
    const pos = clampLootBoxPosition({ x: 1200, y: 750 }, 1280, 800);
    expect(pos.left).toBeLessThanOrEqual(1280 - 320 - 12);
    expect(pos.top).toBeLessThanOrEqual(800 - 380 - 12);
    expect(pos.left).toBeGreaterThanOrEqual(12);
    expect(pos.top).toBeGreaterThanOrEqual(12);
  });

  it('clamps a negative anchor to the margin', () => {
    const pos = clampLootBoxPosition({ x: -50, y: -50 }, 1280, 800);
    expect(pos.left).toBe(12);
    expect(pos.top).toBe(12);
  });

  it('centers a null anchor', () => {
    const pos = clampLootBoxPosition(null, 1280, 800);
    expect(pos.left).toBe((1280 - 320) / 2);
    expect(pos.top).toBe(800 - 380 - 96);
  });
});

describe('SRD-1510: anchored loot box panel (first-touch surface)', () => {
  it('renders anchored at the container with grid, gold pile, and Take All (no modal chrome)', () => {
    const props = baseProps();
    render(<AnchoredLootBoxPanel {...props} />);
    const box = screen.getByTestId('anchored-loot-box');
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.style.left).toBe('416px');
    expect(box.style.top).toBe('316px');
    // No fullscreen fixed backdrop: absolute overlay, battlefield visible.
    expect(box.className).toContain('absolute');
    expect(box.className).not.toContain('fixed');
    expect(screen.getByTestId('anchored-loot-title').textContent).toContain(
      'Remains of Goblin',
    );
    expect(screen.getByTestId('anchored-loot-provenance').textContent).toContain(
      'Slain foe drop — Goblin',
    );
    expect(screen.getByTestId('anchored-loot-grid')).toBeDefined();
    expect(screen.getByTestId('anchored-loot-gold-pile').textContent).toContain('12 gp');
    expect(
      screen.getByTestId('anchored-loot-cell-anchored-acid-vial-0'),
    ).toBeDefined();
    expect(
      screen.getByTestId('anchored-loot-cell-anchored-dagger-1'),
    ).toBeDefined();
    expect(screen.getByTestId('anchored-loot-take-all-btn')).toBeDefined();
    expect(screen.getByTestId('anchored-loot-manage-btn')).toBeDefined();
  });

  it('click-item-to-take fires the same CLAIM_LOOT paths (item, gold, Take All)', () => {
    const props = baseProps();
    render(<AnchoredLootBoxPanel {...props} />);
    fireEvent.click(screen.getByTestId('anchored-loot-cell-anchored-dagger-1'));
    expect(props.onClaimItem).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('anchored-loot-gold-pile'));
    expect(props.onClaimGold).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('anchored-loot-take-all-btn'));
    expect(props.onClaimAll).toHaveBeenCalledTimes(1);
    expect(props.onManage).not.toHaveBeenCalled();
  });

  it('Manage opens the full modal path and close/Esc dismisses the box', () => {
    const props = baseProps();
    render(<AnchoredLootBoxPanel {...props} />);
    fireEvent.click(screen.getByTestId('anchored-loot-manage-btn'));
    expect(props.onManage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('anchored-loot-close-btn'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('recipient select switches heroes', () => {
    const props = baseProps();
    render(<AnchoredLootBoxPanel {...props} />);
    const select = screen.getByTestId('anchored-loot-recipient-select');
    fireEvent.change(select, { target: { value: 'hero-2' } });
    expect(props.onSelectHero).toHaveBeenCalledWith('hero-2');
  });

  it('empty bundles render the claimed state with no Take All (Take All clears it)', () => {
    const props = baseProps({
      loot: {
        sourcePropId: 'corpse-goblin-1',
        sourceName: 'Remains of Goblin',
        bundle: { gp: 0, items: [] },
      },
    });
    render(<AnchoredLootBoxPanel {...props} />);
    expect(screen.getByTestId('anchored-loot-empty').textContent).toContain('Empty');
    expect(screen.queryByTestId('anchored-loot-take-all-btn')).toBeNull();
    expect(screen.queryByTestId('anchored-loot-gold-pile')).toBeNull();
    // Manage stays so the player can still inspect full inventory.
    expect(screen.getByTestId('anchored-loot-manage-btn')).toBeDefined();
  });

  it('clamps style position for a bottom-right anchor (viewport-clamped)', () => {
    const props = baseProps({ anchor: { x: 1200, y: 750 } });
    render(<AnchoredLootBoxPanel {...props} />);
    const box = screen.getByTestId('anchored-loot-box');
    expect(parseFloat(box.style.left)).toBeLessThanOrEqual(1280 - 320 - 12);
    expect(parseFloat(box.style.top)).toBeLessThanOrEqual(800 - 380 - 12);
  });
});

/**
 * Headless probe: first depth-2 vault floor the lead pregens can pick.
 * Mirrors special-rooms-1404: `buildDungeonSession` starts from a fixed
 * default RNG, so the probe fixes `rngState` to a value that succeeds the
 * pick; the vault room encounter is pre-marked triggered so opening never
 * detours into combat.
 */
function findPickableVaultFloor(): { floor: DungeonFloorSpec; rngState: number } {
  for (let seed = 1; seed <= 400; seed++) {
    const gen = generateDungeonFloor({ depth: 2, seed, width: 36, height: 36, targetRoomCount: 5 });
    if (!gen.floor.rooms?.some((r) => r.specialRoom === 'vault')) continue;
    const chest = gen.floor.props.find((p) => p.id === 'vault_chest_2');
    if (!chest) continue;
    const { initialState } = buildDungeonSession(
      gen.floor,
      getDefaultDungeonPartyCharacters(),
      defaultCompendium,
    );
    const base = structuredClone(initialState);
    const leadId = Object.keys(base.party)[0]!;
    base.party[leadId] = { ...base.party[leadId]!, position: { x: chest.x + 1, y: chest.y } };
    for (let rngCandidate = 1; rngCandidate <= 2000; rngCandidate++) {
      const next = structuredClone(base);
      next.rngState = rngCandidate;
      try {
        const res = reduceGame(next, {
          type: 'INTERACT_PROP',
          actorId: leadId,
          propId: chest.id,
          interaction: 'pick_lock',
        });
        if (res.nextState.props.find((p) => p.id === chest.id)?.state === 'closed') {
          return { floor: gen.floor, rngState: rngCandidate };
        }
      } catch {
        // Wrong DC/roll for this candidate; keep probing.
      }
    }
  }
  throw new Error('no pickable vault floor found in probe range');
}

// Probe once per file: the seed scan is the slowest part of the flow.
let cachedVaultSetup: { floor: DungeonFloorSpec; rngState: number } | null = null;
function getVaultSetup(): { floor: DungeonFloorSpec; rngState: number } {
  if (!cachedVaultSetup) cachedVaultSetup = findPickableVaultFloor();
  return cachedVaultSetup;
}

function renderVaultSession() {
  const { floor, rngState } = getVaultSetup();
  const { initialState } = buildDungeonSession(
    floor,
    getDefaultDungeonPartyCharacters(),
    defaultCompendium,
  );
  const next = structuredClone(initialState);
  const leadId = Object.keys(next.party)[0]!;
  const chest = next.props.find((p) => p.id === 'vault_chest_2')!;
  next.party[leadId] = { ...next.party[leadId]!, position: { x: chest.x + 1, y: chest.y } };
  const vaultRoomId = floor.rooms?.find((r) => r.specialRoom === 'vault')?.id;
  if (next.dungeon && vaultRoomId) {
    next.dungeon.encounters = next.dungeon.encounters.map((e) =>
      e.roomId === vaultRoomId ? { ...e, triggered: true } : e,
    );
  }
  next.rngState = rngState;
  render(
    <DungeonView
      partyCharacters={getDefaultDungeonPartyCharacters()}
      compendium={defaultCompendium}
      initialFloorId={floor.id}
      initialGameState={next}
      onExitToRoster={() => {}}
    />,
  );
}

async function openVaultAnchoredBox() {
  fireEvent.click(screen.getByTestId('inspect-prop-btn-vault_chest_2'));
  expect(screen.getByTestId('prop-card-vault_chest_2')).toBeDefined();
  fireEvent.click(screen.getByTestId('prop-action-pick_lock-vault_chest_2'));
  expect(await screen.findByTestId('prop-action-open-vault_chest_2')).toBeDefined();
  fireEvent.click(screen.getByTestId('prop-action-open-vault_chest_2'));
  return screen.findByTestId('anchored-loot-box');
}

describe('SRD-1510: anchored loot box in DungeonView (vault flow)', () => {
  it('opens anchored at the chest with the battlefield visible (no fullscreen modal)', async () => {
    renderVaultSession();
    await openVaultAnchoredBox();
    // Battlefield stays visible: canvas container present, fullscreen loot
    // modal chrome absent.
    expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
    expect(screen.queryByTestId('loot-inventory-title')).toBeNull();
    expect(screen.queryByTestId('tab-discovered-loot-btn')).toBeNull();
    expect(screen.getByTestId('anchored-loot-provenance').textContent).toMatch(
      /vault|cache/i,
    );
    expect(screen.getByTestId('anchored-loot-grid')).toBeDefined();
    expect(screen.getByTestId('anchored-loot-take-all-btn')).toBeDefined();
    expect(screen.getByTestId('anchored-loot-manage-btn')).toBeDefined();
  });

  it('Take All claims inline and clears the box (auto-dismiss on empty)', async () => {
    renderVaultSession();
    await openVaultAnchoredBox();
    fireEvent.click(screen.getByTestId('anchored-loot-take-all-btn'));
    await waitFor(() => expect(screen.queryByTestId('anchored-loot-box')).toBeNull());
    // Full management surface never opened along the way.
    expect(screen.queryByTestId('tab-discovered-loot-btn')).toBeNull();
  });

  it('Manage opens the fullscreen modal for full management', async () => {
    renderVaultSession();
    await openVaultAnchoredBox();
    fireEvent.click(screen.getByTestId('anchored-loot-manage-btn'));
    expect(await screen.findByTestId('tab-discovered-loot-btn')).toBeDefined();
    fireEvent.click(screen.getByTestId('tab-discovered-loot-btn'));
    expect(screen.getByTestId('discovered-loot-provenance').textContent).toMatch(
      /vault|cache/i,
    );
  });

  it('Esc dismisses the anchored box without opening the modal', async () => {
    renderVaultSession();
    await openVaultAnchoredBox();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('anchored-loot-box')).toBeNull());
    expect(screen.queryByTestId('tab-discovered-loot-btn')).toBeNull();
  });
});
