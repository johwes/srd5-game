import React, { useRef, useState } from 'react';
import type { EffectStepSpec, SpellData } from '@srd5/data';
import type { DerivedWeaponAttackProfile } from '@srd5/engine';
import { GameIcon } from '../../canvas/assets/index.js';
import { formatSpellRange } from '../compendium/formatters.js';
import {
  formatSpellTargetingSummary,
  resolveSpellTargets,
} from '../../utils/combatTargeting.js';
import { loadAppSettings, saveAppSettings } from '../../persistence/settingsPersistence.js';
import { TurnBudgetIndicator } from './TurnBudgetIndicator.js';
import { ActionTooltipCard } from './ActionTooltipCard.js';
import { CombatantMedallion } from './CombatantMedallion.js';
import type {
  ActionHotbarProps,
  CombatActionTab,
  StandardActionDefinition,
  StandardActionType,
} from './types.js';

/**
 * Summarizes a spell's executable effect pipeline into BG3-tooltip style
 * one-line effect descriptions (reference: screenshots 085 / 086).
 */
function collectSpellEffectLines(
  steps: readonly EffectStepSpec[] | undefined,
  depth = 0,
): string[] {
  if (!steps || depth > 2) return [];
  const lines: string[] = [];
  for (const step of steps) {
    switch (step.step) {
      case 'deal_damage':
        lines.push(
          `Deal ${step.diceFormula} ${step.damageType} damage${step.halfOnSaveSuccess ? ' (half on successful save)' : ''}.`,
        );
        break;
      case 'saving_throw':
        lines.push(`Saving throw: ${step.ability.toUpperCase()} vs your spell save DC.`);
        lines.push(...collectSpellEffectLines(step.onFail, depth + 1));
        lines.push(...collectSpellEffectLines(step.onSuccess, depth + 1));
        break;
      case 'attack_roll':
        lines.push(`Spell attack roll (${step.attackType.replace(/_/g, ' ')}).`);
        lines.push(...collectSpellEffectLines(step.onHit, depth + 1));
        lines.push(...collectSpellEffectLines(step.onMiss, depth + 1));
        break;
      case 'heal':
        lines.push(`Restore ${step.diceFormula} hit points.`);
        break;
      case 'grant_temp_hp':
        lines.push(`Grant ${step.amountFormula} temporary hit points.`);
        break;
      case 'apply_condition':
        lines.push(`Inflict ${String(step.conditionId).replace(/-/g, ' ')}.`);
        break;
      case 'apply_active_effect':
        lines.push(`Apply ${step.name}.`);
        break;
      case 'create_hazard_zone':
        lines.push(`Create a ${step.sizeFeet} ft ${step.shape} hazard zone.`);
        break;
      case 'teleport':
        lines.push(`Teleport up to ${step.maxDistanceFeet} ft.`);
        break;
      case 'forced_movement':
        lines.push(
          `${step.direction === 'push_from_actor' ? 'Push' : 'Pull'} up to ${step.distanceFeet} ft.`,
        );
        break;
      case 'manual_adjudication':
        lines.push(step.title);
        break;
      case 'spend_resource':
        break;
    }
  }
  return lines;
}

function summarizeSpellEffects(spell: SpellData): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of collectSpellEffectLines(spell.effects)) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
    if (out.length >= 4) break;
  }
  return out;
}

