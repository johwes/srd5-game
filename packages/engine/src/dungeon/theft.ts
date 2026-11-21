import { z } from 'zod';
import { rollD20, rollDamage } from '../dice/evaluator.js';
import { isAdjacent } from './props.js';
import {
  spendAction,
  spendBonusAction,
} from '../combat/turn-budget.js';
import type { Combatant } from '../combat/types.js';
import type { GameEvent, GameState } from '../state/types.js';

/**
 * SRD-1206: Sleight of Hand theft verb (Spec 11 §3.1).
 *
 * New exploration/realm verb keyed off the DEX (Sleight of Hand) skill, with
 * `thieves_tools` proficiency granting advantage rather than gating. Three
 * distinct payloads:
 * - `pickpocket`: lift a purse (gold, credited to the actor).
 * - `plant`: plant incriminating evidence on the target (marker effect).
 * - `lift`: lift a key (`key`) or snip a component pouch (`pouch`).
 *
 * Failure is never silent: a miss by <5 is `spotted` (no payload, target
 * suspicious), a miss by >=5 (or a natural 1) is `caught` (target alerted,
 * attitude/combat hook for the caller). Fast Hands (rogue Thief L3) allows
 * theft as a bonus action in combat; otherwise theft costs an action.
 */

// ---------------------------------------------------------------------------
// Specs & constants
// ---------------------------------------------------------------------------

export const THEFT_KINDS = ['pickpocket', 'plant', 'lift'] as const;
export const TheftKindSchema = z.enum(THEFT_KINDS);
export type TheftKind = z.infer<typeof TheftKindSchema>;

export const THEFT_LIFT_TARGETS = ['key', 'pouch'] as const;
export const TheftLiftTargetSchema = z.enum(THEFT_LIFT_TARGETS);
export type TheftLiftTarget = z.infer<typeof TheftLiftTargetSchema>;

/** Gold purse formula rolled on a successful pickpocket. */
export const THEFT_GOLD_FORMULA = '2d6';
/** Missing the DC by this margin (or a natural 1) escalates spotted → caught. */
export const THEFT_CAUGHT_MARGIN = 5;
/** Thief L3 feature that unlocks bonus-action theft in combat. */
export const FAST_HANDS_FEATURE_ID = 'fast-hands';

export const PLANTED_EVIDENCE_EFFECT_ID = 'planted-evidence';
export const STOLEN_KEY_EFFECT_ID = 'stolen-key';
export const COMPONENT_POUCH_SNIPPED_EFFECT_ID = 'component-pouch-snipped';
export const THEFT_ALERTED_EFFECT_ID = 'theft-alerted';

export interface TheftAttemptOptions {
  state: GameState;
  actorId: string;
  targetId: string;
  kind: TheftKind;
  /** Only for `lift`: steal a key vs snip a component pouch. Defaults to `key`. */
  liftWhat?: TheftLiftTarget;
  /** Spend a bonus action instead of an action (combat only; requires Fast Hands). */
  asBonusAction?: boolean;
  /** Override the target's passive-Perception DC (tests, special NPCs). */
  dcOverride?: number;
  /** Override the pickpocket gold formula (tests). */
  goldFormula?: string;
}

export interface TheftOutcome {
  kind: TheftKind;
  success: boolean;
  /** True when the mark caught the thief red-handed (fail by >= margin or nat 1). */
  caught: boolean;
  /** d20 natural roll (higher of two on advantage). */
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  hadToolsAdvantage: boolean;
  asBonusAction: boolean;
  /** Gold credited on a successful pickpocket. */
  goldStolen?: number;
  /** Human-readable headline for logs and the client panel. */
  headline: string;
}

export interface TheftAttemptResult {
  nextState: GameState;
  events: GameEvent[];
  outcome: TheftOutcome;
}

// ---------------------------------------------------------------------------
// Helpers (pure, exported for tests and the client panel)
// ---------------------------------------------------------------------------

