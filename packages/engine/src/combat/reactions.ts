import type {
  AbilityId,
  DamageType,
  SpellData,
  createCompendium,
  SrdCompendium,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type RollMode,
  resolveRollMode,
  rollD20,
  rollDamage,
} from '../dice/evaluator.js';
import {
  getFootprintDistanceFeet,
  isWithinMeleeReach,
} from '../grid/footprints.js';
import {
  type GridPoint,
  type TacticalGrid,
} from '../grid/model.js';
import {
  type CoverLevel,
  hasLineOfSight,
} from '../grid/vision.js';
import type {
  AvailableReaction,
  CombatEvent,
  CombatState,
  Combatant,
  PendingReactionPrompt,
  ReactionInterruptContext,
  ResolveReactionDecision,
  TurnBudget,
} from './types.js';
import { areAllied, areHostile } from './allegiance.js';
import { isIncapacitated } from './conditions.js';
import { applyDamage } from './damage.js';
import { executeWeaponAttack, type ExecuteAttackOptions } from './attack.js';
import { executeSpellCast, type ExecuteSpellCastOptions } from './spellcasting.js';

let defaultCompendium: SrdCompendium | null = null;
function getCompendium(): SrdCompendium {
  if (!defaultCompendium) {
    // Dynamic import fallback or require
    // We can rely on global compendium or createCompendium
  }
  return defaultCompendium!;
}

/**
 * Checks whether a combatant is currently capable of taking a reaction.
 * Per SRD 5.1:
 * - Must have reaction available (not spent since start of last turn)
 * - Must not be dead or at 0 HP
 * - Must not be incapacitated, paralyzed, petrified, stunned, or unconscious
 * - Must not be surprised on round 1 (surprised creatures cannot take reactions until their first turn ends)
 */
export function canCombatantTakeReaction(combatant: Combatant): boolean {
  if (combatant.reactionAvailable === false) {
    return false;
  }
  if (combatant.isDead || combatant.currentHp <= 0) {
    return false;
  }
  if (isIncapacitated(combatant)) {
    return false;
  }
  if (combatant.isSurprised) {
    return false;
  }
  return true;
}

/**
 * Checks whether the reactor can perceive the target (sight check).
 * Reactions requiring sight (Opportunity Attack, Protection, Uncanny Dodge, Counterspell)
 * fail if the reactor is blinded, target is invisible, or line of sight is obstructed.
 */
export function combatantCanSee(
  reactor: Combatant,
  target: Combatant,
  targetPos?: GridPoint,
  grid?: TacticalGrid,
): boolean {
  if (reactor.conditions.includes('blinded')) {
    return false;
  }
  if (target.conditions.includes('invisible')) {
    return false;
  }
  if (grid) {
    const fromCreature = { id: reactor.id, x: reactor.position.x, y: reactor.position.y, size: reactor.size };
    const toCreature = {
      id: target.id,
      x: (targetPos ?? target.position).x,
      y: (targetPos ?? target.position).y,
      size: target.size,
    };
    return hasLineOfSight(grid, fromCreature, toCreature);
  }
  return true;
}

/**
 * Spends a combatant's reaction, synchronizing with active turn budget if it is their turn.
 */
export function spendCombatantReaction(
  state: CombatState,
  combatantId: string,
): { state: CombatState; combatant: Combatant } {
  const combatant = state.combatants[combatantId];
  if (!combatant) {
    throw new Error(`Combatant "${combatantId}" not found`);
  }
  if (combatant.reactionAvailable === false) {
    throw new Error(`Combatant "${combatant.name}" has already spent their reaction`);
  }

  const updatedCombatant: Combatant = {
    ...combatant,
    reactionAvailable: false,
  };

  let updatedBudget = state.turnBudget;
  if (state.activeCombatantId === combatantId && state.turnBudget) {
    updatedBudget = {
      ...state.turnBudget,
      reactionAvailable: false,
    };
  }

  const nextState: CombatState = {
    ...state,
    turnBudget: updatedBudget,
    combatants: {
      ...state.combatants,
      [combatantId]: updatedCombatant,
    },
  };

  return { state: nextState, combatant: updatedCombatant };
}

/**
 * Returns a combatant's melee reach in feet (default 5 ft).
 */
