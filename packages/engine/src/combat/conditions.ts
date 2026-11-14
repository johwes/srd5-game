import {
  type AbilityId,
  type ConditionId,
  type SkillId,
  CONDITION_IDS,
} from '@srd5/data';
import {
  type DiceRollRecord,
  type RollMode,
  resolveRollMode,
  rollD20,
} from '../dice/evaluator.js';
import type {
  CombatEvent,
  CombatState,
  Combatant,
} from './types.js';

/**
 * The 5 incapacitating conditions defined in SRD 5.1.
 */
export const INCAPACITATING_CONDITIONS: ReadonlySet<ConditionId> = new Set<ConditionId>([
  'incapacitated',
  'paralyzed',
  'petrified',
  'stunned',
  'unconscious',
]);

/**
 * Conditions that reduce speed to 0.
 */
export const IMMOBILIZING_CONDITIONS: ReadonlySet<ConditionId> = new Set<ConditionId>([
  'grappled',
  'restrained',
  'paralyzed',
  'petrified',
  'stunned',
  'unconscious',
]);

/**
 * Complete metadata and rules for each of the 15 SRD 5.1 conditions (Spec 03 Section 7).
 */
export interface ConditionRuleMetadata {
  id: ConditionId;
  name: string;
  description: string;
  isIncapacitating: boolean;
  isImmobilizing: boolean;
  autoFailsStrDexSaves: boolean;
  grantsAdvantageToAttacksAgainst: boolean;
  imposesDisadvantageOnAttacksMade: boolean;
  imposesDisadvantageOnAbilityChecks: boolean;
}

