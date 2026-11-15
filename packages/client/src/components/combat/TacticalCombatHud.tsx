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
  const [isPartyCollapsed, setIsPartyCollapsed] = useState(false);
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
      className={`relative flex flex-col w-full flex-1 min-h-[460px] bg-slate-950 text-slate-100 overflow-hidden select-none font-sans ${className}`}
    >
      {/* Top Header Bar */}
      <header
        data-testid="combat-hud-header"
        className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-950/90 border-b border-slate-800 backdrop-blur-md z-30 shrink-0"
      >
        <div className="flex items-center gap-3 shrink-0">
          {onToggleMenu && (
            <button
              type="button"
              data-testid={menuButtonTestId ?? "combat-hud-menu-btn"}
              onClick={onToggleMenu}
              className="px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              {menuButtonText ?? '☰ Menu'}
            </button>
          )}

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2
                data-testid="combat-hud-title"
                className="text-sm sm:text-base font-extrabold tracking-tight text-amber-400"
              >
                {title}
              </h2>
              {headerExtras}
            </div>
            {subtitle && (
              <span
                data-testid="combat-hud-subtitle"
                className="text-[11px] text-slate-400"
              >
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Initiative Ribbon in Header */}
        {combat ? (
          <div className="flex-1 max-w-4xl flex items-center justify-end gap-3">
            <InitiativeRibbon
              round={combat.round}
              phase={combat.phase}
              initiativeOrder={combat.initiativeOrder}
              combatants={viewState.combatants}
              activeCombatantId={activeCombatantId}
              selectedCombatantId={selectedCombatantId}
              onSelectCombatant={handleSelectCombatant}
            />

            {/* Sidebar Toggle Buttons */}
            <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-slate-800">
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
        ) : (
          <div className="text-xs text-slate-500 italic">No combat in progress</div>
        )}
      </header>

      {/* Middle Interactive Grid / Canvas Area with Floating HUD Sidebars */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Left Floating Party Portraits Panel */}
        <div className="absolute top-3 left-3 z-20 pointer-events-auto">
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

        {/* Center Viewport / Canvas Container */}
        <div
          data-testid="combat-hud-viewport-container"
          className="relative flex-1 w-full h-full bg-slate-950"
        >
          {children}
        </div>

        {/* Right Panel Slot (Custom or default Combat Log & Dice Tray) */}
        {rightPanel ? (
          <div
            data-testid="combat-hud-right-panel"
            className="absolute top-3 right-3 z-20 pointer-events-auto max-h-[calc(100%-24px)] flex flex-col"
          >
            {rightPanel}
          </div>
        ) : (internalShowLog || internalShowDiceTray) && (
          <div
            data-testid="combat-hud-right-panel"
            className="absolute top-3 right-3 z-20 pointer-events-auto w-72 sm:w-80 max-h-[calc(100%-24px)] flex flex-col gap-2.5 overflow-hidden shadow-2xl"
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

        {/* Reaction Interrupt Modal (Spec 03 Section 5.2 / Spec 05 Section 4.2) */}
        {pendingReactionPrompt && (
          <ReactionInterruptModal
            prompt={pendingReactionPrompt}
            reactorCombatant={reactorEntity}
            onResolve={(decision) => {
              if (onResolveReaction) {
                onResolveReaction(decision);
              }
            }}
          />
        )}
      </div>

      {/* Bottom Action Hotbar */}
      <div className="z-30 shrink-0">
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
  );
}
