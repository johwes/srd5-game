import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium, getSunkenCryptModule, getCampaignFloor } from '@srd5/data';
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

function buildAdjacentState() {
  const campaignModule = getSunkenCryptModule();
  const floorSpec = getCampaignFloor(campaignModule, 'kaelen-floor-1')!;
  const { initialState } = buildDungeonSession(
    floorSpec,
    getDefaultDungeonPartyCharacters(),
    defaultCompendium,
  );
  // Park the lead explorer next to the courtyard door (6, 3).
  const next = structuredClone(initialState);
  const leadId = Object.keys(next.party)[0]!;
  next.party[leadId] = { ...next.party[leadId]!, position: { x: 5, y: 3 } };
  return next;
}

describe('SRD-510 click-to-inspect prop interaction', () => {
  it('shows an indicator row instead of auto action buttons next to a door', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId="kaelen-floor-1"
        initialGameState={buildAdjacentState()}
        onExitToRoster={() => {}}
      />,
    );

    expect(screen.getByTestId('adjacent-prop-row-door_f1_courtyard_barracks')).toBeDefined();
    // No auto action buttons — interaction requires opening the card.
    expect(screen.queryByTestId('prop-open-btn-door_f1_courtyard_barracks')).toBeNull();
  });

  it('opens the interaction card on row click and opens the door via the card', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId="kaelen-floor-1"
        initialGameState={buildAdjacentState()}
        onExitToRoster={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('inspect-prop-btn-door_f1_courtyard_barracks'));
    expect(screen.getByTestId('prop-card-door_f1_courtyard_barracks')).toBeDefined();

    const openBtn = screen.getByTestId('prop-action-open-door_f1_courtyard_barracks');
    expect(openBtn.textContent).toMatch(/open/i);
    fireEvent.click(openBtn);

    // Opening the courtyard door reveals the barracks encounter, which
    // transitions exploration into tactical combat (card unmounts with it).
    expect(await screen.findByTestId('tactical-combat-hud')).toBeDefined();
  });

  it('closes the card on Esc and on explicit close', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    render(
      <DungeonView
        partyCharacters={getDefaultDungeonPartyCharacters()}
        compendium={defaultCompendium}
        initialFloorId="kaelen-floor-1"
        initialGameState={buildAdjacentState()}
        onExitToRoster={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('inspect-prop-btn-door_f1_courtyard_barracks'));
    expect(screen.getByTestId('prop-card-door_f1_courtyard_barracks')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('prop-card-door_f1_courtyard_barracks')).toBeNull();

    // Reopen, then close via the card button.
    fireEvent.click(screen.getByTestId('inspect-prop-btn-door_f1_courtyard_barracks'));
    fireEvent.click(screen.getByTestId('prop-card-close-door_f1_courtyard_barracks'));
    expect(screen.queryByTestId('prop-card-door_f1_courtyard_barracks')).toBeNull();
  });
});
