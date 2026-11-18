import {
  type SrdCompendium,
  type SpellData,
  defaultCompendium,
} from '@srd5/data';
import { type PlayerViewCombatant } from '@srd5/transport';
import { areAllied, areHostile, getFootprintDistanceFeet } from '@srd5/engine';
import { isUntargetableSummon } from './summonPresentation.js';

export type SpellTargetDisposition = 'self' | 'friendly' | 'hostile' | 'any';

/**
 * Hardcoded sets for SRD 5.1 spells whose mechanical DSL does not yet fully declare
 * hostile/friendly tags or where effect steps are authoring-deferred.
 */
const KNOWN_HOSTILE_SPELLS = new Set([
  'hunters-mark',
  'true-strike',
  'arcane-hand',
  'arcane-sword',
  'banishment',
  'black-tentacles',
  'blight',
  'cloudkill',
  'confusion',
  'darkness',
  'dominate-monster',
  'dominate-person',
  'entangle',
  'faithful-hound',
  'flaming-sphere',
  'fog-cloud',
  'forcecage',
  'freezing-sphere',
  'grease',
  'guardian-of-faith',
  'hold-monster',
  'ice-storm',
  'irresistible-dance',
  'polymorph',
  'power-word-kill',
  'power-word-stun',
  'resilient-sphere',
  'silence',
  'sleep',
  'spike-growth',
  'spirit-guardians',
  'stinking-cloud',
  'wall-of-fire',
  'web',
]);

const KNOWN_FRIENDLY_SPELLS = new Set([
  'death-ward',
  'gate',
  'greater-restoration',
  'raise-dead',
  'teleport',
  'true-resurrection',
  'telepathic-bond',
  'hallow',
  'private-sanctum',
  'magnificent-mansion',
  'tiny-hut',
  'sanctuary',
  'spare-the-dying',
]);

const KNOWN_SELF_SPELLS = new Set([
  'globe-of-invulnerability',
  'instant-summons',
  'secret-chest',
]);

