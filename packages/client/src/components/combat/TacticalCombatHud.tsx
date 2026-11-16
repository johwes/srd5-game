import React, { useState } from 'react';
import { defaultCompendium } from '@srd5/data';
import type { DiceRollRecord } from '@srd5/engine';
import { ActionHotbar } from './ActionHotbar.js';
import { AnimatedDiceTray } from './AnimatedDiceTray.js';
import { CombatLog } from './CombatLog.js';
import { InitiativeRibbon } from './InitiativeRibbon.js';
import { PartyPortraits } from './PartyPortraits.js';
import { ReactionInterruptModal } from './ReactionInterruptModal.js';
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
  showCombatLog = true,
  showDiceTray = true,
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
  const [isPartyCollapsed, setIsPartyCollapsed] = useState(true);
  const [internalShowLog, setInternalShowLog] = useState(showCombatLog);
  const [internalShowDiceTray, setInternalShowDiceTray] = useState(showDiceTray);
  const [inspectedRoll, setInspectedRoll] = useState<DiceRollRecord | null>(null);

  const selectedCombatantId =
    controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;

  const handleSelectCombatant = (id: string) => {
    if (onSelectCombatant) {
      onSelectCombatant(id);
    } else {
      setInternalSelectedId(id);
    }
  };

  const handleToggleLog = () => {
    if (onToggleCombatLog) {
      onToggleCombatLog();
    } else {
      setInternalShowLog((prev) => !prev);
    }
  };

  const handleToggleDiceTray = () => {
    if (onToggleDiceTray) {
      onToggleDiceTray();
    } else {
      setInternalShowDiceTray((prev) => !prev);
    }
  };

  const handleInspectRoll = (roll: DiceRollRecord, label?: string) => {
    setInspectedRoll(roll);
    if (!internalShowDiceTray) {
      setInternalShowDiceTray(true);
    }
    if (onInspectRoll) {
      onInspectRoll(roll, label);
    }
  };

  const combat = viewState.combat;
  const activeCombatantId = combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;

  // Determine if active combatant belongs to current player's party or team
  const isPlayerControlled =
    controlledIsPlayerControlled !== undefined
      ? controlledIsPlayerControlled
      : Boolean(
          activeCombatant &&
            (activeCombatant.side === 'party' ||
              Boolean(viewState.party[activeCombatant.id]) ||
              (activeCombatant.playerId &&
                activeCombatant.playerId === viewState.playerId)),
        );

  const pendingReactionPrompt = combat?.pendingReactionPrompt ?? null;
  const reactorEntity = pendingReactionPrompt
    ? viewState.combatants[pendingReactionPrompt.reactorEntityId] ??
      viewState.party[pendingReactionPrompt.reactorEntityId] ??
      null
    : null;

  const currentActiveRoll = controlledActiveRoll ?? inspectedRoll;

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
                aria-pressed={internalShowLog}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                  internalShowLog
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
                title="Toggle Combat Log"
              >
                📜 Log
              </button>

              <button
                type="button"
                data-testid="combat-hud-toggle-dice-btn"
                onClick={handleToggleDiceTray}
                aria-pressed={internalShowDiceTray}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                  internalShowDiceTray
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
                title="Toggle Dice Tray"
              >
                🎲 Dice
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

      {/* 4. Right Panel Slot (Custom or default Combat Log & Dice Tray) */}
      {rightPanel ? (
        <div
          data-testid="combat-hud-right-panel"
          className="absolute top-14 right-2 sm:right-3 z-20 pointer-events-auto max-h-[calc(100%-190px)] flex flex-col"
        >
          {rightPanel}
        </div>
      ) : (internalShowLog || internalShowDiceTray) && (
        <div
          data-testid="combat-hud-right-panel"
          className="absolute top-14 right-2 sm:right-3 z-20 pointer-events-auto w-72 sm:w-80 max-h-[calc(100%-190px)] flex flex-col gap-2.5 overflow-hidden shadow-2xl"
        >
          {internalShowDiceTray && (
            <AnimatedDiceTray
              activeRoll={currentActiveRoll}
              rollHistory={rollHistory}
              onSelectHistoryRoll={(roll) => setInspectedRoll(roll)}
              onToggleCollapse={() => setInternalShowDiceTray(false)}
            />
          )}

          {internalShowLog && (
            <CombatLog
              events={events}
              combatants={viewState.combatants}
              onClearLog={onClearLog}
              onInspectRoll={handleInspectRoll}
            />
          )}
        </div>
      )}

      {/* 5. Reaction Interrupt Modal */}
      {pendingReactionPrompt && (
        <ReactionInterruptModal
          prompt={pendingReactionPrompt}
          reactorCombatant={reactorEntity}
          deadlineMs={viewState.combat?.reactionPromptDeadline}
          serverAuthoritativeTimeout={
            typeof viewState.combat?.reactionPromptDeadline === 'number'
          }
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
            onEndTurn={onEndTurn}
          />
        </div>
      </div>
    </div>
  );
}
