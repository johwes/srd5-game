import {
  createCompendium,
  type ActivatedAbilitySpec,
  type EffectStepSpec,
  type InventoryItemInstance,
  type SrdCompendium,
} from '@srd5/data';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import { applyDamage, applyHealing } from '../combat/damage.js';
import { applyConditionToCombatant } from '../combat/conditions.js';
import {
  executeSpellCast,
  getTargetSavingThrowBonus,
} from '../combat/spellcasting.js';
import { evaluateCombatVictory } from '../combat/state-machine.js';
import type {
  CombatEvent,
  CombatState,
  Combatant,
} from '../combat/types.js';
import { getReligionHealingReceivedBonusFor } from '../skills/skill-passives.js';
import {
  type GameEvent,
  type GameState,
} from '../state/types.js';

let defaultCompendium: SrdCompendium | null = null;
function getDefaultCompendium(): SrdCompendium {
  if (!defaultCompendium) {
    defaultCompendium = createCompendium();
  }
  return defaultCompendium;
}

export interface UseItemCommand {
  actorId: string;
  itemInstanceId: string;
  targetId?: string;
}

export interface UseItemResult {
  nextState: GameState;
  events: GameEvent[];
}

/**
 * SRD-1303: maps a `scroll-of-<spell>` item id to its inscribed spell id.
 * Returns null for non-scroll items.
 */
export function resolveScrollSpellId(itemId: string): string | null {
  if (!itemId.startsWith('scroll-of-')) return null;
  const suffix = itemId.slice('scroll-of-'.length);
  if (!suffix) return null;
  return suffix;
}

/**
 * SRD-1303: scroll save DC rule. Spell scrolls carry a fixed DC in their
 * description (e.g. Scroll of Fireball "Save DC 15"). Parse it when present,
 * otherwise fall back to the caster's DC.
 */
export function parseScrollSaveDc(description: string | undefined, fallback: number): number {
  if (!description) return fallback;
  const m = /Save DC\s+(\d{1,2})/i.exec(description);
  if (m) {
    const parsed = parseInt(m[1]!, 10);
    if (Number.isFinite(parsed) && parsed >= 5 && parsed <= 25) return parsed;
  }
  return fallback;
}

function formulaVarsFor(actor: Combatant): Record<string, number> {
  return {
    '@classLevel': actor.characterSheet?.classes?.[0]?.level ?? 1,
    '@charLevel': actor.characterSheet?.totalLevel ?? 1,
    '@strMod': actor.strengthModifier ?? 0,
    '@dexMod': actor.dexterityModifier ?? 0,
    '@conMod': actor.characterSheet?.abilities?.con
      ? Math.floor((actor.characterSheet.abilities.con.score - 10) / 2)
      : 0,
    '@chaMod': actor.characterSheet?.abilities?.cha
      ? Math.floor((actor.characterSheet.abilities.cha.score - 10) / 2)
      : 0,
    '@wisMod': actor.characterSheet?.abilities?.wis
      ? Math.floor((actor.characterSheet.abilities.wis.score - 10) / 2)
      : 0,
    '@intMod': actor.characterSheet?.abilities?.int
      ? Math.floor((actor.characterSheet.abilities.int.score - 10) / 2)
      : 0,
    '@prof': actor.characterSheet?.proficiencyBonus ?? 2,
    '@spellSaveDC': actor.characterSheet?.spellcasting?.classes?.[0]?.spellSaveDc ?? 13,
    '@spellMod': actor.characterSheet?.spellcasting?.classes?.[0]?.abilityModifier ?? 0,
  };
}

/**
 * SRD-1303: improvised-weapon attack bonus for thrown consumables
 * (acid vial / alchemist's fire). SRD treats the throw as an improvised
 * ranged weapon attack: DEX mod + proficiency.
 */
export function getImprovisedThrownAttackBonus(actor: Combatant): number {
  const dex =
    actor.dexterityModifier ??
    (actor.characterSheet?.abilities?.dex
      ? Math.floor((actor.characterSheet.abilities.dex.score - 10) / 2)
      : 0);
  const prof = actor.characterSheet?.proficiencyBonus ?? 2;
  return dex + prof;
}

