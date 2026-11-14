import { rollD20 } from '../dice/evaluator.js';
import type { CombatEvent, Combatant } from './types.js';

export interface PartyStealthInput {
  partyInStealth: boolean;
  partyStealthRolls?: Record<string, number>;
}

export interface MonsterAmbushInput {
  monstersAmbushing: boolean;
  monsterStealthDc?: number;
}

export interface DetermineSurpriseOptions {
  combatants: Combatant[];
  rngState: number;
  partyStealth?: PartyStealthInput;
  monsterAmbush?: MonsterAmbushInput;
  explicitSurprisedEntityIds?: string[];
}

export interface DetermineSurpriseResult {
  surprisedEntityIds: string[];
  events: CombatEvent[];
  nextRngState: number;
}

/**
 * Evaluates surprise for an encounter per SRD 5.1 rules (Spec 04 Section 3):
 * - Party in Stealth: Each party member rolls DEX (Stealth) vs monster Passive Perception.
 *   Monsters that fail to notice the party become surprised.
 * - Monster Ambush: Monster Stealth DC vs party members' Passive Perception.
 *   Characters whose Passive Perception is lower than the Stealth DC become surprised.
 * - Explicit IDs: Directly mark specific entities as surprised.
 */
export function determineSurprise(options: DetermineSurpriseOptions): DetermineSurpriseResult {
  const {
    combatants,
    rngState,
    partyStealth,
    monsterAmbush,
    explicitSurprisedEntityIds = [],
  } = options;

  let currentState = rngState;
  const events: CombatEvent[] = [];
  const surprisedSet = new Set<string>(explicitSurprisedEntityIds);

  const partyMembers = combatants.filter((c) => c.side === 'party');
  const monsters = combatants.filter((c) => c.side === 'monster');

  // 1. Party Stealth check vs Monsters Passive Perception
  if (partyStealth?.partyInStealth && partyMembers.length > 0 && monsters.length > 0) {
    const partyRolls: Record<string, number> = {};

    for (const hero of partyMembers) {
      if (typeof partyStealth.partyStealthRolls?.[hero.id] === 'number') {
        partyRolls[hero.id] = partyStealth.partyStealthRolls[hero.id]!;
      } else {
        const d20Res = rollD20(currentState, {
          modifier: hero.stealthModifier,
        });
        currentState = d20Res.nextState;
        partyRolls[hero.id] = d20Res.total;

        events.push({
          type: 'DICE_ROLLED',
          actorId: hero.id,
          rollPurpose: 'stealth_check',
          notation: d20Res.record.resolvedNotation,
          rolls: d20Res.record.rolls,
          kept: d20Res.record.kept,
          modifier: d20Res.record.modifier,
          total: d20Res.total,
          mode: 'normal',
        });
      }
    }

    // A monster is surprised if every party member's stealth roll >= monster.passivePerception
    for (const monster of monsters) {
      const noticedAny = partyMembers.some(
        (hero) => monster.passivePerception > (partyRolls[hero.id] ?? 0),
      );
      if (!noticedAny) {
        surprisedSet.add(monster.id);
      }
    }
  }

  // 2. Monster Ambush vs Party Passive Perception
  if (monsterAmbush?.monstersAmbushing && partyMembers.length > 0) {
    let stealthDc = monsterAmbush.monsterStealthDc;

    if (typeof stealthDc !== 'number') {
      // Roll a collective or primary monster stealth check if none provided
      const leadMonster = monsters[0];
      const stealthMod = leadMonster ? leadMonster.stealthModifier : 0;
      const d20Res = rollD20(currentState, { modifier: stealthMod });
      currentState = d20Res.nextState;
      stealthDc = d20Res.total;

      if (leadMonster) {
        events.push({
          type: 'DICE_ROLLED',
          actorId: leadMonster.id,
          rollPurpose: 'monster_ambush_stealth',
          notation: d20Res.record.resolvedNotation,
          rolls: d20Res.record.rolls,
          kept: d20Res.record.kept,
          modifier: d20Res.record.modifier,
          total: d20Res.total,
          mode: 'normal',
        });
      }
    }

    for (const hero of partyMembers) {
      if (hero.passivePerception < stealthDc) {
        surprisedSet.add(hero.id);
      }
    }
  }

  const surprisedEntityIds = Array.from(surprisedSet);
  if (surprisedEntityIds.length > 0) {
    events.push({
      type: 'SURPRISE_DETERMINED',
      surprisedEntityIds,
    });
  }

  return {
    surprisedEntityIds,
    events,
    nextRngState: currentState,
  };
}
