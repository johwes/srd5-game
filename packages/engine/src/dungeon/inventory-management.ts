import {
  type CharacterBuildState,
  type EquippedSlots,
  type InventoryItemInstance,
  type SrdCompendium,
  type WeaponSetId,
  defaultCompendium,
  getWeaponSetSlotIds,
} from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import { type GameEvent, type GameState } from '../state/types.js';

/**
 * SRD-1306: Stretch inventory management — trade/give, drop, stack
 * splitting, identification, dungeon sell-back, weight display, and equip
 * restriction enforcement (Spec 12 §8, §10 phase 4).
 *
 * All functions are pure and deterministic: no `Math.random()` — split-off
 * instance ids derive deterministically from the source instance id so
 * headless replays stay bit-exact. Callers thread `GameState.rngState`
 * only where a seeded roll is genuinely needed (none of these paths roll;
 * identification and transfers are deterministic bookkeeping).
 */

// ---------------------------------------------------------------------------
// Weight display vs enforcement (display only — enforcement stays out of
// scope per Spec 12 §8/§12).
// ---------------------------------------------------------------------------

/** Weight in lb for one unit of an item (magic items ride their base item). */
export function getItemWeightLb(
  itemId: string,
  compendium: SrdCompendium = defaultCompendium,
): number {
  const equip = compendium.getEquipment(itemId);
  if (equip) return equip.weightLb;
  const magic = compendium.getMagicItem(itemId);
  if (magic?.baseEquipmentId) {
    return compendium.getEquipment(magic.baseEquipmentId)?.weightLb ?? 0;
  }
  return 0;
}

/** Quantity-aware total carried weight (lb, 2dp). */
export function getInventoryWeightLb(
  inventory: readonly InventoryItemInstance[],
  compendium: SrdCompendium = defaultCompendium,
): number {
  let total = 0;
  for (const inst of inventory) {
    total += getItemWeightLb(inst.itemId, compendium) * inst.quantity;
  }
  return Math.round(total * 100) / 100;
}

/** SRD 5.1 carrying capacity (lb) = STR score × 15. */
export function getCarryingCapacityLb(strScore: number): number {
  return Math.max(0, strScore) * 15;
}

export type EncumbranceVariant = 'none' | 'encumbered' | 'heavily_encumbered';

export interface EncumbranceStatus {
  totalWeightLb: number;
  capacityLb: number;
  /** Over the STR×15 capacity (PHB hard cap display). */
  encumbered: boolean;
  overCapacityByLb: number;
  /**
   * PHB §7 variant thresholds for display only: encumbered past 5×STR,
   * heavily past 10×STR. Enforcement (speed penalties) stays out of scope
   * per Spec 12 §12 — surfaced here so the HUD can badge without blocking.
   */
  variant: EncumbranceVariant;
  /** STR score the capacity was computed from. */
  strScore: number;
}

/**
 * Display-only encumbrance readout. Never blocks — callers must not reject
 * transfers/equips on weight grounds (Spec 12 §12 non-goal).
 */
export function getEncumbranceStatus(
  buildState: CharacterBuildState,
  compendium: SrdCompendium = defaultCompendium,
): EncumbranceStatus {
  const sheet = computeDerivedCharacter(buildState, compendium);
  const strScore = sheet.abilities.str.score;
  const totalWeightLb = getInventoryWeightLb(buildState.inventory, compendium);
  const capacityLb = getCarryingCapacityLb(strScore);
  const encumbered = totalWeightLb > capacityLb;
  const variant: EncumbranceVariant =
    totalWeightLb > strScore * 10
      ? 'heavily_encumbered'
      : totalWeightLb > strScore * 5
        ? 'encumbered'
        : 'none';
  return {
    totalWeightLb,
    capacityLb,
    encumbered,
    overCapacityByLb: encumbered ? Math.round((totalWeightLb - capacityLb) * 100) / 100 : 0,
    variant,
    strScore,
  };
}