const DEBUFF_CONDITIONS = new Set([
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'incapacitated',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

/**
 * Classifies whether a spell targets the caster ('self'), allies/friendly creatures ('friendly'),
 * hostile enemies ('hostile'), or any creature/point ('any').
 */
export function getSpellTargetDisposition(spell: SpellData): SpellTargetDisposition {
  // Explicit overrides for edge cases and authoring-deferred high level spells
  if (KNOWN_HOSTILE_SPELLS.has(spell.id)) {
    return 'hostile';
  }
  if (KNOWN_FRIENDLY_SPELLS.has(spell.id)) {
    return 'friendly';
  }
  if (KNOWN_SELF_SPELLS.has(spell.id)) {
    return 'self';
  }

  if (spell.targeting.type === 'self') {
    return 'self';
  }

  const filter = spell.targeting.targetFilter;
  if (filter === 'ally' || filter === 'willing' || filter === 'corpse') {
    return 'friendly';
  }
  if (filter === 'enemy') {
    return 'hostile';
  }

  // Check effects for healing
  const hasHealing = spell.effects?.some(
    (e: any) => (e.step === 'deal_damage' && e.damageType === 'healing') || e.step === 'heal',
  );
  if (hasHealing) {
    return 'friendly';
  }

  // Check for hostile steps (attack roll, saving throw, non-healing damage)
  const hasHostileStep = spell.effects?.some(
    (e: any) =>
      e.step === 'attack_roll' ||
      e.step === 'saving_throw' ||
      (e.step === 'deal_damage' && e.damageType !== 'healing'),
  );
  if (hasHostileStep) {
    return 'hostile';
  }

  // Check for debuff conditions applied by the spell
  const hasDebuffCondition = spell.effects?.some(
    (e: any) =>
      e.step === 'apply_condition' && DEBUFF_CONDITIONS.has(e.conditionId?.toLowerCase()),
  );
  if (hasDebuffCondition) {
    return 'hostile';
  }

  // Check for offensive hazard zones
  const hasHostileHazardZone = spell.effects?.some(
    (e: any) =>
      e.step === 'create_hazard_zone' &&
      (e.difficultTerrain ||
        e.onEnterOrStartTurn?.some(
          (sub: any) =>
            sub.step === 'deal_damage' ||
            sub.step === 'saving_throw' ||
            (sub.step === 'apply_condition' && DEBUFF_CONDITIONS.has(sub.conditionId?.toLowerCase())),
        )),
  );
  if (hasHostileHazardZone) {
    return 'hostile';
  }

  const hasBuffEffect = spell.effects?.some((e: any) => e.step === 'apply_active_effect');
  if (hasBuffEffect && !hasHostileStep) {
    return 'friendly';
  }

  // Fallback description keyword inspection if effects array is empty
  const desc = (spell.description ?? '').toLowerCase();
  if (
    desc.includes('saving throw') ||
    desc.includes('attack roll') ||
    desc.includes('takes ') ||
    desc.includes('damage') ||
    desc.includes('hostile')
  ) {
    return 'hostile';
  }
  if (
    desc.includes('regains') ||
    desc.includes('healing') ||
    desc.includes('resurrect') ||
    desc.includes('ward')
  ) {
    return 'friendly';
  }

  return 'any';
}

/**
 * Calculates the maximum number of targets a spell can affect at a given slot level.
 */
export function getSpellMaxTargets(spell: SpellData, slotLevel?: number): number {
  if (spell.targeting.type === 'self') return 1;
  if (spell.targeting.type === 'single' || spell.targeting.type === 'touch') return 1;

  if (spell.targeting.type === 'multiple') {
    let max = typeof spell.targeting.maxTargets === 'number' ? spell.targeting.maxTargets : 3;
    if (
      slotLevel &&
      slotLevel > spell.level &&
      spell.higherLevelScaling?.bonusTargetsPerSlotAboveBase
    ) {
      max += (slotLevel - spell.level) * spell.higherLevelScaling.bonusTargetsPerSlotAboveBase;
    }
    return max;
  }

  return 1;
}

export interface ResolveSpellTargetsOptions {
  spell: SpellData;
  slotLevel?: number;
  caster: PlayerViewCombatant;
  combatants: Record<string, PlayerViewCombatant>;
  selectedCombatantId?: string | null;
  dispositionMatrix?: Record<string, Record<string, 'allied' | 'hostile' | 'neutral'>>;
  /**
   * SRD-410 manual targeting override: explicit picks from the targeting UI.
   * Duplicates are preserved only when `allowDuplicates` is true (e.g. Magic Missile).
   */
  pickedTargetIds?: string[];
  allowDuplicates?: boolean;
}

export interface ResolvedSpellTargets {
  targetIds: string[];
  primaryTarget: PlayerViewCombatant | null;
  disposition: SpellTargetDisposition;
  maxTargets: number;
  rangeFeet: number;
  errorFeedback?: string;
}

/**
 * Resolves the appropriate target IDs for a spell based on:
 * 1. Spell targeting disposition (friendly vs hostile vs self).
 * 2. Range limitations (touch = 5ft, or rangeFeet).
 * 3. Whether the player currently has an eligible ally or enemy selected.
 * 4. Automatic smart targeting (e.g., most wounded ally for heals, closest enemy for attacks,
 *    or multiple in-range allies for multi-target buffs like Bless).
 */
export function resolveSpellTargets(options: ResolveSpellTargetsOptions): ResolvedSpellTargets {
  const {
    spell,
    slotLevel = spell.level,
    caster,
    combatants,
    selectedCombatantId,
    dispositionMatrix,
    pickedTargetIds,
    allowDuplicates = false,
  } = options;

  const disposition = getSpellTargetDisposition(spell);
  const maxTargets = getSpellMaxTargets(spell, slotLevel);
  const rangeFeet = spell.targeting.type === 'touch' ? 5 : spell.targeting.rangeFeet;

  // 0. SRD-410 manual override: validate explicit picks, preserve order/duplicates.
  if (pickedTargetIds && pickedTargetIds.length > 0) {
    const seen = new Set<string>();
    for (const tid of pickedTargetIds) {
      const target = combatants[tid];
      if (!target || target.isDead || target.currentHp <= 0) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: 'One or more selected targets are no longer conscious.',
        };
      }
      if (isUntargetableSummon(target)) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: `${target.name} cannot be targeted.`,
        };
      }
      if (!allowDuplicates && seen.has(tid)) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: `${spell.name} cannot target the same creature twice.`,
        };
      }
      seen.add(tid);
      const dist =
        tid === caster.id
          ? 0
          : getFootprintDistanceFeet(caster.position, caster.size, target.position, target.size);
      if (dist > rangeFeet) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: `Target "${target.name}" is out of spell range (${dist}ft > ${rangeFeet}ft).`,
        };
      }
    }
    const uniqueCount = new Set(pickedTargetIds).size;
    const effectiveCount = allowDuplicates ? pickedTargetIds.length : uniqueCount;
    if (effectiveCount > maxTargets) {
      return {
        targetIds: [],
        primaryTarget: null,
        disposition,
        maxTargets,
        rangeFeet,
        errorFeedback: `Too many targets for ${spell.name}: max ${maxTargets}.`,
      };
    }
    return {
      targetIds: [...pickedTargetIds],
      primaryTarget: combatants[pickedTargetIds[0]!] ?? null,
      disposition,
      maxTargets,
      rangeFeet,
    };
  }

  // 1. Self Spell
  if (disposition === 'self') {
    return {
      targetIds: [caster.id],
      primaryTarget: caster,
      disposition,
      maxTargets: 1,
      rangeFeet: 0,
    };
  }

  // Untargetable conjurations are never valid spell targets (Spec 08 §4.3).
  const allLivingCombatants = Object.values(combatants).filter(
    (c) => !c.isDead && c.currentHp > 0 && !isUntargetableSummon(c),
  );

  const isAlly = (c: PlayerViewCombatant) =>
    c.id === caster.id ||
    areAllied(caster, c, dispositionMatrix) ||
    (c.teamId ?? c.side) === (caster.teamId ?? caster.side);

  const isEnemy = (c: PlayerViewCombatant) =>
    c.id !== caster.id &&
    (areHostile(caster, c, dispositionMatrix) ||
      (c.teamId ?? c.side) !== (caster.teamId ?? caster.side));

  const selectedCandidate = selectedCombatantId ? combatants[selectedCombatantId] ?? null : null;
  if (isUntargetableSummon(selectedCandidate)) {
    return {
      targetIds: [],
      primaryTarget: null,
      disposition,
      maxTargets,
      rangeFeet,
      errorFeedback: `${selectedCandidate!.name} cannot be targeted.`,
    };
  }

  const isSelectedLiving = Boolean(
    selectedCandidate &&
      !selectedCandidate.isDead &&
      selectedCandidate.currentHp > 0 &&
      !isUntargetableSummon(selectedCandidate),
  );

  // 2. Friendly Spell (e.g. Bless, Cure Wounds, Healing Word, Shield of Faith, Aid)
  if (disposition === 'friendly') {
    const livingAllies = allLivingCombatants.filter(isAlly);

    if (livingAllies.length === 0) {
      return {
        targetIds: [],
        primaryTarget: null,
        disposition,
        maxTargets,
        rangeFeet,
        errorFeedback: `No conscious allies found to target with ${spell.name}.`,
      };
    }

    // Check distance for all living allies
    const alliesWithDistance = livingAllies.map((a) => {
      const dist =
        a.id === caster.id
          ? 0
          : getFootprintDistanceFeet(caster.position, caster.size, a.position, a.size);
      return { ally: a, dist };
    });

    const inRangeAllies = alliesWithDistance.filter((a) => a.dist <= rangeFeet);

    // If player explicitly selected an ally
    if (selectedCandidate && isSelectedLiving && isAlly(selectedCandidate)) {
      const selectedDist =
        selectedCandidate.id === caster.id
          ? 0
          : getFootprintDistanceFeet(
              caster.position,
              caster.size,
              selectedCandidate.position,
              selectedCandidate.size,
            );

      if (selectedDist > rangeFeet) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: `Target "${selectedCandidate.name}" is out of spell range (${selectedDist}ft > ${rangeFeet}ft). Move closer to cast!`,
        };
      }

      // Selected ally is valid and in range!
      const chosenAllies: PlayerViewCombatant[] = [selectedCandidate];

      // If multi-target spell (e.g. Bless), fill up remaining slots with other in-range allies
      if (maxTargets > 1) {
        const otherAllies = inRangeAllies
          .filter((a) => a.ally.id !== selectedCandidate.id)
          .sort((a, b) => {
            // Sort wounded first, then distance
            const hpRatioA = a.ally.currentHp / (a.ally.maxHp || 1);
            const hpRatioB = b.ally.currentHp / (b.ally.maxHp || 1);
            if (hpRatioA !== hpRatioB) return hpRatioA - hpRatioB;
            return a.dist - b.dist;
          });

        for (const other of otherAllies) {
          if (chosenAllies.length >= maxTargets) break;
          chosenAllies.push(other.ally);
        }
      }

      return {
        targetIds: chosenAllies.map((a) => a.id),
        primaryTarget: selectedCandidate,
        disposition,
        maxTargets,
        rangeFeet,
      };
    }

    // No friendly ally currently selected - auto-target smart allies
    if (inRangeAllies.length === 0) {
      const nearestAlly = [...alliesWithDistance].sort((a, b) => a.dist - b.dist)[0];
      return {
        targetIds: [],
        primaryTarget: null,
        disposition,
        maxTargets,
        rangeFeet,
        errorFeedback: nearestAlly
          ? `Nearest ally (${nearestAlly.ally.name}) is out of spell range (${nearestAlly.dist}ft > ${rangeFeet}ft). Move closer to cast!`
          : `No allies in range (${rangeFeet}ft) to cast ${spell.name}.`,
      };
    }

    const isHealingSpell = spell.effects?.some(
      (e: any) => (e.step === 'deal_damage' && e.damageType === 'healing') || e.step === 'heal',
    );

    // Sort allies:
    // For healing: lowest HP ratio first
    // For buffs (e.g. Bless): caster and frontline/wounded allies first
    const sortedInRangeAllies = [...inRangeAllies].sort((a, b) => {
      const hpRatioA = a.ally.currentHp / (a.ally.maxHp || 1);
      const hpRatioB = b.ally.currentHp / (b.ally.maxHp || 1);
      if (isHealingSpell) {
        if (hpRatioA !== hpRatioB) return hpRatioA - hpRatioB;
        return a.dist - b.dist;
      }
      // For general buffs (like Bless), prioritize caster or wounded/frontline
      if (a.ally.id === caster.id) return -1;
      if (b.ally.id === caster.id) return 1;
      return a.dist - b.dist;
    });

    const chosen = sortedInRangeAllies.slice(0, maxTargets).map((a) => a.ally);

    return {
      targetIds: chosen.map((c) => c.id),
      primaryTarget: chosen[0] ?? null,
      disposition,
      maxTargets,
      rangeFeet,
    };
  }

  // 3. Hostile Spell (e.g. Sacred Flame, Guiding Bolt, Fire Bolt, Hold Person)
  if (disposition === 'hostile') {
    const livingEnemies = allLivingCombatants.filter(isEnemy);

    if (livingEnemies.length === 0) {
      return {
        targetIds: [],
        primaryTarget: null,
        disposition,
        maxTargets,
        rangeFeet,
        errorFeedback: 'No conscious enemies remaining.',
      };
    }

    const enemiesWithDistance = livingEnemies.map((e) => ({
      enemy: e,
      dist: getFootprintDistanceFeet(caster.position, caster.size, e.position, e.size),
    }));

    // If player explicitly selected a living enemy
    if (selectedCandidate && isSelectedLiving && isEnemy(selectedCandidate)) {
      const selectedDist = getFootprintDistanceFeet(
        caster.position,
        caster.size,
        selectedCandidate.position,
        selectedCandidate.size,
      );

      if (selectedDist > rangeFeet) {
        return {
          targetIds: [],
          primaryTarget: null,
          disposition,
          maxTargets,
          rangeFeet,
          errorFeedback: `Target "${selectedCandidate.name}" is out of spell range (${selectedDist}ft > ${rangeFeet}ft). Move closer to cast!`,
        };
      }

      const chosenEnemies = [selectedCandidate];
      if (maxTargets > 1) {
        const otherEnemies = enemiesWithDistance
          .filter((e) => e.enemy.id !== selectedCandidate.id && e.dist <= rangeFeet)
          .sort((a, b) => a.dist - b.dist);

        for (const other of otherEnemies) {
          if (chosenEnemies.length >= maxTargets) break;
          chosenEnemies.push(other.enemy);
        }
      }

      return {
        targetIds: chosenEnemies.map((e) => e.id),
        primaryTarget: selectedCandidate,
        disposition,
        maxTargets,
        rangeFeet,
      };
    }

    // No enemy selected (or an ally is selected) -> auto-target closest enemy in range
    const sortedEnemies = [...enemiesWithDistance].sort((a, b) => a.dist - b.dist);
    const closest = sortedEnemies[0]!;

    if (closest.dist > rangeFeet) {
      return {
        targetIds: [],
        primaryTarget: null,
        disposition,
        maxTargets,
        rangeFeet,
        errorFeedback: `Nearest enemy (${closest.enemy.name}) is out of spell range (${closest.dist}ft > ${rangeFeet}ft). Move closer to cast!`,
      };
    }

    const inRangeEnemies = sortedEnemies.filter((e) => e.dist <= rangeFeet);
    const chosen = inRangeEnemies.slice(0, maxTargets).map((e) => e.enemy);

    return {
      targetIds: chosen.map((e) => e.id),
      primaryTarget: chosen[0] ?? null,
      disposition,
      maxTargets,
      rangeFeet,
    };
  }

  // 4. Any Creature Disposition (e.g. Dispel Magic, Polymorph, or unclassified)
  if (selectedCandidate && isSelectedLiving) {
    const dist = getFootprintDistanceFeet(
      caster.position,
      caster.size,
      selectedCandidate.position,
      selectedCandidate.size,
    );
    if (dist <= rangeFeet) {
      return {
        targetIds: [selectedCandidate.id],
        primaryTarget: selectedCandidate,
        disposition,
        maxTargets,
        rangeFeet,
      };
    }
  }

  const sortedLiving = allLivingCombatants
    .map((c) => ({
      combatant: c,
      dist: getFootprintDistanceFeet(caster.position, caster.size, c.position, c.size),
    }))
    .filter((c) => c.dist <= rangeFeet)
    .sort((a, b) => a.dist - b.dist);

  const chosen = sortedLiving.slice(0, maxTargets).map((c) => c.combatant);
  return {
    targetIds: chosen.map((c) => c.id),
    primaryTarget: chosen[0] ?? null,
    disposition,
    maxTargets,
    rangeFeet,
  };
}

