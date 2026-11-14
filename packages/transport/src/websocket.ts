import {
  type GameCommand,
  type GameEvent,
  type PlayerSlotAssignment,
} from '@srd5/engine';
import {
  type GameTransport,
  type PlayerViewState,
  type StateUpdateListener,
} from './types.js';

export interface WebSocketTransportOptions {
  serverUrl: string;
  roomId: string;
  playerId: string;
  authToken?: string;
}

/**
 * Multiplayer WebSocket Transport Client Stub (Spec 05 Section 2 / Phase 6).
 */
export class WebSocketTransport implements GameTransport {
  private options: WebSocketTransportOptions;
  private connected = false;
  private currentViewState: PlayerViewState | null = null;
  private listeners: Set<StateUpdateListener> = new Set();

  constructor(options: WebSocketTransportOptions) {
    this.options = options;
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
      throw new Error('WebSocketTransport is not connected');
    }
    if (!this.currentViewState) {
      throw new Error('No view state received from server yet');
    }
    return {
      viewState: this.currentViewState,
      events: [],
    };
  }

  public subscribe(listener: StateUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getPlayerViewState(_playerId?: string): PlayerViewState {
    if (!this.currentViewState) {
      throw new Error('No view state received from server yet');
    }
    return this.currentViewState;
  }

  public getSlotAssignments(): PlayerSlotAssignment[] {
    return [
      {
        playerId: this.options.playerId,
        displayName: 'Remote Player',
        controlledCharacterIds: [],
      },
    ];
  }

  /**
   * Internal handler for incoming WebSocket messages from authoritative server.
   */
  public handleServerMessage(viewState: PlayerViewState, events: GameEvent[]): void {
    this.currentViewState = viewState;
    for (const listener of this.listeners) {
      listener(viewState, events);
    }
  }
}
