import { describe, expect, it } from 'vitest';
import {
  defaultCompendium,
  getCampaignFloor,
  getPregenCharacter,
  getSunkenCryptModule,
} from '@srd5/data';
import { startRogueliteRun } from '@srd5/engine';
import {
  buildArenaPveEncounter,
  buildArenaPvpEncounter,
} from '../components/arena/arenaEngine.js';
import type { ArenaConfig } from '../components/arena/types.js';
import {
  buildDungeonSession,
  buildRogueliteSession,
} from '../components/dungeon/dungeonEngine.js';
import { createRealmSession } from '../components/realm/realmBootstrap.js';
import { createMultiplayerInitialState } from '../multiplayer/lobbyState.js';

/**
 * Gate regression test: party-side combatants must carry their
 * `CharacterBuildState` (inventory, equipped slots, currency, attunement).
 *
 * Background: `DerivedCharacterSheet` carries no inventory, and the engine
 * reducer silently no-ops every inventory command (`EQUIP_LOADOUT`,
 * `ATTUNE_ITEM`, `TRANSFER_ITEM`, `DROP_ITEM`, `SPLIT_ITEM_STACK`,
 * `IDENTIFY_ITEM`, `SELL_ITEM`, `CLAIM_LOOT`) when `hero.buildState` is
 * missing. The loot/inventory UI reads `buildState?.inventory ??
 * sheet?.inventory`, so a factory that forgets `buildState` presents an
 * empty backpack and a dead action bar with zero errors — exactly the
 * SRD-1305 E2E failure this guards against.
 *
 * Every production session factory is covered: dungeon, roguelite
 * (client + engine), arena PvE + PvP, realm bootstrap, multiplayer lobby.
 * Where the UI consumes a Fog-of-War projection, the assertion runs against
 * `transport.getPlayerViewState()` so the contract holds end to end.
 */

interface PartyMemberLike {
  id: string;
  name: string;
  side: string;
  teamId?: string;
  buildState?: {
    inventory: Array<{ instanceId: string; itemId: string }>;
    equippedSlots: Record<string, string | undefined>;
  } | null;
  characterSheet?: unknown;
}

function expectPartyInventoryIntact(members: PartyMemberLike[], label: string): void {
  expect(members.length, `${label}: expected a non-empty party`).toBeGreaterThan(0);
  for (const m of members) {
    expect(
      m.buildState,
      `${label}/${m.name}: combatant is missing buildState — inventory/equip/attune commands will silently no-op and the UI backpack renders empty`,
    ).toBeDefined();
    const build = m.buildState!;
    expect(
      build.inventory.length,
      `${label}/${m.name}: buildState.inventory is empty (pregens ship with gear)`,
    ).toBeGreaterThan(0);
    const ids = new Set(build.inventory.map((i) => i.instanceId));
    for (const [slot, instId] of Object.entries(build.equippedSlots ?? {})) {
      if (!instId) continue;
      expect(
        ids.has(instId),
        `${label}/${m.name}: equipped slot "${slot}" references instance "${instId}" that is not in the backpack`,
      ).toBe(true);
    }
    expect(
      m.characterSheet,
      `${label}/${m.name}: missing derived characterSheet`,
    ).toBeDefined();
  }
}

const ARENA_CONTRACT_CONFIG: ArenaConfig = {
  id: 'buildstate-contract',
  name: 'buildState contract probe',
  mode: 'custom_skirmish',
  mapId: 'contract-probe',
  gridWidth: 12,
  gridHeight: 12,
  environmentObstacles: 'open_sands',
};

describe('Party buildState contract (inventory must survive session bootstrap)', () => {
  it('dungeon campaign: projected party carries inventory + equipped slots', () => {
    const campaign = getSunkenCryptModule();
    const floor1 = getCampaignFloor(campaign, 'kaelen-floor-1')!;
    // Empty roster ⇒ default iconic party, the exact path the New Game wizard takes.
    const { transport } = buildDungeonSession(floor1, [], defaultCompendium);
    const party = Object.values(transport.getPlayerViewState().party);
    expect(party.length).toBe(4);
    expectPartyInventoryIntact(party, 'dungeon');
  });

  it('deep descent: roguelite session party carries inventory', () => {
    const { transport } = buildRogueliteSession([], defaultCompendium, 1337);
    const party = Object.values(transport.getPlayerViewState().party);
    expect(party.length).toBe(4);
    expectPartyInventoryIntact(party, 'roguelite');
  });

  it('engine startRogueliteRun: default party combatants carry buildState', () => {
    const session = startRogueliteRun({ seed: 1337 });
    expectPartyInventoryIntact(Object.values(session.gameState.party), 'engine-roguelite');
  });

  it('arena PvE: projected party carries inventory', () => {
    const { transport } = buildArenaPveEncounter(
      ARENA_CONTRACT_CONFIG,
      [],
      1,
      defaultCompendium,
    );
    const party = Object.values(transport.getPlayerViewState().party);
    expect(party.length).toBe(4);
    expectPartyInventoryIntact(party, 'arena-pve');
  });

  it('arena PvP: both teams carry buildState (red in party, blue in combatants)', () => {
    const { state } = buildArenaPvpEncounter(ARENA_CONTRACT_CONFIG, defaultCompendium);
    const red = Object.values(state.party).filter((c) => c.teamId === 'team_red');
    const blue = Object.values(state.combat?.combatants ?? {}).filter(
      (c) => c.teamId === 'team_blue',
    );
    expect(red.length).toBeGreaterThan(0);
    expect(blue.length).toBeGreaterThan(0);
    expectPartyInventoryIntact(red, 'arena-pvp-red');
    expectPartyInventoryIntact(blue, 'arena-pvp-blue');
  });

  it('realm bootstrap: overworld party carries inventory', () => {
    const session = createRealmSession({ seed: 42 });
    const members = session.partyOrder.map((id) => session.party[id]!);
    expect(members.length).toBe(4);
    expectPartyInventoryIntact(members, 'realm');
  });

  it('multiplayer lobby: initial state party carries inventory', () => {
    const party = [
      getPregenCharacter('pregen-fighter')!,
      getPregenCharacter('pregen-rogue')!,
    ];
    const state = createMultiplayerInitialState({
      party,
      compendium: defaultCompendium,
    });
    expectPartyInventoryIntact(Object.values(state.party), 'multiplayer');
  });
});
