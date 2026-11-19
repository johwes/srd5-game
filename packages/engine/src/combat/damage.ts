import type { ConditionId, DamageType } from '@srd5/data';
import { rollD20, resolveRollMode, type RollMode } from '../dice/evaluator.js';
import type { DeathSavesState } from '../character/schemas.js';
import type { CombatEvent, CombatState, Combatant, HazardZone } from './types.js';
import { evaluateCombatVictory } from './state-machine.js';

export interface DamageMitigationOptions {
  isMagical?: boolean;
  isSilvered?: boolean;
  isAdamantine?: boolean;
  bypassResistances?: DamageType[];
  bypassImmunities?: DamageType[];
  ignoreResistances?: boolean;
  ignoreImmunities?: boolean;
  ignoreVulnerabilities?: boolean;
}

export interface MitigatedDamageCalculation {
  rawAmount: number;
  finalAmount: number;
  damageType: DamageType;
  immunityApplied: boolean;
  resistanceApplied: boolean;
  vulnerabilityApplied: boolean;
}

/**
 * Calculates mitigated damage for a target according to SRD 5.1 rules:
 * 1. Immunity -> damage = 0
 * 2. Resistance -> damage = floor(raw / 2)
 * 3. Vulnerability -> damage = damage * 2
 * Also accounts for the Petrified condition (Immune to Poison, Resistant to all damage).
 */
export function calculateMitigatedDamage(
  target: Combatant,
  rawAmount: number,
  damageType: DamageType,
  options?: DamageMitigationOptions,
): MitigatedDamageCalculation {
  if (rawAmount <= 0) {
    return {
      rawAmount: 0,
      finalAmount: 0,
      damageType,
      immunityApplied: false,
      resistanceApplied: false,
      vulnerabilityApplied: false,
    };
  }

  const immunities = target.damageImmunities ?? target.characterSheet?.damageImmunities ?? target.monsterData?.damageImmunities ?? [];
  const resistances = target.damageResistances ?? target.characterSheet?.damageResistances ?? target.monsterData?.damageResistances ?? [];
  const vulnerabilities = target.damageVulnerabilities ?? target.characterSheet?.damageVulnerabilities ?? target.monsterData?.damageVulnerabilities ?? [];

  const isPetrified = target.conditions.includes('petrified');

  // 1. Immunity
  let isImmune = false;
  if (!options?.ignoreImmunities && !options?.bypassImmunities?.includes(damageType)) {
    if (immunities.includes(damageType) || (isPetrified && damageType === 'poison')) {
      isImmune = true;
    }
  }

  if (isImmune) {
    return {
      rawAmount,
      finalAmount: 0,
      damageType,
      immunityApplied: true,
      resistanceApplied: false,
      vulnerabilityApplied: false,
    };
  }

  // 2. Resistance
  let isResistant = false;
  if (!options?.ignoreResistances && !options?.bypassResistances?.includes(damageType)) {
    if (resistances.includes(damageType) || isPetrified) {
      isResistant = true;
    }
  }

  // 3. Vulnerability
  let isVulnerable = false;
  if (!options?.ignoreVulnerabilities && vulnerabilities.includes(damageType)) {
    isVulnerable = true;
  }

  let finalAmount = rawAmount;
  if (isResistant) {
    finalAmount = Math.floor(finalAmount / 2);
  }
  if (isVulnerable) {
    finalAmount = finalAmount * 2;
  }

  return {
    rawAmount,
    finalAmount,
    damageType,
    immunityApplied: false,
    resistanceApplied: isResistant,
    vulnerabilityApplied: isVulnerable,
  };
}

export interface ApplyDamageOptions extends DamageMitigationOptions {
  state: CombatState;
  targetId: string;
  rawAmount: number;
  damageType: DamageType;
  isCritical?: boolean;
  attackerId?: string;
  sourceName?: string;
  autoResolveConcentrationCheck?: boolean;
}

