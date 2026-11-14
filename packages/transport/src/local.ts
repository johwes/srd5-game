import {
  type GameCommand,
  type GameEvent,
  type GameState,
  type PlayerSlotAssignment,
  reduceGame,
} from '@srd5/engine';
import { projectPlayerView, type ProjectPlayerViewOptions } from './fog.js';
import {
  type GameTransport,
  type PlayerViewState,
  type StateUpdateListener,
} from './types.js';

export interface LocalTransportOptions {
  initialState: GameState;
  defaultPlayerId?: string;
  projectionOptions?: ProjectPlayerViewOptions;
}

/**
 * In-memory / Single-Player Transport Implementation (Spec 05 Section 2).
 * Bridges UI commands to the authoritative @srd5/engine reducer and
 * projects Fog-of-War filtered PlayerViewState to subscribers.
 */
export class LocalTransport implements GameTransport {
  private state: GameState;
  private defaultPlayerId: string;
  private projectionOptions: ProjectPlayerViewOptions;
  private connected = false;
  private listeners: Set<StateUpdateListener> = new Set();

  constructor(options: LocalTransportOptions) {
    this.state = structuredClone(options.initialState);
    this.defaultPlayerId =
      options.defaultPlayerId ??
      options.initialState.slots[0]?.playerId ??
      'player-1';
    this.projectionOptions = options.projectionOptions ?? { sharedVision: true };
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.listeners.clear();
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async dispatch(command: GameCommand): Promise<{
    viewState: PlayerViewState;
    events: GameEvent[];
  }> {
    if (!this.connected) {
      await this.connect();
    }

    const { nextState, events } = reduceGame(this.state, command);
    this.state = nextState;

    const viewState = this.getPlayerViewState(this.defaultPlayerId);

    // Notify all active listeners with the new projected state and emitted events
    for (const listener of this.listeners) {
      try {
        listener(viewState, events);
      } catch (err) {
        console.error('Error in LocalTransport state update listener:', err);
      }
    }

    return { viewState, events };
  }

  public subscribe(listener: StateUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getPlayerViewState(playerId?: string): PlayerViewState {
    const targetId = playerId ?? this.defaultPlayerId;
    return projectPlayerView(this.state, targetId, this.projectionOptions);
  }

  public getSlotAssignments(): PlayerSlotAssignment[] {
    return structuredClone(this.state.slots);
  }

  /**
   * Returns the authoritative game state (for testing, serialization, or save files).
   */
  public getAuthoritativeState(): GameState {
    return structuredClone(this.state);
  }

  /**
   * Resets or loads a new authoritative game state.
   */
  public setAuthoritativeState(newState: GameState): void {
    this.state = structuredClone(newState);
    const viewState = this.getPlayerViewState(this.defaultPlayerId);
    for (const listener of this.listeners) {
      listener(viewState, []);
    }
  }
}

/**
 * Factory helper to construct a LocalTransport instance.
 */
export function createLocalTransport(options: LocalTransportOptions): LocalTransport {
  return new LocalTransport(options);
}
