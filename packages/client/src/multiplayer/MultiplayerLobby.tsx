import React, { useEffect, useMemo, useState } from 'react';
import type { CharacterBuildState, SrdCompendium } from '@srd5/data';
import type { PlayerSlotAssignment, WebSocketTransportOptions } from '@srd5/transport';
import {
  WebSocketTransport,
  formatRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  type WebSocketFactory,
} from '@srd5/transport';
import type { PartySlotAssignment } from '../components/campaign/types.js';
import { createMultiplayerInitialState } from './lobbyState.js';
import {
  LOCAL_PLAYER_ID,
  distributeCharactersEvenly,
  getPlayersFromAssignments,
  moveCharacterToPlayer,
  validateSlotAssignments,
} from './slotAssignment.js';

export type MultiplayerMode = 'coop' | 'pvp';

export interface MultiplayerLobbyProps {
  partyCharacters: CharacterBuildState[];
  compendium: SrdCompendium;
  campaignSlots?: PartySlotAssignment[];
  serverUrl?: string;
  socketFactory?: WebSocketFactory;
  /** Inject a ready transport (or a constructor) for tests / host applications. */
  transport?: WebSocketTransport;
  transportFactory?: (options: WebSocketTransportOptions) => WebSocketTransport;
  initialMode?: MultiplayerMode;
  initialDisplayName?: string;
  onLaunch?: (
    assignments: PlayerSlotAssignment[],
    mode: MultiplayerMode,
    localPlayerId: string,
  ) => void;
  onBack?: () => void;
}

type LobbyStatus = 'idle' | 'connecting' | 'in_room' | 'error';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Co-op / PvP lobby: hosts or joins an authoritative room by its room code and
 * lets the host map each party character to a player seat (SRD-702).
 */
