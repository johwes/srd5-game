import React from 'react';
import { WAR_NATION_ARCHETYPES } from '@srd5/engine';

/**
 * Nation-pick modal for new Realm war campaigns (SRD-1106, Spec 10 §1–§2).
 *
 * Lists the 8 balanced archetypes (3 Good / 3 Neutral / 2 Evil) with ruler,
 * flavor, and patron perk. Presentational: the host passes the selected
 * archetype id back through `onSelectNation`.
 */

export interface RealmNationSelectModalProps {
  isOpen: boolean;
  onSelectNation: (archetypeId: string) => void;
  onClose?: () => void;
  /** When false the modal cannot be dismissed without picking (new campaign). */
  dismissible?: boolean;
}

const ALIGNMENT_STYLES: Record<string, string> = {
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  evil: 'bg-red-500/15 text-red-300 border-red-500/40',
};

export function RealmNationSelectModal({
  isOpen,
  onSelectNation,
  onClose,
  dismissible = false,
}: RealmNationSelectModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-nation-select-title"
      data-testid="realm-nation-select-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-amber-500/50 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2
              id="realm-nation-select-title"
              className="text-xl font-serif font-extrabold text-amber-400"
            >
              ⚔️ Choose Your Banner
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Serve one nation as its elite special-operations company. First to 100 War
              Power — or last nation standing — wins the Realm.
            </p>
          </div>
          {dismissible && onClose && (
            <button
              type="button"
              data-testid="realm-nation-select-close-btn"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
            >
              ✕
            </button>
          )}
        </header>

        <ul data-testid="realm-nation-select-list" className="grid gap-2.5 sm:grid-cols-2">
          {WAR_NATION_ARCHETYPES.map((archetype) => (
            <li key={archetype.id}>
              <button
                type="button"
                data-testid={`realm-nation-option-${archetype.id}`}
                onClick={() => onSelectNation(archetype.id)}
                className="w-full text-left rounded-lg border border-slate-700 bg-slate-950/60 hover:border-amber-500/70 hover:bg-slate-900 p-3 space-y-1.5 transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-sm border border-slate-600 shrink-0"
                    style={{ backgroundColor: archetype.bannerColor }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {archetype.nationName}
                  </span>
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border font-bold capitalize shrink-0 ${ALIGNMENT_STYLES[archetype.alignment] ?? ''}`}
                  >
                    {archetype.alignment}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {archetype.ruler} · {archetype.flavor}
                </p>
                <p
                  data-testid={`realm-nation-perk-${archetype.id}`}
                  className="text-[11px] text-amber-300/90"
                >
                  🎖️ {archetype.perk}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
