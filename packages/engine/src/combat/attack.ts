import type {
  ConditionId,
  DamageType,
  WeaponProperty,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type RollMode,
  resolveRollMode,
  rollD20,
  rollDamage,
} from '../dice/evaluator.js';
import {
  CREATURE_SIZE_RANK,
  doesFootprintContainCell,
  getFootprintDistanceFeet,
} from '../grid/footprints.js';
import {
  type GridPoint,
  type TacticalGrid,
  getGridCell,
  isCellPassable,
  isWithinGridBounds,
} from '../grid/model.js';
import {
  COVER_AC_BONUS,
  type CoverLevel,
  computeCover,
} from '../grid/vision.js';
import {
  type CombatEvent,
  type CombatState,
  type Combatant,
  type TurnBudget,
} from './types.js';
import {
  isIncapacitated,
  spendAttack,
  spendReaction,
  spendTwoWeaponFightingBonusAttack,
} from './turn-budget.js';
import { evaluateCombatVictory } from './state-machine.js';
import { applyDamage } from './damage.js';

/**
 * Custom raw attack specification for testing or dynamic attacks.
 */
export interface CustomAttackProfile {
  name: string;
  attackType: 'melee_weapon' | 'ranged_weapon';
  toHitBonus: number;
  damageDice: string;
  damageBonus: number;
  damageType: DamageType;
  reachFeet?: number;
  rangeFeet?: { normal: number; long: number };
  critRange?: number;
  properties?: WeaponProperty[];
  isOffHand?: boolean;
  versatileDamageDice?: string;
  versatileDamageBonus?: number;
}

/**
 * Resolved concrete attack values ready for execution.
 */
export interface ResolvedAttackDetails {
  name: string;
  attackType: 'melee_weapon' | 'ranged_weapon';
  toHitBonus: number;
  damageDice: string;
  damageBonus: number;
  damageFormula: string;
  damageType: DamageType;
  reachFeet: number;
  rangeFeet?: { normal: number; long: number };
  critRange: number;
  properties: WeaponProperty[];
  isOffHand: boolean;
  versatileTwoHanded?: boolean;
}

export interface ExecuteAttackOptions {
  state: CombatState;
  attackerId: string;
  targetId: string;
  attackProfileId?: string;
  monsterActionId?: string;
  customAttack?: CustomAttackProfile;
  grid?: TacticalGrid;
  isOffHand?: boolean;
  isReaction?: boolean;
  versatileTwoHanded?: boolean;
  greatWeaponFighting?: boolean;
  extraCritDice?: number;
}

export interface AttackResolutionResult {
  state: CombatState;
  events: CombatEvent[];
  outcome: 'miss' | 'hit' | 'critical_hit';
  rollMode: RollMode;
  advantageSources: string[];
  disadvantageSources: string[];
  attackRollRecord: DiceRollRecord;
  targetEffectiveAc: number;
  cover: CoverLevel;
  damageRollRecord?: DiceRollRecord;
  damageDealt?: number;
}

export interface ExecuteGrappleOptions {
  state: CombatState;
  attackerId: string;
  targetId: string;
  grid?: TacticalGrid;
}

export interface GrappleResolutionResult {
  state: CombatState;
  events: CombatEvent[];
  success: boolean;
  attackerAthleticsTotal: number;
  targetContestTotal: number;
  targetSkillUsed: 'athletics' | 'acrobatics';
  attackerRollRecord: DiceRollRecord;
  targetRollRecord: DiceRollRecord;
}

export interface ExecuteShoveOptions {
  state: CombatState;
  attackerId: string;
  targetId: string;
  shoveType: 'knock_prone' | 'push_away';
  grid?: TacticalGrid;
}

export interface ShoveResolutionResult {
  state: CombatState;
  events: CombatEvent[];
  success: boolean;
  shoveType: 'knock_prone' | 'push_away';
  attackerAthleticsTotal: number;
  targetContestTotal: number;
  targetSkillUsed: 'athletics' | 'acrobatics';
  destination?: GridPoint;
  attackerRollRecord: DiceRollRecord;
  targetRollRecord: DiceRollRecord;
}

/**
 * Returns a combatant's total STR (Athletics) bonus.
 */
export function getCombatantAthleticsBonus(combatant: Combatant): number {
  if (combatant.characterSheet?.skills.athletics) {
    return combatant.characterSheet.skills.athletics.totalBonus;
  }
  if (combatant.monsterData) {
    const prof = combatant.monsterData.skills.athletics;
    if (typeof prof === 'number') return prof;
    return Math.floor((combatant.monsterData.abilities.str - 10) / 2);
  }
  if (typeof combatant.strengthModifier === 'number') {
    return combatant.strengthModifier;
  }
  return combatant.dexterityModifier;
}

