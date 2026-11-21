import {
  ABILITY_IDS,
  ALIGNMENTS,
  type Alignment,
  SKILL_IDS,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';
import {
  type BuilderValidationMap,
  type CharacterBuilderWizardState,
  PORTRAIT_PRESETS,
} from './builderState.js';
import {
  RELEVANCE_MATRIX,
  getLanguageMechanicalInfo,
  getPartyCoverageHints,
  getSkillMechanicalInfo,
  type PartyCoverageInput,
} from './relevance.js';
import { PartyCoverageHintsList } from './MechanicalBadges.js';

export interface ReviewStepProps {
  wizard: CharacterBuilderWizardState;
  validationMap: BuilderValidationMap;
  onWizardChange: (
    updater: (prev: CharacterBuilderWizardState) => CharacterBuilderWizardState,
  ) => void;
  onFinalize: () => void;
  compendium?: SrdCompendium;
}

export function ReviewStep({
  wizard,
  validationMap,
  onWizardChange,
  onFinalize,
  compendium = defaultCompendium,
}: ReviewStepProps) {
  const { buildState } = wizard;
  const derived = computeDerivedCharacter(buildState, compendium);
  const reviewValidation = validationMap.review;

  const handleNameChange = (name: string) => {
    onWizardChange((prev) => ({
      ...prev,
      buildState: {
        ...prev.buildState,
        name,
      },
    }));
  };

  const handleAlignmentChange = (alignment: Alignment) => {
    onWizardChange((prev) => ({
      ...prev,
      buildState: {
        ...prev.buildState,
        alignment,
      },
    }));
  };

  const handlePortraitPresetChange = (portraitId: string) => {
    const preset = PORTRAIT_PRESETS.find((p) => p.portraitId === portraitId);
    if (!preset) return;
    onWizardChange((prev) => ({
      ...prev,
      buildState: {
        ...prev.buildState,
        portraitId: preset.portraitId,
        tokenSpriteId: preset.tokenSpriteId,
      },
    }));
  };

  return (
    <div data-testid="builder-step-review" className="space-y-6">
      {/* Identity & Finalization Bar */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
            <div>
              <label
                htmlFor="builder-character-name-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Character Name
              </label>
              <input
                id="builder-character-name-input"
                data-testid="builder-character-name-input"
                type="text"
                value={buildState.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Enter hero name..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label
                htmlFor="builder-alignment-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Alignment
              </label>
              <select
                id="builder-alignment-select"
                data-testid="builder-alignment-select"
                value={buildState.alignment}
                onChange={(e) =>
                  handleAlignmentChange(e.target.value as Alignment)
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-slate-100"
              >
                {ALIGNMENTS.map((align) => (
                  <option key={align} value={align}>
                    {formatTitleCase(align)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="builder-portrait-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Portrait &amp; Token Preset
              </label>
              <select
                id="builder-portrait-select"
                data-testid="builder-portrait-select"
                value={buildState.portraitId}
                onChange={(e) => handlePortraitPresetChange(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-slate-100"
              >
                {PORTRAIT_PRESETS.map((preset) => (
                  <option key={preset.portraitId} value={preset.portraitId}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            disabled={!reviewValidation.valid}
            data-testid="builder-finalize-btn"
            onClick={onFinalize}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all shrink-0 ${
              reviewValidation.valid
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            Finalize &amp; Save to Party Roster
          </button>
        </div>

        {!reviewValidation.valid && (
          <div
            data-testid="builder-review-errors"
            className="rounded-lg border border-rose-800/70 bg-rose-950/30 p-3 text-xs text-rose-200 space-y-1"
          >
            <div className="font-semibold text-rose-300">
              Resolve the following validation issues before finalizing:
            </div>
            <ul className="list-disc list-inside space-y-0.5">
              {reviewValidation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Top Combat Vitals Banner */}
      <section
        data-testid="builder-review-vitals"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        <div
          title={derived.armorClass.formulaTooltip}
          className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center"
        >
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Armor Class
          </div>
          <div
            data-testid="builder-review-ac"
            className="text-2xl font-bold font-mono text-amber-300 mt-0.5"
          >
            {derived.armorClass.totalAc}
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {derived.armorClass.selectedFormulaName}
          </div>
        </div>

        <div
          title={derived.hpBreakdown
            .map((b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`)
            .join(', ')}
          className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center"
        >
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Max Hit Points
          </div>
          <div
            data-testid="builder-review-hp"
            className="text-2xl font-bold font-mono text-emerald-300 mt-0.5"
          >
            {derived.maxHp}
          </div>
          <div className="text-[11px] text-slate-400">
            Hit Dice:{' '}
            {derived.hitDicePools
              .map((p) => `${p.total}d${p.dieSize}`)
              .join(' + ')}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Initiative
          </div>
          <div
            data-testid="builder-review-initiative"
            className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
          >
            {formatSignedNumber(derived.initiative.bonus)}
          </div>
          <div className="text-[11px] text-slate-400">
            Roll: {formatTitleCase(derived.initiative.rollMode)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Speed
          </div>
          <div
            data-testid="builder-review-speed"
            className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
          >
            {derived.speedFeet} ft
          </div>
          <div className="text-[11px] text-slate-400">
            {derived.senses.darkvisionFeet > 0
              ? `Darkvision ${derived.senses.darkvisionFeet} ft`
              : 'Normal Vision'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Proficiency
          </div>
          <div
            data-testid="builder-review-prof"
            className="text-2xl font-bold font-mono text-amber-300 mt-0.5"
          >
            {formatSignedNumber(derived.proficiencyBonus)}
          </div>
          <div className="text-[11px] text-slate-400">
            Level {derived.totalLevel}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-center">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Passive Perc.
          </div>
          <div
            data-testid="builder-review-passive-perception"
            className="text-2xl font-bold font-mono text-slate-100 mt-0.5"
          >
            {derived.passivePerception}
          </div>
          <div className="text-[11px] text-slate-400">
            Inv {derived.passiveInvestigation} &middot; Ins {derived.passiveInsight}
          </div>
        </div>
      </section>

      {/* Abilities, Saves & Weapon Attacks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Abilities & Saving Throws */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-amber-300">
            Ability Scores &amp; Saving Throws
          </h4>
          <div className="space-y-2">
            {ABILITY_IDS.map((ab) => {
              const abStat = derived.abilities[ab];
              const saveStat = derived.savingThrows[ab];
              return (
                <div
                  key={ab}
                  title={abStat.breakdown
                    .map((b) => `${b.sourceName}: ${formatSignedNumber(b.value)}`)
                    .join(', ')}
                  className="rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-amber-300 mr-1.5">
                      {formatAbilityAbbrev(ab)}
                    </span>
                    <span className="text-slate-300">
                      {formatAbilityFullName(ab)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-slate-100 font-bold">
                      {abStat.score} ({formatSignedNumber(abStat.modifier)})
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded border ${
                        saveStat.proficient
                          ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      Save {formatSignedNumber(saveStat.totalBonus)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AC Formula Breakdown Box */}
          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 space-y-1 text-xs">
            <div className="font-semibold text-slate-200">
              AC Formula Breakdown
            </div>
            <div
              data-testid="builder-review-ac-tooltip"
              className="text-slate-400 font-mono text-[11px]"
            >
              {derived.armorClass.formulaTooltip}
            </div>
          </div>
        </section>

        {/* Column 2: Skills */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-amber-300">
            Skills ({derived.proficiencies.skills.length} Proficient)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1.5 max-h-96 overflow-y-auto pr-1">
            {SKILL_IDS.map((skillId) => {
              const sk = derived.skills[skillId];
              const badge =
                sk.proficiencyLevel === 'expertise'
                  ? '★ Exp'
                  : sk.proficiencyLevel === 'proficient'
                    ? '● Prof'
                    : sk.proficiencyLevel === 'half'
                      ? '◐ Half'
                      : '';
              return (
                <div
                  key={skillId}
                  data-testid={`builder-review-skill-${skillId}`}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-950/70 border border-slate-800/80 text-xs"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-slate-200 truncate">
                      {formatTitleCase(skillId)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      ({formatAbilityAbbrev(sk.ability)})
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {badge && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300">
                        {badge}
                      </span>
                    )}
                    <span className="font-mono font-semibold text-slate-100">
                      {formatSignedNumber(sk.totalBonus)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Column 3: Weapon Attacks, Spells & Proficiencies */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-amber-300">
              Weapon Attack Profiles
            </h4>
            {derived.weaponAttacks.map((atk) => (
              <div
                key={atk.id}
                data-testid={`builder-review-attack-${atk.weaponId}`}
                className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">{atk.name}</span>
                  <span className="font-mono text-amber-300 font-bold">
                    {formatSignedNumber(atk.toHitBonus)} to hit
                  </span>
                </div>
                <div className="text-slate-300 font-mono text-[11px]">
                  Damage: {atk.damageFormula} {atk.damageType}
                  {atk.versatileDamageFormula
                    ? ` (Versatile ${atk.versatileDamageFormula})`
                    : ''}
                </div>
              </div>
            ))}
          </div>

          {derived.spellcasting.isSpellcaster && (
            <div
              data-testid="builder-review-spellcasting"
              className="space-y-2 pt-2 border-t border-slate-800"
            >
              <h4 className="text-sm font-semibold text-purple-300">
                Spellcasting Summary
              </h4>
              <div className="text-xs text-slate-300">
                Save DC:{' '}
                <strong className="text-amber-300 font-mono">
                  {derived.spellcasting.primarySpellSaveDc}
                </strong>{' '}
                &middot; Attack:{' '}
                <strong className="text-amber-300 font-mono">
                  {formatSignedNumber(
                    derived.spellcasting.primarySpellAttackBonus ?? 0,
                  )}
                </strong>
              </div>
              <div className="text-xs text-slate-400">
                Cantrips ({derived.spellcasting.cantripIds.length}):{' '}
                <span className="text-slate-200">
                  {derived.spellcasting.cantripIds
                    .map((id) => compendium.getSpell(id)?.name ?? id)
                    .join(', ') || 'None'}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Prepared/Known ({derived.spellcasting.preparedOrKnownSpellIds.length}):{' '}
                <span className="text-slate-200">
                  {derived.spellcasting.preparedOrKnownSpellIds
                    .map((id) => compendium.getSpell(id)?.name ?? id)
                    .join(', ') || 'None'}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs">
            <h4 className="text-sm font-semibold text-slate-200">
              Languages &amp; Tool Proficiencies
            </h4>
            <div className="text-slate-400">
              Languages:{' '}
              <span className="text-slate-200">
                {derived.proficiencies.languages.map(formatTitleCase).join(', ') ||
                  'None'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {derived.proficiencies.languages.map((langId) => {
                const info = getLanguageMechanicalInfo(langId, compendium);
                return (
                  <span
                    key={langId}
                    data-testid={`builder-review-lang-mech-${info.id}`}
                    title={`Mechanical path — ${info.uses.join('; ')}`}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded border font-medium bg-emerald-950/70 border-emerald-700/60 text-emerald-300"
                  >
                    <span aria-hidden="true">⚙</span>
                    {formatTitleCase(langId)}: {info.badge}
                  </span>
                );
              })}
            </div>
            <div className="text-slate-400">
              Tools:{' '}
              <span className="text-slate-200">
                {derived.proficiencies.tools.map(formatTitleCase).join(', ') ||
                  'None'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {derived.skills &&
                Object.entries(derived.skills)
                  .filter(([, sk]: [string, { proficiencyLevel?: string }]) =>
                    ['proficient', 'expertise'].includes(sk.proficiencyLevel ?? ''),
                  )
                  .slice(0, 6)
                  .map(([skillId]) => {
                    const info = getSkillMechanicalInfo(skillId);
                    return (
                      <span
                        key={skillId}
                        data-testid={`builder-review-skill-mech-${info.id}`}
                        title={`Mechanical path — ${info.uses.join('; ')}`}
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded border font-medium bg-emerald-950/70 border-emerald-700/60 text-emerald-300"
                      >
                        <span aria-hidden="true">⚙</span>
                        {formatTitleCase(skillId)}: {info.badge}
                      </span>
                    );
                  })}
            </div>
          </div>
        </section>
      </div>

      {/* SRD-1211: Tabletop coverage — party-aware hints + relevance matrix */}
      {(() => {
        const coverage: PartyCoverageInput = {
          languages: derived.proficiencies.languages,
          skillProficiencies: derived.proficiencies.skills,
          toolProficiencies: derived.proficiencies.tools,
          spellIds: [
            ...derived.spellcasting.cantripIds,
            ...derived.spellcasting.preparedOrKnownSpellIds,
          ],
        };
        const hints = getPartyCoverageHints([coverage]);
        return (
          <section
            data-testid="builder-tabletop-coverage"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
          >
            <div>
              <h4 className="text-sm font-semibold text-amber-300">
                Tabletop Coverage — No Silent Dead Picks
              </h4>
              <p className="text-xs text-slate-400">
                Every language, skill, and spell above carries a mechanical
                path (gate, verb, or executable effect). This panel flags what
                this hero alone does not cover — assemble a party so the gaps
                are covered by someone or by magic.
              </p>
            </div>
            <PartyCoverageHintsList hints={hints} />
            <details className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
              <summary
                data-testid="relevance-matrix-toggle"
                className="text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Relevance matrix — which skills the shipped content exercises
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1 pr-2 font-medium">Skill</th>
                      <th className="py-1 font-medium">Exercised by</th>
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
            </details>
          </section>
        );
      })()}
    </div>
  );
}
