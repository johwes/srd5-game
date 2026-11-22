import { useEffect, useState } from 'react';
import type { CharacterBuildState, SrdCompendium } from '@srd5/data';
import { computeDerivedCharacter, type DerivedCharacterSheet } from '@srd5/engine';
import { listOwnedReactions } from './reactionCatalog.js';
import {
  REACTION_POLICY_MODES,
  getReactionPoliciesForCharacterSync,
  setReactionPolicySync,
  type ReactionPolicyMode,
} from '../../persistence/reactionPolicies.js';

export interface CharacterReactionsTabProps {
  hero: CharacterBuildState;
  compendium?: SrdCompendium;
  derived?: DerivedCharacterSheet;
  testIdPrefix?: string;
}

const MODE_LABELS: Record<ReactionPolicyMode, string> = {
  ask: 'Ask',
  auto: 'Auto',
  off: 'Off',
};

const MODE_TITLES: Record<ReactionPolicyMode, string> = {
  ask: 'Ask: show the interrupt prompt every time (default)',
  auto: 'Auto: answer immediately with the first valid option',
  off: 'Off: decline immediately, never prompt',
};

/**
 * SRD-1509 Reactions policy tab (Spec 14 §12).
 *
 * One row per owned reaction (Opportunity Attack is universal; Shield /
 * Counterspell / Protection / Uncanny Dodge gate on sheet data), each with
 * an Ask / Auto / Off segmented control persisted per character. Purely
 * client-side over the existing prompt flow — no engine changes.
 */
export function CharacterReactionsTab({
  hero,
  compendium,
  derived: derivedProp,
  testIdPrefix = 'character-view',
}: CharacterReactionsTabProps) {
  const prefix = `${testIdPrefix}-spellbook-reactions`;
  const [policiesVersion, setPoliciesVersion] = useState(0);
  void policiesVersion;

  const [policies, setPolicies] = useState<Record<string, ReactionPolicyMode>>(() =>
    getReactionPoliciesForCharacterSync(hero.id),
  );

  // Refresh from the sync mirror when the hero changes.
  useEffect(() => {
    setPolicies(getReactionPoliciesForCharacterSync(hero.id));
  }, [hero.id]);

  const derived = derivedProp ?? (compendium ? computeDerivedCharacter(hero, compendium) : null);
  const entries = derived ? listOwnedReactions(hero, derived) : [];

  const setMode = (key: string, mode: ReactionPolicyMode) => {
    const next = setReactionPolicySync(hero.id, key, mode);
    setPolicies({ ...next });
    setPoliciesVersion((v) => v + 1);
  };

  if (!derived) {
    return (
      <div data-testid={prefix} className="space-y-2">
        <div
          data-testid={`${prefix}-unavailable`}
          className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-500"
        >
          Reactions are unavailable without a derived sheet.
        </div>
      </div>
    );
  }

  return (
    <div data-testid={prefix} className="space-y-2">
      <p
        data-testid={`${prefix}-blurb`}
        className="text-[11px] text-slate-500 leading-relaxed"
      >
        Reaction policies are client-side only: Ask shows the interrupt prompt, Auto
        answers it immediately, Off declines it. Stored per character.
      </p>
      {entries.length === 0 ? (
        <div
          data-testid={`${prefix}-empty`}
          className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs text-slate-500"
        >
          No reactions owned.
        </div>
      ) : (
        <div role="list" aria-label="Owned reactions" className="space-y-1.5">
          {entries.map((entry) => {
            const mode = policies[entry.key] ?? 'ask';
            return (
              <div
                key={entry.key}
                role="listitem"
                data-testid={`${prefix}-row-${entry.key}`}
                title={`${entry.label}: ${entry.description}`}
                className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {entry.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-100 truncate">
                      {entry.label}
                    </span>
                    <span
                      data-testid={`${prefix}-slot-${entry.key}`}
                      className="px-1.5 py-px rounded bg-slate-800 text-slate-300 text-[10px] font-mono"
                    >
                      {entry.slotTag}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {entry.description}
                  </div>
                </div>
                <div
                  role="group"
                  aria-label={`${entry.label} policy`}
                  className="flex gap-1 shrink-0"
                >
                  {REACTION_POLICY_MODES.map((candidate) => {
                    const selected = mode === candidate;
                    return (
                      <button
                        key={candidate}
                        type="button"
                        data-testid={`${prefix}-policy-${entry.key}-${candidate}`}
                        aria-pressed={selected}
                        aria-label={`${entry.label}: ${MODE_LABELS[candidate]}`}
                        title={MODE_TITLES[candidate]}
                        onClick={() => setMode(entry.key, candidate)}
                        className={`px-2 py-1 rounded-md text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                          selected
                            ? candidate === 'auto'
                              ? 'bg-emerald-500 text-slate-950'
                              : candidate === 'off'
                                ? 'bg-slate-600 text-white'
                                : 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        {MODE_LABELS[candidate]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