export interface ApplyDamageResult {
  state: CombatState;
  events: CombatEvent[];
  rawAmount: number;
  finalAmount: number;
  damageType: DamageType;
  tempHpAbsorbed: number;
  hpLost: number;
  hpRemaining: number;
  targetId: string;
  isInstantDeath: boolean;
  deathSaveFailuresAdded: number;
  isDead: boolean;
  isUnconscious: boolean;
  droppedToZeroHp: boolean;
  concentrationBroken?: boolean;
  concentrationCheck?: {
    dc: number;
    passed: boolean;
    roll: number;
    total: number;
  };
}

/**
 * Executes authoritative SRD 5.1 damage resolution pipeline:
 * - Computes Immunity, Resistance, and Vulnerability.
 * - Absorbs damage via Temporary HP pool first.
 * - Handles Instant Death threshold (excess damage >= maxHp).
 * - Applies 0 HP drop (unconscious, prone, resets death saves, concentration drop).
 * - Applies damage while at 0 HP (1 death save failure, 2 on Critical Hit; or instant death if damage >= maxHp).
 * - Resolves Concentration saving throw for conscious casters (DC = max(10, floor(damage / 2))).
 * - Evaluates combat victory or defeat.
 */
export function applyDamage(options: ApplyDamageOptions): ApplyDamageResult {
  const {
    state,
    targetId,
    rawAmount,
    damageType,
    isCritical = false,
    autoResolveConcentrationCheck = true,
  } = options;

  const target = state.combatants[targetId];
  if (!target) {
    throw new Error(`Target combatant "${targetId}" not found`);
  }
  if (target.isDead) {
    throw new Error(`Cannot deal damage to dead combatant "${target.name}"`);
  }

  const events: CombatEvent[] = [];
  let currentState = state.rngState;

  // 1. Calculate Mitigations
  const mitigated = calculateMitigatedDamage(target, rawAmount, damageType, options);
  const damageToApply = mitigated.finalAmount;

  let tempHpAbsorbed = 0;
  let nextTempHp = target.tempHp;
  let nextCurrentHp = target.currentHp;
  let isInstantDeath = false;
  let deathSaveFailuresAdded = 0;
  let isDead: boolean = target.isDead;
  let isStable: boolean = target.isStable;
  let nextConditions = [...target.conditions];
  let deathSaves: DeathSavesState = { ...target.deathSaves };
  let droppedToZeroHp = false;
  let concentrationBroken = false;
  let concentrationCheck: ApplyDamageResult['concentrationCheck'] = undefined;

  if (damageToApply > 0) {
    // 2. Temp HP Absorption
    tempHpAbsorbed = Math.min(nextTempHp, damageToApply);
    nextTempHp -= tempHpAbsorbed;
    const remainingDmg = damageToApply - tempHpAbsorbed;

    // 3. Health & Zero HP Pipeline
    if (target.currentHp === 0) {
      // Taking damage while already at 0 HP
      if (target.side === 'monster') {
        isDead = true;
        events.push({
          type: 'CREATURE_DIED',
          entityId: target.id,
          reason: 'zero_hp',
        });
      } else {
        // Player character at 0 HP
        if (damageToApply >= target.maxHp) {
          // Instant Death at 0 HP
          isInstantDeath = true;
          isDead = true;
          isStable = false;
          events.push({
            type: 'CREATURE_DIED',
            entityId: target.id,
            reason: 'instant_death',
          });
        } else {
          // Normal or Critical damage at 0 HP
          isStable = false; // Taking damage at 0 HP breaks stability
          const failures = isCritical ? 2 : 1;
          deathSaveFailuresAdded = failures;
          deathSaves.failures += failures;

          if (deathSaves.failures >= 3) {
            isDead = true;
            events.push({
              type: 'CREATURE_DIED',
              entityId: target.id,
              reason: 'death_save_failures',
            });
          }
        }
      }
    } else {
      // Target currently has HP > 0
      if (remainingDmg < target.currentHp) {
        nextCurrentHp -= remainingDmg;
      } else {
        // Reduced to 0 HP
        droppedToZeroHp = true;
        const excessDmg = remainingDmg - target.currentHp;
        nextCurrentHp = 0;

        if (target.side === 'monster') {
          isDead = true;
          events.push({
            type: 'CREATURE_DIED',
            entityId: target.id,
            reason: 'zero_hp',
          });
        } else {
          // Player character instant death check: excess damage >= maxHp
          if (excessDmg >= target.maxHp) {
            isInstantDeath = true;
            isDead = true;
            isStable = false;
            events.push({
              type: 'CREATURE_DIED',
              entityId: target.id,
              reason: 'instant_death',
            });
          } else {
            // Falls unconscious and prone
            isStable = false;
            deathSaves = { successes: 0, failures: 0 };

            if (!nextConditions.includes('unconscious')) {
              nextConditions.push('unconscious');
              events.push({
                type: 'CONDITION_ADDED',
                targetId: target.id,
                conditionId: 'unconscious' as ConditionId,
                sourceName: options.sourceName,
              });
            }
            if (!nextConditions.includes('prone')) {
              nextConditions.push('prone');
              events.push({
                type: 'CONDITION_ADDED',
                targetId: target.id,
                conditionId: 'prone' as ConditionId,
                sourceName: options.sourceName,
              });
            }
          }
        }
      }
    }
  }

  // 4. Concentration Rule (Spec 03 Section 6.2)
  if (target.concentratingOn) {
    if (isDead || nextCurrentHp === 0 || nextConditions.includes('unconscious') || nextConditions.includes('incapacitated')) {
      concentrationBroken = true;
      events.push({
        type: 'CONCENTRATION_ENDED',
        entityId: target.id,
        spellId: target.concentratingOn.sourceId,
        reason: 'incapacitated',
      });
    } else if (damageToApply > 0) {
      // Conscious caster took damage > 0: DC = max(10, floor(damage / 2))
      const dc = Math.max(10, Math.floor(damageToApply / 2));

      if (autoResolveConcentrationCheck) {
        const conBonus =
          target.characterSheet?.savingThrows.con.totalBonus ??
          target.monsterData?.savingThrows?.con ??
          Math.floor(((target.characterSheet?.abilities.con.score ?? target.monsterData?.abilities.con ?? 10) - 10) / 2);

        const hasWarCaster =
          target.characterSheet?.traitIds?.some(
            (t: string) => t.toLowerCase().includes('war-caster') || t.toLowerCase().includes('war_caster'),
          ) ||
          target.characterSheet?.activeModifiers?.some((m) =>
            m.sourceName.toLowerCase().includes('war caster'),
          ) ||
          false;
        const advantageSources: string[] = [];
        const disadvantageSources: string[] = [];
        if (hasWarCaster) advantageSources.push('war_caster');
        if ((target.exhaustionLevel ?? 0) >= 3 || target.conditions.includes('exhaustion')) {
          disadvantageSources.push('exhaustion');
        }
        const mode = resolveRollMode({ advantageSources, disadvantageSources });

        const conRollRes = rollD20(currentState, {
          modifier: conBonus,
          mode,
          advantageSources,
          disadvantageSources,
        });
        currentState = conRollRes.nextState;

        events.push({
          type: 'DICE_ROLLED',
          actorId: target.id,
          rollPurpose: `CON saving throw vs Concentration DC ${dc}`,
          notation: conRollRes.record.formula,
          rolls: conRollRes.record.rolls,
          kept: conRollRes.record.kept,
          modifier: conRollRes.record.modifier,
          total: conRollRes.total,
          mode,
          naturalCrit: conRollRes.isCrit,
          naturalFumble: conRollRes.isFumble,
        });

        const passed = conRollRes.total >= dc;
        events.push({
          type: 'SAVING_THROW_RESOLVED',
          entityId: target.id,
          ability: 'con',
          dc,
          roll: conRollRes.naturalRoll,
          total: conRollRes.total,
          outcome: passed ? 'success' : 'failure',
          sourceSpellOrAbilityName: 'Concentration Check',
        });

        concentrationCheck = {
          dc,
          passed,
          roll: conRollRes.naturalRoll,
          total: conRollRes.total,
        };

        if (!passed) {
          concentrationBroken = true;
          events.push({
            type: 'CONCENTRATION_ENDED',
            entityId: target.id,
            spellId: target.concentratingOn.sourceId,
            reason: 'damaged',
          });
        }
      }
    }
  }

  // 5. Emit DAMAGE_APPLIED Event
  events.unshift({
    type: 'DAMAGE_APPLIED',
    targetId: target.id,
    rawAmount: options.rawAmount,
    finalAmount: damageToApply,
    damageType: options.damageType,
    tempHpAbsorbed,
    hpRemaining: nextCurrentHp,
    instantDeath: isInstantDeath,
    deathSaveFailuresAdded,
    resistanceApplied: mitigated.resistanceApplied,
    vulnerabilityApplied: mitigated.vulnerabilityApplied,
    immunityApplied: mitigated.immunityApplied,
  });

  const hpLost = target.currentHp - nextCurrentHp;

  const updatedTarget: Combatant = {
    ...target,
    currentHp: nextCurrentHp,
    tempHp: nextTempHp,
    conditions: nextConditions,
    deathSaves,
    isDead,
    isStable,
    concentratingOn: concentrationBroken ? undefined : target.concentratingOn,
  };

  const nextCombatants = {
    ...state.combatants,
    [target.id]: updatedTarget,
  };

  // Clean up concentration-linked hazard zones and conditions across all combatants
  const nextHazardZones: Record<string, HazardZone> = {};
  if (state.hazardZones) {
    for (const [zid, zone] of Object.entries(state.hazardZones)) {
      if (concentrationBroken && zone.casterId === target.id && zone.requiresConcentration) {
        events.push({
          type: 'HAZARD_ZONE_REMOVED',
          instanceId: zone.id,
          zoneId: zone.zoneId,
          casterId: zone.casterId,
          reason: 'concentration_ended',
        });
      } else {
        nextHazardZones[zid] = zone;
      }
    }
  }

  let nextInitiativeOrder = state.initiativeOrder;
  let nextActiveCombatantIndex = state.activeCombatantIndex;

  if (concentrationBroken) {
    const brokenConcTargets = new Set(target.concentratingOn?.targetEntityIds ?? []);
    const despawnedSummonIds = new Set<string>();

    for (const [cid, comb] of Object.entries(nextCombatants)) {
      // Despawn concentration-linked summons owned by the caster whose concentration broke
      if (comb.isSummon && comb.summonedByEntityId === target.id && comb.summonConcentrationLinked) {
        despawnedSummonIds.add(cid);
        delete nextCombatants[cid];
        events.push({
          type: 'SUMMON_EXPIRED',
          entityId: cid,
          summonId: comb.summonId ?? cid,
          reason: 'concentration',
          sourceName: comb.summonSourceName,
        });
        continue;
      }

      let modified = false;
      let cConds = [...comb.conditions];
      let remConditions = comb.activeConditions;
      let remEffects = comb.activeEffects;

      if (comb.activeConditions) {
        remConditions = comb.activeConditions.filter((ac) => {
          if (ac.sourceEntityId === target.id && ac.requiresConcentration) {
            modified = true;
            cConds = cConds.filter((c) => c !== ac.conditionId);
            events.push({
              type: 'CONDITION_REMOVED',
              targetId: comb.id,
              conditionId: ac.conditionId,
              sourceName: ac.sourceName,
            });
            return false;
          }
          return true;
        });
      }

      if (comb.activeEffects) {
        remEffects = comb.activeEffects.filter((ae) => {
          const matchesCaster =
            ae.sourceEntityId === target.id ||
            (ae.sourceEntityId === undefined && brokenConcTargets.has(comb.id));
          if (ae.requiresConcentration && matchesCaster) {
            modified = true;
            return false;
          }
          return true;
        });
      }

      if (modified) {
        nextCombatants[cid] = {
          ...comb,
          conditions: cConds,
          activeConditions: remConditions,
          activeEffects: remEffects,
        };
      }
    }

    if (despawnedSummonIds.size > 0) {
      nextInitiativeOrder = state.initiativeOrder.filter((e) => !despawnedSummonIds.has(e.entityId));
      const removedBefore = state.initiativeOrder
        .slice(0, nextActiveCombatantIndex)
        .filter((e) => despawnedSummonIds.has(e.entityId)).length;
      nextActiveCombatantIndex = Math.max(0, nextActiveCombatantIndex - removedBefore);
    }
  }

  // 6. Evaluate Victory
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
    combatants: nextCombatants,
    hazardZones: nextHazardZones,
    initiativeOrder: nextInitiativeOrder,
    activeCombatantIndex: nextActiveCombatantIndex,
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    rawAmount: options.rawAmount,
    finalAmount: damageToApply,
    damageType: options.damageType,
    tempHpAbsorbed,
    hpLost,
    hpRemaining: nextCurrentHp,
    targetId: target.id,
    isInstantDeath,
    deathSaveFailuresAdded,
    isDead,
    isUnconscious: nextConditions.includes('unconscious'),
    droppedToZeroHp,
    concentrationBroken,
    concentrationCheck,
  };
}

