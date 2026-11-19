/** Aggregate Realm session state: world map, travel loop, party, economy, war and command types (SRD-805, Spec 06 Section 4). Pure types plus tiny party-list getters; no reducer logic. */

import {
  type Combatant,
  type DungeonFloorSpec,
  type GameEvent,
  type GeneratedOverworldBattle,
  type GameState,
  type MissionApproachOption,
  type OverworldBattleOrigin,
  type OverworldCoord,
  type OverworldMap,
  type OverworldTravelEvent,
  type OverworldTravelState,
  type QuestChainLog,
  type QuestLog,
  type RealmDelveKind,
  type RealmDelveState,
  type RealmEvent,
  type ResolvedMissionApproach,
  type ShopInventory,
  type TravelPace,
  type WarBattleModifiers,
  type WarDiplomacyState,
  type WarMission,
  type WarMissionKind,
  type WarState,
  type WaveReinforcementSpec,
} from '@srd5/engine';

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Aggregate persistent Realm state: world map + travel loop + party + economy. */
export interface RealmSessionState {
  map: OverworldMap;
  travel: OverworldTravelState;
  party: Record<string, Combatant>;
  /** Stable display/command order of the party combatant ids. */
  partyOrder: string[];
  questLog: QuestLog;
  /** Multi-stage quest chains (SRD-809): branches, timers, follow-ups. */
  chainLog: QuestChainLog;
  /** Per-settlement shop inventories keyed by POI id. */
  shops: Record<string, ShopInventory>;
  /** Dungeon entrance / monster lair POIs already cleared by the party. */
  clearedPoiIds: string[];
  /** Wilderness POIs revealed through inn rumors (SRD-808). */
  revealedPoiIds: string[];
  /** Ancient shrine POIs already communed with (one blessing per shrine). */
  usedShrinePoiIds: string[];
  /** Living multi-nation war state (SRD-1101 / SRD-1105); null before the party picks a nation. */
  war: WarState | null;
  /** Per-nation Threat, sub-faction progress, and the Druid blessing flag (SRD-1104). */
  diplomacy: WarDiplomacyState;
  /** Currently offered special-ops mission with its Approach Dialogue state (SRD-1103/1105). */
  activeWarMission: ActiveWarMissionState | null;
  /** Scheduled multi-wave war battle awaiting launch or resolution (SRD-1102/1105). */
  pendingWarBattle: PendingWarBattleState | null;
}

/** A special-ops mission offered at a strategic POI plus Approach Dialogue progress. */
export interface ActiveWarMissionState {
  mission: WarMission;
  poiId: string;
  poiName: string;
  targetNationId?: string;
  approaches: MissionApproachOption[];
  resolved: ResolvedMissionApproach | null;
  status: 'offered' | 'approached' | 'battle' | 'complete';
}

/** A generated war-mission tactical battle with its scheduled reinforcement queue. */
export interface PendingWarBattleState {
  missionId: string;
  poiId: string;
  poiName: string;
  battle: GeneratedOverworldBattle;
  waves: WaveReinforcementSpec[];
  reinforcementQueue: Combatant[];
  modifiers: WarBattleModifiers;
}