export function getCombatantMeleeReachFeet(combatant: Combatant): number {
  if (combatant.characterSheet?.weaponAttacks) {
    const meleeWeapons = combatant.characterSheet.weaponAttacks.filter(
      (w) => w.rangeType === 'melee' && w.slot !== 'ranged',
    );
    if (meleeWeapons.length > 0) {
      return Math.max(...meleeWeapons.map((w) => w.reachFeet));
    }
  }
  if (combatant.monsterData?.actions) {
    for (const act of combatant.monsterData.actions) {
      const match = act.description.match(/reach\s+(\d+)\s*ft/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
  }
  return 5;
}

/**
 * Checks if a combatant has access to a specific spell (prepared, known, innate, or monster data).
 */
export function combatantHasSpell(combatant: Combatant, spellId: string): boolean {
  const normId = spellId.toLowerCase().replace(/[\s-]/g, '_');
  if (combatant.characterSheet?.spellcasting) {
    const sc = combatant.characterSheet.spellcasting;
    if (
      sc.preparedOrKnownSpellIds.some((s) => s.toLowerCase() === normId) ||
      sc.alwaysPreparedSpellIds.some((s) => s.toLowerCase() === normId) ||
      sc.cantripIds.some((s) => s.toLowerCase() === normId)
    ) {
      return true;
    }
  }
  if (combatant.monsterData?.spellcasting) {
    const sc = combatant.monsterData.spellcasting;
    if (sc.preparedSpellIds?.some((s: string) => s.toLowerCase() === normId)) {
      return true;
    }
    if (sc.atWillSpellIds?.some((s: string) => s.toLowerCase() === normId)) {
      return true;
    }
    if (sc.perDaySpells?.some((p) => p.spellIds.some((s: string) => s.toLowerCase() === normId))) {
      return true;
    }
  }
  if (combatant.monsterData?.actions?.some((a) => a.id.toLowerCase() === normId || a.name.toLowerCase() === normId)) {
    return true;
  }
  if (combatant.characterSheet?.traitIds?.some((t) => t.toLowerCase().includes(normId))) {
    return true;
  }
  if (combatant.activeEffects?.some((e) => e.effectId.toLowerCase().includes(normId) || e.name.toLowerCase().includes(normId))) {
    return true;
  }
  return false;
}

/**
 * Finds available spell slot levels >= minLevel for a combatant.
 */
export function getAvailableSpellSlotLevels(combatant: Combatant, minLevel = 1): number[] {
  const availableLevels: number[] = [];
  if (combatant.spellSlots) {
    for (const [lvlStr, pool] of Object.entries(combatant.spellSlots)) {
      const lvl = parseInt(lvlStr, 10);
      if (lvl >= minLevel && pool.available > 0) {
        availableLevels.push(lvl);
      }
    }
  } else if (combatant.characterSheet?.spellcasting?.spellSlots) {
    const slots = combatant.characterSheet.spellcasting.spellSlots;
    for (let lvl = minLevel; lvl <= 9; lvl++) {
      const pool = slots[lvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
      if (pool && pool.available > 0) {
        availableLevels.push(lvl);
      }
    }
  }
  if (combatant.pactMagic && combatant.pactMagic.slotLevel >= minLevel && combatant.pactMagic.availableSlots > 0) {
    if (!availableLevels.includes(combatant.pactMagic.slotLevel)) {
      availableLevels.push(combatant.pactMagic.slotLevel);
    }
  }
  return availableLevels.sort((a, b) => a - b);
}

/**
 * Deducts 1 spell slot of the given level from a combatant.
 */
export function expendSpellSlot(combatant: Combatant, slotLevel: number): Combatant {
  let nextCombatant = { ...combatant };
  const lvlKey = String(slotLevel);

  if (nextCombatant.spellSlots && nextCombatant.spellSlots[lvlKey]) {
    const pool = nextCombatant.spellSlots[lvlKey]!;
    nextCombatant.spellSlots = {
      ...nextCombatant.spellSlots,
      [lvlKey]: {
        ...pool,
        expended: pool.expended + 1,
        available: Math.max(0, pool.available - 1),
      },
    };
  }

  if (nextCombatant.pactMagic && nextCombatant.pactMagic.slotLevel === slotLevel) {
    nextCombatant.pactMagic = {
      ...nextCombatant.pactMagic,
      expendedSlots: nextCombatant.pactMagic.expendedSlots + 1,
      availableSlots: Math.max(0, nextCombatant.pactMagic.availableSlots - 1),
    };
  }

  if (nextCombatant.characterSheet?.spellcasting?.spellSlots) {
    const sheetSlots = { ...nextCombatant.characterSheet.spellcasting.spellSlots };
    const pool = sheetSlots[slotLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
    if (pool) {
      sheetSlots[slotLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9] = {
        ...pool,
        expended: pool.expended + 1,
        available: Math.max(0, pool.available - 1),
      };
      nextCombatant = {
        ...nextCombatant,
        characterSheet: {
          ...nextCombatant.characterSheet,
          spellcasting: {
            ...nextCombatant.characterSheet.spellcasting,
            spellSlots: sheetSlots,
          },
        },
      };
    }
  }

  return nextCombatant;
}

/**
 * Applies the Shield spell +5 AC bonus until the start of reactor's next turn.
 */
export function applyShieldBuff(combatant: Combatant): Combatant {
  const currentEffects = combatant.activeEffects ? [...combatant.activeEffects] : [];
  const existingShield = currentEffects.find((e) => e.effectId === 'shield_ac_buff');
  if (existingShield) {
    return combatant; // Already active
  }

  currentEffects.push({
    effectId: 'shield_ac_buff',
    name: 'Shield (+5 AC)',
    requiresConcentration: false,
    remainingRounds: 1,
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'ac',
        value: 5,
      },
    ],
  });

  let nextSheet = combatant.characterSheet;
  if (nextSheet) {
    nextSheet = {
      ...nextSheet,
      armorClass: {
        ...nextSheet.armorClass,
        totalAc: nextSheet.armorClass.totalAc + 5,
      },
    };
  }

  return {
    ...combatant,
    armorClass: combatant.armorClass + 5,
    activeEffects: currentEffects,
    characterSheet: nextSheet,
  };
}

/**
 * Checks whether a combatant has the Rogue Uncanny Dodge feature.
 */
export function hasUncannyDodge(combatant: Combatant): boolean {
  if (combatant.characterSheet?.classes) {
    const rogue = combatant.characterSheet.classes.find((c) => c.classId === 'rogue');
    if (rogue && rogue.level >= 5) return true;
  }
  if (combatant.characterSheet?.featureIds?.includes('uncanny_dodge')) {
    return true;
  }
  if (combatant.monsterData?.traits?.some((t) => t.name.toLowerCase().includes('uncanny dodge'))) {
    return true;
  }
  return false;
}

/**
 * Checks whether a combatant has the Protection Fighting Style and is wielding a shield.
 */
export function hasProtectionFightingStyle(combatant: Combatant): boolean {
  // Check Protection feature
  const hasProtection =
    combatant.characterSheet?.featureIds?.some(
      (f) => f.includes('protection') || f.includes('fighting_style_protection'),
    ) ||
    combatant.characterSheet?.traitIds?.some((t) => t.includes('protection')) ||
    combatant.monsterData?.traits?.some((t) => t.name.toLowerCase().includes('protection'));

  if (!hasProtection) return false;

  // Check shield equipped
  const hasShield =
    (combatant.characterSheet?.armorClass?.shieldBonus ?? 0) > 0 ||
    Boolean(combatant.monsterData?.actions?.some((a) => a.name.toLowerCase().includes('shield')));

  return Boolean(hasShield);
}

/**
 * Detects whether an Opportunity Attack is provoked by a single step from -> to.
 * Hostile creatures who can see the mover, have melee reach, and have reaction available qualify.
 */
export function detectOpportunityAttackTrigger(
  state: CombatState,
  moverId: string,
  from: GridPoint,
  to: GridPoint,
  grid?: TacticalGrid,
): { prompt: PendingReactionPrompt; reactor: Combatant } | null {
  if (from.x === to.x && from.y === to.y) {
    return null;
  }

  const mover = state.combatants[moverId];
  if (!mover) return null;

  // Disengaged movers do not provoke Opportunity Attacks
  if (state.turnBudget?.disengaged || mover.activeEffects?.some((e) => e.effectId === 'disengaged')) {
    return null;
  }

  for (const other of Object.values(state.combatants)) {
    if (other.id === mover.id) continue;
    if (!areHostile(mover, other, state.dispositionMatrix)) continue; // Must be hostile
    if (!canCombatantTakeReaction(other)) continue;
    if (!combatantCanSee(other, mover, from, grid)) continue;

    const reachFeet = getCombatantMeleeReachFeet(other);
    const wasInReach = isWithinMeleeReach(other.position, other.size, from, mover.size, reachFeet);
    const isNowInReach = isWithinMeleeReach(other.position, other.size, to, mover.size, reachFeet);

    if (wasInReach && !isNowInReach) {
      const prompt: PendingReactionPrompt = {
        promptId: `oa-${Date.now()}-${other.id}`,
        reactorEntityId: other.id,
        triggerType: 'movement_reach_exit',
        triggerDescription: `${mover.name} moves out of melee reach of ${other.name}. Make an Opportunity Attack?`,
        availableReactions: [
          {
            id: 'opportunity_attack',
            label: 'Make Opportunity Attack',
            reactionType: 'opportunity_attack',
            description: `Make 1 melee weapon attack against ${mover.name} before they leave your reach`,
          },
        ],
      };
      return { prompt, reactor: other };
    }
  }

  return null;
}

/**
 * Detects whether an ally within 5 ft can use Protection Fighting Style to impose Disadvantage.
 */
export function detectProtectionTrigger(
  state: CombatState,
  attackerId: string,
  targetId: string,
  grid?: TacticalGrid,
): { prompt: PendingReactionPrompt; protector: Combatant } | null {
  const attacker = state.combatants[attackerId];
  const target = state.combatants[targetId];
  if (!attacker || !target) return null;

  for (const other of Object.values(state.combatants)) {
    if (other.id === attacker.id || other.id === target.id) continue;
    if (!areAllied(other, target, state.dispositionMatrix)) continue; // Must be ally of target
    if (!canCombatantTakeReaction(other)) continue;
    if (!hasProtectionFightingStyle(other)) continue;
    if (!combatantCanSee(other, attacker, undefined, grid)) continue;

    const dist = getFootprintDistanceFeet(other.position, other.size, target.position, target.size);
    if (dist <= 5) {
      const prompt: PendingReactionPrompt = {
        promptId: `protect-${Date.now()}-${other.id}`,
        reactorEntityId: other.id,
        triggerType: 'attack_declared',
        triggerDescription: `${attacker.name} attacks ${target.name} within 5 ft of ${other.name}. Use Protection Fighting Style to impose Disadvantage?`,
        availableReactions: [
          {
            id: 'protection',
            label: 'Use Protection Fighting Style',
            reactionType: 'protection',
            description: `Impose Disadvantage on ${attacker.name}'s attack roll against ${target.name}`,
          },
        ],
      };
      return { prompt, protector: other };
    }
  }

  return null;
}

/**
 * Detects whether target has valid reactions upon being hit by an attack (Shield, Uncanny Dodge).
 */
export function detectAttackHitReactions(
  state: CombatState,
  attackerId: string,
  targetId: string,
  totalToHit: number,
  targetAc: number,
  isCritical: boolean,
  grid?: TacticalGrid,
): PendingReactionPrompt | null {
  const attacker = state.combatants[attackerId];
  const target = state.combatants[targetId];
  if (!attacker || !target) return null;
  if (!canCombatantTakeReaction(target)) return null;

  const availableReactions: AvailableReaction[] = [];

  // 1. Shield Spell check
  const hasShield = combatantHasSpell(target, 'shield');
  const availableSlots = getAvailableSpellSlotLevels(target, 1);
  if (hasShield && availableSlots.length > 0) {
    const wouldTurnToMiss = !isCritical && totalToHit < targetAc + 5;
    availableReactions.push({
      id: 'cast_shield',
      label: 'Cast Shield (+5 AC)',
      reactionType: 'shield',
      slotLevel: availableSlots[0],
      description: wouldTurnToMiss
        ? `Cast Shield (+5 AC) to turn this hit into a miss! (Roll ${totalToHit} vs AC ${targetAc + 5})`
        : `Gain +5 AC until start of your next turn (current attack roll ${totalToHit})`,
    });
  }

  // 2. Uncanny Dodge check (requires seeing attacker)
  if (hasUncannyDodge(target) && combatantCanSee(target, attacker, undefined, grid)) {
    availableReactions.push({
      id: 'uncanny_dodge',
      label: 'Uncanny Dodge (Halve Damage)',
      reactionType: 'uncanny_dodge',
      description: `Use reaction to halve incoming attack damage from ${attacker.name}`,
    });
  }

  if (availableReactions.length === 0) {
    return null;
  }

  return {
    promptId: `hit-${Date.now()}-${target.id}`,
    reactorEntityId: target.id,
    triggerType: 'attack_roll_hit',
    triggerDescription: `${attacker.name} hits ${target.name} (Roll ${totalToHit} vs AC ${targetAc}). Choose a reaction:`,
    availableReactions,
  };
}

/**
 * Detects whether any hostile creature within 60 ft can cast Counterspell against a spell.
 */
export function detectCounterspellTrigger(
  state: CombatState,
  casterId: string,
  spell: SpellData,
  castAtLevel: number,
  grid?: TacticalGrid,
): { prompt: PendingReactionPrompt; reactor: Combatant } | null {
  const caster = state.combatants[casterId];
  if (!caster) return null;

  for (const other of Object.values(state.combatants)) {
    if (other.id === caster.id) continue;
    if (!areHostile(other, caster, state.dispositionMatrix)) continue; // Must be hostile
    if (!canCombatantTakeReaction(other)) continue;
    if (!combatantCanSee(other, caster, undefined, grid)) continue;

    const dist = getFootprintDistanceFeet(other.position, other.size, caster.position, caster.size);
    if (dist > 60) continue;

    const hasCounterspell = combatantHasSpell(other, 'counterspell');
    const availableSlots = getAvailableSpellSlotLevels(other, 3);

    if (hasCounterspell && availableSlots.length > 0) {
      const minSlot = availableSlots[0]!;
      const prompt: PendingReactionPrompt = {
        promptId: `counter-${Date.now()}-${other.id}`,
        reactorEntityId: other.id,
        triggerType: 'spell_cast',
        triggerDescription: `${caster.name} is casting ${spell.name} (Level ${castAtLevel}). Cast Counterspell?`,
        availableReactions: availableSlots.map((slot) => ({
          id: `counterspell_slot_${slot}`,
          label: `Cast Counterspell (Slot Level ${slot})`,
          reactionType: 'counterspell',
          slotLevel: slot,
          description:
            slot >= castAtLevel
              ? `Automatically interrupts and cancels ${spell.name}!`
              : `Requires spellcasting ability check DC ${10 + castAtLevel} to interrupt ${spell.name}`,
        })),
      };
      return { prompt, reactor: other };
    }
  }

  return null;
}

/**
 * Resolves a pending reaction prompt submitted by the player or system adapter.
 * Resumes execution of the interrupted action pipeline.
 */
export function resolveReactionPrompt(
  state: CombatState,
  decisionInput: ResolveReactionDecision,
): { state: CombatState; events: CombatEvent[] } {
  if (state.phase !== 'reaction_prompt' || !state.pendingReactionPrompt) {
    throw new Error('No pending reaction prompt to resolve');
  }
  if (state.pendingReactionPrompt.promptId !== decisionInput.promptId) {
    throw new Error(
      `Prompt ID mismatch: expected ${state.pendingReactionPrompt.promptId}, got ${decisionInput.promptId}`,
    );
  }

  const prompt = state.pendingReactionPrompt;
  const context = state.reactionInterruptContext;
  if (!context) {
    throw new Error('Missing reaction interrupt context');
  }

  const events: CombatEvent[] = [];
  const { decision } = decisionInput;

  // 1. Pass decision
  if (!decision.execute) {
    events.push({
      type: 'REACTION_RESOLVED',
      promptId: prompt.promptId,
      reactorEntityId: prompt.reactorEntityId,
      actionTaken: 'passed',
    });

    return resumeInterruptedAction(state, context, false, undefined, events);
  }

  // 2. Execute decision
  const chosenReaction = prompt.availableReactions.find((r) => r.id === decision.reactionId);
  events.push({
    type: 'REACTION_RESOLVED',
    promptId: prompt.promptId,
    reactorEntityId: prompt.reactorEntityId,
    actionTaken: 'executed',
    reactionId: decision.reactionId,
    reactionType: chosenReaction?.reactionType,
  });

  return resumeInterruptedAction(state, context, true, decision, events);
}

/**
 * Resumes the interrupted pipeline after reaction execution or pass.
 */
function resumeInterruptedAction(
  state: CombatState,
  context: ReactionInterruptContext,
  didExecute: boolean,
  decision?: { execute: true; reactionId: string; slotLevel?: number } | undefined,
  accumulatedEvents: CombatEvent[] = [],
): { state: CombatState; events: CombatEvent[] } {
  const events = [...accumulatedEvents];
  let currentState: CombatState = {
    ...state,
    phase: 'active_turn',
    pendingReactionPrompt: null,
    reactionInterruptContext: null,
  };

  switch (context.type) {
    case 'attack_hit': {
      const {
        options,
        attackerId,
        targetId,
        attackDetails,
        attackRollRecord,
        targetEffectiveAc,
        cover,
        outcome: originalOutcome,
      } = context;

      let isShieldMiss = false;
      let halveDamage = false;

      if (didExecute && decision) {
        // Spend reactor reaction
        const spentRes = spendCombatantReaction(currentState, targetId);
        currentState = spentRes.state;

        if (decision.reactionId === 'cast_shield' || decision.reactionId.startsWith('cast_shield')) {
          const slotToUse = decision.slotLevel ?? 1;
          const target = currentState.combatants[targetId]!;
          const slotSpentTarget = expendSpellSlot(target, slotToUse);
          const buffedTarget = applyShieldBuff(slotSpentTarget);

          currentState = {
            ...currentState,
            combatants: {
              ...currentState.combatants,
              [targetId]: buffedTarget,
            },
          };

          events.push({
            type: 'SPELL_CAST',
            actorId: targetId,
            spellId: 'shield',
            spellName: 'Shield',
            spellLevel: 1,
            castAtLevel: slotToUse,
            actionCost: 'reaction',
            slotExpended: slotToUse,
            targetEntityIds: [targetId],
          });

          // Check if Shield turns hit into miss
          const isCrit = attackRollRecord.rolls[0] === 20;
          if (!isCrit && attackRollRecord.total < buffedTarget.armorClass) {
            isShieldMiss = true;
          }
        } else if (decision.reactionId === 'uncanny_dodge') {
          halveDamage = true;
        }
      }

      if (isShieldMiss) {
        // Hit turned into a MISS!
        events.push({
          type: 'ATTACK_RESOLVED',
          attackerId,
          targetId,
          weaponOrSpellName: attackDetails.name,
          attackType: attackDetails.attackType,
          roll: attackRollRecord.rolls[0] ?? attackRollRecord.total,
          totalToHit: attackRollRecord.total,
          targetAc: currentState.combatants[targetId]!.armorClass,
          outcome: 'miss',
          cover,
        });

        return { state: currentState, events };
      }

      // Attack still hits: emit hit resolution and apply damage
      const isCritical = originalOutcome === 'critical_hit';
      const dmgRes = rollDamage(currentState.rngState, attackDetails.damageFormula, {
        critical: isCritical,
      });
      currentState = { ...currentState, rngState: dmgRes.nextState };

      let totalDamage = dmgRes.total;
      if (halveDamage) {
        totalDamage = Math.floor(totalDamage / 2);
      }

      events.push({
        type: 'ATTACK_RESOLVED',
        attackerId,
        targetId,
        weaponOrSpellName: attackDetails.name,
        attackType: attackDetails.attackType,
        roll: attackRollRecord.rolls[0] ?? attackRollRecord.total,
        totalToHit: attackRollRecord.total,
        targetAc: currentState.combatants[targetId]!.armorClass,
        outcome: originalOutcome,
        damage: {
          total: totalDamage,
          damageType: attackDetails.damageType,
          diceFormula: attackDetails.damageFormula,
        },
        cover,
      });

      // Apply damage
      const damageAppRes = applyDamage({
        state: currentState,
        targetId,
        attackerId,
        rawAmount: totalDamage,
        damageType: attackDetails.damageType,
        isCritical,
        sourceName: attackDetails.name,
      });
      currentState = damageAppRes.state;
      events.push(...damageAppRes.events);

      return { state: currentState, events };
    }

    case 'attack_declared': {
      const { options, attackerId, targetId, protectorId } = context;

      if (didExecute) {
        // Protector spends reaction
        const spentRes = spendCombatantReaction(currentState, protectorId);
        currentState = spentRes.state;
      }

      // Resume weapon attack with protection disadvantage applied if executed
      const attackRes = executeWeaponAttack({
        ...options,
        state: currentState,
        skipReactionPrompts: true, // Prevent looping on same attack declaration
        forcedProtectionDisadvantage: didExecute,
      });
      events.push(...attackRes.events);
      return { state: attackRes.state, events };
    }

    case 'movement': {
      const {
        actorId,
        fullPath,
        completedPath,
        currentStepIndex,
        spentMovementFeet,
        remainingPath,
        stepFrom,
        stepTo,
      } = context;

      if (didExecute) {
        const reactorId = state.pendingReactionPrompt?.reactorEntityId ?? context.stepFrom ? state.initiativeOrder[0]?.entityId : '';
        // Reactor spends reaction & executes melee weapon attack at stepFrom
        const reactor = currentState.combatants[context.stepFrom ? (state.pendingReactionPrompt?.reactorEntityId ?? '') : ''];
        if (reactor) {
          const spentRes = spendCombatantReaction(currentState, reactor.id);
          currentState = spentRes.state;

          const oaRes = executeWeaponAttack({
            state: currentState,
            attackerId: reactor.id,
            targetId: actorId,
            isReaction: true,
            skipReactionPrompts: true,
          });
          currentState = oaRes.state;
          events.push(...oaRes.events);

          const moverNow = currentState.combatants[actorId];
          if (!moverNow || moverNow.isDead || moverNow.currentHp <= 0 || isIncapacitated(moverNow)) {
            // Mover halted at stepFrom!
            const finalMover: Combatant = {
              ...(moverNow ?? state.combatants[actorId]!),
              position: stepFrom,
            };
            currentState = {
              ...currentState,
              combatants: {
                ...currentState.combatants,
                [actorId]: finalMover,
              },
            };
            return { state: currentState, events };
          }
        }
      }

      // Mover survived or passed: continue remaining movement steps
      const mover = currentState.combatants[actorId]!;
      const finalPos = remainingPath[remainingPath.length - 1] ?? stepTo;
      const updatedMover: Combatant = {
        ...mover,
        position: finalPos,
      };

      currentState = {
        ...currentState,
        combatants: {
          ...currentState.combatants,
          [actorId]: updatedMover,
        },
      };

      events.push({
        type: 'ENTITY_MOVED',
        entityId: actorId,
        path: remainingPath,
        mode: 'walk',
      });

      return { state: currentState, events };
    }

    case 'spell_cast': {
      const { options, casterId, spell, slotLevel, reactorId } = context;

      if (didExecute && decision) {
        const reactor = currentState.combatants[reactorId];
        if (reactor) {
          const spentRes = spendCombatantReaction(currentState, reactor.id);
          currentState = spentRes.state;

          const slotToUse = decision.slotLevel ?? 3;
          const slotSpentReactor = expendSpellSlot(spentRes.combatant, slotToUse);
          currentState = {
            ...currentState,
            combatants: {
              ...currentState.combatants,
              [reactor.id]: slotSpentReactor,
            },
          };

          events.push({
            type: 'SPELL_CAST',
            actorId: reactor.id,
            spellId: 'counterspell',
            spellName: 'Counterspell',
            spellLevel: 3,
            castAtLevel: slotToUse,
            actionCost: 'reaction',
            slotExpended: slotToUse,
            targetEntityIds: [casterId],
          });

          // Check if Counterspell succeeds
          let counterSuccess = false;
          if (slotToUse >= slotLevel) {
            counterSuccess = true;
          } else {
            // Ability check DC = 10 + spell level
            const dc = 10 + slotLevel;
            const abilityMod =
              reactor.characterSheet?.spellcasting?.classes[0]?.abilityModifier ??
              reactor.monsterData?.abilities?.int ??
              reactor.dexterityModifier;
            const rollRes = rollD20(currentState.rngState, {
              mode: 'normal',
              modifier: abilityMod,
            });
            currentState = { ...currentState, rngState: rollRes.nextState };
            counterSuccess = rollRes.total >= dc;
          }

          if (counterSuccess) {
            // Triggering spell is countered! Caster loses slot & action
            const caster = currentState.combatants[casterId]!;
            const slotSpentCaster = expendSpellSlot(caster, slotLevel);
            currentState = {
              ...currentState,
              combatants: {
                ...currentState.combatants,
                [casterId]: slotSpentCaster,
              },
            };

            events.push({
              type: 'SPELL_CAST',
              actorId: casterId,
              spellId: spell.id,
              spellName: spell.name,
              spellLevel: spell.level,
              castAtLevel: slotLevel,
              actionCost: 'action',
              slotExpended: slotLevel,
              targetEntityIds: [],
            });

            return { state: currentState, events };
          }
        }
      }

      // Counterspell was not used or failed: spell executes normally
      const castRes = executeSpellCast({
        ...options,
        state: currentState,
        skipReactionPrompts: true,
      });
      events.push(...castRes.events);
      return { state: castRes.state, events };
    }

    default:
      return { state: currentState, events };
  }
}