/**
 * Returns a combatant's total DEX (Acrobatics) bonus.
 */
export function getCombatantAcrobaticsBonus(combatant: Combatant): number {
  if (combatant.characterSheet?.skills.acrobatics) {
    return combatant.characterSheet.skills.acrobatics.totalBonus;
  }
  if (combatant.monsterData) {
    const prof = combatant.monsterData.skills.acrobatics;
    if (typeof prof === 'number') return prof;
    return combatant.dexterityModifier;
  }
  return combatant.dexterityModifier;
}

/**
 * Resolves an attack profile from character sheet, monster data, or custom override.
 */
export function resolveCombatantAttackProfile(
  attacker: Combatant,
  options: {
    attackProfileId?: string;
    monsterActionId?: string;
    customAttack?: CustomAttackProfile;
    isOffHand?: boolean;
    versatileTwoHanded?: boolean;
  },
): ResolvedAttackDetails {
  if (options.customAttack) {
    const c = options.customAttack;
    const isTwoHanded = Boolean(options.versatileTwoHanded);
    const dice = isTwoHanded && c.versatileDamageDice ? c.versatileDamageDice : c.damageDice;
    const bonus = isTwoHanded && typeof c.versatileDamageBonus === 'number' ? c.versatileDamageBonus : c.damageBonus;
    const formula = bonus !== 0 ? `${dice} + ${bonus}` : dice;

    return {
      name: c.name,
      attackType: c.attackType,
      toHitBonus: c.toHitBonus,
      damageDice: dice,
      damageBonus: bonus,
      damageFormula: formula,
      damageType: c.damageType,
      reachFeet: c.reachFeet ?? (c.attackType === 'ranged_weapon' ? 5 : 5),
      rangeFeet: c.rangeFeet,
      critRange: c.critRange ?? 20,
      properties: c.properties ?? [],
      isOffHand: Boolean(c.isOffHand || options.isOffHand),
      versatileTwoHanded: isTwoHanded,
    };
  }

  // 1. From Character Sheet
  if (attacker.characterSheet) {
    const attacks = attacker.characterSheet.weaponAttacks;
    let profile = attacks[0];

    if (options.attackProfileId) {
      const found = attacks.find((a) => a.id === options.attackProfileId);
      if (!found) {
        throw new Error(
          `Attack profile "${options.attackProfileId}" not found on character "${attacker.name}"`,
        );
      }
      profile = found;
    } else if (options.isOffHand) {
      const offHand = attacks.find((a) => a.slot === 'off_hand' || a.actionCost === 'bonus_action');
      if (offHand) {
        profile = offHand;
      }
    }

    if (!profile) {
      throw new Error(`No weapon attack profiles available on character "${attacker.name}"`);
    }

    const isVersatile = profile.properties.includes('versatile');
    const isTwoHanded = Boolean(options.versatileTwoHanded && isVersatile);
    const damageDice = isTwoHanded && profile.versatileDamageDice
      ? profile.versatileDamageDice
      : profile.damageDice;
    const damageFormula = isTwoHanded && profile.versatileDamageFormula
      ? profile.versatileDamageFormula
      : profile.damageFormula;

    return {
      name: profile.name,
      attackType: profile.rangeType === 'ranged' ? 'ranged_weapon' : 'melee_weapon',
      toHitBonus: profile.toHitBonus,
      damageDice,
      damageBonus: profile.damageBonus,
      damageFormula,
      damageType: profile.damageType,
      reachFeet: profile.reachFeet,
      rangeFeet: profile.rangeFeet,
      critRange: profile.critRange,
      properties: profile.properties,
      isOffHand: profile.slot === 'off_hand' || profile.actionCost === 'bonus_action' || Boolean(options.isOffHand),
      versatileTwoHanded: isTwoHanded,
    };
  }

  // 2. From Monster Data
  if (attacker.monsterData) {
    const actions = attacker.monsterData.actions;
    let selectedAction = actions[0];

    if (options.monsterActionId) {
      const found = actions.find((a) => a.id === options.monsterActionId);
      if (!found) {
        throw new Error(
          `Monster action "${options.monsterActionId}" not found on "${attacker.name}"`,
        );
      }
      selectedAction = found;
    } else {
      const attackAction = actions.find((a) => a.effects.some((e) => e.step === 'attack_roll'));
      if (attackAction) {
        selectedAction = attackAction;
      }
    }

    if (!selectedAction) {
      throw new Error(`No action available on monster "${attacker.name}"`);
    }

    const attackStep = selectedAction.effects.find((e) => e.step === 'attack_roll');
    if (!attackStep || attackStep.step !== 'attack_roll') {
      throw new Error(`Action "${selectedAction.name}" does not contain an attack_roll step`);
    }

    const damageStep = attackStep.onHit.find((e) => e.step === 'deal_damage');
    const isRanged = attackStep.attackType === 'ranged_weapon' || attackStep.attackType === 'ranged_spell';

    // Parse reach / range from description if present (e.g. "reach 5 ft.", "range 80/320 ft.")
    let reachFeet = 5;
    let rangeFeet: { normal: number; long: number } | undefined;
    const reachMatch = selectedAction.description.match(/reach\s+(\d+)\s*ft/i);
    if (reachMatch && reachMatch[1]) {
      reachFeet = parseInt(reachMatch[1], 10);
    }
    const rangeMatch = selectedAction.description.match(/range\s+(\d+)\/(\d+)\s*ft/i);
    if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
      rangeFeet = {
        normal: parseInt(rangeMatch[1], 10),
        long: parseInt(rangeMatch[2], 10),
      };
    } else if (isRanged) {
      rangeFeet = { normal: 80, long: 320 };
    }

    const damageFormula = damageStep && damageStep.step === 'deal_damage' ? damageStep.diceFormula : '1d6';
    const damageType: DamageType = damageStep && damageStep.step === 'deal_damage' ? damageStep.damageType : 'slashing';

    return {
      name: selectedAction.name,
      attackType: isRanged ? 'ranged_weapon' : 'melee_weapon',
      toHitBonus: attackStep.attackBonusOverride ?? 0,
      damageDice: damageFormula,
      damageBonus: 0,
      damageFormula,
      damageType,
      reachFeet,
      rangeFeet,
      critRange: attackStep.critRange ?? 20,
      properties: [],
      isOffHand: false,
    };
  }

  // 3. Fallback unarmed strike
  const strMod = attacker.strengthModifier ?? attacker.dexterityModifier;
  return {
    name: 'Unarmed Strike',
    attackType: 'melee_weapon',
    toHitBonus: strMod + 2,
    damageDice: '1',
    damageBonus: Math.max(0, strMod),
    damageFormula: strMod > 0 ? `1 + ${strMod}` : '1',
    damageType: 'bludgeoning',
    reachFeet: 5,
    critRange: 20,
    properties: [],
    isOffHand: false,
  };
}

