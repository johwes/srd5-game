import React from 'react';
import type { OverworldPOI, TravelPace } from '@srd5/engine';
import {
  TRAVEL_PACE_PROFILES,
  WEATHER_PROFILES,
  getFactionByPoi,
  getReputationTierProfile,
  isSafeRestSite,
} from '@srd5/engine';
import {
  type RealmExpeditionPreview,
  type RealmSessionState,
  getPartyList,
  isSettlementPoi,
} from './realmEngine.js';

/**
 * Presentational strategic overworld HUD (SRD-805): world status bar, party
 * strip, travel actions, settlement / POI services panel, and the travel log.
 * Floats over the full-bleed OverworldCanvasViewport with the standard
 * pointer-events-none wrapper + pointer-events-auto panels idiom.
 */

const TIME_ICONS: Record<string, string> = {
  dawn: '🌅',
  noon: '☀️',
  dusk: '🌇',
  night: '🌙',
};

const PACE_LABELS: Record<TravelPace, string> = {
  slow: '🐢 Slow',
  normal: '🚶 Normal',
  fast: '🏃 Fast',
};

export interface RealmHudProps {
  session: RealmSessionState;
  currentPoi: OverworldPOI | null;
  logEntries: string[];
  /** Pre-commit expedition estimate for the hovered tile (SRD-807). */
  expeditionPreview: RealmExpeditionPreview | null;
  expeditionPreviewError: string | null;
  canForceMarch: boolean;
  dayBudget: number;
  onSetPace: (pace: TravelPace) => void;
  onForage: () => void;
  onForceMarch: () => void;
  onOpenCamp: () => void;
  onOpenJournal: () => void;
  onOpenFactions: () => void;
  onOpenShop: () => void;
  onOpenQuestBoard: () => void;
  onEnterPoi: () => void;
  onEndlessDelve: () => void;
  onOpenPause: () => void;
  onInspectCharacter?: (characterId: string) => void;
}

