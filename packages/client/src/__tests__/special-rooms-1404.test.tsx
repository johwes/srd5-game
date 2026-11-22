import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  generateDungeonFloor,
  getAvailablePropInteractions,
  reduceGame,
  type DungeonFloorSpec,
} from '@srd5/engine';
import { PropInteractionCard } from '../components/dungeon/PropInteractionCard.js';
import { ShrineModal } from '../components/dungeon/ShrineModal.js';
import { DungeonView } from '../components/dungeon/index.js';
import {
  buildDungeonSession,
  getDefaultDungeonPartyCharacters,
} from '../components/dungeon/dungeonEngine.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Headless probe: first depth-2 vault floor the lead pregens can pick.
 *
 * Two setup fixes, both documented: `buildDungeonSession` starts every
 * session from a fixed default RNG (the floor's `nextRngState` is only
 * threaded by the roguelite runner), so the probe fixes `rngState` to a value
 * that succeeds the pick — the UI test then exercises the real card flow.
 * The vault room's own encounter is pre-marked triggered (as if the party
 * already cleared the room) so the interaction doesn't detour into combat.
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
        // Pick failed — try the next RNG state.
      }
    }
  }
  throw new Error('no pickable vault floor in seeds 1..400');
}

/** First depth-2 seed whose floor carries a cursed shrine. */
function findCursedShrineFloor(): DungeonFloorSpec {
  for (let seed = 1; seed <= 400; seed++) {
    const gen = generateDungeonFloor({ depth: 2, seed, width: 36, height: 36, targetRoomCount: 5 });
    if (gen.floor.props.some((p) => p.shrineType === 'shrine_cursed')) return gen.floor;
  }
  throw new Error('no cursed shrine floor in seeds 1..400');
}

/**
 * SRD-1404 client coverage: special-room card flows reuse the prop pipeline
 * (no new art). The vault chest card shows lock DC + trap warnings; the
 * cursed shrine modal shows costs before commit with hp/gp/decline options.
 */

const vaultChest = {
  id: 'vault_chest_2',
  x: 10,
  y: 10,
  kind: 'chest' as const,
  state: 'locked' as const,
  blocksMovement: false,
  blocksSight: false,
  lockDc: 17,
  detectionDc: 13,
  disarmDc: 13,
  trapDamageFormula: '1d8',
  trapDamageType: 'poison' as const,
  trapSaveDc: 13,
  trapSaveAbility: 'con' as const,
  trapHalfDamageOnSave: true,
  lootTable: { gp: 140, items: ['bag-of-holding', 'potion-of-healing'], origin: 'cache' },
};

const rogueActor = {
  id: 'rogue-1',
  position: { x: 11, y: 10 },
} as never;

