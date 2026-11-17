import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterBuildState, SrdCompendium } from '@srd5/data';
import { defaultCompendium } from '@srd5/data';
import {
  type DungeonFloorSpec,
  type GameState,
  type GeneratedOverworldBattle,
  type OverworldCoord,
  type RealmDelveState,
  findOverworldPath,
  getFactionByPoi,
  isSafeRestSite,
} from '@srd5/engine';
import { LocalTransport } from '@srd5/transport';
import { OverworldCanvasViewport } from '../../canvas/index.js';
import { DungeonView } from '../dungeon/index.js';
import {
  type DungeonStorageAdapter,
  defaultDungeonStorageAdapter,
  saveGraveyardEntry,
} from '../../persistence/index.js';
import { RealmHud } from './RealmHud.js';
import { RealmBattleView, type RealmBattleOutcome } from './RealmBattleView.js';
import { RealmCampModal } from './RealmCampModal.js';
import { RealmFactionsModal } from './RealmFactionsModal.js';
import { RealmQuestJournalModal, type RealmQuestTab } from './RealmQuestJournalModal.js';
import { RealmShopModal } from './RealmShopModal.js';
import {
  type RealmCommand,
  type RealmSessionEvent,
  type RealmSessionState,
  type ResolveRealmDelveResult,
  createRealmSession,
  describeRealmEvent,
  getCurrentPoi,
  getPartyList,
  isSettlementPoi,
  loadRealmSession,
  quickSaveRealmSession,
  reduceRealm,
  resolveRealmBattle,
  resolveRealmDelve,
} from './realmEngine.js';

/**
 * The Realm — strategic overworld gameplay view (SRD-805, Spec 06 Section 4).
 *
 * Full-bleed PixiJS world map with the strategic settlement HUD. Realm
 * actions dispatch serializable commands through `reduceRealm`; wilderness
 * encounters and dungeon POI entries seamlessly swap into the tactical
 * combat view and commit results back on victory.
 */

type RealmModalMode =
  | null
  | 'camp'
  | 'shop'
  | 'quests'
  | 'factions'
  | 'pause'
  | 'defeat'
  | 'delve_results';

export interface RealmViewProps {
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  seed?: number;
  storageAdapter?: DungeonStorageAdapter;
  onExitToRoster: () => void;
  onOpenCharacterSheet?: (characterId: string) => void;
}

interface ActiveBattle {
  transport: LocalTransport;
  battle: GeneratedOverworldBattle;
}

interface ActiveDelve {
  delve: RealmDelveState;
  gameState: GameState;
  floor: DungeonFloorSpec;
}