export const STANDARD_ACTIONS: StandardActionDefinition[] = [  {
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
  onOpenCharacterSheet,
  initialRows,
  className = '',
}: ActionHotbarProps) {
  const [internalTab, setInternalTab] = useState<CombatActionTab>('attack');
  const [spellLevelFilter, setSpellLevelFilter] = useState<number | 'all'>('all');
  const [selectedSlotLevels, setSelectedSlotLevels] = useState<Record<string, number>>({});
  // BG3-style customizable hotbar density: rows persisted to AppSettings.
  const [rows, setRows] = useState<number>(() => {
    if (initialRows !== undefined) return initialRows;
    try {
      const saved = loadAppSettings().hotbarRows;
      return saved >= 1 && saved <= 3 ? saved : 2;
    } catch {
      return 2;
    }
  });
  const resizeDragRef = useRef<{ startY: number; startRows: number } | null>(null);

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

  // BG3-style resizable icon grid: 1–3 rows, shared by every tab panel.
  const iconGridClassName =
    rows > 1
      ? 'flex flex-wrap overflow-y-auto gap-2 pt-0.5 scrollbar-thin items-center content-start'
      : 'flex flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-thin items-center';
  const iconGridStyle: React.CSSProperties | undefined =
    rows > 1 ? { maxHeight: rows * 58 } : undefined;

  const persistRows = (nextRows: number) => {
    const clamped = Math.max(1, Math.min(3, nextRows));
    setRows(clamped);
    try {
      saveAppSettings({ ...loadAppSettings(), hotbarRows: clamped as 1 | 2 | 3 });
    } catch {
      // Ignore persistence failures; in-memory rows still apply.
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeDragRef.current = { startY: e.clientY, startRows: rows };
    const handleMove = (moveEvent: PointerEvent) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const delta = Math.round((drag.startY - moveEvent.clientY) / 30);
      persistRows(drag.startRows + delta);
    };
    const handleUp = () => {
      resizeDragRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
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

      {/* BG3-style drag handle: resize the icon grid between 1–3 rows */}
      <div
        data-testid="hotbar-resize-handle"
        role="slider"
        aria-label="Hotbar rows"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={rows}
        title={`Drag to resize hotbar (${rows} row${rows === 1 ? '' : 's'})`}
        onPointerDown={handleResizePointerDown}
        className="px-6 py-0.5 rounded-full bg-slate-900/90 border border-slate-800 hover:border-amber-500/60 text-slate-500 hover:text-amber-300 text-[10px] cursor-ns-resize select-none transition-colors"
      >
        ═══
      </div>

      {/* Docked Hotbar */}
      <div className="flex items-stretch gap-3 px-3 py-2.5 max-w-full bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-amber-700/30 rounded-2xl backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
        {/* Active Hero Medallion (portrait-centered dock, BG3 style) */}
        <div className="flex items-center pr-3 border-r border-slate-800 shrink-0">
          <CombatantMedallion
            combatant={activeCombatant}
            turnBudget={turnBudget}
            onOpenCharacterSheet={onOpenCharacterSheet}
          />
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
            className={iconGridClassName}
            style={iconGridStyle}
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
                      <GameIcon name="attack" category="action" size={20} alt="" />
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
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                      <ActionTooltipCard
                        testId={`attack-tooltip-${wp.id}`}
                        icon={<GameIcon name="attack" category="action" size={14} alt="" />}
                        name={wp.name}
                        badge={wp.rangeType === 'ranged' ? 'Ranged Weapon' : 'Melee Weapon'}
                        subtitle={`${wp.damageType} · ${wp.rangeFeet ? `${wp.rangeFeet.normal}/${wp.rangeFeet.long}ft range` : `${wp.reachFeet}ft reach`} · to hit ${wp.toHitBonus >= 0 ? `+${wp.toHitBonus}` : wp.toHitBonus}`}
                        effectLines={[`Deal ${wp.damageFormula} ${wp.damageType} damage.`]}
                        cost={{ action: isOffHand ? 'Bonus Action' : 'Action' }}
                        accent="amber"
                      />
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
                  <GameIcon name="attack" category="action" size={20} alt="" />
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
              className={iconGridClassName}
            style={iconGridStyle}
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
                        <GameIcon name={spell.school} category="spell" size={20} alt="" />
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
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                        <ActionTooltipCard
                          testId={`spell-tooltip-${spell.id}`}
                          icon={<GameIcon name={spell.school} category="spell" size={14} alt="" />}
                          name={spell.name}
                          badge={isCantrip ? 'Cantrip' : `Level ${spell.level}`}
                          subtitle={`${spell.school} · ${spell.castingTime}`}
                          effectLines={[
                            ...summarizeSpellEffects(spell),
                            `Target: ${targetingSummary.previewLabel}`,
                            `Range: ${formatSpellRange(spell.targeting)}`,
                          ]}
                          warning={
                            blockedByBaRule
                              ? 'Bonus Action spell cast: only cantrips remain this turn.'
                              : !hasSlots
                                ? `No level ${defaultSlot} spell slots left.`
                                : !hasEconomy
                                  ? `Requires ${isBonusActionTime ? 'a bonus action' : isReactionTime ? 'a reaction' : 'an action'}.`
                                  : undefined
                          }
                          concentration={spell.concentration}
                          cost={{
                            action: isBonusActionTime
                              ? 'Bonus Action'
                              : isReactionTime
                                ? 'Reaction'
                                : 'Action',
                            resource: isCantrip ? undefined : `Level ${defaultSlot} Slot`,
                          }}
                          accent="purple"
                        />

                        {/* Slot Picker if Upcastable */}
                        {!isCantrip && availableSlotLevels.length > 0 && (
                          <div
                            className="flex items-center justify-between pt-1.5 border-t border-slate-800 mt-1 px-3 pb-2 bg-slate-950/95 rounded-b-xl"
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
            className={iconGridClassName}
            style={iconGridStyle}
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

                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                      <ActionTooltipCard
                        testId={`feature-tooltip-${feat.id}`}
                        icon={<span aria-hidden>⭐</span>}
                        name={feat.name}
                        badge="Class Feature"
                        effectLines={[feat.description ?? 'Class feature ability']}
                        warning={
                          feat.resourceCost
                            ? `Resource cost: ${feat.resourceCost.amount} use.`
                            : undefined
                        }
                        cost={{
                          action:
                            feat.actionCost === 'bonus_action'
                              ? 'Bonus Action'
                              : feat.actionCost === 'reaction'
                                ? 'Reaction'
                                : feat.actionCost === 'free'
                                  ? 'Free'
                                  : 'Action',
                        }}
                        accent="amber"
                      />
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
            className={iconGridClassName}
            style={iconGridStyle}
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
                    <GameIcon name={action.id} category="action" size={20} alt="" />
                    <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-sky-600 text-slate-950 shadow">
                      {action.actionCost === 'bonus_action' ? 'BA' : action.actionCost === 'movement' ? 'M' : action.actionCost === 'free' ? 'F' : 'A'}
                    </span>
                  </button>

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                    <ActionTooltipCard
                      testId={`standard-tooltip-${action.id}`}
                      icon={<GameIcon name={action.id} category="action" size={14} alt="" />}
                      name={action.name}
                      badge="Standard Action"
                      effectLines={[action.description]}
                      cost={{
                        action:
                          action.actionCost === 'bonus_action'
                            ? 'Bonus Action'
                            : action.actionCost === 'movement'
                              ? 'Movement'
                              : action.actionCost === 'free'
                                ? 'Free'
                                : 'Action',
                      }}
                      accent="sky"
                    />
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
            className={iconGridClassName}
            style={iconGridStyle}
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
                <GameIcon name="potion" category="item" size={20} alt="" />
                <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-emerald-600 text-slate-950 shadow">
                  A
                </span>
              </button>

              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                <ActionTooltipCard
                  testId="item-tooltip-potion-healing"
                  icon={<GameIcon name="potion" category="item" size={14} alt="" />}
                  name="Potion of Healing"
                  badge="Consumable"
                  effectLines={['Drink or administer to regain 2d4 + 2 hit points.']}
                  cost={{ action: 'Action' }}
                  accent="emerald"
                />
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
                <GameIcon name="potion" category="item" size={20} alt="" />
                <span className="absolute -top-1 -left-1 px-1 py-0.2 rounded-full text-[9px] font-black uppercase bg-emerald-600 text-slate-950 shadow">
                  A
                </span>
              </button>

              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
                <ActionTooltipCard
                  testId="item-tooltip-potion-greater-healing"
                  icon={<GameIcon name="potion" category="item" size={14} alt="" />}
                  name="Potion of Greater Healing"
                  badge="Consumable"
                  effectLines={['Drink or administer to regain 4d4 + 4 hit points.']}
                  cost={{ action: 'Action' }}
                  accent="emerald"
                />
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
        {/* End Turn — BG3 hourglass medallion */}
        <div className="flex items-center pl-3 border-l border-slate-800 shrink-0">
          <button
            type="button"
            data-testid="hotbar-end-turn-btn"
            disabled={!isPlayerControlled || !activeCombatant}
            onClick={onEndTurn}
            title="End Turn"
            className={`flex flex-col items-center justify-center gap-0.5 w-16 h-16 rounded-full font-black text-[10px] uppercase tracking-wider transition-all shadow-md border-2 ${
              isPlayerControlled && activeCombatant
                ? 'bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 border-amber-200/60 active:scale-95 shadow-amber-500/30'
                : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-60'
            }`}
          >
            <span className="text-xl leading-none">⏳</span>
            <span className="leading-none">End Turn</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
