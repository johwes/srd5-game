import { useState } from 'react';
import {
  ABILITY_IDS,
  type AbilityId,
  type CharacterBuildState,
  type FeatData,
  type SrdCompendium,
  defaultCompendium,
  screenHomebrewRecord,
} from '@srd5/data';
import {
  type AsiOrFeatSelection,
  evaluateFeatEligibility,
} from '@srd5/engine';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatTitleCase,
} from '../compendium/formatters.js';
import { SkillTooltipCard } from '../compendium/SkillTooltipCard.js';
import { getSkillMechanicalInfo } from './relevance.js';
import { ChoiceSpecSelector } from './ChoiceSpecSelector.js';
import {
  buildDefaultHpRollsForClass,
  getBuilderClassProgressionPrompts,
} from './builderState.js';

export interface ClassStepProps {
  buildState: CharacterBuildState;
  onChange: (updater: (prev: CharacterBuildState) => CharacterBuildState) => void;
  compendium?: SrdCompendium;
}

export function ClassStep({
  buildState,
  onChange,
  compendium = defaultCompendium,
}: ClassStepProps) {
  const primaryEntry = buildState.classes[0] ?? {
    classId: 'fighter',
    level: 1,
    hpRollsByLevel: [10],
    choiceSelectionsByLevel: {},
    asiOrFeatByLevel: {},
  };

  const prompts = getBuilderClassProgressionPrompts(buildState, compendium);
  const { classData, subclassRequired, choiceItems, expertisePrompts, unlockedAsiLevels } =
    prompts;

  const availableSubclasses = classData
    ? compendium.getSubclassesForClass(classData.id)
    : [];

  const featEligibilityList =
    unlockedAsiLevels.length > 0
      ? evaluateFeatEligibility(buildState, primaryEntry.level, compendium)
      : [];

  const [isAuthoringCustomFeat, setIsAuthoringCustomFeat] = useState(false);
  const [customFeatName, setCustomFeatName] = useState('');
  const [customFeatDesc, setCustomFeatDesc] = useState('');
  const [customFeatModType, setCustomFeatModType] = useState<
    'ac' | 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | 'speed'
  >('ac');
  const [customFeatPrereqAbility, setCustomFeatPrereqAbility] = useState<AbilityId | 'none'>('none');
  const [customFeatPrereqMin, setCustomFeatPrereqMin] = useState(13);
  const [customFeatHumanReviewed, setCustomFeatHumanReviewed] = useState(false);

  const handleSelectClass = (newClassId: string) => {
    const nextClassData = compendium.getClass(newClassId);
    if (!nextClassData) return;

    onChange((prev) => {
      const currentEntry = prev.classes[0];
      if (currentEntry?.classId === newClassId) return prev;
      const lvl = currentEntry?.level ?? 1;

      // Auto-select the first SRD subclass if the class requires a subclass at `lvl` and only has 1 SRD subclass, or leave undefined for explicit selection
      const nextEntry = {
        classId: newClassId,
        level: lvl,
        hpRollsByLevel: buildDefaultHpRollsForClass(nextClassData, lvl),
        choiceSelectionsByLevel: {},
        asiOrFeatByLevel: {},
      };

      return {
        ...prev,
        classes: [nextEntry],
        spellcasting: {
          knownCantripIds: [],
          knownSpellIds: [],
          spellbookSpellIds: [],
          preparedSpellIds: [],
        },
      };
    });
  };

  const handleLevelChange = (newLevel: number) => {
    const safeLevel = Math.min(20, Math.max(1, Math.floor(newLevel)));
    onChange((prev) => {
      const entry = prev.classes[0];
      if (!entry) return prev;
      const cls = compendium.getClass(entry.classId);
      if (!cls) return prev;

      const cleanedChoicesByLevel: Record<number, Record<string, string[]>> = {};
      for (const [lvlKey, map] of Object.entries(entry.choiceSelectionsByLevel)) {
        const lvl = Number(lvlKey);
        if (lvl <= safeLevel) {
          cleanedChoicesByLevel[lvl] = map;
        }
      }

      const cleanedAsiByLevel: Record<number, AsiOrFeatSelection> = {};
      for (const [lvlKey, sel] of Object.entries(entry.asiOrFeatByLevel)) {
        const lvl = Number(lvlKey);
        if (lvl <= safeLevel) {
          cleanedAsiByLevel[lvl] = sel;
        }
      }

      const nextSubclassId =
        safeLevel >= cls.subclassLevel ? entry.subclassId : undefined;

      return {
        ...prev,
        classes: [
          {
            ...entry,
            level: safeLevel,
            ...(nextSubclassId ? { subclassId: nextSubclassId } : {}),
            hpRollsByLevel: buildDefaultHpRollsForClass(
              cls,
              safeLevel,
              entry.hpRollsByLevel,
            ),
            choiceSelectionsByLevel: cleanedChoicesByLevel,
            asiOrFeatByLevel: cleanedAsiByLevel,
          },
        ],
      };
    });
  };

  const handleSelectSubclass = (subclassId: string) => {
    onChange((prev) => {
      const entry = prev.classes[0];
      if (!entry) return prev;
      return {
        ...prev,
        classes: [
          {
            ...entry,
            subclassId,
          },
        ],
      };
    });
  };

  const handleChoiceSelectionChange = (
    level: number,
    choiceId: string,
    selected: string[],
  ) => {
    onChange((prev) => {
      const entry = prev.classes[0];
      if (!entry) return prev;
      const prevAtLvl = entry.choiceSelectionsByLevel[level] ?? {};
      return {
        ...prev,
        classes: [
          {
            ...entry,
            choiceSelectionsByLevel: {
              ...entry.choiceSelectionsByLevel,
              [level]: {
                ...prevAtLvl,
                [choiceId]: selected,
              },
            },
          },
        ],
      };
    });
  };

  const handleAsiOrFeatChange = (level: number, selection: AsiOrFeatSelection) => {
    onChange((prev) => {
      const entry = prev.classes[0];
      if (!entry) return prev;
      return {
        ...prev,
        classes: [
          {
            ...entry,
            asiOrFeatByLevel: {
              ...entry.asiOrFeatByLevel,
              [level]: selection,
            },
          },
        ],
      };
    });
  };

  return (
    <div data-testid="builder-step-class" className="space-y-6">
      {/* Starting Level & Class Selector Header */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <h3 className="text-base font-semibold text-amber-300">
            Select Class & Starting Level
          </h3>
          <p className="text-xs text-slate-400">
            Choose one of the 12 SRD 5.1 classes and configure starting level (1–20).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label
            htmlFor="builder-class-level-select"
            className="text-xs font-medium text-slate-300"
          >
            Starting Level:
          </label>
          <select
            id="builder-class-level-select"
            aria-label="Starting character level"
            data-testid="builder-class-level-select"
            value={primaryEntry.level}
            onChange={(e) => handleLevelChange(Number(e.target.value))}
            className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-amber-300 font-semibold focus:outline-none focus:border-amber-400"
          >
            {Array.from({ length: 20 }, (_, i) => i + 1).map((lvl) => (
              <option key={lvl} value={lvl}>
                Level {lvl}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 12 Classes Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {compendium.classes.map((cls) => {
          const isSelected = primaryEntry.classId === cls.id;
          return (
            <button
              key={cls.id}
              type="button"
              data-testid={`builder-class-card-${cls.id}`}
              aria-pressed={isSelected}
              onClick={() => handleSelectClass(cls.id)}
              className={`text-left p-3.5 rounded-lg border transition-all flex flex-col justify-between gap-2 ${
                isSelected
                  ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm text-slate-100">
                    {cls.name}
                  </div>
                  <div className="text-xs text-amber-300/90 mt-0.5">
                    Primary:{' '}
                    {cls.primaryAbilities.map(formatAbilityAbbrev).join(' / ')}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-xs font-mono text-amber-300">
                  d{cls.hitDie}
                </span>
              </div>

              <div className="text-xs text-slate-400">
                Saves:{' '}
                <span className="text-slate-300">
                  {cls.savingThrowProficiencies
                    .map(formatAbilityAbbrev)
                    .join(', ')}
                </span>
              </div>

              <div className="flex flex-wrap gap-1 pt-1">
                {cls.spellcasting && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-800/60 text-purple-300">
                    {formatTitleCase(cls.spellcasting.progression)} Caster (
                    {formatAbilityAbbrev(cls.spellcasting.ability)})
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  {cls.subclassTitle} at L{cls.subclassLevel}
                </span>
              </div>
            </button>
          );
        })}
      </section>

      {/* Subclass Selection (when level >= classData.subclassLevel) */}
      {classData && subclassRequired && (
        <section
          data-testid="builder-subclass-section"
          className="rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-indigo-300">
                Select {classData.name} {classData.subclassTitle} (Required at Level{' '}
                {classData.subclassLevel})
              </h3>
              <p className="text-xs text-slate-400">
                Choose your SRD 5.1 {classData.subclassTitle} specialization.
              </p>
            </div>
            <span
              data-testid="builder-subclass-status"
              className={`px-2 py-0.5 rounded text-xs font-medium border ${
                primaryEntry.subclassId
                  ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
              }`}
            >
              {primaryEntry.subclassId
                ? (compendium.getSubclass(primaryEntry.subclassId)?.name ??
                  primaryEntry.subclassId)
                : 'Selection Required'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availableSubclasses.map((sc) => {
              const isSelected = primaryEntry.subclassId === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  data-testid={`builder-subclass-card-${sc.id}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectSubclass(sc.id)}
                  className={`text-left p-3.5 rounded-lg border transition-all space-y-1.5 ${
                    isSelected
                      ? 'bg-indigo-500/20 border-indigo-400 text-slate-100'
                      : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{sc.name}</span>
                    <span className="text-xs text-indigo-300">
                      {classData.subclassTitle}
                    </span>
                  </div>
                  {sc.description && (
                    <p className="text-xs text-slate-400">{sc.description}</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Class Skill, Tool & Feature Choices */}
      {choiceItems.length > 0 && (
        <section
          data-testid="builder-class-choices-section"
          className="space-y-3"
        >
          <h3 className="text-sm font-semibold text-amber-300">
            Class Skills & Feature Choices
          </h3>
          <div className="space-y-3">
            {choiceItems.map((item) => {
              const lvlSelections =
                primaryEntry.choiceSelectionsByLevel[item.level] ?? {};
              return (
                <div key={`${item.level}-${item.choice.id}`} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-medium">
                      Level {item.level}
                    </span>
                    <span>{item.originName}</span>
                  </div>
                  <ChoiceSpecSelector
                    choice={item.choice}
                    selected={lvlSelections[item.choice.id] ?? []}
                    onChange={(next) =>
                      handleChoiceSelectionChange(item.level, item.choice.id, next)
                    }
                    compendium={compendium}
                    testIdPrefix={`class-choice-l${item.level}`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Rogue / Bard Expertise Prompts */}
      {expertisePrompts.length > 0 && (
        <section
          data-testid="builder-expertise-section"
          className="space-y-3"
        >
          <h3 className="text-sm font-semibold text-amber-300">
            Expertise Selections (Double Proficiency Bonus)
          </h3>
          {expertisePrompts.map((prompt) => {
            const selectedSet = new Set(prompt.selectedOptions);
            const isComplete = prompt.selectedOptions.length === prompt.count;

            const toggleExpertise = (profId: string) => {
              if (selectedSet.has(profId)) {
                handleChoiceSelectionChange(
                  prompt.level,
                  prompt.choiceKey,
                  prompt.selectedOptions.filter((id) => id !== profId),
                );
              } else if (prompt.selectedOptions.length < prompt.count) {
                handleChoiceSelectionChange(prompt.level, prompt.choiceKey, [
                  ...prompt.selectedOptions,
                  profId,
                ]);
              }
            };

            return (
              <div
                key={`${prompt.level}-${prompt.choiceKey}`}
                data-testid={`builder-expertise-l${prompt.level}`}
                className="rounded-lg border border-slate-800 bg-slate-900/70 p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">
                      {prompt.label}
                    </h4>
                    <p className="text-xs text-slate-400">
                      Select {prompt.count} proficient skills
                      {prompt.choiceKey === 'expertise-rogue'
                        ? " (or thieves' tools)"
                        : ''}
                      .
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${
                      isComplete
                        ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                        : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                    }`}
                  >
                    {prompt.selectedOptions.length} / {prompt.count} Selected
                  </span>
                </div>

                {prompt.eligibleOptions.length === 0 ? (
                  <p className="text-xs text-amber-300">
                    Select your skill proficiencies above first to unlock Expertise options.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {prompt.eligibleOptions.map((optId) => {
                      const isSelected = selectedSet.has(optId);
                      const isDisabled =
                        !isSelected && prompt.selectedOptions.length >= prompt.count;
                      // SRD-1215: skill-benefit hover tooltip (SRD description +
                      // game-use relevance). Non-skill options (e.g. thieves'
                      // tools) render without a tooltip.
                      const skillDef = compendium.getSkill(optId);
                      const skillMech = skillDef
                        ? getSkillMechanicalInfo(optId)
                        : null;
                      const skillTipId = `builder-expertise-tooltip-l${prompt.level}-${optId}`;
                      return (
                        <div
                          key={optId}
                          className={skillDef ? 'relative group' : 'contents'}
                        >
                        <button
                          type="button"
                          disabled={isDisabled}
                          data-testid={`builder-expertise-option-l${prompt.level}-${optId}`}
                          aria-pressed={isSelected}
                          aria-describedby={skillDef ? skillTipId : undefined}
                          onClick={() => toggleExpertise(optId)}
                          className={`px-3 py-2 rounded-md border text-xs text-left transition-colors ${skillDef ? 'w-full' : ''} ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500 text-amber-200 font-medium'
                              : isDisabled
                                ? 'bg-slate-950/50 border-slate-800/60 text-slate-600 cursor-not-allowed'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {formatTitleCase(optId)}
                        </button>
                        {skillDef && skillMech && (
                          <SkillTooltipCard
                            name={formatTitleCase(optId)}
                            abilityLabel={`${formatAbilityFullName(skillDef.ability)} (${formatAbilityAbbrev(skillDef.ability)})`}
                            description={skillDef.description}
                            badge={skillMech.badge}
                            uses={skillMech.uses}
                            extraLine="Expertise doubles your proficiency bonus for this skill."
                            testId={skillTipId}
                          />
                        )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Unlocked ASI / Feat Prompts (for Level 4+ starting builds) */}
      {unlockedAsiLevels.length > 0 && (
        <section data-testid="builder-asi-section" className="space-y-3">
          <h3 className="text-sm font-semibold text-amber-300">
            Ability Score Improvements (ASI) & Feats
          </h3>
          <div className="space-y-3">
            {unlockedAsiLevels.map((asiLvl) => {
              const currentSel = primaryEntry.asiOrFeatByLevel[asiLvl];
              const mode = currentSel?.type ?? 'asi';

              return (
                <div
                  key={asiLvl}
                  data-testid={`builder-asi-card-l${asiLvl}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-200">
                        Level {asiLvl} Ability Score Improvement or Feat
                      </h4>
                      <p className="text-xs text-slate-400">
                        Gain +2 to one ability, +1 to two abilities, or select an SRD Feat.
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        data-testid={`builder-asi-mode-asi-l${asiLvl}`}
                        onClick={() =>
                          handleAsiOrFeatChange(asiLvl, {
                            type: 'asi',
                            bonuses: { str: 2 },
                          })
                        }
                        className={`px-2.5 py-1 rounded text-xs font-medium border ${
                          mode === 'asi' && currentSel
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        +2 ASI
                      </button>
                      <button
                        type="button"
                        data-testid={`builder-asi-mode-feat-l${asiLvl}`}
                        onClick={() => {
                          const firstEligible =
                            featEligibilityList.find((f) => f.eligible)?.feat.id ??
                            compendium.feats[0]?.id ??
                            'grappler';
                          handleAsiOrFeatChange(asiLvl, {
                            type: 'feat',
                            featId: firstEligible,
                          });
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-medium border ${
                          mode === 'feat'
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Feat
                      </button>
                    </div>
                  </div>

                  {mode === 'asi' ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-slate-400">
                        Quick ASI (+2):
                      </span>
                      {ABILITY_IDS.map((ab: AbilityId) => {
                        const isPicked =
                          currentSel?.type === 'asi' &&
                          currentSel.bonuses[ab] === 2;
                        return (
                          <button
                            key={ab}
                            type="button"
                            data-testid={`builder-asi-plus2-l${asiLvl}-${ab}`}
                            onClick={() =>
                              handleAsiOrFeatChange(asiLvl, {
                                type: 'asi',
                                bonuses: { [ab]: 2 },
                              })
                            }
                            className={`px-2.5 py-1 rounded border text-xs font-medium ${
                              isPicked
                                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            +2 {formatAbilityAbbrev(ab)}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Select feat for level ${asiLvl}`}
                          data-testid={`builder-feat-select-l${asiLvl}`}
                          value={currentSel?.type === 'feat' ? currentSel.featId : ''}
                          onChange={(e) =>
                            handleAsiOrFeatChange(asiLvl, {
                              type: 'feat',
                              featId: e.target.value,
                            })
                          }
                          className="w-full sm:w-auto rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                        >
                          {featEligibilityList.map((info) => (
                            <option
                              key={info.feat.id}
                              value={info.feat.id}
                              disabled={!info.eligible && currentSel?.type === 'feat' && currentSel.featId !== info.feat.id}
                            >
                              {info.feat.name}{' '}
                              {!info.eligible
                                ? `(${info.unmetPrerequisites.join('; ')})`
                                : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          data-testid={`builder-feat-author-custom-toggle-l${asiLvl}`}
                          onClick={() => setIsAuthoringCustomFeat(!isAuthoringCustomFeat)}
                          className="px-2.5 py-1 rounded border text-xs font-medium bg-amber-500/10 border-amber-500/40 text-amber-200 hover:bg-amber-500/20"
                        >
                          {isAuthoringCustomFeat ? 'Cancel Custom Feat' : '+ Author Custom Feat'}
                        </button>
                      </div>

                      {/* Custom Feat Authoring Form */}
                      {isAuthoringCustomFeat && (
                        <div
                          data-testid={`builder-custom-feat-form-l${asiLvl}`}
                          className="rounded-lg bg-slate-950/80 border border-amber-500/40 p-3 space-y-3 mt-2"
                        >
                          <div className="text-xs font-semibold text-amber-300">
                            Author Original Homebrew Feat (SRD 5.1 Ruleset)
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label
                                htmlFor="builder-custom-feat-name"
                                className="block text-xs font-medium text-slate-300 mb-1"
                              >
                                Feat Name
                              </label>
                              <input
                                id="builder-custom-feat-name"
                                data-testid="builder-custom-feat-name"
                                type="text"
                                value={customFeatName}
                                onChange={(e) => setCustomFeatName(e.target.value)}
                                placeholder="e.g. Ironclad Sentinel"
                                className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="builder-custom-feat-mod-type"
                                className="block text-xs font-medium text-slate-300 mb-1"
                              >
                                Feat Benefit / Modifier
                              </label>
                              <select
                                id="builder-custom-feat-mod-type"
                                data-testid="builder-custom-feat-mod-type"
                                value={customFeatModType}
                                onChange={(e) => setCustomFeatModType(e.target.value as any)}
                                className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                              >
                                <option value="ac">+1 Armor Class (AC)</option>
                                <option value="str">+1 Strength (STR)</option>
                                <option value="dex">+1 Dexterity (DEX)</option>
                                <option value="con">+1 Constitution (CON)</option>
                                <option value="int">+1 Intelligence (INT)</option>
                                <option value="wis">+1 Wisdom (WIS)</option>
                                <option value="cha">+1 Charisma (CHA)</option>
                                <option value="speed">+10 ft Movement Speed</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label
                              htmlFor="builder-custom-feat-desc"
                              className="block text-xs font-medium text-slate-300 mb-1"
                            >
                              Feat Description
                            </label>
                            <textarea
                              id="builder-custom-feat-desc"
                              data-testid="builder-custom-feat-desc"
                              rows={2}
                              value={customFeatDesc}
                              onChange={(e) => setCustomFeatDesc(e.target.value)}
                              placeholder="Original mechanical description of the feat..."
                              className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label
                                htmlFor="builder-custom-feat-prereq-ability"
                                className="block text-xs font-medium text-slate-300 mb-1"
                              >
                                Prerequisite Ability (Optional)
                              </label>
                              <select
                                id="builder-custom-feat-prereq-ability"
                                data-testid="builder-custom-feat-prereq-ability"
                                value={customFeatPrereqAbility}
                                onChange={(e) => setCustomFeatPrereqAbility(e.target.value as any)}
                                className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                              >
                                <option value="none">None</option>
                                {ABILITY_IDS.map((ab) => (
                                  <option key={ab} value={ab}>
                                    {formatAbilityFullName(ab)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {customFeatPrereqAbility !== 'none' && (
                              <div>
                                <label
                                  htmlFor="builder-custom-feat-prereq-min"
                                  className="block text-xs font-medium text-slate-300 mb-1"
                                >
                                  Minimum Ability Score
                                </label>
                                <input
                                  id="builder-custom-feat-prereq-min"
                                  data-testid="builder-custom-feat-prereq-min"
                                  type="number"
                                  min={1}
                                  max={30}
                                  value={customFeatPrereqMin}
                                  onChange={(e) => setCustomFeatPrereqMin(Number(e.target.value))}
                                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
                                />
                              </div>
                            )}
                          </div>

                          {/* Live Product Identity Screening */}
                          {(() => {
                            const screenRes = screenHomebrewRecord({
                              name: customFeatName,
                              description: customFeatDesc,
                              source: 'homebrew',
                            });
                            if (screenRes.valid) return null;
                            return (
                              <div
                                data-testid="builder-custom-feat-pi-warning"
                                className="rounded bg-amber-950/70 border border-amber-600/70 p-2 text-xs text-amber-200"
                              >
                                <div className="font-semibold flex items-center gap-1">
                                  <span>⚠️</span> Product Identity Warning:
                                </div>
                                <div className="text-[11px] text-amber-300 mt-0.5">
                                  {screenRes.violations.join('; ')}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Human Review Checkbox */}
                          <label className="flex items-center gap-2 cursor-pointer pt-1">
                            <input
                              type="checkbox"
                              data-testid="builder-custom-feat-human-review"
                              checked={customFeatHumanReviewed}
                              onChange={(e) => setCustomFeatHumanReviewed(e.target.checked)}
                              className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0"
                            />
                            <span className="text-xs text-slate-300">
                              I confirm this feat is original work (no copying or close paraphrases of closed official D&D books).
                            </span>
                          </label>

                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              data-testid="builder-custom-feat-save-btn"
                              disabled={!customFeatName.trim()}
                              onClick={() => {
                                const slug =
                                  customFeatName
                                    .toLowerCase()
                                    .replace(/[^a-z0-9]+/g, '-')
                                    .replace(/^-+|-+$/g, '') || 'custom-feat';
                                const modifiers: any[] = [];
                                const abilityBonuses: any = {};
                                if (customFeatModType === 'ac') {
                                  modifiers.push({
                                    type: 'flat_bonus',
                                    target: 'ac',
                                    value: 1,
                                  });
                                } else if (customFeatModType === 'speed') {
                                  modifiers.push({
                                    type: 'flat_bonus',
                                    target: 'speed',
                                    value: 10,
                                  });
                                } else {
                                  abilityBonuses[customFeatModType] = 1;
                                }

                                const prerequisites: any[] = [];
                                if (customFeatPrereqAbility !== 'none') {
                                  prerequisites.push({
                                    type: 'ability_minimum',
                                    ability: customFeatPrereqAbility,
                                    minimum: Number(customFeatPrereqMin) || 13,
                                  });
                                }

                                const newFeat: FeatData = {
                                  id: slug,
                                  name: customFeatName.trim(),
                                  description:
                                    customFeatDesc.trim() || 'Original custom feat.',
                                  source: 'homebrew',
                                  humanReviewed: customFeatHumanReviewed,
                                  prerequisites,
                                  modifiers,
                                  ...(Object.keys(abilityBonuses).length > 0
                                    ? { abilityBonuses }
                                    : {}),
                                };

                                compendium.registerHomebrewFeat(newFeat);

                                onChange((prev) => {
                                  const entry = prev.classes[0];
                                  if (!entry) return prev;
                                  const prevCustomFeats = prev.customFeats ?? [];
                                  const nextCustomFeats = prevCustomFeats.some(
                                    (f) => f.id === newFeat.id,
                                  )
                                    ? prevCustomFeats.map((f) =>
                                        f.id === newFeat.id ? newFeat : f,
                                      )
                                    : [...prevCustomFeats, newFeat];
                                  return {
                                    ...prev,
                                    customFeats: nextCustomFeats,
                                    classes: [
                                      {
                                        ...entry,
                                        asiOrFeatByLevel: {
                                          ...entry.asiOrFeatByLevel,
                                          [asiLvl]: {
                                            type: 'feat',
                                            featId: newFeat.id,
                                          },
                                        },
                                      },
                                      ...prev.classes.slice(1),
                                    ],
                                  };
                                });

                                setIsAuthoringCustomFeat(false);
                              }}
                              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs disabled:opacity-50"
                            >
                              Save &amp; Equip Feat
                            </button>
                          </div>
                        </div>
                      )}
                      {currentSel?.type === 'feat' && (() => {
                        const featObj = compendium.getFeat(currentSel.featId);
                        if (!featObj) return null;
                        return (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-400">
                              {featObj.description}
                            </p>
                            {(featObj.choices ?? []).map((featChoice) => (
                              <ChoiceSpecSelector
                                key={featChoice.id}
                                choice={featChoice}
                                selected={currentSel.choices?.[featChoice.id] ?? []}
                                onChange={(next) =>
                                  handleAsiOrFeatChange(asiLvl, {
                                    type: 'feat',
                                    featId: currentSel.featId,
                                    choices: {
                                      ...(currentSel.choices ?? {}),
                                      [featChoice.id]: next,
                                    },
                                  })
                                }
                                compendium={compendium}
                                testIdPrefix={`feat-choice-l${asiLvl}`}
                              />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Unlocked Features Overview */}
      {classData && (
        <section
          data-testid="builder-class-features-summary"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2.5"
        >
          <h4 className="text-sm font-semibold text-slate-200">
            Unlocked {classData.name} Features (Levels 1–{primaryEntry.level})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {classData.levels
              .slice(0, primaryEntry.level)
              .flatMap((l) =>
                l.featureIds.map((fid) => ({
                  level: l.level,
                  feature: compendium.getFeature(fid),
                })),
              )
              .filter(
                (item): item is { level: number; feature: NonNullable<typeof item.feature> } =>
                  Boolean(item.feature),
              )
              .map(({ level, feature }) => (
                <div
                  key={`${level}-${feature.id}`}
                  className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300">
                      {feature.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      Level {level}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-3">
                    {feature.description}
                  </p>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
