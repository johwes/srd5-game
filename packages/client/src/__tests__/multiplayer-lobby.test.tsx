import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CharacterBuildState, defaultCompendium, getPregenCharacter } from '@srd5/data';
import { createInitialGameState, createTacticalGrid } from '@srd5/engine';
import {
  projectPlayerView,
  type PlayerSlotAssignment,
  type WebSocketTransport,
} from '@srd5/transport';
import { App } from '../App.js';
import { MultiplayerLobby } from '../multiplayer/index.js';

const heroes = [
  getPregenCharacter('pregen-fighter')!,
  getPregenCharacter('pregen-rogue')!,
  getPregenCharacter('pregen-wizard')!,
  getPregenCharacter('pregen-cleric')!,
].filter((c): c is CharacterBuildState => Boolean(c));
const ids = heroes.map((c) => c.id);

const viewState = projectPlayerView(
  createInitialGameState({ id: 'lobby-view', grid: createTacticalGrid(4, 4), party: [] }),
  'host-1',
);

const ROOM_ID = 'ABC234';

function makeSession(slotAssignments: PlayerSlotAssignment[]) {
  return {
    roomId: ROOM_ID,
    playerId: 'host-1',
    viewState,
    slotAssignments,
    events: [],
  };
}

function makeStub(initialAssignments: PlayerSlotAssignment[]) {
  let current = initialAssignments;
  const stub = {
    connect: vi.fn().mockResolvedValue(undefined),
    createRoom: vi.fn().mockImplementation(async () => makeSession(current)),
    joinRoom: vi.fn().mockImplementation(async () => makeSession(current)),
    assignSlots: vi.fn().mockImplementation(async (next: PlayerSlotAssignment[]) => {
      current = next;
      return next;
    }),
    requestState: vi.fn().mockResolvedValue(viewState),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    onRoomEvent: vi.fn().mockReturnValue(() => undefined),
    getSlotAssignments: vi.fn().mockImplementation(() => current),
  };
  return { stub, mocks: stub };
}

const twoSeatAssignments: PlayerSlotAssignment[] = [
  { playerId: 'host-1', displayName: 'Host', controlledCharacterIds: [ids[0]!, ids[1]!] },
  { playerId: 'p2', displayName: 'Player 2', controlledCharacterIds: [ids[2]!, ids[3]!] },
];

function renderLobby(
  overrides: {
    transport?: WebSocketTransport;
    onLaunch?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const { stub } = makeStub(twoSeatAssignments);
  return render(
    <MultiplayerLobby
      partyCharacters={heroes}
      compendium={defaultCompendium}
      transport={overrides.transport ?? (stub as unknown as WebSocketTransport)}
      onLaunch={overrides.onLaunch ?? vi.fn()}
      onBack={vi.fn()}
    />,
  );
}

describe('SRD-702: Multiplayer Lobby UI', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('is reachable from the title screen', () => {
    render(<App />);
    const button = screen.getByTestId('title-menu-multiplayer-btn');
    fireEvent.click(button);
    expect(screen.getByTestId('multiplayer-lobby-view')).toBeDefined();
  });

  it('hosts a room and shows the shareable (formatted) room code', async () => {
    renderLobby();
    fireEvent.click(screen.getByTestId('multiplayer-create-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('multiplayer-active-room-code').textContent).toContain('ABC-234'),
    );
    expect(screen.getByTestId('multiplayer-controlled-host-1').textContent).toContain(
      heroes[0]!.name,
    );
    expect(screen.getByTestId('multiplayer-launch-btn')).not.toHaveProperty('disabled', true);
  });

  it('joins a room using a normalized code and rejects invalid codes', async () => {
    const { stub } = makeStub(twoSeatAssignments);
    renderLobby({ transport: stub as unknown as WebSocketTransport });

    const input = screen.getByTestId('multiplayer-room-code-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('multiplayer-join-btn'));
    expect(screen.getByTestId('multiplayer-error').textContent).toMatch(/valid 6-character/);
    expect(stub.joinRoom).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'abc-234' } });
    fireEvent.click(screen.getByTestId('multiplayer-join-btn'));
    await waitFor(() => expect(stub.joinRoom).toHaveBeenCalledWith('ABC234'));
  });

  it('reassigns a hero to another player seat through the server', async () => {
    const { stub } = makeStub(twoSeatAssignments);
    renderLobby({ transport: stub as unknown as WebSocketTransport });
    fireEvent.click(screen.getByTestId('multiplayer-create-btn'));
    await waitFor(() => expect(screen.getByTestId('multiplayer-active-room-code')).toBeDefined());

    const owner = screen.getByTestId(`multiplayer-owner-${ids[0]}`) as HTMLSelectElement;
    fireEvent.change(owner, { target: { value: 'p2' } });

    await waitFor(() => expect(stub.assignSlots).toHaveBeenCalledTimes(1));
    const sent = stub.assignSlots.mock.calls[0]![0] as PlayerSlotAssignment[];
    expect(sent.find((s) => s.playerId === 'p2')!.controlledCharacterIds).toContain(ids[0]);
    expect(sent.find((s) => s.playerId === 'host-1')!.controlledCharacterIds).not.toContain(ids[0]);
  });

  it('splits the party into two teams in PvP mode and launches with seat metadata', async () => {
    const { stub } = makeStub(twoSeatAssignments);
    const onLaunch = vi.fn();
    renderLobby({ transport: stub as unknown as WebSocketTransport, onLaunch });

    fireEvent.click(screen.getByTestId('multiplayer-mode-pvp'));
    fireEvent.click(screen.getByTestId('multiplayer-create-btn'));
    await waitFor(() => expect(screen.getByTestId('multiplayer-active-room-code')).toBeDefined());

    fireEvent.click(screen.getByTestId('multiplayer-auto-assign-btn'));
    await waitFor(() => expect(stub.assignSlots).toHaveBeenCalledTimes(1));
    const split = stub.assignSlots.mock.calls[0]![0] as PlayerSlotAssignment[];
    expect(split[0]!.controlledCharacterIds).toHaveLength(2);
    expect(split[1]!.controlledCharacterIds).toHaveLength(2);

    fireEvent.click(screen.getByTestId('multiplayer-launch-btn'));
    expect(onLaunch).toHaveBeenCalledWith(expect.any(Array), 'pvp', 'host-1');
  });
});
