import {
  createCompendium,
  type SpellData,
  type SrdCompendium,
} from '@srd5/data';
import {
  type FormulaContext,
  rollDamage,
} from '../dice/evaluator.js';
import { getFootprintDistanceFeet } from '../grid/footprints.js';
import type { TacticalGrid } from '../grid/model.js';
import type {
  CombatEvent,
  Combatant,
} from './types.js';
import { isSummonTargetable } from './summon.js';
import { isIncapacitated } from './turn-budget.js';
import { getCombatantCasterLevel, getCasterSpellContext } from './spellcasting.js';
import { WISH_BOON_IDS, resolveWishBoon } from './capstones.js';
import { getReligionHealingReceivedBonusFor } from '../skills/skill-passives.js';

let defaultCompendium: SrdCompendium | null = null;
function getDefaultCompendium(): SrdCompendium {
  if (!defaultCompendium) {
    defaultCompendium = createCompendium();
  }
  return defaultCompendium;
}

/**
 * SRD-1203: Out-of-combat (exploration/social) spellcasting path (Spec 11 §4.1).
 *
 * `DECLARE_CAST_SPELL` historically threw outside active combat, making every
 * utility, buff, comprehension, detection, and healing cast unreachable. This
 * module resolves **non-hostile** casts without an initiative context:
 * buffs (`apply_active_effect`), healing (`heal`), temp HP (`grant_temp_hp`),
 * and adjudication cards — including `cure-wounds` et al. out of combat
 * (required acceptance) and ritual casts that cost time instead of slots.
 *
 * Hostile work (attacks, damage, saves, hazards, forced movement, summons,
 * teleport repositioning, conditions such as `sleep`) still requires combat
 * and is rejected here with a descriptive error so SRD-1204/1205 can extend
 * the path deliberately (knock prop hook, detect-magic sense, sleep HP pool).
 */

/** Effect steps resolvable without an initiative context. */
export const OUT_OF_COMBAT_ALLOWED_STEPS = [
  'heal',
  'grant_temp_hp',
  'apply_active_effect',
  'manual_adjudication',
] as const;

const OUT_OF_COMBAT_ALLOWED_SET: ReadonlySet<string> = new Set(
  OUT_OF_COMBAT_ALLOWED_STEPS as readonly string[],
);

export interface OutOfCombatCastOptions {
  party: Record<string, Combatant>;
  monsters?: Record<string, Combatant>;
  casterId: string;
  spell?: SpellData;
  spellId?: string;
  slotLevel?: number;
  targetIds?: string[];
  /** Ritual casting: no slot expended, costs 10 extra minutes (SRD 5.1). */
  castAsRitual?: boolean;
  rngState: number;
  grid?: TacticalGrid;
  compendium?: SrdCompendium;
  /** SRD-1210: bounded Wish boon selection out of combat. */
  wishBoonId?: string;
  /** SRD-1210: damage type for the grant-resistance Wish boon. */
  wishResistanceType?: string;
  /** SRD-1210: explicit dead-ally target for the resurrection Wish boon. */
  wishResurrectionTargetId?: string;
}

export interface OutOfCombatCastResult {
  party: Record<string, Combatant>;
  monsters: Record<string, Combatant>;
  rngState: number;
  events: CombatEvent[];
  spell: SpellData;
  effectiveSlotLevel: number;
  ritualCast: boolean;
  /** Fiction time cost in minutes (0 for slot casts, >=10 for rituals). */
  timeSpentMinutes: number;
  targetsHealed: string[];
  targetsBuffed: string[];
  totalHealingByTarget: Record<string, number>;
}

/** True when every top-level effect step resolves without initiative. */
export function isSpellAllowedOutOfCombat(spell: SpellData): {
  allowed: boolean;
  reason?: string;
} {
  for (const step of spell.effects) {
    if (!OUT_OF_COMBAT_ALLOWED_SET.has(step.step)) {
      return {
        allowed: false,
        reason:
          `Spell ${spell.name} requires combat: effect step '${step.step}' ` +
          `cannot resolve out of combat (non-hostile heal/buff casts only)`,
      };
    }
  }
  if (spell.targeting.type === 'point_aoe' || spell.targeting.type === 'self_aoe') {
    return {
      allowed: false,
      reason: `Spell ${spell.name} requires combat: area targeting cannot resolve out of combat`,
    };
  }
  return { allowed: true };
}

