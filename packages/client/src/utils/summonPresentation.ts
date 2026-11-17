import type { PlayerViewCombatant, PlayerViewState } from '@srd5/transport';

type ViewOwnershipContext = Pick<PlayerViewState, 'party' | 'combatants' | 'playerId'>;

/**
 * Untargetable conjurations (Faithful Hound, Guardian of Faith, Arcane Sword)
 * are skipped by every client-side target pick (Spec 08 §4.3 / §6).
 */
export function isUntargetableSummon(
  combatant: PlayerViewCombatant | null | undefined,
): boolean {
  return Boolean(combatant?.isSummon && combatant.untargetable);
}

/**
 * Walk the `summonedByEntityId` chain back to the caster that owns it. Cycles
 * are broken defensively so a malformed projected view cannot hang the HUD.
 */
export function resolveSummonCasterRoot(
  combatant: PlayerViewCombatant,
  combatants: Record<string, PlayerViewCombatant>,
): string {
  let current = combatant.id;
  const seen = new Set<string>([current]);

  while (true) {
    const parentId = combatants[current]?.summonedByEntityId;
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    current = parentId;
  }

  return current;
}

/**
 * Client mirror of the engine/transport transitive ownership checks: a player
 * controls a summon iff they control the caster chain root. Autonomous summons
 * never take turns and are therefore never player-controlled.
 */
export function playerControlsViewEntity(
  entity: PlayerViewCombatant | null | undefined,
  view: ViewOwnershipContext,
): boolean {
  if (!entity) return false;
  if (entity.isSummon && entity.summonControl === 'autonomous') return false;

  const rootId = entity.isSummon
    ? resolveSummonCasterRoot(entity, view.combatants)
    : entity.id;
  const root = view.combatants[rootId] ?? view.party[rootId];

  if (!root) {
    return Boolean(entity.playerId && entity.playerId === view.playerId);
  }

  return Boolean(
    view.party[rootId] ||
      root.side === 'party' ||
      (root.playerId && root.playerId === view.playerId),
  );
}

/**
 * Summons whose transitive owner is `casterId`, used by the caster's hotbar to
 * offer a Dismiss action (Spec 08 §6, SRD-904).
 */
export function summonsOwnedBy(
  casterId: string,
  combatants: Record<string, PlayerViewCombatant>,
): PlayerViewCombatant[] {
  return Object.values(combatants).filter(
    (c) => c.isSummon && resolveSummonCasterRoot(c, combatants) === casterId,
  );
}

/** Source spell name for the medallion chip, with a safe display fallback. */
export function summonSourceLabel(combatant: PlayerViewCombatant): string {
  return combatant.summonSourceName || combatant.name || 'Summoned creature';
}
