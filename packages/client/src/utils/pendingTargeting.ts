import type { SpellData } from '@srd5/data';
import type { PlayerViewCombatant } from '@srd5/transport';
import { areAllied, areHostile, getFootprintDistanceFeet } from '@srd5/engine';
import {
  getSpellMaxTargets,
  getSpellTargetDisposition,
  type SpellTargetDisposition,
} from './combatTargeting.js';
import type { AoeShape } from '@srd5/engine';
import { isUntargetableSummon } from './summonPresentation.js';

/**
 * SRD-410 manual targeting state machine.
 * Hotbar arms a pending target; token/cell clicks pick; commit dispatches.
 */
export type PendingTarget =
  | { kind: 'none' }
  | {
      kind: 'single';
      action: 'attack' | 'spell';
      spellId?: string;
      slotLevel?: number;
      weaponId?: string;
      attackProfileId?: string;
      disposition: SpellTargetDisposition;
      rangeFeet: number;
      label: string;
    }
  | {
      kind: 'multi';
      spellId: string;
      slotLevel: number;
      picked: string[];
      maxTargets: number;
      allowDuplicates: boolean;
      disposition: SpellTargetDisposition;
      rangeFeet: number;
      label: string;
    }
  | {
      kind: 'aoe';
      spellId: string;
      slotLevel: number;
      shape: AoeShape;
      sizeFeet: number;
      widthFeet?: number;
      origin: { x: number; y: number } | null;
      disposition: SpellTargetDisposition;
      rangeFeet: number;
      label: string;
    };

export const NO_PENDING_TARGET: PendingTarget = { kind: 'none' };

/** Spells whose multiple darts/rays may stack on one target (e.g. Magic Missile). */
export const STACKABLE_MULTI_SPELLS = new Set([
  'magic-missile',
  'scorching-ray',
  'eldritch-blast',
]);

export function isPendingTargetActive(p: PendingTarget): p is Exclude<PendingTarget, { kind: 'none' }> {
  return p.kind !== 'none';
}

export function pendingTargetMaxTargets(p: PendingTarget): number {
  if (p.kind === 'multi') return p.maxTargets;
  if (p.kind === 'single') return 1;
  return 1;
}

export function pendingTargetPickedCount(p: PendingTarget): number {
  if (p.kind === 'multi') return p.picked.length;
  return 0;
}

export function canCommitPending(p: PendingTarget): boolean {
  if (p.kind === 'none') return false;
  if (p.kind === 'single') return false; // single commits on click, no confirm step
  if (p.kind === 'multi') return p.picked.length >= 1 && p.picked.length <= p.maxTargets;
  if (p.kind === 'aoe') return p.origin !== null;
  return false;
}

export function pendingTargetHint(p: PendingTarget): string {
  if (p.kind === 'none') return '';
  if (p.kind === 'single') {
    return p.disposition === 'friendly'
      ? `Click an ally to target ${p.label} — right-click / Esc to cancel`
      : `Click an enemy to target ${p.label} — right-click / Esc to cancel`;
  }
  if (p.kind === 'multi') {
    return p.allowDuplicates
      ? `Click enemies to assign ${p.label} darts (${p.picked.length}/${p.maxTargets}) — same target stacks`
      : `Click allies for ${p.label} (${p.picked.length}/${p.maxTargets}) — click again to unpick`;
  }
  if (p.kind === 'aoe') {
    return p.origin
      ? `Origin set for ${p.label} — click Confirm or pick a new point`
      : `Click a point within range for ${p.label} — right-click / Esc to cancel`;
  }
  return '';
}

