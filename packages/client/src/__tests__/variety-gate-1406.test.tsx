import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  generateDungeonFloor,
  reduceGame,
  type DungeonFloorSpec,
} from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import { WorldOptionsBanner } from '../components/campaign/WorldOptionsForm.js';
import { RogueliteHud } from '../components/dungeon/RogueliteHud.js';
import {
  CombatantMedallion,
  CombatLog,
  InitiativeRibbon,
} from '../components/combat/index.js';
import { DungeonView } from '../components/dungeon/index.js';
import {
  buildDungeonSession,
  getDefaultDungeonPartyCharacters,
} from '../components/dungeon/dungeonEngine.js';

/**
 * SRD-1406: Variety verification gate — client surfaces (Spec 13 Phase 4).
 *
 * Component-level proof for the three E2E-smoke surfaces (browser combat
 * playthroughs are out of scope for automation per the SRD-1307 precedent —
 * the Playwright spec `packages/client/e2e/variety-gate.spec.ts` covers
 * launch + options banner + delve entry at 1280×800):
 *
 * 1. Champion skull visible — the exact production React surfaces render the
 *    skull badge, trait tooltip, and ELITE_SPAWNED headline.
 * 2. Vault opens — a seeded vault floor opens through the prop-card pipeline
 *    in DungeonView and shells the hoard in loot with provenance.
 * 3. Options banner shown — WorldOptionsBanner + RogueliteHud render the
 *    session config (scope/density/scarcity/visible seed).
 *
 * Canvas token badges ride SRD-1402; card-offering details ride SRD-1404.
 */

function makeChampion(trait: 'brutal' | 'swift' | 'warded' = 'brutal'): PlayerViewCombatant {
  return {
    id: 'champ-goblin-1',
    name: 'Champion Goblin',
    side: 'monster',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 11,
    maxHp: 11,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: false,
    reactionAvailable: true,
    isChampion: true,
    championTrait: trait,
  };
}

/** First depth-2 floor whose vault chest the lead pregen can pick. */
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

afterEach(() => {
  cleanup();
});

describe('SRD-1406 gate: client surfaces', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('champion skull visible: ribbon badge + medallion chip + combat-log headline', () => {
    const champ = makeChampion('brutal');
    render(
      <InitiativeRibbon
        round={1}
        phase="active_turn"
        initiativeOrder={[{ entityId: champ.id, initiative: 14, isVisible: true }]}
        combatants={{ [champ.id]: champ }}
        activeCombatantId={champ.id}
      />,
    );
    const badge = screen.getByTestId('initiative-champion-badge');
    expect(badge.textContent).toContain('💀');
    expect(badge.getAttribute('title')).toBe('Champion · brutal — +50% damage');
    cleanup();

    render(<CombatantMedallion combatant={makeChampion('warded')} />);
    const chip = screen.getByTestId('medallion-champion-chip');
    expect(chip.textContent).toContain('Champion');
    expect(chip.textContent).toContain('warded');
    expect(chip.getAttribute('title')).toBe('Champion · warded — +2 AC');
    cleanup();

    render(
      <CombatLog
        events={[{ type: 'ELITE_SPAWNED', entityId: 'champ-goblin-1', trait: 'swift' }]}
        combatants={{ 'champ-goblin-1': makeChampion('swift') }}
      />,
    );
    const log = screen.getByTestId('combat-log');
    expect(log.textContent).toContain('Champion (swift) bars the way!');
    expect(log.textContent).not.toContain('{"type"');
  });

  it('vault opens through the card in DungeonView and shells the hoard in loot', async () => {
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

    expect(screen.getByTestId('adjacent-prop-row-vault_chest_2')).toBeDefined();
    fireEvent.click(screen.getByTestId('inspect-prop-btn-vault_chest_2'));
    expect(screen.getByTestId('prop-card-vault_chest_2')).toBeDefined();

    fireEvent.click(screen.getByTestId('prop-action-pick_lock-vault_chest_2'));
    expect(await screen.findByTestId('prop-action-open-vault_chest_2')).toBeDefined();

    fireEvent.click(screen.getByTestId('prop-action-open-vault_chest_2'));
    expect(await screen.findByTestId('tab-discovered-loot-btn')).toBeDefined();
    fireEvent.click(screen.getByTestId('tab-discovered-loot-btn'));
    const provenance = await screen.findByTestId('discovered-loot-provenance');
    expect(provenance.textContent).toMatch(/vault|cache/i);
  });

  it('options banner shown: WorldOptionsBanner + RogueliteHud carry the session config', () => {
    const worldOptions = {
      scope: 'grand' as const,
      wildness: 'wild' as const,
      warIntensity: 'standard' as const,
      scarcity: 'scarce' as const,
      seed: 987654,
      seedSource: 'manual' as const,
    };
    render(<WorldOptionsBanner options={worldOptions} />);
    const banner = screen.getByTestId('world-options-banner');
    expect(banner.textContent).toContain('Grand');
    expect(banner.textContent).toContain('Wild');
    expect(banner.textContent).toContain('Scarce');
    expect(banner.textContent).toContain('987654');
    cleanup();

    render(
      <RogueliteHud
        runState={{
          runId: 'gate_run',
          seed: 987654,
          currentDepth: 2,
          maxDepthReached: 2,
          party: {},
          suppliesRemaining: 8,
          goldCollected: 100,
          monstersSlain: 5,
          totalXp: 500,
          turnsTaken: 20,
          shrineBlessings: [],
          activeCurses: [],
          restCount: { short: 0, long: 1 },
          score: 2500,
          isComplete: false,
          worldOptions,
        }}
      />,
    );
    expect(screen.getByTestId('world-options-banner')).toBeDefined();
  });
});
