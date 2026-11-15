import { useEffect, useState } from 'react';
import {
  type CharacterBuildState,
  getPregenCharacter,
} from '@srd5/data';
import { parseSrd5JsonImport } from '../../persistence/index.js';
import { CampfirePartySlotCard } from './CampfirePartySlotCard.js';
import { VaultSelectionModal } from './VaultSelectionModal.js';
import {
  CAMPAIGN_MODES,
  type CampaignDifficultyConfig,
  type CampaignLaunchConfig,
  type CampaignModeId,
  DEFAULT_CAMPAIGN_DIFFICULTY,
  DIFFICULTY_PRESETS,
  type DeathSaveRuleId,
  type DifficultyPresetId,
  type PartySlotAssignment,
  SLOT_ROLE_SUGGESTIONS,
} from './types.js';

export interface CampaignSetupWizardProps {
  initialStage?: WizardStageNumber;
  initialMode?: CampaignModeId;
  initialPreset?: DifficultyPresetId;
  initialParty?: CharacterBuildState[];
  initialSlotAssignments?: PartySlotAssignment[];
  availableRosterCharacters?: CharacterBuildState[];
  onBackToMenu?: () => void;
  onLaunch: (config: CampaignLaunchConfig) => void;
  onRollNewHero?: (slotIndex: number) => void;
  onImportCharacter?: (character: CharacterBuildState, slotIndex: number) => void;
}

export type WizardStageNumber = 1 | 2 | 3 | 4;

const STAGE_LABELS: Record<WizardStageNumber, string> = {
  1: 'Game Mode',
  2: 'Difficulty & Rules',
  3: 'Party Assembly',
  4: 'Prologue & Embark',
};

