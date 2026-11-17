import React from 'react';
import type { OverworldMap } from '@srd5/engine';
import {
  REPUTATION_MAX,
  REPUTATION_MIN,
  getReputationDisposition,
  getReputationTierProfile,
} from '@srd5/engine';

/**
 * Faction reputation overview modal (SRD-805): banner colors, alignment,
 * reputation tier bars (-100..+100), disposition, and trade price modifiers.
 */

export interface RealmFactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  map: OverworldMap;
}

const DISPOSITION_STYLES: Record<string, string> = {
  allied: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  hostile: 'bg-red-500/15 text-red-300 border-red-500/40',
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

export function RealmFactionsModal({ isOpen, onClose, map }: RealmFactionsModalProps) {
  if (!isOpen) return null;

  const factions = Object.values(map.factions).sort(
    (a, b) => b.relationshipWithParty - a.relationshipWithParty,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-factions-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="realm-factions-title" className="text-xl font-bold text-amber-400">
            🚩 Factions of the Realm
          </h2>
          <button
            type="button"
            data-testid="realm-factions-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <ul data-testid="realm-factions-list" className="space-y-2.5">
          {factions.map((faction) => {
            const reputation = faction.relationshipWithParty;
            const tier = getReputationTierProfile(reputation);
            const disposition = getReputationDisposition(reputation);
            const pct =
              ((reputation - REPUTATION_MIN) / (REPUTATION_MAX - REPUTATION_MIN)) * 100;
            return (
              <li
                key={faction.id}
                data-testid={`realm-faction-card-${faction.id}`}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3.5 h-3.5 rounded-sm border border-slate-700 shrink-0"
                      style={{ backgroundColor: faction.bannerColor }}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-bold text-slate-100 truncate">
                      {faction.name}
                    </span>
                    <span className="text-[10px] text-slate-500 capitalize">
                      {faction.alignment}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-bold capitalize ${DISPOSITION_STYLES[disposition]}`}
                  >
                    {disposition}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden relative">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600" />
                    <div
                      className={`h-full rounded-full ${
                        reputation >= 11
                          ? 'bg-emerald-500'
                          : reputation <= -11
                            ? 'bg-red-500'
                            : 'bg-slate-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span
                    data-testid={`realm-faction-reputation-${faction.id}`}
                    className="text-xs font-mono font-bold text-slate-200 w-10 text-right"
                  >
                    {reputation > 0 ? `+${reputation}` : reputation}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {tier.label} · Prices ×{tier.priceMultiplier} ·{' '}
                  {faction.townPoiIds.length + 1} settlement(s)
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
