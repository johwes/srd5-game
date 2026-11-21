export interface SkillTooltipCardProps {
  /** Display name, e.g. "Stealth". */
  name: string;
  /** Governing ability label, e.g. "Dexterity (DEX)". */
  abilityLabel: string;
  /** SRD 5.1 skill description paragraph. */
  description: string;
  /** Mechanical-status badge label (e.g. "Trap Spotter"). May be empty. */
  badge?: string;
  /** Game-use benefit lines (e.g. "Trap/secret-door detection"). */
  uses?: readonly string[];
  /** Extra footer line, e.g. sheet passive score. */
  extraLine?: string;
  /** Tooltip element test id. */
  testId: string;
}

/**
 * Shared skill-benefit tooltip card. Mirrors the BG3-style hover tooltip used
 * for builder spell picks (`SpellsStep`): name + ability header, full SRD
 * description, and an emerald "game use" box sourced from the relevance
 * matrix so players see *why* a skill matters, not just what it is.
 */
export function SkillTooltipCard({
  name,
  abilityLabel,
  description,
  badge,
  uses,
  extraLine,
  testId,
}: SkillTooltipCardProps) {
  const useLines = (uses ?? []).filter((u) => u.trim().length > 0);
  return (
    <div
      role="tooltip"
      data-testid={testId}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-amber-500/40 rounded-xl shadow-2xl backdrop-blur-md text-left flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none transition-opacity z-50"
    >
      <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
        <span className="font-bold text-slate-100 text-xs truncate">{name}</span>
        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-semibold text-slate-300 shrink-0 capitalize">
          {abilityLabel}
        </span>
      </div>
      <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line max-h-40 overflow-y-auto">
        {description}
      </div>
      {useLines.length > 0 && (
        <div
          data-testid={`${testId}-uses`}
          className="text-[11px] leading-relaxed rounded bg-emerald-950/40 border border-emerald-800/50 px-2 py-1 text-emerald-200"
        >
          <span className="font-semibold">⚙ Used in this game: </span>
          {useLines.join('; ')}
        </div>
      )}
      {badge && (
        <div className="text-[10px] text-slate-500">
          Mechanical path — {badge}
        </div>
      )}
      {extraLine && (
        <div className="text-[11px] text-amber-200/90 font-medium">
          {extraLine}
        </div>
      )}
    </div>
  );
}