export interface ApplyHealingOptions {
  state: CombatState;
  targetId: string;
  amount: number;
  sourceName?: string;
}

export interface ApplyHealingResult {
  state: CombatState;
  events: CombatEvent[];
  targetId: string;
  amount: number;
  hpBefore: number;
  hpAfter: number;
  revivedFromZero: boolean;
}

/**
 * Applies healing conforming to SRD 5.1 rules:
 * - A dead creature cannot regain hit points.
 * - Hit points cannot exceed maxHp.
 * - Any healing from 0 HP revives the character, clears unconscious, and resets death saves.
 */
export function applyHealing(options: ApplyHealingOptions): ApplyHealingResult {
  const { state, targetId, amount, sourceName } = options;
  const target = state.combatants[targetId];
  if (!target) {
    throw new Error(`Target combatant "${targetId}" not found`);
  }
  if (target.isDead) {
    throw new Error(`Cannot heal dead creature "${target.name}"`);
  }

  const events: CombatEvent[] = [];
  const hpBefore = target.currentHp;
  const hpAfter = Math.min(target.maxHp, target.currentHp + Math.max(0, amount));
  const actualHealed = hpAfter - hpBefore;
  const revivedFromZero = hpBefore === 0 && hpAfter > 0;

  let nextConditions = [...target.conditions];
  let deathSaves: DeathSavesState = { ...target.deathSaves };
  let isStable = target.isStable;

  if (revivedFromZero) {
    nextConditions = nextConditions.filter((c) => c !== 'unconscious');
    deathSaves = { successes: 0, failures: 0 };
    isStable = false;

    events.push({
      type: 'CONDITION_REMOVED',
      targetId: target.id,
      conditionId: 'unconscious' as ConditionId,
      sourceName,
    });
  }

  events.push({
    type: 'HEAL_APPLIED',
    targetId: target.id,
    amount: actualHealed,
    hpBefore,
    hpAfter,
    sourceName,
    revivedFromZero,
  });

  const updatedTarget: Combatant = {
    ...target,
    currentHp: hpAfter,
    conditions: nextConditions,
    deathSaves,
    isStable,
  };

  const nextCombatants = {
    ...state.combatants,
    [target.id]: updatedTarget,
  };

  const victoryOutcome = evaluateCombatVictory(nextCombatants);
  const nextState: CombatState = {
    ...state,
    outcome: victoryOutcome,
    combatants: nextCombatants,
  };

  return {
    state: nextState,
    events,
    targetId: target.id,
    amount: actualHealed,
    hpBefore,
    hpAfter,
    revivedFromZero,
  };
}