/**
 * Determines advantage, disadvantage, and roll mode for an attack roll.
 */
export function determineAttackRollMode(
  attacker: Combatant,
  target: Combatant,
  attack: ResolvedAttackDetails,
  distanceFeet: number,
  allCombatants: Record<string, Combatant>,
): {
  mode: RollMode;
  advantageSources: string[];
  disadvantageSources: string[];
} {
  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];

  // Attacker Conditions
  if (attacker.conditions.includes('invisible')) {
    advantageSources.push('Attacker is invisible');
  }
  if (attacker.conditions.includes('blinded')) {
    disadvantageSources.push('Attacker is blinded');
  }
  if (attacker.conditions.includes('poisoned')) {
    disadvantageSources.push('Attacker is poisoned');
  }
  if (attacker.conditions.includes('restrained')) {
    disadvantageSources.push('Attacker is restrained');
  }
  if (attacker.conditions.includes('prone')) {
    disadvantageSources.push('Attacker is prone');
  }
  if (attacker.conditions.includes('frightened')) {
    disadvantageSources.push('Attacker is frightened');
  }

  // Target Conditions
  if (target.conditions.includes('paralyzed')) {
    advantageSources.push('Target is paralyzed');
  }
  if (target.conditions.includes('stunned')) {
    advantageSources.push('Target is stunned');
  }
  if (target.conditions.includes('unconscious')) {
    advantageSources.push('Target is unconscious');
  }
  if (target.conditions.includes('restrained')) {
    advantageSources.push('Target is restrained');
  }
  if (target.conditions.includes('petrified')) {
    advantageSources.push('Target is petrified');
  }
  if (target.conditions.includes('blinded')) {
    advantageSources.push('Target is blinded');
  }
  if (target.conditions.includes('invisible')) {
    disadvantageSources.push('Target is invisible');
  }

  // Prone target rule (SRD 5.1):
  // - Attack within 5 ft: Advantage
  // - Attack beyond 5 ft: Disadvantage
  if (target.conditions.includes('prone')) {
    if (distanceFeet <= 5) {
      advantageSources.push('Target is prone within 5 ft');
    } else {
      disadvantageSources.push('Target is prone beyond 5 ft');
    }
  }

  // Target Dodging rule:
  // Disadvantage on attacks against if target can see attacker, is not incapacitated, and speed > 0
  if (
    target.isDodging &&
    !isIncapacitated(target) &&
    target.speedFeet > 0 &&
    !target.conditions.includes('blinded') &&
    !attacker.conditions.includes('invisible')
  ) {
    disadvantageSources.push('Target is dodging');
  }

  // Ranged Attack specifics:
  if (attack.attackType === 'ranged_weapon') {
    // Long range check
    if (
      attack.rangeFeet &&
      distanceFeet > attack.rangeFeet.normal &&
      distanceFeet <= attack.rangeFeet.long
    ) {
      disadvantageSources.push(
        `Long range (${distanceFeet} ft > ${attack.rangeFeet.normal} ft)`,
      );
    }

    // Hostile creature within 5 ft (Close Combat Disadvantage)
    const hasAdjacentHostile = Object.values(allCombatants).some((c) => {
      if (c.id === attacker.id || c.side === attacker.side || c.side === 'neutral') return false;
      if (c.isDead || c.currentHp <= 0 || isIncapacitated(c)) return false;
      return getFootprintDistanceFeet(attacker.position, attacker.size, c.position, c.size) <= 5;
    });

    if (hasAdjacentHostile) {
      disadvantageSources.push('Hostile creature within 5 ft of ranged attacker');
    }
  }

  const mode = resolveRollMode({ advantageSources, disadvantageSources });
  return { mode, advantageSources, disadvantageSources };
}

