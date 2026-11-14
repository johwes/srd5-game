import React, { useState } from 'react';
import { defaultCompendium } from '@srd5/data';
import { ActionHotbar } from './ActionHotbar.js';
import { InitiativeRibbon } from './InitiativeRibbon.js';
import { PartyPortraits } from './PartyPortraits.js';
import type { TacticalCombatHudProps } from './types.js';

export function TacticalCombatHud({
  viewState,
  compendium = defaultCompendium,
  selectedCombatantId: controlledSelectedId,
  title = 'Tactical Combat',
  subtitle,
  onSelectCombatant,
  onOpenCharacterSheet,
  onDeclareAttack,
  onCastSpell,
  onUseClassFeature,
  onStandardAction,
  onUseItem,
  onEndTurn,
  onToggleMenu,
  children,
  rightPanel,
  className = '',
}: TacticalCombatHudProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    null,
  );
  const [isPartyCollapsed, setIsPartyCollapsed] = useState(false);

  const selectedCombatantId =
    controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;

  const handleSelectCombatant = (id: string) => {
    if (onSelectCombatant) {
      onSelectCombatant(id);
    } else {
      setInternalSelectedId(id);
    }
  };

  const combat = viewState.combat;
  const activeCombatantId = combat?.activeCombatantId ?? null;
  const activeCombatant = activeCombatantId
    ? viewState.combatants[activeCombatantId] ?? null
    : null;

  // Determine if active combatant belongs to current player's party or team
  const isPlayerControlled = Boolean(
    activeCombatant &&
      (activeCombatant.side === 'party' ||
        Boolean(viewState.party[activeCombatant.id])),
  );

  return (
    <div
      data-testid="tactical-combat-hud"
      className={`relative flex flex-col w-full h-full min-h-[600px] bg-slate-950 text-slate-100 overflow-hidden select-none font-sans ${className}`}
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
              data-testid="combat-hud-menu-btn"
              onClick={onToggleMenu}
              className="px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              ☰ Menu
            </button>
          )}

          <div className="flex flex-col">
            <h2
              data-testid="combat-hud-title"
              className="text-sm sm:text-base font-extrabold tracking-tight text-amber-400"
            >
              {title}
            </h2>
            {subtitle && (
              <span className="text-[11px] text-slate-400">{subtitle}</span>
            )}
          </div>
        </div>

        {/* Initiative Ribbon in Header */}
        {combat ? (
          <div className="flex-1 max-w-4xl flex justify-end">
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

        {/* Right Panel Slot (Combat Log, Dice Tray, Inspector - SRD-407) */}
        {rightPanel && (
          <div
            data-testid="combat-hud-right-panel"
            className="absolute top-3 right-3 z-20 pointer-events-auto max-h-[calc(100%-24px)] flex flex-col"
          >
            {rightPanel}
          </div>
        )}
      </div>

      {/* Bottom Action Hotbar */}
      <div className="z-30 shrink-0">
        <ActionHotbar
          activeCombatant={activeCombatant}
          turnBudget={combat?.turnBudget ?? null}
          compendium={compendium}
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