export function RealmHud({
  session,
  currentPoi,
  logEntries,
  expeditionPreview,
  expeditionPreviewError,
  canForceMarch,
  dayBudget,
  onSetPace,
  onForage,
  onForceMarch,
  onOpenCamp,
  onOpenJournal,
  onOpenFactions,
  onOpenShop,
  onOpenQuestBoard,
  onEnterPoi,
  onEndlessDelve,
  onOpenPause,
  onInspectCharacter,
}: RealmHudProps) {
  const { travel, map } = session;
  const party = getPartyList(session);
  const dailyPoints = dayBudget;
  const activeQuestCount = session.questLog.quests.filter((q) => q.status === 'active').length;
  const atSettlement = currentPoi ? isSettlementPoi(currentPoi) : false;
  const safeRest = isSafeRestSite(map, travel.partyPosition);
  const poiFaction = currentPoi ? getFactionByPoi(map, currentPoi.id) : undefined;
  const cleared = currentPoi ? session.clearedPoiIds.includes(currentPoi.id) : false;
  const hasShop = currentPoi ? Boolean(session.shops[currentPoi.id]) : false;
  const hasQuestBoard = Boolean(currentPoi?.services?.includes('quest_board'));
  const enterablePoi =
    currentPoi &&
    (currentPoi.kind === 'dungeon_entrance' || currentPoi.kind === 'monster_lair') &&
    !cleared;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 select-none z-20">
      {/* Top status bar */}
      <header
        data-testid="realm-hud-top-bar"
        className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-2.5 shadow-xl"
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            data-testid="realm-hud-pause-btn"
            onClick={onOpenPause}
            className="px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors min-h-[36px]"
            title="System menu (Esc)"
          >
            ⚙️
          </button>
          <div className="min-w-0">
            <h2
              data-testid="realm-hud-world-name"
              className="text-sm font-serif font-extrabold text-amber-400 truncate"
            >
              🗺️ {map.worldName}
            </h2>
            <span
              data-testid="realm-hud-day-time"
              className="text-[11px] text-slate-400"
            >
              Day {travel.currentDay} · {TIME_ICONS[travel.timeOfDay] ?? ''} {travel.timeOfDay} ·{' '}
              {WEATHER_PROFILES[travel.weather].label}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span
            data-testid="realm-hud-travel-points"
            className="px-2 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30"
            title="Movement points remaining today"
          >
            🥾 {travel.travelPointsRemaining}/{dailyPoints} MP
          </span>
          <span
            data-testid="realm-hud-rations"
            className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"
          >
            🍖 {travel.rations}
          </span>
          <span
            data-testid="realm-hud-gold"
            className="px-2 py-1 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30"
          >
            💰 {travel.gold} gp
          </span>
          <span
            data-testid="realm-hud-miles"
            className="px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700"
          >
            🧭 {travel.milesTraveled} mi
          </span>
          <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800" role="group" aria-label="Travel pace">
            {(Object.keys(TRAVEL_PACE_PROFILES) as TravelPace[]).map((pace) => (
              <button
                key={pace}
                type="button"
                data-testid={`realm-hud-pace-${pace}`}
                aria-pressed={travel.travelPace === pace}
                onClick={() => onSetPace(pace)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors min-h-[32px] ${
                  travel.travelPace === pace
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {PACE_LABELS[pace]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Middle row: party strip (left) + travel log (right) */}
      <div className="flex-1 min-h-0 flex items-stretch justify-between gap-3 py-2">
        <aside
          data-testid="realm-hud-party-strip"
          className="pointer-events-auto self-center flex flex-col gap-1.5 w-44"
        >
          {party.map((hero) => {
            const hpPct = Math.max(0, Math.min(100, (hero.currentHp / hero.maxHp) * 100));
            return (
              <button
                key={hero.id}
                type="button"
                data-testid={`realm-party-member-${hero.id}`}
                onClick={() => onInspectCharacter?.(hero.id)}
                className="rounded-lg border border-slate-800 bg-slate-950/85 backdrop-blur-md p-2 text-left hover:border-amber-500/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-slate-200 truncate">{hero.name}</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {hero.currentHp}/{hero.maxHp}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${hpPct}%` }}
                  />
                </div>
                {hero.isDead && (
                  <span className="text-[9px] text-red-400 font-bold">☠ DEAD</span>
                )}
              </button>
            );
          })}
        </aside>

        <aside
          data-testid="realm-hud-travel-log"
          className="pointer-events-auto self-end w-72 max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/85 backdrop-blur-md p-2.5 shadow-xl"
        >
          {(expeditionPreview || expeditionPreviewError) && (
            <div
              data-testid="realm-hud-expedition-preview"
              className="mb-2 rounded-lg border border-sky-500/40 bg-sky-950/60 p-2"
            >
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-sky-300 mb-1">
                🧭 Expedition Preview
              </h3>
              {expeditionPreviewError ? (
                <p
                  data-testid="realm-hud-expedition-preview-error"
                  className="text-[11px] text-red-300"
                >
                  {expeditionPreviewError}
                </p>
              ) : expeditionPreview ? (
                <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-slate-200">
                  <dt className="text-slate-400">Cost</dt>
                  <dd
                    data-testid="realm-hud-expedition-preview-cost"
                    className="text-right font-mono"
                  >
                    {expeditionPreview.points} MP
                  </dd>
                  <dt className="text-slate-400">Days</dt>
                  <dd
                    data-testid="realm-hud-expedition-preview-days"
                    className="text-right font-mono"
                  >
                    {expeditionPreview.days}
                  </dd>
                  <dt className="text-slate-400">Rations</dt>
                  <dd
                    data-testid="realm-hud-expedition-preview-rations"
                    className="text-right font-mono"
                  >
                    🍖 {expeditionPreview.rations}
                  </dd>
                  <dt className="text-slate-400">Arrival</dt>
                  <dd
                    data-testid="realm-hud-expedition-preview-arrival"
                    className="text-right font-mono"
                  >
                    Day {expeditionPreview.arrivalDay} · {expeditionPreview.arrivalPhase}
                  </dd>
                </dl>
              ) : null}
              <p className="mt-1 text-[10px] text-slate-400 italic">
                Click the tile to march the first leg (halts at dusk / new POIs — camp to continue).
              </p>
            </div>
          )}
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Travel Log
          </h3>
          {logEntries.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic">
              Click a tile on the map to travel. The road awaits.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {logEntries.slice(-10).map((entry, idx) => (
                <li key={idx} className="text-[11px] text-slate-300 leading-snug">
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* Bottom row: location panel + action buttons */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div
          data-testid="realm-hud-action-bar"
          className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-2 shadow-xl"
        >
          <button
            type="button"
            data-testid="realm-hud-forage-btn"
            onClick={onForage}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-emerald-300 min-h-[44px]"
            title="Spend 1 MP to forage for rations (Survival check)"
          >
            🌿 Forage
          </button>
          <button
            type="button"
            data-testid="realm-hud-force-march-btn"
            onClick={onForceMarch}
            disabled={!canForceMarch}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-orange-300 min-h-[44px] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Push beyond dusk for +2 MP today — each living hero spends 1 Hit Die or gains Exhaustion (once per day)"
          >
            🥾💨 Forced March
          </button>
          <button
            type="button"
            data-testid="realm-hud-camp-btn"
            onClick={onOpenCamp}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-amber-300 min-h-[44px]"
          >
            🏕️ Camp
          </button>
          <button
            type="button"
            data-testid="realm-hud-journal-btn"
            onClick={onOpenJournal}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-sky-300 min-h-[44px]"
          >
            📜 Journal{activeQuestCount > 0 ? ` (${activeQuestCount})` : ''}
          </button>
          <button
            type="button"
            data-testid="realm-hud-factions-btn"
            onClick={onOpenFactions}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-purple-300 min-h-[44px]"
          >
            🚩 Factions
          </button>
          <button
            type="button"
            data-testid="realm-hud-endless-delve-btn"
            onClick={onEndlessDelve}
            className="px-3 py-2 rounded-lg bg-stone-900 border border-stone-600 hover:bg-stone-800 text-xs font-semibold text-stone-200 min-h-[44px]"
            title="Launch the unbounded Deep Descent roguelite run (graveyard high scores)"
          >
            💀 Endless Delve
          </button>
        </div>

        {currentPoi && (
          <div
            data-testid="realm-hud-location-panel"
            className="pointer-events-auto flex-1 min-w-[260px] max-w-xl rounded-xl border border-amber-500/40 bg-slate-950/95 backdrop-blur-md p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3
                  data-testid="realm-hud-location-name"
                  className="text-sm font-serif font-extrabold text-amber-400 truncate"
                >
                  {currentPoi.kind === 'capital' ? '👑' : atSettlement ? '🏘️' : currentPoi.kind === 'dungeon_entrance' ? '🕳️' : currentPoi.kind === 'monster_lair' ? '☠️' : '✦'}{' '}
                  {currentPoi.name}
                </h3>
                <p className="text-[10px] text-slate-400 capitalize">
                  {currentPoi.kind.replace(/_/g, ' ')}
                  {poiFaction ? ` · ${poiFaction.name}` : ''}
                  {poiFaction
                    ? ` · ${getReputationTierProfile(poiFaction.relationshipWithParty).label}`
                    : ''}
                  {cleared ? ' · cleared ✓' : ''}
                </p>
              </div>
              {safeRest && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold whitespace-nowrap">
                  🛏️ Safe Inn
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {atSettlement && (
                <button
                  type="button"
                  data-testid="realm-hud-inn-btn"
                  onClick={onOpenCamp}
                  className="px-3 py-2 rounded-lg bg-emerald-900/40 border border-emerald-600/50 hover:bg-emerald-800/50 text-xs font-semibold text-emerald-200 min-h-[44px]"
                >
                  🛏️ Inn Rest
                </button>
              )}
              {atSettlement && hasShop && (
                <button
                  type="button"
                  data-testid="realm-hud-shop-btn"
                  onClick={onOpenShop}
                  className="px-3 py-2 rounded-lg bg-amber-900/40 border border-amber-600/50 hover:bg-amber-800/50 text-xs font-semibold text-amber-200 min-h-[44px]"
                >
                  🛒 Shop
                </button>
              )}
              {atSettlement && hasQuestBoard && (
                <button
                  type="button"
                  data-testid="realm-hud-quest-board-btn"
                  onClick={onOpenQuestBoard}
                  className="px-3 py-2 rounded-lg bg-sky-900/40 border border-sky-600/50 hover:bg-sky-800/50 text-xs font-semibold text-sky-200 min-h-[44px]"
                >
                  📋 Quest Board
                </button>
              )}
              {enterablePoi && (
                <button
                  type="button"
                  data-testid="realm-hud-enter-poi-btn"
                  onClick={onEnterPoi}
                  className="px-3 py-2 rounded-lg bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-xs font-black text-white min-h-[44px] shadow-lg"
                >
                  ⚔️ Enter {currentPoi.kind === 'monster_lair' ? 'Lair' : 'Dungeon'}
                </button>
              )}
              {currentPoi.kind === 'ancient_shrine' && (
                <button
                  type="button"
                  data-testid="realm-hud-commune-btn"
                  onClick={onEnterPoi}
                  disabled={session.usedShrinePoiIds.includes(currentPoi.id)}
                  className="px-3 py-2 rounded-lg bg-cyan-900/40 border border-cyan-600/50 hover:bg-cyan-800/50 text-xs font-semibold text-cyan-200 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {session.usedShrinePoiIds.includes(currentPoi.id) ? '✦ Blessed ✓' : '✦ Commune'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
