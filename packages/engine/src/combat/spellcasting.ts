import {
  type AbilityId,
  type ConditionId,
  type DamageType,
  type EffectStepSpec,
  type SpellCastingTime,
  type SpellData,
  type SpellDuration,
  createCompendium,
  type SrdCompendium,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type FormulaContext,
  type RollMode,
  resolveRollMode,
  rollD20,
  rollDamage,
} from '../dice/evaluator.js';
import {
  doesFootprintContainCell,
  getFootprintCells,
  getFootprintDistanceFeet,
} from '../grid/footprints.js';
import {
  type GridPoint,
  type TacticalGrid,
} from '../grid/model.js';
import {
  COVER_AC_BONUS,
  type CoverLevel,
  computeCover,
} from '../grid/vision.js';
import {
  type AoeShape,
  cellCenterFeet,
  intersectionFeet,
  rasterizeAoe,
} from '../grid/aoe.js';
import {
  type CombatEvent,
  type CombatState,
  type Combatant,
} from './types.js';
import {
  canCastSpell,
  isIncapacitated,
  recordSpellCast,
} from './turn-budget.js';
import { evaluateCombatVictory } from './state-machine.js';
import { applyDamage, applyHealing } from './damage.js';

let defaultCompendium: SrdCompendium | null = null;
function getDefaultCompendium(): SrdCompendium {
  if (!defaultCompendium) {
    defaultCompendium = createCompendium();
  }
  return defaultCompendium;
}

/**
 * Parses duration into remaining rounds for concentration/effect tracking.
 */
export function getDurationRounds(duration?: SpellDuration): number {
  if (!duration) return 10;
  switch (duration.type) {
    case 'instantaneous':
      return 0;
    case 'rounds':
      return duration.rounds;
    case 'minutes':
      return duration.amount * 10;
    case 'hours':
      return duration.amount * 600;
    case 'days':
      return duration.amount * 14400;
    default:
      return 10;
  }
}

/**
 * Scales a dice formula by adding bonus dice for upcasting higher spell slots (e.g. "3d6" + 2x "1d6" -> "5d6").
 */
export function scaleDiceFormula(
  baseFormula: string,
  bonusDicePerSlot: string,
  extraSlots: number,
): string {
  if (extraSlots <= 0) return baseFormula;
  const bonusMatch = bonusDicePerSlot.trim().match(/^(\d+)d(\d+)$/i);
  if (!bonusMatch) return baseFormula;
  const bonusCountPerSlot = parseInt(bonusMatch[1]!, 10);
  const bonusFaces = parseInt(bonusMatch[2]!, 10);
  const totalBonusDice = bonusCountPerSlot * extraSlots;

  // Find the first matching XdY where Y === bonusFaces
  const regexWithFaces = new RegExp(`(\\d+)d${bonusFaces}`, 'i');
  const baseMatch = baseFormula.match(regexWithFaces) ?? baseFormula.match(/(\d+)d(\d+)/i);

  if (!baseMatch) {
    return `${baseFormula} + ${totalBonusDice}d${bonusFaces}`;
  }

  const baseCount = parseInt(baseMatch[1]!, 10);
  const newCount = baseCount + totalBonusDice;
  const targetSubstr = baseMatch[0];
  const newSubstr = `${newCount}d${baseMatch[2] ?? bonusFaces}`;

  return baseFormula.replace(targetSubstr, newSubstr);
}

/**
 * Recursively applies an effect step override (such as diceFormula) to an EffectStepSpec.
 */
export function applyEffectOverride(
  step: EffectStepSpec,
  override: Partial<EffectStepSpec>,
): EffectStepSpec {
  const cloned = structuredClone(step);
  const overrideWithFormula = override as { diceFormula?: string };
  if (overrideWithFormula.diceFormula) {
    if (cloned.step === 'deal_damage' || cloned.step === 'heal') {
      cloned.diceFormula = overrideWithFormula.diceFormula;
    } else if (cloned.step === 'attack_roll') {
      cloned.onHit = cloned.onHit.map((c) => applyEffectOverride(c, override));
      if (cloned.onMiss) {
        cloned.onMiss = cloned.onMiss.map((c) => applyEffectOverride(c, override));
      }
    } else if (cloned.step === 'saving_throw') {
      cloned.onFail = cloned.onFail.map((c) => applyEffectOverride(c, override));
      if (cloned.onSuccess) {
        cloned.onSuccess = cloned.onSuccess.map((c) => applyEffectOverride(c, override));
      }
    }
  }
  return cloned;
}

/**
 * Returns the effective caster level of a combatant.
 */
