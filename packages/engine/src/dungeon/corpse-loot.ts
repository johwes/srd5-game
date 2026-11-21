import {
  type InventoryItemInstance,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { rollD20 } from '../dice/evaluator.js';
import type { Combatant } from '../combat/types.js';
import type { GameEvent, GameState, InteractiveProp } from '../state/types.js';
import type { LootBundleSpec } from './schemas.js';
import {
  awardLootToCharacter,
  rollIndividualTreasure,
  rollTreasureHoard,
} from './loot.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { getActorCheckBonus, isAdjacent } from './props.js';

// ============================================================================
// SRD-1307: CR-scaled monster loot drops + corpse looting + skill-influenced
// rewards (Spec 12 §11). Deterministic: every roll threads `rngState`, every
// created instance carries a caller-supplied id prefix (never `Math.random`).
// ============================================================================

/**
 * CR at or above which a slain monster counts as elite/boss and additionally
 * rolls on `rollTreasureHoard` at its CR tier. There is no elite flag in the
 * encounter data model, so the CR band is the deterministic rule.
 */
export const CORPSE_ELITE_CR_THRESHOLD = 5;

/** Base DC for searching the fallen / harvesting (Spec 12 §11.3). */
export const CORPSE_SEARCH_BASE_DC = 10;

/** Creature types that yield harvest goods on a successful Survival search. */
export const CORPSE_HARVEST_CREATURE_TYPES: readonly string[] = ['beast', 'monstrosity'];

/** Harvest goods item id (SRD adventuring gear). */
export const CORPSE_HARVEST_ITEM_ID = 'rations-1-day';

/** Origin tag carried by per-slay corpse drops (no war-award double-dip). */
export const MONSTER_DROP_ORIGIN = 'monster_drop';

/** Challenge rating of a combatant (monsters only; heroes default to 0). */
export function getCombatantCr(monster: Pick<Combatant, 'monsterData'>): number {
  const cr = monster.monsterData?.challengeRating;
  return typeof cr === 'number' && Number.isFinite(cr) ? cr : 0;
}

/** Investigation / Survival DC for a corpse: 10 + floor(CR), minimum 10. */
export function corpseSearchDc(cr: number): number {
  return CORPSE_SEARCH_BASE_DC + Math.max(0, Math.floor(cr));
}

/** Merge two loot bundles: coins sum, items concatenate, provenance kept. */
export function mergeLootBundles(a: LootBundleSpec, b: LootBundleSpec): LootBundleSpec {
  const merged: LootBundleSpec = { ...a };
  for (const denom of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
    const sum = (a[denom] ?? 0) + (b[denom] ?? 0);
    if (sum > 0) merged[denom] = sum;
  }
  const items = [...(a.items ?? []), ...(b.items ?? [])];
  if (items.length > 0) merged.items = items;
  if (merged.origin === undefined) merged.origin = b.origin;
  if (merged.sourceName === undefined) merged.sourceName = b.sourceName;
  return merged;
}

/** True when a bundle holds anything worth a corpse prop / sweep. */
export function hasClaimableLoot(loot: LootBundleSpec | undefined): boolean {
  if (!loot) return false;
  if ((loot.cp ?? 0) > 0 || (loot.sp ?? 0) > 0 || (loot.ep ?? 0) > 0) return true;
  if ((loot.gp ?? 0) > 0 || (loot.pp ?? 0) > 0) return true;
  return (loot.items?.length ?? 0) > 0;
}

/**
 * Rolls the per-slay drop for one slain monster: individual treasure in
 * DMG CR bands (0–4 / 5–10 / 11–16 / 17+) via `rollIndividualTreasure`, plus
 * a `rollTreasureHoard` roll at the CR tier for elite/boss CRs (>= 5).
 * Summoned creatures never drop loot. The bundle carries the `monster_drop`
 * origin tag and the monster name so war-battle awards never stack on the
 * same kill and the loot UI can attribute the drop.
 */
export function rollCorpseLoot(
  monster: Pick<Combatant, 'monsterData' | 'name' | 'isSummon' | 'isChampion'> &
    Partial<Pick<Combatant, 'id' | 'position' | 'isDead' | 'currentHp'>>,
  rngState: number,
  compendium: SrdCompendium = defaultCompendium,
): { loot: LootBundleSpec; nextRng: number } {
  if (monster.isSummon) {
    return { loot: {}, nextRng: rngState };
  }
  const cr = getCombatantCr(monster);
  let rng = rngState;
  const individual = rollIndividualTreasure(cr, rng);
  rng = individual.nextRng;
  let loot = { ...individual.loot };
  // SRD-1402: champions always roll the elite hoard path regardless of CR.
  if (cr >= CORPSE_ELITE_CR_THRESHOLD || monster.isChampion === true) {
    const hoard = rollTreasureHoard(cr, rng, compendium);
    rng = hoard.nextRng;
    loot = mergeLootBundles(loot, hoard.loot);
  }
  if (hasClaimableLoot(loot)) {
    loot.origin = MONSTER_DROP_ORIGIN;
    loot.sourceName = monster.isChampion === true ? `Champion ${monster.name.replace(/^Champion /, '')}` : monster.name;
  }
  return { loot, nextRng: rng };
}

/** Deterministic corpse prop id for a slain monster id. */
export function corpsePropIdFor(monsterId: string): string {
  return `corpse-${monsterId}`;
}

export interface SpawnCorpseLootResult {
  nextProps: InteractiveProp[];
  nextRng: number;
  /** Ids of newly created corpse props (for tests / callers). */
  spawnedPropIds: string[];
}

/**
 * Creates one lootable `corpse` prop per newly slain monster (positioned on
 * the corpse's cell). Idempotent: monsters that already have a corpse prop,
 * summons, and empty rolls are skipped. Corpses spawn `open` with no
 * movement/sight blocking so they claim through the existing `claimPropLoot`
 * pipeline with no new commands.
 */
export function spawnCorpseLootProps(
  props: InteractiveProp[],
  defeatedMonsters: ReadonlyArray<Pick<Combatant, 'id' | 'name' | 'position' | 'monsterData' | 'isSummon' | 'isChampion' | 'isDead' | 'currentHp'>>,
  rngState: number,
  compendium: SrdCompendium = defaultCompendium,
): SpawnCorpseLootResult {
  const nextProps = [...props];
  const existingIds = new Set(nextProps.map((p) => p.id));
  let rng = rngState;
  const spawnedPropIds: string[] = [];

  for (const monster of defeatedMonsters) {
    if (!monster.isDead && monster.currentHp > 0) continue;
    const propId = corpsePropIdFor(monster.id);
    if (existingIds.has(propId)) continue;
    const rolled = rollCorpseLoot(monster, rng, compendium);
    rng = rolled.nextRng;
    if (!hasClaimableLoot(rolled.loot)) continue;
    nextProps.push({
      id: propId,
      x: monster.position.x,
      y: monster.position.y,
      kind: 'corpse',
      state: 'open',
      blocksMovement: false,
      blocksSight: false,
      discovered: true,
      monsterId: monster.id,
      label: `Remains of ${monster.name}`,
      searched: false,
      searchDc: corpseSearchDc(getCombatantCr(monster)),
      lootTable: rolled.loot,
    });
    existingIds.add(propId);
    spawnedPropIds.push(propId);
  }

  return { nextProps, nextRng: rng, spawnedPropIds };
}

/**
 * Human loot summary for skill-attribution notes, e.g.
 * `+12 gp, +potion of healing`.
 */
export function describeLootBonus(
  loot: LootBundleSpec,
  compendium: SrdCompendium = defaultCompendium,
): string {
  const parts: string[] = [];
  for (const denom of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
    const amount = loot[denom] ?? 0;
    if (amount > 0) parts.push(`+${amount} ${denom}`);
  }
  for (const itemId of loot.items ?? []) {
    const name =
      compendium.getMagicItem(itemId)?.name ??
      compendium.getEquipment(itemId)?.name ??
      itemId.replace(/[-_]+/g, ' ');
    parts.push(`+${name}`);
  }
  return parts.join(', ');
}

export interface CorpseSearchResult {
  nextState: GameState;
  events: GameEvent[];
}

/**
 * Resolves `INTERACT_PROP { interaction: 'search' }` on a corpse prop:
 * an INT (Investigation) check vs 10 + floor(CR) merges a bonus
 * individual-treasure roll into the corpse loot on success, and a WIS
 * (Survival) check on beast/monstrosity remains harvests rations. Both
 * resolve deterministically with attribution notes on `CHECK_RESOLVED`
 * (Keen Eye / Field Dressing lines for the loot UI). One attempt per corpse.
 */
export function resolveCorpseSearch(options: {
  state: GameState;
  actorId: string;
  propId: string;
  compendium?: SrdCompendium;
}): CorpseSearchResult {
  const { state, actorId, propId } = options;
  const compendium = options.compendium ?? defaultCompendium;
  const nextState = structuredClone(state);
  const actor = nextState.party[actorId] ?? nextState.combat?.combatants[actorId];
  if (!actor) {
    throw new Error(`Actor not found for corpse search: ${actorId}`);
  }
  const prop = nextState.props.find((p) => p.id === propId);
  if (!prop) {
    throw new Error(`Interactive prop not found: ${propId}`);
  }
  if (prop.kind !== 'corpse') {
    throw new Error(`Prop ${propId} is not a corpse (kind: ${prop.kind})`);
  }
  if (!isAdjacent(actor.position, { x: prop.x, y: prop.y })) {
    throw new Error(
      `Actor ${actorId} at (${actor.position.x}, ${actor.position.y}) is not adjacent to corpse ${propId} at (${prop.x}, ${prop.y})`,
    );
  }
  if (prop.searched) {
    throw new Error(`Corpse ${propId} has already been searched`);
  }

  const events: GameEvent[] = [];
  const monster = prop.monsterId ? nextState.monsters[prop.monsterId] : undefined;
  const cr = monster ? getCombatantCr(monster) : 0;
  const dc = prop.searchDc ?? corpseSearchDc(cr);

  // 1. Investigation: bonus individual-treasure roll on success.
  const investigationBonus = getActorCheckBonus(actor, 'investigation');
  const invRoll = rollD20(nextState.rngState, { modifier: investigationBonus, mode: 'normal' });
  nextState.rngState = invRoll.nextState;
  const invSuccess = invRoll.total >= dc;
  let invBonusLoot: LootBundleSpec = {};
  if (invSuccess) {
    const bonus = rollIndividualTreasure(cr, nextState.rngState);
    nextState.rngState = bonus.nextRng;
    invBonusLoot = bonus.loot;
    const target = nextState.props.find((p) => p.id === propId)!;
    target.lootTable = mergeLootBundles(target.lootTable ?? {}, {
      ...bonus.loot,
      origin: MONSTER_DROP_ORIGIN,
      sourceName: monster?.name ?? target.label,
    });
  }
  const invNote = invSuccess
    ? `Keen Eye (Investigation): ${describeLootBonus(invBonusLoot, compendium)} searched from the fallen.`
    : 'Keen Eye (Investigation): the fallen yield no hidden spoils.';
  events.push({
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'investigation',
    targetId: prop.id,
    dc,
    roll: invRoll.naturalRoll,
    modifier: investigationBonus,
    total: invRoll.total,
    success: invSuccess,
    note: invNote,
  });

  // 2. Survival harvest on beast / monstrosity remains.
  const monsterType = monster?.monsterData?.type;
  if (monsterType && (CORPSE_HARVEST_CREATURE_TYPES as readonly string[]).includes(monsterType)) {
    const survivalBonus = getActorCheckBonus(actor, 'survival');
    const survRoll = rollD20(nextState.rngState, { modifier: survivalBonus, mode: 'normal' });
    nextState.rngState = survRoll.nextState;
    const survSuccess = survRoll.total >= dc;
    const harvestCount = 1 + Math.floor(cr / 2);
    if (survSuccess) {
      const target = nextState.props.find((p) => p.id === propId)!;
      target.lootTable = mergeLootBundles(target.lootTable ?? {}, {
        items: Array.from({ length: harvestCount }, () => CORPSE_HARVEST_ITEM_ID),
        origin: MONSTER_DROP_ORIGIN,
        sourceName: monster?.name ?? target.label,
      });
    }
    events.push({
      type: 'CHECK_RESOLVED',
      actorId,
      checkType: 'survival',
      targetId: prop.id,
      dc,
      roll: survRoll.naturalRoll,
      modifier: survivalBonus,
      total: survRoll.total,
      success: survSuccess,
      note: survSuccess
        ? `Field Dressing (Survival): +${harvestCount} ${CORPSE_HARVEST_ITEM_ID.replace(/-/g, ' ')} harvested from the ${monsterType}.`
        : `Field Dressing (Survival): the ${monsterType} carcass yields nothing usable.`,
    });
  }

  const target = nextState.props.find((p) => p.id === propId)!;
  target.searched = true;
  return { nextState, events };
}

export interface SweepCorpseLootResult {
  nextState: GameState;
  events: GameEvent[];
  /** Corpse prop ids swept (for tests / callers). */
  sweptPropIds: string[];
}

/**
 * Floor-exit sweep (Spec 12 §11.2): auto-collects every unclaimed corpse
 * drop into the party so loot is never silently lost on forgotten bodies.
 * Round-robins bundles across conscious heroes (deterministic by hero id),
 * clears each corpse loot table, and emits one `LOOT_ACQUIRED` per corpse
 * carrying the original `monster_drop` provenance.
 */
export function sweepUnclaimedCorpseLoot(
  state: GameState,
  compendium: SrdCompendium = defaultCompendium,
): SweepCorpseLootResult {
  const lootable = state.props.filter((p) => p.kind === 'corpse' && hasClaimableLoot(p.lootTable));
  if (lootable.length === 0) {
    return { nextState: state, events: [], sweptPropIds: [] };
  }
  const recipients = Object.values(state.party)
    .filter((h) => !h.isDead && h.currentHp > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (recipients.length === 0) {
    return { nextState: state, events: [], sweptPropIds: [] };
  }

  const nextState = structuredClone(state);
  const events: GameEvent[] = [];
  const sweptPropIds: string[] = [];

  lootable.forEach((corpse, index) => {
    const hero = recipients[index % recipients.length]!;
    const target = nextState.props.find((p) => p.id === corpse.id)!;
    const bundle = structuredClone(target.lootTable!);
    target.lootTable = undefined;
    sweptPropIds.push(corpse.id);

    const partyHero = nextState.party[hero.id];
    if (!partyHero?.buildState) return;
    const prefix = `sweep-${corpse.id}`;
    const nextBuild = awardLootToCharacter(partyHero.buildState, bundle, compendium, prefix);
    const nextSheet = computeDerivedCharacter(nextBuild, compendium);
    nextState.party[hero.id] = {
      ...partyHero,
      buildState: nextBuild,
      characterSheet: nextSheet,
    };
    events.push({ type: 'LOOT_ACQUIRED', actorId: hero.id, propId: corpse.id, loot: bundle });
    events.push({
      type: 'INVENTORY_UPDATED',
      characterId: hero.id,
      inventory: nextBuild.inventory,
      currency: nextBuild.currency,
    });
  });

  return { nextState, events, sweptPropIds };
}

/** Deterministic instance stub (tests): explicit ids, no clock/random. */
export function makeCorpseLootInstance(
  itemId: string,
  instanceId: string,
  compendium: SrdCompendium = defaultCompendium,
): InventoryItemInstance {
  return {
    instanceId,
    itemId,
    quantity: 1,
    isMagicItem: Boolean(compendium.getMagicItem(itemId)),
    identified: true,
  };
}