export interface ApplyTempHpOptions {
  state: CombatState;
  targetId: string;
  amount: number;
  sourceName?: string;
}

export interface ApplyTempHpResult {
  state: CombatState;
  events: CombatEvent[];
  targetId: string;
  amountGained: number;
  tempHpBefore: number;
  tempHpAfter: number;
}

/**
 * Grants Temporary HP according to SRD 5.1 rules:
 * - Does not stack: replaces existing temp HP only if new amount is greater.
 * - Does not restore consciousness or stabilize at 0 HP.
 */
export function applyTemporaryHp(options: ApplyTempHpOptions): ApplyTempHpResult {
  const { state, targetId, amount, sourceName } = options;
  const target = state.combatants[targetId];
  if (!target) {
    throw new Error(`Target combatant "${targetId}" not found`);
  }
  if (target.isDead) {
    throw new Error(`Cannot grant temporary HP to dead creature "${target.name}"`);
  }

  const tempHpBefore = target.tempHp;
  const tempHpAfter = Math.max(tempHpBefore, Math.max(0, amount));
  const amountGained = tempHpAfter - tempHpBefore;

  const events: CombatEvent[] = [
    {
      type: 'TEMP_HP_APPLIED',
      targetId: target.id,
      amount,
      tempHpBefore,
      tempHpAfter,
      sourceName,
    },
  ];

  const updatedTarget: Combatant = {
    ...target,
    tempHp: tempHpAfter,
  };

  const nextState: CombatState = {
    ...state,
    combatants: {
      ...state.combatants,
      [target.id]: updatedTarget,
    },
  };

  return {
    state: nextState,
    events,
    targetId: target.id,
    amountGained,
    tempHpBefore,
    tempHpAfter,
  };
}