/**
 * Helper to get a human-readable summary of spell targeting for UI tooltips/cards.
 */
export function formatSpellTargetingSummary(
  spell: SpellData,
  resolved?: ResolvedSpellTargets | null,
): {
  badgeLabel: string;
  badgeStyle: string;
  previewLabel: string;
} {
  const disposition = resolved?.disposition ?? getSpellTargetDisposition(spell);
  const maxTargets = resolved?.maxTargets ?? getSpellMaxTargets(spell);
  const rangeFeet =
    resolved?.rangeFeet ?? (spell.targeting.type === 'touch' ? 5 : spell.targeting.rangeFeet);

  const rangeStr = rangeFeet === 0 ? 'Self' : rangeFeet === 5 && spell.targeting.type === 'touch' ? 'Touch' : `${rangeFeet}ft`;

  if (disposition === 'self') {
    return {
      badgeLabel: '👤 Self',
      badgeStyle: 'bg-sky-950/80 border-sky-600/60 text-sky-300',
      previewLabel: 'Self',
    };
  }

  if (disposition === 'friendly') {
    const badgeLabel =
      spell.targeting.type === 'multiple'
        ? `🛡️ Allies (≤${maxTargets}) · ${rangeStr}`
        : `🛡️ Ally · ${rangeStr}`;

    let previewLabel = 'Allies in range';
    if (resolved?.targetIds && resolved.targetIds.length > 0) {
      if (resolved.targetIds.length === 1 && resolved.primaryTarget) {
        previewLabel = resolved.primaryTarget.name;
      } else {
        previewLabel = `${resolved.targetIds.length} allies targeted`;
      }
    }

    return {
      badgeLabel,
      badgeStyle: 'bg-emerald-950/80 border-emerald-600/60 text-emerald-300',
      previewLabel,
    };
  }

  if (disposition === 'hostile') {
    const badgeLabel =
      spell.targeting.type === 'multiple'
        ? `⚔️ Enemies (≤${maxTargets}) · ${rangeStr}`
        : `⚔️ Enemy · ${rangeStr}`;

    let previewLabel = 'Nearest enemy';
    if (resolved?.primaryTarget) {
      previewLabel = resolved.primaryTarget.name;
    }

    return {
      badgeLabel,
      badgeStyle: 'bg-rose-950/80 border-rose-600/60 text-rose-300',
      previewLabel,
    };
  }

  return {
    badgeLabel: `🎯 Target · ${rangeStr}`,
    badgeStyle: 'bg-slate-800 border-slate-600 text-slate-300',
    previewLabel: resolved?.primaryTarget?.name ?? 'Any in range',
  };
}
