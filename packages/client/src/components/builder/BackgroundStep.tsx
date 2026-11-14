import {
  type CharacterBuildState,
  SKILL_IDS,
  type SkillId,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  applyDuplicateProficiencyReplacement,
} from '@srd5/engine';
import { formatTitleCase } from '../compendium/formatters.js';
import { ChoiceSpecSelector } from './ChoiceSpecSelector.js';
import {
  pruneStaleDuplicateReplacements,
  validateBackgroundStep,
} from './builderState.js';

export interface BackgroundStepProps {
  buildState: CharacterBuildState;
  onChange: (updater: (prev: CharacterBuildState) => CharacterBuildState) => void;
  compendium?: SrdCompendium;
}

export function BackgroundStep({
  buildState,
  onChange,
  compendium = defaultCompendium,
}: BackgroundStepProps) {
  const isCustom =
    buildState.customBackground !== undefined || buildState.backgroundId === 'custom';
  const acolyteBg = compendium.getBackground('acolyte');
  const bgValidation = validateBackgroundStep(buildState, compendium);

  const handleSelectMode = (mode: 'acolyte' | 'custom') => {
    onChange((prev) => {
      if (mode === 'acolyte') {
        const next: CharacterBuildState = {
          ...prev,
          backgroundId: 'acolyte',
          customBackground: undefined,
          backgroundChoices: {
            'acolyte-languages':
              prev.backgroundChoices['acolyte-languages'] ?? ['elvish', 'draconic'],
          },
        };
        return pruneStaleDuplicateReplacements(next, compendium);
      }

      const defaultCustom = prev.customBackground ?? {
        name: 'Outlander Scout',
        skillProficiencies: ['athletics', 'survival'] as [SkillId, SkillId],
        toolProficiencies: [],
        languages: ['elvish', 'dwarvish'],
      };

      const next: CharacterBuildState = {
        ...prev,
        backgroundId: 'custom',
        customBackground: defaultCustom,
        backgroundChoices: {},
      };
      return pruneStaleDuplicateReplacements(next, compendium);
    });
  };

  const handleAcolyteChoiceChange = (choiceId: string, selected: string[]) => {
    onChange((prev) => {
      const next: CharacterBuildState = {
        ...prev,
        backgroundChoices: {
          ...prev.backgroundChoices,
          [choiceId]: selected,
        },
      };
      return pruneStaleDuplicateReplacements(next, compendium);
    });
  };

  const handleCustomSkillChange = (slotIndex: 0 | 1, skillId: SkillId) => {
    onChange((prev) => {
      if (!prev.customBackground) return prev;
      const nextSkills: [SkillId, SkillId] = [
        ...prev.customBackground.skillProficiencies,
      ];
      nextSkills[slotIndex] = skillId;
      const next: CharacterBuildState = {
        ...prev,
        customBackground: {
          ...prev.customBackground,
          skillProficiencies: nextSkills,
        },
      };
      return pruneStaleDuplicateReplacements(next, compendium);
    });
  };

  const handleCustomNameChange = (name: string) => {
    onChange((prev) => {
      if (!prev.customBackground) return prev;
      return {
        ...prev,
        customBackground: {
          ...prev.customBackground,
          name,
        },
      };
    });
  };

  const handleCustomLanguageToggle = (langId: string) => {
    onChange((prev) => {
      if (!prev.customBackground) return prev;
      const currentLangs = prev.customBackground.languages;
      const currentTools = prev.customBackground.toolProficiencies;
      const exists = currentLangs.includes(langId);
      let nextLangs = currentLangs;

      if (exists) {
        nextLangs = currentLangs.filter((id) => id !== langId);
      } else if (currentLangs.length + currentTools.length < 2) {
        nextLangs = [...currentLangs, langId];
      }

      const next: CharacterBuildState = {
        ...prev,
        customBackground: {
          ...prev.customBackground,
          languages: nextLangs,
        },
      };
      return pruneStaleDuplicateReplacements(next, compendium);
    });
  };

  const handleCustomToolToggle = (toolId: string) => {
    onChange((prev) => {
      if (!prev.customBackground) return prev;
      const currentLangs = prev.customBackground.languages;
      const currentTools = prev.customBackground.toolProficiencies;
      const exists = currentTools.includes(toolId);
      let nextTools = currentTools;

      if (exists) {
        nextTools = currentTools.filter((id) => id !== toolId);
      } else if (currentLangs.length + currentTools.length < 2) {
        nextTools = [...currentTools, toolId];
      }

      const next: CharacterBuildState = {
        ...prev,
        customBackground: {
          ...prev.customBackground,
          toolProficiencies: nextTools,
        },
      };
      return pruneStaleDuplicateReplacements(next, compendium);
    });
  };

  return (
    <div data-testid="builder-step-background" className="space-y-6">
      {/* Background Mode Selector */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-amber-300">
              Select Character Background
            </h3>
            <p className="text-xs text-slate-400">
              Choose the SRD 5.1 Acolyte background or build a Custom SRD Background.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              data-testid="builder-bg-mode-acolyte"
              aria-pressed={!isCustom}
              onClick={() => handleSelectMode('acolyte')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                !isCustom
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Acolyte (SRD Standard)
            </button>
            <button
              type="button"
              data-testid="builder-bg-mode-custom"
              aria-pressed={isCustom}
              onClick={() => handleSelectMode('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isCustom
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Custom SRD Background
            </button>
          </div>
        </div>

        {!isCustom && acolyteBg && (
          <div
            data-testid="builder-bg-acolyte-panel"
            className="space-y-4 pt-2 border-t border-slate-800"
          >
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-100">
                  {acolyteBg.name}
                </h4>
                <span className="text-xs text-amber-300">
                  Skills:{' '}
                  {acolyteBg.skillProficiencies.map(formatTitleCase).join(', ')}
                </span>
              </div>
              <p className="text-xs text-slate-400">{acolyteBg.description}</p>
              <div className="text-xs text-slate-300 pt-1">
                <strong className="text-amber-300">
                  Feature — {acolyteBg.feature.name}:
                </strong>{' '}
                {acolyteBg.feature.description}
              </div>
            </div>

            {acolyteBg.choices.map((choice) => (
              <ChoiceSpecSelector
                key={choice.id}
                choice={choice}
                selected={buildState.backgroundChoices[choice.id] ?? []}
                onChange={(next) => handleAcolyteChoiceChange(choice.id, next)}
                compendium={compendium}
                testIdPrefix="bg-choice"
              />
            ))}
          </div>
        )}

        {isCustom && buildState.customBackground && (
          <div
            data-testid="builder-bg-custom-panel"
            className="space-y-4 pt-2 border-t border-slate-800"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="builder-custom-bg-name"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Background Name
                </label>
                <input
                  id="builder-custom-bg-name"
                  data-testid="builder-custom-bg-name"
                  type="text"
                  value={buildState.customBackground.name}
                  onChange={(e) => handleCustomNameChange(e.target.value)}
                  className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="builder-custom-bg-skill-0"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Skill Proficiency 1
                </label>
                <select
                  id="builder-custom-bg-skill-0"
                  data-testid="builder-custom-bg-skill-0"
                  value={buildState.customBackground.skillProficiencies[0]}
                  onChange={(e) =>
                    handleCustomSkillChange(0, e.target.value as SkillId)
                  }
                  className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                >
                  {SKILL_IDS.map((sk) => (
                    <option key={sk} value={sk}>
                      {formatTitleCase(sk)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="builder-custom-bg-skill-1"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Skill Proficiency 2
                </label>
                <select
                  id="builder-custom-bg-skill-1"
                  data-testid="builder-custom-bg-skill-1"
                  value={buildState.customBackground.skillProficiencies[1]}
                  onChange={(e) =>
                    handleCustomSkillChange(1, e.target.value as SkillId)
                  }
                  className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                >
                  {SKILL_IDS.map((sk) => (
                    <option key={sk} value={sk}>
                      {formatTitleCase(sk)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 2 Combined Languages or Tools */}
            <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">
                    Choose 2 Combined Languages or Tool Proficiencies
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    SRD Custom Backgrounds grant any combination of 2 languages and/or tool proficiencies.
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs text-amber-300">
                  {buildState.customBackground.languages.length +
                    buildState.customBackground.toolProficiencies.length}{' '}
                  / 2 Selected
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400">
                  Languages:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {compendium.languages.map((lang) => {
                    const selected =
                      buildState.customBackground?.languages.includes(lang.id) ??
                      false;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        data-testid={`builder-custom-bg-lang-${lang.id}`}
                        aria-pressed={selected}
                        onClick={() => handleCustomLanguageToggle(lang.id)}
                        className={`px-2.5 py-1 rounded border text-xs ${
                          selected
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {lang.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400">
                  Tools:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {compendium.tools.slice(0, 12).map((tool) => {
                    const selected =
                      buildState.customBackground?.toolProficiencies.includes(
                        tool.id,
                      ) ?? false;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        data-testid={`builder-custom-bg-tool-${tool.id}`}
                        aria-pressed={selected}
                        onClick={() => handleCustomToolToggle(tool.id)}
                        className={`px-2.5 py-1 rounded border text-xs ${
                          selected
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {tool.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* SRD Duplicate Proficiency Replacement Prompts */}
      {bgValidation.duplicateProficiencies.length > 0 && (
        <section
          data-testid="builder-duplicate-proficiencies-section"
          className="rounded-xl border border-amber-700/60 bg-amber-950/20 p-4 space-y-4"
        >
          <div>
            <h3 className="text-sm font-semibold text-amber-300">
              SRD 5.1 Duplicate Proficiency Replacement Rule
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Your character received the same proficiency from multiple sources.
              Choose a replacement proficiency of the same category below:
            </p>
          </div>

          <div className="space-y-3">
            {bgValidation.duplicateProficiencies.map((collision) => {
              const selectedSet = new Set(collision.selectedReplacements);
              // Include both currently available options and already-selected replacements for this collision
              const displayOptions = Array.from(
                new Set([
                  ...collision.selectedReplacements,
                  ...collision.availableReplacementOptions,
                ]),
              );

              const handleSelectReplacement = (repId: string) => {
                let nextReps: string[];
                if (selectedSet.has(repId)) {
                  nextReps = collision.selectedReplacements.filter(
                    (id) => id !== repId,
                  );
                } else if (collision.duplicateCount === 1) {
                  nextReps = [repId];
                } else if (
                  collision.selectedReplacements.length < collision.duplicateCount
                ) {
                  nextReps = [...collision.selectedReplacements, repId];
                } else {
                  return;
                }

                onChange((prev) =>
                  applyDuplicateProficiencyReplacement(
                    prev,
                    collision.category,
                    collision.proficiencyId,
                    nextReps,
                  ),
                );
              };

              return (
                <div
                  key={collision.replacementChoiceId}
                  data-testid={`builder-duplicate-card-${collision.category}-${collision.proficiencyId}`}
                  className="rounded-lg bg-slate-950/90 border border-slate-800 p-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-amber-200">
                        {collision.replacementChoiceSpec.label}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Sources:{' '}
                        {collision.grants.map((g) => g.sourceName).join(' + ')}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium border ${
                        collision.resolved
                          ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                          : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                      }`}
                    >
                      {collision.selectedReplacements.length} /{' '}
                      {collision.duplicateCount} Replaced
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {displayOptions.map((optId) => {
                      const isPicked = selectedSet.has(optId);
                      return (
                        <button
                          key={optId}
                          type="button"
                          data-testid={`builder-duplicate-option-${collision.category}-${collision.proficiencyId}-${optId}`}
                          aria-pressed={isPicked}
                          onClick={() => handleSelectReplacement(optId)}
                          className={`px-2.5 py-1 rounded border text-xs transition-colors ${
                            isPicked
                              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-medium'
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {formatTitleCase(optId)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