export interface ExecuteDeathSaveOptions {
  state: CombatState;
  combatantId: string;
  rollMode?: RollMode;
  modifier?: number;
}

export interface DeathSaveResult {
  state: CombatState;
  events: CombatEvent[];
  combatantId: string;
  roll: number;
  total: number;
  outcome: 'success' | 'failure' | 'revived' | 'dead';
  deathSaves: DeathSavesState;
  currentHp: number;
  isDead: boolean;
  isStable: boolean;
}

/**
 * Executes a Death Saving Throw conforming to SRD 5.1 rules:
 * - Natural 1: 2 failures (character dies if total failures >= 3).
 * - Natural 20: Character regains 1 HP immediately, wakes up (clears unconscious), resets death saves.
 * - Total >= 10: 1 success (character stabilizes if total successes >= 3).
 * - Total < 10: 1 failure (character dies if total failures >= 3).
 * - Supports Halfling Lucky and global saving throw bonuses.
 */
export function executeDeathSave(options: ExecuteDeathSaveOptions): DeathSaveResult {
  const { state, combatantId, rollMode = 'normal', modifier = 0 } = options;
  const combatant = state.combatants[combatantId];
  if (!combatant) {
    throw new Error(`Combatant "${combatantId}" not found`);
  }
  if (combatant.currentHp > 0) {
    throw new Error(`Combatant "${combatant.name}" has ${combatant.currentHp} HP (death saves only rolled at 0 HP)`);
  }
  if (combatant.isDead) {
    throw new Error(`Combatant "${combatant.name}" is already dead`);
  }
  if (combatant.isStable) {
    throw new Error(`Combatant "${combatant.name}" is already stable`);
  }
  if (combatant.side !== 'party') {
    throw new Error(`Monsters die at 0 HP and do not roll death saving throws`);
  }

  const events: CombatEvent[] = [];
  let currentState = state.rngState;

  const isHalfling = combatant.characterSheet?.raceId === 'halfling';
  const d20Res = rollD20(currentState, {
    mode: rollMode,
    modifier,
    halflingLucky: isHalfling,
  });
  currentState = d20Res.nextState;

  events.push({
    type: 'DICE_ROLLED',
    actorId: combatant.id,
    rollPurpose: 'death_saving_throw',
    notation: d20Res.record.formula,
    rolls: d20Res.record.rolls,
    kept: d20Res.record.kept,
    modifier: d20Res.record.modifier,
    total: d20Res.total,
    mode: rollMode,
    naturalCrit: d20Res.isCrit,
    naturalFumble: d20Res.isFumble,
  });

  const roll = d20Res.naturalRoll;
  let deathSaves: DeathSavesState = { ...combatant.deathSaves };
  let currentHp = 0;
  let isDead = false;
  let isStable = false;
  let outcome: 'success' | 'failure' | 'revived' | 'dead';
  let conditions = [...combatant.conditions];

  if (roll === 1) {
    // Natural 1 = 2 failures
    deathSaves.failures += 2;
    if (deathSaves.failures >= 3) {
      isDead = true;
      outcome = 'dead';
      events.push({
        type: 'CREATURE_DIED',
        entityId: combatant.id,
        reason: 'death_save_failures',
      });
    } else {
      outcome = 'failure';
    }
  } else if (roll === 20) {
    // Natural 20 = regain 1 HP immediately & wake up
    currentHp = 1;
    deathSaves = { successes: 0, failures: 0 };
    conditions = conditions.filter((c) => c !== 'unconscious');
    outcome = 'revived';
    events.push({
      type: 'CONDITION_REMOVED',
      targetId: combatant.id,
      conditionId: 'unconscious' as ConditionId,
      sourceName: 'Death Save Nat 20',
    });
  } else if (d20Res.total >= 10) {
    // DC 10 Success
    deathSaves.successes += 1;
    if (deathSaves.successes >= 3) {
      isStable = true;
    }
    outcome = 'success';
  } else {
    // Failure
    deathSaves.failures += 1;
    if (deathSaves.failures >= 3) {
      isDead = true;
      outcome = 'dead';
      events.push({
        type: 'CREATURE_DIED',
        entityId: combatant.id,
        reason: 'death_save_failures',
      });
    } else {
      outcome = 'failure';
    }
  }

  events.push({
    type: 'DEATH_SAVE_ROLLED',
    entityId: combatant.id,
    roll,
    outcome,
    deathSaves,
    currentHp,
  });

  const updatedCombatant: Combatant = {
    ...combatant,
    currentHp,
    deathSaves,
    isDead,
    isStable,
    conditions,
  };

  const nextCombatants = {
    ...state.combatants,
    [combatant.id]: updatedCombatant,
  };

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
    combatants: nextCombatants,
    rngState: currentState,
  };

  return {
    state: nextState,
    events,
    combatantId: combatant.id,
    roll,
    total: d20Res.total,
    outcome,
    deathSaves,
    currentHp,
    isDead,
    isStable,
  };
}

