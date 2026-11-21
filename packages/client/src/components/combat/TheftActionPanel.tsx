import React, { useState } from 'react';
import { getAvailableTheftKinds, type TheftKind } from '@srd5/engine';

export interface TheftTargetOption {
  id: string;
  name: string;
  /** Only adjacent marks are valid theft targets (5-ft reach). */
  adjacent: boolean;
  passivePerception?: number;
}

export interface TheftAttemptRequest {
  actorId: string;
  targetId: string;
  kind: TheftKind;
  liftWhat?: 'key' | 'pouch';
  asBonusAction?: boolean;
}

export interface TheftLastResult {
  success: boolean;
  caught: boolean;
  headline: string;
}

interface TheftActionPanelProps {
  actorId: string;
  actorName: string;
  /** DEX (Sleight of Hand) total bonus of the acting hero. */
  sleightBonus: number;
  /** `thieves_tools` proficiency → advantage (never a gate). */
  hasTools: boolean;
  /** Thief L3 Fast Hands → theft may be attempted as a bonus action. */
  hasFastHands: boolean;
  targets: TheftTargetOption[];
  onAttempt: (req: TheftAttemptRequest) => void;
  lastResult?: TheftLastResult | null;
  disabled?: boolean;
}

const KIND_LABEL: Record<TheftKind, string> = {
  pickpocket: 'Pickpocket',
  plant: 'Plant Evidence',
  lift: 'Lift / Snip',
};

const KIND_ICON: Record<TheftKind, string> = {
  pickpocket: '👛',
  plant: '📜',
  lift: '🗝️',
};

/**
 * SRD-1206 Sleight of Hand theft panel (Spec 11 §3.1).
 *
 * Presentational + callback-driven so exploration, combat HUD, and realm
 * patrol views can all commit the same `ATTEMPT_THEFT` command. Check hints
 * come from the engine (`getAvailableTheftKinds`) so tooltips never drift
 * from the contested-roll rules; the Fast Hands bonus-action toggle only
 * renders for Thief rogues.
 */
export function TheftActionPanel({
  actorId,
  actorName,
  sleightBonus,
  hasTools,
  hasFastHands,
  targets,
  onAttempt,
  lastResult,
  disabled,
}: TheftActionPanelProps) {
  const kinds = getAvailableTheftKinds({
    characterSheet: {
      skills: { 'sleight-of-hand': { totalBonus: sleightBonus } },
      proficiencies: { tools: hasTools ? ['thieves_tools'] : [] },
    },
  } as never);
  const hintFor = (kind: TheftKind): string =>
    kinds.find((k) => k.kind === kind)?.hint ??
    `DEX (Sleight of Hand) ${sleightBonus >= 0 ? `+${sleightBonus}` : sleightBonus} vs passive Perception`;

  const adjacentTargets = targets.filter((t) => t.adjacent);
  const [kind, setKind] = useState<TheftKind>('pickpocket');
  const [targetId, setTargetId] = useState<string>(adjacentTargets[0]?.id ?? '');
  const [liftWhat, setLiftWhat] = useState<'key' | 'pouch'>('key');
  const [useBonusAction, setUseBonusAction] = useState(false);

  const selectedTarget = targets.find((t) => t.id === targetId) ?? null;
  const canCommit =
    !disabled && selectedTarget !== null && selectedTarget.adjacent && adjacentTargets.length > 0;

  const commit = () => {
    if (!canCommit || !selectedTarget) return;
    onAttempt({
      actorId,
      targetId: selectedTarget.id,
      kind,
      ...(kind === 'lift' ? { liftWhat } : {}),
      ...(hasFastHands && useBonusAction ? { asBonusAction: true } : {}),
    });
  };

  return (
    <div
      data-testid="theft-action-panel"
      className="rounded-xl border border-purple-500/40 bg-slate-950/95 p-3 space-y-2.5"
      aria-label={`Sleight of Hand theft for ${actorName}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-purple-200">
          🖐️ Sleight of Hand <span className="font-normal text-slate-400">· {actorName}</span>
        </div>
        {hasFastHands && (
          <span data-testid="theft-fast-hands-badge" className="text-[10px] font-bold text-amber-300 bg-amber-950/60 border border-amber-700/60 rounded px-1.5 py-0.5">
            ⚡ Fast Hands
          </span>
        )}
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Theft verb">
        {(Object.keys(KIND_LABEL) as TheftKind[]).map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`theft-kind-${k}`}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              kind === k
                ? 'bg-purple-500 text-slate-950'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <span aria-hidden>{KIND_ICON[k]}</span> {KIND_LABEL[k]}
            <span className="block font-mono font-normal text-[10px] opacity-80">{hintFor(k)}</span>
          </button>
        ))}
      </div>

      {kind === 'lift' && (
        <div className="flex gap-1.5" role="group" aria-label="Lift payload">
          {(['key', 'pouch'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`theft-lift-${opt}`}
              onClick={() => setLiftWhat(opt)}
              aria-pressed={liftWhat === opt}
              className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-bold ${
                liftWhat === opt ? 'bg-purple-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {opt === 'key' ? '🗝️ Lift key' : '✂️ Snip pouch'}
            </button>
          ))}
        </div>
      )}

      <label className="block text-[11px] text-slate-400">
        Mark
        <select
          data-testid="theft-target-select"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-slate-800 text-slate-100 text-xs px-2 py-1.5"
        >
          {targets.length === 0 && <option value="">No marks nearby</option>}
          {targets.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.adjacent}>
              {t.name}
              {t.passivePerception !== undefined ? ` (PP ${t.passivePerception})` : ''}
              {!t.adjacent ? ' — too far' : ''}
            </option>
          ))}
        </select>
      </label>

      {hasFastHands && (
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            data-testid="theft-bonus-toggle"
            checked={useBonusAction}
            onChange={(e) => setUseBonusAction(e.target.checked)}
            className="accent-amber-400"
          />
          Use bonus action (Fast Hands) instead of action
        </label>
      )}

      <button
        type="button"
        data-testid="theft-commit"
        onClick={commit}
        disabled={!canCommit}
        className="w-full px-3 py-2 rounded-lg bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition-colors"
      >
        Attempt {KIND_LABEL[kind]}
        {hasTools ? ' · adv. w/ tools' : ''}
      </button>

      {lastResult && (
        <div
          data-testid="theft-result"
          data-result={lastResult.success ? 'success' : lastResult.caught ? 'caught' : 'spotted'}
          className={`rounded-lg border px-2.5 py-2 text-[11px] italic ${
            lastResult.success
              ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-200'
              : lastResult.caught
                ? 'bg-red-950/60 border-red-700/50 text-red-200'
                : 'bg-amber-950/60 border-amber-700/50 text-amber-200'
          }`}
        >
          {lastResult.success ? '✅' : lastResult.caught ? '🚨' : '👀'} {lastResult.headline}
        </div>
      )}
    </div>
  );
}
