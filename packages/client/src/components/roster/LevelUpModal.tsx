import { useState } from 'react';
import {
  ABILITY_IDS,
  type AbilityId,
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type AsiOrFeatSelection,
  type LevelUpRequest,
  type LevelUpSummary,
  applyLevelUp,
  checkMulticlassEligibility,
  computeDerivedCharacter,
  getLevelUpRequirements,
  validateLevelUp,
} from '@srd5/engine';
import { ChoiceSpecSelector } from '../builder/ChoiceSpecSelector.js';
import {
  formatAbilityAbbrev,
  formatAbilityFullName,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';

export interface LevelUpModalProps {
  character: CharacterBuildState;
  compendium?: SrdCompendium;
  onClose: () => void;
  onApplyLevelUp: (
    updatedCharacter: CharacterBuildState,
    summary: LevelUpSummary,
  ) => void;
}

export function LevelUpModal({
  character,
  compendium = defaultCompendium,
  onClose,
  onApplyLevelUp,
}: LevelUpModalProps) {
  const primaryClassId = character.classes[0]?.classId ?? 'fighter';
  const [targetClassId, setTargetClassId] = useState<string>(primaryClassId);
  const [hpMethod, setHpMethod] = useState<'fixed' | 'roll'>('fixed');
  const [rngSeed, setRngSeed] = useState<number>(() =>
    character.abilityRollSeed ? character.abilityRollSeed + 777 : 424242,
  );
  const [selectedSubclassId, setSelectedSubclassId] = useState<string | undefined>(
    undefined,
  );
  const [asiMode, setAsiMode] = useState<'asi' | 'feat'>('asi');
  const [asiOrFeat, setAsiOrFeat] = useState<AsiOrFeatSelection | undefined>(
    undefined,
  );
  const [choiceSelections, setChoiceSelections] = useState<
    Record<string, string[]>
  >({});
  const [addedCantripIds, setAddedCantripIds] = useState<string[]>([]);
  const [addedKnownSpellIds, setAddedKnownSpellIds] = useState<string[]>([]);
  const [addedSpellbookSpellIds, setAddedSpellbookSpellIds] = useState<string[]>([]);
  const [mysticArcanumSpellId, setMysticArcanumSpellId] = useState<
    string | undefined
  >(undefined);

  const currentDerived = computeDerivedCharacter(character, compendium);
  const existingEntry = character.classes.find((c) => c.classId === targetClassId);
  const effectiveSubclassId = existingEntry?.subclassId ?? selectedSubclassId;

  const requirements = getLevelUpRequirements(
    character,
    targetClassId,
    compendium,
    effectiveSubclassId,
  );

  // Build full LevelUpRequest for live validation
  const request: LevelUpRequest = {
    classId: targetClassId,
    ...(effectiveSubclassId ? { subclassId: effectiveSubclassId } : {}),
    hpMethod,
    ...(hpMethod === 'roll' ? { rngState: rngSeed } : {}),
    ...(Object.keys(choiceSelections).length > 0 ? { choiceSelections } : {}),
    ...(requirements.requiresAsiOrFeat && asiOrFeat ? { asiOrFeat } : {}),
    ...(requirements.spellcasting.isSpellcastingClass
      ? {
          spellcastingUpdates: {
            addedCantripIds,
            addedKnownSpellIds,
            addedSpellbookSpellIds,
            ...(mysticArcanumSpellId ? { mysticArcanumSpellId } : {}),
          },
          requireSpellSelections: true,
        }
      : {}),
  };

  const validation = validateLevelUp(character, request, compendium);

  const handleSelectTargetClass = (nextClassId: string) => {
    setTargetClassId(nextClassId);
    setSelectedSubclassId(undefined);
    setAsiOrFeat(undefined);
    setChoiceSelections({});
    setAddedCantripIds([]);
    setAddedKnownSpellIds([]);
    setAddedSpellbookSpellIds([]);
    setMysticArcanumSpellId(undefined);
  };

  const handleChoiceSelectionChange = (choiceId: string, selected: string[]) => {
    setChoiceSelections((prev) => ({
      ...prev,
      [choiceId]: selected,
    }));
  };

  const handleToggleExpertise = (optionId: string) => {
    const key = requirements.expertiseChoiceKey;
    if (!key) return;
    const current = choiceSelections[key] ?? [];
    if (current.includes(optionId)) {
      handleChoiceSelectionChange(
        key,
        current.filter((id) => id !== optionId),
      );
    } else if (current.length < 2) {
      handleChoiceSelectionChange(key, [...current, optionId]);
    }
  };

  const handleSetAsiPlus2 = (ability: AbilityId) => {
    setAsiMode('asi');
    setAsiOrFeat({
      type: 'asi',
      bonuses: { [ability]: 2 },
    });
  };

  const handleToggleAsiPlus1 = (ability: AbilityId) => {
    setAsiMode('asi');
    const currentBonuses: Partial<Record<AbilityId, 1 | 2>> =
      asiOrFeat?.type === 'asi' ? { ...asiOrFeat.bonuses } : {};

    // Clear any +2 bonus when switching to +1/+1 mode
    for (const [k, v] of Object.entries(currentBonuses)) {
      if (v === 2) {
        delete currentBonuses[k as AbilityId];
      }
    }

    if (currentBonuses[ability] === 1) {
      delete currentBonuses[ability];
    } else if (Object.keys(currentBonuses).length < 2) {
      currentBonuses[ability] = 1;
    }

    setAsiOrFeat({
      type: 'asi',
      bonuses: currentBonuses,
    });
  };

  const handleSelectFeat = (featId: string) => {
    setAsiMode('feat');
    const featData = compendium.getFeat(featId);
    const defaultChoices: Record<string, string[]> = {};
    for (const c of featData?.choices ?? []) {
      const opts = compendium.resolveChoiceOptions(c);
      if (opts[0]) {
        defaultChoices[c.id] = [opts[0]];
      }
    }
    setAsiOrFeat({
      type: 'feat',
      featId,
      ...(Object.keys(defaultChoices).length > 0 ? { choices: defaultChoices } : {}),
    });
  };

  const handleToggleAddedCantrip = (spellId: string) => {
    const reqCount = requirements.spellcasting.newCantripsRequired;
    setAddedCantripIds((prev) => {
      if (prev.includes(spellId)) {
        return prev.filter((id) => id !== spellId);
      }
      if (reqCount === 1) {
        return [spellId];
      }
      if (prev.length < reqCount) {
        return [...prev, spellId];
      }
      return prev;
    });
  };

  const handleToggleAddedKnownSpell = (spellId: string) => {
    const reqCount = requirements.spellcasting.newSpellsKnownRequired;
    setAddedKnownSpellIds((prev) => {
      if (prev.includes(spellId)) {
        return prev.filter((id) => id !== spellId);
      }
      if (reqCount === 1) {
        return [spellId];
      }
      if (prev.length < reqCount) {
        return [...prev, spellId];
      }
      return prev;
    });
  };

  const handleToggleAddedSpellbookSpell = (spellId: string) => {
    const reqCount = requirements.spellcasting.newSpellbookSpellsAllowed;
    setAddedSpellbookSpellIds((prev) => {
      if (prev.includes(spellId)) {
        return prev.filter((id) => id !== spellId);
      }
      if (reqCount === 1) {
        return [spellId];
      }
      if (prev.length < reqCount) {
        return [...prev, spellId];
      }
      return prev;
    });
  };

  const handleConfirmLevelUp = () => {
    if (!validation.valid) return;
    const result = applyLevelUp(character, request, compendium);
    onApplyLevelUp(result.state, result.summary);
  };

  const conMod = currentDerived.abilities.con.modifier;
  const previewHpGain = Math.max(1, validation.resolvedHpRoll + conMod);

  return (
    <div
      data-testid="level-up-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        data-testid="level-up-modal"
        role="dialog"
        aria-label={`Level Up ${character.name}`}
        className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-800 bg-slate-950 flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <header className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-amber-400">
              Level Up: {character.name} (Level {requirements.previousTotalLevel} &rarr;{' '}
              Level {requirements.targetTotalLevel})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Advancing {requirements.className} to Level {requirements.targetClassLevel}{' '}
              &middot; Proficiency Bonus:{' '}
              {formatSignedNumber(requirements.previousProficiencyBonus)} &rarr;{' '}
              <strong className="text-amber-300">
                {formatSignedNumber(requirements.newProficiencyBonus)}
              </strong>
            </p>
          </div>
          <button
            type="button"
            data-testid="level-up-close-btn"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* 1. Target Class Selection (Single-Class or Multiclass) */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-amber-300">
                  1. Select Class to Advance (Single-Class or Multiclass)
                </h3>
                <p className="text-xs text-slate-400">
                  Advance your current class or multiclass into a secondary SRD 5.1 class
                  if ability score prerequisites are met.
                </p>
              </div>
              <select
                data-testid="level-up-class-select"
                value={targetClassId}
                onChange={(e) => handleSelectTargetClass(e.target.value)}
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100"
              >
                {compendium.classes.map((cls) => {
                  const existing = character.classes.find((c) => c.classId === cls.id);
                  const mcCheck = checkMulticlassEligibility(
                    character,
                    cls.id,
                    compendium,
                  );
                  return (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}{' '}
                      {existing
                        ? `(Current L${existing.level} -> L${existing.level + 1})`
                        : mcCheck.eligible
                          ? '(New Multiclass L1 - Eligible)'
                          : '(New Multiclass L1 - Prereq Unmet)'}
                    </option>
                  );
                })}
              </select>
            </div>
          </section>

          {/* 2. Hit Point (HP) Gain */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-emerald-300">
                  2. Hit Points (d{requirements.hitDie} Hit Die)
                </h3>
                <p className="text-xs text-slate-400">
                  Choose SRD 5.1 Fixed Average ({requirements.fixedHpRoll}) or roll 1d
                  {requirements.hitDie} + CON ({formatSignedNumber(conMod)}).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="level-up-hp-method-fixed"
                  onClick={() => setHpMethod('fixed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    hpMethod === 'fixed'
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  Fixed Average ({requirements.fixedHpRoll})
                </button>
                <button
                  type="button"
                  data-testid="level-up-hp-method-roll"
                  onClick={() => setHpMethod('roll')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    hpMethod === 'roll'
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  Roll 1d{requirements.hitDie} (Rolled: {validation.resolvedHpRoll})
                </button>
                {hpMethod === 'roll' && (
                  <button
                    type="button"
                    data-testid="level-up-reroll-hp-btn"
                    onClick={() => setRngSeed((s) => s + 101)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-amber-300 hover:border-amber-500"
                  >
                    Re-Roll Seed
                  </button>
                )}
              </div>
            </div>

            <div
              data-testid="level-up-hp-preview"
              className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-mono text-slate-200 flex items-center justify-between"
            >
              <span>
                Die ({validation.resolvedHpRoll}) + CON ({formatSignedNumber(conMod)}) ={' '}
                <strong className="text-emerald-300">+{previewHpGain} HP</strong>
              </span>
              <span>
                Max HP: {currentDerived.maxHp} &rarr;{' '}
                <strong className="text-emerald-300">
                  {currentDerived.maxHp + previewHpGain}
                </strong>
              </span>
            </div>
          </section>

          {/* 3. Unlocked Class & Subclass Features Preview */}
          {(requirements.unlockedClassFeatures.length > 0 ||
            requirements.unlockedSubclassFeatures.length > 0) && (
            <section
              data-testid="level-up-unlocked-features"
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2.5"
            >
              <h3 className="text-sm font-semibold text-amber-300">
                Unlocked Features at {requirements.className} Level{' '}
                {requirements.targetClassLevel}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  ...requirements.unlockedClassFeatures,
                  ...requirements.unlockedSubclassFeatures,
                ].map((feat) => (
                  <div
                    key={feat.id}
                    data-testid={`level-up-feature-card-${feat.id}`}
                    className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-1"
                  >
                    <div className="font-semibold text-slate-100">{feat.name}</div>
                    <p className="text-[11px] text-slate-400 line-clamp-3">
                      {feat.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Subclass Selection (when unlocked at this level) */}
          {requirements.subclassUnlock.required && (
            <section
              data-testid="level-up-subclass-section"
              className="rounded-xl border border-amber-500/40 bg-slate-900/70 p-4 space-y-3"
            >
              <div>
                <h3 className="text-sm font-semibold text-amber-300">
                  Choose {requirements.subclassUnlock.subclassTitle} (Required at Level{' '}
                  {requirements.targetClassLevel})
                </h3>
                <p className="text-xs text-slate-400">
                  Select your SRD 5.1 {requirements.className}{' '}
                  {requirements.subclassUnlock.subclassTitle}.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {requirements.subclassUnlock.availableSubclasses.map((sub) => {
                  const isSelected = effectiveSubclassId === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      data-testid={`level-up-subclass-card-${sub.id}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedSubclassId(sub.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all space-y-1 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-sm">{sub.name}</div>
                      <p className="text-xs text-slate-400 line-clamp-2">
                        {sub.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 5. ASI or Feat Selection (when unlocked at this level, e.g. L4, L8, L12, L16, L19) */}
          {requirements.requiresAsiOrFeat && (
            <section
              data-testid="level-up-asi-section"
              className="rounded-xl border border-amber-500/40 bg-slate-900/70 p-4 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-amber-300">
                    Ability Score Improvement (ASI) or Feat (Level{' '}
                    {requirements.targetClassLevel})
                  </h3>
                  <p className="text-xs text-slate-400">
                    Increase one ability score by +2, two ability scores by +1 each (max
                    20), or select an eligible SRD 5.1 Feat.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="level-up-asi-mode-asi"
                    onClick={() => setAsiMode('asi')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold border ${
                      asiMode === 'asi'
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    Ability Score (+2)
                  </button>
                  <button
                    type="button"
                    data-testid="level-up-asi-mode-feat"
                    onClick={() => setAsiMode('feat')}
                    className={`px-3 py-1 rounded-md text-xs font-semibold border ${
                      asiMode === 'feat'
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    SRD 5.1 Feat
                  </button>
                </div>
              </div>

              {asiMode === 'asi' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                  {ABILITY_IDS.map((ab) => {
                    const currScore = currentDerived.abilities[ab].score;
                    const currBonus =
                      asiOrFeat?.type === 'asi' ? asiOrFeat.bonuses[ab] : undefined;
                    return (
                      <div
                        key={ab}
                        className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 space-y-2 text-center"
                      >
                        <div className="font-bold text-amber-300">
                          {formatAbilityAbbrev(ab)} ({currScore})
                        </div>
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={currScore + 2 > 20}
                            data-testid={`level-up-asi-plus2-${ab}`}
                            onClick={() => handleSetAsiPlus2(ab)}
                            className={`px-2 py-1 rounded border font-mono ${
                              currBonus === 2
                                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                                : 'bg-slate-900 border-slate-700 text-slate-300 disabled:opacity-40'
                            }`}
                          >
                            +2 {formatAbilityAbbrev(ab)}
                          </button>
                          <button
                            type="button"
                            disabled={currScore + 1 > 20}
                            data-testid={`level-up-asi-plus1-${ab}`}
                            onClick={() => handleToggleAsiPlus1(ab)}
                            className={`px-2 py-1 rounded border font-mono ${
                              currBonus === 1
                                ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                                : 'bg-slate-900 border-slate-700 text-slate-300 disabled:opacity-40'
                            }`}
                          >
                            +1 {formatAbilityAbbrev(ab)}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {requirements.availableFeats.map((fInfo) => {
                    const isSelected =
                      asiOrFeat?.type === 'feat' &&
                      asiOrFeat.featId === fInfo.feat.id;
                    return (
                      <button
                        key={fInfo.feat.id}
                        type="button"
                        disabled={!fInfo.eligible}
                        data-testid={`level-up-feat-card-${fInfo.feat.id}`}
                        onClick={() => handleSelectFeat(fInfo.feat.id)}
                        className={`text-left p-3 rounded-lg border space-y-1 ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-400 text-amber-200'
                            : !fInfo.eligible
                              ? 'bg-slate-950/50 border-slate-800/60 text-slate-500 cursor-not-allowed'
                              : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{fInfo.feat.name}</span>
                          <span className="text-[10px]">
                            {fInfo.eligible ? 'Eligible' : 'Prereq Unmet'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {fInfo.feat.description}
                        </p>
                        {!fInfo.eligible && (
                          <div className="text-[10px] text-rose-400">
                            {fInfo.unmetPrerequisites.join(' ')}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 6. Feature Choices & Expertise */}
          {(requirements.featureChoices.length > 0 ||
            requirements.requiresExpertise) && (
            <section
              data-testid="level-up-choices-section"
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4"
            >
              <h3 className="text-sm font-semibold text-amber-300">
                Class &amp; Subclass Feature Choices
              </h3>
              {requirements.featureChoices.map((choice) => (
                <ChoiceSpecSelector
                  key={choice.id}
                  choice={choice}
                  selected={choiceSelections[choice.id] ?? []}
                  onChange={(sel) => handleChoiceSelectionChange(choice.id, sel)}
                  compendium={compendium}
                  testIdPrefix="level-up-choice"
                />
              ))}

              {requirements.requiresExpertise && requirements.expertiseChoiceKey && (
                <div
                  data-testid="level-up-expertise-section"
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300">
                      Expertise: Choose 2 proficient skills to double proficiency bonus
                    </span>
                    <span className="font-mono text-slate-300">
                      {(choiceSelections[requirements.expertiseChoiceKey] ?? []).length} /
                      2 Selected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {requirements.expertiseEligibleOptions.map((optId) => {
                      const picked = (
                        choiceSelections[requirements.expertiseChoiceKey!] ?? []
                      ).includes(optId);
                      return (
                        <button
                          key={optId}
                          type="button"
                          data-testid={`level-up-expertise-option-${optId}`}
                          onClick={() => handleToggleExpertise(optId)}
                          className={`px-3 py-1.5 rounded border text-left ${
                            picked
                              ? 'bg-amber-500/15 border-amber-400 text-amber-200 font-semibold'
                              : 'bg-slate-900 border-slate-800 text-slate-300'
                          }`}
                        >
                          {formatTitleCase(optId)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 7. Spellcasting Progression */}
          {requirements.spellcasting.isSpellcastingClass && (
            <section
              data-testid="level-up-spellcasting-section"
              className="rounded-xl border border-purple-800/50 bg-slate-900/60 p-4 space-y-4"
            >
              <div>
                <h3 className="text-sm font-semibold text-purple-300">
                  Spellcasting Progression
                </h3>
                <p className="text-xs text-slate-400">
                  Max Learnable Spell Level:{' '}
                  <strong className="text-purple-200">
                    Level {requirements.spellcasting.maxLearnableSpellLevel}
                  </strong>
                </p>
              </div>

              {/* New Cantrips Picker */}
              {requirements.spellcasting.newCantripsRequired > 0 && (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300">
                      Select {requirements.spellcasting.newCantripsRequired} New Cantrip(s)
                    </span>
                    <span
                      data-testid="level-up-cantrips-counter"
                      className="font-mono text-slate-300"
                    >
                      {addedCantripIds.length} /{' '}
                      {requirements.spellcasting.newCantripsRequired} Selected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {requirements.spellcasting.allowedCantripIds.map((cId) => {
                      const sp = compendium.getSpell(cId);
                      const picked = addedCantripIds.includes(cId);
                      return (
                        <button
                          key={cId}
                          type="button"
                          data-testid={`level-up-cantrip-option-${cId}`}
                          onClick={() => handleToggleAddedCantrip(cId)}
                          className={`px-3 py-1.5 rounded border text-left truncate ${
                            picked
                              ? 'bg-purple-950/60 border-purple-400 text-purple-200 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-300'
                          }`}
                        >
                          {sp?.name ?? cId}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* New Known Spells Picker (Bard, Ranger, Sorcerer, Warlock) */}
              {requirements.spellcasting.preparationMode === 'known' &&
                requirements.spellcasting.newSpellsKnownRequired > 0 && (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-purple-300">
                        Select {requirements.spellcasting.newSpellsKnownRequired} New Known
                        Spell(s)
                      </span>
                      <span
                        data-testid="level-up-known-spells-counter"
                        className="font-mono text-slate-300"
                      >
                        {addedKnownSpellIds.length} /{' '}
                        {requirements.spellcasting.newSpellsKnownRequired} Selected
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                      {requirements.spellcasting.allowedSpellIds.map((sId) => {
                        const sp = compendium.getSpell(sId);
                        const picked = addedKnownSpellIds.includes(sId);
                        return (
                          <button
                            key={sId}
                            type="button"
                            data-testid={`level-up-known-spell-option-${sId}`}
                            onClick={() => handleToggleAddedKnownSpell(sId)}
                            className={`px-3 py-1.5 rounded border text-left truncate ${
                              picked
                                ? 'bg-purple-950/60 border-purple-400 text-purple-200 font-semibold'
                                : 'bg-slate-950 border-slate-800 text-slate-300'
                            }`}
                          >
                            {sp?.name ?? sId} (L{sp?.level ?? 1})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* New Wizard Spellbook Spells Picker (2 free spells per Wizard level) */}
              {requirements.spellcasting.preparationMode === 'spellbook' &&
                requirements.spellcasting.newSpellbookSpellsAllowed > 0 && (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-purple-300">
                        Add {requirements.spellcasting.newSpellbookSpellsAllowed} Spells to
                        Wizard Spellbook
                      </span>
                      <span
                        data-testid="level-up-spellbook-counter"
                        className="font-mono text-slate-300"
                      >
                        {addedSpellbookSpellIds.length} /{' '}
                        {requirements.spellcasting.newSpellbookSpellsAllowed} Added
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                      {requirements.spellcasting.allowedSpellIds.map((sId) => {
                        const sp = compendium.getSpell(sId);
                        const picked = addedSpellbookSpellIds.includes(sId);
                        return (
                          <button
                            key={sId}
                            type="button"
                            data-testid={`level-up-spellbook-option-${sId}`}
                            onClick={() => handleToggleAddedSpellbookSpell(sId)}
                            className={`px-3 py-1.5 rounded border text-left truncate ${
                              picked
                                ? 'bg-purple-950/60 border-purple-400 text-purple-200 font-semibold'
                                : 'bg-slate-950 border-slate-800 text-slate-300'
                            }`}
                          >
                            {sp?.name ?? sId} (L{sp?.level ?? 1})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
            </section>
          )}

          {/* Validation Errors Banner */}
          {!validation.valid && (
            <div
              data-testid="level-up-validation-errors"
              className="rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-xs text-amber-200 space-y-1"
            >
              <div className="font-semibold text-amber-300">
                Complete the following choices to finish leveling up:
              </div>
              <ul className="list-disc list-inside space-y-0.5">
                {validation.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="p-4 border-t border-slate-800 bg-slate-900 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            {validation.valid
              ? `Ready to advance ${character.name} to Level ${requirements.targetTotalLevel}.`
              : `${validation.errors.length} requirement(s) remaining.`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!validation.valid}
              data-testid="level-up-confirm-btn"
              onClick={handleConfirmLevelUp}
              className="px-5 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed hover:bg-amber-400 transition-colors"
            >
              Confirm Level Up &rarr; Level {requirements.targetTotalLevel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
