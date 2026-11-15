import React, { useState } from 'react';
import type { SpellData } from '@srd5/data';
import type { DerivedWeaponAttackProfile } from '@srd5/engine';
import { GameIcon } from '../../canvas/assets/index.js';
import { formatSpellRange } from '../compendium/formatters.js';
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

  return (
    <footer
      data-testid="action-hotbar"
      className={`flex flex-col bg-slate-950/95 border-t border-slate-800 backdrop-blur-md shadow-2xl select-none text-slate-100 ${className}`}
    >
      {/* Top Bar: Active Combatant Status, Turn Budget & End Turn Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-slate-800/80 bg-slate-900/60">
        {/* Active Hero Summary */}
        <div className="flex items-center gap-2.5">
          {activeCombatant ? (
            <>
              <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-400 flex items-center justify-center font-bold text-amber-300 text-xs shrink-0 shadow">
                {activeCombatant.name.charAt(0)}
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    data-testid="hotbar-active-hero-name"
                    className="text-xs font-bold text-amber-300 truncate"
                  >
                    {activeCombatant.name}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-400 text-[9px] font-black uppercase">
                    Your Turn
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span
                    data-testid="hotbar-active-hero-hp"
                    className="font-semibold text-slate-200"
                  >
                    HP {activeCombatant.currentHp}/{activeCombatant.maxHp}
                  </span>
                  <span>&middot;</span>
                  <span>AC {activeCombatant.armorClass}</span>
                  <span>&middot;</span>
                  <span>Speed {activeCombatant.speedFeet}ft</span>
                </div>
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-500 italic">No combatant active</span>
          )}
        </div>

        {/* Turn Budget Indicator */}
        <div className="flex-1 max-w-2xl flex justify-center">
          <TurnBudgetIndicator
            turnBudget={turnBudget}
            speedFeet={activeCombatant?.speedFeet ?? 30}
          />
        </div>

        {/* End Turn Button */}
        <div>
          <button
            type="button"
            data-testid="hotbar-end-turn-btn"
            disabled={!isPlayerControlled || !activeCombatant}
            onClick={onEndTurn}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all shadow-md ${
              isPlayerControlled && activeCombatant
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95 shadow-amber-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
            }`}
          >
            <span>End Turn</span>
            <span>&raquo;</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-slate-800 bg-slate-900/40 overflow-x-auto">
        <button
          type="button"
          data-testid="hotbar-tab-attack"
          aria-pressed={activeTab === 'attack'}
          onClick={() => setTab('attack')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors border-t border-x ${
            activeTab === 'attack'
              ? 'bg-slate-900 border-slate-700 text-amber-400 border-b-transparent shadow'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
          }`}
        >
          <span>⚔️</span>
          <span>Attack</span>
          <span className="text-[10px] text-slate-500">
            ({attacks.length > 0 ? attacks.length : 1})
          </span>
        </button>

        <button
          type="button"
          data-testid="hotbar-tab-spells"
          aria-pressed={activeTab === 'spells'}
          onClick={() => setTab('spells')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors border-t border-x ${
            activeTab === 'spells'
              ? 'bg-slate-900 border-slate-700 text-amber-400 border-b-transparent shadow'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
          }`}
        >
          <span>✨</span>
          <span>Spells</span>
          {spellIds.length > 0 && (
            <span className="text-[10px] text-slate-500">({spellIds.length})</span>
          )}
        </button>

        <button
          type="button"
          data-testid="hotbar-tab-features"
          aria-pressed={activeTab === 'features'}
          onClick={() => setTab('features')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors border-t border-x ${
            activeTab === 'features'
              ? 'bg-slate-900 border-slate-700 text-amber-400 border-b-transparent shadow'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
          }`}
        >
          <span>⭐</span>
          <span>Features</span>
          {features.length > 0 && (
            <span className="text-[10px] text-slate-500">({features.length})</span>
          )}
        </button>

        <button
          type="button"
          data-testid="hotbar-tab-standard"
          aria-pressed={activeTab === 'standard'}
          onClick={() => setTab('standard')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors border-t border-x ${
            activeTab === 'standard'
              ? 'bg-slate-900 border-slate-700 text-amber-400 border-b-transparent shadow'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
          }`}
        >
          <span>🛡️</span>
          <span>Standard Actions</span>
        </button>

        <button
          type="button"
          data-testid="hotbar-tab-items"
          aria-pressed={activeTab === 'items'}
          onClick={() => setTab('items')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors border-t border-x ${
            activeTab === 'items'
              ? 'bg-slate-900 border-slate-700 text-amber-400 border-b-transparent shadow'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
          }`}
        >
          <span>🎒</span>
          <span>Items</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="p-3 bg-slate-900/80 min-h-[110px] max-h-[180px] overflow-y-auto scrollbar-thin">
        {/* ATTACK TAB */}
        {activeTab === 'attack' && (
          <div data-testid="hotbar-panel-attack" className="flex flex-wrap gap-2">
            {attacks.length > 0 ? (
              attacks.map((wp) => {
                const isOffHand = wp.slot === 'off_hand';
                const canUse = isPlayerControlled && (isOffHand ? hasBonusAction : (hasAction || hasExtraAttacks));

                return (
                  <div
                    key={wp.id}
                    data-testid={`attack-action-card-${wp.id}`}
                    className={`flex flex-col justify-between p-2 rounded-lg border min-w-[190px] max-w-[260px] text-xs transition-colors ${
                      canUse
                        ? 'bg-slate-950/80 border-slate-700 hover:border-amber-500'
                        : 'bg-slate-950/40 border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-slate-200 truncate flex items-center gap-1.5">
                        <GameIcon name="attack" category="action" size={14} />
                        <span>{wp.name}</span>
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300">
                        {wp.toHitBonus >= 0 ? `+${wp.toHitBonus}` : wp.toHitBonus} to hit
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                      <span className="font-mono text-emerald-400">
                        {wp.damageFormula} {wp.damageType}
                      </span>
                      <span>{wp.rangeFeet ? `${wp.rangeFeet.normal}/${wp.rangeFeet.long}ft` : `${wp.reachFeet}ft`}</span>
                    </div>

                    <div className="flex items-center justify-between gap-1 mt-auto pt-1 border-t border-slate-800">
                      <span className="text-[10px] text-slate-500 capitalize">
                        {isOffHand ? 'Bonus Action' : 'Action'}
                      </span>
                      <button
                        type="button"
                        data-testid={`attack-btn-${wp.id}`}
                        disabled={!canUse}
                        onClick={() => onDeclareAttack?.(wp, { isOffHand })}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                          canUse
                            ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 active:scale-95'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        Attack
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              /* Fallback Unarmed Strike */
              <div
                data-testid="attack-action-card-unarmed"
                className="flex flex-col justify-between p-2 rounded-lg border border-slate-700 bg-slate-950/80 min-w-[190px] text-xs"
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-bold text-slate-200">Unarmed Strike</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-amber-300">
                    +2 to hit
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                  <span className="font-mono text-emerald-400">1+STR bludgeoning</span>
                  <span>5 ft reach</span>
                </div>
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
                  className="px-2.5 py-1 rounded text-xs font-bold bg-amber-600 hover:bg-amber-500 text-slate-950 transition-all self-end"
                >
                  Strike
                </button>
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
                className="px-2 py-1 rounded bg-purple-950/60 border border-purple-600 text-purple-300 text-[11px] flex items-center gap-1.5"
              >
                <span>⚠️</span>
                <span>
                  Bonus Action spell cast: You can only cast 1-action cantrips for the remainder of this turn (SRD 5.1).
                </span>
              </div>
            )}

            {/* Spells List */}
            <div className="flex flex-wrap gap-2">
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

                  return (
                    <div
                      key={spell.id}
                      data-testid={`spell-action-card-${spell.id}`}
                      className={`flex flex-col justify-between p-2 rounded-lg border min-w-[210px] max-w-[280px] text-xs transition-colors ${
                        canCast
                          ? 'bg-slate-950/80 border-slate-700 hover:border-purple-500'
                          : 'bg-slate-950/40 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-slate-200 truncate flex items-center gap-1.5">
                          <GameIcon name={spell.school} category="spell" size={14} />
                          <span>{spell.name}</span>
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-purple-950 border border-purple-700 text-[10px] font-semibold text-purple-300">
                          {isCantrip ? 'Cantrip' : `Level ${spell.level}`}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span className="capitalize">{spell.school}</span>
                        <span className="text-amber-400">{spell.castingTime}</span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-2">
                        <span>{formatSpellRange(spell.targeting)}</span>
                        {spell.concentration && (
                          <span className="px-1 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-300 font-bold">
                            Conc.
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1 mt-auto pt-1 border-t border-slate-800">
                        {!isCantrip && availableSlotLevels.length > 0 ? (
                          <select
                            data-testid={`spell-slot-select-${spell.id}`}
                            value={defaultSlot}
                            onChange={(e) =>
                              setSelectedSlotLevels((prev) => ({
                                ...prev,
                                [spell.id]: Number(e.target.value),
                              }))
                            }
                            className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
                          >
                            {availableSlotLevels
                              .filter((lvl) => lvl >= spell.level)
                              .map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  Slot L{lvl}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span className="text-[10px] text-slate-500">
                            {isCantrip ? 'Free' : `Slot L${spell.level}`}
                          </span>
                        )}

                        <button
                          type="button"
                          data-testid={`spell-cast-btn-${spell.id}`}
                          disabled={!canCast}
                          onClick={() => onCastSpell?.(spell.id, defaultSlot)}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            canCast
                              ? 'bg-purple-600 hover:bg-purple-500 text-white active:scale-95'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          Cast
                        </button>
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
          <div data-testid="hotbar-panel-features" className="flex flex-wrap gap-2">
            {features.length > 0 ? (
              features.map((feat) => {
                const canUse = isPlayerControlled && (feat.actionCost === 'bonus_action' ? hasBonusAction : hasAction);

                return (
                  <div
                    key={feat.id}
                    data-testid={`feature-action-card-${feat.id}`}
                    className={`flex flex-col justify-between p-2 rounded-lg border min-w-[200px] max-w-[280px] text-xs transition-colors ${
                      canUse
                        ? 'bg-slate-950/80 border-slate-700 hover:border-amber-500'
                        : 'bg-slate-950/40 border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-slate-200 truncate">
                        {feat.name}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-amber-950 border border-amber-700 text-[10px] font-semibold text-amber-300 capitalize">
                        {feat.actionCost.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 mb-2">
                      {feat.description ?? 'Class feature ability'}
                    </p>

                    <div className="flex items-center justify-between gap-1 mt-auto pt-1 border-t border-slate-800">
                      <span className="text-[10px] text-slate-500">
                        {feat.resourceCost ? `${feat.resourceCost.amount} use` : 'Ready'}
                      </span>
                      <button
                        type="button"
                        data-testid={`feature-btn-${feat.id}`}
                        disabled={!canUse}
                        onClick={() => onUseClassFeature?.(feat.id)}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                          canUse
                            ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 active:scale-95'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        Activate
                      </button>
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
          <div data-testid="hotbar-panel-standard" className="flex flex-wrap gap-2">
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
                  className={`flex flex-col justify-between p-2 rounded-lg border min-w-[190px] max-w-[240px] text-xs transition-colors ${
                    canUse
                      ? 'bg-slate-950/80 border-slate-700 hover:border-sky-500'
                      : 'bg-slate-950/40 border-slate-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <GameIcon name={action.id} category="action" size={16} />
                      <span>{action.name}</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-400 capitalize">
                      {action.actionCost}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 mb-2 leading-snug">
                    {action.description}
                  </p>

                  <button
                    type="button"
                    data-testid={`standard-action-btn-${action.id}`}
                    disabled={!canUse}
                    onClick={() => onStandardAction?.(action.id)}
                    className={`mt-auto px-2.5 py-1 rounded text-xs font-bold transition-all ${
                      canUse
                        ? 'bg-sky-600 hover:bg-sky-500 text-white active:scale-95'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    Execute
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ITEMS TAB */}
        {activeTab === 'items' && (
          <div data-testid="hotbar-panel-items" className="flex flex-wrap gap-2">
            {/* Standard Potion of Healing */}
            <div
              data-testid="item-card-potion-healing"
              className="flex flex-col justify-between p-2 rounded-lg border border-slate-700 bg-slate-950/80 min-w-[190px] max-w-[240px] text-xs"
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <GameIcon name="potion" category="item" size={16} />
                  <span>Potion of Healing</span>
                </span>
                <span className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-400">
                  Action
                </span>
              </div>
              <p className="text-[11px] text-emerald-400 mb-2">
                Drink or administer to regain 2d4 + 2 Hit Points.
              </p>
              <button
                type="button"
                data-testid="item-use-btn-potion-healing"
                disabled={!isPlayerControlled || !hasAction}
                onClick={() => onUseItem?.('potion-of-healing')}
                className={`mt-auto px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  isPlayerControlled && hasAction
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Drink (Action)
              </button>
            </div>

            {/* Potion of Greater Healing */}
            <div
              data-testid="item-card-potion-greater-healing"
              className="flex flex-col justify-between p-2 rounded-lg border border-slate-700 bg-slate-950/80 min-w-[190px] max-w-[240px] text-xs"
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-bold text-slate-200 flex items-center gap-1">
                  <span>🧪</span>
                  <span>Potion of Greater Healing</span>
                </span>
                <span className="px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-400">
                  Action
                </span>
              </div>
              <p className="text-[11px] text-emerald-400 mb-2">
                Drink or administer to regain 4d4 + 4 Hit Points.
              </p>
              <button
                type="button"
                data-testid="item-use-btn-potion-greater-healing"
                disabled={!isPlayerControlled || !hasAction}
                onClick={() => onUseItem?.('potion-of-greater-healing')}
                className={`mt-auto px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  isPlayerControlled && hasAction
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Drink (Action)
              </button>
            </div>
          </div>
        )}
      </div>
    </footer>
  );
}
