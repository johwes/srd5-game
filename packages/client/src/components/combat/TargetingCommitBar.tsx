import React from 'react';
import {
  canCommitPending,
  pendingTargetHint,
  type PendingTarget,
} from '../../utils/pendingTargeting.js';

export interface TargetingCommitBarProps {
  pendingTarget: PendingTarget;
  pendingAoeFoes: string[];
  pendingAoeAllies: string[];
  pendingMultiNames: string[];
  friendlyFireOff: boolean;
  onConfirmMulti: () => void;
  onConfirmAoe: () => void;
  onCancel: () => void;
}

/**
 * Shared SRD-410 manual-targeting commit bar. Sibling of the combat HUD so it
 * stacks above the docked hotbar instead of behind it.
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
}: TargetingCommitBarProps) {
  if (pendingTarget.kind === 'none') return null;

  return (
    <div
      data-testid="targeting-commit-bar"
      className="absolute bottom-56 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 bg-slate-950/95 border border-amber-500/50 rounded-xl shadow-2xl text-xs max-w-[92vw]"
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
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
  );
}
