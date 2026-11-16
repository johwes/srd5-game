# @srd5/server

Authoritative WebSocket room server hosting isolated `@srd5/engine` game sessions.

Each room owns the canonical `GameState`. Clients never receive it directly — they
receive a per-player `PlayerViewState` produced by `@srd5/transport`'s
`projectPlayerView()` (Fog-of-War, hidden traps/monsters stripped, authoritative
RNG seed removed). Every command is validated for character ownership and applied
through `reduceGame()` before projections are broadcast.

## Running

```bash
pnpm --filter @srd5/server start   # listens on $PORT (default 8787)
```

## Wire protocol (`ROOM_SERVER_PROTOCOL_VERSION = 1.0.0`)

All frames are JSON. A client may carry a `requestId`; the server echoes it on
direct replies so `dispatch()` promises can be correlated.

### Client → server

| `type` | Purpose |
| :--- | :--- |
| `CREATE_ROOM` | Create a room from an `initialState`; optional `roomId`, `host` identity, `maxPlayers`. |
| `JOIN_ROOM` | Join by `roomId` with a `player` identity and optional `requestedCharacterIds`. |
| `ASSIGN_SLOTS` | Explicitly assign controlled characters to members (no doubles / unknown ids). |
| `DISPATCH_COMMAND` | Apply a `GameCommand` through the authoritative reducer. |
| `GET_STATE` | Request a fresh private snapshot. |
| `LEAVE_ROOM` | Leave the current room. |

### Server → client

| `type` | Purpose |
| :--- | :--- |
| `ROOM_CREATED` / `ROOM_JOINED` | Ack with `playerId`, slot assignments, private view. |
| `STATE_UPDATE` | Broadcast after a command; each recipient gets its own projection + events. |
| `STATE_SNAPSHOT` | Private view for `GET_STATE`. |
| `SLOTS_UPDATED` | Broadcast after assignment changes. |
| `PLAYER_JOINED` / `PLAYER_LEFT` | Room membership notifications. |
| `LEFT_ROOM` / `ROOM_CLOSED` | Departure / room teardown. |
| `ERROR` | `{ code, message, requestId? }` — see `ROOM_ERROR_CODES`. |

## Embedding

The core is transport-agnostic:

```ts
import { RoomServer, createWebSocketRoomServer } from '@srd5/server';

const server = new RoomServer({ maxPlayers: 4, projectionOptions: { sharedVision: true } });
server.attachSocket(myRoomSocket); // any { send, onMessage, onClose }

const running = createWebSocketRoomServer({ port: 8787 });
await running.close();
```

Licensing: CC-BY-4.0 (SRD 5.1). See `LEGAL.md` at the repository root.
