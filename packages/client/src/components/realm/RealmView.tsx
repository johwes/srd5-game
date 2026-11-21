import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterBuildState, SrdCompendium } from '@srd5/data';
import { defaultCompendium } from '@srd5/data';
import {
  type Combatant,
  type DungeonFloorSpec,
  type GameState,
  type GeneratedOverworldBattle,
  type OverworldCoord,
  type RealmDelveState,
  type VeteranRosterEntry,
  type WarPatrolApproach,
  type WaveReinforcementSpec,
  canLevelUpByXp,
  collectVeteranCandidates,
  computeDerivedCharacter,
  findOverworldPath,
  getFactionByPoi,
  getNationThreat,
  getWarThreatTier,
  isSafeRestSite,
  planVeteranRetirement,
} from '@srd5/engine';
import { LocalTransport } from '@srd5/transport';
import { OverworldCanvasViewport } from '../../canvas/index.js';
import { useEscHandler, ESC_PRIORITY } from '../../hooks/useEscStack.js';
import { DungeonView } from '../dungeon/index.js';
import {
  type DungeonStorageAdapter,
  defaultDungeonStorageAdapter,
  loadVeteranRoster,
  saveGraveyardEntry,
  saveVeteranRoster,
} from '../../persistence/index.js';
import { VeteranRetirementOffer } from '../campaign/VeteranRetirementOffer.js';
import { RealmHud } from './RealmHud.js';
import { RealmBattleView, type RealmBattleOutcome } from './RealmBattleView.js';
import { RealmCampModal } from './RealmCampModal.js';
import { RealmFactionsModal } from './RealmFactionsModal.js';
import { RealmQuestJournalModal, type RealmQuestTab } from './RealmQuestJournalModal.js';
import { RealmShopModal } from './RealmShopModal.js';
import { RealmSettlementHubModal } from './RealmSettlementHubModal.js';
import { RealmNationSelectModal } from './RealmNationSelectModal.js';
import { RealmWarRoomModal } from './RealmWarRoomModal.js';
import { RealmMissionApproachModal } from './RealmMissionApproachModal.js';
import { RealmPatrolModal, buildPatrolPreviews } from './RealmPatrolModal.js';
import { RealmWarOutcomeModal } from './RealmWarOutcomeModal.js';
import {
  type RealmCommand,
  type RealmExpeditionPreview,
  type RealmSessionEvent,
  type RealmSessionState,
  type ResolveRealmDelveResult,
  canForceMarch,
  canTakeEarlyCamp,
  createRealmSession,
  describeRealmEvent,
  getCurrentPoi,
  getPartyList,
  getRealmDayBudget,
  isSettlementPoi,
  loadRealmSession,
  previewRealmExpedition,
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
  | 'hub'
  | 'factions'
  | 'pause'
  | 'defeat'
  | 'delve_results'
  | 'nation_select'
  | 'war_room'
  | 'mission_approach';

export interface RealmViewProps {
  partyCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  seed?: number;
  storageAdapter?: DungeonStorageAdapter;
  onExitToRoster: () => void;
  onOpenCharacterSheet?: (characterId: string, liveBuild?: CharacterBuildState) => void;
  onSyncPartyBuilds?: (updatedBuilds: CharacterBuildState[]) => void;
  /** SRD-1405: removes retired veterans from the App roster. */
  onRemovePartyBuilds?: (buildIds: string[]) => void;
  /** SRD-1403: Civ setup-screen session config. */
  worldOptions?: import('@srd5/engine').WorldOptions;
}

interface ActiveBattle {
  transport: LocalTransport;
  battle: GeneratedOverworldBattle;
  /** Timed war-mission wave schedule (SRD-1102/1105, Spec 10 §4.2). */
  waves: WaveReinforcementSpec[];
  /** Scheduled (not yet spawned) war reinforcements. */
  reinforcementQueue: Combatant[];
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
  onSyncPartyBuilds,
  onRemovePartyBuilds,
  worldOptions,
}: RealmViewProps) {
  const [session, setSession] = useState<RealmSessionState>(() =>
    createRealmSession({ partyCharacters, compendium, seed, ...(worldOptions ? { worldOptions } : {}) }),
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
  // Enemy-territory patrol encounter dialogue (SRD-1106, Spec 10 §7). Set when
  // the party opts to face a patrol from the War Room diplomacy tab.
  const [patrolNationId, setPatrolNationId] = useState<string | null>(null);
  const [patrolResult, setPatrolResult] = useState<{ headline: string; rollLine: string | null } | null>(null);
  // Dismissible war-outcome ending (SRD-1106, Spec 10 §1): shown once per
  // verdict, "Keep Exploring" lets the party roam after the verdict.
  const [outcomeDismissed, setOutcomeDismissed] = useState(false);
  // SRD-1405: persistent veteran roster + pending delve-clear retirement offer.
  const [veteranRoster, setVeteranRoster] = useState<VeteranRosterEntry[]>([]);
  const [delveRetirement, setDelveRetirement] = useState<{
    candidates: CharacterBuildState[];
    runId?: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void loadVeteranRoster().then((loaded) => {
      if (active) setVeteranRoster(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

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

  // Escape toggles the pause menu / closes the active modal (BG3 layering via
  // the shared useEscStack — the topmost layer owns the key).
  useEscHandler(
    () => {
      setModalState((current) => {
        if (current === 'defeat') return current;
        if (current === 'pause') return null;
        if (current !== null) return null;
        return 'pause';
      });
      return true;
    },
    { priority: ESC_PRIORITY.base, active: !overlayActiveRef.current },
  );

  const dispatchRealm = useCallback(
    (command: RealmCommand) => {
      try {
        const result = reduceRealm(sessionRef.current, command, { compendium });
        setSession(result.session);
        appendEvents(result.events, result.session.travel.currentDay);
        // War-mission Approach Dialogue owns its modal (SRD-1106, Spec 10 §5):
        // offered missions open the dialogue; bloodless resolutions keep it
        // open on the d20 result; contested resolutions mount the battle.
        if (command.type === 'NEGOTIATE_TRUCE' || command.type === 'HIRE_COVERT_ASSET') {
          setPatrolResult(null);
        }
        if (command.type === 'ACCEPT_WAR_MISSION') {
          setModalState('mission_approach');
        }
        if (command.type === 'RESOLVE_MISSION_APPROACH') {
          if (!result.battle) setModalState('mission_approach');
        }
        if (command.type === 'COMPLETE_WAR_MISSION') {
          setModalState(null);
        }
        // Patrol dialogue (SRD-1106, Spec 10 §7): a passed patrol surfaces the
        // headline in the modal; a failed one mounts the Hunter-Killer battle.
        if (command.type === 'RESOLVE_PATROL_ENCOUNTER') {
          const resolved = result.events.find((e) => e.type === 'WAR_PATROL_RESOLVED');
          const headline =
            resolved && resolved.type === 'WAR_PATROL_RESOLVED' ? resolved.headline : 'Patrol resolved';
          if (!result.battle) {
            setPatrolResult({ headline, rollLine: null });
          } else {
            setPatrolResult({ headline, rollLine: 'The patrol attacks — deploy for battle!' });
          }
        }
        if (command.type === 'SELECT_PLAYER_NATION') {
          setOutcomeDismissed(false);
          setModalState(null);
        }
        if (result.battle && result.battleGameState) {
          const transport = new LocalTransport({
            initialState: result.battleGameState,
            defaultPlayerId: 'player-1',
          });
          setBattle({
            transport,
            battle: result.battle,
            waves: result.session.pendingWarBattle?.waves ?? [],
            reinforcementQueue: result.session.pendingWarBattle?.reinforcementQueue ?? [],
          });
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

  const syncPartyBuilds = useCallback(
    (partyMap: Record<string, Combatant>) => {
      if (!onSyncPartyBuilds) return;
      const builds = Object.values(partyMap)
        .map((hero) => hero.buildState)
        .filter((b): b is CharacterBuildState => Boolean(b));
      if (builds.length > 0) {
        onSyncPartyBuilds(builds);
      }
    },
    [onSyncPartyBuilds],
  );

  // SRD-1405: retire a hero into the persistent veteran roster at a run
  // conclusion (cleared delve, Realm dominance victory). The retiree leaves
  // the live session party and the App roster; the last hero cannot retire.
  const retireRealmHero = useCallback(
    (
      candidates: CharacterBuildState[],
      heroId: string,
      confirmRelease: boolean,
      source: 'delve' | 'realm',
      runId?: string,
    ) => {
      const hero = candidates.find((c) => c.id === heroId);
      if (!hero) return;
      const partySize = Object.keys(sessionRef.current.party).length;
      if (partySize <= 1) {
        showFeedback('Your last hero cannot retire — the company needs a leader.');
        return;
      }
      const planned = planVeteranRetirement(veteranRoster, [hero], {
        runId,
        source,
        confirmRelease,
      });
      if (planned.requiresConfirmation) {
        void loadVeteranRoster().then(setVeteranRoster);
        return;
      }
      setVeteranRoster(planned.roster);
      void saveVeteranRoster(planned.roster);
      setDelveRetirement((prev) =>
        prev ? { ...prev, candidates: prev.candidates.filter((c) => c.id !== heroId) } : prev,
      );
      setSession((prev) => {
        if (!prev.party[heroId]) return prev;
        const nextParty = { ...prev.party };
        delete nextParty[heroId];
        return { ...prev, party: nextParty };
      });
      syncPartyBuilds(
        Object.fromEntries(
          Object.entries(sessionRef.current.party).filter(([id]) => id !== heroId),
        ),
      );
      onRemovePartyBuilds?.([heroId]);
      showFeedback(`${hero.name} retires into legend — rehirable at the campfire.`);
    },
    [veteranRoster, showFeedback, syncPartyBuilds, onRemovePartyBuilds],
  );

  // SRD-1405: living leveled heroes at a dominance victory may retire.
  const warVictoryCandidates = useMemo<CharacterBuildState[]>(() => {
    if (!session.war || session.war.outcome !== 'victory') return [];
    return collectVeteranCandidates(session.party);
  }, [session.war, session.party]);

  // Sync external character edits (e.g. LevelUpModal or CharacterSheetDrawer)
  // back into the active Realm session's party combatants.
  useEffect(() => {
    if (partyCharacters.length === 0) return;
    const byId = new Map(partyCharacters.map((c) => [c.id, c]));
    setSession((prev) => {
      let changed = false;
      const nextParty: Record<string, Combatant> = { ...prev.party };
      for (const [id, hero] of Object.entries(prev.party)) {
        const external = byId.get(id);
        if (!external || !hero.buildState) continue;
        const extLevel = external.classes.reduce((s, c) => s + c.level, 0);
        const curLevel = hero.buildState.classes.reduce((s, c) => s + c.level, 0);
        // Only pull external updates when level increased or equipped/inventory changed
        // without overwriting newer Realm XP if the external copy is stale.
        if (extLevel > curLevel || (external.runtime.xp === hero.buildState.runtime.xp && external !== hero.buildState)) {
          const mergedBuild: CharacterBuildState = {
            ...external,
            runtime: {
              ...external.runtime,
              xp: Math.max(external.runtime.xp, hero.buildState.runtime.xp),
            },
          };
          const sheet = computeDerivedCharacter(mergedBuild, compendium);
          const hpDelta = Math.max(0, sheet.maxHp - hero.maxHp);
          nextParty[id] = {
            ...hero,
            buildState: mergedBuild,
            characterSheet: sheet,
            maxHp: sheet.maxHp,
            currentHp: Math.min(sheet.maxHp, hero.currentHp + hpDelta),
            armorClass: sheet.armorClass.totalAc,
            attacksPerAction: sheet.attacksPerAction,
            speedFeet: sheet.speedFeet,
            levelUpAvailable: canLevelUpByXp(sheet.totalLevel, mergedBuild.runtime.xp),
          };
          changed = true;
        }
      }
      return changed ? { ...prev, party: nextParty } : prev;
    });
  }, [partyCharacters, compendium]);

  const handleInspectHero = useCallback(
    (charId: string) => {
      syncPartyBuilds(sessionRef.current.party);
      const liveBuild = sessionRef.current.party[charId]?.buildState;
      onOpenCharacterSheet?.(charId, liveBuild);
    },
    [onOpenCharacterSheet, syncPartyBuilds],
  );

  // POI delve commit-back (SRD-806, Spec 06 §4.3): loot/XP/rations return to the
  // overworld party, the POI clears, linked quests resolve, and the delve's
  // graveyard entry persists. A wipe surfaces the defeat modal instead.
  const handleDelveResolved = useCallback(
    (delve: RealmDelveState, gameState: GameState) => {
      try {
        const resolved = resolveRealmDelve(sessionRef.current, delve, gameState, compendium);
        setSession(resolved.session);
        syncPartyBuilds(resolved.session.party);
        appendEvents(resolved.events, resolved.session.travel.currentDay);
        if (resolved.graveyardEntry) {
          saveGraveyardEntry(resolved.graveyardEntry);
        }
        setActiveDelve(null);
        if (!resolved.cleared) {
          setModalState('defeat');
        } else {
          setDelveResult(resolved);
          // SRD-1405: cleared delves conclude a run — surviving leveled
          // heroes may retire (snapshots from the post-commit party).
          setDelveRetirement({
            candidates: collectVeteranCandidates(resolved.session.party),
            runId: delve.runId,
          });
          setModalState('delve_results');
        }
      } catch (err: unknown) {
        console.error('Error resolving realm delve:', err);
        showFeedback(err instanceof Error ? err.message : String(err));
        setActiveDelve(null);
      }
    },
    [appendEvents, compendium, showFeedback, syncPartyBuilds],
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
          syncPartyBuilds(resolved.session.party);
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
        // A lost war-mission battle still resolves the campaign op as a
        // defeat (enemy holds the field); standalone wilderness wipes keep the
        // legacy defeat modal without campaign side effects.
        if (sessionRef.current.pendingWarBattle && sessionRef.current.activeWarMission) {
          try {
            const result = reduceRealm(
              sessionRef.current,
              { type: 'COMPLETE_WAR_MISSION', victory: false },
              { compendium },
            );
            setSession(result.session);
            appendEvents(result.events, result.session.travel.currentDay);
          } catch (err: unknown) {
            console.error('Error resolving war mission defeat:', err);
          }
        } else if (sessionRef.current.pendingWarBattle) {
          setSession({ ...sessionRef.current, pendingWarBattle: null });
        }
        setBattle(null);
        setModalState('defeat');
      }
    },
    [battle, appendEvents, compendium, showFeedback, syncPartyBuilds],
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
  const earlyRestAvailable = canTakeEarlyCamp(session);
  const forcedMarchAvailable = canForceMarch(session);
  const dayBudget = getRealmDayBudget(session);

  // Pre-commit expedition estimate for the hovered tile (SRD-807): total
  // cost, days, rations and arrival phase. Unreachable tiles surface the
  // routing error instead of a preview.
  const expeditionPreview: { preview: RealmExpeditionPreview | null; error: string | null } =
    useMemo(() => {
      if (!hoveredTile || battle) return { preview: null, error: null };
      if (
        hoveredTile.q === session.travel.partyPosition.q &&
        hoveredTile.r === session.travel.partyPosition.r
      ) {
        return { preview: null, error: null };
      }
      try {
        return { preview: previewRealmExpedition(session, hoveredTile), error: null };
      } catch (err: unknown) {
        return { preview: null, error: err instanceof Error ? err.message : String(err) };
      }
    }, [hoveredTile, session, battle]);
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

  // --- War UI derived state (SRD-1106, Spec 10 §5/§7) ---
  const activeMission = session.activeWarMission;
  const approachBonuses = useMemo(() => {
    if (!activeMission) return {} as Record<string, { bonus: number; actorName: string }>;
    const out: Record<string, { bonus: number; actorName: string }> = {};
    for (const approach of activeMission.approaches) {
      let best = { bonus: Number.NEGATIVE_INFINITY, actorName: getPartyList(session)[0]?.name ?? '—' };
      for (const hero of getPartyList(session)) {
        const skills = (hero.characterSheet?.skills ?? {}) as Record<string, { totalBonus?: number } | undefined>;
        const primary = approach.skillId ? (skills[approach.skillId]?.totalBonus ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
        const alternate = approach.alternateSkillId
          ? (skills[approach.alternateSkillId]?.totalBonus ?? Number.NEGATIVE_INFINITY)
          : Number.NEGATIVE_INFINITY;
        const bonus = Math.max(primary, alternate);
        if (bonus > best.bonus) best = { bonus, actorName: hero.name };
      }
      out[approach.id] = {
        bonus: best.bonus === Number.NEGATIVE_INFINITY ? 0 : best.bonus,
        actorName: best.actorName,
      };
    }
    return out;
  }, [activeMission, session]);

  const patrolPreviews = useMemo(() => {
    if (!patrolNationId) return [];
    const heroes = getPartyList(session);
    const bestOf = (...ids: string[]): { bonus: number; actorName: string } => {
      let best = { bonus: Number.NEGATIVE_INFINITY, actorName: heroes[0]?.name ?? '—' };
      for (const hero of heroes) {
        const skills = (hero.characterSheet?.skills ?? {}) as Record<string, { totalBonus?: number } | undefined>;
        const bonus = Math.max(...ids.map((id) => skills[id]?.totalBonus ?? Number.NEGATIVE_INFINITY));
        if (bonus > best.bonus) best = { bonus, actorName: hero.name };
      }
      return { bonus: best.bonus === Number.NEGATIVE_INFINITY ? 0 : best.bonus, actorName: best.actorName };
    };
    const bluff = bestOf('persuasion', 'deception');
    const evade = bestOf('stealth', 'survival');
    return buildPatrolPreviews({
      bluffBonus: bluff.bonus,
      bluffActor: bluff.actorName,
      evadeBonus: evade.bonus,
      evadeActor: evade.actorName,
      gold: session.travel.gold,
    });
  }, [patrolNationId, session]);

  const patrolNationName = patrolNationId && session.war ? (session.war.nations[patrolNationId]?.name ?? patrolNationId) : (patrolNationId ?? '');
  const patrolThreat = patrolNationId ? getNationThreat(session.diplomacy, patrolNationId) : 0;
  const showWarOutcome = Boolean(session.war && session.war.outcome !== 'ongoing' && !outcomeDismissed);

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
          // SRD-1406 gate: the delve inherits the Realm session's Civ
          // setup-screen config (Spec 13 §5) so its HUD banner, run record,
          // and generation match the chosen scope/wildness/scarcity/seed.
          worldOptions={session.travel.worldOptions}
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
          waves={battle.waves}
          reinforcementQueue={battle.reinforcementQueue}
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
            expeditionPreview={expeditionPreview.preview}
            expeditionPreviewError={expeditionPreview.error}
            canForceMarch={forcedMarchAvailable}
            dayBudget={dayBudget}
            onSetPace={(pace) => dispatchRealm({ type: 'REALM_SET_PACE', pace })}
            onForage={() => dispatchRealm({ type: 'REALM_FORAGE' })}
            onForceMarch={() => dispatchRealm({ type: 'REALM_FORCE_MARCH' })}
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
            onOpenHub={() => setModalState('hub')}
            onEnterPoi={() => {
              if (currentPoi) {
                dispatchRealm({ type: 'REALM_ENTER_POI', poiId: currentPoi.id });
              }
            }}
            onEndlessDelve={() => setEndlessDelve(true)}
            onOpenPause={() => setModalState('pause')}
            onInspectCharacter={handleInspectHero}
            war={session.war}
            diplomacy={session.diplomacy}
            onOpenNationSelect={() => setModalState('nation_select')}
            onOpenWarRoom={() => setModalState('war_room')}
          />
        </div>
      )}

      {/* Camp / Inn rest modal */}
      <RealmCampModal
        isOpen={modalState === 'camp'}
        onClose={() => setModalState(null)}
        session={session}
        safeSite={safeSite}
        canCampEarly={earlyRestAvailable}
        onCamp={(restType, hitDiceToSpend) => {
          setModalState(null);
          dispatchRealm({ type: 'REALM_CAMP', restType, hitDiceToSpend });
        }}
        onCampEarly={(hitDiceToSpend) => {
          setModalState(null);
          dispatchRealm({ type: 'REALM_CAMP', restType: 'short', hitDiceToSpend, early: true });
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

      {/* Settlement adventuring hub (SRD-808): inn / market / temple / board */}
      <RealmSettlementHubModal
        isOpen={modalState === 'hub'}
        onClose={() => setModalState(null)}
        session={session}
        poi={currentPoi && isSettlementPoi(currentPoi) ? currentPoi : null}
        onCamp={(restType) => {
          setModalState(null);
          dispatchRealm({ type: 'REALM_CAMP', restType });
        }}
        onHearRumor={(targetPoiId) => {
          if (!currentPoi) return;
          dispatchRealm({ type: 'REALM_HEAR_RUMOR', poiId: currentPoi.id, targetPoiId });
        }}
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
        onIdentify={(characterId, instanceId) => {
          if (!currentPoi) return;
          dispatchRealm({
            type: 'REALM_IDENTIFY_ITEM',
            poiId: currentPoi.id,
            characterId,
            instanceId,
          });
        }}
        onCleanse={(characterId) => {
          if (!currentPoi) return;
          dispatchRealm({ type: 'REALM_TEMPLE_CLEANSE', poiId: currentPoi.id, characterId });
        }}
        onBless={() => {
          if (!currentPoi) return;
          dispatchRealm({ type: 'REALM_TEMPLE_BLESS', poiId: currentPoi.id });
        }}
        onAcceptQuest={(questId) => dispatchRealm({ type: 'REALM_ACCEPT_QUEST', questId })}
        onAbandonQuest={(questId) => dispatchRealm({ type: 'REALM_ABANDON_QUEST', questId })}
      />

      {/* Quest board + journal modal */}
      <RealmQuestJournalModal
        isOpen={modalState === 'quests'}
        onClose={() => setModalState(null)}
        questLog={session.questLog}
        chainLog={session.chainLog}
        currentPoiId={currentPoi && isSettlementPoi(currentPoi) ? currentPoi.id : null}
        currentDay={session.travel.currentDay}
        initialTab={questTab}
        onAccept={(questId) => dispatchRealm({ type: 'REALM_ACCEPT_QUEST', questId })}
        onAbandon={(questId) => dispatchRealm({ type: 'REALM_ABANDON_QUEST', questId })}
        onStartChain={(chainId) => dispatchRealm({ type: 'REALM_START_CHAIN', chainId })}
        onChooseChainOption={(chainId, optionId) =>
          dispatchRealm({ type: 'REALM_CHOOSE_CHAIN_OPTION', chainId, optionId })
        }
        onAbandonChain={(chainId) => dispatchRealm({ type: 'REALM_ABANDON_CHAIN', chainId })}
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
            {/* SRD-1405: cleared delves conclude a run — offer retirement. */}
            {delveRetirement && delveRetirement.candidates.length > 0 && (
              <div className="text-left">
                <VeteranRetirementOffer
                  candidates={delveRetirement.candidates}
                  roster={veteranRoster}
                  onRetire={(heroId, confirmRelease) =>
                    retireRealmHero(
                      delveRetirement.candidates,
                      heroId,
                      confirmRelease,
                      'delve',
                      delveRetirement.runId,
                    )
                  }
                  sourceLabel="Delve Cleared"
                />
              </div>
            )}
            <button
              type="button"
              data-testid="realm-delve-results-return-btn"
              onClick={() => {
                setModalState(null);
                setDelveResult(null);
                setDelveRetirement(null);
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

      {/* War campaign modals (SRD-1106, Spec 10): new campaigns launch with the
          banner pick; the War Room, Approach Dialogue, patrol dialogue, and
          Victory/Defeat endings layer above the overworld map. */}
      <RealmNationSelectModal
        isOpen={modalState === 'nation_select' || (!session.war && !battle && !activeDelve && !endlessDelve)}
        onSelectNation={(archetypeId) =>
          dispatchRealm({ type: 'SELECT_PLAYER_NATION', archetypeId })
        }
      />
      <RealmWarRoomModal
        isOpen={modalState === 'war_room'}
        war={session.war}
        diplomacy={session.diplomacy}
        map={session.map}
        currentDay={session.travel.currentDay}
        gold={session.travel.gold}
        onClose={() => setModalState(null)}
        onAcceptMission={(kind, poiId) => {
          setModalState(null);
          dispatchRealm({ type: 'ACCEPT_WAR_MISSION', missionKind: kind, poiId });
          setModalState('mission_approach');
        }}
        onNegotiateTruce={(nationId) =>
          dispatchRealm({ type: 'NEGOTIATE_TRUCE', targetNationId: nationId })
        }
        onFacePatrol={(nationId) => {
          setPatrolNationId(nationId);
          setPatrolResult(null);
        }}
        onHireAsset={(asset) => {
          if (asset === 'mercenaries') {
            dispatchRealm({ type: 'HIRE_COVERT_ASSET', asset });
          } else {
            // Thieves' Guild cells need a target: default to the first rival
            // mine / supply depot on the map so the button always resolves.
            const target = Object.values(session.map.pois).find((poi) =>
              ['mine', 'supply_depot'].includes(poi.kind),
            );
            if (!target) {
              showFeedback('No enemy supply depot or mine to strike.');
              return;
            }
            dispatchRealm({ type: 'HIRE_COVERT_ASSET', asset, targetPoiId: target.id });
          }
        }}
      />
      <RealmMissionApproachModal
        isOpen={modalState === 'mission_approach' && Boolean(activeMission)}
        missionKind={activeMission?.mission.kind ?? ''}
        poiName={activeMission?.poiName ?? ''}
        approaches={activeMission?.approaches ?? []}
        bonuses={approachBonuses}
        resolved={activeMission?.resolved ?? null}
        onChooseApproach={(approachId) =>
          dispatchRealm({ type: 'RESOLVE_MISSION_APPROACH', approachId })
        }
        onClose={() => setModalState(null)}
      />
      <RealmPatrolModal
        isOpen={patrolNationId !== null}
        nationId={patrolNationId ?? ''}
        nationName={patrolNationName}
        threat={patrolThreat}
        threatTier={getWarThreatTier(patrolThreat)}
        gold={session.travel.gold}
        previews={patrolPreviews}
        result={patrolResult}
        onChooseApproach={(approach: WarPatrolApproach) => {
          if (patrolNationId) {
            dispatchRealm({ type: 'RESOLVE_PATROL_ENCOUNTER', nationId: patrolNationId, approach });
          }
        }}
        onClose={() => {
          setPatrolNationId(null);
          setPatrolResult(null);
        }}
      />
      <RealmWarOutcomeModal
        isOpen={showWarOutcome}
        war={session.war}
        onReturnToTitle={onExitToRoster}
        onKeepExploring={() => setOutcomeDismissed(true)}
        retirementCandidates={warVictoryCandidates}
        veteranRoster={veteranRoster}
        onRetireVeteran={(heroId, confirmRelease) =>
          retireRealmHero(warVictoryCandidates, heroId, confirmRelease, 'realm')
        }
      />
    </div>
  );
}
