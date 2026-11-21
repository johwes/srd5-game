import React, { useState } from 'react';
import type {
  OverworldMap,
  WarDiplomacyState,
  WarMissionKind,
  WarState,
} from '@srd5/engine';
import {
  WAR_SUBFACTION_QUESTS,
  getNationThreat,
  getWarNationLanguageProfile,
  getWarNationTotal,
  getWarPowerTotal,
  getWarThreatTier,
  INTERPRETER_HIRE_COST_GOLD,
  INTERPRETER_PER_PARLEY_FEE_GOLD,
  isTruceActive,
  listWarMissionCatalog,
} from '@srd5/engine';

/**
 * Strategic War Room modal (SRD-1106, Spec 10 §§1–7).
 *
 * Three tabs:
 * - **War Ledger**: per-nation War Power pillars + dominance progress + the
 *   War Chronicle (last 12 entries).
 * - **Special-Ops Missions**: 9-catalog mission kinds with eligible POI kinds
 *   and side badges; the host resolves POI targeting on the map.
 * - **Diplomacy & Patronage**: truces, mercenaries / thieves' guild hiring,
 *   sub-faction quest progress, and per-nation Threat tiers.
 *
 * Presentational: all effects dispatch through host callbacks.
 */

export type RealmWarRoomTab = 'ledger' | 'missions' | 'diplomacy';

export interface RealmWarRoomModalProps {
  isOpen: boolean;
  war: WarState | null;
  diplomacy: WarDiplomacyState;
  map: OverworldMap;
  currentDay: number;
  gold: number;
  initialTab?: RealmWarRoomTab;
  onClose: () => void;
  onAcceptMission?: (kind: WarMissionKind, poiId: string) => void;
  onNegotiateTruce?: (nationId: string) => void;
  onHireAsset?: (asset: 'mercenaries' | 'thieves_guild' | 'interpreter') => void;
  onFacePatrol?: (nationId: string) => void;
}