/** Ritual time cost: base casting time + 10 minutes (SRD 5.1). */
export function getRitualTimeMinutes(spell: SpellData): number {
  const base = spell.castingTime;
  const baseMinutes =
    base === '1_minute'
      ? 1
      : base === '10_minutes'
        ? 10
        : base === '1_hour'
          ? 60
          : base === '8_hours'
            ? 480
            : base === '12_hours'
              ? 720
              : base === '24_hours'
                ? 1440
                : 0;
  return baseMinutes + 10;
}

function findCombatant(
  party: Record<string, Combatant>,
  monsters: Record<string, Combatant>,
  id: string,
): Combatant | undefined {
  return party[id] ?? monsters[id];
}

function expendOutOfCombatSlot(caster: Combatant, level: number): Combatant {
  const next: Combatant = structuredClone(caster);
  if (next.spellSlots) {
    const pool = next.spellSlots[String(level)];
    if (pool) {
      next.spellSlots[String(level)] = {
        ...pool,
        expended: pool.expended + 1,
        available: Math.max(0, pool.available - 1),
      };
    }
  }
  if (next.pactMagic && next.pactMagic.slotLevel === level) {
    next.pactMagic = {
      ...next.pactMagic,
      expendedSlots: next.pactMagic.expendedSlots + 1,
      availableSlots: Math.max(0, next.pactMagic.availableSlots - 1),
    };
  }
  if (next.characterSheet?.spellcasting?.spellSlots) {
    const pool =
      next.characterSheet.spellcasting.spellSlots[level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
    if (pool) {
      pool.expended += 1;
      pool.available = Math.max(0, pool.available - 1);
    }
  }
  return next;
}

function slotAvailable(caster: Combatant, level: number): boolean {
  if (caster.monsterData?.spellcasting?.atWillSpellIds?.includes('__never__')) return false;
  if (
    caster.monsterData?.spellcasting?.atWillSpellIds &&
    (caster as Combatant & { __atWill?: string[] }).__atWill !== undefined
  ) {
    return true;
  }
  if (caster.pactMagic && caster.pactMagic.slotLevel === level && caster.pactMagic.availableSlots > 0) {
    return true;
  }
  if (caster.spellSlots) {
    const pool = caster.spellSlots[String(level)];
    if (pool && pool.available > 0) return true;
    // Fall through to characterSheet check for heroes whose mirror is stale.
  }
  if (caster.characterSheet?.spellcasting?.spellSlots) {
    const pool =
      caster.characterSheet.spellcasting.spellSlots[level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
    if (pool && pool.available > 0) return true;
  }
  if (caster.monsterData?.spellcasting?.slotsByLevel) {
    const count = caster.monsterData.spellcasting.slotsByLevel[String(level)] ?? 0;
    if (count > 0) return true;
  }
  // Casters without tracked pools (e.g. test fixtures) are treated as having slots.
  if (!caster.spellSlots && !caster.characterSheet?.spellcasting?.spellSlots && !caster.monsterData?.spellcasting) {
    return true;
  }
  return false;
}

/**
 * Executes a non-hostile spell outside combat, threading seeded PRNG state so
 * healing/buff casts are deterministic and replayable.
 */
export function executeOutOfCombatSpellCast(
  options: OutOfCombatCastOptions,
): OutOfCombatCastResult {
  const {
    party,
    monsters = {},
    casterId,
    slotLevel,
    targetIds,
    castAsRitual = false,
    grid,
    compendium = getDefaultCompendium(),
  } = options;

  let spell: SpellData;
  if (options.spell) {
    spell = options.spell;
  } else if (options.spellId) {
    const found = compendium.getSpell(options.spellId);
    if (!found) throw new Error(`Spell ${options.spellId} not found in compendium`);
    spell = found;
  } else {
    throw new Error('Either spell or spellId must be provided for out-of-combat casting');
  }

  const caster = findCombatant(party, monsters, casterId);
  if (!caster) throw new Error(`Caster ${casterId} not found in party`);
  if (caster.isDead || caster.currentHp <= 0) {
    throw new Error(`${caster.name} is dead or at 0 HP and cannot cast spells`);
  }
  if (isIncapacitated(caster)) {
    throw new Error(`${caster.name} is incapacitated and cannot cast spells`);
  }

  const gate = isSpellAllowedOutOfCombat(spell);
  if (!gate.allowed) throw new Error(gate.reason);

  // Reaction spells (e.g. Shield) have no out-of-combat trigger.
  if (spell.castingTime === 'reaction') {
    throw new Error(`Spell ${spell.name} requires combat: reaction timing has no out-of-combat trigger`);
  }

  const isCantrip = spell.level === 0;
  let effectiveSlotLevel = 0;
  let ritualCast = false;
  let timeSpentMinutes = 0;

  if (castAsRitual) {
    if (!spell.ritual) {
      throw new Error(`Spell ${spell.name} cannot be cast as a ritual (no ritual tag)`);
    }
    if (slotLevel !== undefined && slotLevel !== spell.level) {
      throw new Error(
        `Ritual casting ${spell.name} does not expend an upcast slot (requested level ${slotLevel})`,
      );
    }
    ritualCast = true;
    effectiveSlotLevel = spell.level;
    timeSpentMinutes = getRitualTimeMinutes(spell);
  } else if (isCantrip) {
    effectiveSlotLevel = 0;
  } else {
    effectiveSlotLevel = slotLevel ?? spell.level;
    if (effectiveSlotLevel < spell.level) {
      throw new Error(
        `Cannot cast ${spell.name} (level ${spell.level}) using a lower slot (level ${effectiveSlotLevel})`,
      );
    }
    if (effectiveSlotLevel > 9) throw new Error('Spell slot level cannot exceed 9');
    const atWill = caster.monsterData?.spellcasting?.atWillSpellIds?.includes(spell.id) ?? false;
    if (!atWill && !slotAvailable(caster, effectiveSlotLevel)) {
      throw new Error(`No level ${effectiveSlotLevel} spell slots available for ${caster.name}`);
    }
  }

  // Resolve targets (range enforced via footprints; no cover/LoS out of combat).
  const all = { ...party, ...monsters };
  let resolvedTargetIds: string[] = targetIds ? [...targetIds] : [];
  if (spell.targeting.type === 'self') {
    resolvedTargetIds = [caster.id];
  } else if (spell.targeting.type === 'touch') {
    if (resolvedTargetIds.length === 0) {
      throw new Error(`Touch spell ${spell.name} requires a target`);
    }
    const target = all[resolvedTargetIds[0]!];
    if (!target) throw new Error(`Target ${resolvedTargetIds[0]} not found`);
    if (!isSummonTargetable(target)) {
      throw new Error(`Target ${target.name} cannot be targeted (untargetable conjuration)`);
    }
    const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
    if (dist > 5) {
      throw new Error(`Target ${target.name} is out of touch range (${dist} ft away)`);
    }
  } else if (spell.targeting.type === 'single') {
    if (resolvedTargetIds.length === 0) {
      throw new Error(`Single-target spell ${spell.name} requires a target`);
    }
    const target = all[resolvedTargetIds[0]!];
    if (!target) throw new Error(`Target ${resolvedTargetIds[0]} not found`);
    if (!isSummonTargetable(target)) {
      throw new Error(`Target ${target.name} cannot be targeted (untargetable conjuration)`);
    }
    const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
    if (dist > spell.targeting.rangeFeet) {
      throw new Error(`Target ${target.name} is out of spell range (${dist} ft > ${spell.targeting.rangeFeet} ft)`);
    }
  } else if (spell.targeting.type === 'multiple') {
    let maxTargets =
      typeof spell.targeting.maxTargets === 'number' ? spell.targeting.maxTargets : 3;
    if (
      spell.higherLevelScaling?.bonusTargetsPerSlotAboveBase &&
      effectiveSlotLevel > spell.level
    ) {
      maxTargets += (effectiveSlotLevel - spell.level) * spell.higherLevelScaling.bonusTargetsPerSlotAboveBase;
    }
    if (resolvedTargetIds.length === 0) {
      throw new Error(`Spell ${spell.name} requires at least one target`);
    }
    if (resolvedTargetIds.length > maxTargets) {
      throw new Error(`Too many targets for ${spell.name}: max ${maxTargets}, provided ${resolvedTargetIds.length}`);
    }
    for (const tid of resolvedTargetIds) {
      const target = all[tid];
      if (!target) throw new Error(`Target ${tid} not found`);
      if (!isSummonTargetable(target)) {
        throw new Error(`Target ${target.name} cannot be targeted (untargetable conjuration)`);
      }
      const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
      if (dist > spell.targeting.rangeFeet) {
        throw new Error(`Target ${target.name} is out of spell range (${dist} ft > ${spell.targeting.rangeFeet} ft)`);
      }
    }
  }
  void grid;

  let nextParty: Record<string, Combatant> = structuredClone(party);
  let nextMonsters: Record<string, Combatant> = structuredClone(monsters);
  const lookup = (id: string): Combatant => nextParty[id] ?? nextMonsters[id]!;

  let currentRng = options.rngState;
  const events: CombatEvent[] = [];

  // Break previous concentration (same semantics as combat: new concentration ends old).
  let workingCaster: Combatant = nextParty[casterId] ?? nextMonsters[casterId]!;
  if (spell.concentration && workingCaster.concentratingOn) {
    const prevId = workingCaster.concentratingOn.sourceId;
    events.push({ type: 'CONCENTRATION_ENDED', entityId: workingCaster.id, spellId: prevId, reason: 'new_spell' });
    for (const coll of [nextParty, nextMonsters]) {
      for (const [cid, comb] of Object.entries(coll)) {
        if (!comb.activeEffects) continue;
        const kept = comb.activeEffects.filter(
          (ae) => !(ae.sourceEntityId === workingCaster.id && ae.requiresConcentration),
        );
        if (kept.length !== comb.activeEffects.length) {
          coll[cid] = { ...comb, activeEffects: kept };
        }
      }
    }
    workingCaster = { ...(nextParty[casterId] ?? nextMonsters[casterId]!), concentratingOn: undefined };
    if (nextParty[casterId]) nextParty[casterId] = workingCaster;
    else nextMonsters[casterId] = workingCaster;
  }

  // Deduct slot (rituals and cantrips are free).
  if (!ritualCast && effectiveSlotLevel >= 1) {
    const atWill = caster.monsterData?.spellcasting?.atWillSpellIds?.includes(spell.id) ?? false;
    if (!atWill) {
      workingCaster = expendOutOfCombatSlot(workingCaster, effectiveSlotLevel);
      if (nextParty[casterId]) nextParty[casterId] = workingCaster;
      else nextMonsters[casterId] = workingCaster;
    }
  }

  if (spell.concentration && !ritualCast) {
    // Concentration buffs still track out of combat so they carry into the next fight.
    const rounds =
      spell.duration.type === 'rounds'
        ? spell.duration.rounds
        : spell.duration.type === 'minutes'
          ? spell.duration.amount * 10
          : spell.duration.type === 'hours'
            ? spell.duration.amount * 600
            : spell.duration.type === 'days'
              ? spell.duration.amount * 14400
              : 10;
    workingCaster = {
      ...workingCaster,
      concentratingOn: {
        sourceId: spell.id,
        sourceName: spell.name,
        targetEntityIds: [...resolvedTargetIds],
        remainingRounds: rounds,
      },
    };
    if (nextParty[casterId]) nextParty[casterId] = workingCaster;
    else nextMonsters[casterId] = workingCaster;
    events.push({
      type: 'CONCENTRATION_STARTED',
      entityId: workingCaster.id,
      spellId: spell.id,
      spellName: spell.name,
      targetEntityIds: [...resolvedTargetIds],
    });
  }

  events.push({
    type: 'SPELL_CAST',
    actorId: caster.id,
    spellId: spell.id,
    spellName: spell.name,
    spellLevel: spell.level,
    castAtLevel: effectiveSlotLevel,
    actionCost: ritualCast ? 'ritual_10_minutes' : spell.castingTime,
    slotExpended: ritualCast || effectiveSlotLevel === 0 ? undefined : effectiveSlotLevel,
    targetEntityIds: [...resolvedTargetIds],
  });

  // SRD-1210: Bounded Wish boons out of combat (full-rest/mass-heal/etc).
  if (spell.id === 'wish' && options.wishBoonId) {
    const boonId = options.wishBoonId as never;
    if (!(WISH_BOON_IDS as readonly string[]).includes(options.wishBoonId)) {
      throw new Error(`Unknown Wish boon "${options.wishBoonId}"`);
    }
    const liveCaster = nextParty[casterId] ?? nextMonsters[casterId]!;
    if (liveCaster.wishLost) {
      throw new Error(`${liveCaster.name} has lost the ability to cast Wish (33% stress)`);
    }
    const tmpCombatants: Record<string, Combatant> = { ...nextParty, ...nextMonsters };
    const tmpState = {
      encounterId: 'out-of-combat-wish',
      round: 1,
      phase: 'active_turn' as const,
      initiativeOrder: [],
      activeCombatantIndex: 0,
      activeCombatantId: casterId,
      turnBudget: null,
      combatants: tmpCombatants,
      surprisedCombatantIds: [],
      outcome: 'in_progress' as const,
      rngState: currentRng,
    };
    const wishRes = resolveWishBoon({
      state: tmpState,
      casterId,
      boonId,
      resistanceType: (options.wishResistanceType as never) ?? undefined,
      resurrectionTargetId: options.wishResurrectionTargetId,
      rngState: currentRng,
    });
    const outParty: Record<string, Combatant> = { ...nextParty };
    const outMonsters: Record<string, Combatant> = { ...nextMonsters };
    for (const [cid, comb] of Object.entries(wishRes.state.combatants)) {
      if (nextParty[cid] !== undefined || party[cid] !== undefined) outParty[cid] = comb;
      else outMonsters[cid] = comb;
    }
    return {
      party: outParty,
      monsters: outMonsters,
      rngState: wishRes.state.rngState,
      events: [...events, ...wishRes.events],
      spell,
      effectiveSlotLevel,
      ritualCast,
      timeSpentMinutes,
      targetsHealed: [...wishRes.healedIds],
      targetsBuffed: [...wishRes.buffedIds],
      totalHealingByTarget: { ...wishRes.totalHealingByTarget },
    };
  }

  // Scaling + formula context mirrors combat (upcast dice, cantrip tiers).
  const casterLevel = getCombatantCasterLevel(caster);
  const casterCtx = getCasterSpellContext(caster);
  const formulaVars: FormulaContext = {
    '@spellMod': casterCtx.spellMod,
    '@spellSaveDC': casterCtx.spellSaveDc,
    '@prof': casterCtx.prof,
    '@slotLevel': effectiveSlotLevel,
    '@casterMaxHp': caster.maxHp,
    casterMaxHp: caster.maxHp,
    spellMod: casterCtx.spellMod,
    spellSaveDC: casterCtx.spellSaveDc,
    prof: casterCtx.prof,
    slotLevel: effectiveSlotLevel,
  };

  let scaledEffects = structuredClone(spell.effects);
  if (spell.level === 0 && spell.higherLevelScaling?.mode === 'character_level') {
    const overrides = spell.higherLevelScaling.overrides;
    if (overrides) {
      for (const tier of [17, 11, 5]) {
        if (casterLevel >= tier && overrides[String(tier)]) {
          const ov = overrides[String(tier)]!;
          const ovFormula = (ov as { diceFormula?: string }).diceFormula;
          scaledEffects = scaledEffects.map((step) => {
            if ((step.step === 'heal' || step.step === 'deal_damage') && ovFormula) {
              return { ...step, diceFormula: ovFormula };
            }
            return step;
          });
          break;
        }
      }
    }
  }
  if (spell.level >= 1 && effectiveSlotLevel > spell.level) {
    const extra = effectiveSlotLevel - spell.level;
    if (spell.higherLevelScaling?.bonusDicePerSlotAboveBase) {
      const bonus = spell.higherLevelScaling.bonusDicePerSlotAboveBase;
      const match = bonus.trim().match(/^(\d+)d(\d+)$/i);
      if (match) {
        const bonusCount = parseInt(match[1]!, 10) * extra;
        const bonusFaces = match[2]!;
        scaledEffects = scaledEffects.map((step) => {
          if (step.step === 'heal' && typeof step.diceFormula === 'string') {
            const baseMatch =
              step.diceFormula.match(new RegExp(`(\\d+)d${bonusFaces}`, 'i')) ??
              step.diceFormula.match(/(\d+)d(\d+)/i);
            if (baseMatch && baseMatch[1]) {
              const baseCount = parseInt(baseMatch[1], 10);
              return {
                ...step,
                diceFormula: step.diceFormula.replace(
                  baseMatch[0],
                  `${baseCount + bonusCount}d${baseMatch[2] ?? bonusFaces}`,
                ),
              };
            }
            return { ...step, diceFormula: `${step.diceFormula} + ${bonusCount}d${bonusFaces}` };
          }
          return step;
        });
      }
    }
  }

  const targetsHealed: string[] = [];
  const targetsBuffed: string[] = [];
  const totalHealingByTarget: Record<string, number> = {};

  for (const tid of resolvedTargetIds) {
    const target = lookup(tid);
    if (!target || target.isDead) continue;
    for (const step of scaledEffects) {
      if (step.step === 'heal') {
        const healRes = rollDamage(currentRng, step.diceFormula, { context: formulaVars });
        currentRng = healRes.nextState;
        events.push({
          type: 'DICE_ROLLED',
          actorId: caster.id,
          rollPurpose: `healing_${spell.id}`,
          notation: healRes.record.formula,
          rolls: healRes.record.rolls,
          kept: healRes.record.kept,
          modifier: healRes.record.modifier,
          total: healRes.total,
          mode: 'normal',
        });
        const amount = Math.max(0, healRes.total);
        const hpBefore = target.currentHp;
        // SRD-1213: Religion standing passive (+1 prof / +2 expert) applies
        // to out-of-combat magical healing exactly as in combat.
        const hpAfter = Math.min(
          target.maxHp,
          hpBefore + amount + (amount > 0 ? getReligionHealingReceivedBonusFor(target) : 0),
        );
        const revivedFromZero = hpBefore === 0 && hpAfter > 0;
        const nextConditions = revivedFromZero
          ? target.conditions.filter((c) => c !== 'unconscious')
          : [...target.conditions];
        const updated: Combatant = {
          ...target,
          currentHp: hpAfter,
          conditions: nextConditions,
          deathSaves: revivedFromZero ? { successes: 0, failures: 0 } : { ...target.deathSaves },
          isStable: revivedFromZero ? false : target.isStable,
          characterSheet: target.characterSheet
            ? {
                ...target.characterSheet,
                currentHp: hpAfter,
                deathSaves: revivedFromZero
                  ? { successes: 0, failures: 0 }
                  : { ...target.characterSheet.deathSaves },
              }
            : undefined,
        };
        if (nextParty[tid]) nextParty[tid] = updated;
        else nextMonsters[tid] = updated;
        // Keep the loop-local reference in sync for multi-step spells (e.g. aid).
        Object.assign(target, updated);
        events.push({
          type: 'HEAL_APPLIED',
          targetId: tid,
          amount: hpAfter - hpBefore,
          hpBefore,
          hpAfter,
          sourceName: spell.name,
          revivedFromZero,
        });
        if (!targetsHealed.includes(tid)) targetsHealed.push(tid);
        totalHealingByTarget[tid] = (totalHealingByTarget[tid] ?? 0) + (hpAfter - hpBefore);
      } else if (step.step === 'grant_temp_hp') {
        const hpRes = rollDamage(currentRng, step.amountFormula, { context: formulaVars });
        currentRng = hpRes.nextState;
        const updated: Combatant = { ...target, tempHp: Math.max(target.tempHp, hpRes.total) };
        if (nextParty[tid]) nextParty[tid] = updated;
        else nextMonsters[tid] = updated;
        Object.assign(target, updated);
        events.push({
          type: 'TEMP_HP_APPLIED',
          targetId: tid,
          amount: hpRes.total,
          tempHpBefore: target.tempHp,
          tempHpAfter: updated.tempHp,
          sourceName: spell.name,
        });
        if (!targetsBuffed.includes(tid)) targetsBuffed.push(tid);
      } else if (step.step === 'apply_active_effect') {
        const existing = target.activeEffects ? [...target.activeEffects] : [];
        const entry = {
          effectId: step.effectId,
          name: step.name,
          sourceEntityId: caster.id,
          requiresConcentration: step.requiresConcentration || Boolean(spell.concentration),
          remainingRounds: step.durationRounds,
          modifiers: step.modifiers ?? [],
        };
        const updated: Combatant = {
          ...target,
          activeEffects: [...existing.filter((e) => e.effectId !== step.effectId), entry],
        };
        if (nextParty[tid]) nextParty[tid] = updated;
        else nextMonsters[tid] = updated;
        Object.assign(target, updated);
        if (!targetsBuffed.includes(tid)) targetsBuffed.push(tid);
      } else if (step.step === 'manual_adjudication') {
        events.push({
          type: 'MANUAL_ADJUDICATION_REQUIRED',
          actorId: caster.id,
          sourceName: spell.name,
          adjudicationId: step.adjudicationId,
          title: step.title,
          guidance: step.guidance,
          ...(step.suggestedRoll ? { suggestedRoll: step.suggestedRoll } : {}),
          targetId: tid,
        });
        if (!targetsBuffed.includes(tid)) targetsBuffed.push(tid);
      }
    }
  }

  return {
    party: nextParty,
    monsters: nextMonsters,
    rngState: currentRng,
    events,
    spell,
    effectiveSlotLevel,
    ritualCast,
    timeSpentMinutes,
    targetsHealed,
    targetsBuffed,
    totalHealingByTarget,
  };
}
