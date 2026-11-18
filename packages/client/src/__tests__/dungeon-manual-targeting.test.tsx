import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  createMonsterCombatant,
  createTurnBudget,
  reduceGame,
  type GameState,
} from '@srd5/engine';
import { DungeonView } from '../components/dungeon/index.js';
import {
  buildDungeonSession,
  getDefaultDungeonPartyCharacters,
} from '../components/dungeon/dungeonEngine.js';
import { getCampaignFloor, getSunkenCryptModule } from '@srd5/data';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function buildCombatState(): GameState {
  const floorSpec = getCampaignFloor(getSunkenCryptModule(), 'kaelen-floor-1')!;
  const { initialState } = buildDungeonSession(
    floorSpec,
    getDefaultDungeonPartyCharacters(),
    defaultCompendium,
  );
  const party = Object.values(initialState.party);
  const goblin = createMonsterCombatant(
    defaultCompendium.requireMonster('goblin'),
    'goblin-manual-test',
    { x: 4, y: 3 },
    { side: 'monster' } as never,
  );
  const started = reduceGame(initialState, {
    type: 'START_COMBAT',
    encounterId: 'manual-target-test',
    combatants: [...party, goblin as never],
  }).nextState;

  // Force the wizard's turn with a fresh budget (deterministic, no AI passes).
  const wiz = Object.values(started.party).find(
    (c) => (c.characterSheet as unknown as { classes?: Array<{ classId?: string }> })?.classes?.[0]?.classId === 'wizard',
  )!;
  const order = started.combat!.initiativeOrder;
  const activeCombatantIndex = Math.max(
    0,
    order.findIndex((e) => e.entityId === wiz.id),
  );
  return {
    ...started,
    combat: {
      ...started.combat!,
      activeCombatantId: wiz.id,
      activeCombatantIndex,
      turnBudget: createTurnBudget(wiz),
    },
  };
}

describe('SRD-410 manual targeting in the dungeon (Sunken Crypt)', () => {
  it('arms attacks on hotbar click instead of auto-firing at the nearest enemy', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId="kaelen-floor-1"
        initialGameState={buildCombatState()}
        onExitToRoster={() => {}}
      />,
    );

    // Wizard is the active hero: attack actions are available.
    const attackButtons = screen.getAllByTestId(/^attack-btn-/);
    expect(attackButtons.length).toBeGreaterThan(0);
    const firstAttack = attackButtons[0] as HTMLButtonElement;
    expect(firstAttack.disabled).toBe(false);

    // Clicking arms manual targeting — it must NOT dispatch an attack.
    fireEvent.click(firstAttack);
    expect(screen.getByTestId('targeting-hint').textContent).toMatch(/Click an enemy/);
    // No auto-fire: the action is still available and no attack resolved.
    expect(firstAttack.disabled).toBe(false);
    expect(screen.queryByText(/attacks Goblin/i)).toBeNull();

    // Esc cancels the armed action.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('targeting-commit-bar')).toBeNull();
  });

  it('commits AOE spells through origin pick + Confirm', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId="kaelen-floor-1"
        initialGameState={buildCombatState()}
        onExitToRoster={() => {}}
      />,
    );

    // Arm Burning Hands (15 ft cone) from the spells tab.
    fireEvent.click(screen.getByTestId('hotbar-tab-spells'));
    fireEvent.click(screen.getByTestId('spell-cast-btn-burning-hands'));
    expect(screen.getByTestId('targeting-hint').textContent).toMatch(/Click a point within range/);

    // Pick an origin on the canvas: cell (4, 3) at default 48px cells.
    const canvas = screen.getByTestId('tactical-canvas-viewport-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => {},
    });
    fireEvent.mouseDown(canvas, { clientX: 4.5 * 48, clientY: 3.5 * 48, button: 0 });
    fireEvent.mouseUp(canvas, { clientX: 4.5 * 48, clientY: 3.5 * 48, button: 0 });

    // Foe/ally impact preview appears, then Confirm fires the spell east
    // toward the picked bearing (goblin at (4, 3) is inside the cone).
    expect(screen.getByTestId('targeting-aoe-preview').textContent).toMatch(/1 foe/);
    fireEvent.click(screen.getByTestId('targeting-confirm-btn'));
    expect(screen.queryByTestId('targeting-commit-bar')).toBeNull();
    expect(screen.getByText(/casts Burning Hands/i)).toBeDefined();
  });
});
