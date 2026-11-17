import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import {
  type GameState,
  computeDerivedCharacter,
  createCharacterCombatant,
  generateOverworldBattle,
  getOverworldTile,
  getSettlements,
  startOverworldBattle,
} from '@srd5/engine';
import { LocalTransport } from '@srd5/transport';
import type { DungeonStorageAdapter } from '../persistence/index.js';
import { RealmView } from '../components/realm/RealmView.js';
import { RealmBattleView } from '../components/realm/RealmBattleView.js';
import { RealmShopModal } from '../components/realm/RealmShopModal.js';
import {
  createRealmSession,
  getCurrentPoi,
  getPartyList,
  reduceRealm,
} from '../components/realm/realmEngine.js';

/**
 * SRD-805: Realm view + strategic settlement HUD integration tests.
 * Real engine sessions (no engine mocks); PixiJS runs headless via the
 * getContext stub, with camera math and DOM interactions fully exercised.
 */

const SEED = 805;

function makeMemoryAdapter(): { adapter: DungeonStorageAdapter; store: Record<string, unknown> } {
  const store: Record<string, unknown> = {};
  return {
    store,
    adapter: {
      async getItem(k) {
        return store[k];
      },
      async setItem(k, v) {
        store[k] = structuredClone(v);
      },
      async removeItem(k) {
        delete store[k];
      },
    },
  };
}

function renderRealmView(adapter?: DungeonStorageAdapter) {
  const { adapter: memAdapter } = makeMemoryAdapter();
  return render(
    <RealmView
      seed={SEED}
      compendium={defaultCompendium}
      storageAdapter={adapter ?? memAdapter}
      onExitToRoster={vi.fn()}
      onOpenCharacterSheet={vi.fn()}
    />,
  );
}

function mockCanvasRect(canvas: HTMLElement) {
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1280,
    height: 800,
    right: 1280,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
}

