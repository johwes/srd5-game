import {
  RELEVANCE_MATRIX,
  getLanguageMechanicalInfo,
  getSkillMechanicalInfo,
  getSpellMechanicalInfo,
  type PartyCoverageHint,
} from './relevance.js';

export function MechanicalStatusBadge({
  status,
  label,
  title,
  testId,
}: {
  status: 'supported' | 'unsupported';
  label: string;
  title: string;
  testId: string;
}) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded border font-medium ${
        status === 'supported'
          ? 'bg-emerald-950/70 border-emerald-700/60 text-emerald-300'
          : 'bg-amber-950/70 border-amber-600/60 text-amber-300'
      }`}
    >
      <span aria-hidden="true">{status === 'supported' ? '⚙' : '○'}</span>
      {label}
    </span>
  );
}

export function LanguageMechanicalBadge({
  languageId,
  testIdPrefix,
}: {
  languageId: string;
  testIdPrefix: string;
}) {
  const info = getLanguageMechanicalInfo(languageId);
  return (
    <MechanicalStatusBadge
      status={info.status}
      label={info.badge}
      title={`Mechanical path — ${info.uses.join('; ')}`}
      testId={`${testIdPrefix}-mech-lang-${info.id}`}
    />
  );
}

export function SkillMechanicalBadge({
  skillId,
  testIdPrefix,
}: {
  skillId: string;
  testIdPrefix: string;
}) {
  const info = getSkillMechanicalInfo(skillId);
  return (
    <MechanicalStatusBadge
      status={info.status}
      label={info.badge}
      title={`Mechanical path — ${info.uses.join('; ')}`}
      testId={`${testIdPrefix}-mech-skill-${info.id}`}
    />
  );
}

export function SpellMechanicalBadge({
  spellId,
  testIdPrefix,
}: {
  spellId: string;
  testIdPrefix: string;
}) {
  const info = getSpellMechanicalInfo(spellId);
  return (
    <MechanicalStatusBadge
      status={info.status}
      label={info.badge}
      title={`Mechanical path — ${info.detail}`}
      testId={`${testIdPrefix}-mech-spell-${info.id}`}
    />
  );
}

export function PartyCoverageHintsList({ hints }: { hints: PartyCoverageHint[] }) {
  if (hints.length === 0) {
    return (
      <div
        data-testid="party-coverage-hints-empty"
        className="text-xs text-emerald-300"
      >
        Full tabletop coverage — every gate, verb, and recall lens has a proficient hero or a magic bypass.
      </div>
    );
  }
  return (
    <ul data-testid="party-coverage-hints" className="space-y-1.5">
      {hints.map((hint) => (
        <li
          key={hint.id}
          data-testid={`party-coverage-hint-${hint.id}`}
          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            hint.severity === 'missing'
              ? 'border-amber-700/60 bg-amber-950/20 text-amber-200'
              : 'border-slate-700 bg-slate-950/60 text-slate-300'
          }`}
        >
          <span className="font-semibold">
            {hint.severity === 'missing' ? 'Missing coverage: ' : 'Suggestion: '}
          </span>
          {hint.message}{' '}
          <span className="text-slate-400">{hint.remedy}</span>
        </li>
      ))}
    </ul>
  );
}

export function RelevanceMatrixTable() {
  return (
    <div data-testid="relevance-matrix" className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1 pr-2 font-medium">Skill</th>
            <th className="py-1 font-medium">Exercised by shipped content</th>
          </tr>
        </thead>
        <tbody>
          {RELEVANCE_MATRIX.map((row) => (
            <tr
              key={row.skill}
              data-testid={`relevance-matrix-row-${row.skill}`}
              className="border-t border-slate-800/60"
            >
              <td className="py-1 pr-2 text-slate-200 font-medium whitespace-nowrap">
                {row.skill}
              </td>
              <td className="py-1 text-slate-400">{row.exercisedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