export function CampaignSetupWizard({
  initialStage = 1,
  initialMode = 'campaign_kaelen',
  initialPreset = 'standard',
  initialParty,
  initialSlotAssignments,
  availableRosterCharacters = [],
  onBackToMenu,
  onLaunch,
  onRollNewHero,
  onImportCharacter,
}: CampaignSetupWizardProps) {
  const [currentStage, setCurrentStage] = useState<WizardStageNumber>(initialStage);
  const [selectedMode, setSelectedMode] = useState<CampaignModeId>(initialMode);
  const [difficultyConfig, setDifficultyConfig] = useState<CampaignDifficultyConfig>(() => {
    if (initialPreset !== 'custom' && DIFFICULTY_PRESETS[initialPreset]) {
      return { ...DIFFICULTY_PRESETS[initialPreset].config };
    }
    return { ...DEFAULT_CAMPAIGN_DIFFICULTY };
  });
  const [showCustomRulesDrawer, setShowCustomRulesDrawer] = useState<boolean>(false);

  // Vault Selection Modal state
  const [vaultModalSlotIndex, setVaultModalSlotIndex] = useState<number | null>(null);

  // File import feedback banner state
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 4 Slot assignments state
  const [slotAssignments, setSlotAssignments] = useState<PartySlotAssignment[]>(() => {
    if (initialSlotAssignments && initialSlotAssignments.length === 4) {
      return initialSlotAssignments;
    }
    const defaultHeroes: Array<CharacterBuildState | null> =
      initialParty !== undefined
        ? [
            initialParty[0] ?? null,
            initialParty[1] ?? null,
            initialParty[2] ?? null,
            initialParty[3] ?? null,
          ]
        : [
            getPregenCharacter('pregen-fighter') ?? null,
            getPregenCharacter('pregen-rogue') ?? null,
            getPregenCharacter('pregen-wizard') ?? null,
            getPregenCharacter('pregen-cleric') ?? null,
          ];

    return SLOT_ROLE_SUGGESTIONS.map((role, idx) => ({
      slotIndex: idx,
      roleSuggestion: role,
      character: defaultHeroes[idx] ?? null,
      seatType: 'local' as const,
      playerSeatId: `Player ${idx + 1}`,
    }));
  });

  // Handle hardware Esc key to navigate back or exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentStage > 1) {
          setCurrentStage((prev) => (prev - 1) as WizardStageNumber);
        } else if (onBackToMenu) {
          onBackToMenu();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStage, onBackToMenu]);

  // Difficulty preset selection helper
  const handleSelectPreset = (presetId: Exclude<DifficultyPresetId, 'custom'>) => {
    setDifficultyConfig({ ...DIFFICULTY_PRESETS[presetId].config });
  };

  // Custom ruleset parameter change helper
  const updateCustomRule = <K extends keyof CampaignDifficultyConfig>(
    key: K,
    val: CampaignDifficultyConfig[K],
  ) => {
    setDifficultyConfig((prev) => ({
      ...prev,
      [key]: val,
      preset: 'custom',
    }));
  };

  // Reset party to 4 iconic SRD pregens
  const handleResetToIconics = () => {
    setSlotAssignments((prev) => [
      { ...prev[0]!, character: getPregenCharacter('pregen-fighter') ?? null },
      { ...prev[1]!, character: getPregenCharacter('pregen-rogue') ?? null },
      { ...prev[2]!, character: getPregenCharacter('pregen-wizard') ?? null },
      { ...prev[3]!, character: getPregenCharacter('pregen-cleric') ?? null },
    ]);
    setImportStatus(null);
  };

  // Clear all slots
  const handleClearAllSlots = () => {
    setSlotAssignments((prev) =>
      prev.map((s) => ({ ...s, character: null })),
    );
    setImportStatus(null);
  };

  // Assign hero to specific slot
  const handleAssignHero = (hero: CharacterBuildState | null, slotIndex: number) => {
    setSlotAssignments((prev) => {
      const next = [...prev];
      if (next[slotIndex]) {
        next[slotIndex] = { ...next[slotIndex]!, character: hero };
      }
      return next;
    });
  };

  // Update seat type or seat ID for a slot
  const handleUpdateSeat = (
    slotIndex: number,
    seatUpdates: Partial<Pick<PartySlotAssignment, 'seatType' | 'playerSeatId'>>,
  ) => {
    setSlotAssignments((prev) => {
      const next = [...prev];
      if (next[slotIndex]) {
        next[slotIndex] = { ...next[slotIndex]!, ...seatUpdates };
      }
      return next;
    });
  };

  // Parse and handle .srd5.json file drop/upload
  const handleFileDrop = (fileText: string, targetSlotIndex?: number) => {
    setImportStatus(null);
    const result = parseSrd5JsonImport(fileText);
    if (!result.ok) {
      setImportStatus({
        type: 'error',
        message: result.errors.join('; '),
      });
      return;
    }

    if (result.format === 'srd5-character' || result.characters.length === 1) {
      const importedChar = result.characters[0]!;
      const slotIdx =
        typeof targetSlotIndex === 'number'
          ? targetSlotIndex
          : slotAssignments.findIndex((s) => s.character === null);
      const targetIdx = slotIdx >= 0 ? slotIdx : 0;

      setSlotAssignments((prev) => {
        const next = [...prev];
        next[targetIdx] = { ...next[targetIdx]!, character: importedChar };
        return next;
      });
      setImportStatus({
        type: 'success',
        message: `Successfully imported "${importedChar.name}" into Slot ${targetIdx + 1}.`,
      });
      onImportCharacter?.(importedChar, targetIdx);
    } else if (result.format === 'srd5-roster' || result.characters.length > 1) {
      setSlotAssignments((prev) => {
        const next = [...prev];
        for (let i = 0; i < 4; i++) {
          if (result.characters[i]) {
            next[i] = { ...next[i]!, character: result.characters[i]! };
          }
        }
        return next;
      });
      setImportStatus({
        type: 'success',
        message: `Successfully imported party roster of ${result.characters.length} heroes.`,
      });
    }
  };

  // Assemble active party list (non-null slots)
  const activeParty = slotAssignments
    .map((s) => s.character)
    .filter((c): c is CharacterBuildState => c !== null);

  // Synergy badges calculation
  const hasFrontline = activeParty.some((c) =>
    c.classes.some((cls) => ['fighter', 'paladin', 'barbarian'].includes(cls.classId.toLowerCase())),
  );
  const hasScoutOrTrap = activeParty.some((c) =>
    c.classes.some((cls) => ['rogue', 'ranger', 'monk'].includes(cls.classId.toLowerCase())),
  );
  const hasDivineHealing = activeParty.some((c) =>
    c.classes.some((cls) => ['cleric', 'druid', 'paladin', 'bard'].includes(cls.classId.toLowerCase())),
  );
  const hasArcaneUtility = activeParty.some((c) =>
    c.classes.some((cls) => ['wizard', 'sorcerer', 'warlock', 'bard'].includes(cls.classId.toLowerCase())),
  );

  const handleNext = () => {
    if (currentStage < 4) {
      setCurrentStage((prev) => (prev + 1) as WizardStageNumber);
    }
  };

  const handleBack = () => {
    if (currentStage > 1) {
      setCurrentStage((prev) => (prev - 1) as WizardStageNumber);
    } else if (onBackToMenu) {
      onBackToMenu();
    }
  };

  const handleLaunch = () => {
    onLaunch({
      mode: selectedMode,
      difficulty: difficultyConfig,
      party: activeParty,
      slotAssignments,
    });
  };

  const currentModeMeta = CAMPAIGN_MODES[selectedMode];

  return (
    <div
      data-testid="campaign-setup-wizard"
      className="relative min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between overflow-x-hidden"
    >
      {/* Torchlight & Atmospheric Radial Glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-amber-600/15 blur-3xl animate-pulse"
        style={{ animationDuration: '4s' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-40 h-96 w-96 rounded-full bg-amber-700/15 blur-3xl animate-pulse"
        style={{ animationDuration: '5s' }}
      />

      {/* Top Header & 4-Stage Stepper */}
      <header className="relative z-10 w-full max-w-5xl mx-auto px-4 pt-4 sm:pt-6 pb-2">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-xl sm:text-2xl font-serif font-extrabold tracking-tight text-amber-400">
              ⚔️ New Game Setup
            </span>
            <span className="hidden sm:inline-block text-xs uppercase tracking-wider text-slate-400 font-medium">
              Campaign Wizard
            </span>
          </div>

          {onBackToMenu && (
            <button
              type="button"
              data-testid="wizard-back-to-title"
              onClick={onBackToMenu}
              className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none"
            >
              ✕ Exit to Title
            </button>
          )}
        </div>

        {/* 4-Step Stepper Ribbon */}
        <nav
          aria-label="Wizard Steps"
          className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3"
        >
          {([1, 2, 3, 4] as WizardStageNumber[]).map((stageNum) => {
            const isActive = currentStage === stageNum;
            const isCompleted = currentStage > stageNum;
            return (
              <button
                key={stageNum}
                type="button"
                data-testid={`wizard-step-${stageNum}`}
                onClick={() => setCurrentStage(stageNum)}
                className={`min-h-[48px] rounded-lg p-2.5 sm:p-3 text-left border transition-all duration-150 flex items-center gap-2.5 focus:ring-2 focus:ring-amber-400 focus:outline-none ${
                  isActive
                    ? 'border-amber-500 bg-amber-950/40 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                    : isCompleted
                      ? 'border-emerald-600/60 bg-slate-900/80 text-emerald-300 hover:border-emerald-500'
                      : 'border-slate-800/80 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isActive
                      ? 'bg-amber-500 text-slate-950'
                      : isCompleted
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isCompleted ? '✓' : stageNum}
                </span>
                <div className="overflow-hidden truncate">
                  <div className="text-[10px] uppercase font-bold tracking-wider opacity-70">
                    Step {stageNum}
                  </div>
                  <div className="text-xs sm:text-sm font-semibold truncate">
                    {STAGE_LABELS[stageNum]}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Stage Content Viewport */}
      <main className="relative z-10 w-full max-w-5xl mx-auto px-4 py-4 sm:py-6 flex-1 flex flex-col justify-start">
        {/* ========================================================================= */}
        {/* STAGE 1: MODE SELECTION                                                    */}
        {/* ========================================================================= */}
        {currentStage === 1 && (
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold font-serif text-slate-100 flex items-center gap-2">
                <span>Select Your Adventure Mode</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Choose between a story-driven handcrafted campaign, a procedurally generated roguelite gauntlet, or an instant combat skirmish arena.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.keys(CAMPAIGN_MODES) as CampaignModeId[]).map((modeKey) => {
                const modeMeta = CAMPAIGN_MODES[modeKey];
                const isSelected = selectedMode === modeKey;
                return (
                  <div
                    key={modeKey}
                    data-testid={`wizard-mode-card-${modeKey}`}
                    onClick={() => setSelectedMode(modeKey)}
                    className={`relative rounded-xl border p-4 sm:p-5 cursor-pointer transition-all duration-200 flex flex-col justify-between space-y-4 focus-within:ring-2 focus-within:ring-amber-400 ${
                      isSelected
                        ? 'border-amber-400 bg-gradient-to-b from-amber-950/40 via-slate-900 to-slate-900 shadow-[0_0_20px_rgba(245,158,11,0.22)]'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-3xl">{modeMeta.icon}</span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {modeMeta.badge}
                        </span>
                      </div>

                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400/90">
                          {modeMeta.tagline}
                        </div>
                        <h3 className="text-lg font-bold font-serif text-slate-100 mt-0.5">
                          {modeMeta.title}
                        </h3>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {modeMeta.description}
                      </p>

                      <ul className="space-y-1.5 pt-2 border-t border-slate-800/80">
                        {modeMeta.features.map((feat, idx) => (
                          <li
                            key={idx}
                            className="text-[11px] text-slate-300 flex items-center gap-1.5"
                          >
                            <span className="text-amber-400 text-xs">✦</span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                      <span>Length: {modeMeta.estimatedTime}</span>
                      <span className="font-semibold text-slate-300">{modeMeta.levelRange}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* STAGE 2: DIFFICULTY & RULESET CONFIGURATION                                */}
        {/* ========================================================================= */}
        {currentStage === 2 && (
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold font-serif text-slate-100 flex items-center gap-2">
                <span>Difficulty &amp; Ruleset Configuration</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Tailor the tactical challenge to your playstyle, from relaxed narrative exploration to lethal iron-man permadeath.
              </p>
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(
                ['explorer', 'standard', 'tactician'] as Array<
                  Exclude<DifficultyPresetId, 'custom'>
                >
              ).map((presetId) => {
                const presetMeta = DIFFICULTY_PRESETS[presetId];
                const isSelected = difficultyConfig.preset === presetId;
                return (
                  <div
                    key={presetId}
                    data-testid={`wizard-preset-${presetId}`}
                    onClick={() => handleSelectPreset(presetId)}
                    className={`rounded-xl border p-4 sm:p-5 cursor-pointer transition-all duration-200 flex flex-col justify-between space-y-4 ${
                      isSelected
                        ? 'border-amber-400 bg-gradient-to-b from-amber-950/40 via-slate-900 to-slate-900 shadow-[0_0_20px_rgba(245,158,11,0.22)]'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold font-serif text-slate-100">
                          {presetMeta.title}
                        </h3>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {presetMeta.badge}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {presetMeta.description}
                      </p>

                      <ul className="space-y-1.5 pt-2 border-t border-slate-800/80">
                        {presetMeta.highlights.map((item, idx) => (
                          <li
                            key={idx}
                            className="text-[11px] text-slate-300 flex items-center gap-1.5"
                          >
                            <span className="text-amber-400 text-xs">✓</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-2 text-[11px] font-semibold text-center text-amber-300/80">
                      {isSelected ? '● Active Preset' : 'Click to select preset'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom Ruleset Accordion / Drawer Toggle */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-100">
                      Advanced Ruleset Modifiers
                    </span>
                    {difficultyConfig.preset === 'custom' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        Custom Configuration
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Fine-tune individual parameters including permadeath, rations, death saves, and enemy health modifiers.
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="wizard-custom-rules-toggle"
                  onClick={() => setShowCustomRulesDrawer((prev) => !prev)}
                  className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none self-start sm:self-auto"
                >
                  {showCustomRulesDrawer ? '▲ Hide Custom Options' : '⚙️ Customize Ruleset'}
                </button>
              </div>

              {/* Expandable Custom Parameters Panel */}
              {showCustomRulesDrawer && (
                <div
                  data-testid="wizard-custom-rules-panel"
                  className="pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                  {/* Permadeath Toggle */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      data-testid="wizard-toggle-permadeath"
                      checked={difficultyConfig.permadeath}
                      onChange={(e) => updateCustomRule('permadeath', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">Iron Man Permadeath</div>
                      <div className="text-[11px] text-slate-400">
                        Party wipe deletes current save file permanently.
                      </div>
                    </div>
                  </label>

                  {/* Camp Supplies Toggle */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      data-testid="wizard-toggle-supplies"
                      checked={difficultyConfig.campSuppliesRequired}
                      onChange={(e) => updateCustomRule('campSuppliesRequired', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">Camp Supplies Required</div>
                      <div className="text-[11px] text-slate-400">
                        Long Rests consume food rations or incur exhaustion.
                      </div>
                    </div>
                  </label>

                  {/* Fog of War Toggle */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      data-testid="wizard-toggle-fog"
                      checked={difficultyConfig.fogOfWarEnabled}
                      onChange={(e) => updateCustomRule('fogOfWarEnabled', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">Dynamic Fog of War</div>
                      <div className="text-[11px] text-slate-400">
                        Enforce Line of Sight and darkvision illumination masks.
                      </div>
                    </div>
                  </label>

                  {/* Fast AI Turns Toggle */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      data-testid="wizard-toggle-fast-ai"
                      checked={difficultyConfig.fastAiTurns}
                      onChange={(e) => updateCustomRule('fastAiTurns', e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">Fast AI Turns</div>
                      <div className="text-[11px] text-slate-400">
                        Accelerate enemy pathfinding and combat animations.
                      </div>
                    </div>
                  </label>

                  {/* Death Save Rule */}
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1.5">
                    <div className="text-xs font-bold text-slate-200">Death Saving Throw Rule</div>
                    <select
                      data-testid="wizard-select-death-save"
                      value={difficultyConfig.deathSaveRule}
                      onChange={(e) =>
                        updateCustomRule('deathSaveRule', e.target.value as DeathSaveRuleId)
                      }
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
                    >
                      <option value="forgiving">Forgiving (Advantage on rolls)</option>
                      <option value="core_raw">Standard 5e Core RAW (DC 10)</option>
                      <option value="hardcore">Hardcore (Nat 1 = Instant Death)</option>
                    </select>
                  </div>

                  {/* Monster HP Modifier */}
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1.5">
                    <div className="text-xs font-bold text-slate-200">
                      Monster HP Multiplier ({difficultyConfig.enemyHealthModifier}x)
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[0.8, 1.0, 1.2].map((mod) => (
                        <button
                          key={mod}
                          type="button"
                          onClick={() => updateCustomRule('enemyHealthModifier', mod)}
                          className={`min-h-[36px] rounded px-2 py-1 text-xs font-semibold border ${
                            difficultyConfig.enemyHealthModifier === mod
                              ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {mod}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Monster Attack / DC Bonus */}
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1.5">
                    <div className="text-xs font-bold text-slate-200">
                      Enemy Attack &amp; DC Modifier ({difficultyConfig.enemyAttackBonus >= 0 ? `+${difficultyConfig.enemyAttackBonus}` : difficultyConfig.enemyAttackBonus})
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[-1, 0, 1].map((bonus) => (
                        <button
                          key={bonus}
                          type="button"
                          onClick={() => updateCustomRule('enemyAttackBonus', bonus)}
                          className={`min-h-[36px] rounded px-2 py-1 text-xs font-semibold border ${
                            difficultyConfig.enemyAttackBonus === bonus
                              ? 'border-amber-500 bg-amber-950/60 text-amber-300'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {bonus >= 0 ? `+${bonus}` : bonus}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* STAGE 3: PARTY ASSEMBLY & CAMPFIRE LINEUP                                  */}
        {/* ========================================================================= */}
        {currentStage === 3 && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold font-serif text-slate-100 flex items-center gap-2">
                  <span aria-hidden="true">🔥</span>
                  <span>Campfire Party Assembly</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  Assemble your 1–4 member adventuring party around the campfire. Quick-pick SRD iconics, recruit from your vault, drop a .srd5.json file, or roll a new custom hero.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="wizard-reset-iconics-btn"
                  onClick={handleResetToIconics}
                  className="min-h-[44px] px-3.5 py-1.5 rounded-lg border border-amber-900/60 bg-slate-900/80 hover:bg-slate-800 text-xs font-semibold text-amber-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none self-start sm:self-auto"
                >
                  ⚡ Quick-Pick All 4 Pregens
                </button>

                <button
                  type="button"
                  data-testid="wizard-clear-all-slots-btn"
                  onClick={handleClearAllSlots}
                  className="min-h-[44px] px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
                >
                  ✕ Clear All
                </button>
              </div>
            </div>

            {/* File Import Feedback Alert */}
            {importStatus && (
              <div
                data-testid={
                  importStatus.type === 'success'
                    ? 'wizard-import-success'
                    : 'wizard-import-error'
                }
                className={`rounded-xl border p-3 text-xs flex items-center justify-between gap-2 ${
                  importStatus.type === 'success'
                    ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                    : 'border-rose-600/50 bg-rose-950/40 text-rose-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{importStatus.type === 'success' ? '✓' : '⚠️'}</span>
                  <span>{importStatus.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportStatus(null)}
                  className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Live Party Synergy Advisor & Warnings */}
            <div className="space-y-2">
              <div
                data-testid="wizard-synergy-ribbon"
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="font-bold text-slate-300 mr-1">Party Synergy:</span>
                <span
                  data-testid="wizard-synergy-frontline"
                  className={`px-2 py-1 rounded-md font-semibold border ${
                    hasFrontline
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/60 text-slate-500'
                  }`}
                >
                  🛡️ Frontline Anchor {hasFrontline && '✓'}
                </span>
                <span
                  data-testid="wizard-synergy-scout"
                  className={`px-2 py-1 rounded-md font-semibold border ${
                    hasScoutOrTrap
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/60 text-slate-500'
                  }`}
                >
                  🗝️ Trap &amp; Lock Specialist {hasScoutOrTrap && '✓'}
                </span>
                <span
                  data-testid="wizard-synergy-divine"
                  className={`px-2 py-1 rounded-md font-semibold border ${
                    hasDivineHealing
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/60 text-slate-500'
                  }`}
                >
                  ✨ Divine Healing {hasDivineHealing && '✓'}
                </span>
                <span
                  data-testid="wizard-synergy-arcane"
                  className={`px-2 py-1 rounded-md font-semibold border ${
                    hasArcaneUtility
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-800 bg-slate-900/60 text-slate-500'
                  }`}
                >
                  🔮 Arcane Utility {hasArcaneUtility && '✓'}
                </span>
              </div>

              {/* Soft Warning Badges if party < 4 or missing critical roles */}
              {activeParty.length > 0 && activeParty.length < 4 && (
                <div
                  data-testid="wizard-synergy-warning-undersized"
                  className="rounded-lg border border-amber-600/30 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-300 flex items-center gap-2"
                >
                  <span>⚠️</span>
                  <span>
                    Undersized Party ({activeParty.length}/4 heroes): Tactical combat will be significantly more challenging without a full 4-member party.
                  </span>
                </div>
              )}

              {activeParty.length > 0 && !hasDivineHealing && (
                <div
                  data-testid="wizard-synergy-warning-roles"
                  className="rounded-lg border border-sky-600/30 bg-sky-950/20 px-3 py-1.5 text-xs text-sky-300 flex items-center gap-2"
                >
                  <span>💡</span>
                  <span>
                    Missing Divine Healing: Consider bringing healing potions into the dungeon and planning rests carefully.
                  </span>
                </div>
              )}
            </div>

            {/* 4 Party Slots Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {slotAssignments.map((assignment, slotIndex) => (
                <CampfirePartySlotCard
                  key={slotIndex}
                  slotIndex={slotIndex}
                  assignment={assignment}
                  availableRosterCharacters={availableRosterCharacters}
                  onAssignHero={handleAssignHero}
                  onUpdateSeat={handleUpdateSeat}
                  onOpenVaultModal={(idx) => setVaultModalSlotIndex(idx)}
                  onRollNewHero={onRollNewHero}
                  onFileDrop={handleFileDrop}
                />
              ))}
            </div>

            {activeParty.length === 0 && (
              <p
                data-testid="wizard-party-empty-warning"
                className="text-xs text-rose-400 text-center font-medium"
              >
                ⚠️ You must have at least 1 hero in your party to embark.
              </p>
            )}

            {/* Vault Selection Modal */}
            {vaultModalSlotIndex !== null && (
              <VaultSelectionModal
                slotIndex={vaultModalSlotIndex}
                availableCharacters={
                  availableRosterCharacters.length > 0
                    ? availableRosterCharacters
                    : [
                        getPregenCharacter('pregen-fighter')!,
                        getPregenCharacter('pregen-rogue')!,
                        getPregenCharacter('pregen-wizard')!,
                        getPregenCharacter('pregen-cleric')!,
                      ].filter(Boolean)
                }
                onSelectCharacter={(char) => {
                  handleAssignHero(char, vaultModalSlotIndex);
                  setVaultModalSlotIndex(null);
                }}
                onClose={() => setVaultModalSlotIndex(null)}
              />
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* STAGE 4: NARRATIVE PROLOGUE & QUEST HOOK                                   */}
        {/* ========================================================================= */}
        {currentStage === 4 && (
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold font-serif text-slate-100 flex items-center gap-2">
                <span>Narrative Prologue &amp; Quest Briefing</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Review the quest hook and ruleset summary before descending into the darkness.
              </p>
            </div>

            {/* Thematic Story Briefing Parchment */}
            <div
              data-testid="wizard-narrative-parchment"
              className="rounded-xl border border-amber-800/50 bg-gradient-to-b from-amber-950/30 via-slate-900 to-slate-950 p-5 sm:p-6 space-y-4 shadow-[0_0_24px_rgba(245,158,11,0.1)] font-serif"
            >
              <div className="flex items-center justify-between border-b border-amber-900/40 pb-3">
                <span className="text-xs tracking-widest uppercase font-bold text-amber-400">
                  {selectedMode === 'campaign_kaelen'
                    ? 'PROLOGUE: SHADOWS OVER BLACKWOOD'
                    : selectedMode === 'deep_descent'
                      ? 'PROLOGUE: THE ENDLESS YAWNING ABYSS'
                      : 'PROLOGUE: THE PROVING GROUNDS'}
                </span>
                <span className="text-xs text-amber-500/70 font-sans">⚔ 5e SRD Narrative</span>
              </div>

              {selectedMode === 'campaign_kaelen' && (
                <div className="space-y-3 text-slate-200 text-xs sm:text-sm leading-relaxed">
                  <p>
                    Rain lashes against the crumbling stone ruins of the Blackwood Ridge. Below lies the ancient crypt of Lord Kaelen, an elven high priest whose resting place was sealed four centuries ago.
                  </p>
                  <p>
                    Recently, the tomb's protective wards have shattered, and villagers whisper of eerie emerald lights flickering in the mist. Your company has been tasked with delving into the sunken halls, cleansing whatever darkness stirs within, and recovering the lost Sunstone Relic.
                  </p>
                </div>
              )}

              {selectedMode === 'deep_descent' && (
                <div className="space-y-3 text-slate-200 text-xs sm:text-sm leading-relaxed">
                  <p>
                    At the edge of known civilization lies the Maw of the World—a bottomless subterranean chasm whose depths shift and contort with every passing dawn.
                  </p>
                  <p>
                    Countless adventuring companies have plunged into its stygian vaults seeking primordial artifacts and glory; none have returned to tell of the bottom floor. With torches lit and steel drawn, your party stands before the descent, knowing only wit, steel, and divine favor will see you survive.
                  </p>
                </div>
              )}

              {selectedMode === 'arena' && (
                <div className="space-y-3 text-slate-200 text-xs sm:text-sm leading-relaxed">
                  <p>
                    Under the roar of thousands of bloodthirsty spectators, the iron portcullis rises. The arena sand is stained with centuries of warrior blood and monster ichor.
                  </p>
                  <p>
                    Here, only tactical supremacy and mastery of the 5e rules of combat dictate who walks out alive and who becomes part of the colosseum's legends. Ready your weapons, prepare your spells, and prove your tactical mastery.
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-amber-900/40 text-xs font-sans text-amber-300 space-y-1">
                <div className="font-bold uppercase tracking-wider text-[11px] text-amber-400">
                  Primary Objectives:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                  {selectedMode === 'campaign_kaelen' && (
                    <>
                      <li>Explore Floor 1: The Crypt Antechamber</li>
                      <li>Detect and disarm ancient mechanical and magical traps</li>
                      <li>Slay High Priest Kaelen and retrieve the Sunstone Relic</li>
                    </>
                  )}
                  {selectedMode === 'deep_descent' && (
                    <>
                      <li>Descend through procedurally generated floor tiers</li>
                      <li>Manage camp supplies, rations, and rest exhaustion</li>
                      <li>Seek out Shrines of Fate and achieve the highest depth run</li>
                    </>
                  )}
                  {selectedMode === 'arena' && (
                    <>
                      <li>Survive escalating waves of deadly SRD monsters</li>
                      <li>Command heroes on the 5-ft tactical grid with Reactions &amp; Line of Sight</li>
                      <li>Prove tactical supremacy in PvE or local 1v1 Party Duels</li>
                    </>
                  )}
                </ul>
              </div>
            </div>

            {/* Campaign Summary Card */}
            <div
              data-testid="wizard-summary-card"
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs"
            >
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  Chosen Adventure
                </span>
                <span className="text-sm font-bold text-amber-300 mt-0.5 block">
                  {currentModeMeta.title}
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  {currentModeMeta.badge}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  Ruleset Difficulty
                </span>
                <span className="text-sm font-bold text-slate-100 mt-0.5 block capitalize">
                  {difficultyConfig.preset} Difficulty
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Permadeath: {difficultyConfig.permadeath ? 'Iron Man (Enabled)' : 'Disabled'} &middot; Supplies: {difficultyConfig.campSuppliesRequired ? 'Required' : 'Free'}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  Company Lineup ({activeParty.length} Heroes)
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {activeParty.map((c) => (
                    <div key={c.id} className="text-[11px] text-slate-300 truncate">
                      • {c.name} ({c.classes[0]?.classId} Lvl {c.classes[0]?.level})
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ========================================================================= */}
      {/* STICKY BOTTOM ACTION FOOTER (Steam Deck & Handheld Ergonomics)            */}
      {/* ========================================================================= */}
      <footer className="sticky bottom-0 z-20 w-full border-t border-slate-800 bg-slate-950/95 backdrop-blur-md px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Back Button */}
          <button
            type="button"
            data-testid="wizard-nav-back"
            onClick={handleBack}
            className="min-h-[48px] px-5 py-2.5 rounded-xl border border-slate-800 bg-slate-900/90 hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-300 transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none flex items-center gap-1.5"
          >
            <span>◀</span>
            <span>{currentStage === 1 ? 'Title Menu' : 'Back'}</span>
          </button>

          {/* Stepper Progress Indicator */}
          <div className="text-xs text-slate-400 hidden sm:block">
            Step {currentStage} of 4 &middot;{' '}
            <span className="text-amber-300 font-medium">{STAGE_LABELS[currentStage]}</span>
          </div>

          {/* Next / Launch CTA Button */}
          {currentStage < 4 ? (
            <button
              type="button"
              data-testid="wizard-nav-next"
              disabled={currentStage === 3 && activeParty.length === 0}
              onClick={handleNext}
              className={`min-h-[48px] px-6 py-2.5 rounded-xl border text-xs sm:text-sm font-bold uppercase tracking-wider transition-all duration-200 flex items-center gap-2 focus:ring-2 focus:ring-amber-400 focus:outline-none ${
                currentStage === 3 && activeParty.length === 0
                  ? 'border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed opacity-50'
                  : 'border-amber-500 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)] cursor-pointer'
              }`}
            >
              <span>Next</span>
              <span>▶</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="wizard-launch-cta"
              disabled={activeParty.length === 0}
              onClick={handleLaunch}
              className="min-h-[50px] px-7 py-2.5 rounded-xl border border-amber-400 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-slate-950 text-xs sm:text-sm font-extrabold uppercase tracking-widest shadow-[0_0_24px_rgba(245,158,11,0.4)] transition-all duration-200 flex items-center gap-2 focus:ring-2 focus:ring-amber-400 focus:outline-none cursor-pointer"
            >
              <span>
                {selectedMode === 'campaign_kaelen'
                  ? 'EMBARK INTO THE CRYPT ⚔️'
                  : selectedMode === 'deep_descent'
                    ? 'DESCEND INTO THE DEPTHS 💀'
                    : 'ENTER THE ARENA 🛡️'}
              </span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