export type RealmSessionEvent =
  | OverworldTravelEvent
  | RealmEvent
  | { type: 'REALM_ENCOUNTER_STARTED'; battleId: string; origin: OverworldBattleOrigin; poiId?: string }
  | {
      type: 'REALM_BATTLE_RESOLVED';
      battleId: string;
      totalXp: number;
      goldAwarded: number;
      completedQuestIds: string[];
    }
  | { type: 'REALM_POI_CLEARED'; poiId: string; name: string }
  | {
      type: 'REALM_DELVE_STARTED';
      poiId: string;
      name: string;
      kind: RealmDelveKind;
      floors: number;
    }
  | {
      type: 'REALM_DELVE_RESOLVED';
      poiId: string;
      name: string;
      kind: RealmDelveKind;
      cleared: boolean;
      score: number;
      totalXp: number;
      goldAwarded: number;
      completedQuestIds: string[];
    }
  | {
      type: 'REALM_SHRINE_ACTIVATED';
      poiId: string;
      shrineType: string;
      effectDescription: string;
    }
  // --- War Campaign events (SRD-1105, Spec 10) ---
  | { type: 'WAR_NATION_SELECTED'; nationId: string; nationName: string }
  | { type: 'WAR_MISSION_ACCEPTED'; missionId: string; kind: string; poiId: string; poiName: string }
  | {
      type: 'WAR_APPROACH_RESOLVED';
      missionId: string;
      approachId: string;
      success: boolean;
      bloodless: boolean;
      headline: string;
    }
  | { type: 'WAR_MISSION_COMPLETED'; missionId: string; poiId: string; victory: boolean }
  | { type: 'WAR_PATROL_RESOLVED'; nationId: string; approach: string; headline: string }
  | { type: 'WAR_TRUCE_NEGOTIATED'; nationId: string; success: boolean; headline: string }
  | { type: 'WAR_ASSET_HIRED'; asset: string; success: boolean; headline: string }
  | { type: 'REALM_LOG'; message: string };

export interface RealmReduceResult {
  session: RealmSessionState;
  events: RealmSessionEvent[];
  /** Set when the command triggered a tactical battle; the view swaps to combat. */
  battle?: GeneratedOverworldBattle;
  battleGameState?: GameState;
  battleEvents?: GameEvent[];
  /** Set when the command launched a POI delve; the view swaps to the delver. */
  delve?: RealmDelveState;
  delveGameState?: GameState;
  delveFloor?: DungeonFloorSpec;
  delveEvents?: GameEvent[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type RealmCommand =
  | { type: 'REALM_TRAVEL_TO'; destination: OverworldCoord }
  | { type: 'REALM_SET_PACE'; pace: TravelPace }
  | { type: 'REALM_FORAGE' }
  | { type: 'REALM_FORCE_MARCH' }
  | {
      type: 'REALM_CAMP';
      restType: 'short' | 'long';
      hitDiceToSpend?: Record<string, number>;
      /** Secure daylight Short Rest that does not advance the day (SRD-807). */
      early?: boolean;
    }
  | { type: 'REALM_ACCEPT_QUEST'; questId: string }
  | { type: 'REALM_ABANDON_QUEST'; questId: string }
  | { type: 'REALM_START_CHAIN'; chainId: string }
  | { type: 'REALM_CHOOSE_CHAIN_OPTION'; chainId: string; optionId: string }
  | { type: 'REALM_ABANDON_CHAIN'; chainId: string }
  | { type: 'REALM_BUY_ITEM'; poiId: string; itemId: string; quantity: number; characterId?: string }
  | { type: 'REALM_SELL_ITEM'; poiId: string; characterId: string; instanceId: string }
  | { type: 'REALM_HEAR_RUMOR'; poiId: string; targetPoiId: string }
  | { type: 'REALM_IDENTIFY_ITEM'; poiId: string; characterId: string; instanceId: string }
  | { type: 'REALM_TEMPLE_CLEANSE'; poiId: string; characterId: string }
  | { type: 'REALM_TEMPLE_BLESS'; poiId: string }
  | { type: 'REALM_ENTER_POI'; poiId: string }
  // --- War Campaign commands (SRD-1105, Spec 10) ---
  | { type: 'SELECT_PLAYER_NATION'; archetypeId?: string }
  | { type: 'ACCEPT_WAR_MISSION'; missionKind: WarMissionKind; poiId: string; targetNationId?: string }
  | { type: 'RESOLVE_MISSION_APPROACH'; approachId: string }
  | { type: 'COMPLETE_WAR_MISSION'; victory: boolean }
  | { type: 'RESOLVE_PATROL_ENCOUNTER'; nationId: string; approach: 'bluff' | 'evade' | 'bribe' | 'fight' }
  | { type: 'NEGOTIATE_TRUCE'; targetNationId: string; tributeGold?: number }
  | { type: 'HIRE_COVERT_ASSET'; asset: 'mercenaries' | 'thieves_guild'; targetPoiId?: string };