describe('SRD-805: Realm View & Strategic Settlement HUD', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the full-bleed overworld viewport with the strategic HUD', () => {
    const session = createRealmSession({ seed: SEED });
    renderRealmView();
    expect(screen.getByTestId('realm-view-container')).toBeDefined();
    expect(screen.getByTestId('realm-overworld-viewport')).toBeDefined();
    expect(screen.getByTestId('realm-hud-top-bar')).toBeDefined();
    expect(screen.getByTestId('realm-hud-world-name').textContent).toContain(
      session.map.worldName,
    );
    expect(screen.getByTestId('realm-hud-day-time').textContent).toContain('Day 1');
    expect(screen.getByTestId('realm-hud-gold').textContent).toContain('100');
    expect(screen.getByTestId('realm-hud-rations').textContent).toContain('10');
    expect(screen.getByTestId('realm-hud-party-strip').children.length).toBe(4);
    // Party starts at a settlement → location panel with services is visible.
    expect(screen.getByTestId('realm-hud-location-panel')).toBeDefined();
    expect(screen.getByTestId('realm-hud-quest-board-btn')).toBeDefined();
  });

  it('switches travel pace from the HUD', () => {
    renderRealmView();
    const fastBtn = screen.getByTestId('realm-hud-pace-fast');
    fireEvent.click(fastBtn);
    expect(fastBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('realm-hud-pace-normal').getAttribute('aria-pressed')).toBe('false');
    // Fast pace grants 8 movement points per day.
    expect(screen.getByTestId('realm-hud-travel-points').textContent).toContain('/8');
  });

  it('forages from the HUD, spending a movement point and logging the result', () => {
    renderRealmView();
    const before = screen.getByTestId('realm-hud-travel-points').textContent;
    fireEvent.click(screen.getByTestId('realm-hud-forage-btn'));
    expect(screen.getByTestId('realm-hud-travel-points').textContent).not.toBe(before);
    expect(screen.getByTestId('realm-hud-travel-log').textContent).toContain('Foraging');
  });

  it('camps via the camp modal: inn Long Rest advances the day for free', async () => {
    renderRealmView();
    fireEvent.click(screen.getByTestId('realm-hud-camp-btn'));
    expect(screen.getByTestId('realm-camp-short-rest-btn')).toBeDefined();
    // Starting settlement has an inn → safe rest messaging.
    fireEvent.click(screen.getByTestId('realm-camp-long-rest-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('realm-hud-day-time').textContent).toContain('Day 2');
    });
    expect(screen.getByTestId('realm-hud-rations').textContent).toContain('10');
    expect(screen.getByTestId('realm-hud-travel-log').textContent).toContain('Long rest');
  });

  it('spends hit dice during a short rest from the camp modal', async () => {
    renderRealmView();
    fireEvent.click(screen.getByTestId('realm-hud-camp-btn'));
    const session = createRealmSession({ seed: SEED });
    const heroId = session.partyOrder[0]!;
    fireEvent.click(screen.getByTestId(`realm-camp-hd-plus-${heroId}`));
    expect(screen.getByTestId(`realm-camp-hd-count-${heroId}`).textContent).toBe('1');
    fireEvent.click(screen.getByTestId('realm-camp-short-rest-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('realm-hud-travel-log').textContent).toContain('Short rest');
    });
  });

  it('accepts a quest from the settlement quest board and tracks it in the journal', async () => {
    const session = createRealmSession({ seed: SEED });
    const startPoi = getCurrentPoi(session)!;
    const boardQuest = session.questLog.quests.find((q) => q.boardPoiId === startPoi.id)!;
    expect(boardQuest).toBeDefined();

    renderRealmView();
    fireEvent.click(screen.getByTestId('realm-hud-quest-board-btn'));
    expect(screen.getByTestId(`realm-quest-card-${boardQuest.id}`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`realm-quest-accept-${boardQuest.id}`));
    expect(screen.getByTestId('realm-hud-journal-btn').textContent).toContain('(1)');

    // Journal shows the accepted quest under Active.
    fireEvent.click(screen.getByTestId('realm-hud-journal-btn'));
    expect(screen.getByTestId('realm-quest-active-list').textContent).toContain(boardQuest.title);
    fireEvent.click(screen.getByTestId(`realm-quest-abandon-${boardQuest.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('realm-hud-journal-btn').textContent).not.toContain('(1)');
    });
  });

  it('shows faction reputation standings in the factions modal', () => {
    const session = createRealmSession({ seed: SEED });
    renderRealmView();
    fireEvent.click(screen.getByTestId('realm-hud-factions-btn'));
    const list = screen.getByTestId('realm-factions-list');
    for (const faction of Object.values(session.map.factions)) {
      expect(screen.getByTestId(`realm-faction-card-${faction.id}`)).toBeDefined();
      expect(
        screen.getByTestId(`realm-faction-reputation-${faction.id}`).textContent,
      ).toBeDefined();
    }
    expect(list.children.length).toBe(Object.keys(session.map.factions).length);
    fireEvent.click(screen.getByTestId('realm-factions-close-btn'));
    expect(screen.queryByTestId('realm-factions-list')).toBeNull();
  });

  it('opens the pause menu with Escape and quick-saves / loads the realm', async () => {
    const { adapter, store } = makeMemoryAdapter();
    renderRealmView(adapter);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('realm-pause-modal')).toBeDefined();
    fireEvent.click(screen.getByTestId('realm-pause-save-btn'));
    await waitFor(() => {
      expect(store['srd5:realm-save:v1']).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('realm-pause-load-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('realm-hud-travel-log').textContent).toContain(
        'Loaded saved realm',
      );
    });
    // Loading closes the pause menu and returns to the map.
    expect(screen.queryByTestId('realm-pause-modal')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('realm-pause-modal')).toBeDefined();
    fireEvent.click(screen.getByTestId('realm-pause-resume-btn'));
    expect(screen.queryByTestId('realm-pause-modal')).toBeNull();
  });

  it('travels when a map tile is clicked (or seamlessly enters a wilderness battle)', () => {
    const session = createRealmSession({ seed: SEED });
    const { q, r } = session.travel.partyPosition;
    let destination: { q: number; r: number } | null = null;
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const tile = getOverworldTile(session.map, q + dq, r + dr);
      if (tile && tile.terrain !== 'ocean') {
        destination = { q: q + dq, r: r + dr };
        break;
      }
    }
    expect(destination).not.toBeNull();
    const expected = reduceRealm(session, { type: 'REALM_TRAVEL_TO', destination: destination! });

    renderRealmView();
    const canvas = screen.getByTestId('realm-overworld-viewport-canvas');
    mockCanvasRect(canvas);
    // Headless camera defaults: zoom 1, offset (0,0), cellSize 24.
    const x = destination!.q * 24 + 12;
    const y = destination!.r * 24 + 12;
    fireEvent.mouseDown(canvas, { clientX: x, clientY: y, button: 0 });
    fireEvent.mouseUp(canvas, { clientX: x, clientY: y, button: 0 });

    if (expected.battle) {
      // Seamless overworld-to-tactical transition.
      expect(screen.getByTestId('realm-battle-container')).toBeDefined();
      expect(screen.getByTestId('tactical-combat-hud')).toBeDefined();
    } else {
      expect(screen.getByTestId('realm-hud-travel-points').textContent).toContain(
        String(expected.session.travel.travelPointsRemaining),
      );
      expect(screen.getByTestId('realm-hud-travel-log').textContent).toContain('Marched');
    }
  });

  it('buys and sells gear through the settlement shop modal', () => {
    const session = createRealmSession({ seed: SEED });
    const shopPoi = getSettlements(session.map).find((p) => session.shops[p.id])!;
    const inventory = session.shops[shopPoi.id]!;
    const cheapItem = inventory.items.find((i) => i.quantity > 0 && i.basePriceGp <= 50)!;
    const onBuy = vi.fn();
    const onSell = vi.fn();

    render(
      <RealmShopModal
        isOpen
        onClose={vi.fn()}
        poi={shopPoi}
        inventory={inventory}
        session={session}
        reputation={0}
        onBuy={onBuy}
        onSell={onSell}
      />,
    );
    expect(screen.getByTestId('realm-shop-buy-list')).toBeDefined();
    const buyBtn = screen.getByTestId(`realm-shop-buy-${cheapItem.itemId}`);
    fireEvent.click(buyBtn);
    expect(onBuy).toHaveBeenCalledWith(cheapItem.itemId, 1, session.partyOrder[0]);

    // Sell tab lists party inventory.
    fireEvent.click(screen.getByTestId('realm-shop-tab-sell'));
    const hero = getPartyList(session)[0]!;
    const instance = hero.buildState!.inventory[0]!;
    fireEvent.click(screen.getByTestId(`realm-shop-sell-${instance.instanceId}`));
    expect(onSell).toHaveBeenCalledWith(hero.id, instance.instanceId);
  });

  describe('RealmBattleView (tactical transition)', () => {
    function makeBattleTransport() {
      const party = ['pregen-fighter', 'pregen-cleric'].map((id) => {
        const build = getPregenCharacter(id)!;
        const sheet = computeDerivedCharacter(build, defaultCompendium);
        return createCharacterCombatant(sheet, { x: 0, y: 0 }, {
          side: 'party',
          teamId: 'party',
          playerId: 'player-1',
          buildState: build,
        });
      });
      const battle = generateOverworldBattle({
        seed: 202,
        terrain: 'plains',
        partySize: 2,
      });
      const battleSession = startOverworldBattle({ battle, party });
      const transport = new LocalTransport({
        initialState: battleSession.gameState,
        defaultPlayerId: 'player-1',
      });
      return { transport, battle, gameState: battleSession.gameState };
    }

    it('renders the tactical combat HUD for a realm battle', () => {
      const { transport, battle } = makeBattleTransport();
      render(
        <RealmBattleView
          transport={transport}
          battle={battle}
          title="Wilderness Encounter"
          onBattleEnd={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-battle-container')).toBeDefined();
      expect(screen.getByTestId('tactical-combat-hud')).toBeDefined();
      expect(screen.getByTestId('combat-hud-title').textContent).toContain(
        'Wilderness Encounter',
      );
    });

    it('reports victory back to the realm when combat ends', async () => {
      const { transport, battle, gameState } = makeBattleTransport();
      const onBattleEnd = vi.fn();
      render(
        <RealmBattleView
          transport={transport}
          battle={battle}
          title="Wilderness Encounter"
          onBattleEnd={onBattleEnd}
        />,
      );
      const ended: GameState = structuredClone(gameState);
      for (const monster of Object.values(ended.monsters)) {
        monster.currentHp = 0;
        monster.isDead = true;
      }
      ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'party_victory' };
      transport.setAuthoritativeState(ended);
      await waitFor(() => {
        expect(onBattleEnd).toHaveBeenCalledWith('victory', expect.anything());
      });
    });

    it('reports defeat when the monsters win', async () => {
      const { transport, battle, gameState } = makeBattleTransport();
      const onBattleEnd = vi.fn();
      render(
        <RealmBattleView
          transport={transport}
          battle={battle}
          title="Lair Assault"
          onBattleEnd={onBattleEnd}
        />,
      );
      const ended: GameState = structuredClone(gameState);
      ended.combat = { ...ended.combat!, phase: 'combat_ended', outcome: 'monsters_victory' };
      transport.setAuthoritativeState(ended);
      await waitFor(() => {
        expect(onBattleEnd).toHaveBeenCalledWith('defeat', expect.anything());
      });
    });
  });
});
