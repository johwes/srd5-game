import React, { useState } from 'react';
import type { SpellData } from '@srd5/data';
import type { DerivedWeaponAttackProfile } from '@srd5/engine';
import { GameIcon } from '../../canvas/assets/index.js';
import { formatSpellRange } from '../compendium/formatters.js';
import {
  formatSpellTargetingSummary,
  resolveSpellTargets,
} from '../../utils/combatTargeting.js';
import { TurnBudgetIndicator } from './TurnBudgetIndicator.js';
import type {
  ActionHotbarProps,
  CombatActionTab,
  StandardActionDefinition,
  StandardActionType,
} from './types.js';

export const STANDARD_ACTIONS: StandardActionDefinition[] = [
  {
    id: 'dash',
    name: 'Dash',
    actionCost: 'action',
    description: 'Gain extra movement equal to your speed for the current turn.',
    icon: '🏃',
  },
  {
    id: 'disengage',
    name: 'Disengage',
    actionCost: 'action',
    description: "Your movement doesn't provoke opportunity attacks for the rest of the turn.",
    icon: '💨',
  },
  {
    id: 'dodge',
    name: 'Dodge',
    actionCost: 'action',
    description: 'Attack rolls against you have disadvantage, and you make DEX saves with advantage.',
    icon: '🛡️',
  },
  {
    id: 'help',
    name: 'Help',
    actionCost: 'action',
    description: 'Give an ally advantage on their next ability check or attack roll.',
    icon: '🤝',
  },
  {
    id: 'hide',
    name: 'Hide',
    actionCost: 'action',
    description: 'Make a Dexterity (Stealth) check to conceal yourself from enemies.',
    icon: '👁️‍🗨️',
  },
  {
    id: 'search',
    name: 'Search',
    actionCost: 'action',
    description: 'Devote your attention to finding hidden creatures, traps, or secret doors.',
    icon: '🔍',
  },
  {
    id: 'stand_up',
    name: 'Stand Up',
    actionCost: 'movement',
    description: 'Stand up from prone, spending half of your movement speed.',
    icon: '🧍',
  },
  {
    id: 'drop_concentration',
    name: 'Drop Concentration',
    actionCost: 'free',
    description: 'End concentration on an active spell without spending an action.',
    icon: '🧠',
  },
  {
    id: 'action_surge',
    name: 'Action Surge',
    actionCost: 'free',
    description: 'Push beyond limits to gain one additional action this turn (Fighter feature).',
    icon: '⚡',
  },
];

