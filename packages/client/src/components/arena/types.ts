import type { CharacterBuildState, CreatureType } from '@srd5/data';

/**
 * Supported Arena game sub-modes (Spec 06 Section 2).
 */
export type ArenaSubMode = 'custom_skirmish' | 'endless_waves' | 'pvp_duel';

/**
 * Arena map environment terrain hazards and obstacles (Spec 06 Section 2.1).
 */
export type ArenaEnvironment =
  | 'open_sands'
  | 'pillars'
  | 'chasm_bridge'
  | 'hazards_lava';

/**
 * Encounter difficulty tiers for PvE waves.
 */
export type ArenaDifficultyTier = 'easy' | 'medium' | 'hard' | 'deadly';

/**
 * PvP Team configuration with controlled roster (Spec 06 Section 2.1).
 */
export interface ArenaTeamConfig {
  playerId: string;
  teamId: string;
  teamName: string;
  color: string;
  roster: CharacterBuildState[];
}

/**
 * PvE Arena Settings (Spec 06 Section 2.1).
 */
export interface ArenaPvESettings {
  difficultyTier: ArenaDifficultyTier;
  waveCount?: number; // 0 for infinite endless waves
  restFrequencyWaves?: number; // e.g. Short Rest every 2 or 3 waves
  selectedMonsterIds?: string[];
  monsterPoolFilter?: {
    minCr?: number;
    maxCr?: number;
    creatureTypes?: CreatureType[];
  };
}

/**
 * PvP Arena Settings (Spec 06 Section 2.1).
 */
export interface ArenaPvPSettings {
  teamA: ArenaTeamConfig;
  teamB: ArenaTeamConfig;
  turnTimerSeconds?: number;
  fogOfWar: 'none' | 'symmetric_los';
}

/**
 * Authoritative Arena configuration payload (Spec 06 Section 2.1).
 */
export interface ArenaConfig {
  id: string;
  name: string;
  mode: ArenaSubMode;
  mapId: string;
  gridWidth: number;
  gridHeight: number;
  environmentObstacles: ArenaEnvironment;
  pveSettings?: ArenaPvESettings;
  pvpSettings?: ArenaPvPSettings;
}

/**
 * Arena battle lifecycle phases.
 */
export type ArenaPhase =
  | 'setup'
  | 'battle'
  | 'breather'
  | 'victory'
  | 'defeat';

/**
 * Runtime state for an active Arena session.
 */
export interface ArenaMatchState {
  config: ArenaConfig;
  phase: ArenaPhase;
  currentWave: number;
  totalWaves: number;
  score: number;
  monstersDefeated: number;
  activeTeamId?: string;
  winnerTeamId?: string;
  winnerName?: string;
  restFrequencyWaves: number;
}