export function MultiplayerLobby({
  partyCharacters,
  compendium,
  campaignSlots,
  serverUrl = 'ws://localhost:8787',
  socketFactory,
  transport,
  transportFactory,
  initialMode = 'coop',
  initialDisplayName = 'Host',
  onLaunch,
  onBack,
}: MultiplayerLobbyProps) {
  const [activeTransport, setActiveTransport] = useState<WebSocketTransport | null>(
    transport ?? null,
  );
  const [status, setStatus] = useState<LobbyStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MultiplayerMode>(initialMode);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [localPlayerId, setLocalPlayerId] = useState(LOCAL_PLAYER_ID);
  const [assignments, setAssignments] = useState<PlayerSlotAssignment[]>([]);

  const characterIds = useMemo(() => partyCharacters.map((c) => c.id), [partyCharacters]);
  const characterNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const character of partyCharacters) names.set(character.id, character.name);
    return names;
  }, [partyCharacters]);

  const players = useMemo(() => {
    const remote = getPlayersFromAssignments(assignments).filter(
      (player) => player.playerId !== localPlayerId,
    );
    return [
      { playerId: localPlayerId, displayName: displayName || 'Local Player' },
      ...remote,
    ];
  }, [assignments, displayName, localPlayerId]);

  // Keep projected slot assignments and lobby lifecycle events in sync with the server.
  useEffect(() => {
    if (!activeTransport) return;
    const offState = activeTransport.subscribe(() => {
      setAssignments(activeTransport.getSlotAssignments());
    });
    const offRoom = activeTransport.onRoomEvent((event) => {
      if (event.type === 'ERROR') setError(event.message);
      if (event.type === 'ROOM_CLOSED') {
        setError(`Room closed: ${event.reason}`);
        setActiveRoomCode(null);
        setAssignments([]);
        setStatus('idle');
      }
      if (event.type === 'PLAYER_JOINED' || event.type === 'PLAYER_LEFT') {
        void activeTransport
          .requestState()
          .then(() => setAssignments(activeTransport.getSlotAssignments()))
          .catch(() => undefined);
      }
    });
    return () => {
      offState();
      offRoom();
    };
  }, [activeTransport]);

  const ensureTransport = (): WebSocketTransport => {
    if (activeTransport) return activeTransport;
    const created =
      transportFactory?.({
        serverUrl,
        playerId: LOCAL_PLAYER_ID,
        displayName,
        socketFactory,
      }) ??
      new WebSocketTransport({
        serverUrl,
        playerId: LOCAL_PLAYER_ID,
        displayName,
        socketFactory,
      });
    setActiveTransport(created);
    return created;
  };

  const handleCreate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus('connecting');
    try {
      const client = ensureTransport();
      await client.connect();
      const initialState = createMultiplayerInitialState({
        party: partyCharacters,
        compendium,
        campaignSlots,
        localPlayerId,
      });
      const session = await client.createRoom(initialState, { displayName });
      setActiveRoomCode(session.roomId);
      setLocalPlayerId(session.playerId);
      setAssignments(session.slotAssignments);
      setStatus('in_room');
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (): Promise<void> => {
    const code = normalizeRoomCode(roomCodeInput);
    if (!isValidRoomCode(code)) {
      setError('Enter a valid 6-character room code');
      setStatus('error');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus('connecting');
    try {
      const client = ensureTransport();
      await client.connect();
      const session = await client.joinRoom(code);
      setActiveRoomCode(session.roomId);
      setLocalPlayerId(session.playerId);
      setAssignments(session.slotAssignments);
      setStatus('in_room');
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const commitAssignments = async (next: PlayerSlotAssignment[]): Promise<void> => {
    setAssignments(next);
    if (!activeTransport || status !== 'in_room') return;
    const validation = validateSlotAssignments(next, characterIds);
    if (!validation.valid) {
      setError(validation.errors[0] ?? 'Invalid slot assignment');
      return;
    }
    try {
      const authoritative = await activeTransport.assignSlots(next);
      setAssignments(authoritative);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handleOwnerChange = (characterId: string, playerId: string): void => {
    const seatName = players.find((player) => player.playerId === playerId)?.displayName;
    void commitAssignments(
      moveCharacterToPlayer(assignments, characterId, playerId, { displayName: seatName }),
    );
  };

  const handleAutoAssign = (): void => {
    const seats = players.map((player) => player.playerId);
    void commitAssignments(distributeCharactersEvenly(seats, characterIds, mode));
  };

  const handleLaunch = (): void => {
    const validation = validateSlotAssignments(assignments, characterIds);
    if (!validation.valid) {
      setError(validation.errors[0] ?? 'Invalid slot assignment');
      return;
    }
    onLaunch?.(assignments, mode, localPlayerId);
  };

  const handleLeave = async (): Promise<void> => {
    if (activeTransport && status === 'in_room') {
      try {
        await activeTransport.leaveRoom();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    }
    setActiveRoomCode(null);
    setAssignments([]);
    setStatus('idle');
  };

  const ownerOf = (characterId: string): string =>
    assignments.find((slot) => slot.controlledCharacterIds.includes(characterId))?.playerId ??
    localPlayerId;

  return (
    <div
      data-testid="multiplayer-lobby-view"
      className="max-w-5xl mx-auto w-full space-y-4 pb-6"
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-amber-400">
            🌐 Multiplayer Lobby
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Host a co-op campaign or a PvP duel, share a room code, and assign each hero to a player seat.
          </p>
        </div>
        {onBack && (
          <button
            type="button"
            data-testid="multiplayer-back-btn"
            onClick={onBack}
            className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            ← Title Menu
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {(['coop', 'pvp'] as const).map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`multiplayer-mode-${option}`}
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
            className={`min-h-[44px] rounded-lg border px-4 text-xs font-semibold transition-colors ${
              mode === option
                ? 'border-amber-400 bg-amber-500 text-slate-950'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {option === 'coop' ? '🤝 Co-op Campaign' : '⚔️ PvP Duel'}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <label className="block text-xs font-semibold text-slate-300">
          Display Name
          <input
            data-testid="multiplayer-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-400 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[200px] text-xs font-semibold text-slate-300">
            Room Code (join)
            <input
              data-testid="multiplayer-room-code-input"
              value={roomCodeInput}
              onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
              placeholder="ABC-234"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono tracking-widest text-slate-100 focus:border-amber-400 focus:outline-none"
            />
          </label>
          <button
            type="button"
            data-testid="multiplayer-join-btn"
            disabled={busy}
            onClick={() => void handleJoin()}
            className="min-h-[44px] rounded-lg border border-slate-600 bg-slate-800 px-4 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
          >
            Join Room
          </button>
          <button
            type="button"
            data-testid="multiplayer-create-btn"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="min-h-[44px] rounded-lg border border-amber-500 bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Create Room'}
          </button>
        </div>

        {activeRoomCode && (
          <div
            data-testid="multiplayer-active-room-code"
            className="flex items-center gap-3 rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-3 py-2"
          >
            <span className="text-xs text-emerald-300">Room Code:</span>
            <span className="font-mono text-lg font-bold tracking-widest text-emerald-200">
              {formatRoomCode(activeRoomCode)}
            </span>
            <button
              type="button"
              data-testid="multiplayer-copy-code-btn"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  void navigator.clipboard.writeText(activeRoomCode);
                }
              }}
              className="min-h-[36px] rounded border border-emerald-700 px-2 text-[11px] text-emerald-200 hover:bg-emerald-900/40"
            >
              Copy
            </button>
            <span className="ml-auto text-[11px] text-slate-400">
              {status === 'in_room' ? 'Connected' : status}
            </span>
          </div>
        )}

        {error && (
          <p data-testid="multiplayer-error" className="text-xs font-medium text-rose-400">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-200">Player Seats &amp; Character Control</h2>
          <button
            type="button"
            data-testid="multiplayer-auto-assign-btn"
            disabled={players.length === 0 || characterIds.length === 0}
            onClick={handleAutoAssign}
            className="min-h-[40px] rounded-lg border border-slate-600 bg-slate-800 px-3 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {mode === 'pvp' ? 'Split Into Teams' : 'Distribute Evenly'}
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {players.map((player) => {
            const controlled = assignments
              .find((slot) => slot.playerId === player.playerId)
              ?.controlledCharacterIds.map((id) => characterNames.get(id) ?? id);
            return (
              <div
                key={player.playerId}
                data-testid={`multiplayer-player-${player.playerId}`}
                className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"
              >
                <p className="text-xs font-bold text-amber-300">
                  {player.displayName}
                  {player.playerId === localPlayerId && ' (You)'}
                </p>
                <p data-testid={`multiplayer-controlled-${player.playerId}`} className="mt-1 text-[11px] text-slate-400">
                  {controlled?.length ? controlled.join(', ') : 'No heroes assigned'}
                </p>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          {partyCharacters.length === 0 && (
            <p className="text-xs text-slate-500">No party members available to assign.</p>
          )}
          {partyCharacters.map((character) => (
            <div
              key={character.id}
              data-testid={`multiplayer-character-${character.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <span className="text-xs font-semibold text-slate-200">
                {character.name}
                <span className="ml-2 text-[10px] font-normal text-slate-500">{character.id}</span>
              </span>
              <select
                data-testid={`multiplayer-owner-${character.id}`}
                value={ownerOf(character.id)}
                onChange={(event) => handleOwnerChange(character.id, event.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
              >
                {players.map((player) => (
                  <option key={player.playerId} value={player.playerId}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="multiplayer-launch-btn"
          disabled={status !== 'in_room'}
          onClick={handleLaunch}
          className="min-h-[48px] rounded-lg border border-emerald-500 bg-emerald-600 px-5 text-sm font-bold text-slate-950 hover:bg-emerald-500 disabled:opacity-50"
        >
          {mode === 'pvp' ? '⚔️ Launch PvP Duel' : '🚀 Launch Co-op Mission'}
        </button>
        <button
          type="button"
          data-testid="multiplayer-leave-btn"
          disabled={status !== 'in_room'}
          onClick={() => void handleLeave()}
          className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900 px-4 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Leave Room
        </button>
      </footer>
    </div>
  );
}