export function ActionHotbar({
  activeCombatant,
  turnBudget,
  compendium,
  combatants,
  selectedCombatantId,
  isPlayerControlled = true,
  activeTab: controlledTab,
  onTabChange,
  onDeclareAttack,
  onCastSpell,
  onUseClassFeature,
  onStandardAction,
  onUseItem,
  onEndTurn,
  className = '',
}: ActionHotbarProps) {
  const [internalTab, setInternalTab] = useState<CombatActionTab>('attack');
  const [spellLevelFilter, setSpellLevelFilter] = useState<number | 'all'>('all');
  const [selectedSlotLevels, setSelectedSlotLevels] = useState<Record<string, number>>({});

  const activeTab = controlledTab ?? internalTab;
  const setTab = (tab: CombatActionTab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  const sheet = activeCombatant?.characterSheet;
  const attacks: DerivedWeaponAttackProfile[] = sheet?.weaponAttacks ?? [];
  const spellcasting = sheet?.spellcasting;

  // Compile full spell list
  const spellIds: string[] = Array.from(
    new Set([
      ...(spellcasting?.cantripIds ?? []),
      ...(spellcasting?.preparedOrKnownSpellIds ?? []),
      ...(spellcasting?.alwaysPreparedSpellIds ?? []),
    ]),
  );

  const spells: SpellData[] = compendium
    ? spellIds
        .map((id) => compendium.spells.find((s) => s.id === id))
        .filter((s): s is SpellData => Boolean(s))
    : [];

  const features = sheet?.activatedAbilities ?? [];

  // Filtered spells
  const filteredSpells =
    spellLevelFilter === 'all'
      ? spells
      : spells.filter((s) => s.level === spellLevelFilter);

  // Available spell slot levels
  const availableSlotLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((lvl) => {
    const slot = spellcasting?.spellSlots[lvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
    return slot && slot.available > 0;
  });

  const hasAction = (turnBudget?.action ?? 0) > 0;
  const hasBonusAction = (turnBudget?.bonusAction ?? 0) > 0;
  const hasExtraAttacks = (turnBudget?.extraAttacksRemaining ?? 0) > 0;
  const bonusActionSpellCast = Boolean(turnBudget?.bonusActionSpellCast);

  const handleHorizontalWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  return (
    <footer
      data-testid="action-hotbar"
      className={`flex flex-col items-center gap-1.5 select-none text-slate-100 ${className}`}
    >
      {/* Floating Action-Economy Pips (BG3 style) above the dock */}
      <div className="px-3 py-1 rounded-full bg-slate-950/80 border border-slate-800/80 backdrop-blur-md shadow-lg">
        <TurnBudgetIndicator
          turnBudget={turnBudget}
          speedFeet={activeCombatant?.speedFeet ?? 30}
        />
      </div>

      {/* Docked Hotbar */}
      <div className="flex items-stretch gap-3 px-3 py-2.5 max-w-full bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-amber-700/30 rounded-2xl backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
        {/* Active Hero Portrait */}
        <div className="flex flex-col items-center justify-center gap-1 w-24 shrink-0 pr-3 border-r border-slate-800">
          {activeCombatant ? (
            <>
              <div className="w-14 h-14 rounded-full bg-amber-500/15 border-2 border-amber-400 flex items-center justify-center font-black text-amber-300 text-xl shadow-[0_0_14px_rgba(251,191,36,0.45)]">
                {activeCombatant.name.charAt(0)}
              </div>
              <span
                data-testid="hotbar-active-hero-name"
                className="text-xs font-bold text-amber-300 truncate max-w-full"
              >
                {activeCombatant.name}
              </span>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-emerald-400"
                  style={{
                    width: `${activeCombatant.maxHp > 0 ? Math.max(0, Math.min(100, (activeCombatant.currentHp / activeCombatant.maxHp) * 100)) : 0}%`,
                  }}
                />
              </div>
              <span
                data-testid="hotbar-active-hero-hp"
                className="text-[11px] font-semibold text-slate-200"
              >
                HP {activeCombatant.currentHp}/{activeCombatant.maxHp}
              </span>
              <span className="text-[10px] text-slate-400">
                AC {activeCombatant.armorClass} &middot; {activeCombatant.speedFeet}ft
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-500 italic text-center">
              No combatant active
            </span>
          )}
        </div>

        {/* Tabs + Slot Grid */}
        <div className="flex flex-col gap-1.5 min-w-0 min-w-[320px] sm:min-w-[420px]">
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              type="button"
              data-testid="hotbar-tab-attack"
              aria-pressed={activeTab === 'attack'}
              onClick={() => setTab('attack')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                activeTab === 'attack'
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>⚔️</span>
              <span>Attack</span>
            <span className="text-[10px] text-slate-500">({attacks.length > 0 ? attacks.length : 1})</span>
            </button>
            <button
              type="button"
              data-testid="hotbar-tab-spells"
              aria-pressed={activeTab === 'spells'}
              onClick={() => setTab('spells')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                activeTab === 'spells'
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>✨</span>
              <span>Spells</span>
            <span className="text-[10px] text-slate-500">{spellIds.length > 0 && `(${spellIds.length})`}</span>
            </button>
            <button
              type="button"
              data-testid="hotbar-tab-features"
              aria-pressed={activeTab === 'features'}
              onClick={() => setTab('features')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                activeTab === 'features'
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>⭐</span>
              <span>Features</span>
            <span className="text-[10px] text-slate-500">{features.length > 0 && `(${features.length})`}</span>
            </button>
            <button
              type="button"
              data-testid="hotbar-tab-standard"
              aria-pressed={activeTab === 'standard'}
              onClick={() => setTab('standard')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                activeTab === 'standard'
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>🛡️</span>
              <span>Actions</span>
            </button>
            <button
              type="button"
              data-testid="hotbar-tab-items"
              aria-pressed={activeTab === 'items'}
              onClick={() => setTab('items')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                activeTab === 'items'
                  ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>🎒</span>
              <span>Items</span>
            </button>
          </div>
          <div className="overflow-hidden">
        {/* ATTACK TAB */}
        {activeTab === 'attack' && (
          <div
            data-testid="hotbar-panel-attack"
            onWheel={handleHorizontalWheel}
            className="flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center"
          >
            {attacks.length > 0 ? (
              attacks.map((wp) => {
                const isOffHand = wp.slot === 'off_hand';
                const canUse = isPlayerControlled && (isOffHand ? hasBonusAction : (hasAction || hasExtraAttacks));

                return (
                  <div
                    key={wp.id}
                    data-testid={`attack-action-card-${wp.id}`}
                    className="relative group shrink-0"
                  >
                    <button
                      type="button"
                      data-testid={`attack-btn-${wp.id}`}
                      disabled={!canUse}
                      onClick={() => onDeclareAttack?.(wp, { isOffHand })}
                      className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                        canUse
                          ? 'bg-slate-900 border-slate-700 hover:border-amber-400 hover:bg-slate-800 shadow-md hover:shadow-[0_0_12px_rgba(251,191,36,0.3)] cursor-pointer active:scale-95'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                      }`}
                      title={`${wp.name} (${wp.damageFormula})`}
                    >
                      <GameIcon name="attack" category="action" size={20} />
                      {/* Action Cost Pip */}
                      <span
                        className={`absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase ${
                          isOffHand ? 'bg-amber-600 text-slate-950 shadow' : 'bg-emerald-600 text-slate-950 shadow'
                        }`}
                      >
                        {isOffHand ? 'BA' : 'A'}
                      </span>
                      {/* To-Hit Badge */}
                      <span className="absolute -bottom-1 -right-1 px-1 py-0.2 rounded bg-slate-950 border border-slate-700 text-[9px] font-mono font-bold text-amber-300">
                        {wp.toHitBonus >= 0 ? `+${wp.toHitBonus}` : wp.toHitBonus}
                      </span>
                    </button>

                    {/* BG3 Floating Tooltip Card on Hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-950/95 border border-amber-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left">
                      <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5 mb-1.5">
                        <span className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                          <GameIcon name="attack" category="action" size={14} />
                          <span>{wp.name}</span>
                        </span>
                        <span className="text-[10px] text-slate-400 capitalize">
                          {isOffHand ? 'Bonus Action' : 'Action'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-emerald-400 font-mono mb-1">
                        <span>{wp.damageFormula} {wp.damageType}</span>
                        <span className="text-slate-400">{wp.rangeFeet ? `${wp.rangeFeet.normal}/${wp.rangeFeet.long}ft` : `${wp.reachFeet}ft reach`}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        To-hit bonus: <span className="text-amber-300 font-bold">{wp.toHitBonus >= 0 ? `+${wp.toHitBonus}` : wp.toHitBonus}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              /* Fallback Unarmed Strike */
              <div
                data-testid="attack-action-card-unarmed"
                className="relative group shrink-0"
              >
                <button
                  type="button"
                  data-testid="attack-btn-unarmed"
                  disabled={!isPlayerControlled || (!hasAction && !hasExtraAttacks)}
                  onClick={() =>
                    onDeclareAttack?.({
                      id: 'unarmed-strike',
                      weaponId: 'unarmed',
                      name: 'Unarmed Strike',
                      slot: 'main_hand',
                      rangeType: 'melee',
                      abilityUsed: 'str',
                      proficient: true,
                      toHitBonus: 2,
                      toHitBreakdown: [],
                      damageDice: '1',
                      damageBonus: 0,
                      damageBreakdown: [],
                      damageFormula: '1+STR',
                      damageType: 'bludgeoning',
                      properties: [],
                      reachFeet: 5,
                      critRange: 20,
                      isMagical: false,
                      actionCost: 'action',
                    })
                  }
                  className="relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border border-slate-700 bg-slate-900 hover:border-amber-400 hover:bg-slate-800 text-xs shadow-md transition-all cursor-pointer active:scale-95"
                  title="Unarmed Strike (1+STR)"
                >
                  <GameIcon name="attack" category="action" size={20} />
                  <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-emerald-600 text-slate-950 shadow">
                    A
                  </span>
                  <span className="absolute -bottom-1 -right-1 px-1 py-0.2 rounded bg-slate-950 border border-slate-700 text-[9px] font-mono font-bold text-amber-300">
                    +2
                  </span>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-3 bg-slate-950/95 border border-slate-700 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left">
                  <div className="font-bold text-slate-200 text-xs mb-1">Unarmed Strike</div>
                  <div className="text-xs text-emerald-400 font-mono">1 + STR bludgeoning &middot; 5ft reach</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SPELLS TAB */}
        {activeTab === 'spells' && (
          <div data-testid="hotbar-panel-spells" className="flex flex-col gap-2">
            {/* Slot Level Filters / Summary */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800/60 text-[11px]">
              <span className="text-slate-500 font-semibold uppercase text-[10px] mr-1">
                Slots:
              </span>
              <button
                type="button"
                data-testid="spell-filter-all"
                onClick={() => setSpellLevelFilter('all')}
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  spellLevelFilter === 'all'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                type="button"
                data-testid="spell-filter-0"
                onClick={() => setSpellLevelFilter(0)}
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  spellLevelFilter === 0
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                Cantrips (∞)
              </button>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lvl) => {
                const slot =
                  spellcasting?.spellSlots[
                    lvl as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
                  ];
                if (!slot || slot.max === 0) return null;

                return (
                  <button
                    key={lvl}
                    type="button"
                    data-testid={`spell-filter-${lvl}`}
                    onClick={() => setSpellLevelFilter(lvl)}
                    className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${
                      spellLevelFilter === lvl
                        ? 'bg-amber-500 text-slate-950'
                        : slot.available > 0
                          ? 'bg-slate-800 text-slate-300 hover:text-white'
                          : 'bg-slate-950 text-slate-600 border border-slate-800'
                    }`}
                  >
                    <span>L{lvl}:</span>
                    <span
                      className={`font-mono ${
                        slot.available > 0 ? 'text-amber-400' : 'text-slate-600'
                      }`}
                    >
                      {slot.available}/{slot.max}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bonus Action Spell Restriction Banner */}
            {bonusActionSpellCast && (
              <div
                data-testid="hotbar-cantrip-restriction-banner"
                className="px-2.5 py-1 rounded bg-purple-950/60 border border-purple-600 text-purple-300 text-[11px] flex items-center gap-1.5 shrink-0"
              >
                <span>⚠️</span>
                <span>
                  Bonus Action spell cast: You can only cast 1-action cantrips for the remainder of this turn (SRD 5.1).
                </span>
              </div>
            )}

            {/* Spells Slot Grid */}
            <div
              onWheel={handleHorizontalWheel}
              className="flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center"
            >
              {filteredSpells.length > 0 ? (
                filteredSpells.map((spell) => {
                  const isCantrip = spell.level === 0;
                  const isBonusActionTime = spell.castingTime.toLowerCase().includes('bonus');
                  const isReactionTime = spell.castingTime.toLowerCase().includes('reaction');
                  const isActionTime = !isBonusActionTime && !isReactionTime;

                  // Bonus action spell restriction rule
                  const blockedByBaRule = bonusActionSpellCast && !isCantrip;

                  // Check slot availability
                  const defaultSlot = selectedSlotLevels[spell.id] ?? (isCantrip ? 0 : spell.level);
                  const selectedSlotPool = !isCantrip
                    ? spellcasting?.spellSlots[
                        defaultSlot as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
                      ]
                    : null;
                  const hasSlots = isCantrip || (selectedSlotPool ? selectedSlotPool.available > 0 : false);

                  // Action economy check
                  const hasEconomy =
                    (isActionTime && hasAction) ||
                    (isBonusActionTime && hasBonusAction) ||
                    (isReactionTime && (turnBudget?.reactionAvailable ?? true));

                  const canCast = isPlayerControlled && hasEconomy && hasSlots && !blockedByBaRule;

                  const targetResolution =
                    activeCombatant && combatants
                      ? resolveSpellTargets({
                          spell,
                          slotLevel: defaultSlot,
                          caster: activeCombatant,
                          combatants,
                          selectedCombatantId,
                        })
                      : null;

                  const targetingSummary = formatSpellTargetingSummary(spell, targetResolution);

                  return (
                    <div
                      key={spell.id}
                      data-testid={`spell-action-card-${spell.id}`}
                      className="relative group shrink-0"
                    >
                      <button
                        type="button"
                        data-testid={`spell-cast-btn-${spell.id}`}
                        aria-label={`Cast ${spell.name}`}
                        disabled={!canCast}
                        onClick={() => onCastSpell?.(spell.id, defaultSlot)}
                        className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                          canCast
                            ? 'bg-slate-900 border-purple-800/80 hover:border-purple-400 hover:bg-purple-950/30 shadow-md hover:shadow-[0_0_12px_rgba(168,85,247,0.4)] cursor-pointer active:scale-95'
                            : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                        }`}
                        title={`${spell.name} (${spell.school})`}
                      >
                        <span className="sr-only">Cast {spell.name}</span>
                        <GameIcon name={spell.school} category="spell" size={20} />
                        {/* Action Cost Pip */}
                        <span
                          className={`absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase ${
                            isBonusActionTime
                              ? 'bg-amber-600 text-slate-950 shadow'
                              : isReactionTime
                                ? 'bg-sky-500 text-slate-950 shadow'
                                : 'bg-emerald-600 text-slate-950 shadow'
                          }`}
                        >
                          {isBonusActionTime ? 'BA' : isReactionTime ? 'R' : 'A'}
                        </span>
                        {/* Spell Slot Pip */}
                        <span className="absolute -bottom-1 -right-1 px-1 py-0.2 rounded bg-purple-950 border border-purple-600 text-[9px] font-mono font-bold text-purple-200">
                          {isCantrip ? '∞' : `L${defaultSlot}`}
                        </span>
                      </button>

                      {/* BG3 Floating Tooltip Card on Hover */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-slate-950/95 border border-purple-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
                          <span className="font-bold text-slate-100 text-xs flex items-center gap-1.5">
                            <GameIcon name={spell.school} category="spell" size={14} />
                            <span>{spell.name}</span>
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-purple-950 border border-purple-700 text-[10px] font-semibold text-purple-300 shrink-0">
                            {isCantrip ? 'Cantrip' : `Level ${spell.level}`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="capitalize">{spell.school}</span>
                          <span className="text-amber-400">{spell.castingTime}</span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 gap-1">
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate ${targetingSummary.badgeStyle}`}
                            title={targetingSummary.badgeLabel}
                          >
                            {targetingSummary.badgeLabel}
                          </span>
                          {spell.concentration && (
                            <span className="px-1 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-300 font-bold shrink-0">
                              Conc.
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800/80">
                          <span className="text-slate-500 font-medium shrink-0">Target:</span>
                          <span
                            className="font-semibold text-slate-200 truncate ml-1 text-right"
                            title={targetingSummary.previewLabel}
                          >
                            {targetingSummary.previewLabel}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400">
                          Range: <span className="text-slate-200">{formatSpellRange(spell.targeting)}</span>
                        </div>

                        {/* Slot Picker if Upcastable */}
                        {!isCantrip && availableSlotLevels.length > 0 && (
                          <div
                            className="flex items-center justify-between pt-1.5 border-t border-slate-800 mt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] text-slate-400">Cast at level:</span>
                            <select
                              data-testid={`spell-slot-select-${spell.id}`}
                              value={defaultSlot}
                              onChange={(e) => {
                                e.stopPropagation();
                                setSelectedSlotLevels((prev) => ({
                                  ...prev,
                                  [spell.id]: Number(e.target.value),
                                }));
                              }}
                              className="bg-slate-900 border border-purple-700/80 rounded px-1.5 py-0.5 text-xs text-purple-200 cursor-pointer"
                            >
                              {availableSlotLevels
                                .filter((lvl) => lvl >= spell.level)
                                .map((lvl) => (
                                  <option key={lvl} value={lvl}>
                                    Level {lvl} Slot
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-slate-500 italic p-2">
                  No spells available for this level.
                </div>
              )}
            </div>
          </div>
        )}

        {/* CLASS FEATURES TAB */}
        {activeTab === 'features' && (
          <div
            data-testid="hotbar-panel-features"
            onWheel={handleHorizontalWheel}
            className="flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center"
          >
            {features.length > 0 ? (
              features.map((feat) => {
                const canUse = isPlayerControlled && (feat.actionCost === 'bonus_action' ? hasBonusAction : hasAction);

                return (
                  <div
                    key={feat.id}
                    data-testid={`feature-action-card-${feat.id}`}
                    className="relative group shrink-0"
                  >
                    <button
                      type="button"
                      data-testid={`feature-btn-${feat.id}`}
                      disabled={!canUse}
                      onClick={() => onUseClassFeature?.(feat.id)}
                      className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                        canUse
                          ? 'bg-slate-900 border-slate-700 hover:border-amber-400 hover:bg-slate-800 shadow-md hover:shadow-[0_0_12px_rgba(251,191,36,0.3)] cursor-pointer active:scale-95'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                      }`}
                      title={`${feat.name} (${feat.actionCost})`}
                    >
                      <span className="text-lg">⭐</span>
                      <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-amber-600 text-slate-950 shadow">
                        {feat.actionCost === 'bonus_action' ? 'BA' : 'A'}
                      </span>
                    </button>

                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-950/95 border border-amber-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                        <span className="font-bold text-amber-300 text-xs">{feat.name}</span>
                        <span className="text-[10px] text-slate-400 capitalize">{feat.actionCost.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{feat.description ?? 'Class feature ability'}</p>
                      {feat.resourceCost && (
                        <div className="text-[10px] text-slate-400 border-t border-slate-800 pt-1">
                          Resource cost: {feat.resourceCost.amount} use
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-slate-500 italic p-2">
                No active class features with direct actions unlocked yet.
              </div>
            )}
          </div>
        )}

        {/* STANDARD ACTIONS TAB */}
        {activeTab === 'standard' && (
          <div
            data-testid="hotbar-panel-standard"
            onWheel={handleHorizontalWheel}
            className="flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center"
          >
            {STANDARD_ACTIONS.map((action) => {
              const requiresAction = action.actionCost === 'action';
              const requiresBonus = action.actionCost === 'bonus_action';
              const canUse =
                isPlayerControlled &&
                (!requiresAction || hasAction) &&
                (!requiresBonus || hasBonusAction);

              return (
                <div
                  key={action.id}
                  data-testid={`standard-action-card-${action.id}`}
                  className="relative group shrink-0"
                >
                  <button
                    type="button"
                    data-testid={`standard-action-btn-${action.id}`}
                    disabled={!canUse}
                    onClick={() => onStandardAction?.(action.id)}
                    className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                      canUse
                        ? 'bg-slate-900 border-slate-700 hover:border-sky-400 hover:bg-slate-800 shadow-md hover:shadow-[0_0_12px_rgba(56,189,248,0.3)] cursor-pointer active:scale-95'
                        : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                    }`}
                    title={`${action.name} (${action.actionCost})`}
                  >
                    <GameIcon name={action.id} category="action" size={20} />
                    <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-sky-600 text-slate-950 shadow">
                      {action.actionCost === 'bonus_action' ? 'BA' : action.actionCost === 'movement' ? 'M' : action.actionCost === 'free' ? 'F' : 'A'}
                    </span>
                  </button>

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-950/95 border border-sky-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                      <span className="font-bold text-sky-300 text-xs flex items-center gap-1.5">
                        <GameIcon name={action.id} category="action" size={14} />
                        <span>{action.name}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 capitalize">{action.actionCost}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{action.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ITEMS TAB */}
        {activeTab === 'items' && (
          <div
            data-testid="hotbar-panel-items"
            onWheel={handleHorizontalWheel}
            className="flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center"
          >
            {/* Standard Potion of Healing */}
            <div
              data-testid="item-card-potion-healing"
              className="relative group shrink-0"
            >
              <button
                type="button"
                data-testid="item-use-btn-potion-healing"
                disabled={!isPlayerControlled || !hasAction}
                onClick={() => onUseItem?.('potion-of-healing')}
                className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                  isPlayerControlled && hasAction
                    ? 'bg-slate-900 border-slate-700 hover:border-emerald-400 hover:bg-slate-800 shadow-md hover:shadow-[0_0_12px_rgba(52,211,153,0.3)] cursor-pointer active:scale-95'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                }`}
                title="Potion of Healing (2d4+2 HP)"
              >
                <GameIcon name="potion" category="item" size={20} />
                <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-emerald-600 text-slate-950 shadow">
                  A
                </span>
              </button>

              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 p-3 bg-slate-950/95 border border-emerald-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="font-bold text-emerald-300 text-xs">Potion of Healing</span>
                  <span className="text-[10px] text-slate-400">Action</span>
                </div>
                <p className="text-[11px] text-emerald-400">Drink or administer to regain 2d4 + 2 Hit Points.</p>
              </div>
            </div>

            {/* Potion of Greater Healing */}
            <div
              data-testid="item-card-potion-greater-healing"
              className="relative group shrink-0"
            >
              <button
                type="button"
                data-testid="item-use-btn-potion-greater-healing"
                disabled={!isPlayerControlled || !hasAction}
                onClick={() => onUseItem?.('potion-of-greater-healing')}
                className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center border transition-all ${
                  isPlayerControlled && hasAction
                    ? 'bg-slate-900 border-slate-700 hover:border-emerald-400 hover:bg-slate-800 shadow-md hover:shadow-[0_0_12px_rgba(52,211,153,0.3)] cursor-pointer active:scale-95'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-600 cursor-not-allowed opacity-50'
                }`}
                title="Potion of Greater Healing (4d4+4 HP)"
              >
                <GameIcon name="potion" category="item" size={20} />
                <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-emerald-600 text-slate-950 shadow">
                  A
                </span>
              </button>

              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 p-3 bg-slate-950/95 border border-emerald-500/40 rounded-xl shadow-2xl backdrop-blur-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 text-left flex flex-col gap-1">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="font-bold text-emerald-300 text-xs">Potion of Greater Healing</span>
                  <span className="text-[10px] text-slate-400">Action</span>
                </div>
                <p className="text-[11px] text-emerald-400">Drink or administer to regain 4d4 + 4 Hit Points.</p>
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
        {/* End Turn */}
        <div className="flex items-center pl-3 border-l border-slate-800 shrink-0">
          <button
            type="button"
            data-testid="hotbar-end-turn-btn"
            disabled={!isPlayerControlled || !activeCombatant}
            onClick={onEndTurn}
            className={`flex flex-col items-center justify-center gap-0.5 w-20 h-16 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all shadow-md ${
              isPlayerControlled && activeCombatant
                ? 'bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 active:scale-95 shadow-amber-500/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
            }`}
          >
            <span className="text-lg leading-none">&raquo;</span>
            <span>End Turn</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