// ---------------------------------------------------------------------------
// Equip restriction enforcement (STR requirement + proficiency).
// ---------------------------------------------------------------------------

export interface EquipIssue {
  slot: string;
  itemId: string;
  code:
    | 'missing_item'
    | 'slot_mismatch'
    | 'armor_proficiency_missing'
    | 'shield_proficiency_missing'
    | 'strength_requirement_unmet'
    | 'weapon_proficiency_missing';
  message: string;
}

export interface EquipValidation {
  ok: boolean;
  /** Blocking errors — the reducer rejects the loadout. */
  errors: EquipIssue[];
  /** Non-blocking warnings — allowed (speed/attack penalties apply). */
  warnings: EquipIssue[];
}

const ARMOR_CATEGORY_TO_PROFICIENCY: Record<string, string> = {
  light: 'light-armor',
  medium: 'medium-armor',
  heavy: 'heavy-armor',
  shield: 'shields',
};

function normalizeProficiencyId(id: string): string {
  return id.trim().toLowerCase();
}

/** True when the armor proficiency list covers an armor category. */
export function isArmorProficient(
  armorProficiencies: readonly string[],
  armorCategory: string,
): boolean {
  const needed = ARMOR_CATEGORY_TO_PROFICIENCY[armorCategory.toLowerCase()];
  if (!needed) return false;
  const set = new Set(armorProficiencies.map(normalizeProficiencyId));
  return set.has(needed);
}

/**
 * True when the weapon proficiency list covers a mundane weapon:
 * `simple-weapons` / `martial-weapons` category grants, or a specific
 * weapon id/name grant (e.g. druid's `scimitar`, bard's `longsword`).
 */
export function isWeaponProficient(
  weaponProficiencies: readonly string[],
  weaponCategory: string,
  weaponId: string,
  weaponName?: string,
): boolean {
  const set = new Set(weaponProficiencies.map(normalizeProficiencyId));
  const categoryGrant =
    weaponCategory === 'simple' ? 'simple-weapons' : weaponCategory === 'martial' ? 'martial-weapons' : null;
  if (categoryGrant && set.has(categoryGrant)) return true;
  const slug = weaponId.trim().toLowerCase();
  if (set.has(slug)) return true;
  if (weaponName && set.has(weaponName.trim().toLowerCase())) return true;
  return false;
}

function equippedSlotTarget(
  slots: Record<string, string | undefined>,
  slot: 'armor' | 'shield' | 'mainHand' | 'offHand' | 'ranged',
): string | undefined {
  return slots[slot] ?? slots[`${slot}InstanceId`];
}

function candidateSlotsForItemId(
  itemId: string,
  compendium: SrdCompendium,
): Array<'armor' | 'shield' | 'mainHand' | 'offHand' | 'ranged'> {
  const magic = compendium.getMagicItem(itemId);
  if (magic?.baseEquipmentId) return candidateSlotsForItemId(magic.baseEquipmentId, compendium);
  if (magic) {
    // Magic weapons/armor declare their category directly.
    if (magic.category === 'weapon') return ['mainHand', 'offHand'];
    if (magic.category === 'armor') {
      const base = magic.baseEquipmentId ? compendium.getEquipment(magic.baseEquipmentId) : undefined;
      if (base?.kind === 'armor') {
        return base.category === 'shield' ? ['shield'] : ['armor'];
      }
      return ['armor'];
    }
    return [];
  }
  const equip = compendium.getEquipment(itemId);
  if (!equip) return [];
  if (equip.kind === 'armor') return equip.category === 'shield' ? ['shield'] : ['armor'];
  if (equip.kind === 'weapon') {
    // Thrown melee weapons (dagger, handaxe, ...) double as ranged weapons:
    // the sheet drawer, paperdoll, pregens, and derived ranged profiles all
    // treat them as valid ranged-slot occupants.
    if (equip.rangeType === 'ranged') return ['ranged', 'mainHand', 'offHand'];
    if (equip.properties.includes('thrown')) return ['mainHand', 'offHand', 'ranged'];
    return ['mainHand', 'offHand'];
  }
  return [];
}

