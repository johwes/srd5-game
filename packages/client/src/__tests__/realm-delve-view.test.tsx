import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import { getBiomeForDepth, getBiomeTheme } from '@srd5/engine';
import { DungeonView } from '../components/dungeon/index.js';
import {
  createRealmSession,
  getPartyList,
  reduceRealm,
} from '../components/realm/realmEngine.js';

/**
 * SRD-806: Realm POI delve presentation — the DungeonView run loop mounted in
 * `realm_delve` mode for bounded dungeon delves and single-floor lair clears.
 */

function makeDelve(kind: 'dungeon_entrance' | 'monster_lair') {
  const session = createRealmSession({ seed: 806, width: 48, height: 48 });
  const poi = Object.values(session.map.pois).find((p) => p.kind === kind)!;
  const atPoi = {
    ...session,
    travel: { ...session.travel, partyPosition: { q: poi.q, r: poi.r } },
  };
  const result = reduceRealm(atPoi, { type: 'REALM_ENTER_POI', poiId: poi.id });
  return {
    poi,
    delve: result.delve!,
    gameState: result.delveGameState!,
    floor: result.delveFloor!,
    partyCharacters: getPartyList(session)
      .map((c) => c.buildState)
      .filter((c): c is NonNullable<typeof c> => Boolean(c)),
  };
}

describe('SRD-806: Realm delve view (DungeonView realm_delve mode)', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('mounts a bounded dungeon delve with the run-loop HUD at the POI depth tier', () => {
    const { delve, gameState, floor, partyCharacters } = makeDelve('dungeon_entrance');
    render(
      <DungeonView
        gameMode="realm_delve"
        partyCharacters={partyCharacters}
        initialGameState={gameState}
        initialDelveState={delve}
        initialFloorSpec={floor}
        compendium={defaultCompendium}
        onExitToRoster={vi.fn()}
        onDelveResolved={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
    const hud = screen.getByTestId('roguelite-hud-bar');
    expect(hud.textContent).toContain(`Depth ${delve.startDepth}`);
    const biome = getBiomeTheme(getBiomeForDepth(delve.startDepth));
    expect(hud.textContent).toContain(biome.name);
    expect(hud.textContent).toContain(`${delve.suppliesRemaining} Rations`);
    // Bounded delves carry a run score.
    expect(delve.score).toBeGreaterThan(0);
    cleanup();
  });

  it('mounts a single-floor lair clear with no run scoring', () => {
    const { delve, gameState, floor, partyCharacters } = makeDelve('monster_lair');
    render(
      <DungeonView
        gameMode="realm_delve"
        partyCharacters={partyCharacters}
        initialGameState={gameState}
        initialDelveState={delve}
        initialFloorSpec={floor}
        compendium={defaultCompendium}
        onExitToRoster={vi.fn()}
        onDelveResolved={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dungeon-view-container')).toBeDefined();
    const hud = screen.getByTestId('roguelite-hud-bar');
    expect(hud.textContent).toContain('0 pts');
    expect(delve.kind).toBe('lair_clear');
    expect(delve.finalDepth).toBe(delve.startDepth);
    cleanup();
  });
});