import {
  type Combatant,
  createInitialGameState,
  createTacticalGrid,
  type GameState,
} from '@srd5/engine';
import type { ClientMessage, RoomSocket, ServerMessage } from '../protocol.js';

export function makeHero(id: string, name: string, x: number, y: number): Combatant {
  return {
    id,
    name,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
    dexterityScore: 12,
    dexterityModifier: 1,
    initiativeBonus: 1,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 1,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
  };
}

export function makeMonster(id: string, name: string, x: number, y: number): Combatant {
  return {
    ...makeHero(id, name, x, y),
    side: 'monster',
    armorClass: 11,
    passivePerception: 9,
  };
}

/** Two heroes in one corner, a monster far away in the opposite corner. */
export function makeTestState(): GameState {
  const heroA = makeHero('hero-a', 'Valeros', 1, 1);
  const heroB = makeHero('hero-b', 'Merisiel', 2, 1);
  const monster = makeMonster('goblin-1', 'Goblin', 9, 9);
  return createInitialGameState({
    id: 'test-game',
    grid: createTacticalGrid(12, 12),
    party: [heroA, heroB],
    monsters: [monster],
    rngState: 424242,
    slots: [
      { playerId: 'player-1', displayName: 'Host', controlledCharacterIds: ['hero-a'] },
    ],
  });
}

/** In-memory socket that records parsed server messages and simulates the wire. */
export class FakeSocket implements RoomSocket {
  public readonly sent: ServerMessage[] = [];
  private readonly messageHandlers: Array<(raw: string) => void> = [];
  private readonly closeHandlers: Array<() => void> = [];

  public send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  public onMessage(handler: (raw: string) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index >= 0) this.messageHandlers.splice(index, 1);
    };
  }

  public onClose(handler: () => void): () => void {
    this.closeHandlers.push(handler);
    return () => {
      const index = this.closeHandlers.indexOf(handler);
      if (index >= 0) this.closeHandlers.splice(index, 1);
    };
  }

  public push(message: ClientMessage): void {
    this.pushRaw(JSON.stringify(message));
  }

  public pushRaw(raw: string): void {
    for (const handler of [...this.messageHandlers]) handler(raw);
  }

  public close(): void {
    for (const handler of [...this.closeHandlers]) handler();
  }

  public ofType<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }

  public last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    const messages = this.ofType(type);
    return messages[messages.length - 1];
  }

  public clear(): void {
    this.sent.length = 0;
  }
}
