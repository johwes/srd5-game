import { useEffect, useMemo, useState } from 'react';
import {
  ABILITY_IDS,
  SKILL_IDS,
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { computeDerivedCharacter, getXpProgress } from '@srd5/engine';
import { InventoryView, type InventorySlotName } from './InventoryView.js';
import {
  formatAbilityAbbrev,
  formatSignedNumber,
  formatTitleCase,
} from '../compendium/formatters.js';

export type CharacterViewRailTab = 'build' | 'skills' | 'attributes';

export interface CharacterViewProps {
  /** All active heroes (1–4) shown in the switcher. */
  heroes: CharacterBuildState[];
  /** Currently displayed hero id. */
  activeHeroId: string;
  /** Compendium for lookups. */
  compendium?: SrdCompendium;
  /** Switch the displayed hero. */
  onSelectHero: (heroId: string) => void;
  /** Close the fullscreen modal (also bound to Esc). */
  onClose: () => void;
  /** Equip (or unequip when `instanceId` is `undefined`). */
  onEquipItem: (heroId: string, slot: InventorySlotName, instanceId: string | undefined) => void;
  /** Attune / unattune by instance id. */
  onAttuneItem: (heroId: string, instanceId: string) => void;
  onUnattuneItem: (heroId: string, instanceId: string) => void;
  /** Optional Use action (potions, scrolls, wands). */
  onUseItem?: (heroId: string, instanceId: string) => void;
  /** Optional hero-to-hero transfer. */
  onTransferItem?: (fromHeroId: string, instanceId: string, toHeroId: string) => void;
  /** Optional drop / split / identify / sell (stretch parity). */
  onDropItem?: (heroId: string, instanceId: string) => void;
  onSplitStack?: (heroId: string, instanceId: string, quantity: number) => void;
  onIdentifyItem?: (heroId: string, instanceId: string) => void;
  onSellItem?: (heroId: string, instanceId: string) => void;
  /** Test id prefix. Defaults to `character-view`. */
  testIdPrefix?: string;
}

const RAIL_TABS: ReadonlyArray<{ id: CharacterViewRailTab; label: string }> = [
  { id: 'build', label: 'Build' },
  { id: 'skills', label: 'Skills' },
  { id: 'attributes', label: 'Attributes' },
];

/**
 * SRD-1501 BG3-style Character view shell (Spec 14 §3.1).
 *
 * Full-screen 3-pane modal: stats rail · doll + equipment · backpack.
 * The doll + backpack panes reuse the Spec-12 `InventoryView` grid and
 * paperdoll slots verbatim (no grid fork); this shell adds the header
 * (portrait, race · class/level line, XP bar, party gold total, hero
 * switcher, Esc close) and the left stats rail (Build / Skills /
 * Attributes tabs over sheet-drawer derived data, presentation only).
 */
export function CharacterView({
  heroes,
  activeHeroId,
  compendium = defaultCompendium,
  onSelectHero,
  onClose,
  onEquipItem,
  onAttuneItem,
  onUnattuneItem,
  onUseItem,
  onTransferItem,
  onDropItem,
  onSplitStack,
  onIdentifyItem,
  onSellItem,
  testIdPrefix = 'character-view',
}: CharacterViewProps) {
  const [railTab, setRailTab] = useState<CharacterViewRailTab>('build');

  const activeHero = useMemo(
    () => heroes.find((h) => h.id === activeHeroId) ?? heroes[0],
    [heroes, activeHeroId],
  );

  // Esc closes the fullscreen modal (same dismissal rule as prop cards).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const partyGoldTotal = useMemo(
    () => heroes.reduce((sum, h) => sum + (h.currency?.gp ?? 0), 0),
    [heroes],
  );

  if (!activeHero) return null;

  const derived = computeDerivedCharacter(activeHero, compendium);
  const xpProgress = getXpProgress(activeHero);
  const xpPct =
    xpProgress.nextLevelThresholdXp !== null && xpProgress.nextLevelThresholdXp > 0
      ? Math.min(100, Math.round((xpProgress.currentXp / xpProgress.nextLevelThresholdXp) * 100))
      : 100;
  const strScore = derived.abilities.str?.score;
  const classLine = derived.classes
    .map((c) => `${c.className}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`)
    .join(' / ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Character view: ${derived.name}`}
      data-testid={testIdPrefix}
      className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
    >
      <div
        data-testid={`${testIdPrefix}-panel`}
        className="w-full max-w-7xl max-h-[92vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl flex flex-col"
      >
        {/* ── Header: portrait, name, race·class/level, XP bar, party gold, switcher, close ── */}
        <header className="flex flex-col gap-2 border-b border-slate-800 bg-slate-900/90 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                data-testid={`${testIdPrefix}-header-portrait`}
                aria-hidden="true"
                className="w-11 h-11 shrink-0 rounded-full bg-gradient-to-br from-amber-600 to-purple-800 flex items-center justify-center text-lg font-bold text-white"
              >
                {derived.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    data-testid={`${testIdPrefix}-header-name`}
                    className="text-lg font-bold text-amber-300 truncate"
                  >
                    {derived.name}
                  </h2>
                  <span
                    data-testid={`${testIdPrefix}-header-level`}
                    className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-bold"
                  >
                    Level {derived.totalLevel}
                  </span>
                </div>
                <p
                  data-testid={`${testIdPrefix}-header-subline`}
                  className="text-xs text-slate-400 truncate"
                >
                  {derived.subraceName ?? derived.raceName} · {classLine}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid={`${testIdPrefix}-header-party-gold`}
                className="px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-700/50 text-amber-200 text-xs font-bold"
                title="Party gold total (sum of hero purses)"
              >
                💰 {partyGoldTotal} gp party
              </span>
              <button
                type="button"
                data-testid={`${testIdPrefix}-close-btn`}
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 text-xs font-semibold hover:text-white"
              >
                Close (Esc)
              </button>
            </div>
          </div>

          {/* XP bar */}
          <div className="flex items-center gap-2 text-xs">
            <span data-testid={`${testIdPrefix}-header-xp`} className="font-mono text-slate-300 shrink-0">
              XP: <strong className="text-amber-300">{xpProgress.currentXp}</strong>
              {xpProgress.nextLevelThresholdXp !== null
                ? ` / ${xpProgress.nextLevelThresholdXp}`
                : ' (Max Level 20)'}
            </span>
            <div
              data-testid={`${testIdPrefix}-xp-bar`}
              role="progressbar"
              aria-valuenow={xpPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden"
            >
              <div className="h-full bg-amber-400" style={{ width: `${xpPct}%` }} />
            </div>
            {xpProgress.canLevelUp && (
              <span
                data-testid={`${testIdPrefix}-xp-ready-badge`}
                className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 text-[11px] font-semibold"
              >
                Ready to Level Up!
              </span>
            )}
          </div>

          {/* Hero switcher (portrait tabs) */}
          <div
            data-testid={`${testIdPrefix}-hero-switcher`}
            role="tablist"
            aria-label="Switch hero"
            className="flex gap-1.5 overflow-x-auto"
          >
            {heroes.map((h) => {
              const d = computeDerivedCharacter(h, compendium);
              const selected = h.id === activeHero.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`${testIdPrefix}-hero-tab-${h.id}`}
                  onClick={() => onSelectHero(h.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    selected
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {d.name} · L{d.totalLevel}
                </button>
              );
            })}
          </div>
        </header>

        {/* ── Body: 3-pane (stats rail · doll+equipment · backpack) ── */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-0 min-h-0">
          {/* Left rail: Build / Skills / Attributes over drawer data */}
          <aside
            data-testid={`${testIdPrefix}-rail`}
            aria-label="Character stats rail"
            className="border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/60 p-3 overflow-y-auto max-h-56 lg:max-h-none"
          >
            <div className="flex gap-1.5 mb-2" role="tablist" aria-label="Stats rail tabs">
              {RAIL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={railTab === tab.id}
                  data-testid={`${testIdPrefix}-rail-tab-${tab.id}`}
                  onClick={() => setRailTab(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    railTab === tab.id
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {railTab === 'build' && (
              <div data-testid={`${testIdPrefix}-rail-panel-build`} className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-1.5">
                  <div data-testid={`${testIdPrefix}-rail-hp`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">HP</div>
                    <div className="font-mono font-bold text-emerald-300">
                      {derived.currentHp}/{derived.maxHp}
                    </div>
                  </div>
                  <div data-testid={`${testIdPrefix}-rail-ac`} className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">AC</div>
                    <div className="font-mono font-bold text-amber-300">{derived.armorClass.totalAc}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Prof</div>
                    <div className="font-mono font-bold text-slate-100">
                      {formatSignedNumber(derived.proficiencyBonus)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950 border border-slate-800 p-2 text-center">
                    <div className="text-[10px] uppercase text-slate-500">Init</div>
                    <div className="font-mono font-bold text-slate-100">
                      {formatSignedNumber(derived.initiative.bonus)}
                    </div>
                  </div>
                </div>
                <div className="text-slate-400">
                  Speed:{' '}
                  <span className="text-slate-200 font-mono">{derived.speedFeet} ft</span>
                  {' · '}
                  {derived.senses.darkvisionFeet > 0
                    ? `Darkvision ${derived.senses.darkvisionFeet} ft`
                    : 'Normal vision'}
                </div>
                <div className="text-slate-400">
                  Resistances:{' '}
                  <span className="text-amber-300">
                    {derived.damageResistances.length > 0
                      ? derived.damageResistances.map(formatTitleCase).join(', ')
                      : 'None'}
                  </span>
                </div>
                <div className="text-slate-400">
                  Features:{' '}
                  <span className="text-slate-200">
                    {derived.featureIds.length + derived.featIds.length} traits/feats
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Full conditions, notable features, and breakdowns live in the quick-inspect sheet drawer.
                </p>
              </div>
            )}

            {railTab === 'skills' && (
              <div data-testid={`${testIdPrefix}-rail-panel-skills`} className="space-y-1 text-xs">
                {SKILL_IDS.map((skillId) => {
                  const sk = derived.skills[skillId];
                  return (
                    <div
                      key={skillId}
                      data-testid={`${testIdPrefix}-rail-skill-${skillId}`}
                      className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                    >
                      <span className="text-slate-200 truncate">
                        {formatTitleCase(skillId)}{' '}
                        <span className="text-[10px] text-slate-500">
                          ({formatAbilityAbbrev(sk.ability)})
                        </span>
                      </span>
                      <span className="font-mono font-semibold text-slate-100">
                        {formatSignedNumber(sk.totalBonus)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {railTab === 'attributes' && (
              <div data-testid={`${testIdPrefix}-rail-panel-attributes`} className="space-y-1 text-xs">
                {ABILITY_IDS.map((ab) => {
                  const stat = derived.abilities[ab];
                  return (
                    <div
                      key={ab}
                      data-testid={`${testIdPrefix}-rail-ability-${ab}`}
                      className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800/80"
                    >
                      <span className="text-slate-200">{formatAbilityAbbrev(ab)}</span>
                      <span className="font-mono text-slate-100">
                        {stat.score} ({formatSignedNumber(stat.modifier)})
                      </span>
                    </div>
                  );
                })}
                <div className="pt-1 text-slate-400">
                  Size: <span className="text-slate-200">{formatTitleCase(derived.size)}</span>
                  {' · '}Alignment:{' '}
                  <span className="text-slate-200">{formatTitleCase(derived.alignment)}</span>
                </div>
                <div className="text-slate-400">
                  Languages:{' '}
                  <span className="text-slate-200">
                    {derived.proficiencies.languages.map(formatTitleCase).join(', ') || 'None'}
                  </span>
                </div>
              </div>
            )}
          </aside>

          {/* Center + right: reuse InventoryView (paperdoll + grid) verbatim */}
          <div
            data-testid={`${testIdPrefix}-inventory-pane`}
            className="p-3 overflow-y-auto min-h-0"
          >
            <InventoryView
              heroId={activeHero.id}
              heroName={derived.name}
              inventory={activeHero.inventory}
              equippedSlots={activeHero.equippedSlots as unknown as Record<string, string | undefined>}
              attunedItemInstanceIds={activeHero.attunedItemInstanceIds}
              currency={activeHero.currency}
              compendium={compendium}
              partyHeroes={heroes
                .filter((h) => h.id !== activeHero.id)
                .map((h) => ({ id: h.id, name: h.name }))}
              strScore={strScore}
              onEquipItem={(slot, instanceId) => onEquipItem(activeHero.id, slot, instanceId)}
              onAttuneItem={(instanceId) => onAttuneItem(activeHero.id, instanceId)}
              onUnattuneItem={(instanceId) => onUnattuneItem(activeHero.id, instanceId)}
              onUseItem={onUseItem ? (instanceId) => onUseItem(activeHero.id, instanceId) : undefined}
              onTransferItem={
                onTransferItem
                  ? (instanceId, toHeroId) => onTransferItem(activeHero.id, instanceId, toHeroId)
                  : undefined
              }
              onDropItem={onDropItem ? (instanceId) => onDropItem(activeHero.id, instanceId) : undefined}
              onSplitStack={
                onSplitStack ? (instanceId, qty) => onSplitStack(activeHero.id, instanceId, qty) : undefined
              }
              onIdentifyItem={
                onIdentifyItem ? (instanceId) => onIdentifyItem(activeHero.id, instanceId) : undefined
              }
              onSellItem={onSellItem ? (instanceId) => onSellItem(activeHero.id, instanceId) : undefined}
              testIdPrefix={testIdPrefix}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
