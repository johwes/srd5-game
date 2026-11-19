import React from 'react';
import type {
  MissionApproachOption,
  ResolvedMissionApproach,
} from '@srd5/engine';

/**
 * Special-ops Approach Dialogue modal (SRD-1106, Spec 10 §5).
 *
 * Lists the 3–4 POI-specific approaches with live 5e check previews
 * (best hero bonus, DC, success odds, spell/tool costs). After resolution the
 * modal shows the deterministic d20 roll feedback. Presentational: the host
 * owns `reduceRealm` dispatch and the resolved record.
 */

export interface RealmMissionApproachModalProps {
  isOpen: boolean;
  missionKind: string;
  poiName: string;
  approaches: MissionApproachOption[];
  /** Best live party bonus per approach id (for odds previews). */
  bonuses: Record<string, { bonus: number; actorName: string }>;
  resolved: ResolvedMissionApproach | null;
  onChooseApproach: (approachId: string) => void;
  onClose: () => void;
}

/** d20 success probability for bonus vs DC (nat 1 always fails, nat 20 always succeeds). */
export function approachSuccessOdds(bonus: number, dc: number): number {
  const needed = Math.max(2, Math.min(20, dc - bonus));
  // Rolls of `needed..19` succeed normally plus nat 20 always succeeds.
  return (21 - needed) / 20;
}

export function formatApproachCheckPreview(approach: MissionApproachOption): string {
  if (approach.checkKind === 'assault') return 'No check — straight battle';
  const parts: string[] = [];
  if (approach.skillId) {
    const skill = approach.alternateSkillId
      ? `${approach.skillId}/${approach.alternateSkillId}`
      : approach.skillId;
    parts.push(`${skill} DC ${approach.dc}`);
  } else {
    parts.push(`DC ${approach.dc}`);
  }
  if (approach.requiresTool) parts.push(`needs ${approach.requiresTool}`);
  if (approach.requiresSpellIds.length > 0) {
    parts.push(`expends ${approach.requiresSpellIds[0]} (slot ${approach.requiredSlotLevel}+)`);
  }
  if (approach.ropeAssist) parts.push('advantage w/ rope team');
  if (approach.bloodlessOnSuccess) parts.push('bloodless on success');
  return parts.join(' · ');
}

export function RealmMissionApproachModal({
  isOpen,
  missionKind,
  poiName,
  approaches,
  bonuses,
  resolved,
  onChooseApproach,
  onClose,
}: RealmMissionApproachModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-mission-approach-title"
      data-testid="realm-mission-approach-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-amber-500/50 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2
              id="realm-mission-approach-title"
              className="text-xl font-bold text-amber-400"
            >
              🗡️ Approach: {missionKind.replace(/_/g, ' ')}
            </h2>
            <p className="text-xs text-slate-400 mt-1">{poiName}</p>
          </div>
          <button
            type="button"
            data-testid="realm-mission-approach-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        {resolved ? (
          <div
            data-testid="realm-mission-approach-result"
            className={`rounded-lg border p-3 space-y-1.5 ${
              resolved.success
                ? 'border-emerald-600/50 bg-emerald-950/40'
                : 'border-red-600/50 bg-red-950/40'
            }`}
          >
            <p
              data-testid="realm-mission-approach-headline"
              className="text-sm font-bold text-slate-100"
            >
              {resolved.headline}
            </p>
            {resolved.naturalRoll > 0 && (
              <p
                data-testid="realm-mission-approach-roll"
                className="text-xs text-slate-300 font-mono"
              >
                🎲 d20: {resolved.naturalRoll}
                {resolved.advantage ? ' (adv)' : ''} + {resolved.bonus} = {resolved.total} vs
                DC {resolved.dc} → {resolved.success ? 'SUCCESS' : 'FAILURE'}
              </p>
            )}
            {resolved.expendedSpell && (
              <p className="text-[11px] text-sky-300">
                ✨ {resolved.expendedSpell.casterName} expended {resolved.expendedSpell.spellId}{' '}
                (slot {resolved.expendedSpell.slotLevel})
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              {resolved.outcome === 'bloodless_success'
                ? 'Bloodless — the objective falls without a battle.'
                : 'Steel is drawn — deploy for the tactical battle.'}
            </p>
          </div>
        ) : (
          <ul data-testid="realm-mission-approach-list" className="space-y-2">
            {approaches.map((approach) => {
              const preview = bonuses[approach.id];
              const odds =
                preview && approach.checkKind !== 'assault'
                  ? approachSuccessOdds(preview.bonus, approach.dc)
                  : null;
              return (
                <li key={approach.id}>
                  <button
                    type="button"
                    data-testid={`realm-mission-approach-option-${approach.id}`}
                    onClick={() => onChooseApproach(approach.id)}
                    className="w-full text-left rounded-lg border border-slate-700 bg-slate-950/60 hover:border-amber-500/70 p-3 space-y-1 transition-colors min-h-[44px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-100">
                        {approach.label}
                      </span>
                      {odds !== null && (
                        <span
                          data-testid={`realm-mission-approach-odds-${approach.id}`}
                          className="text-[11px] font-mono text-sky-300 shrink-0"
                        >
                          {Math.round(odds * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">{approach.description}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatApproachCheckPreview(approach)}
                      {preview && approach.checkKind !== 'assault'
                        ? ` · ${preview.actorName} ${preview.bonus >= 0 ? '+' : ''}${preview.bonus}`
                        : ''}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