function normalizeToolId(id: string): string {
  return id.trim().toLowerCase().replace(/['’]/g, '').replace(/[\s-]+/g, '_');
}

/** DEX (Sleight of Hand) total bonus for a combatant. */
export function getSleightOfHandBonus(actor: Combatant): number {
  const sheet = actor.characterSheet;
  if (sheet?.skills?.['sleight-of-hand']) {
    return sheet.skills['sleight-of-hand'].totalBonus;
  }
  if (sheet?.abilities?.dex) return sheet.abilities.dex.modifier;
  return actor.dexterityModifier;
}

/** True when the actor holds `thieves_tools` proficiency (tools bonus → advantage). */
export function hasThievesTools(actor: Combatant): boolean {
  const tools = actor.characterSheet?.proficiencies?.tools ?? [];
  if (tools.some((t) => normalizeToolId(t) === 'thieves_tools')) return true;
  // Direct dex-tool fallback: actors carrying the item instance grant the edge too.
  const inv = actor.characterSheet ? undefined : (actor as unknown as { inventory?: Array<{ itemId?: string }> }).inventory;
  if (Array.isArray(inv) && inv.some((i) => typeof i?.itemId === 'string' && i.itemId.includes('thieves'))) return true;
  return false;
}

/** True when the actor has the Thief Roguish Archetype Fast Hands feature. */
export function hasFastHands(actor: Combatant): boolean {
  const featureIds = actor.characterSheet?.featureIds ?? [];
  if (featureIds.includes(FAST_HANDS_FEATURE_ID)) return true;
  const build = actor.buildState as unknown as { classEntries?: Array<{ subclassId?: string; level?: number }>; classes?: Array<{ subclassId?: string; level?: number }> } | undefined;
  const entries = build?.classEntries ?? build?.classes ?? [];
  if (Array.isArray(entries) && entries.some((e) => e?.subclassId === 'thief' && (e?.level ?? 0) >= 3)) return true;
  return false;
}

/** Passive-Perception DC of the mark (override-able for tests and special NPCs). */
export function getTheftDc(target: Combatant, dcOverride?: number): number {
  if (typeof dcOverride === 'number') return dcOverride;
  if (target.characterSheet?.skills?.perception) {
    return target.characterSheet.skills.perception.passiveScore;
  }
  return target.passivePerception;
}

function pushMarkerEffect(target: Combatant, effectId: string, name: string): void {
  const existing = target.activeEffects ?? [];
  if (existing.some((e) => e.effectId === effectId)) return;
  target.activeEffects = [
    ...existing,
    {
      effectId,
      name,
      requiresConcentration: false,
      modifiers: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolves one Sleight of Hand theft attempt. Works in exploration (no budget)
 * and in combat (spends an action, or a bonus action with Fast Hands).
 *
 * Never silent: always emits `CHECK_RESOLVED` + `THEFT_RESOLVED`; a caught
 * thief also marks the target `theft-alerted` so realm/patrol layers can
 * escalate to attitude loss, Threat, or combat.
 */
export function resolveTheftAttempt(options: TheftAttemptOptions): TheftAttemptResult {
  const { actorId, targetId, kind, liftWhat = 'key', asBonusAction = false } = options;
  const state = options.state;
  const nextState = structuredClone(state);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;

  // --- Action economy (combat only) -------------------------------------
  // Operate on the canonical combatant copy when in combat so budget spend
  // and effect markers stay on the single source of truth; exploration uses
  // the party/monster maps directly.
  const canonActor: Combatant | undefined =
    (inCombat ? nextState.combat!.combatants[actorId] : undefined) ??
    nextState.party[actorId] ??
    nextState.monsters[actorId];
  if (!canonActor) throw new Error(`Theft actor not found: ${actorId}`);
  const canonTarget: Combatant | undefined =
    (inCombat ? nextState.combat!.combatants[targetId] : undefined) ??
    nextState.party[targetId] ??
    nextState.monsters[targetId];
  if (!canonTarget) throw new Error(`Theft target not found: ${targetId}`);
  const actor = canonActor;
  const target = canonTarget;
  if (actorId === targetId) throw new Error('Cannot steal from yourself');
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Theft actor ${actorId} is down`);
  if (target.isDead || target.currentHp <= 0) throw new Error(`Theft target ${targetId} is down`);
  if (!isAdjacent(actor.position, target.position)) {
    throw new Error(`Theft target ${targetId} is out of reach (must be adjacent)`);
  }

  let spentAs: 'action' | 'bonus_action' | 'free' = 'free';
  if (inCombat) {
    const combat = nextState.combat!;
    if (combat.activeCombatantId !== actorId) {
      throw new Error(`It is not ${actorId}'s turn`);
    }
    if (!combat.turnBudget) throw new Error('No active turn budget');
    if (asBonusAction) {
      if (!hasFastHands(actor)) {
        throw new Error('Sleight of Hand as a bonus action requires Fast Hands (Thief rogue 3)');
      }
      combat.turnBudget = spendBonusAction(combat.turnBudget);
      spentAs = 'bonus_action';
    } else {
      combat.turnBudget = spendAction(combat.turnBudget);
      spentAs = 'action';
    }
  } else if (asBonusAction) {
    throw new Error('Bonus-action theft is only meaningful in combat');
  }

  const parsedKind = TheftKindSchema.parse(kind);
  const parsedLift = TheftLiftTargetSchema.parse(liftWhat);

  const modifier = getSleightOfHandBonus(actor);
  const hadToolsAdvantage = hasThievesTools(actor);
  const dc = getTheftDc(target, options.dcOverride);

  // RNG lives on both GameState and CombatState during combat — thread one
  // source and write back to both so headless replay stays deterministic.
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, {
    modifier,
    mode: hadToolsAdvantage ? 'advantage' : 'normal',
  });
  rngState = rollRes.nextState;

  const success = rollRes.total >= dc;
  const caught = !success && (rollRes.naturalRoll === 1 || rollRes.total <= dc - THEFT_CAUGHT_MARGIN);

  const events: GameEvent[] = [];
  events.push({
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: 'sleight_of_hand',
    targetId,
    dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent);

  let goldStolen: number | undefined;
  let headline: string;

  if (success) {
    switch (parsedKind) {
      case 'pickpocket': {
        const formula = options.goldFormula ?? THEFT_GOLD_FORMULA;
        const goldRes = rollDamage(rngState, formula);
        rngState = goldRes.nextState;
        const rolled = Math.max(0, goldRes.total);
        // Credit the actor's purse when a build state exists; debit the mark
        // when it carries one (party-vs-party). Monsters without purses just
        // yield street coin — the mechanical path is the transfer event.
        if (target.buildState && rolled > 0) {
          const available = target.buildState.currency.gp;
          const taken = Math.min(available, rolled);
          target.buildState.currency = {
            ...target.buildState.currency,
            gp: available - taken,
          };
          goldStolen = taken;
          events.push({
            type: 'INVENTORY_UPDATED',
            characterId: targetId,
            inventory: target.buildState.inventory,
            currency: target.buildState.currency,
          });
        } else {
          goldStolen = rolled;
        }
        if (actor.buildState && (goldStolen ?? 0) > 0) {
          actor.buildState.currency = {
            ...actor.buildState.currency,
            gp: actor.buildState.currency.gp + goldStolen!,
          };
          events.push({
            type: 'INVENTORY_UPDATED',
            characterId: actorId,
            inventory: actor.buildState.inventory,
            currency: actor.buildState.currency,
          });
        }
        headline = `${actor.name} lifts ${goldStolen} gp from ${target.name} (${rollRes.total} vs DC ${dc}).`;
        break;
      }
      case 'plant': {
        pushMarkerEffect(target, PLANTED_EVIDENCE_EFFECT_ID, 'Planted Evidence');
        headline = `${actor.name} plants evidence on ${target.name} (${rollRes.total} vs DC ${dc}).`;
        break;
      }
      case 'lift': {
        if (parsedLift === 'pouch') {
          pushMarkerEffect(target, COMPONENT_POUCH_SNIPPED_EFFECT_ID, 'Component Pouch Snipped');
          headline = `${actor.name} snips ${target.name}'s component pouch (${rollRes.total} vs DC ${dc}).`;
        } else {
          pushMarkerEffect(actor, STOLEN_KEY_EFFECT_ID, `Lifted Key (${target.name})`);
          headline = `${actor.name} lifts a key from ${target.name} (${rollRes.total} vs DC ${dc}).`;
        }
        break;
      }
    }
  } else if (caught) {
    pushMarkerEffect(target, THEFT_ALERTED_EFFECT_ID, 'Theft Alerted');
    headline = `${target.name} catches ${actor.name} ${parsedKind === 'plant' ? 'planting something' : 'with fingers in the wrong pocket'} (${rollRes.total} vs DC ${dc}) — caught red-handed.`;
  } else {
    headline = `${target.name} notices ${actor.name}'s ${parsedKind} attempt (${rollRes.total} vs DC ${dc}) — nothing taken.`;
  }

  events.push({
    type: 'THEFT_RESOLVED',
    actorId,
    targetId,
    kind: parsedKind,
    liftWhat: parsedKind === 'lift' ? parsedLift : undefined,
    success,
    caught,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    dc,
    hadToolsAdvantage,
    asBonusAction: spentAs === 'bonus_action',
    ...(goldStolen !== undefined ? { goldStolen } : {}),
    headline,
  } as unknown as GameEvent);

  if (inCombat) {
    events.push({
      type: 'ACTION_USED',
      actorId,
      actionName: 'custom',
      cost: spentAs === 'bonus_action' ? 'bonus_action' : 'action',
    } as unknown as GameEvent);
  }

  // Mirror combatant changes back to party/monster maps (reducer convention)
  // and keep both RNG counters in lockstep.
  nextState.rngState = rngState;
  if (nextState.combat) {
    nextState.combat.rngState = rngState;
    for (const [id, c] of Object.entries(nextState.combat.combatants)) {
      if (c.side === 'party') nextState.party[id] = c;
      else nextState.monsters[id] = c;
    }
  }

  return { nextState, events, outcome: {
    kind: parsedKind,
    success,
    caught,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    dc,
    hadToolsAdvantage,
    asBonusAction: spentAs === 'bonus_action',
    ...(goldStolen !== undefined ? { goldStolen } : {}),
    headline,
  } };
}

/** Lists the theft verbs available to an actor (UI gating helper). */
export function getAvailableTheftKinds(actor: Combatant): Array<{ kind: TheftKind; label: string; hint: string }> {
  const bonus = getSleightOfHandBonus(actor);
  const tools = hasThievesTools(actor);
  const signed = bonus >= 0 ? `+${bonus}` : `${bonus}`;
  const edge = tools ? ' (adv. w/ tools)' : '';
  return [
    { kind: 'pickpocket', label: 'Pickpocket', hint: `DEX (Sleight of Hand) ${signed} vs passive Perception${edge} — lift purse` },
    { kind: 'plant', label: 'Plant Evidence', hint: `DEX (Sleight of Hand) ${signed} vs passive Perception${edge} — plant evidence` },
    { kind: 'lift', label: 'Lift / Snip', hint: `DEX (Sleight of Hand) ${signed} vs passive Perception${edge} — lift key or snip pouch` },
  ];
}
