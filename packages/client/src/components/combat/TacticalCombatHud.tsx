import React, { useRef, useState } from 'react';
import { defaultCompendium } from '@srd5/data';
import type { DiceRollRecord } from '@srd5/engine';
import { ActionHotbar } from './ActionHotbar.js';
import { AnimatedDiceTray } from './AnimatedDiceTray.js';
import { CombatLog } from './CombatLog.js';
import { InitiativeRibbon } from './InitiativeRibbon.js';
import { SelectedEnemyCard } from './SelectedEnemyCard.js';
import { PartyPortraits } from './PartyPortraits.js';
import { GameIcon } from '../../canvas/assets/index.js';
import { ReactionInterruptModal } from './ReactionInterruptModal.js';
import {
  decideReactionPromptAction,
  getReactionPoliciesForCharacterSync,
  setReactionPolicySync,
  type ReactionPolicyMode,
} from '../../persistence/reactionPolicies.js';
import { playerControlsViewEntity } from '../../utils/summonPresentation.js';
import type { TacticalCombatHudProps } from './types.js';

export function TacticalCombatHud({
  viewState,
  compendium = defaultCompendium,
  selectedCombatantId: controlledSelectedId,
  isPlayerControlled: controlledIsPlayerControlled,
  title = 'Tactical Combat',
  subtitle,
  menuButtonText,
  menuButtonTestId,
  headerExtras,
  events = [],
  activeRoll: controlledActiveRoll,
  rollHistory = [],
  defaultShowCombatLog = true,
  defaultShowDiceTray = true,
  onToggleCombatLog,
  onToggleDiceTray,
  onSelectCombatant,
  onOpenCharacterSheet,
  onLevelUpCharacter,
  onDeclareAttack,
  onCastSpell,
  onUseClassFeature,
  onStandardAction,
  onUseItem,
  onUseSummonAction,
  onDismissSummon,
  onEndTurn,
  onToggleMenu,
  onResolveReaction,
  onClearLog,
  onInspectRoll,
  children,
  rightPanel,
  className = '',
}: TacticalCombatHudProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    null,
  );
  const [isPartyCollapsed, setIsPartyCollapsed] = useState(false);
  const [internalShowLog, setInternalShowLog] = useState(defaultShowCombatLog);
  const [internalShowDiceTray, setInternalShowDiceTray] = useState(defaultShowDiceTray);
  const [inspectedRoll, setInspectedRoll] = useState<DiceRollRecord | null>(null);

  const selectedCombatantId =
    controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;

  // Single ownership: the HUD owns panel visibility; parents that passed
  // onToggle* callbacks are notified after each toggle (no mirrored state).
  const effectiveShowLog = internalShowLog;
  const effectiveShowDiceTray = internalShowDiceTray;

  const handleSelectCombatant = (id: string) => {
    if (onSelectCombatant) {
      onSelectCombatant(id);
    } else {
      setInternalSelectedId(id);
    }
  };

  const handleToggleLog = () => {
    setInternalShowLog((prev) => {
      onToggleCombatLog?.(!prev);
      return !prev;
    });
  };

  const handleToggleDiceTray = () => {
    setInternalShowDiceTray((prev) => {
      onToggleDiceTray?.(!prev);
      return !prev;
    });
  };

  const handleCollapseDiceTray = () => {
    setInternalShowDiceTray(false);
    onToggleDiceTray?.(false);
  };

  const handleInspectRoll = (roll: DiceRollRecord, label?: string) => {
    setInspectedRoll(roll);
    setInternalShowDiceTray((prev) => {
      if (!prev) onToggleDiceTray?.(true);
      return true;
    });
    if (onInspectRoll) {
      onInspectRoll(roll, label);
    }
  };

  const combat = viewState.combat;
  const activeCombatantId = combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;

  // Determine if the active combatant belongs to the current player. SRD-904:
  // commanded summons are controlled transitively through their caster chain,
  // so the authority check wins over a host's coarse side-based override.
  const summonControlled = activeCombatant?.isSummon
    ? playerControlsViewEntity(activeCombatant, viewState)
    : null;
  const isPlayerControlled =
    summonControlled !== null
      ? summonControlled
      : controlledIsPlayerControlled !== undefined
        ? controlledIsPlayerControlled
        : playerControlsViewEntity(activeCombatant, viewState);

  const pendingReactionPrompt = combat?.pendingReactionPrompt ?? null;
  const reactorEntity = pendingReactionPrompt
    ? viewState.combatants[pendingReactionPrompt.reactorEntityId] ??
      viewState.party[pendingReactionPrompt.reactorEntityId] ??
      null
    : null;

  // SRD-1509: client-side policy over the prompt flow. The sync mirror keeps
  // this render-cheap; flips bump `policyTick` so the modal badge updates
  // mid-fight without waiting on IndexedDB.
  const [policyTick, setPolicyTick] = useState(0);
  void policyTick;
  const autoResolvedPromptRef = useRef<string | null>(null);
  const reactorPolicyId = pendingReactionPrompt?.reactorEntityId ?? null;
  const reactorPolicies = reactorPolicyId
    ? getReactionPoliciesForCharacterSync(reactorPolicyId)
    : {};
  const policyDecision = pendingReactionPrompt
    ? decideReactionPromptAction(pendingReactionPrompt, reactorPolicies)
    : { action: 'show' as const };

  // Auto/Off bypass the modal entirely (first valid option / immediate pass).
  // Guarded per promptId so StrictMode double-effects resolve exactly once.
  React.useEffect(() => {
    if (!pendingReactionPrompt || !reactorPolicyId) return;
    if (policyDecision.action === 'show') return;
    if (autoResolvedPromptRef.current === pendingReactionPrompt.promptId) return;
    autoResolvedPromptRef.current = pendingReactionPrompt.promptId;
    if (policyDecision.action === 'auto') {
      onResolveReaction?.({
        execute: true,
        reactionId: policyDecision.reactionId,
        ...(policyDecision.slotLevel !== undefined ? { slotLevel: policyDecision.slotLevel } : {}),
      });
    } else {
      onResolveReaction?.({ execute: false });
    }
  }, [pendingReactionPrompt, reactorPolicyId, policyDecision, onResolveReaction]);
  // Reset the guard when the prompt clears so the next prompt auto-resolves.
  React.useEffect(() => {
    if (!pendingReactionPrompt) autoResolvedPromptRef.current = null;
  }, [pendingReactionPrompt]);

  const handleReactionPolicyChange = (reactionKey: string, mode: ReactionPolicyMode) => {
    if (!reactorPolicyId) return;
    setReactionPolicySync(reactorPolicyId, reactionKey, mode);
    setPolicyTick((t) => t + 1);
  };

  const currentActiveRoll = controlledActiveRoll ?? inspectedRoll;

  // BG3-style selected-enemy card: show when the selection is a hostile (or
  // any non-party) combatant, mirroring the "Klaw" card in the references.
  const selectedCombatant =
    selectedCombatantId != null
      ? (viewState.combatants[selectedCombatantId] ??
        viewState.party[selectedCombatantId] ??
        null)
      : null;
  const showEnemyCard =
    selectedCombatant != null && selectedCombatant.side !== 'party';

  return (
    <div
      data-testid="tactical-combat-hud"
      className={`relative w-full h-full min-h-[460px] bg-slate-950 text-slate-100 overflow-hidden select-none font-sans ${className}`}
    >
      {/* 1. Full-Bleed 100% Interactive Grid / Canvas Area */}
      <div
        data-testid="combat-hud-viewport-container"
        className={`absolute inset-0 z-0 w-full h-full overflow-hidden ${
          children ? 'bg-slate-950 pointer-events-auto' : 'bg-transparent pointer-events-none'
        }`}
      >
        {children}
      </div>

      {/* 2. Floating Top Header Pill Overlay */}
      <header
        data-testid="combat-hud-header"
        className="absolute top-2 inset-x-2 sm:inset-x-3 z-30 flex items-center justify-between gap-2 pointer-events-none"
      >
        <div className="flex items-center gap-2 pointer-events-auto max-w-[24vw] overflow-hidden bg-slate-950/85 backdrop-blur-md border border-slate-800/80 rounded-xl px-2.5 py-1.5 shadow-lg">
          {onToggleMenu && (
            <button
              type="button"
              data-testid={menuButtonTestId ?? "combat-hud-menu-btn"}
              onClick={onToggleMenu}
              className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              {menuButtonText ?? '☰ Menu'}
            </button>
          )}

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h2
                data-testid="combat-hud-title"
                className="text-xs sm:text-sm font-extrabold tracking-tight text-amber-400 truncate"
              >
                {title}
              </h2>
              <div className="hidden xl:block">{headerExtras}</div>
            </div>
            {subtitle && (
              <span
                data-testid="combat-hud-subtitle"
                className="text-[10px] text-slate-400 hidden sm:inline"
              >
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Initiative Ribbon: centered top, BG3 style */}
        {combat ? (
          <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2 top-0 flex items-center gap-2 bg-gradient-to-b from-slate-950/90 to-slate-950/60 backdrop-blur-md border border-slate-800/70 rounded-2xl px-3 py-1 shadow-lg max-w-[55vw]">
            <InitiativeRibbon
              round={combat.round}
              phase={combat.phase}
              initiativeOrder={combat.initiativeOrder}
              combatants={viewState.combatants}
              activeCombatantId={activeCombatantId}
              selectedCombatantId={selectedCombatantId}
              onSelectCombatant={handleSelectCombatant}
            />
          </div>
        ) : (
          <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2 text-xs text-slate-500 italic bg-slate-950/85 px-2.5 py-1 rounded-xl border border-slate-800/80">
            No combat in progress
          </div>
        )}

        {/* Right utility pill: Log / Dice */}
        <div className="pointer-events-auto ml-auto flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md border border-slate-800/80 rounded-xl px-2 py-1.5 shadow-lg">
            <div className="contents">
              <button
                type="button"
                data-testid="combat-hud-toggle-log-btn"
                onClick={handleToggleLog}
                aria-pressed={effectiveShowLog}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                  effectiveShowLog
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
                title="Toggle Combat Log"
              >
                <GameIcon name="tied-scroll" category="raw" size={14} /> Log
              </button>

              <button
                type="button"
                data-testid="combat-hud-toggle-dice-btn"
                onClick={handleToggleDiceTray}
                aria-pressed={effectiveShowDiceTray}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                  effectiveShowDiceTray
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
                title="Toggle Dice Tray"
              >
                <GameIcon name="dice-shield" category="raw" size={14} /> Dice
              </button>
            </div>
        </div>
      </header>

      {/* 3. Left Floating Party Portraits Panel */}
      <div className="absolute top-1/2 -translate-y-1/2 left-2 sm:left-3 z-20 pointer-events-auto">
        <PartyPortraits
          party={viewState.party}
          activeCombatantId={activeCombatantId}
          selectedCombatantId={selectedCombatantId}
          onSelectPartyMember={handleSelectCombatant}
          onOpenCharacterSheet={onOpenCharacterSheet}
          onLevelUpCharacter={onLevelUpCharacter}
          collapsed={isPartyCollapsed}
          onToggleCollapse={() => setIsPartyCollapsed(!isPartyCollapsed)}
        />
      </div>

      {/* 3b. BG3-style Selected-Enemy Card (top-center, under the ribbon).
          Turn order lives in the ribbon above; the card shows details for the
          current selection only. */}
      {showEnemyCard && selectedCombatant && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20">
          <SelectedEnemyCard
            combatant={selectedCombatant}
            onClose={() => handleSelectCombatant(activeCombatantId ?? '')}
            onOpenCharacterSheet={onOpenCharacterSheet}
          />
        </div>
      )}

      {/* 4. Right Panel Slot (Custom or default Combat Log & Dice Tray) */}
      {rightPanel ? (
        <div
          data-testid="combat-hud-right-panel"
          className="absolute top-14 right-2 sm:right-3 z-20 pointer-events-auto max-h-[calc(100%-190px)] flex flex-col"
        >
          {rightPanel}
        </div>
      ) : (effectiveShowLog || effectiveShowDiceTray) && (
        <div
          data-testid="combat-hud-right-panel"
          className="absolute top-14 right-2 sm:right-3 z-20 pointer-events-auto w-72 sm:w-80 max-h-[calc(100%-190px)] flex flex-col gap-2.5 overflow-hidden shadow-2xl"
        >
          {effectiveShowDiceTray && (
            <AnimatedDiceTray
              activeRoll={currentActiveRoll}
              rollHistory={rollHistory}
              onSelectHistoryRoll={(roll) => setInspectedRoll(roll)}
              onToggleCollapse={handleCollapseDiceTray}
            />
          )}

          {effectiveShowLog && (
            <CombatLog
              events={events}
              combatants={viewState.combatants}
              onClearLog={onClearLog}
              onInspectRoll={handleInspectRoll}
            />
          )}
        </div>
      )}

      {/* 5. Reaction Interrupt Modal (suppressed when policy auto-resolves) */}
      {pendingReactionPrompt && policyDecision.action === 'show' && (
        <ReactionInterruptModal
          prompt={pendingReactionPrompt}
          reactorCombatant={reactorEntity}
          deadlineMs={viewState.combat?.reactionPromptDeadline}
          serverAuthoritativeTimeout={
            typeof viewState.combat?.reactionPromptDeadline === 'number'
          }
          policies={reactorPolicies}
          onPolicyChange={handleReactionPolicyChange}
          onResolve={(decision) => {
            if (onResolveReaction) {
              onResolveReaction(decision);
            }
          }}
        />
      )}

      {/* 6. Floating Docked Bottom Action Hotbar */}
      <div className="absolute bottom-2 inset-x-2 z-30 flex justify-center pointer-events-none">
        <div className="pointer-events-auto max-w-full">
          <ActionHotbar
            activeCombatant={activeCombatant}
            turnBudget={combat?.turnBudget ?? null}
            compendium={compendium}
            combatants={viewState.combatants}
            selectedCombatantId={selectedCombatantId}
            isPlayerControlled={isPlayerControlled}
            onDeclareAttack={onDeclareAttack}
            onCastSpell={onCastSpell}
            onUseClassFeature={onUseClassFeature}
            onStandardAction={onStandardAction}
            onUseItem={onUseItem}
            onUseSummonAction={onUseSummonAction}
            onDismissSummon={onDismissSummon}
            onEndTurn={onEndTurn}
            onOpenCharacterSheet={onOpenCharacterSheet}
          />
        </div>
      </div>
    </div>
  );
}