export const CONDITION_METADATA: Record<ConditionId, ConditionRuleMetadata> = {
  blinded: {
    id: 'blinded',
    name: 'Blinded',
    description: 'Auto-fails sight checks; disadvantage on attack rolls; attacks against have advantage.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: true,
    imposesDisadvantageOnAbilityChecks: false, // specifically sight checks
  },
  charmed: {
    id: 'charmed',
    name: 'Charmed',
    description: "Cannot attack or harm charmer; charmer has advantage on social ability checks.",
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  deafened: {
    id: 'deafened',
    name: 'Deafened',
    description: 'Auto-fails hearing checks.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false, // specifically hearing checks
  },
  exhaustion: {
    id: 'exhaustion',
    name: 'Exhaustion',
    description: 'Cumulative 6 levels: L1 checks, L2 half speed, L3 attacks & saves, L4 half HP, L5 speed 0, L6 death.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: true,
  },
  frightened: {
    id: 'frightened',
    name: 'Frightened',
    description: 'Disadvantage on ability checks and attacks while source of fear is visible; cannot willingly move closer.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: true,
    imposesDisadvantageOnAbilityChecks: true,
  },
  grappled: {
    id: 'grappled',
    name: 'Grappled',
    description: 'Speed is 0; ends if grappler is incapacitated or moved out of reach.',
    isIncapacitating: false,
    isImmobilizing: true,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  incapacitated: {
    id: 'incapacitated',
    name: 'Incapacitated',
    description: 'Cannot take actions, bonus actions, or reactions; loses concentration.',
    isIncapacitating: true,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  invisible: {
    id: 'invisible',
    name: 'Invisible',
    description: 'Heavily obscured; advantage on attacks made; attacks against have disadvantage.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  paralyzed: {
    id: 'paralyzed',
    name: 'Paralyzed',
    description: 'Incapacitated, speed 0; auto-fails STR/DEX saves; attacks against have advantage; hits within 5 ft are crits.',
    isIncapacitating: true,
    isImmobilizing: true,
    autoFailsStrDexSaves: true,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  petrified: {
    id: 'petrified',
    name: 'Petrified',
    description: 'Incapacitated, speed 0; attacks have advantage; auto-fails STR/DEX saves; resistance to all damage; poison immune.',
    isIncapacitating: true,
    isImmobilizing: true,
    autoFailsStrDexSaves: true,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  poisoned: {
    id: 'poisoned',
    name: 'Poisoned',
    description: 'Disadvantage on attack rolls and ability checks.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false,
    imposesDisadvantageOnAttacksMade: true,
    imposesDisadvantageOnAbilityChecks: true,
  },
  prone: {
    id: 'prone',
    name: 'Prone',
    description: 'Can only crawl (2x cost); disadvantage on attacks; melee within 5 ft has advantage, ranged > 5 ft has disadvantage.',
    isIncapacitating: false,
    isImmobilizing: false,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: false, // depends on distance
    imposesDisadvantageOnAttacksMade: true,
    imposesDisadvantageOnAbilityChecks: false,
  },
  restrained: {
    id: 'restrained',
    name: 'Restrained',
    description: 'Speed 0; disadvantage on attacks made; attacks against have advantage; disadvantage on DEX saves.',
    isIncapacitating: false,
    isImmobilizing: true,
    autoFailsStrDexSaves: false,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: true,
    imposesDisadvantageOnAbilityChecks: false,
  },
  stunned: {
    id: 'stunned',
    name: 'Stunned',
    description: 'Incapacitated, speed 0; speaks falteringly; auto-fails STR/DEX saves; attacks against have advantage.',
    isIncapacitating: true,
    isImmobilizing: true,
    autoFailsStrDexSaves: true,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
  unconscious: {
    id: 'unconscious',
    name: 'Unconscious',
    description: 'Incapacitated, speed 0, prone, unaware; auto-fails STR/DEX saves; attacks against have advantage; hits within 5 ft are crits.',
    isIncapacitating: true,
    isImmobilizing: true,
    autoFailsStrDexSaves: true,
    grantsAdvantageToAttacksAgainst: true,
    imposesDisadvantageOnAttacksMade: false,
    imposesDisadvantageOnAbilityChecks: false,
  },
};

/**
 * Checks whether a combatant has any condition preventing actions/bonus actions/reactions.
 */
export function isIncapacitated(combatant: Combatant): boolean {
  return combatant.conditions.some((c) => INCAPACITATING_CONDITIONS.has(c));
}

/**
 * Checks whether a combatant has any condition reducing speed to 0.
 */
export function isImmobilized(combatant: Combatant): boolean {
  if ((combatant.exhaustionLevel ?? 0) >= 5) return true;
  return combatant.conditions.some((c) => IMMOBILIZING_CONDITIONS.has(c));
}

/**
 * Computes speed in feet taking into account conditions (exhaustion, immobilized).
 */
export function getConditionSpeed(combatant: Combatant): number {
  if (isImmobilized(combatant) || combatant.isDead) {
    return 0;
  }
  const exhaustion = combatant.exhaustionLevel ?? 0;
  if (exhaustion >= 5) {
    return 0;
  }
  if (exhaustion >= 2) {
    return Math.floor(combatant.speedFeet / 2);
  }
  return combatant.speedFeet;
}

export interface ApplyConditionOptions {
  sourceId?: string | undefined;
  sourceName?: string | undefined;
  sourceEntityId?: string | undefined;
  durationRounds?: number | undefined;
  requiresConcentration?: boolean | undefined;
  repeatSaveAtTurnEnd?: {
    ability: AbilityId;
    dc: number;
  } | undefined;
  exhaustionLevelChange?: number | undefined;
}

export interface ConditionApplicationResult {
  combatant: Combatant;
  events: CombatEvent[];
  applied: boolean;
  concentrationBroken: boolean;
}

/**
 * Applies a condition to a combatant following all SRD 5.1 rules:
 * - Checks condition immunities.
 * - Handles Petrified poison immunity.
 * - Handles Exhaustion levels 1..6 (L4 halving max HP, L6 death).
 * - Handles Incapacitation dropping Concentration immediately.
 */
export function applyConditionToCombatant(
  combatant: Combatant,
  conditionId: ConditionId,
  options?: ApplyConditionOptions,
): ConditionApplicationResult {
  const events: CombatEvent[] = [];

  // 1. Condition Immunities Check
  const immunities = [
    ...(combatant.conditionImmunities ?? []),
    ...(combatant.characterSheet?.conditionImmunities ?? []),
    ...(combatant.monsterData?.conditionImmunities ?? []),
  ];
  if (immunities.includes(conditionId)) {
    return { combatant, events, applied: false, concentrationBroken: false };
  }

  // Petrified gives immunity to poison damage and poisoned condition
  if (conditionId === 'poisoned' && combatant.conditions.includes('petrified')) {
    return { combatant, events, applied: false, concentrationBroken: false };
  }

  let nextConditions = [...combatant.conditions];
  let nextActiveConditions = combatant.activeConditions ? [...combatant.activeConditions] : [];
  let nextMaxHp = combatant.maxHp;
  let nextCurrentHp = combatant.currentHp;
  let isDead = combatant.isDead;
  let concentrationBroken = false;
  let nextExhaustion = combatant.exhaustionLevel ?? 0;

  if (conditionId === 'exhaustion') {
    const delta = options?.exhaustionLevelChange ?? 1;
    const oldLevel = nextExhaustion;
    nextExhaustion = Math.min(6, Math.max(0, nextExhaustion + delta));

    if (nextExhaustion > 0 && !nextConditions.includes('exhaustion')) {
      nextConditions.push('exhaustion');
      events.push({
        type: 'CONDITION_ADDED',
        targetId: combatant.id,
        conditionId: 'exhaustion',
        sourceName: options?.sourceName,
      });
    }

    events.push({
      type: 'EXHAUSTION_CHANGED',
      entityId: combatant.id,
      oldLevel,
      newLevel: nextExhaustion,
    });

    // Level 4: Max HP halved
    if (nextExhaustion >= 4 && oldLevel < 4) {
      nextMaxHp = Math.floor(combatant.maxHp / 2);
      nextCurrentHp = Math.min(nextCurrentHp, nextMaxHp);
    }

    // Level 6: Death
    if (nextExhaustion >= 6) {
      isDead = true;
      events.push({
        type: 'CREATURE_DIED',
        entityId: combatant.id,
        reason: 'zero_hp',
      });
    }
  } else {
    if (!nextConditions.includes(conditionId)) {
      nextConditions.push(conditionId);
      events.push({
        type: 'CONDITION_ADDED',
        targetId: combatant.id,
        conditionId,
        sourceName: options?.sourceName,
      });
    }
  }

  // Track structured active condition
  nextActiveConditions.push({
    conditionId,
    sourceId: options?.sourceId,
    sourceName: options?.sourceName,
    sourceEntityId: options?.sourceEntityId,
    durationRounds: options?.durationRounds,
    requiresConcentration: options?.requiresConcentration,
    repeatSaveAtTurnEnd: options?.repeatSaveAtTurnEnd,
  });

  // If newly applied condition is incapacitating, drop concentration immediately
  let nextConcentratingOn = combatant.concentratingOn;
  if (INCAPACITATING_CONDITIONS.has(conditionId) && combatant.concentratingOn) {
    concentrationBroken = true;
    nextConcentratingOn = undefined;
    events.push({
      type: 'CONCENTRATION_ENDED',
      entityId: combatant.id,
      spellId: combatant.concentratingOn.sourceId,
      reason: 'incapacitated',
    });
  }

  // Special condition state links
  let charmedBy = combatant.charmedByEntityId;
  let frightenedBy = combatant.frightenedByEntityId;
  let grappledBy = combatant.grappledByEntityId;

  if (conditionId === 'charmed' && options?.sourceEntityId) {
    charmedBy = options.sourceEntityId;
  }
  if (conditionId === 'frightened' && options?.sourceEntityId) {
    frightenedBy = options.sourceEntityId;
  }
  if (conditionId === 'grappled' && options?.sourceEntityId) {
    grappledBy = options.sourceEntityId;
  }

  const updatedCombatant: Combatant = {
    ...combatant,
    conditions: nextConditions,
    activeConditions: nextActiveConditions,
    exhaustionLevel: nextExhaustion,
    maxHp: nextMaxHp,
    currentHp: nextCurrentHp,
    isDead,
    concentratingOn: nextConcentratingOn,
    charmedByEntityId: charmedBy,
    frightenedByEntityId: frightenedBy,
    grappledByEntityId: grappledBy,
  };

  return {
    combatant: updatedCombatant,
    events,
    applied: true,
    concentrationBroken,
  };
}

export interface RemoveConditionOptions {
  clearAllExhaustion?: boolean | undefined;
  exhaustionLevelReduction?: number | undefined;
  sourceName?: string | undefined;
}

/**
 * Removes a condition from a combatant:
 * - Decrements exhaustion level (or clears if requested).
 * - Restores max HP if exhaustion level drops below 4.
 * - Emits CONDITION_REMOVED.
 */
export function removeConditionFromCombatant(
  combatant: Combatant,
  conditionId: ConditionId,
  options?: RemoveConditionOptions,
): { combatant: Combatant; events: CombatEvent[] } {
  const events: CombatEvent[] = [];

  let nextConditions = [...combatant.conditions];
  let nextActiveConditions = combatant.activeConditions ? [...combatant.activeConditions] : [];
  let nextExhaustion = combatant.exhaustionLevel ?? 0;
  let nextMaxHp = combatant.maxHp;

  if (conditionId === 'exhaustion') {
    const oldLevel = nextExhaustion;
    if (options?.clearAllExhaustion) {
      nextExhaustion = 0;
    } else {
      const delta = options?.exhaustionLevelReduction ?? 1;
      nextExhaustion = Math.max(0, nextExhaustion - delta);
    }

    events.push({
      type: 'EXHAUSTION_CHANGED',
      entityId: combatant.id,
      oldLevel,
      newLevel: nextExhaustion,
    });

    if (nextExhaustion === 0) {
      nextConditions = nextConditions.filter((c) => c !== 'exhaustion');
      events.push({
        type: 'CONDITION_REMOVED',
        targetId: combatant.id,
        conditionId: 'exhaustion',
        sourceName: options?.sourceName,
      });
    }

    // Restore max HP if restored below exhaustion level 4
    if (oldLevel >= 4 && nextExhaustion < 4) {
      const baseMax = combatant.characterSheet?.maxHp ?? combatant.monsterData?.hitPoints.average ?? combatant.maxHp * 2;
      nextMaxHp = baseMax;
    }
  } else {
    if (nextConditions.includes(conditionId)) {
      nextConditions = nextConditions.filter((c) => c !== conditionId);
      events.push({
        type: 'CONDITION_REMOVED',
        targetId: combatant.id,
        conditionId,
        sourceName: options?.sourceName,
      });
    }
  }

  nextActiveConditions = nextActiveConditions.filter((c) => c.conditionId !== conditionId);

  let charmedBy = combatant.charmedByEntityId;
  let frightenedBy = combatant.frightenedByEntityId;
  let grappledBy = combatant.grappledByEntityId;

  if (conditionId === 'charmed') charmedBy = undefined;
  if (conditionId === 'frightened') frightenedBy = undefined;
  if (conditionId === 'grappled') grappledBy = undefined;

  const updatedCombatant: Combatant = {
    ...combatant,
    conditions: nextConditions,
    activeConditions: nextActiveConditions,
    exhaustionLevel: nextExhaustion,
    maxHp: nextMaxHp,
    charmedByEntityId: charmedBy,
    frightenedByEntityId: frightenedBy,
    grappledByEntityId: grappledBy,
  };

  return { combatant: updatedCombatant, events };
}

/**
 * Checks whether an attacker is prevented from targeting a target due to condition rules (e.g. Charmed).
 */
export function canAttackTarget(
  attacker: Combatant,
  target: Combatant,
): { allowed: boolean; reason?: string } {
  if (isIncapacitated(attacker)) {
    return { allowed: false, reason: 'Attacker is incapacitated' };
  }
  if (attacker.conditions.includes('charmed') && attacker.charmedByEntityId === target.id) {
    return { allowed: false, reason: 'A charmed creature cannot attack the charmer' };
  }
  return { allowed: true };
}

/**
 * Evaluates RollMode (Advantage, Disadvantage, Normal) and auto-crit eligibility for an attack
 * under all 15 conditions.
 */
export function getConditionAttackRollMode(
  attacker: Combatant,
  target: Combatant,
  attackType: 'melee_weapon' | 'ranged_weapon' | 'melee_spell' | 'ranged_spell',
  distanceFeet: number,
  options?: { hasLineOfSightToFrightenedSource?: boolean },
): {
  mode: RollMode;
  isAutoCrit: boolean;
  advantageSources: string[];
  disadvantageSources: string[];
} {
  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];

  // Attacker condition effects
  if (attacker.conditions.includes('invisible')) {
    advantageSources.push('attacker_invisible');
  }
  if (attacker.conditions.includes('blinded')) {
    disadvantageSources.push('attacker_blinded');
  }
  if (attacker.conditions.includes('poisoned')) {
    disadvantageSources.push('attacker_poisoned');
  }
  if (attacker.conditions.includes('restrained')) {
    disadvantageSources.push('attacker_restrained');
  }
  if (attacker.conditions.includes('prone')) {
    disadvantageSources.push('attacker_prone');
  }
  if (
    attacker.conditions.includes('frightened') &&
    (options?.hasLineOfSightToFrightenedSource ?? true)
  ) {
    disadvantageSources.push('attacker_frightened');
  }
  if ((attacker.exhaustionLevel ?? 0) >= 3 || attacker.conditions.includes('exhaustion')) {
    disadvantageSources.push('attacker_exhaustion');
  }

  // Target condition effects
  if (target.conditions.includes('paralyzed')) {
    advantageSources.push('target_paralyzed');
  }
  if (target.conditions.includes('stunned')) {
    advantageSources.push('target_stunned');
  }
  if (target.conditions.includes('unconscious')) {
    advantageSources.push('target_unconscious');
  }
  if (target.conditions.includes('restrained')) {
    advantageSources.push('target_restrained');
  }
  if (target.conditions.includes('petrified')) {
    advantageSources.push('target_petrified');
  }
  if (target.conditions.includes('blinded')) {
    advantageSources.push('target_blinded');
  }
  if (target.conditions.includes('invisible')) {
    disadvantageSources.push('target_invisible');
  }
  if (target.isDodging && !isIncapacitated(target) && target.speedFeet > 0) {
    disadvantageSources.push('target_dodge');
  }

  // Prone target: Advantage if within 5 ft; Disadvantage if > 5 ft
  if (target.conditions.includes('prone')) {
    if (distanceFeet <= 5) {
      advantageSources.push('target_prone_within_5ft');
    } else {
      disadvantageSources.push('target_prone_beyond_5ft');
    }
  }

  // Automatic Critical Hits: Melee hits or any attack within 5 ft against Paralyzed or Unconscious
  const isAutoCrit =
    (target.conditions.includes('paralyzed') || target.conditions.includes('unconscious')) &&
    distanceFeet <= 5;

  const mode = resolveRollMode({ advantageSources, disadvantageSources });
  return { mode, isAutoCrit, advantageSources, disadvantageSources };
}

/**
 * Computes saving throw roll mode and auto-fail rules according to conditions:
 * - Paralyzed, Petrified, Stunned, Unconscious auto-fail STR and DEX saves.
 * - Restrained imposes Disadvantage on DEX saves.
 * - Exhaustion level 3+ imposes Disadvantage on all saves.
 * - Dodge gives Advantage on DEX saves.
 */
export function getConditionSavingThrowRollMode(
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

  // Auto-fail STR and DEX saves
  if (ability === 'str' || ability === 'dex') {
    const autoFails = target.conditions.some((c) =>
      ['paralyzed', 'petrified', 'stunned', 'unconscious'].includes(c),
    );
    if (autoFails) {
      autoFail = true;
    }
  }

  // DEX save modifiers
  if (ability === 'dex') {
    if (target.isDodging && !isIncapacitated(target) && target.speedFeet > 0) {
      advantageSources.push('dodge');
    }
    if (target.conditions.includes('restrained')) {
      disadvantageSources.push('restrained');
    }
  }

  // Exhaustion level 3+
  if ((target.exhaustionLevel ?? 0) >= 3) {
    disadvantageSources.push('exhaustion');
  }

  // Magic Resistance
  if (target.monsterData?.traits?.some((t) => t.name.toLowerCase().includes('magic resistance'))) {
    advantageSources.push('magic_resistance');
  }

  const mode = resolveRollMode({ advantageSources, disadvantageSources });
  return { mode, autoFail, advantageSources, disadvantageSources };
}

/**
 * Checks whether an ability check should suffer disadvantage or auto-fail due to conditions.
 */
export function getConditionAbilityCheckRollMode(
  target: Combatant,
  ability: AbilityId,
  skill?: SkillId,
  context?: {
    isSightBased?: boolean;
    isHearingBased?: boolean;
    sourceOfFearInLoS?: boolean;
    isSocialWithCharmer?: boolean;
  },
): {
  mode: RollMode;
  autoFail: boolean;
  advantageSources: string[];
  disadvantageSources: string[];
} {
  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];
  let autoFail = false;

  // Sight checks auto-fail if blinded
  if (target.conditions.includes('blinded') && (context?.isSightBased || skill === 'perception')) {
    autoFail = true;
  }

  // Hearing checks auto-fail if deafened
  if (target.conditions.includes('deafened') && context?.isHearingBased) {
    autoFail = true;
  }

  // Poisoned imposes disadvantage on all ability checks
  if (target.conditions.includes('poisoned')) {
    disadvantageSources.push('poisoned');
  }

  // Frightened imposes disadvantage while source of fear is in LoS
  if (target.conditions.includes('frightened') && (context?.sourceOfFearInLoS ?? true)) {
    disadvantageSources.push('frightened');
  }

  // Exhaustion Level 1+ imposes disadvantage on all ability checks
  if ((target.exhaustionLevel ?? 0) >= 1 || target.conditions.includes('exhaustion')) {
    disadvantageSources.push('exhaustion');
  }

  // Charmer has advantage on social ability checks with charmed creature
  if (context?.isSocialWithCharmer) {
    advantageSources.push('charmed_social');
  }

  const mode = resolveRollMode({ advantageSources, disadvantageSources });
  return { mode, autoFail, advantageSources, disadvantageSources };
}

/**
 * Checks whether a frightened creature can move into a cell.
 * Under SRD 5.1: A frightened creature cannot willingly move closer to the source of its fear.
 */
export function canFrightenedCreatureMove(
  creature: Combatant,
  fearSourcePos: { x: number; y: number },
  fromPos: { x: number; y: number },
  toPos: { x: number; y: number },
): boolean {
  if (!creature.conditions.includes('frightened')) return true;
  const currentDist = Math.hypot(fromPos.x - fearSourcePos.x, fromPos.y - fearSourcePos.y);
  const nextDist = Math.hypot(toPos.x - fearSourcePos.x, toPos.y - fearSourcePos.y);
  return nextDist >= currentDist - 1e-6;
}

/**
 * Executes repeat saving throws at the end of turn for any active conditions with `repeatSaveAtTurnEnd`.
 */
export function resolveConditionTurnEndSaves(
  state: CombatState,
  combatantId: string,
): { state: CombatState; events: CombatEvent[] } {
  const events: CombatEvent[] = [];
  let currentRng = state.rngState;
  const combatant = state.combatants[combatantId];
  if (!combatant || !combatant.activeConditions) {
    return { state, events };
  }

  let nextCombatant = { ...combatant };

  for (const ac of combatant.activeConditions) {
    if (ac.repeatSaveAtTurnEnd) {
      const { ability, dc } = ac.repeatSaveAtTurnEnd;
      const { mode, autoFail } = getConditionSavingThrowRollMode(nextCombatant, ability);

      const bonus =
        nextCombatant.characterSheet?.savingThrows[ability]?.totalBonus ??
        nextCombatant.monsterData?.savingThrows?.[ability] ??
        0;

      let passed = false;
      let roll = 10;
      let total = bonus + 10;

      if (autoFail) {
        roll = 1;
        total = bonus + 1;
        passed = false;
      } else {
        const d20Res = rollD20(currentRng, { modifier: bonus, mode });
        currentRng = d20Res.nextState;
        roll = d20Res.naturalRoll;
        total = d20Res.total;
        passed = total >= dc;

        events.push({
          type: 'DICE_ROLLED',
          actorId: combatant.id,
          rollPurpose: `End-of-turn ${ability.toUpperCase()} save vs ${ac.conditionId} DC ${dc}`,
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
        entityId: combatant.id,
        ability,
        dc,
        roll,
        total,
        outcome: passed ? 'success' : 'failure',
        sourceSpellOrAbilityName: ac.sourceName ?? ac.conditionId,
      });

      if (passed) {
        const removeRes = removeConditionFromCombatant(nextCombatant, ac.conditionId, {
          sourceName: ac.sourceName,
        });
        nextCombatant = removeRes.combatant;
        events.push(...removeRes.events);
      }
    }
  }

  return {
    state: {
      ...state,
      rngState: currentRng,
      combatants: {
        ...state.combatants,
        [combatantId]: nextCombatant,
      },
    },
    events,
  };
}