function findInstance(
  inventory: InventoryItemInstance[],
  itemInstanceId: string,
): { instance: InventoryItemInstance; index: number; matchedByItemId: boolean } | null {
  const byInstance = inventory.findIndex((i) => i.instanceId === itemInstanceId);
  if (byInstance >= 0) {
    return { instance: inventory[byInstance]!, index: byInstance, matchedByItemId: false };
  }
  // Back-compat fallback: older hotbar buttons dispatch the catalog item id
  // instead of the instance id. Resolve the first matching stack so those
  // buttons keep working after the engine starts enforcing instance ids.
  const byItem = inventory.findIndex((i) => i.itemId === itemInstanceId);
  if (byItem >= 0) {
    return { instance: inventory[byItem]!, index: byItem, matchedByItemId: true };
  }
  return null;
}

function getItemAbility(
  itemId: string,
  compendium: SrdCompendium,
): { ability: ActivatedAbilitySpec | undefined; itemName: string; description: string; chargesMax?: number; rechargeFormula?: string; category?: string } {
  const magic = compendium.getMagicItem(itemId);
  if (magic) {
    return {
      ability: magic.activatedAbilities?.[0],
      itemName: magic.name,
      description: magic.description,
      chargesMax: magic.charges?.max,
      rechargeFormula: magic.charges?.rechargeFormula,
      category: magic.category,
    };
  }
  const equip = compendium.getEquipment(itemId) as unknown as
    | { name?: string; description?: string; activatedAbilities?: ActivatedAbilitySpec[] }
    | undefined;
  return {
    ability: equip?.activatedAbilities?.[0],
    itemName: equip?.name ?? itemId,
    description: equip?.description ?? '',
    category: undefined,
  };
}

/**
 * Finds the inventory instance granting an activated ability id.
 *
 * The derived sheet merges item-granted abilities (potions, scrolls, wands,
 * charged gear) into `activatedAbilities` with no source tag, so a bare
 * `USE_CLASS_FEATURE` would trigger them for free (no stack decrement, no
 * charge decrement). Callers must route item-granted abilities through
 * `USE_ITEM`; this helper identifies them. Returns the granting instance or
 * `undefined` when no carried item grants the ability (class/race/feat
 * abilities resolve normally).
 */