/**
 * Checks whether an actor has the Great Weapon Fighting style active.
 */
function hasGreatWeaponFighting(
  attacker: Combatant,
  attack: ResolvedAttackDetails,
  explicitOption?: boolean,
): boolean {
  if (typeof explicitOption === 'boolean') return explicitOption;
  const isEligibleWeapon =
    attack.properties.includes('two-handed') ||
    (attack.properties.includes('versatile') && Boolean(attack.versatileTwoHanded));
  if (!isEligibleWeapon) return false;

  const effects = attacker.characterSheet?.activeEffects ?? [];
  return effects.some(
    (e) => e.effectId.includes('great_weapon_fighting') || e.name.toLowerCase().includes('great weapon'),
  );
}

/**
 * Checks whether an actor gets extra weapon dice on a critical hit (Half-Orc Savage Attacks / Barbarian Brutal Critical).
 */
function getExtraCritDice(
  attacker: Combatant,
  attack: ResolvedAttackDetails,
  explicitExtra?: number,
): number {
  if (typeof explicitExtra === 'number') return explicitExtra;
  let count = 0;
  if (attack.attackType === 'melee_weapon' && attacker.characterSheet?.raceId === 'half_orc') {
    count += 1;
  }
  return count;
}

/**
 * Executes a full weapon attack, resolving range, cover, advantage/disadvantage, attack roll,
 * auto-crit conditions, damage roll, and action budget consumption.
 */