export function getCombatantCasterLevel(combatant: Combatant): number {
  if (combatant.characterSheet) {
    return (
      combatant.characterSheet.spellcasting?.effectiveCasterLevel ||
      combatant.characterSheet.totalLevel ||
      1
    );
  }
  if (combatant.monsterData?.spellcasting?.casterLevel) {
    return combatant.monsterData.spellcasting.casterLevel;
  }
  if (combatant.monsterData) {
    return Math.max(1, Math.floor(combatant.monsterData.challengeRating || 1));
  }
  return 1;
}

/**
 * Returns the caster's spellcasting DC, spell attack bonus, and ability modifier context.
 */
export function getCasterSpellContext(caster: Combatant): {
  spellSaveDc: number;
  spellAttackBonus: number;
  spellMod: number;
  prof: number;
} {
  let spellSaveDc = 13;
  let spellAttackBonus = 5;
  let spellMod = 3;
  let prof = 2;

  if (caster.characterSheet) {
    prof = caster.characterSheet.proficiencyBonus;
    const sp = caster.characterSheet.spellcasting;
    if (sp) {
      if (sp.primarySpellSaveDc !== undefined) spellSaveDc = sp.primarySpellSaveDc;
      if (sp.primarySpellAttackBonus !== undefined) spellAttackBonus = sp.primarySpellAttackBonus;
      const ability = sp.primaryAbility ?? 'int';
      spellMod = caster.characterSheet.abilities[ability]?.modifier ?? 3;
    }
  } else if (caster.monsterData?.spellcasting) {
    const sp = caster.monsterData.spellcasting;
    spellSaveDc = sp.spellSaveDc;
    spellAttackBonus = sp.spellAttackBonus;
    const ability = sp.ability;
    spellMod = Math.floor(((caster.monsterData.abilities[ability] ?? 10) - 10) / 2);
  }

  return { spellSaveDc, spellAttackBonus, spellMod, prof };
}

/**
 * Returns a target's saving throw modifier for a specific ability.
 */
export function getTargetSavingThrowBonus(target: Combatant, ability: AbilityId): number {
  if (target.characterSheet?.savingThrows[ability]) {
    return target.characterSheet.savingThrows[ability].totalBonus;
  }
  if (target.monsterData?.savingThrows?.[ability] !== undefined) {
    return target.monsterData.savingThrows[ability]!;
  }
  if (ability === 'dex') {
    return target.dexterityModifier;
  }
  if (ability === 'str') {
    return target.strengthModifier ?? (target.monsterData ? Math.floor(((target.monsterData.abilities.str ?? 10) - 10) / 2) : 0);
  }
  if (target.monsterData) {
    const abilityScore = target.monsterData.abilities[ability] ?? 10;
    return Math.floor((abilityScore - 10) / 2);
  }
  return 0;
}

/**
 * Checks whether the target auto-fails or has advantage/disadvantage on a saving throw.
 */
export function getTargetSavingThrowRollMode(
  target: Combatant,
  ability: AbilityId,
): {
  mode: RollMode;
  autoFail: boolean;
  advantageSources: string[];
  disadvantageSources: string[];
} {
  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];
  let autoFail = false;

  // Auto-fail STR and DEX saves if incapacitated/paralyzed/petrified/stunned/unconscious
  if (ability === 'str' || ability === 'dex') {
    const failsSave = target.conditions.some((c) =>
      ['paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c),
    );
    if (failsSave) {
      autoFail = true;
    }
  }

  // DEX save modifiers
  if (ability === 'dex') {
    if (target.isDodging) {
      advantageSources.push('dodge');
    }
    if (target.conditions.includes('restrained')) {
      disadvantageSources.push('restrained');
    }
  }

  // Magic Resistance trait
  if (target.monsterData?.traits?.some((t) => t.name.toLowerCase().includes('magic resistance'))) {
    advantageSources.push('magic_resistance');
  }

  const mode = resolveRollMode({ advantageSources, disadvantageSources });
  return { mode, autoFail, advantageSources, disadvantageSources };
}

/**
 * Options for verifying if a combatant can cast a spell.
 */
export interface CanCastSpellOptions {
  state: CombatState;
  casterId: string;
  spell: SpellData;
  slotLevel?: number;
  isReaction?: boolean;
}

/**
 * Checks whether a combatant is allowed to cast a spell under turn budget, bonus action rule, and slot availability.
 */