export function findInventoryItemGrantingAbility(
  inventory: readonly InventoryItemInstance[],
  abilityId: string,
  compendium?: SrdCompendium,
): { instanceId: string; itemId: string; itemName: string } | undefined {
  const comp = compendium ?? getDefaultCompendium();
  for (const inst of inventory) {
    const magic = comp.getMagicItem(inst.itemId);
    const abilities = magic
      ? (magic.activatedAbilities ?? [])
      : (
          (comp.getEquipment(inst.itemId) as unknown as
            | { activatedAbilities?: ActivatedAbilitySpec[] }
            | undefined)?.activatedAbilities ?? []
        );
    if (abilities.some((ability) => ability.id === abilityId)) {
      const itemName = magic?.name ?? inst.itemId;
      return { instanceId: inst.instanceId, itemId: inst.itemId, itemName };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Combat-mode ability executor (heal / buff / attack_roll -> damage / saves)
// ---------------------------------------------------------------------------

interface CombatExecContext {
  combatantsMap: Record<string, Combatant>;
  rng: number;
  events: CombatEvent[];
  actor: Combatant;
  abilityName: string;
  grid: GameState['grid'];
  combatState: CombatState;
}

function executeStepsCombat(
  ctx: CombatExecContext,
  steps: EffectStepSpec[],
  target: Combatant,
): void {
  for (const step of steps) {
    if (step.step === 'apply_active_effect') {
      const current = target.activeEffects ? [...target.activeEffects] : [];
      const next = {
        effectId: step.effectId,
        name: step.name,
        requiresConcentration: step.requiresConcentration,
        remainingRounds: step.durationRounds,
        modifiers: step.modifiers,
      };
      target.activeEffects = [...current.filter((e) => e.effectId !== step.effectId), next];
      ctx.combatantsMap[target.id] = { ...target };
    } else if (step.step === 'heal') {
      const vars = formulaVarsFor(ctx.actor);
      const rollRes = rollDamage(ctx.rng, step.diceFormula, { context: vars });
      ctx.rng = rollRes.nextState;
      const healApplied = applyHealing({
        state: { ...ctx.combatState, combatants: ctx.combatantsMap, rngState: ctx.rng },
        targetId: target.id,
        amount: rollRes.total,
        sourceName: ctx.abilityName,
      });
      ctx.rng = healApplied.state.rngState;
      ctx.combatantsMap[target.id] = healApplied.state.combatants[target.id]!;
      ctx.events.push(...healApplied.events);
    } else if (step.step === 'grant_temp_hp') {
      const vars = formulaVarsFor(ctx.actor);
      const rollRes = rollDamage(ctx.rng, step.amountFormula, { context: vars });
      ctx.rng = rollRes.nextState;
      const before = target.tempHp;
      target.tempHp = Math.max(target.tempHp, rollRes.total);
      ctx.combatantsMap[target.id] = { ...target };
      ctx.events.push({
        type: 'TEMP_HP_APPLIED',
        targetId: target.id,
        amount: rollRes.total,
        tempHpBefore: before,
        tempHpAfter: target.tempHp,
        sourceName: ctx.abilityName,
      });
    } else if (step.step === 'apply_condition') {
      const condRes = applyConditionToCombatant(target, step.conditionId, {
        sourceId: ctx.abilityName,
        sourceName: ctx.abilityName,
        sourceEntityId: ctx.actor.id,
        durationRounds: step.durationRounds,
      });
      ctx.combatantsMap[target.id] = condRes.combatant;
      ctx.events.push(...condRes.events);
    } else if (step.step === 'deal_damage') {
      const vars = formulaVarsFor(ctx.actor);
      const dmgRoll = rollDamage(ctx.rng, step.diceFormula, { context: vars });
      ctx.rng = dmgRoll.nextState;
      const dmgApplied = applyDamage({
        state: { ...ctx.combatState, combatants: ctx.combatantsMap, rngState: ctx.rng },
        targetId: target.id,
        rawAmount: dmgRoll.total,
        damageType: step.damageType,
        attackerId: ctx.actor.id,
        sourceName: ctx.abilityName,
        isMagical: step.isMagical,
      });
      ctx.rng = dmgApplied.state.rngState;
      ctx.combatantsMap[target.id] = dmgApplied.state.combatants[target.id]!;
      ctx.events.push(...dmgApplied.events);
    } else if (step.step === 'saving_throw') {
      const bonus = getTargetSavingThrowBonus(target, step.ability);
      const d20 = rollD20(ctx.rng, { modifier: bonus, mode: 'normal' });
      ctx.rng = d20.nextState;
      const dc = parseInt(step.dcFormula, 10) || 13;
      const passed = d20.total >= dc;
      ctx.events.push({
        type: 'SAVING_THROW_RESOLVED',
        entityId: target.id,
        ability: step.ability,
        dc,
        roll: d20.naturalRoll,
        total: d20.total,
        outcome: passed ? 'success' : 'failure',
        sourceSpellOrAbilityName: ctx.abilityName,
      });
      executeStepsCombat(ctx, passed ? (step.onSuccess ?? []) : step.onFail, target);
    } else if (step.step === 'attack_roll') {
      const attackBonus =
        step.attackBonusOverride ?? getImprovisedThrownAttackBonus(ctx.actor);
      const d20 = rollD20(ctx.rng, { modifier: attackBonus, mode: 'normal' });
      ctx.rng = d20.nextState;
      const targetAc = target.armorClass;
      const isCrit = d20.naturalRoll === 20;
      const isFumble = d20.naturalRoll === 1;
      const hit = isCrit || (!isFumble && d20.total >= targetAc);
      ctx.events.push({
        type: 'DICE_ROLLED',
        actorId: ctx.actor.id,
        rollPurpose: 'item_attack_roll',
        notation: d20.record.formula,
        rolls: d20.record.rolls,
        kept: d20.record.kept,
        modifier: d20.record.modifier,
        total: d20.total,
        mode: 'normal',
        naturalCrit: isCrit,
        naturalFumble: isFumble,
      });
      if (hit) {
        // Execute onHit steps; critical hits double the damage dice via isCritical.
        for (const onHit of step.onHit) {
          if (onHit.step === 'deal_damage') {
            const vars = formulaVarsFor(ctx.actor);
            const dmgRoll = rollDamage(ctx.rng, onHit.diceFormula, { context: vars });
            ctx.rng = dmgRoll.nextState;
            const dmgApplied = applyDamage({
              state: { ...ctx.combatState, combatants: ctx.combatantsMap, rngState: ctx.rng },
              targetId: target.id,
              rawAmount: dmgRoll.total,
              damageType: onHit.damageType,
              isCritical: isCrit,
              attackerId: ctx.actor.id,
              sourceName: ctx.abilityName,
              isMagical: onHit.isMagical,
            });
            ctx.rng = dmgApplied.state.rngState;
            ctx.combatantsMap[target.id] = dmgApplied.state.combatants[target.id]!;
            ctx.events.push({
              type: 'ATTACK_RESOLVED',
              attackerId: ctx.actor.id,
              targetId: target.id,
              weaponOrSpellName: ctx.abilityName,
              attackType: step.attackType,
              roll: d20.naturalRoll,
              totalToHit: d20.total,
              targetAc,
              outcome: isCrit ? 'critical_hit' : 'hit',
              damage: {
                total: dmgRoll.total,
                damageType: onHit.damageType,
                diceFormula: onHit.diceFormula,
              },
            });
            ctx.events.push(...dmgApplied.events);
            target = ctx.combatantsMap[target.id]!;
          } else {
            executeStepsCombat(ctx, [onHit], target);
            target = ctx.combatantsMap[target.id] ?? target;
          }
        }
      } else {
        ctx.events.push({
          type: 'ATTACK_RESOLVED',
          attackerId: ctx.actor.id,
          targetId: target.id,
          weaponOrSpellName: ctx.abilityName,
          attackType: step.attackType,
          roll: d20.naturalRoll,
          totalToHit: d20.total,
          targetAc,
          outcome: 'miss',
        });
        if (step.onMiss) executeStepsCombat(ctx, step.onMiss, target);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dawn recharge helper (shared by dungeon long rests and overworld camping)
// ---------------------------------------------------------------------------

export interface ChargeRechargeRecord {
  instanceId: string;
  itemId: string;
  before: number;
  after: number;
  rolled: number;
}

/**
 * SRD-1303: recharge wand/staff/dawn charges on a long rest. Rolls
 * `rechargeFormula` (seeded) and caps at `charges.max`. Instances with a
 * missing `chargesRemaining` are initialized to full without a roll.
 */
export function rechargeHeroCharges(
  inventory: InventoryItemInstance[],
  compendium: SrdCompendium,
  rngState: number,
): { inventory: InventoryItemInstance[]; nextRng: number; recharged: ChargeRechargeRecord[] } {
  let rng = rngState;
  const recharged: ChargeRechargeRecord[] = [];
  const next = inventory.map((inst) => {
    const magic = compendium.getMagicItem(inst.itemId);
    const chargesDef = magic?.charges;
    if (!chargesDef) return inst;
    if (inst.chargesRemaining === undefined) {
      return { ...inst, chargesRemaining: chargesDef.max };
    }
    if (inst.chargesRemaining >= chargesDef.max) return inst;
    let rolled = 0;
    if (chargesDef.rechargeFormula) {
      const rollRes = rollDamage(rng, chargesDef.rechargeFormula, { context: {} });
      rng = rollRes.nextState;
      rolled = rollRes.total;
    } else {
      rolled = chargesDef.max;
    }
    const after = Math.min(chargesDef.max, inst.chargesRemaining + rolled);
    recharged.push({ instanceId: inst.instanceId, itemId: inst.itemId, before: inst.chargesRemaining, after, rolled });
    return { ...inst, chargesRemaining: after };
  });
  return { inventory: next, nextRng: rng, recharged };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export function resolveUseItem(
  state: GameState,
  command: UseItemCommand,
  compendium: SrdCompendium = getDefaultCompendium(),
): UseItemResult {
  const events: GameEvent[] = [];
  const nextState: GameState = structuredClone(state);

  const actor =
    nextState.party[command.actorId] ??
    nextState.monsters[command.actorId] ??
    nextState.combat?.combatants[command.actorId];
  if (!actor) {
    throw new Error(`USE_ITEM actor ${command.actorId} not found`);
  }
  if (actor.isDead || actor.currentHp <= 0) {
    throw new Error(`${actor.name} is dead or at 0 HP and cannot use items`);
  }
  const buildState = (actor as Combatant).buildState ?? nextState.party[command.actorId]?.buildState;
  if (!buildState) {
    throw new Error(`${actor.name} has no inventory and cannot use items`);
  }
  const bsInventory = buildState.inventory;
  const bsCurrency = buildState.currency;

  const found = findInstance(bsInventory, command.itemInstanceId);
  if (!found) {
    throw new Error(`Item instance ${command.itemInstanceId} not found on ${actor.name}`);
  }
  const instance = found.instance;
  const itemId = instance.itemId;
  const meta = getItemAbility(itemId, compendium);
  const ability = meta.ability;
  const scrollSpellId = resolveScrollSpellId(itemId);
  const isScroll = scrollSpellId !== null || meta.category === 'scroll';
  const chargesMax = meta.chargesMax;

  const partyHero = nextState.party[command.actorId];

  function persistInventory(updatedInventory: InventoryItemInstance[]): void {
    if (partyHero?.buildState) {
      partyHero.buildState = { ...partyHero.buildState, inventory: updatedInventory };
    } else if ((actor as Combatant).buildState) {
      (actor as Combatant).buildState = {
        ...(actor as Combatant).buildState!,
        inventory: updatedInventory,
      };
    }
    if (nextState.combat?.combatants[command.actorId]?.buildState) {
      nextState.combat.combatants[command.actorId]!.buildState = {
        ...nextState.combat.combatants[command.actorId]!.buildState!,
        inventory: structuredClone(updatedInventory),
      };
    }
  }

  function consumeOne(): InventoryItemInstance[] {
    const bs = buildState!;
    const f = found!;
    const next = bs.inventory
      .map((inst, idx) => {
        if (idx !== f.index) return inst;
        if (inst.quantity > 1) return { ...inst, quantity: inst.quantity - 1 };
        return null;
      })
      .filter((x): x is InventoryItemInstance => x !== null);
    const remaining = f.instance.quantity > 1 ? f.instance.quantity - 1 : 0;
    events.push({
      type: 'ITEM_CONSUMED',
      characterId: command.actorId,
      itemInstanceId: f.instance.instanceId,
      itemId,
      quantityRemaining: remaining,
    });
    events.push({
      type: 'INVENTORY_UPDATED',
      characterId: command.actorId,
      inventory: next,
      currency: bs.currency,
    });
    persistInventory(next);
    // USE_ITEM does not recompute the derived sheet, so a fully-consumed
    // instance would leave its ability listed (firing again via USE_ITEM, or
    // for free via USE_CLASS_FEATURE past the inventory guard). Drop the
    // ability from held sheets when nothing remaining grants it. Stacks with
    // remaining quantity and charged wands keep their ability.
    if (ability && !findInventoryItemGrantingAbility(next, ability.id, compendium)) {
      const holders = [
        nextState.party[command.actorId]?.characterSheet,
        nextState.combat?.combatants[command.actorId]?.characterSheet,
      ];
      for (const sheet of holders) {
        if (sheet?.activatedAbilities) {
          sheet.activatedAbilities = sheet.activatedAbilities.filter((a) => a.id !== ability.id);
        }
      }
    }
    return next;
  }

  // --- Charged wands/staffs -------------------------------------------------
  if (chargesMax !== undefined && !isScroll) {
    const current = instance.chargesRemaining ?? chargesMax;
    if (current <= 0) {
      throw new Error(`${meta.itemName} has no charges remaining (0/${chargesMax})`);
    }
    if (!ability) {
      throw new Error(`${meta.itemName} has charges but no usable ability`);
    }
    const nextCharges = current - 1;

    if (nextState.mode === 'combat' && nextState.combat) {
      const combat = nextState.combat;
      const combatActor = combat.combatants[command.actorId];
      if (!combatActor) throw new Error(`Actor ${command.actorId} not in combat`);
      // Action economy: wands cost the ability's action cost on the actor's turn.
      if (combat.activeCombatantId === command.actorId && combat.turnBudget) {
        if (ability.actionCost === 'action') {
          if (combat.turnBudget.action <= 0) throw new Error(`No action available for "${combatActor.name}"`);
          combat.turnBudget = { ...combat.turnBudget, action: combat.turnBudget.action - 1 };
        } else if (ability.actionCost === 'bonus_action') {
          if (combat.turnBudget.bonusAction <= 0) throw new Error(`No bonus action available for "${combatActor.name}"`);
          combat.turnBudget = { ...combat.turnBudget, bonusAction: combat.turnBudget.bonusAction - 1 };
        }
      }
      const targetId = command.targetId ?? command.actorId;
      const target = combat.combatants[targetId];
      if (!target) throw new Error(`USE_ITEM target ${targetId} not found in combat`);
      const ctx: CombatExecContext = {
        combatantsMap: { ...combat.combatants },
        rng: combat.rngState,
        events: [] as CombatEvent[],
        actor: combatActor,
        abilityName: ability.name,
        grid: nextState.grid,
        combatState: combat,
      };
      ctx.events.push({
        type: 'ACTION_USED',
        actorId: combatActor.id,
        actionName: 'custom',
        cost: ability.actionCost === 'bonus_action' ? 'bonus_action' : 'action',
      });
      executeStepsCombat(ctx, ability.effects, ctx.combatantsMap[targetId]!);
      const victory = evaluateCombatVictory(ctx.combatantsMap);
      nextState.combat = {
        ...combat,
        turnBudget: combat.turnBudget,
        combatants: ctx.combatantsMap,
        rngState: ctx.rng,
        outcome: victory,
        phase: victory !== 'in_progress' ? 'combat_ended' : combat.phase,
      };
      nextState.rngState = ctx.rng;
      for (const [id, c] of Object.entries(ctx.combatantsMap)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }
      events.push(...(ctx.events as unknown as GameEvent[]));
    } else {
      // Exploration: wands only support non-hostile overlays out of combat.
      const hostile = ability.effects.some(
        (s) => s.step === 'attack_roll' || s.step === 'deal_damage' || s.step === 'saving_throw',
      );
      if (hostile) {
        throw new Error(`${meta.itemName} requires combat: offensive item use outside combat is not supported`);
      }
      applyAbilityExploration(nextState, command.actorId, command.targetId ?? command.actorId, ability, events);
    }

    const updated = (partyHero?.buildState?.inventory ?? bsInventory).map((inst) =>
      inst.instanceId === found!.instance.instanceId ? { ...inst, chargesRemaining: nextCharges } : inst,
    );
    // If the instance was resolved via itemId fallback, charges live on the matched stack.
    const matchedId = found!.instance.instanceId;
    const finalInventory = updated.some((i) => i.instanceId === matchedId)
      ? updated
      : updated;
    persistInventory(finalInventory);
    events.push({
      type: 'CHARGES_CHANGED',
      characterId: command.actorId,
      itemInstanceId: found!.instance.instanceId,
      itemId,
      chargesRemaining: nextCharges,
      chargesMax,
    });
    events.push({
      type: 'INVENTORY_UPDATED',
      characterId: command.actorId,
      inventory: finalInventory,
      currency: bsCurrency,
    });
    return { nextState, events };
  }

  // --- Scrolls (consume to cast inscribed spell, slot-free) ------------------
  if (isScroll) {
    const spellId = scrollSpellId ?? deriveScrollSpellIdFromAbility(ability);
    if (!spellId) {
      throw new Error(`Scroll ${itemId} has no inscribed spell and cannot be used`);
    }
    const spell = compendium.getSpell(spellId);
    if (!spell) {
      throw new Error(`Inscribed spell ${spellId} for scroll ${itemId} not found in compendium`);
    }
    if (nextState.mode === 'combat' && nextState.combat) {
      const combat = nextState.combat;
      const combatActor = combat.combatants[command.actorId];
      if (!combatActor) throw new Error(`Actor ${command.actorId} not in combat`);
      // Snapshot slot pools so the cast is slot-free even when the caster
      // has tracked pools; executeSpellCast deducts, we restore afterwards.
      const savedSlots = structuredClone(combatActor.spellSlots ?? null);
      const savedSheetSlots = structuredClone(
        (combatActor.characterSheet as unknown as { spellcasting?: { spellSlots?: unknown } } | undefined)?.spellcasting
          ?.spellSlots ?? null,
      );
      const spellLevel = spell.level;
      let injected = false;
      if (spellLevel >= 1) {
        const pool = (combatActor.spellSlots as Record<string, { available: number }> | undefined)?.[String(spellLevel)];
        if (pool && pool.available <= 0) {
          pool.available = 1;
          injected = true;
        }
        const sheetPools = (
          combatActor.characterSheet as unknown as
            | { spellcasting?: { spellSlots?: Record<string, { available: number }> } }
            | undefined
        )?.spellcasting?.spellSlots;
        const sheetPool = sheetPools?.[String(spellLevel) as unknown as number] as unknown as
          | { available: number }
          | undefined;
        if (sheetPool && sheetPool.available <= 0) {
          sheetPool.available = 1;
          injected = true;
        }
        void injected;
      }
      // AOE scrolls (fireball) target a point: aim at the target's cell when
      // only a targetId was supplied through the USE_ITEM command.
      let originCell = undefined as unknown as { x: number; y: number } | undefined;
      const targetId = command.targetId;
      if (targetId) {
        const tgt = combat.combatants[targetId];
        if (!tgt) throw new Error(`USE_ITEM target ${targetId} not found in combat`);
        if (spell.targeting.type === 'point_aoe' || spell.targeting.type === 'self_aoe') {
          originCell = { x: tgt.position.x, y: tgt.position.y };
        }
      }
      const castRes = executeSpellCast({
        state: { ...combat, combatants: { ...combat.combatants } },
        casterId: command.actorId,
        spell,
        slotLevel: spellLevel === 0 ? 0 : spellLevel,
        targetIds: targetId ? [targetId] : undefined,
        originCell,
        grid: nextState.grid,
        compendium,
      });
      // Restore pools for slot-free scroll casting.
      if (savedSlots !== null) {
        castRes.state.combatants[command.actorId]!.spellSlots = savedSlots as unknown as typeof castRes.state.combatants[string]['spellSlots'];
      } else {
        delete (castRes.state.combatants[command.actorId] as Partial<Combatant>).spellSlots;
        if (combatActor.spellSlots === undefined) {
          delete (castRes.state.combatants[command.actorId] as Partial<Combatant>).spellSlots;
        }
      }
      if (savedSheetSlots !== null) {
        const cs = castRes.state.combatants[command.actorId]!.characterSheet as unknown as {
          spellcasting?: { spellSlots?: unknown };
        } | undefined;
        if (cs?.spellcasting) {
          (cs.spellcasting as { spellSlots?: unknown }).spellSlots = savedSheetSlots as never;
        }
      }
      // Rewrite the SPELL_CAST slotExpended marker: scrolls cost no slot.
      for (const e of castRes.events) {
        if (e.type === 'SPELL_CAST' && (e as { actorId?: string }).actorId === command.actorId) {
          (e as { slotExpended?: number | undefined }).slotExpended = undefined;
        }
      }
      nextState.combat = { ...castRes.state, rngState: castRes.state.rngState };
      nextState.rngState = castRes.state.rngState;
      for (const [id, c] of Object.entries(castRes.state.combatants)) {
        if (c.side === 'party') nextState.party[id] = c;
        else nextState.monsters[id] = c;
      }
      events.push(...(castRes.events as unknown as GameEvent[]));
      consumeOne();
      return { nextState, events };
    }
    // Exploration scroll path: only non-hostile spells resolve out of combat.
    // The bundled scroll set is hostile-only (fireball), so scrolls require
    // combat for now; non-hostile scrolls would flow through the
    // out-of-combat casting path slot-free in a follow-up.
    throw new Error(
      `Scroll of ${spell.name} requires combat: offensive scrolls cannot resolve out of combat`,
    );
  }

  // --- Consumable ability overlays (potions / antitoxin / acid / fire) ------
  if (!ability) {
    throw new Error(`Item ${itemId} (${meta.itemName}) has no usable ability and cannot be used`);
  }
  if (nextState.mode === 'combat' && nextState.combat) {
    const combat = nextState.combat;
    const combatActor = combat.combatants[command.actorId];
    if (!combatActor) throw new Error(`Actor ${command.actorId} not in combat`);
    if (combat.activeCombatantId === command.actorId && combat.turnBudget) {
      if (ability.actionCost === 'action') {
        if (combat.turnBudget.action <= 0) throw new Error(`No action available for "${combatActor.name}"`);
        combat.turnBudget = { ...combat.turnBudget, action: combat.turnBudget.action - 1 };
      } else if (ability.actionCost === 'bonus_action') {
        if (combat.turnBudget.bonusAction <= 0) throw new Error(`No bonus action available for "${combatActor.name}"`);
        combat.turnBudget = { ...combat.turnBudget, bonusAction: combat.turnBudget.bonusAction - 1 };
      }
    }
    const defaultTarget =
      ability.targeting?.type === 'self' ? command.actorId : (command.targetId ?? command.actorId);
    const target = combat.combatants[defaultTarget];
    if (!target) throw new Error(`USE_ITEM target ${defaultTarget} not found in combat`);
    const ctx: CombatExecContext = {
      combatantsMap: { ...combat.combatants },
      rng: combat.rngState,
      events: [] as CombatEvent[],
      actor: combatActor,
      abilityName: ability.name,
      grid: nextState.grid,
      combatState: combat,
    };
    ctx.events.push({
      type: 'ACTION_USED',
      actorId: combatActor.id,
      actionName: 'custom',
      cost: ability.actionCost === 'bonus_action' ? 'bonus_action' : 'action',
    });
    executeStepsCombat(ctx, ability.effects, ctx.combatantsMap[defaultTarget]!);
    const victory = evaluateCombatVictory(ctx.combatantsMap);
    nextState.combat = {
      ...combat,
      turnBudget: combat.turnBudget,
      combatants: ctx.combatantsMap,
      rngState: ctx.rng,
      outcome: victory,
      phase: victory !== 'in_progress' ? 'combat_ended' : combat.phase,
    };
    nextState.rngState = ctx.rng;
    for (const [id, c] of Object.entries(ctx.combatantsMap)) {
      if (c.side === 'party') nextState.party[id] = c;
      else nextState.monsters[id] = c;
    }
    events.push(...(ctx.events as unknown as GameEvent[]));
    consumeOne();
    return { nextState, events };
  }

  // Exploration mode: potions/buffs only; attacks require combat.
  const hostile = ability.effects.some(
    (s) => s.step === 'attack_roll' || s.step === 'deal_damage' || s.step === 'saving_throw',
  );
  if (hostile) {
    throw new Error(`${meta.itemName} requires combat: offensive item use outside combat is not supported`);
  }
  const targetId = ability.targeting?.type === 'self' ? command.actorId : (command.targetId ?? command.actorId);
  applyAbilityExploration(nextState, command.actorId, targetId, ability, events);
  consumeOne();
  return { nextState, events };
}

function deriveScrollSpellIdFromAbility(ability: ActivatedAbilitySpec | undefined): string | null {
  if (!ability) return null;
  const m = /scroll[-_ ]of[-_ ]([a-z0-9-]+)/i.exec(ability.id);
  return m ? m[1]! : null;
}

/**
 * Applies non-hostile ability overlays (heal / temp HP / buff) directly to
 * exploration-mode party/monster records with seeded dice. No Math.random.
 */
function applyAbilityExploration(
  nextState: GameState,
  actorId: string,
  targetId: string,
  ability: ActivatedAbilitySpec,
  events: GameEvent[],
): void {
  const actor = nextState.party[actorId] ?? nextState.monsters[actorId];
  if (!actor) throw new Error(`USE_ITEM actor ${actorId} not found`);
  const target = nextState.party[targetId] ?? nextState.monsters[targetId];
  if (!target) throw new Error(`USE_ITEM target ${targetId} not found`);
  if (target.isDead) throw new Error(`Cannot apply ${ability.name} to dead creature "${target.name}"`);

  let rng = nextState.rngState;
  const vars = formulaVarsFor(actor);

  for (const step of ability.effects) {
    if (step.step === 'heal') {
      const rollRes = rollDamage(rng, step.diceFormula, { context: vars });
      rng = rollRes.nextState;
      const passive = getReligionHealingReceivedBonusFor(target);
      const effective = Math.max(0, rollRes.total + (rollRes.total > 0 ? passive : 0));
      const hpBefore = target.currentHp;
      const hpAfter = Math.min(target.maxHp, target.currentHp + effective);
      target.currentHp = hpAfter;
      if (target.characterSheet) target.characterSheet.currentHp = hpAfter;
      let revived = false;
      if (hpBefore === 0 && hpAfter > 0) {
        revived = true;
        target.conditions = target.conditions.filter((c) => c !== 'unconscious');
        target.isStable = false;
        target.deathSaves = { successes: 0, failures: 0 };
        if (target.characterSheet) {
          target.characterSheet.deathSaves = { successes: 0, failures: 0 };
          target.characterSheet.activeConditions = target.characterSheet.activeConditions.filter(
            (c) => c.conditionId !== 'unconscious',
          );
        }
      }
      events.push({
        type: 'HEAL_APPLIED',
        targetId: target.id,
        amount: hpAfter - hpBefore,
        hpBefore,
        hpAfter,
        sourceName: ability.name,
        revivedFromZero: revived,
      } as unknown as GameEvent);
    } else if (step.step === 'grant_temp_hp') {
      const rollRes = rollDamage(rng, step.amountFormula, { context: vars });
      rng = rollRes.nextState;
      const before = target.tempHp;
      target.tempHp = Math.max(target.tempHp, rollRes.total);
      events.push({
        type: 'TEMP_HP_APPLIED',
        targetId: target.id,
        amount: rollRes.total,
        tempHpBefore: before,
        tempHpAfter: target.tempHp,
        sourceName: ability.name,
      } as unknown as GameEvent);
    } else if (step.step === 'apply_active_effect') {
      const current = target.activeEffects ? [...target.activeEffects] : [];
      target.activeEffects = [
        ...current.filter((e) => e.effectId !== step.effectId),
        {
          effectId: step.effectId,
          name: step.name,
          requiresConcentration: step.requiresConcentration,
          remainingRounds: step.durationRounds,
          modifiers: step.modifiers,
        },
      ];
    } else if (step.step === 'apply_condition') {
      const condRes = applyConditionToCombatant(target, step.conditionId, {
        sourceId: ability.id,
        sourceName: ability.name,
        sourceEntityId: actor.id,
        durationRounds: step.durationRounds,
      });
      if (nextState.party[target.id]) nextState.party[target.id] = condRes.combatant;
      else nextState.monsters[target.id] = condRes.combatant;
      events.push(...(condRes.events as unknown as GameEvent[]));
    }
  }
  nextState.rngState = rng;
}