/**
 * Validates a full loadout against inventory contents, slot fit, armor/shield
 * proficiency (blocking), and STR requirements / weapon proficiency
 * (non-blocking warnings — SRD applies speed/attack penalties instead).
 *
 * SRD-1703: both weapon sets are validated (slot fit + proficiency apply to
 * the inactive set too). Error `slot` values are prefixed with the set
 * (`primary:mainHand`, `secondary:ranged`) for weapon slots; armor/shield
 * slots keep their bare names.
 */
export function validateEquipLoadout(
  buildState: CharacterBuildState,
  equippedSlots: EquippedSlots | Record<string, string | undefined>,
  compendium: SrdCompendium = defaultCompendium,
): EquipValidation {
  const errors: EquipIssue[] = [];
  const warnings: EquipIssue[] = [];
  const sheet = computeDerivedCharacter(buildState, compendium);
  const proficiencies = sheet.proficiencies;
  const strScore = sheet.abilities.str.score;
  const byId = new Map(buildState.inventory.map((i) => [i.instanceId, i]));
  const slots = equippedSlots as Partial<EquippedSlots>;

  const checkSlot = (
    label: string,
    slot: 'armor' | 'shield' | 'mainHand' | 'offHand' | 'ranged',
    instanceId: string | undefined,
  ): void => {
    if (!instanceId) return;
    const inst = byId.get(instanceId);
    if (!inst) {
      errors.push({
        slot: label,
        itemId: instanceId,
        code: 'missing_item',
        message: `${label}: instance '${instanceId}' is not in inventory`,
      });
      return;
    }
    const fit = candidateSlotsForItemId(inst.itemId, compendium);
    if (fit.length > 0 && !fit.includes(slot)) {
      errors.push({
        slot: label,
        itemId: inst.itemId,
        code: 'slot_mismatch',
        message: `${label}: '${inst.itemId}' cannot go there (fits: ${fit.join(', ')})`,
      });
      return;
    }
    // Resolve the effective mundane record (magic items ride a base item).
    const magic = compendium.getMagicItem(inst.itemId);
    const mundane = magic?.baseEquipmentId
      ? compendium.getEquipment(magic.baseEquipmentId)
      : compendium.getEquipment(inst.itemId);
    const effectiveArmor =
      mundane?.kind === 'armor'
        ? mundane
        : magic?.category === 'armor' && !mundane
          ? { kind: 'armor' as const, category: 'heavy' as const, strengthRequirement: undefined as number | undefined }
          : null;
    if (effectiveArmor) {
      const category = (effectiveArmor as { category: string }).category;
      if (!isArmorProficient(proficiencies.armor, category)) {
        errors.push({
          slot: label,
          itemId: inst.itemId,
          code: category === 'shield' ? 'shield_proficiency_missing' : 'armor_proficiency_missing',
          message: `${label}: missing ${category} armor proficiency for '${inst.itemId}'`,
        });
      }
      const req = (effectiveArmor as { strengthRequirement?: number }).strengthRequirement;
      if (req !== undefined && strScore < req) {
        warnings.push({
          slot: label,
          itemId: inst.itemId,
          code: 'strength_requirement_unmet',
          message: `${label}: STR ${strScore} below requirement ${req} for '${inst.itemId}' (−10 ft speed)`,
        });
      }
    }
    const effectiveWeapon =
      mundane?.kind === 'weapon'
        ? mundane
        : magic?.category === 'weapon' && !mundane
          ? { category: 'martial' as const, name: magic.name }
          : null;
    if (effectiveWeapon) {
      const proficient = isWeaponProficient(
        proficiencies.weapons,
        (effectiveWeapon as { category: string }).category,
        inst.itemId,
        (effectiveWeapon as { name?: string }).name,
      );
      if (!proficient) {
        warnings.push({
          slot: label,
          itemId: inst.itemId,
          code: 'weapon_proficiency_missing',
          message: `${label}: not proficient with '${inst.itemId}' (attacks without proficiency bonus)`,
        });
      }
    }
  };

  // Armor/shield are shared across sets — validate once under bare names.
  checkSlot('armor', 'armor', equippedSlotTarget(slots, 'armor'));
  checkSlot('shield', 'shield', equippedSlotTarget(slots, 'shield'));

  // Each weapon set validates independently; weapon labels carry the set.
  const weaponSlots = ['mainHand', 'offHand', 'ranged'] as const;
  (['primary', 'secondary'] as const).forEach((set: WeaponSetId) => {
    const ids = getWeaponSetSlotIds(slots, set);
    for (const slot of weaponSlots) {
      const key = `${slot}InstanceId` as const;
      checkSlot(`${set}:${slot}`, slot, ids[key]);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Stack splitting (deterministic — no RNG).
// ---------------------------------------------------------------------------

export interface SplitStackResult {
  nextInventory: InventoryItemInstance[];
  /** The newly created split-off instance. */
  splitInstance: InventoryItemInstance;
}

/**
 * Splits `splitQuantity` units off an existing stack into a new deterministic
 * instance (`${instanceId}-split-${splitQuantity}`, de-duplicated with a
 * numeric suffix when already taken).
 */
export function splitInventoryStack(
  inventory: readonly InventoryItemInstance[],
  instanceId: string,
  splitQuantity: number,
  newInstanceId?: string,
): SplitStackResult {
  if (!Number.isInteger(splitQuantity) || splitQuantity < 1) {
    throw new Error(`Split quantity must be a positive integer (got ${splitQuantity})`);
  }
  const idx = inventory.findIndex((i) => i.instanceId === instanceId);
  if (idx < 0) throw new Error(`Inventory instance '${instanceId}' not found`);
  const source = inventory[idx]!;
  if (source.quantity <= 1) {
    throw new Error(`Cannot split '${instanceId}': quantity is ${source.quantity}`);
  }
  if (splitQuantity >= source.quantity) {
    throw new Error(
      `Split quantity ${splitQuantity} must be less than stack quantity ${source.quantity}`,
    );
  }
  const takenIds = new Set(inventory.map((i) => i.instanceId));
  let candidate = newInstanceId ?? `${instanceId}-split-${splitQuantity}`;
  if (takenIds.has(candidate)) {
    let n = 2;
    while (takenIds.has(`${candidate}-${n}`)) n += 1;
    candidate = `${candidate}-${n}`;
  }
  const splitInstance: InventoryItemInstance = {
    ...source,
    instanceId: candidate,
    quantity: splitQuantity,
  };
  const nextInventory = inventory.map((inst, i) =>
    i === idx ? { ...inst, quantity: inst.quantity - splitQuantity } : inst,
  );
  nextInventory.push(splitInstance);
  return { nextInventory, splitInstance };
}

// ---------------------------------------------------------------------------
// Give / drop / identify / dungeon sell-back (GameState-level helpers).
// ---------------------------------------------------------------------------

function requirePartyMember(state: GameState, characterId: string) {
  const hero = state.party[characterId];
  if (!hero?.buildState) throw new Error(`Character '${characterId}' not found in party`);
  return hero;
}

function refreshHero(hero: GameState['party'][string], compendium: SrdCompendium) {
  const nextSheet = computeDerivedCharacter(hero.buildState!, compendium);
  return { ...hero, buildState: hero.buildState, characterSheet: nextSheet };
}

export interface TransferItemResult {
  nextState: GameState;
  events: GameEvent[];
  movedInstanceId: string;
  movedQuantity: number;
}

/**
 * Gives (trades) `quantity` units of an instance from one hero to another.
 * Full-stack moves preserve the instance id; partial moves split off a
 * deterministic `${instanceId}-gift-${quantity}` stack for the recipient.
 * Equipped/attuned instances cannot be transferred while equipped.
 */
export function transferInventoryItem(
  state: GameState,
  fromCharacterId: string,
  toCharacterId: string,
  itemInstanceId: string,
  quantity?: number,
  compendium: SrdCompendium = defaultCompendium,
): TransferItemResult {
  if (fromCharacterId === toCharacterId) {
    throw new Error('Cannot transfer an item to the same character');
  }
  const from = requirePartyMember(state, fromCharacterId);
  const to = requirePartyMember(state, toCharacterId);
  const fromInv = [...from.buildState!.inventory];
  const idx = fromInv.findIndex((i) => i.instanceId === itemInstanceId);
  if (idx < 0) throw new Error(`Instance '${itemInstanceId}' not found on '${fromCharacterId}'`);
  const equippedIds = new Set(
    Object.values(from.buildState!.equippedSlots ?? {}).filter(Boolean) as string[],
  );
  if (equippedIds.has(itemInstanceId)) {
    throw new Error(`Cannot transfer '${itemInstanceId}': unequip it first`);
  }
  const source = fromInv[idx]!;
  const qty = quantity ?? source.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > source.quantity) {
    throw new Error(`Transfer quantity ${quantity} out of range (stack has ${source.quantity})`);
  }

  const toInv = [...to.buildState!.inventory];
  let movedInstanceId = itemInstanceId;
  if (qty === source.quantity) {
    fromInv.splice(idx, 1);
    const stackable =
      (source.itemId.startsWith('potion-') || source.itemId.startsWith('scroll-')) &&
      source.identified !== false;
    const existingIdx = stackable
      ? toInv.findIndex((i) => i.itemId === source.itemId && i.identified !== false)
      : -1;
    if (existingIdx >= 0) {
      const existing = toInv[existingIdx]!;
      toInv[existingIdx] = { ...existing, quantity: existing.quantity + qty };
      movedInstanceId = existing.instanceId;
    } else {
      toInv.push({ ...source });
    }
  } else {
    fromInv[idx] = { ...source, quantity: source.quantity - qty };
    let giftId = `${itemInstanceId}-gift-${qty}`;
    const taken = new Set([...fromInv.map((i) => i.instanceId), ...toInv.map((i) => i.instanceId)]);
    if (taken.has(giftId)) {
      let n = 2;
      while (taken.has(`${giftId}-${n}`)) n += 1;
      giftId = `${giftId}-${n}`;
    }
    const gift: InventoryItemInstance = { ...source, instanceId: giftId, quantity: qty };
    const existingIdx = toInv.findIndex((i) => i.itemId === source.itemId && i.identified !== false);
    if (existingIdx >= 0 && source.itemId.startsWith('potion-')) {
      const existing = toInv[existingIdx]!;
      toInv[existingIdx] = { ...existing, quantity: existing.quantity + qty };
      movedInstanceId = existing.instanceId;
    } else {
      toInv.push(gift);
      movedInstanceId = giftId;
    }
  }

  const nextParty = {
    ...state.party,
    [fromCharacterId]: refreshHero(
      { ...from, buildState: { ...from.buildState!, inventory: fromInv } },
      compendium,
    ),
    [toCharacterId]: refreshHero(
      { ...to, buildState: { ...to.buildState!, inventory: toInv } },
      compendium,
    ),
  };
  const nextState: GameState = { ...state, party: nextParty };
  const events: GameEvent[] = [
    {
      type: 'INVENTORY_UPDATED',
      characterId: fromCharacterId,
      inventory: nextParty[fromCharacterId]!.buildState!.inventory,
      currency: nextParty[fromCharacterId]!.buildState!.currency,
    },
    {
      type: 'INVENTORY_UPDATED',
      characterId: toCharacterId,
      inventory: nextParty[toCharacterId]!.buildState!.inventory,
      currency: nextParty[toCharacterId]!.buildState!.currency,
    },
  ];
  return { nextState, events, movedInstanceId, movedQuantity: qty };
}

export interface DropItemResult {
  nextState: GameState;
  events: GameEvent[];
  droppedItemId: string;
  droppedQuantity: number;
}

/**
 * Drops (discards) `quantity` units of an instance — unequipping and
 * unattuning it first so no dangling slot/attunement references remain.
 * Dropped gear leaves the party (floor stash / discard pile abstraction).
 */
export function dropInventoryItem(
  state: GameState,
  characterId: string,
  itemInstanceId: string,
  quantity?: number,
  compendium: SrdCompendium = defaultCompendium,
): DropItemResult {
  const hero = requirePartyMember(state, characterId);
  const build = hero.buildState!;
  const idx = build.inventory.findIndex((i) => i.instanceId === itemInstanceId);
  if (idx < 0) throw new Error(`Instance '${itemInstanceId}' not found on '${characterId}'`);
  const source = build.inventory[idx]!;
  const qty = quantity ?? source.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > source.quantity) {
    throw new Error(`Drop quantity ${quantity} out of range (stack has ${source.quantity})`);
  }

  let nextInventory = [...build.inventory];
  if (qty === source.quantity) {
    nextInventory.splice(idx, 1);
  } else {
    nextInventory[idx] = { ...source, quantity: source.quantity - qty };
  }

  // Clear equipped slots + attunement pointing at a fully-dropped instance.
  let nextSlots = { ...build.equippedSlots };
  if (qty === source.quantity) {
    for (const [slot, instId] of Object.entries(nextSlots)) {
      if (instId === itemInstanceId) delete (nextSlots as Record<string, string | undefined>)[slot];
    }
  }
  let nextAttuned = [...(build.attunedItemInstanceIds ?? [])];
  if (qty === source.quantity && nextAttuned.includes(itemInstanceId)) {
    nextAttuned = nextAttuned.filter((id) => id !== itemInstanceId);
  }

  const nextBuild: CharacterBuildState = {
    ...build,
    inventory: nextInventory,
    equippedSlots: nextSlots,
    attunedItemInstanceIds: nextAttuned,
  };
  const nextParty = {
    ...state.party,
    [characterId]: refreshHero({ ...hero, buildState: nextBuild }, compendium),
  };
  const nextState: GameState = { ...state, party: nextParty };
  const events: GameEvent[] = [
    {
      type: 'INVENTORY_UPDATED',
      characterId,
      inventory: nextInventory,
      currency: nextBuild.currency,
    },
  ];
  return { nextState, events, droppedItemId: source.itemId, droppedQuantity: qty };
}

export interface IdentifyInventoryItemResult {
  nextState: GameState;
  events: GameEvent[];
}

/**
 * Dungeon identification flow: handling a find during a rest/watch reveals
 * its properties (free — the short-rest handling abstraction, distinct from
 * the settlement gold-cost `identifyMagicItem`). Unidentified items show a
 * masked name in the grid until this runs.
 */
export function identifyInventoryItem(
  state: GameState,
  characterId: string,
  itemInstanceId: string,
  compendium: SrdCompendium = defaultCompendium,
): IdentifyInventoryItemResult {
  const hero = requirePartyMember(state, characterId);
  const idx = hero.buildState!.inventory.findIndex((i) => i.instanceId === itemInstanceId);
  if (idx < 0) throw new Error(`Instance '${itemInstanceId}' not found on '${characterId}'`);
  const inst = hero.buildState!.inventory[idx]!;
  if (inst.identified === true) {
    throw new Error(`'${inst.itemId}' is already identified`);
  }
  const nextInventory = hero.buildState!.inventory.map((entry, i) =>
    i === idx ? { ...entry, identified: true } : entry,
  );
  const nextBuild: CharacterBuildState = { ...hero.buildState!, inventory: nextInventory };
  const nextParty = {
    ...state.party,
    [characterId]: refreshHero({ ...hero, buildState: nextBuild }, compendium),
  };
  return {
    nextState: { ...state, party: nextParty },
    events: [
      {
        type: 'INVENTORY_UPDATED',
        characterId,
        inventory: nextInventory,
        currency: nextBuild.currency,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Dungeon sell-back (half value, no shop required).
// ---------------------------------------------------------------------------

/** Best-effort base price (gp) for any SRD item id. */
export function getItemBasePriceGp(
  itemId: string,
  compendium: SrdCompendium = defaultCompendium,
): number | undefined {
  const equip = compendium.getEquipment(itemId);
  if (equip) return equip.costCopper / 100;
  const magic = compendium.getMagicItem(itemId);
  if (magic?.baseEquipmentId) {
    const base = compendium.getEquipment(magic.baseEquipmentId);
    if (base) return base.costCopper / 100;
  }
  // DMG-guideline fallback by rarity for pure magic items.
  if (magic) {
    switch (magic.rarity) {
      case 'common':
        return 75;
      case 'uncommon':
        return 250;
      case 'rare':
        return 2500;
      case 'very_rare':
        return 15000;
      case 'legendary':
        return 50000;
      case 'artifact':
        return 100000;
    }
  }
  return undefined;
}

/** Dungeon sell-back value: half base, minimum 1 gp per unit. */
export function getDungeonSellValueGp(
  itemId: string,
  compendium: SrdCompendium = defaultCompendium,
): number {
  const base = getItemBasePriceGp(itemId, compendium);
  if (base === undefined) throw new Error(`'${itemId}' has no sellable value`);
  return Math.max(1, Math.floor(base / 2));
}

export interface SellItemResult {
  nextState: GameState;
  events: GameEvent[];
  goldEarned: number;
}

/**
 * Sells `quantity` units of an instance back for camp supplies (dungeon
 * sell-back at half value). Equipped/attuned instances must be
 * unequipped first; proceeds land directly in the seller's purse.
 */
export function sellInventoryItem(
  state: GameState,
  characterId: string,
  itemInstanceId: string,
  quantity?: number,
  compendium: SrdCompendium = defaultCompendium,
): SellItemResult {
  const hero = requirePartyMember(state, characterId);
  const build = hero.buildState!;
  const idx = build.inventory.findIndex((i) => i.instanceId === itemInstanceId);
  if (idx < 0) throw new Error(`Instance '${itemInstanceId}' not found on '${characterId}'`);
  const source = build.inventory[idx]!;
  const equippedIds = new Set(Object.values(build.equippedSlots ?? {}).filter(Boolean) as string[]);
  if (equippedIds.has(itemInstanceId)) {
    throw new Error(`Cannot sell '${itemInstanceId}': unequip it first`);
  }
  const qty = quantity ?? source.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > source.quantity) {
    throw new Error(`Sell quantity ${quantity} out of range (stack has ${source.quantity})`);
  }
  const unitValue = getDungeonSellValueGp(source.itemId, compendium);
  const goldEarned = unitValue * qty;

  let nextInventory = [...build.inventory];
  if (qty === source.quantity) {
    nextInventory.splice(idx, 1);
  } else {
    nextInventory[idx] = { ...source, quantity: source.quantity - qty };
  }
  let nextAttuned = [...(build.attunedItemInstanceIds ?? [])];
  if (qty === source.quantity && nextAttuned.includes(itemInstanceId)) {
    nextAttuned = nextAttuned.filter((id) => id !== itemInstanceId);
  }
  const nextBuild: CharacterBuildState = {
    ...build,
    inventory: nextInventory,
    attunedItemInstanceIds: nextAttuned,
    currency: { ...build.currency, gp: build.currency.gp + goldEarned },
  };
  const nextParty = {
    ...state.party,
    [characterId]: refreshHero({ ...hero, buildState: nextBuild }, compendium),
  };
  return {
    nextState: { ...state, party: nextParty },
    events: [
      {
        type: 'INVENTORY_UPDATED',
        characterId,
        inventory: nextInventory,
        currency: nextBuild.currency,
      },
    ],
    goldEarned,
  };
}