export interface StabilizeCreatureOptions {
  state: CombatState;
  targetId: string;
  sourceName?: string;
}

export interface StabilizeCreatureResult {
  state: CombatState;
  events: CombatEvent[];
  targetId: string;
}

/**
 * Stabilizes a dying creature at 0 HP (e.g. Spare the Dying or DC 10 Medicine check).
 * A stable creature is still at 0 HP and unconscious, but does not roll death saving throws.
 */
export function stabilizeCreature(options: StabilizeCreatureOptions): StabilizeCreatureResult {
  const { state, targetId } = options;
  const target = state.combatants[targetId];
  if (!target) {
    throw new Error(`Combatant "${targetId}" not found`);
  }
  if (target.currentHp > 0) {
    throw new Error(`Cannot stabilize creature "${target.name}" with HP > 0`);
  }
  if (target.isDead) {
    throw new Error(`Cannot stabilize dead creature "${target.name}"`);
  }

  const updatedTarget: Combatant = {
    ...target,
    isStable: true,
    deathSaves: { successes: 0, failures: 0 },
  };

  const nextState: CombatState = {
    ...state,
    combatants: {
      ...state.combatants,
      [target.id]: updatedTarget,
    },
  };

  return {
    state: nextState,
    events: [],
    targetId: target.id,
  };
}