export function buildPendingTargetForSpell(spell: SpellData, slotLevel?: number): PendingTarget | null {
  const slot = slotLevel ?? spell.level;
  const disposition = getSpellTargetDisposition(spell);
  if (spell.targeting.type === 'self') return null; // fire immediately
  const rangeFeet = spell.targeting.type === 'touch' ? 5 : spell.targeting.rangeFeet;

  if (spell.targeting.type === 'multiple') {
    return {
      kind: 'multi',
      spellId: spell.id,
      slotLevel: slot,
      picked: [],
      maxTargets: getSpellMaxTargets(spell, slot),
      allowDuplicates: STACKABLE_MULTI_SPELLS.has(spell.id),
      disposition,
      rangeFeet,
      label: spell.name,
    };
  }

  if ((spell.targeting.type === 'point_aoe' || spell.targeting.type === 'self_aoe') && spell.targeting.aoe) {
    return {
      kind: 'aoe',
      spellId: spell.id,
      slotLevel: slot,
      shape: spell.targeting.aoe.shape as AoeShape,
      sizeFeet: spell.targeting.aoe.sizeFeet,
      widthFeet: spell.targeting.aoe.widthFeet,
      origin: spell.targeting.type === 'self_aoe' ? null : null,
      disposition,
      rangeFeet,
      label: spell.name,
    };
  }

  // touch / single
  return {
    kind: 'single',
    action: 'spell',
    spellId: spell.id,
    slotLevel: slot,
    disposition,
    rangeFeet,
    label: spell.name,
  };
}

export interface PendingAttackWeapon {
  id: string;
  weaponId?: string;
  name: string;
  rangeType: 'melee' | 'ranged';
  rangeFeet?: { normal?: number; long?: number } | null;
  reachFeet?: number | null;
}

export function buildPendingTargetForAttack(weapon: PendingAttackWeapon): PendingTarget {
  const rangeFeet =
    weapon.rangeType === 'ranged'
      ? (weapon.rangeFeet?.long ?? weapon.rangeFeet?.normal ?? 120)
      : (weapon.reachFeet ?? 5);
  return {
    kind: 'single',
    action: 'attack',
    weaponId: weapon.weaponId ?? weapon.id,
    attackProfileId: weapon.id,
    disposition: 'hostile',
    rangeFeet,
    label: weapon.name,
  };
}

export interface ValidatePickOptions {
  dispositionMatrix?: Record<string, Record<string, 'allied' | 'hostile' | 'neutral'>>;
}

/**
 * Validate one token click against the armed pending target.
 * Returns { ok } or { ok:false, error } for banner feedback.
 */
export function validateTargetPick(
  pending: Exclude<PendingTarget, { kind: 'none' }>,
  candidate: PlayerViewCombatant,
  caster: PlayerViewCombatant,
  combatants: Record<string, PlayerViewCombatant>,
  opts?: ValidatePickOptions,
): { ok: boolean; error?: string } {
  if (candidate.isDead || candidate.currentHp <= 0) {
    return { ok: false, error: `${candidate.name} is down and cannot be targeted.` };
  }
  if (isUntargetableSummon(candidate)) {
    return { ok: false, error: `${candidate.name} cannot be targeted.` };
  }
  const dist = getFootprintDistanceFeet(caster.position, caster.size, candidate.position, candidate.size);
  if (dist > pending.rangeFeet) {
    return {
      ok: false,
      error: `Target "${candidate.name}" is out of range (${dist}ft > ${pending.rangeFeet}ft). Move closer!`,
    };
  }
  const allied =
    candidate.id === caster.id ||
    areAllied(caster, candidate, opts?.dispositionMatrix) ||
    (candidate.teamId ?? candidate.side) === (caster.teamId ?? caster.side);
  const hostile =
    candidate.id !== caster.id &&
    (areHostile(caster, candidate, opts?.dispositionMatrix) ||
      (candidate.teamId ?? candidate.side) !== (caster.teamId ?? caster.side));

  if (pending.disposition === 'friendly' && !allied) {
    return { ok: false, error: `${pending.label} can only target allies.` };
  }
  if (pending.disposition === 'hostile' && !hostile) {
    return { ok: false, error: `${pending.label} can only target enemies.` };
  }
  if (pending.kind === 'multi' && !pending.allowDuplicates && pending.picked.includes(candidate.id)) {
    // toggle-off is handled by caller; signal as ok-to-toggle
    return { ok: true };
  }
  if (pending.kind === 'multi' && pending.picked.length >= pending.maxTargets && !pending.picked.includes(candidate.id)) {
    return { ok: false, error: `${pending.label} can target at most ${pending.maxTargets}.` };
  }
  void combatants;
  return { ok: true };
}
