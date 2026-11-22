import React from 'react';
import type { SpellData } from '@srd5/data';
import type { PlayerViewCombatant } from '@srd5/transport';
import {
  canCommitPending,
  pendingTargetHint,
  type PendingTarget,
} from '../../utils/pendingTargeting.js';
import { SpellCastPicker, type SpellSlotPool } from './SpellCastPicker.js';

export interface TargetingCommitBarSpellContext {
  spell: SpellData;
  caster?: PlayerViewCombatant | null;
  spellSlots?: Record<number, SpellSlotPool | undefined>;
  selectedSlotLevel: number;
  onSelectSlotLevel: (slot: number) => void;
  bonusActionSpellCast?: boolean;
}

/**
 * SRD-1508 helper: resolves the armed pending spell (if any) into the commit
 * bar's cast-flow context. Returns null for non-spell arms, unknown spells,
 * and idle targeting so parents can pass the result straight through.
 */
export function buildCastSpellContext(
  pendingTarget: PendingTarget,
  activeCombatant: PlayerViewCombatant | null,
  compendium: { getSpell: (id: string) => SpellData | undefined },
  bonusActionSpellCast: boolean | undefined,
  onSelectSlotLevel: (slot: number) => void,
): TargetingCommitBarSpellContext | null {
  if (pendingTarget.kind === 'none') return null;
  if (!('spellId' in pendingTarget)) return null;
  const spellId = (pendingTarget as { spellId?: string }).spellId;
  const slotLevel = (pendingTarget as { slotLevel?: number }).slotLevel;
  if (!spellId || slotLevel === undefined) return null;
  const spell = compendium.getSpell(spellId);
  if (!spell) return null;
  const rawSlots = activeCombatant?.characterSheet?.spellcasting?.spellSlots as
    | Record<number, { available: number; max: number } | undefined>
    | undefined;
  return {
    spell,
    caster: activeCombatant,
    spellSlots: rawSlots,
    selectedSlotLevel: slotLevel,
    onSelectSlotLevel,
    bonusActionSpellCast,
  };
}

export interface TargetingCommitBarProps {
  pendingTarget: PendingTarget;
  pendingAoeFoes: string[];
  pendingAoeAllies: string[];
  pendingMultiNames: string[];
  friendlyFireOff: boolean;
  onConfirmMulti: () => void;
  onConfirmAoe: () => void;
  onCancel: () => void;
  /**
   * SRD-1508 cast-flow context: when the armed pending target is a spell and
   * the parent resolves the `SpellData` + slot pools, the commit bar renders
   * the inspect card + slot picker beside the hint so the player picks the
   * slot in the arming step before picking the target.
   */
  castSpell?: TargetingCommitBarSpellContext | null;
}

/**
 * Shared SRD-410 manual-targeting commit bar. Sibling of the combat HUD so it
 * stacks above the z-30 docked hotbar instead of behind it.
 *
 * SRD-1508 extends the bar with the cast-flow inspect + slot picker: when
 * `castSpell` is provided for an armed spell cast, the picker renders above
 * the hint row and re-slots the pending target in place (picks/origin kept).
 */
export function TargetingCommitBar({
  pendingTarget,
  pendingAoeFoes,
  pendingAoeAllies,
  pendingMultiNames,
  friendlyFireOff,
  onConfirmMulti,
  onConfirmAoe,
  onCancel,
  castSpell,
}: TargetingCommitBarProps) {
  if (pendingTarget.kind === 'none') return null;

  const showCastPicker =
    castSpell != null &&
    ((pendingTarget.kind === 'single' &&
      (pendingTarget as { action?: string }).action === 'spell') ||
      pendingTarget.kind === 'multi' ||
      pendingTarget.kind === 'aoe');

  return (
    <div
      data-testid="targeting-commit-bar"
      className="absolute bottom-56 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 max-w-[94vw]"
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {showCastPicker && castSpell && (
        <div data-testid="targeting-cast-picker-wrap">
          <SpellCastPicker
            spell={castSpell.spell}
            caster={castSpell.caster}
            spellSlots={castSpell.spellSlots}
            selectedSlot={castSpell.selectedSlotLevel}
            onSelectSlot={castSpell.onSelectSlotLevel}
            bonusActionSpellCast={castSpell.bonusActionSpellCast}
            testIdPrefix="targeting-cast"
          />
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-950/95 border border-amber-500/50 rounded-xl shadow-2xl text-xs max-w-[92vw]">
        <span data-testid="targeting-hint" className="text-slate-200">
          {pendingTargetHint(pendingTarget)}
        </span>
        {pendingTarget.kind === 'multi' && (
          <span
            data-testid="targeting-counter"
            className="px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500 text-purple-200 font-mono font-bold shrink-0"
          >
            🪄 ×{pendingTarget.maxTargets - pendingTarget.picked.length} left
          </span>
        )}
        {pendingTarget.kind === 'aoe' && (
          <span
            data-testid="targeting-aoe-preview"
            className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 font-mono shrink-0"
          >
            <span className="text-rose-300">{pendingAoeFoes.length} foe{pendingAoeFoes.length === 1 ? '' : 's'}</span>
            <span className="text-slate-500"> · </span>
            <span className={friendlyFireOff ? 'text-slate-500 line-through' : 'text-emerald-300'}>
              {pendingAoeAllies.length} ally{pendingAoeAllies.length === 1 ? '' : 'ies'}
              {friendlyFireOff ? ' (spared)' : ''}
            </span>
          </span>
        )}
        {pendingTarget.kind === 'multi' && pendingMultiNames.length > 0 && (
          <span data-testid="targeting-picked-list" className="text-slate-400 truncate max-w-[30vw]">
            {pendingMultiNames.join(', ')}
          </span>
        )}
        {(pendingTarget.kind === 'multi' || pendingTarget.kind === 'aoe') && (
          <button
            type="button"
            data-testid="targeting-confirm-btn"
            disabled={!canCommitPending(pendingTarget)}
            onClick={() =>
              pendingTarget.kind === 'multi' ? onConfirmMulti() : onConfirmAoe()
            }
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold shrink-0"
          >
            Confirm
          </button>
        )}
        <button
          type="button"
          data-testid="targeting-cancel-btn"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold shrink-0"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