export function RealmWarRoomModal({
  isOpen,
  war,
  diplomacy,
  map,
  currentDay,
  gold,
  initialTab = 'ledger',
  onClose,
  onAcceptMission,
  onNegotiateTruce,
  onHireAsset,
  onFacePatrol,
}: RealmWarRoomModalProps) {
  const [tab, setTab] = useState<RealmWarRoomTab>(initialTab);
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="realm-war-room-title"
      data-testid="realm-war-room-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-amber-500/50 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4">
        <header className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="realm-war-room-title" className="text-xl font-serif font-extrabold text-amber-400">
            ⚔️ War Room
          </h2>
          <button
            type="button"
            data-testid="realm-war-room-close-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
          >
            ✕
          </button>
        </header>

        <div role="tablist" aria-label="War Room tabs" className="flex gap-1.5">
          {(
            [
              ['ledger', '📜 War Ledger'],
              ['missions', '🗡️ Missions'],
              ['diplomacy', '🤝 Diplomacy'],
            ] as Array<[RealmWarRoomTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`realm-war-room-tab-${id}`}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors min-h-[36px] ${
                tab === id
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {!war ? (
          <p data-testid="realm-war-room-no-war" className="text-sm text-slate-400 italic">
            The war has not begun — choose a banner to open the War Room.
          </p>
        ) : (
          <>
            {tab === 'ledger' && (
              <WarLedgerPanel war={war} currentDay={currentDay} />
            )}
            {tab === 'missions' && (
              <WarMissionsPanel war={war} map={map} onAcceptMission={onAcceptMission} />
            )}
            {tab === 'diplomacy' && (
              <WarDiplomacyPanel
                war={war}
                diplomacy={diplomacy}
                currentDay={currentDay}
                gold={gold}
                onNegotiateTruce={onNegotiateTruce}
                onHireAsset={onHireAsset}
                onFacePatrol={onFacePatrol}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function WarLedgerPanel({ war, currentDay }: { war: WarState; currentDay: number }) {
  void currentDay;
  return (
    <div data-testid="realm-war-room-ledger" className="space-y-3">
      {war.nationOrder.map((nationId) => {
        const nation = war.nations[nationId]!;
        const total = getWarNationTotal(nation);
        const pct = Math.max(0, Math.min(100, (total / war.dominanceTarget) * 100));
        return (
          <div
            key={nationId}
            data-testid={`realm-war-ledger-nation-${nationId}`}
            className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm border border-slate-600 shrink-0"
                style={{ backgroundColor: nation.bannerColor }}
                aria-hidden="true"
              />
              <span className="text-sm font-bold text-slate-100 truncate">
                {nation.name}
                {nationId === war.playerNationId ? ' (you)' : ''}
              </span>
              <span
                data-testid={`realm-war-ledger-total-${nationId}`}
                className="ml-auto text-xs font-mono text-amber-300 shrink-0"
              >
                {total}/{war.dominanceTarget}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              MIL {nation.power.military} · ECO {nation.power.economy} · ARC{' '}
              {nation.power.arcana} · MOR {nation.power.morale}
            </p>
          </div>
        );
      })}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
          War Chronicle
        </h3>
        {war.chronicle.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No entries yet — the war is young.</p>
        ) : (
          <ul data-testid="realm-war-room-chronicle" className="space-y-1">
            {war.chronicle.slice(-12).reverse().map((entry, idx) => (
              <li key={idx} className="text-[11px] text-slate-300">
                <span className="text-slate-500 font-mono">[Day {entry.day}]</span> {entry.headline}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function WarMissionsPanel({
  war,
  map,
  onAcceptMission,
}: {
  war: WarState;
  map: OverworldMap;
  onAcceptMission?: (kind: WarMissionKind, poiId: string) => void;
}) {
  void war;
  const catalog = listWarMissionCatalog();
  const eligibleTargets = (kind: WarMissionKind): { id: string; name: string; kind: string }[] => {
    const kinds = catalog.find((c) => c.kind === kind)?.eligiblePoiKinds ?? [];
    return Object.values(map.pois)
      .filter((poi) => (kinds as readonly string[]).includes(poi.kind))
      .slice(0, 6)
      .map((poi) => ({ id: poi.id, name: poi.name, kind: poi.kind }));
  };

  return (
    <div data-testid="realm-war-room-missions" className="space-y-2.5">
      {catalog.map((entry) => (
        <div
          key={entry.kind}
          data-testid={`realm-war-mission-kind-${entry.kind}`}
          className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">
              {entry.kind.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 capitalize">
              {entry.side}
            </span>
            <span className="ml-auto text-[10px] text-slate-500">
              {entry.approachCount} approaches
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Targets: {entry.eligiblePoiKinds.join(', ').replace(/_/g, ' ')}
          </p>
          {onAcceptMission && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {eligibleTargets(entry.kind).map((target) => (
                <button
                  key={target.id}
                  type="button"
                  data-testid={`realm-war-mission-accept-${entry.kind}-${target.id}`}
                  onClick={() => onAcceptMission(entry.kind, target.id)}
                  className="px-2 py-1 rounded-md bg-slate-800 hover:bg-amber-700 border border-slate-700 text-[11px] font-semibold text-slate-200 min-h-[32px]"
                >
                  {target.name} ({target.kind.replace(/_/g, ' ')})
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WarDiplomacyPanel({
  war,
  diplomacy,
  currentDay,
  gold,
  onNegotiateTruce,
  onHireAsset,
  onFacePatrol,
}: {
  war: WarState;
  diplomacy: WarDiplomacyState;
  currentDay: number;
  gold: number;
  onNegotiateTruce?: (nationId: string) => void;
  onHireAsset?: (asset: 'mercenaries' | 'thieves_guild' | 'interpreter') => void;
  onFacePatrol?: (nationId: string) => void;
}) {
  const rivals = war.nationOrder.filter((id) => id !== war.playerNationId);
  const interpreterHired = diplomacy.interpreterHired === true;
  return (
    <div data-testid="realm-war-room-diplomacy" className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Truces & Threat — war chest {gold} gp
        </h3>
        {rivals.map((nationId) => {
          const nation = war.nations[nationId]!;
          const threat = getNationThreat(diplomacy, nationId);
          const tier = getWarThreatTier(threat);
          const truced = isTruceActive(war, war.playerNationId, nationId, currentDay);
          let tongue = '';
          try {
            const profile = getWarNationLanguageProfile(nationId);
            tongue = profile.liturgicalLanguage
              ? `${profile.commandLanguage} (+${profile.liturgicalLanguage} writs)`
              : profile.battleLanguage
                ? `${profile.commandLanguage} / ${profile.battleLanguage} battle`
                : profile.commandLanguage;
          } catch {
            tongue = '';
          }
          return (
            <div
              key={nationId}
              data-testid={`realm-war-diplomacy-nation-${nationId}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="font-bold text-slate-200 truncate">{nation.name}</span>
              {tongue && (
                <span
                  data-testid={`realm-war-tongue-${nationId}`}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 font-mono shrink-0"
                  title={`Command tongue: ${tongue}. Parley in tongue +2 (top tier unlocked); magic baseline; interpreter baseline +${INTERPRETER_PER_PARLEY_FEE_GOLD}gp; gestures −2 (top tier locked).`}
                >
                  🗣️ {tongue}
                </span>
              )}
              <span
                data-testid={`realm-war-diplomacy-threat-${nationId}`}
                className="font-mono text-slate-400"
                title={
                  threat >= 55
                    ? 'Hunter-killer pursuit active — Threat cools -6/day outside their lands, -2/day undetected inside'
                    : 'Threat cools -6/day outside their lands, -2/day undetected inside'
                }
              >
                Threat {threat} ({tier})
              </span>
              {truced && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">
                  TRUCE
                </span>
              )}
              {onNegotiateTruce && !truced && (
                <button
                  type="button"
                  data-testid={`realm-war-truce-btn-${nationId}`}
                  onClick={() => onNegotiateTruce(nationId)}
                  className="ml-auto px-2 py-1 rounded-md bg-sky-900/50 border border-sky-700/60 hover:bg-sky-800/60 text-[11px] font-semibold text-sky-200 min-h-[32px]"
                >
                  Negotiate Truce
                </button>
              )}
              {onFacePatrol && (
                <button
                  type="button"
                  data-testid={`realm-war-patrol-btn-${nationId}`}
                  onClick={() => onFacePatrol(nationId)}
                  className={`px-2 py-1 rounded-md bg-red-950/50 border border-red-700/60 hover:bg-red-900/60 text-[11px] font-semibold text-red-200 min-h-[32px] ${onNegotiateTruce && !truced ? '' : 'ml-auto'}`}
                >
                  Face Patrol
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Covert Assets
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="realm-war-hire-mercenaries-btn"
            onClick={() => onHireAsset?.('mercenaries')}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold min-h-[36px]"
          >
            ⚔️ Hire Mercenaries (200 gp)
          </button>
          <button
            type="button"
            data-testid="realm-war-hire-thieves-btn"
            onClick={() => onHireAsset?.('thieves_guild')}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold min-h-[36px]"
          >
            🗝️ Hire Thieves&apos; Guild (150 gp)
          </button>
          <button
            type="button"
            data-testid="realm-war-hire-interpreter-btn"
            onClick={() => onHireAsset?.('interpreter')}
            disabled={interpreterHired}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold min-h-[36px] disabled:opacity-50"
            title={`Retain a polyglot linguist (${INTERPRETER_HIRE_COST_GOLD} gp) covering every war command tongue. Carried bluffs and truces resolve at baseline +${INTERPRETER_PER_PARLEY_FEE_GOLD} gp per parley.`}
          >
            {interpreterHired
              ? `🧑‍⚖️ Interpreter retained (+${INTERPRETER_PER_PARLEY_FEE_GOLD} gp/parley)`
              : `🧑‍⚖️ Hire Interpreter (${INTERPRETER_HIRE_COST_GOLD} gp)`}
          </button>
        </div>
        {interpreterHired && (
          <p data-testid="realm-war-interpreter-note" className="text-[11px] text-violet-300">
            Interpreter retained — bluffs and truces without the local tongue resolve at baseline
            (+{INTERPRETER_PER_PARLEY_FEE_GOLD} gp per carried parley); sealed dispatches read plain.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Sub-Faction Patronage
        </h3>
        {(['local_orc_tribe', 'local_druid_circle'] as const).map((id) => {
          const progress = diplomacy.subfactions[id];
          const quests = WAR_SUBFACTION_QUESTS[id];
          const done = progress?.completedQuestIds.length ?? 0;
          const allied = progress?.allied ?? false;
          void getWarPowerTotal;
          return (
            <div
              key={id}
              data-testid={`realm-war-subfaction-${id}`}
              className="text-xs text-slate-300"
            >
              <span className="font-bold">
                {id === 'local_orc_tribe' ? '🐗 Local Orc Tribe' : '🌿 Local Druid Circle'}
              </span>{' '}
              — {done}/{quests.length} quests
              {allied && (
                <span className="ml-1 text-emerald-300 font-bold">ALLIED ✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