export function executeWeaponAttack(options: ExecuteAttackOptions): AttackResolutionResult {
  const {
    state,
    attackerId,
    targetId,
    grid,
    isReaction,
    versatileTwoHanded,
  } = options;

  const attacker = state.combatants[attackerId];
  if (!attacker) {
    throw new Error(`Attacker "${attackerId}" not found`);
  }
  const target = state.combatants[targetId];
  if (!target) {
    throw new Error(`Target "${targetId}" not found`);
  }
  if (target.isDead) {
    throw new Error(`Target "${target.name}" is already dead`);
  }

  let currentState = state.rngState;
  const events: CombatEvent[] = [];

  // 1. Resolve Attack Profile
  const attack = resolveCombatantAttackProfile(attacker, {
    attackProfileId: options.attackProfileId,
    monsterActionId: options.monsterActionId,
    customAttack: options.customAttack,
    isOffHand: options.isOffHand,
    versatileTwoHanded,
  });

  // 2. Validate Action Economy & Turn Budget
  let nextTurnBudget: TurnBudget | null = state.turnBudget ? { ...state.turnBudget } : null;

  if (nextTurnBudget && state.activeCombatantId === attackerId) {
    if (attack.isOffHand) {
      nextTurnBudget = spendTwoWeaponFightingBonusAttack(nextTurnBudget);
    } else if (isReaction) {
      nextTurnBudget = spendReaction(nextTurnBudget);
    } else {
      nextTurnBudget = spendAttack(nextTurnBudget, attacker.attacksPerAction);
    }
  }

  // 3. Distance & Reach/Range Validation
  const distanceFeet = getFootprintDistanceFeet(
    attacker.position,
    attacker.size,
    target.position,
    target.size,
  );

  if (attack.attackType === 'melee_weapon') {
    const reach = attack.reachFeet || 5;
    if (distanceFeet > reach) {
      throw new Error(
        `Target "${target.name}" is out of melee reach (${distanceFeet} ft > ${reach} ft)`,
      );
    }
  } else if (attack.attackType === 'ranged_weapon') {
    if (attack.rangeFeet && distanceFeet > attack.rangeFeet.long) {
      throw new Error(
        `Target "${target.name}" is beyond maximum range (${distanceFeet} ft > ${attack.rangeFeet.long} ft)`,
      );
    }
  }

  // 4. Line of Sight & Cover
  let cover: CoverLevel = 'none';
  if (grid) {
    const obstacles = Object.values(state.combatants)
      .filter((c) => c.id !== attacker.id && c.id !== target.id && !c.isDead && c.currentHp > 0)
      .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y, size: c.size }));

    const coverRes = computeCover(
      grid,
      { id: attacker.id, x: attacker.position.x, y: attacker.position.y, size: attacker.size },
      { id: target.id, x: target.position.x, y: target.position.y, size: target.size },
      obstacles,
    );
    cover = coverRes.cover;
    if (cover === 'total') {
      throw new Error(`Cannot target "${target.name}": target has total cover`);
    }
  }

  const coverAcBonus = COVER_AC_BONUS[cover];
  const targetEffectiveAc = target.armorClass + coverAcBonus;

  // 5. Advantage / Disadvantage Mode
  const { mode, advantageSources, disadvantageSources } = determineAttackRollMode(
    attacker,
    target,
    attack,
    distanceFeet,
    state.combatants,
  );

  // 6. Roll Attack d20
  const isHalfling = attacker.characterSheet?.raceId === 'halfling';
  const attackRollRes = rollD20(currentState, {
    mode,
    modifier: attack.toHitBonus,
    halflingLucky: isHalfling,
    critRange: attack.critRange,
  });
  currentState = attackRollRes.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: attacker.id,
    rollPurpose: 'attack_roll',
    notation: attackRollRes.record.formula,
    rolls: attackRollRes.record.rolls,
    kept: attackRollRes.record.kept,
    modifier: attackRollRes.record.modifier,
    total: attackRollRes.total,
    mode,
    naturalCrit: attackRollRes.isCrit,
    naturalFumble: attackRollRes.isFumble,
  });

  // 7. Hit / Miss / Crit Determination
  // Paralyzed/unconscious auto-crit within 5 ft rule (Spec 03 Section 2.2 and Section 7)
  const isMeleeIncapAutoCrit =
    (target.conditions.includes('paralyzed') || target.conditions.includes('unconscious')) &&
    distanceFeet <= 5;

  let outcome: 'miss' | 'hit' | 'critical_hit' = 'miss';
  if (attackRollRes.isFumble) {
    outcome = 'miss';
  } else if (attackRollRes.isCrit) {
    outcome = 'critical_hit';
  } else if (attackRollRes.total >= targetEffectiveAc) {
    outcome = isMeleeIncapAutoCrit ? 'critical_hit' : 'hit';
  } else {
    outcome = 'miss';
  }

  // 8. Damage Calculation on Hit
  let damageRollRecord: DiceRollRecord | undefined;
  let damageDealt = 0;
  let nextTarget: Combatant = { ...target };

  if (outcome === 'hit' || outcome === 'critical_hit') {
    const isCritical = outcome === 'critical_hit';
    const gwf = hasGreatWeaponFighting(attacker, attack, options.greatWeaponFighting);
    const extraCritDice = getExtraCritDice(attacker, attack, options.extraCritDice);

    const dmgRes = rollDamage(currentState, attack.damageFormula, {
      critical: isCritical,
      greatWeaponFighting: gwf,
      extraCritDice,
    });
    currentState = dmgRes.nextState;
    damageRollRecord = dmgRes.record;
    damageDealt = Math.max(0, dmgRes.total);

    events.push({
      type: 'DICE_ROLLED',
      actorId: attacker.id,
      rollPurpose: 'damage_roll',
      notation: dmgRes.record.formula,
      rolls: dmgRes.record.rolls,
      kept: dmgRes.record.kept,
      modifier: dmgRes.record.modifier,
      total: dmgRes.total,
      mode: 'normal',
    });

    // Apply Damage via Authoritative Damage Pipeline (SRD-307)
    const dmgAppliedRes = applyDamage({
      state: {
        ...state,
        rngState: currentState,
        combatants: {
          ...state.combatants,
          [target.id]: nextTarget,
        },
      },
      targetId: nextTarget.id,
      rawAmount: damageDealt,
      damageType: attack.damageType,
      isCritical,
      attackerId: attacker.id,
      sourceName: attack.name,
      isSilvered: (attack.properties as readonly string[] | undefined)?.includes('silvered'),
    });
    currentState = dmgAppliedRes.state.rngState;
    nextTarget = dmgAppliedRes.state.combatants[target.id]!;
    events.push(...dmgAppliedRes.events);
  }

  events.push({
    type: 'ATTACK_RESOLVED',
    attackerId: attacker.id,
    targetId: target.id,
    weaponOrSpellName: attack.name,
    attackType: attack.attackType,
    roll: attackRollRes.naturalRoll,
    totalToHit: attackRollRes.total,
    targetAc: targetEffectiveAc,
    outcome,
    damage: damageDealt > 0 ? {
      total: damageDealt,
      damageType: attack.damageType,
      diceFormula: attack.damageFormula,
    } : undefined,
    cover: cover !== 'none' ? cover : undefined,
  });

  const nextCombatants = {
    ...state.combatants,
    [targetId]: nextTarget,
  };

  // Evaluate victory outcome
  const victoryOutcome = evaluateCombatVictory(nextCombatants);
  let nextPhase = state.phase;
  if (victoryOutcome !== 'in_progress') {
    nextPhase = 'combat_ended';
    events.push({
      type: 'ENCOUNTER_VICTORY',
      outcome: victoryOutcome,
      round: state.round,
    });
  }

  const nextState: CombatState = {
    ...state,
    phase: nextPhase,
    outcome: victoryOutcome,
    turnBudget: nextTurnBudget,
    combatants: nextCombatants,
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    outcome,
    rollMode: mode,
    advantageSources,
    disadvantageSources,
    attackRollRecord: attackRollRes.record,
    targetEffectiveAc,
    cover,
    damageRollRecord,
    damageDealt: damageDealt > 0 ? damageDealt : undefined,
  };
}