export function RealmView({
  partyCharacters = [],
  compendium = defaultCompendium,
  seed,
  storageAdapter = defaultDungeonStorageAdapter,
  onExitToRoster,
  onOpenCharacterSheet,
}: RealmViewProps) {
  const [session, setSession] = useState<RealmSessionState>(() =>
    createRealmSession({ partyCharacters, compendium, seed }),
  );
  const [battle, setBattle] = useState<ActiveBattle | null>(null);
  const [activeDelve, setActiveDelve] = useState<ActiveDelve | null>(null);
  const [endlessDelve, setEndlessDelve] = useState(false);
  const [delveResult, setDelveResult] = useState<ResolveRealmDelveResult | null>(null);
  const [modalState, setModalState] = useState<RealmModalMode>(null);
  const [questTab, setQuestTab] = useState<RealmQuestTab>('active');
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [hoveredTile, setHoveredTile] = useState<OverworldCoord | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // While a tactical battle / delve overlay is mounted, it owns the Escape key.
  const overlayActiveRef = useRef(false);
  overlayActiveRef.current = Boolean(activeDelve || endlessDelve || battle);

  const showFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setActionFeedback(null), 3500);
  }, []);

  const appendEvents = useCallback((events: RealmSessionEvent[], day: number) => {
    if (events.length === 0) return;
    const lines = events
      .map((ev) => describeRealmEvent(ev))
      .filter((line) => line.length > 0)
      .map((line) => `[Day ${day}] ${line}`);
    setLogEntries((prev) => [...prev.slice(-60), ...lines]);
  }, []);

  // Escape toggles the pause menu / closes the active modal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (overlayActiveRef.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setModalState((current) => {
        if (current === 'defeat') return current;
        if (current === 'pause') return null;
        if (current !== null) return null;
        return 'pause';
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const dispatchRealm = useCallback(
    (command: RealmCommand) => {
      try {
        const result = reduceRealm(sessionRef.current, command, { compendium });
        setSession(result.session);
        appendEvents(result.events, result.session.travel.currentDay);
        if (result.battle && result.battleGameState) {
          const transport = new LocalTransport({
            initialState: result.battleGameState,
            defaultPlayerId: 'player-1',
          });
          setBattle({ transport, battle: result.battle });
          setModalState(null);
        }
        if (result.delve && result.delveGameState && result.delveFloor) {
          setActiveDelve({
            delve: result.delve,
            gameState: result.delveGameState,
            floor: result.delveFloor,
          });
          setModalState(null);
        }
      } catch (err: unknown) {
        console.error('Error dispatching realm command:', err);
        showFeedback(err instanceof Error ? err.message : String(err));
      }
    },
    [appendEvents, compendium, showFeedback],
  );

  // POI delve commit-back (SRD-806, Spec 06 §4.3): loot/XP/rations return to the
  // overworld party, the POI clears, linked quests resolve, and the delve's
  // graveyard entry persists. A wipe surfaces the defeat modal instead.
  const handleDelveResolved = useCallback(
    (delve: RealmDelveState, gameState: GameState) => {
      try {
        const resolved = resolveRealmDelve(sessionRef.current, delve, gameState, compendium);
        setSession(resolved.session);
        appendEvents(resolved.events, resolved.session.travel.currentDay);
        if (resolved.graveyardEntry) {
          saveGraveyardEntry(resolved.graveyardEntry);
        }
        setActiveDelve(null);
        if (!resolved.cleared) {
          setModalState('defeat');
        } else {
          setDelveResult(resolved);
          setModalState('delve_results');
        }
      } catch (err: unknown) {
        console.error('Error resolving realm delve:', err);
        showFeedback(err instanceof Error ? err.message : String(err));
        setActiveDelve(null);
      }
    },
    [appendEvents, compendium, showFeedback],
  );

  // Tactical battle commit-back (Spec 06 Section 4.2 step 3).
  const handleBattleEnd = useCallback(
    (outcome: RealmBattleOutcome, gameState: GameState) => {
      const activeBattle = battle;
      if (!activeBattle) return;
      if (outcome === 'victory') {
        try {
          const resolved = resolveRealmBattle(
            sessionRef.current,
            gameState,
            activeBattle.battle,
            compendium,
          );
          setSession(resolved.session);
          appendEvents(resolved.events, resolved.session.travel.currentDay);
          showFeedback(
            `Victory! +${resolved.totalXp} XP · +${resolved.goldAwarded} gp` +
              (resolved.completedQuestIds.length > 0
                ? ` · ${resolved.completedQuestIds.length} quest(s) completed`
                : ''),
          );
        } catch (err: unknown) {
          console.error('Error resolving realm battle:', err);
          showFeedback(err instanceof Error ? err.message : String(err));
        }
        setBattle(null);
      } else {
        setBattle(null);
        setModalState('defeat');
      }
    },
    [battle, appendEvents, compendium, showFeedback],
  );

  const handleTileClick = useCallback(
    (tile: OverworldCoord) => {
      dispatchRealm({ type: 'REALM_TRAVEL_TO', destination: tile });
    },
    [dispatchRealm],
  );

  // Travel path preview toward the hovered tile.
  const travelPath = useMemo(() => {
    if (!hoveredTile || battle) return null;
    if (
      hoveredTile.q === session.travel.partyPosition.q &&
      hoveredTile.r === session.travel.partyPosition.r
    ) {
      return null;
    }
    try {
      const route = findOverworldPath(session.map, session.travel.partyPosition, hoveredTile);
      return route?.path ?? null;
    } catch {
      return null;
    }
  }, [hoveredTile, session.map, session.travel.partyPosition, battle]);

  const currentPoi = getCurrentPoi(session);
  const safeSite = isSafeRestSite(session.map, session.travel.partyPosition);
  const shopInventory = currentPoi ? (session.shops[currentPoi.id] ?? null) : null;
  const tradeReputation = currentPoi
    ? (getFactionByPoi(session.map, currentPoi.id)?.relationshipWithParty ?? 0)
    : 0;

  const handleSave = useCallback(async () => {
    try {
      const data = await quickSaveRealmSession(sessionRef.current, storageAdapter);
      setSaveInfo(`Saved ${data.worldName} · Day ${data.currentDay}`);
      showFeedback('Realm saved.');
    } catch (err: unknown) {
      console.error('Error saving realm:', err);
      showFeedback('Failed to save the realm.');
    }
  }, [storageAdapter, showFeedback]);

  const handleLoad = useCallback(async () => {
    try {
      const data = await loadRealmSession(storageAdapter);
      if (!data) {
        showFeedback('No realm save found.');
        return;
      }
      setSession(data.session);
      setBattle(null);
      setModalState(null);
      setLogEntries([`[Day ${data.currentDay}] Loaded saved realm: ${data.worldName}`]);
      setSaveInfo(`Saved ${data.worldName} · Day ${data.currentDay}`);
      showFeedback('Realm loaded.');
    } catch (err: unknown) {
      console.error('Error loading realm:', err);
      showFeedback('Failed to load the realm save.');
    }
  }, [storageAdapter, showFeedback]);

  // Inspect save metadata when the pause menu opens.
  useEffect(() => {
    if (modalState !== 'pause') return;
    let active = true;
    void loadRealmSession(storageAdapter).then((data) => {
      if (active && data) {
        setSaveInfo(`Saved ${data.worldName} · Day ${data.currentDay}`);
      }
    });
    return () => {
      active = false;
    };
  }, [modalState, storageAdapter]);

  const battleTitle = battle
    ? battle.battle.origin === 'wilderness'
      ? 'Wilderness Encounter'
      : (session.map.pois[battle.battle.poiId ?? '']?.name ?? 'Dungeon Delve')
    : '';

  return (
    <div
      data-testid="realm-view-container"
      className="fixed inset-0 z-40 w-screen h-screen overflow-hidden bg-slate-950 select-none shadow-2xl"
    >
      {actionFeedback && (
        <div
          data-testid="realm-feedback-banner"
          className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-slate-900/95 border border-amber-500 text-amber-200 rounded-lg text-xs font-semibold shadow-2xl flex items-center gap-2 pointer-events-none"
        >
          <span>🗺️</span>
          <span>{actionFeedback}</span>
        </div>
      )}

      {activeDelve ? (
        <DungeonView
          key={activeDelve.delve.runId}
          gameMode="realm_delve"
          partyCharacters={getPartyList(session)
            .map((c) => c.buildState)
            .filter((c): c is NonNullable<typeof c> => Boolean(c))}
          initialGameState={activeDelve.gameState}
          initialDelveState={activeDelve.delve}
          initialFloorSpec={activeDelve.floor}
          compendium={compendium}
          storageAdapter={storageAdapter}
          onDelveResolved={handleDelveResolved}
          onExitToRoster={() => setActiveDelve(null)}
          onOpenCharacterSheet={onOpenCharacterSheet}
        />
      ) : endlessDelve ? (
        <DungeonView
          key="realm-endless-delve"
          gameMode="roguelite"
          partyCharacters={getPartyList(session)
            .map((c) => c.buildState)
            .filter((c): c is NonNullable<typeof c> => Boolean(c))}
          compendium={compendium}
          storageAdapter={storageAdapter}
          onExitToRoster={() => setEndlessDelve(false)}
          onOpenCharacterSheet={onOpenCharacterSheet}
        />
      ) : battle ? (
        <RealmBattleView
          transport={battle.transport}
          battle={battle.battle}
          title={battleTitle}
          subtitle={`${session.map.worldName} · Day ${session.travel.currentDay}`}
          compendium={compendium}
          onBattleEnd={handleBattleEnd}
          onOpenCharacterSheet={onOpenCharacterSheet}
        />
      ) : (
        <div className="relative w-full h-full overflow-hidden">
          <OverworldCanvasViewport
            map={session.map}
            partyPosition={session.travel.partyPosition}
            travelPath={travelPath}
            hoveredTile={hoveredTile}
            timeOfDay={session.travel.timeOfDay}
            clearedPoiIds={session.clearedPoiIds}
            onTileHover={setHoveredTile}
            onTileClick={handleTileClick}
            className="w-full h-full"
            testId="realm-overworld-viewport"
          />

          <RealmHud
            session={session}
            currentPoi={currentPoi}
            logEntries={logEntries}
            onSetPace={(pace) => dispatchRealm({ type: 'REALM_SET_PACE', pace })}
            onForage={() => dispatchRealm({ type: 'REALM_FORAGE' })}
            onOpenCamp={() => setModalState('camp')}
            onOpenJournal={() => {
              setQuestTab('active');
              setModalState('quests');
            }}
            onOpenFactions={() => setModalState('factions')}
            onOpenShop={() => setModalState('shop')}
            onOpenQuestBoard={() => {
              setQuestTab('board');
              setModalState('quests');
            }}
            onEnterPoi={() => {
              if (currentPoi) {
                dispatchRealm({ type: 'REALM_ENTER_POI', poiId: currentPoi.id });
              }
            }}
            onEndlessDelve={() => setEndlessDelve(true)}
            onOpenPause={() => setModalState('pause')}
            onInspectCharacter={onOpenCharacterSheet}
          />
        </div>
      )}

      {/* Camp / Inn rest modal */}
      <RealmCampModal
        isOpen={modalState === 'camp'}
        onClose={() => setModalState(null)}
        session={session}
        safeSite={safeSite}
        onCamp={(restType, hitDiceToSpend) => {
          setModalState(null);
          dispatchRealm({ type: 'REALM_CAMP', restType, hitDiceToSpend });
        }}
      />

      {/* Settlement shop modal */}
      <RealmShopModal
        isOpen={modalState === 'shop'}
        onClose={() => setModalState(null)}
        poi={currentPoi && isSettlementPoi(currentPoi) ? currentPoi : null}
        inventory={shopInventory}
        session={session}
        reputation={tradeReputation}
        onBuy={(itemId, quantity, characterId) => {
          if (!currentPoi) return;
          dispatchRealm({
            type: 'REALM_BUY_ITEM',
            poiId: currentPoi.id,
            itemId,
            quantity,
            characterId,
          });
        }}
        onSell={(characterId, instanceId) => {
          if (!currentPoi) return;
          dispatchRealm({
            type: 'REALM_SELL_ITEM',
            poiId: currentPoi.id,
            characterId,
            instanceId,
          });
        }}
      />

      {/* Quest board + journal modal */}
      <RealmQuestJournalModal
        isOpen={modalState === 'quests'}
        onClose={() => setModalState(null)}
        questLog={session.questLog}
        currentPoiId={currentPoi && isSettlementPoi(currentPoi) ? currentPoi.id : null}
        currentDay={session.travel.currentDay}
        initialTab={questTab}
        onAccept={(questId) => dispatchRealm({ type: 'REALM_ACCEPT_QUEST', questId })}
        onAbandon={(questId) => dispatchRealm({ type: 'REALM_ABANDON_QUEST', questId })}
      />

      {/* Faction reputation modal */}
      <RealmFactionsModal
        isOpen={modalState === 'factions'}
        onClose={() => setModalState(null)}
        map={session.map}
      />

      {/* Pause / system menu */}
      {modalState === 'pause' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="realm-pause-title"
          data-testid="realm-pause-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-3">
            <header className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 id="realm-pause-title" className="text-xl font-bold text-amber-400">
                ⚙️ System Menu
              </h2>
              <button
                type="button"
                data-testid="realm-pause-close-btn"
                onClick={() => setModalState(null)}
                className="text-slate-400 hover:text-white p-1 rounded-md text-lg"
              >
                ✕
              </button>
            </header>
            <p className="text-xs text-slate-400">
              {session.map.worldName} · Day {session.travel.currentDay}
              {saveInfo ? ` · ${saveInfo}` : ''}
            </p>
            <button
              type="button"
              data-testid="realm-pause-resume-btn"
              onClick={() => setModalState(null)}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-black min-h-[48px]"
            >
              ▶️ Resume
            </button>
            <button
              type="button"
              data-testid="realm-pause-save-btn"
              onClick={() => void handleSave()}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-bold text-slate-100 min-h-[48px]"
            >
              💾 Quick Save
            </button>
            <button
              type="button"
              data-testid="realm-pause-load-btn"
              onClick={() => void handleLoad()}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-bold text-slate-100 min-h-[48px]"
            >
              📂 Load Save
            </button>
            <button
              type="button"
              data-testid="realm-pause-exit-btn"
              onClick={onExitToRoster}
              className="w-full px-4 py-2.5 rounded-lg bg-red-950/60 hover:bg-red-900/70 border border-red-800/60 text-sm font-bold text-red-200 min-h-[48px]"
            >
              🚪 Exit to Title
            </button>
          </div>
        </div>
      )}

      {/* Delve results modal (SRD-806) */}
      {modalState === 'delve_results' && delveResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="realm-delve-results-title"
          data-testid="realm-delve-results-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-500/60 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4 text-center">
            <span className="text-5xl block">{delveResult.cleared ? '🏆' : '☠️'}</span>
            <h2
              id="realm-delve-results-title"
              className="text-2xl font-serif font-extrabold text-amber-400"
            >
              {delveResult.cleared ? 'Delve Cleared!' : 'Delve Failed'}
            </h2>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-slate-400">XP Earned</div>
                <div className="text-base font-bold text-sky-300 mt-0.5">
                  {delveResult.totalXp.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-slate-400">Gold Plundered</div>
                <div className="text-base font-bold text-yellow-300 mt-0.5">
                  +{delveResult.goldAwarded} gp
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-slate-400">Run Score</div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {delveResult.score.toLocaleString()}
                </div>
              </div>
            </div>
            {delveResult.completedQuestIds.length > 0 && (
              <p className="text-xs text-emerald-300 font-semibold">
                ✓ {delveResult.completedQuestIds.length} quest(s) completed
              </p>
            )}
            <button
              type="button"
              data-testid="realm-delve-results-return-btn"
              onClick={() => {
                setModalState(null);
                setDelveResult(null);
              }}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-black min-h-[48px]"
            >
              🗺️ Return to the Realm
            </button>
          </div>
        </div>
      )}

      {/* Party defeat modal */}
      {modalState === 'defeat' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="realm-defeat-title"
          data-testid="realm-defeat-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-red-800 bg-slate-900 shadow-2xl p-6 text-slate-100 space-y-4 text-center">
            <h2 id="realm-defeat-title" className="text-2xl font-serif font-extrabold text-red-400">
              ☠️ The Party Has Fallen
            </h2>
            <p className="text-sm text-slate-400">
              The realm claims another band of heroes. Load your last save or
              return to the title screen.
            </p>
            <button
              type="button"
              data-testid="realm-defeat-load-btn"
              onClick={() => void handleLoad()}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-bold min-h-[48px]"
            >
              📂 Load Last Save
            </button>
            <button
              type="button"
              data-testid="realm-defeat-exit-btn"
              onClick={onExitToRoster}
              className="w-full px-4 py-2.5 rounded-lg bg-red-900/70 hover:bg-red-800 text-sm font-black text-white min-h-[48px]"
            >
              🚪 Exit to Title
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
