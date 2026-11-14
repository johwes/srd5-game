import { useEffect, useState } from 'react';
import {
  type CharacterBuildState,
  ICONIC_PARTY_IDS,
  ICONIC_PARTY_METADATA,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import {
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';
import { CharacterSheetDrawer } from '../roster/CharacterSheetDrawer.js';
import { AbilitiesStep } from './AbilitiesStep.js';
import { BackgroundStep } from './BackgroundStep.js';
import { ClassStep } from './ClassStep.js';
import { EquipmentStep } from './EquipmentStep.js';
import { OriginStep } from './OriginStep.js';
import { ReviewStep } from './ReviewStep.js';
import { SpellsStep } from './SpellsStep.js';
import {
  BUILDER_STEPS,
  type BuilderStepId,
  type CharacterBuilderWizardState,
  createDefaultBuilderWizardState,
  createWizardStateFromCharacter,
  getNextBuilderStep,
  getPreviousBuilderStep,
  materializeBundleEquipment,
  syncBuilderDerivedRuntime,
  validateAllBuilderSteps,
} from './builderState.js';

export interface CharacterBuilderWizardProps {
  compendium?: SrdCompendium;
  initialCharacter?: CharacterBuildState;
  onSaveCharacter?: (
    character: CharacterBuildState,
    derived: ReturnType<typeof computeDerivedCharacter>,
  ) => void;
  onInspectCharacter?: (character: CharacterBuildState) => void;
}

export function CharacterBuilderWizard({
  compendium = defaultCompendium,
  initialCharacter,
  onSaveCharacter,
  onInspectCharacter,
}: CharacterBuilderWizardProps) {
  const [wizard, setWizard] = useState<CharacterBuilderWizardState>(() =>
    initialCharacter
      ? createWizardStateFromCharacter(initialCharacter, compendium)
      : createDefaultBuilderWizardState(compendium),
  );
  const [savedRoster, setSavedRoster] = useState<CharacterBuildState[]>([]);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);
  const [localSheetOpen, setLocalSheetOpen] = useState<boolean>(false);

  useEffect(() => {
    if (initialCharacter) {
      setWizard(createWizardStateFromCharacter(initialCharacter, compendium));
      setLastSavedName(null);
    }
  }, [initialCharacter, compendium]);

  const validationMap = validateAllBuilderSteps(wizard, compendium);
  const currentStepValidation = validationMap[wizard.currentStep];
  const derived = computeDerivedCharacter(wizard.buildState, compendium);

  const nextStepId = getNextBuilderStep(
    wizard.currentStep,
    wizard.buildState,
    compendium,
  );
  const prevStepId = getPreviousBuilderStep(
    wizard.currentStep,
    wizard.buildState,
    compendium,
  );

  const handleBuildStateChange = (
    updater: (prev: CharacterBuildState) => CharacterBuildState,
  ) => {
    setWizard((prev) => {
      let nextBuild = updater(prev.buildState);
      // If using Equipment Bundles mode and class or background changed, keep bundle inventory synced
      if (prev.equipmentMode === 'bundles') {
        const prevClassId = prev.buildState.classes[0]?.classId;
        const nextClassId = nextBuild.classes[0]?.classId;
        if (prevClassId !== nextClassId || prev.buildState.backgroundId !== nextBuild.backgroundId) {
          const mat = materializeBundleEquipment(nextBuild, compendium);
          nextBuild = {
            ...nextBuild,
            ...mat,
          };
        }
      }
      const synced = syncBuilderDerivedRuntime(nextBuild, compendium);
      return {
        ...prev,
        buildState: synced.state,
      };
    });
    setLastSavedName(null);
  };

  const handleLoadPregenTemplate = (pregenId: string) => {
    const pregen = getPregenCharacter(pregenId);
    if (!pregen) return;
    setWizard(createWizardStateFromCharacter(pregen, compendium));
    setLastSavedName(null);
  };

  const handleResetBlankBuilder = () => {
    setWizard(createDefaultBuilderWizardState(compendium));
    setLastSavedName(null);
  };

  const handleFinalize = () => {
    if (!validationMap.review.valid) return;
    const synced = syncBuilderDerivedRuntime(wizard.buildState, compendium);
    const finalizedChar: CharacterBuildState = {
      ...synced.state,
      id:
        synced.state.id === 'custom-hero-1'
          ? `hero-${synced.state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${savedRoster.length + 1}`
          : synced.state.id,
    };

    setSavedRoster((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === finalizedChar.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = finalizedChar;
        return copy;
      }
      return [...prev, finalizedChar];
    });
    setLastSavedName(finalizedChar.name);
    onSaveCharacter?.(finalizedChar, synced.derived);
  };

  return (
    <div data-testid="character-builder-wizard" className="space-y-6">
      {/* Top Bar: Quick-Load Iconic Templates & Live Character Mini-Summary */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-amber-400">
              {wizard.buildState.name || 'Unnamed Hero'}
            </h2>
            <span className="px-2 py-0.5 rounded bg-slate-800 text-xs font-medium text-slate-200">
              Level {derived.totalLevel}{' '}
              {derived.subraceName ?? derived.raceName}{' '}
              {derived.classes.map((c) => c.className).join(' / ')}
            </span>
          </div>
          <div
            data-testid="builder-live-stats-bar"
            className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono"
          >
            <span>
              HP <strong className="text-emerald-300">{derived.maxHp}</strong>
            </span>
            <span>&middot;</span>
            <span>
              AC{' '}
              <strong className="text-amber-300">
                {derived.armorClass.totalAc}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Init{' '}
              <strong className="text-slate-200">
                {formatSignedNumber(derived.initiative.bonus)}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Prof{' '}
              <strong className="text-amber-300">
                {formatSignedNumber(derived.proficiencyBonus)}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Speed <strong className="text-slate-200">{derived.speedFeet}ft</strong>
            </span>
          </div>
        </div>

        {/* Iconic Archetype Quick-Start Templates */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 mr-1">
            Quick-Load Template:
          </span>
          {ICONIC_PARTY_IDS.map((pregenId) => {
            const meta = ICONIC_PARTY_METADATA[pregenId];
            return (
              <button
                key={pregenId}
                type="button"
                data-testid={`builder-load-template-${pregenId}`}
                onClick={() => handleLoadPregenTemplate(pregenId)}
                className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-300 hover:border-amber-500/60 hover:text-amber-200 transition-colors"
              >
                {formatTitleCase(meta.classId)}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="builder-open-sheet-btn"
            onClick={() => {
              if (onInspectCharacter) {
                onInspectCharacter(wizard.buildState);
              } else {
                setLocalSheetOpen(true);
              }
            }}
            className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/50 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
          >
            Character Sheet
          </button>
          <button
            type="button"
            data-testid="builder-reset-blank-btn"
            onClick={handleResetBlankBuilder}
            className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-400 hover:text-slate-200"
          >
            Reset
          </button>
        </div>
      </div>

      {/* 7-Step Wizard Stepper Navigation */}
      <nav
        aria-label="Character Builder Steps"
        data-testid="builder-stepper-nav"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
      >
        {BUILDER_STEPS.map((stepMeta) => {
          const isCurrent = wizard.currentStep === stepMeta.id;
          const stepVal = validationMap[stepMeta.id];

          return (
            <button
              key={stepMeta.id}
              type="button"
              data-testid={`builder-step-tab-${stepMeta.id}`}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() =>
                setWizard((prev) => ({ ...prev, currentStep: stepMeta.id }))
              }
              className={`text-left p-2.5 rounded-lg border transition-all flex flex-col justify-between gap-1 ${
                isCurrent
                  ? 'bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50'
                  : stepVal.skipped
                    ? 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                    : stepVal.valid
                      ? 'bg-slate-900/80 border-emerald-800/50 hover:border-emerald-700'
                      : 'bg-slate-900/80 border-amber-800/50 hover:border-amber-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-xs font-bold ${
                    isCurrent ? 'text-amber-300' : 'text-slate-200'
                  }`}
                >
                  {stepMeta.shortTitle}
                </span>
                <span
                  data-testid={`builder-step-badge-${stepMeta.id}`}
                  className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                    stepVal.skipped
                      ? 'bg-slate-800 text-slate-400'
                      : stepVal.valid
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                  }`}
                >
                  {stepVal.skipped ? 'Skip' : stepVal.valid ? 'Valid' : 'Todo'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400 truncate">
                {stepMeta.title.replace(/^Step \d+:\s*/, '')}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Active Step Validation Banner (when current step has pending requirements) */}
      {!currentStepValidation.valid && wizard.currentStep !== 'review' && (
        <div
          data-testid="builder-current-step-errors"
          className="rounded-lg border border-amber-700/60 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-200 space-y-1"
        >
          <div className="font-semibold text-amber-300">
            Required to complete this step:
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {currentStepValidation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Saved Confirmation Banner */}
      {lastSavedName && (
        <div
          data-testid="builder-saved-confirmation"
          className="rounded-lg border border-emerald-700/60 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between"
        >
          <span>
            Saved <strong>{lastSavedName}</strong> to Party Roster ({savedRoster.length}{' '}
            hero{savedRoster.length === 1 ? '' : 'es'} in session roster).
          </span>
        </div>
      )}

      {/* Active Step Body */}
      <div className="min-h-[380px]">
        {wizard.currentStep === 'origin' && (
          <OriginStep
            buildState={wizard.buildState}
            onChange={handleBuildStateChange}
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'class' && (
          <ClassStep
            buildState={wizard.buildState}
            onChange={handleBuildStateChange}
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'abilities' && (
          <AbilitiesStep
            buildState={wizard.buildState}
            onChange={handleBuildStateChange}
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'background' && (
          <BackgroundStep
            buildState={wizard.buildState}
            onChange={handleBuildStateChange}
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'equipment' && (
          <EquipmentStep
            wizard={wizard}
            onWizardChange={(updater) =>
              setWizard((prev) => {
                const updated = updater(prev);
                const synced = syncBuilderDerivedRuntime(
                  updated.buildState,
                  compendium,
                );
                return {
                  ...updated,
                  buildState: synced.state,
                };
              })
            }
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'spells' && (
          <SpellsStep
            buildState={wizard.buildState}
            onChange={handleBuildStateChange}
            compendium={compendium}
          />
        )}
        {wizard.currentStep === 'review' && (
          <ReviewStep
            wizard={wizard}
            validationMap={validationMap}
            onWizardChange={setWizard}
            onFinalize={handleFinalize}
            compendium={compendium}
          />
        )}
      </div>

      {/* Bottom Step Navigation Footer */}
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <button
          type="button"
          disabled={!prevStepId}
          data-testid="builder-prev-step-btn"
          onClick={() => {
            if (prevStepId) {
              setWizard((prev) => ({ ...prev, currentStep: prevStepId }));
            }
          }}
          className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
        >
          &larr; Previous Step
        </button>

        <div className="text-xs text-slate-400">
          {
            BUILDER_STEPS.find((s) => s.id === wizard.currentStep)?.title
          }
        </div>

        {nextStepId ? (
          <button
            type="button"
            disabled={!currentStepValidation.valid}
            data-testid="builder-next-step-btn"
            onClick={() =>
              setWizard((prev) => ({
                ...prev,
                currentStep: nextStepId as BuilderStepId,
              }))
            }
            className="px-4 py-2 rounded-lg bg-amber-500 text-xs font-bold text-slate-950 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed hover:bg-amber-400"
          >
            Next Step ({BUILDER_STEPS.find((s) => s.id === nextStepId)?.shortTitle}) &rarr;
          </button>
        ) : (
          <button
            type="button"
            disabled={!validationMap.review.valid}
            data-testid="builder-footer-finalize-btn"
            onClick={handleFinalize}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-xs font-bold text-slate-950 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed hover:bg-emerald-400"
          >
            Save Character
          </button>
        )}
      </div>

      {localSheetOpen && (
        <CharacterSheetDrawer
          character={wizard.buildState}
          compendium={compendium}
          onClose={() => setLocalSheetOpen(false)}
          onUpdateCharacter={(updated) =>
            setWizard((prev) => ({ ...prev, buildState: updated }))
          }
        />
      )}
    </div>
  );
}