describe('SRD-1404: Special-room card flows', () => {
  it('vault chest card offers Pick Lock / Force with DC hints and a trap warning', () => {
    const options = getAvailablePropInteractions(vaultChest, rogueActor);
    expect(options.map((o) => o.interaction)).toEqual(
      expect.arrayContaining(['pick_lock', 'force_open', 'search']),
    );
    expect(options.find((o) => o.interaction === 'pick_lock')?.checkHint).toMatch(/DC 17/);
    expect(options.find((o) => o.interaction === 'pick_lock')?.riskHint).toMatch(/trap/i);

    const onInteract = vi.fn();
    render(
      <PropInteractionCard
        prop={vaultChest}
        options={options}
        onInteract={onInteract}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('prop-card-vault_chest_2')).toBeDefined();
    // Both locked-chest actions warn about the suspected trap.
    expect(screen.getAllByText(/May be trapped/i).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTestId('prop-action-pick_lock-vault_chest_2'));
    expect(onInteract).toHaveBeenCalledWith('vault_chest_2', 'pick_lock');
  });

  it('cursed shrine card routes Use Shrine to the offering modal', () => {
    const shrine = {
      id: 'cursed_shrine_2',
      x: 5,
      y: 5,
      kind: 'shrine' as const,
      shrineType: 'shrine_cursed',
      state: 'closed' as const,
      blocksMovement: false,
      blocksSight: false,
    };
    const options = getAvailablePropInteractions(shrine, rogueActor);
    expect(options).toEqual([{ interaction: 'open', label: 'Use Shrine' }]);

    const onUseShrine = vi.fn();
    const onInteract = vi.fn();
    render(
      <PropInteractionCard
        prop={shrine}
        options={options}
        onInteract={onInteract}
        onClose={() => {}}
        onUseShrine={onUseShrine}
      />,
    );
    fireEvent.click(screen.getByTestId('prop-action-open-cursed_shrine_2'));
    expect(onUseShrine).toHaveBeenCalledWith('cursed_shrine_2');
    expect(onInteract).not.toHaveBeenCalled();
  });

  it('cursed shrine modal shows costs before commit with hp/gp/decline options', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <ShrineModal
        isOpen={true}
        shrine={{
          id: 'cursed_shrine_2',
          x: 5,
          y: 5,
          kind: 'shrine',
          shrineType: 'shrine_cursed',
          state: 'closed',
          blocksMovement: false,
          blocksSight: false,
        }}
        actorName="Valeros the Fighter"
        onClose={onClose}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByText(/Cursed Shrine/i)).toBeDefined();
    expect(screen.getByText(/Pay 10 HP or 50 gp/i)).toBeDefined();
    expect(screen.getByText(/Declining is free/i)).toBeDefined();

    fireEvent.click(screen.getByTestId('shrine-offer-hp-button'));
    expect(onActivate).toHaveBeenCalledWith('cursed_shrine_2', 'hp');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('shrine-offer-gp-button'));
    expect(onActivate).toHaveBeenCalledWith('cursed_shrine_2', 'gp');

    fireEvent.click(screen.getByTestId('shrine-decline-button'));
    expect(onActivate).toHaveBeenCalledWith('cursed_shrine_2', 'decline');
    // Legacy single-action button is not rendered for cursed shrines.
    expect(screen.queryByTestId('shrine-activate-button')).toBeNull();
  });

  it('used cursed shrine renders dormant with no offering buttons', () => {
    render(
      <ShrineModal
        isOpen={true}
        shrine={{
          id: 'cursed_shrine_2',
          x: 5,
          y: 5,
          kind: 'shrine',
          shrineType: 'shrine_cursed',
          state: 'open',
          blocksMovement: false,
          blocksSight: false,
        }}
        actorName="Valeros the Fighter"
        onClose={() => {}}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText(/already been invoked/i)).toBeDefined();
    expect(screen.queryByTestId('shrine-offer-hp-button')).toBeNull();
    expect(screen.queryByTestId('shrine-offer-gp-button')).toBeNull();
    expect(screen.queryByTestId('shrine-decline-button')).toBeNull();
  });

  it('opens the vault through the card in DungeonView and shells the hoard in loot', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    const { floor, rngState } = findPickableVaultFloor();
    const { initialState } = buildDungeonSession(
      floor,
      getDefaultDungeonPartyCharacters(),
      defaultCompendium,
    );
    const next = structuredClone(initialState);
    const leadId = Object.keys(next.party)[0]!;
    const chest = next.props.find((p) => p.id === 'vault_chest_2')!;
    next.party[leadId] = { ...next.party[leadId]!, position: { x: chest.x + 1, y: chest.y } };
    // As if the party already cleared the vault room: opening the vault
    // must not detour into the room's own encounter mid-flow.
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

    // Proximity indicator row, then the state-gated card.
    expect(screen.getByTestId('adjacent-prop-row-vault_chest_2')).toBeDefined();
    fireEvent.click(screen.getByTestId('inspect-prop-btn-vault_chest_2'));
    expect(screen.getByTestId('prop-card-vault_chest_2')).toBeDefined();
    expect(screen.getByTestId('prop-action-pick_lock-vault_chest_2')).toBeDefined();

    // Pick the vault lock through the card; the card stays open on the result.
    fireEvent.click(screen.getByTestId('prop-action-pick_lock-vault_chest_2'));
    expect(await screen.findByTestId('prop-action-open-vault_chest_2')).toBeDefined();

    // Open the vault: the hoard shells in the loot modal with provenance.
    fireEvent.click(screen.getByTestId('prop-action-open-vault_chest_2'));
    // SRD-1510: chest opens into the anchored loot box first (battlefield
    // stays visible); Manage opens the fullscreen modal for full management.
    expect(await screen.findByTestId('anchored-loot-box')).toBeDefined();
    fireEvent.click(screen.getByTestId('anchored-loot-manage-btn'));
    expect(await screen.findByTestId('tab-discovered-loot-btn')).toBeDefined();
    fireEvent.click(screen.getByTestId('tab-discovered-loot-btn'));
    const provenance = await screen.findByTestId('discovered-loot-provenance');
    expect(provenance.textContent).toMatch(/vault|cache/i);
  });

  it('opens the cursed shrine offering modal from the card in DungeonView', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    const floor = findCursedShrineFloor();
    const { initialState } = buildDungeonSession(
      floor,
      getDefaultDungeonPartyCharacters(),
      defaultCompendium,
    );
    const next = structuredClone(initialState);
    const leadId = Object.keys(next.party)[0]!;
    const shrine = next.props.find((p) => p.shrineType === 'shrine_cursed')!;
    next.party[leadId] = { ...next.party[leadId]!, position: { x: shrine.x + 1, y: shrine.y } };

    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId={floor.id}
        initialGameState={next}
        onExitToRoster={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId(`inspect-prop-btn-${shrine.id}`));
    expect(screen.getByTestId(`prop-card-${shrine.id}`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`prop-action-open-${shrine.id}`));

    // The card routes shrines to the offering modal with costs before commit.
    expect(await screen.findByTestId('shrine-modal')).toBeDefined();
    expect(screen.getByText(/Pay 10 HP or 50 gp/i)).toBeDefined();
    expect(screen.getByTestId('shrine-offer-hp-button')).toBeDefined();
    expect(screen.getByTestId('shrine-offer-gp-button')).toBeDefined();
    expect(screen.getByTestId('shrine-decline-button')).toBeDefined();
  });
});