export function canCombatantCastSpell(options: CanCastSpellOptions): {
  allowed: boolean;
  reason?: string;
  slotToConsume?: number;
  usePactMagic?: boolean;
} {
  const { state, casterId, spell, slotLevel, isReaction } = options;
  const caster = state.combatants[casterId];
  if (!caster) {
    return { allowed: false, reason: `Combatant ${casterId} not found in encounter` };
  }
  if (caster.isDead || caster.currentHp <= 0) {
    return { allowed: false, reason: `${caster.name} is dead or at 0 HP` };
  }
  if (isIncapacitated(caster)) {
    return { allowed: false, reason: `${caster.name} is incapacitated and cannot cast spells` };
  }

  const effectiveCastingTime: 'action' | 'bonus_action' | 'reaction' =
    isReaction || spell.castingTime === 'reaction'
      ? 'reaction'
      : spell.castingTime === 'bonus_action'
        ? 'bonus_action'
        : 'action';

  const isCantrip = spell.level === 0;

  // 1. Turn budget & SRD 5.1 Bonus Action rule verification (if on active turn)
  if (state.activeCombatantId === casterId && state.turnBudget) {
    const budgetCheck = canCastSpell(state.turnBudget, effectiveCastingTime, isCantrip);
    if (!budgetCheck.allowed) {
      return budgetCheck;
    }
  } else if (effectiveCastingTime === 'reaction') {
    // Reaction taken on another creature's turn
    if (state.turnBudget && state.activeCombatantId === casterId && !state.turnBudget.reactionAvailable) {
      return { allowed: false, reason: 'Reaction is not available this round' };
    }
  }

  // 2. Spell slot verification
  if (isCantrip) {
    return { allowed: true };
  }

  const requestedLevel = slotLevel ?? spell.level;
  if (requestedLevel < spell.level) {
    return {
      allowed: false,
      reason: `Cannot cast ${spell.name} (level ${spell.level}) using a lower slot (level ${requestedLevel})`,
    };
  }
  if (requestedLevel > 9) {
    return { allowed: false, reason: 'Spell slot level cannot exceed 9' };
  }

  // Monster at-will check
  if (caster.monsterData?.spellcasting?.atWillSpellIds?.includes(spell.id)) {
    return { allowed: true };
  }

  // Check Pact Magic
  if (caster.pactMagic && caster.pactMagic.slotLevel === requestedLevel && caster.pactMagic.availableSlots > 0) {
    return { allowed: true, slotToConsume: requestedLevel, usePactMagic: true };
  }

  // Check standard spell slots
  if (caster.spellSlots) {
    const pool = caster.spellSlots[String(requestedLevel)];
    if (pool && pool.available > 0) {
      return { allowed: true, slotToConsume: requestedLevel };
    }
    return {
      allowed: false,
      reason: `No level ${requestedLevel} spell slots available for ${caster.name}`,
    };
  }

  // Monster slots by level
  if (caster.monsterData?.spellcasting?.slotsByLevel) {
    const count = caster.monsterData.spellcasting.slotsByLevel[String(requestedLevel)] ?? 0;
    if (count > 0) {
      return { allowed: true, slotToConsume: requestedLevel };
    }
    return {
      allowed: false,
      reason: `No level ${requestedLevel} spell slots remaining for ${caster.name}`,
    };
  }

  // If caster has character sheet spell slots
  if (caster.characterSheet?.spellcasting?.spellSlots) {
    const pool = caster.characterSheet.spellcasting.spellSlots[requestedLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
    if (pool && pool.available > 0) {
      return { allowed: true, slotToConsume: requestedLevel };
    }
    return {
      allowed: false,
      reason: `No level ${requestedLevel} spell slots available for ${caster.name}`,
    };
  }

  return { allowed: true };
}

/**
 * Options for executing a spell cast.
 */
export interface ExecuteSpellCastOptions {
  state: CombatState;
  casterId: string;
  spell?: SpellData;
  spellId?: string;
  slotLevel?: number;
  targetIds?: string[];
  originCell?: GridPoint;
  direction?: { x: number; y: number };
  cardinalFacing?: 'n' | 'e' | 's' | 'w';
  grid?: TacticalGrid;
  isReaction?: boolean;
  compendium?: SrdCompendium;
}

/**
 * Output of spell cast execution.
 */
export interface SpellCastResolutionResult {
  state: CombatState;
  events: CombatEvent[];
  spell: SpellData;
  effectiveSlotLevel: number;
  targetsHit: string[];
  targetsMissed: string[];
  targetsSaved: string[];
  targetsFailedSave: string[];
  totalDamageByTarget: Record<string, number>;
  totalHealingByTarget: Record<string, number>;
}

/**
 * Executes a spell cast conforming to SRD 5.1 rules:
 * - Validates turn budget, action economy, and the Bonus Action spellcasting rule.
 * - Deducts spell slots (or pact magic).
 * - Manages Concentration (ends previous concentration if applicable).
 * - Applies cantrip / slot-level scaling to damage dice and overrides.
 * - Resolves Spell Attack rolls (Advantage/Disadvantage, cover, critical hits).
 * - Resolves Saving Throws (DC calculation, bonuses, auto-fails, half damage on save).
 * - Applies Damage, Healing, Temp HP, Conditions, and Encounter Victory evaluation.
 */
export function executeSpellCast(options: ExecuteSpellCastOptions): SpellCastResolutionResult {
  const {
    state,
    casterId,
    slotLevel,
    originCell,
    grid,
    isReaction,
    compendium = getDefaultCompendium(),
  } = options;

  let spell: SpellData;
  if (options.spell) {
    spell = options.spell;
  } else if (options.spellId) {
    const found = compendium.getSpell(options.spellId);
    if (!found) {
      throw new Error(`Spell ${options.spellId} not found in compendium`);
    }
    spell = found;
  } else {
    throw new Error('Either spell or spellId must be provided to executeSpellCast');
  }

  const caster = state.combatants[casterId];
  if (!caster) {
    throw new Error(`Caster ${casterId} not found in combat state`);
  }

  // 1. Validation
  const canCast = canCombatantCastSpell({
    state,
    casterId,
    spell,
    slotLevel,
    isReaction,
  });
  if (!canCast.allowed) {
    throw new Error(canCast.reason ?? 'Spell casting disallowed');
  }

  const effectiveSlotLevel = spell.level === 0 ? 0 : (slotLevel ?? spell.level);
  let currentState = state.rngState;
  const events: CombatEvent[] = [];

  // 2. Identify Targets
  const allCombatants = Object.values(state.combatants);
  let resolvedTargetIds: string[] = options.targetIds ? [...options.targetIds] : [];

  if (spell.targeting.type === 'self') {
    resolvedTargetIds = [caster.id];
  } else if (spell.targeting.type === 'touch') {
    if (resolvedTargetIds.length === 0) {
      throw new Error(`Touch spell ${spell.name} requires a target`);
    }
    const target = state.combatants[resolvedTargetIds[0]!];
    if (!target) throw new Error(`Target ${resolvedTargetIds[0]} not found`);
    const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
    if (dist > 5) {
      throw new Error(`Target ${target.name} is out of touch range (${dist} ft away)`);
    }
  } else if (spell.targeting.type === 'single') {
    if (resolvedTargetIds.length === 0) {
      throw new Error(`Single-target spell ${spell.name} requires a target`);
    }
    const target = state.combatants[resolvedTargetIds[0]!];
    if (!target) throw new Error(`Target ${resolvedTargetIds[0]} not found`);
    const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
    if (dist > spell.targeting.rangeFeet) {
      throw new Error(`Target ${target.name} is out of spell range (${dist} ft > ${spell.targeting.rangeFeet} ft)`);
    }
    if (grid && spell.targeting.requiresSight) {
      const obstacles = Object.values(state.combatants)
        .filter((c) => c.id !== caster.id && c.id !== target.id && !c.isDead && c.currentHp > 0)
        .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y, size: c.size }));
      const coverRes = computeCover(
        grid,
        { id: caster.id, x: caster.position.x, y: caster.position.y, size: caster.size },
        { id: target.id, x: target.position.x, y: target.position.y, size: target.size },
        obstacles,
      );
      if (coverRes.cover === 'total') {
        throw new Error(`Target ${target.name} has total cover and cannot be targeted`);
      }
    }
  } else if (spell.targeting.type === 'multiple') {
    let maxTargets = typeof spell.targeting.maxTargets === 'number' ? spell.targeting.maxTargets : 3;
    if (spell.higherLevelScaling?.bonusTargetsPerSlotAboveBase && effectiveSlotLevel > spell.level) {
      maxTargets += (effectiveSlotLevel - spell.level) * spell.higherLevelScaling.bonusTargetsPerSlotAboveBase;
    }
    if (resolvedTargetIds.length > maxTargets) {
      throw new Error(`Too many targets for ${spell.name}: max ${maxTargets}, provided ${resolvedTargetIds.length}`);
    }
    for (const tid of resolvedTargetIds) {
      const target = state.combatants[tid];
      if (!target) throw new Error(`Target ${tid} not found`);
      const dist = getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
      if (dist > spell.targeting.rangeFeet) {
        throw new Error(`Target ${target.name} is out of spell range (${dist} ft > ${spell.targeting.rangeFeet} ft)`);
      }
    }
  } else if (spell.targeting.type === 'point_aoe' || spell.targeting.type === 'self_aoe') {
    const centerPoint =
      spell.targeting.type === 'self_aoe'
        ? caster.position
        : originCell ?? (resolvedTargetIds[0] ? state.combatants[resolvedTargetIds[0]]?.position : caster.position);

    if (spell.targeting.type === 'point_aoe' && originCell) {
      const originDist = getFootprintDistanceFeet(caster.position, caster.size, originCell, 'small');
      if (originDist > spell.targeting.rangeFeet) {
        throw new Error(`AOE origin is out of range (${originDist} ft > ${spell.targeting.rangeFeet} ft)`);
      }
    }

    if (spell.targeting.aoe && centerPoint) {
      const shape = spell.targeting.aoe.shape as AoeShape;
      const sizeFeet = spell.targeting.aoe.sizeFeet;
      const widthFeet = spell.targeting.aoe.widthFeet ?? 5;

      let aoeCells: GridPoint[] = [];
      if (shape === 'sphere' || shape === 'cylinder') {
        aoeCells = rasterizeAoe({
          shape: 'sphere',
          origin: intersectionFeet(centerPoint.x, centerPoint.y),
          radiusFeet: sizeFeet,
        });
      } else if (shape === 'cube') {
        aoeCells = rasterizeAoe({
          shape: 'cube',
          origin: intersectionFeet(centerPoint.x, centerPoint.y),
          sideFeet: sizeFeet,
          facing: options.cardinalFacing ?? 'e',
        });
      } else if (shape === 'cone') {
        const dir = options.direction ?? { x: 1, y: 0 };
        aoeCells = rasterizeAoe({
          shape: 'cone',
          origin: cellCenterFeet(centerPoint),
          direction: dir,
          lengthFeet: sizeFeet,
        });
      } else if (shape === 'line') {
        const dir = options.direction ?? { x: 1, y: 0 };
        const originFt = cellCenterFeet(centerPoint);
        aoeCells = rasterizeAoe({
          shape: 'line',
          origin: originFt,
          target: { x: originFt.x + dir.x, y: originFt.y + dir.y },
          lengthFeet: sizeFeet,
          widthFeet,
        });
      }

      // Collect creatures in AOE cells
      const aoeTargetIds: string[] = [];
      for (const combatant of allCombatants) {
        if (combatant.isDead || combatant.currentHp <= 0) continue;
        const footCells = getFootprintCells(combatant.position, combatant.size);
        const overlaps = footCells.some((fc) =>
          aoeCells.some((ac) => ac.x === fc.x && ac.y === fc.y),
        );
        if (overlaps) {
          if (spell.targeting.targetFilter === 'enemy') {
            if (caster.side === 'party' && combatant.side === 'monster') aoeTargetIds.push(combatant.id);
            else if (caster.side === 'monster' && combatant.side === 'party') aoeTargetIds.push(combatant.id);
          } else if (spell.targeting.targetFilter === 'ally') {
            if (caster.side === combatant.side) aoeTargetIds.push(combatant.id);
          } else {
            aoeTargetIds.push(combatant.id);
          }
        }
      }

      if (!options.targetIds || options.targetIds.length === 0) {
        resolvedTargetIds = aoeTargetIds;
      }
    }
  }

  // 3. Concentration Management
  let nextCaster = { ...caster };
  if (spell.concentration) {
    if (nextCaster.concentratingOn) {
      events.push({
        type: 'CONCENTRATION_ENDED',
        entityId: nextCaster.id,
        spellId: nextCaster.concentratingOn.sourceId,
        reason: 'new_spell',
      });
    }
    const rounds = getDurationRounds(spell.duration);
    nextCaster.concentratingOn = {
      sourceId: spell.id,
      targetEntityIds: [...resolvedTargetIds],
      remainingRounds: rounds,
    };
    events.push({
      type: 'CONCENTRATION_STARTED',
      entityId: nextCaster.id,
      spellId: spell.id,
      spellName: spell.name,
      targetEntityIds: [...resolvedTargetIds],
    });
  }

  // 4. Deduct Action Budget & Spell Slots
  let nextBudget = state.turnBudget ? { ...state.turnBudget } : null;
  const effectiveCastingTime: 'action' | 'bonus_action' | 'reaction' =
    isReaction || spell.castingTime === 'reaction'
      ? 'reaction'
      : spell.castingTime === 'bonus_action'
        ? 'bonus_action'
        : 'action';

  if (nextBudget && state.activeCombatantId === casterId) {
    nextBudget = recordSpellCast(nextBudget, effectiveCastingTime, spell.level === 0);
  } else if (isReaction && nextBudget && state.activeCombatantId === casterId) {
    nextBudget.reactionAvailable = false;
  }

  let slotExpended: number | undefined;
  if (effectiveSlotLevel >= 1 && !caster.monsterData?.spellcasting?.atWillSpellIds?.includes(spell.id)) {
    slotExpended = effectiveSlotLevel;
    // Deduct standard slot
    if (nextCaster.spellSlots) {
      const lvlKey = String(effectiveSlotLevel);
      const pool = nextCaster.spellSlots[lvlKey];
      if (pool) {
        nextCaster.spellSlots = {
          ...nextCaster.spellSlots,
          [lvlKey]: {
            ...pool,
            expended: pool.expended + 1,
            available: Math.max(0, pool.available - 1),
          },
        };
      }
    }
    // Deduct pact magic if applicable
    if (nextCaster.pactMagic && nextCaster.pactMagic.slotLevel === effectiveSlotLevel) {
      nextCaster.pactMagic = {
        ...nextCaster.pactMagic,
        expendedSlots: nextCaster.pactMagic.expendedSlots + 1,
        availableSlots: Math.max(0, nextCaster.pactMagic.availableSlots - 1),
      };
    }
    // Sync characterSheet if present
    if (nextCaster.characterSheet?.spellcasting?.spellSlots) {
      const pool = nextCaster.characterSheet.spellcasting.spellSlots[effectiveSlotLevel as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
      if (pool) {
        pool.expended += 1;
        pool.available = Math.max(0, pool.available - 1);
      }
    }
  }

  events.push({
    type: 'SPELL_CAST',
    actorId: caster.id,
    spellId: spell.id,
    spellName: spell.name,
    spellLevel: spell.level,
    castAtLevel: effectiveSlotLevel,
    actionCost: effectiveCastingTime,
    slotExpended,
    targetEntityIds: [...resolvedTargetIds],
  });

  // 5. Higher-Level Scaling Preparation
  const casterLevel = getCombatantCasterLevel(caster);
  const casterCtx = getCasterSpellContext(caster);

  let scaledEffects: EffectStepSpec[] = structuredClone(spell.effects);

  // Apply cantrip character-level scaling (tiers: 17, 11, 5)
  if (spell.level === 0 && spell.higherLevelScaling?.mode === 'character_level') {
    const overrides = spell.higherLevelScaling.overrides;
    if (overrides) {
      for (const tier of [17, 11, 5]) {
        if (casterLevel >= tier && overrides[String(tier)]) {
          scaledEffects = scaledEffects.map((step) =>
            applyEffectOverride(step, overrides[String(tier)]!),
          );
          break;
        }
      }
    }
  }

  // Apply leveled spell slot scaling
  if (spell.level >= 1 && effectiveSlotLevel > spell.level) {
    const extraSlots = effectiveSlotLevel - spell.level;
    if (spell.higherLevelScaling?.bonusDicePerSlotAboveBase) {
      const bonusDice = spell.higherLevelScaling.bonusDicePerSlotAboveBase;
      scaledEffects = scaledEffects.map((step) => {
        const overrideStep = (s: EffectStepSpec): EffectStepSpec => {
          if (s.step === 'deal_damage' || s.step === 'heal') {
            return {
              ...s,
              diceFormula: scaleDiceFormula(s.diceFormula, bonusDice, extraSlots),
            };
          }
          if (s.step === 'attack_roll') {
            return {
              ...s,
              onHit: s.onHit.map(overrideStep),
              onMiss: s.onMiss?.map(overrideStep),
            };
          }
          if (s.step === 'saving_throw') {
            return {
              ...s,
              onFail: s.onFail.map(overrideStep),
              onSuccess: s.onSuccess?.map(overrideStep),
            };
          }
          return s;
        };
        return overrideStep(step);
      });
    }

    if (spell.higherLevelScaling?.overrides?.[String(effectiveSlotLevel)]) {
      const ov = spell.higherLevelScaling.overrides[String(effectiveSlotLevel)]!;
      scaledEffects = scaledEffects.map((s) => applyEffectOverride(s, ov));
    }
  }

  // 6. Execute Effect Steps on Targets
  const targetsHit: string[] = [];
  const targetsMissed: string[] = [];
  const targetsSaved: string[] = [];
  const targetsFailedSave: string[] = [];
  const totalDamageByTarget: Record<string, number> = {};
  const totalHealingByTarget: Record<string, number> = {};

  const combatantsMap: Record<string, Combatant> = {
    ...state.combatants,
    [nextCaster.id]: nextCaster,
  };

  const formulaVars: FormulaContext = {
    '@spellMod': casterCtx.spellMod,
    '@spellSaveDC': casterCtx.spellSaveDc,
    '@prof': casterCtx.prof,
    '@slotLevel': effectiveSlotLevel,
    spellMod: casterCtx.spellMod,
    spellSaveDC: casterCtx.spellSaveDc,
    prof: casterCtx.prof,
    slotLevel: effectiveSlotLevel,
  };

  // Helper to execute effect steps recursively on a target
  function executeSteps(
    steps: EffectStepSpec[],
    target: Combatant,
    options?: { isCritical?: boolean; isHalfDamage?: boolean },
  ): void {
    for (const step of steps) {
      if (step.step === 'attack_roll') {
        const isRanged = step.attackType === 'ranged_spell';
        const advSources: string[] = [];
        const disSources: string[] = [];

        // Attacker conditions
        if (nextCaster.conditions.includes('invisible')) advSources.push('caster_invisible');
        if (nextCaster.conditions.includes('blinded')) disSources.push('caster_blinded');
        if (nextCaster.conditions.includes('poisoned')) disSources.push('caster_poisoned');

        // Target conditions
        if (
          target.conditions.some((c) =>
            ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'].includes(c),
          )
        ) {
          advSources.push('target_incapacitated_or_impaired');
        }
        if (target.conditions.includes('invisible')) disSources.push('target_invisible');
        if (target.isDodging) disSources.push('target_dodging');

        // Prone & Distance
        const dist = getFootprintDistanceFeet(nextCaster.position, nextCaster.size, target.position, target.size);
        if (target.conditions.includes('prone')) {
          if (dist <= 5) advSources.push('target_prone_melee');
          else disSources.push('target_prone_ranged');
        }

        // Ranged spell attack with hostile within 5 ft
        if (isRanged) {
          const hasHostileAdjacent = allCombatants.some(
            (other) =>
              other.id !== nextCaster.id &&
              other.side !== nextCaster.side &&
              !other.isDead &&
              other.currentHp > 0 &&
              !isIncapacitated(other) &&
              getFootprintDistanceFeet(nextCaster.position, nextCaster.size, other.position, other.size) <= 5,
          );
          if (hasHostileAdjacent) {
            disSources.push('hostile_within_5ft');
          }
        }

        const rollMode = resolveRollMode({ advantageSources: advSources, disadvantageSources: disSources });
        const attackBonus = step.attackBonusOverride ?? casterCtx.spellAttackBonus;
        const d20Res = rollD20(currentState, {
          modifier: attackBonus,
          mode: rollMode,
          advantageSources: advSources,
          disadvantageSources: disSources,
        });
        currentState = d20Res.nextState;

        events.push({
          type: 'DICE_ROLLED',
          actorId: nextCaster.id,
          rollPurpose: 'spell_attack_roll',
          notation: d20Res.record.formula,
          rolls: d20Res.record.rolls,
          kept: d20Res.record.kept,
          modifier: d20Res.record.modifier,
          total: d20Res.total,
          mode: rollMode,
          naturalCrit: d20Res.naturalRoll === 20,
          naturalFumble: d20Res.naturalRoll === 1,
        });

        // Cover AC bonus
        let cover: CoverLevel = 'none';
        if (grid) {
          const obstacles = Object.values(state.combatants)
            .filter((c) => c.id !== nextCaster.id && c.id !== target.id && !c.isDead && c.currentHp > 0)
            .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y, size: c.size }));
          const coverRes = computeCover(
            grid,
            { id: nextCaster.id, x: nextCaster.position.x, y: nextCaster.position.y, size: nextCaster.size },
            { id: target.id, x: target.position.x, y: target.position.y, size: target.size },
            obstacles,
          );
          cover = coverRes.cover;
        }
        const effectiveAc = target.armorClass + COVER_AC_BONUS[cover];

        let outcome: 'miss' | 'hit' | 'critical_hit' = 'miss';
        if (d20Res.naturalRoll === 20) {
          outcome = 'critical_hit';
        } else if (d20Res.naturalRoll === 1) {
          outcome = 'miss';
        } else if (d20Res.total >= effectiveAc) {
          outcome = 'hit';
        }

        events.push({
          type: 'ATTACK_RESOLVED',
          attackerId: nextCaster.id,
          targetId: target.id,
          weaponOrSpellName: spell.name,
          attackType: step.attackType,
          roll: d20Res.naturalRoll,
          totalToHit: d20Res.total,
          targetAc: effectiveAc,
          outcome,
          cover: cover !== 'none' ? cover : undefined,
        });

        if (outcome === 'hit' || outcome === 'critical_hit') {
          targetsHit.push(target.id);
          executeSteps(step.onHit, target, { isCritical: outcome === 'critical_hit' });
        } else {
          targetsMissed.push(target.id);
          if (step.onMiss) {
            executeSteps(step.onMiss, target);
          }
        }
      } else if (step.step === 'saving_throw') {
        const targetBonus = getTargetSavingThrowBonus(target, step.ability);
        const { mode, autoFail, advantageSources, disadvantageSources } = getTargetSavingThrowRollMode(
          target,
          step.ability,
        );

        let roll = 10;
        let total = targetBonus + 10;
        let outcome: 'success' | 'failure' = 'failure';

        if (autoFail) {
          roll = 1;
          total = targetBonus + 1;
          outcome = 'failure';
        } else {
          const d20Res = rollD20(currentState, {
            modifier: targetBonus,
            mode,
            advantageSources,
            disadvantageSources,
          });
          currentState = d20Res.nextState;
          roll = d20Res.naturalRoll;
          total = d20Res.total;
          outcome = total >= casterCtx.spellSaveDc ? 'success' : 'failure';

          events.push({
            type: 'DICE_ROLLED',
            actorId: target.id,
            rollPurpose: `${step.ability.toUpperCase()} saving throw vs ${spell.name}`,
            notation: d20Res.record.formula,
            rolls: d20Res.record.rolls,
            kept: d20Res.record.kept,
            modifier: d20Res.record.modifier,
            total: d20Res.total,
            mode,
            naturalCrit: roll === 20,
            naturalFumble: roll === 1,
          });
        }

        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: target.id,
          ability: step.ability,
          dc: casterCtx.spellSaveDc,
          roll,
          total,
          outcome,
          sourceSpellOrAbilityName: spell.name,
        });

        if (outcome === 'success') {
          targetsSaved.push(target.id);
          if (step.onSuccess) {
            executeSteps(step.onSuccess, target);
          }
          // Half damage on save check
          for (const failStep of step.onFail) {
            if (failStep.step === 'deal_damage' && failStep.halfOnSaveSuccess) {
              executeSteps([failStep], target, { isHalfDamage: true });
            }
          }
        } else {
          targetsFailedSave.push(target.id);
          executeSteps(step.onFail, target);
        }
      } else if (step.step === 'deal_damage') {
        const dmgRes = rollDamage(currentState, step.diceFormula, {
          isCritical: options?.isCritical,
          context: formulaVars,
        });
        currentState = dmgRes.nextState;

        let finalDamage = dmgRes.total;
        if (options?.isHalfDamage) {
          finalDamage = Math.floor(finalDamage / 2);
        }

        events.push({
          type: 'DICE_ROLLED',
          actorId: nextCaster.id,
          rollPurpose: `damage_roll_${spell.name}`,
          notation: dmgRes.record.formula,
          rolls: dmgRes.record.rolls,
          kept: dmgRes.record.kept,
          modifier: dmgRes.record.modifier,
          total: dmgRes.total,
          mode: 'normal',
        });

        // Apply to target via Authoritative Damage Pipeline (SRD-307)
        const dmgAppliedRes = applyDamage({
          state: {
            ...state,
            rngState: currentState,
            combatants: combatantsMap,
          },
          targetId: target.id,
          rawAmount: finalDamage,
          damageType: step.damageType,
          isCritical: options?.isCritical,
          attackerId: nextCaster.id,
          sourceName: spell.name,
          isMagical: true,
        });
        currentState = dmgAppliedRes.state.rngState;
        const updatedTarget = dmgAppliedRes.state.combatants[target.id]!;
        combatantsMap[target.id] = updatedTarget;
        Object.assign(target, updatedTarget);
        events.push(...dmgAppliedRes.events);
        totalDamageByTarget[target.id] = (totalDamageByTarget[target.id] ?? 0) + dmgAppliedRes.finalAmount;
      } else if (step.step === 'heal') {
        const healRes = rollDamage(currentState, step.diceFormula, {
          context: formulaVars,
        });
        currentState = healRes.nextState;

        const healAmount = Math.max(0, healRes.total);
        const healAppliedRes = applyHealing({
          state: {
            ...state,
            combatants: combatantsMap,
          },
          targetId: target.id,
          amount: healAmount,
          sourceName: spell.name,
        });
        const updatedTarget = healAppliedRes.state.combatants[target.id]!;
        combatantsMap[target.id] = updatedTarget;
        Object.assign(target, updatedTarget);
        events.push(...healAppliedRes.events);
        totalHealingByTarget[target.id] = (totalHealingByTarget[target.id] ?? 0) + healAppliedRes.amount;
      } else if (step.step === 'grant_temp_hp') {
        const hpRes = rollDamage(currentState, step.amountFormula, {
          context: formulaVars,
        });
        currentState = hpRes.nextState;
        target.tempHp = Math.max(target.tempHp, hpRes.total);
      } else if (step.step === 'apply_condition') {
        if (!target.conditions.includes(step.conditionId)) {
          target.conditions = [...target.conditions, step.conditionId];
          events.push({
            type: 'CONDITION_ADDED',
            targetId: target.id,
            conditionId: step.conditionId,
            sourceName: spell.name,
          });
        }
      }
    }
  }

  // Iterate over resolved targets
  for (const tid of resolvedTargetIds) {
    const target = combatantsMap[tid];
    if (target && !target.isDead) {
      executeSteps(scaledEffects, target);
    }
  }

  // 7. Check Victory State
  const outcome = evaluateCombatVictory(combatantsMap);
  if (outcome !== 'in_progress' && outcome !== state.outcome) {
    events.push({
      type: 'ENCOUNTER_VICTORY',
      outcome,
      round: state.round,
    });
  }

  const nextState: CombatState = {
    ...state,
    turnBudget: nextBudget,
    combatants: combatantsMap,
    outcome,
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    spell,
    effectiveSlotLevel,
    targetsHit,
    targetsMissed,
    targetsSaved,
    targetsFailedSave,
    totalDamageByTarget,
    totalHealingByTarget,
  };
}