/**
 * Executes an Unarmed Strike against a target within reach.
 */
export function executeUnarmedStrike(
  state: CombatState,
  attackerId: string,
  targetId: string,
  options?: Partial<ExecuteAttackOptions>,
): AttackResolutionResult {
  return executeWeaponAttack({
    ...options,
    state,
    attackerId,
    targetId,
    attackProfileId: 'unarmed_strike',
  });
}

/**
 * Executes a Two-Weapon Fighting off-hand bonus action attack.
 */
export function executeTwoWeaponFightingAttack(
  state: CombatState,
  attackerId: string,
  targetId: string,
  options?: Partial<ExecuteAttackOptions>,
): AttackResolutionResult {
  return executeWeaponAttack({
    ...options,
    state,
    attackerId,
    targetId,
    isOffHand: true,
  });
}

/**
 * Executes a Grapple attempt (Special Melee Attack).
 * Contest: Attacker STR (Athletics) vs Defender max(STR (Athletics), DEX (Acrobatics)).
 * Success: Target gains the 'grappled' condition.
 */
export function executeGrapple(options: ExecuteGrappleOptions): GrappleResolutionResult {
  const { state, attackerId, targetId } = options;

  const attacker = state.combatants[attackerId];
  if (!attacker) throw new Error(`Attacker "${attackerId}" not found`);
  const target = state.combatants[targetId];
  if (!target) throw new Error(`Target "${targetId}" not found`);
  if (target.isDead) throw new Error(`Target "${target.name}" is already dead`);

  // Target size check: at most one size larger
  const attackerRank = CREATURE_SIZE_RANK[attacker.size];
  const targetRank = CREATURE_SIZE_RANK[target.size];
  if (targetRank > attackerRank + 1) {
    throw new Error(
      `Target "${target.name}" is too large to grapple (${target.size} vs attacker ${attacker.size})`,
    );
  }

  // Reach check
  const distanceFeet = getFootprintDistanceFeet(
    attacker.position,
    attacker.size,
    target.position,
    target.size,
  );
  if (distanceFeet > 5) {
    throw new Error(
      `Target "${target.name}" is out of melee reach for grapple (${distanceFeet} ft > 5 ft)`,
    );
  }

  let currentState = state.rngState;
  const events: CombatEvent[] = [];

  // Action economy: spends 1 attack from budget if during active turn
  let nextTurnBudget = state.turnBudget ? { ...state.turnBudget } : null;
  if (nextTurnBudget && state.activeCombatantId === attackerId) {
    nextTurnBudget = spendAttack(nextTurnBudget, attacker.attacksPerAction);
  }

  // Attacker STR (Athletics) roll
  const attackerAthleticsBonus = getCombatantAthleticsBonus(attacker);
  const attackerMode: RollMode =
    attacker.conditions.includes('poisoned') ||
    attacker.conditions.includes('frightened') ||
    attacker.conditions.includes('exhaustion')
      ? 'disadvantage'
      : 'normal';

  const attackerRoll = rollD20(currentState, {
    modifier: attackerAthleticsBonus,
    mode: attackerMode,
  });
  currentState = attackerRoll.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: attacker.id,
    rollPurpose: 'grapple_contest_athletics',
    notation: attackerRoll.record.formula,
    rolls: attackerRoll.record.rolls,
    kept: attackerRoll.record.kept,
    modifier: attackerRoll.record.modifier,
    total: attackerRoll.total,
    mode: attackerMode,
  });

  // Defender contest roll: max(Athletics, Acrobatics)
  const targetAthleticsBonus = getCombatantAthleticsBonus(target);
  const targetAcrobaticsBonus = getCombatantAcrobaticsBonus(target);
  const useAthletics = targetAthleticsBonus >= targetAcrobaticsBonus;
  const targetSkillUsed: 'athletics' | 'acrobatics' = useAthletics ? 'athletics' : 'acrobatics';
  const targetBonus = useAthletics ? targetAthleticsBonus : targetAcrobaticsBonus;

  const targetMode: RollMode =
    target.conditions.includes('poisoned') ||
    target.conditions.includes('frightened') ||
    target.conditions.includes('exhaustion')
      ? 'disadvantage'
      : 'normal';

  const targetRoll = rollD20(currentState, {
    modifier: targetBonus,
    mode: targetMode,
  });
  currentState = targetRoll.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: target.id,
    rollPurpose: `grapple_contest_${targetSkillUsed}`,
    notation: targetRoll.record.formula,
    rolls: targetRoll.record.rolls,
    kept: targetRoll.record.kept,
    modifier: targetRoll.record.modifier,
    total: targetRoll.total,
    mode: targetMode,
  });

  // Contest evaluation: Attacker wins on strictly greater roll; tie maintains status quo
  const success = attackerRoll.total > targetRoll.total;
  let nextTarget: Combatant = { ...target };

  if (success) {
    const nextConditions = new Set(nextTarget.conditions);
    if (!nextConditions.has('grappled')) {
      nextConditions.add('grappled');
      events.push({
        type: 'CONDITION_ADDED',
        targetId: nextTarget.id,
        conditionId: 'grappled',
        sourceName: attacker.name,
      });
    }
    nextTarget = {
      ...nextTarget,
      conditions: Array.from(nextConditions),
    };
  }

  events.push({
    type: 'GRAPPLE_RESOLVED',
    attackerId: attacker.id,
    targetId: target.id,
    success,
    attackerAthleticsTotal: attackerRoll.total,
    targetContestTotal: targetRoll.total,
    targetSkillUsed,
  });

  const nextState: CombatState = {
    ...state,
    turnBudget: nextTurnBudget,
    combatants: {
      ...state.combatants,
      [targetId]: nextTarget,
    },
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    success,
    attackerAthleticsTotal: attackerRoll.total,
    targetContestTotal: targetRoll.total,
    targetSkillUsed,
    attackerRollRecord: attackerRoll.record,
    targetRollRecord: targetRoll.record,
  };
}

