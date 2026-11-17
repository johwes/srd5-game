import { type Combatant, type GameState, type PlayerSlotAssignment } from '@srd5/engine';

/**
 * Resolves the slot that describes a player's controlled characters.
 * Mirrors the fallback used by `projectPlayerView` so every consumer agrees on
 * who owns what (SRD-903).
 */
export function resolvePlayerSlot(
  state: GameState,
  playerId: string,
): PlayerSlotAssignment {
  return (
    state.slots.find((s) => s.playerId === playerId) ??
    state.slots[0] ?? {
      playerId,
      displayName: 'Player',
      controlledCharacterIds: Object.keys(state.party),
    }
  );
}

/**
 * Looks a combatant up in whichever authoritative mirror currently holds it.
 * Summons live inside `combat.combatants` during combat but are also mirrored
 * into `party` / `monsters` by the reducer.
 */
export function findCombatantById(
  state: GameState,
  entityId: string,
): Combatant | undefined {
  return (
    state.combat?.combatants[entityId] ??
    state.party[entityId] ??
    state.monsters[entityId]
  );
}

/**
 * Walks the `summonedByEntityId` chain to the original caster (Spec 08 §4.2 /
 * §5). Cycles are broken defensively so malformed input can never hang a
 * projection or an authorization check.
 */
export function resolveEntityChainRoot(state: GameState, entityId: string): string {
  let current = entityId;
  const visited = new Set<string>([current]);

  while (true) {
    const parent = findCombatantById(state, current)?.summonedByEntityId;
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    current = parent;
  }

  return current;
}

/**
 * Every entity id a player may drive: their assigned characters plus every
 * summon whose transitive ownership chain terminates at one of those
 * characters. `PlayerSlotAssignment`s themselves stay unchanged (SRD-903).
 */
export function getControlledEntityIds(state: GameState, playerId: string): Set<string> {
  const direct = new Set(resolvePlayerSlot(state, playerId).controlledCharacterIds);
  const controlled = new Set<string>(direct);

  const candidates = {
    ...state.party,
    ...state.monsters,
    ...(state.combat?.combatants ?? {}),
  };
  for (const combatant of Object.values(candidates)) {
    if (!combatant.isSummon) continue;
    if (direct.has(resolveEntityChainRoot(state, combatant.id))) {
      controlled.add(combatant.id);
    }
  }

  return controlled;
}

/** True when the player controls an entity directly or through summon ownership. */
export function playerControlsEntity(
  state: GameState,
  playerId: string,
  entityId: string,
): boolean {
  return getControlledEntityIds(state, playerId).has(entityId);
}
