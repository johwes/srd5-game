import { describe, expect, it } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../protocol.js';
import { RoomServer } from '../room-server.js';
import { attachRoomServer, toRoomSocket } from '../websocket.js';
import { makeTestState } from './fixtures.js';

class FakeWsSocket {
  public readonly sent: string[] = [];
  private readonly handlers = new Map<string, Array<(...args: any[]) => void>>();

  public on(event: string, listener: (...args: any[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return this;
  }

  public off(event: string, listener: (...args: any[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
    return this;
  }

  public send(raw: string): void {
    this.sent.push(raw);
  }

  public emit(event: string, ...args: any[]): void {
    for (const listener of [...(this.handlers.get(event) ?? [])]) listener(...args);
  }

  public message(message: ClientMessage): void {
    const raw = JSON.stringify(message);
    this.emit('message', { toString: () => raw }, false);
  }

  public closeSocket(): void {
    this.emit('close', 1000, { toString: () => '' });
  }

  public messages(): ServerMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ServerMessage);
  }
}

function makeFakeWss() {
  const connectionHandlers: Array<(socket: WsSocket, request: unknown) => void> = [];
  return {
    on(event: string, listener: (...args: any[]) => void) {
      if (event === 'connection') {
        connectionHandlers.push(listener as (socket: WsSocket, request: unknown) => void);
      }
      return this;
    },
    off(event: string, listener: (...args: any[]) => void) {
      if (event === 'connection') {
        const index = connectionHandlers.indexOf(
          listener as (socket: WsSocket, request: unknown) => void,
        );
        if (index >= 0) connectionHandlers.splice(index, 1);
      }
      return this;
    },
    connect(socket: FakeWsSocket) {
      for (const handler of [...connectionHandlers]) handler(socket as unknown as WsSocket, {});
    },
  };
}

describe('SRD-701: ws transport adapter', () => {
  it('converts a ws socket into a RoomSocket with unsubscribable listeners', () => {
    const fake = new FakeWsSocket();
    const adapter = toRoomSocket(fake as unknown as WsSocket);
    const received: string[] = [];
    const offMessage = adapter.onMessage((raw) => received.push(raw));

    fake.emit('message', { toString: () => 'hello' }, false);
    offMessage();
    fake.emit('message', { toString: () => 'ignored' }, false);

    expect(received).toEqual(['hello']);
    adapter.send('outbound');
    expect(fake.sent).toEqual(['outbound']);
  });

  it('routes ws connections through the authoritative room server', () => {
    const wss = makeFakeWss();
    const roomServer = new RoomServer();
    const detach = attachRoomServer(wss, roomServer);

    const host = new FakeWsSocket();
    wss.connect(host);
    host.message({
      type: 'CREATE_ROOM',
      roomId: 'WSROOM',
      initialState: makeTestState(),
      host: { playerId: 'ws-host' },
    });

    const created = host.messages().find((m) => m.type === 'ROOM_CREATED');
    expect(created).toMatchObject({ roomId: 'WSROOM', playerId: 'ws-host' });
    expect(roomServer.getRoom('WSROOM')).toBeDefined();

    detach();
  });

  it('stops accepting connections and detaches existing sockets on teardown', () => {
    const wss = makeFakeWss();
    const roomServer = new RoomServer();
    const detach = attachRoomServer(wss, roomServer);

    const host = new FakeWsSocket();
    wss.connect(host);
    host.message({
      type: 'CREATE_ROOM',
      roomId: 'TEARDOWN',
      initialState: makeTestState(),
      host: { playerId: 'ws-host' },
    });
    expect(roomServer.getRoom('TEARDOWN')).toBeDefined();

    detach();

    const before = host.sent.length;
    host.message({ type: 'GET_STATE' });
    expect(host.sent).toHaveLength(before);

    const second = new FakeWsSocket();
    wss.connect(second);
    second.message({
      type: 'CREATE_ROOM',
      roomId: 'IGNORED',
      initialState: makeTestState(),
      host: { playerId: 'ws-second' },
    });

    expect(second.sent).toHaveLength(0);
    expect(roomServer.getRoom('IGNORED')).toBeUndefined();
  });
});