/**
 * Executes a Shove attempt (Special Melee Attack).
 * Contest: Attacker STR (Athletics) vs Defender max(STR (Athletics), DEX (Acrobatics)).
 * Success: Attacker knocks target prone OR pushes target 5 feet away.
 */
export function executeShove(options: ExecuteShoveOptions): ShoveResolutionResult {
  const { state, attackerId, targetId, shoveType, grid } = options;

  const attacker = state.combatants[attackerId];
  if (!attacker) throw new Error(`Attacker "${attackerId}" not found`);
  const target = state.combatants[targetId];
  if (!target) throw new Error(`Target "${targetId}" not found`);
  if (target.isDead) throw new Error(`Target "${target.name}" is already dead`);

  // Target size check: at most one size larger
  const attackerRank = CREATURE_SIZE_RANK[attacker.size];
  const targetRank = CREATURE_SIZE_RANK[target.size];
  if (targetRank > attackerRank + 1) {
    throw new Error(
      `Target "${target.name}" is too large to shove (${target.size} vs attacker ${attacker.size})`,
    );
  }

  // Reach check
  const distanceFeet = getFootprintDistanceFeet(
    attacker.position,
    attacker.size,
    target.position,
    target.size,
  );
  if (distanceFeet > 5) {
    throw new Error(
      `Target "${target.name}" is out of melee reach for shove (${distanceFeet} ft > 5 ft)`,
    );
  }

  let currentState = state.rngState;
  const events: CombatEvent[] = [];

  // Action economy: spends 1 attack from budget if during active turn
  let nextTurnBudget = state.turnBudget ? { ...state.turnBudget } : null;
  if (nextTurnBudget && state.activeCombatantId === attackerId) {
    nextTurnBudget = spendAttack(nextTurnBudget, attacker.attacksPerAction);
  }

  // Attacker STR (Athletics) roll
  const attackerAthleticsBonus = getCombatantAthleticsBonus(attacker);
  const attackerMode: RollMode =
    attacker.conditions.includes('poisoned') ||
    attacker.conditions.includes('frightened') ||
    attacker.conditions.includes('exhaustion')
      ? 'disadvantage'
      : 'normal';

  const attackerRoll = rollD20(currentState, {
    modifier: attackerAthleticsBonus,
    mode: attackerMode,
  });
  currentState = attackerRoll.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: attacker.id,
    rollPurpose: 'shove_contest_athletics',
    notation: attackerRoll.record.formula,
    rolls: attackerRoll.record.rolls,
    kept: attackerRoll.record.kept,
    modifier: attackerRoll.record.modifier,
    total: attackerRoll.total,
    mode: attackerMode,
  });

  // Defender contest roll
  const targetAthleticsBonus = getCombatantAthleticsBonus(target);
  const targetAcrobaticsBonus = getCombatantAcrobaticsBonus(target);
  const useAthletics = targetAthleticsBonus >= targetAcrobaticsBonus;
  const targetSkillUsed: 'athletics' | 'acrobatics' = useAthletics ? 'athletics' : 'acrobatics';
  const targetBonus = useAthletics ? targetAthleticsBonus : targetAcrobaticsBonus;

  const targetMode: RollMode =
    target.conditions.includes('poisoned') ||
    target.conditions.includes('frightened') ||
    target.conditions.includes('exhaustion')
      ? 'disadvantage'
      : 'normal';

  const targetRoll = rollD20(currentState, {
    modifier: targetBonus,
    mode: targetMode,
  });
  currentState = targetRoll.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: target.id,
    rollPurpose: `shove_contest_${targetSkillUsed}`,
    notation: targetRoll.record.formula,
    rolls: targetRoll.record.rolls,
    kept: targetRoll.record.kept,
    modifier: targetRoll.record.modifier,
    total: targetRoll.total,
    mode: targetMode,
  });

  const success = attackerRoll.total > targetRoll.total;
  let nextTarget: Combatant = { ...target };
  let destination: GridPoint | undefined;

  if (success) {
    if (shoveType === 'knock_prone') {
      const nextConditions = new Set(nextTarget.conditions);
      if (!nextConditions.has('prone')) {
        nextConditions.add('prone');
        events.push({
          type: 'CONDITION_ADDED',
          targetId: nextTarget.id,
          conditionId: 'prone',
          sourceName: attacker.name,
        });
      }
      nextTarget = {
        ...nextTarget,
        conditions: Array.from(nextConditions),
      };
    } else if (shoveType === 'push_away') {
      const dx = target.position.x - attacker.position.x;
      const dy = target.position.y - attacker.position.y;
      const stepX = Math.sign(dx);
      const stepY = Math.sign(dy);

      const candidateDest: GridPoint = {
        x: target.position.x + stepX,
        y: target.position.y + stepY,
      };

      let destValid = true;
      if (grid) {
        if (!isWithinGridBounds(grid, candidateDest.x, candidateDest.y)) {
          destValid = false;
        } else {
          const cell = getGridCell(grid, candidateDest.x, candidateDest.y);
          if (!cell || !isCellPassable(cell)) {
            destValid = false;
          }
        }
      }

      // Check if candidate cell is blocked by another creature
      if (destValid) {
        const isOccupied = Object.values(state.combatants).some((c) => {
          if (c.id === target.id || c.isDead || c.currentHp <= 0) return false;
          return doesFootprintContainCell(c.position, c.size, candidateDest);
        });
        if (isOccupied) {
          destValid = false;
        }
      }

      if (destValid) {
        destination = candidateDest;
        nextTarget = {
          ...nextTarget,
          position: destination,
        };
        events.push({
          type: 'ENTITY_MOVED',
          entityId: target.id,
          path: [candidateDest],
          mode: 'forced',
        });
      }
    }
  }

  events.push({
    type: 'SHOVE_RESOLVED',
    attackerId: attacker.id,
    targetId: target.id,
    success,
    shoveType,
    attackerAthleticsTotal: attackerRoll.total,
    targetContestTotal: targetRoll.total,
    targetSkillUsed,
    destination,
  });

  const nextState: CombatState = {
    ...state,
    turnBudget: nextTurnBudget,
    combatants: {
      ...state.combatants,
      [targetId]: nextTarget,
    },
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    success,
    shoveType,
    attackerAthleticsTotal: attackerRoll.total,
    targetContestTotal: targetRoll.total,
    targetSkillUsed,
    destination,
    attackerRollRecord: attackerRoll.record,
    targetRollRecord: targetRoll.record,
  };
}
