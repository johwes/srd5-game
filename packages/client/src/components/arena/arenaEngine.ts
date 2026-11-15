import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type Combatant,
  type GameState,
  type GridCell,
  type GridPoint,
  type TacticalGrid,
  computeDerivedCharacter,
  createCharacterCombatant,
  createInitialGameState,
  createMonsterCombatant,
  createTacticalGrid,
  reduceGame,
  setGridCells,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewState } from '@srd5/transport';
import type {
  ArenaConfig,
  ArenaDifficultyTier,
  ArenaEnvironment,
  ArenaPvPSettings,
  ArenaSubMode,
} from './types.js';

/**
 * Builds a 2D TacticalGrid for the requested Arena map size and obstacle layout (Spec 06 Section 2.1).
 */
export function createArenaGrid(
  width: number,
  height: number,
  environment: ArenaEnvironment,
): TacticalGrid {
  const baseGrid = createTacticalGrid(width, height, 'floor_stone', 'bright');

  if (environment === 'open_sands') {
    return baseGrid;
  }

  if (environment === 'pillars') {
    // 4 Symmetrical stone pillars with complete Line-of-Sight & Movement blocking
    const px1 = Math.max(2, Math.floor(width / 3));
    const px2 = Math.min(width - 3, width - 1 - px1);
    const py1 = Math.max(2, Math.floor(height / 3));
    const py2 = Math.min(height - 3, height - 1 - py1);

    const pillarCoords = [
      { x: px1, y: py1 },
      { x: px2, y: py1 },
      { x: px1, y: py2 },
      { x: px2, y: py2 },
    ];

    const updates: GridCell[] = pillarCoords.map((pt) => ({
      x: pt.x,
      y: pt.y,
      terrain: 'wall_solid',
      blocksMovement: true,
      blocksSight: true,
    }));

    return setGridCells(baseGrid, updates);
  }

  if (environment === 'chasm_bridge') {
    // Central horizontal chasm split with a 2-cell bridge crossing in the center
    const midY = Math.floor(height / 2);
    const bridgeX1 = Math.floor(width / 2) - 1;
    const bridgeX2 = Math.floor(width / 2);

    const updates: GridCell[] = [];
    for (let x = 0; x < width; x++) {
      if (x !== bridgeX1 && x !== bridgeX2) {
        updates.push({
          x,
          y: midY,
          terrain: 'chasm',
          blocksMovement: true,
          blocksSight: false,
        });
      }
    }
    return setGridCells(baseGrid, updates);
  }

  if (environment === 'hazards_lava') {
    // Symmetrical lava hazard pools along the arena perimeter/corners
    const lavaCoords: GridPoint[] = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: width - 3, y: height - 3 },
      { x: width - 4, y: height - 3 },
      { x: width - 3, y: height - 4 },
      { x: 2, y: height - 3 },
      { x: width - 3, y: 2 },
    ].filter((pt) => pt.x >= 0 && pt.x < width && pt.y >= 0 && pt.y < height);

    const updates: GridCell[] = lavaCoords.map((pt) => ({
      x: pt.x,
      y: pt.y,
      terrain: 'lava',
      difficultTerrain: true,
    }));

    return setGridCells(baseGrid, updates);
  }

  return baseGrid;
}

/**
 * Returns default iconic party characters if player party is empty.
 */
export function getDefaultPartyCharacters(): CharacterBuildState[] {
  const f = getPregenCharacter('pregen-fighter');
  const w = getPregenCharacter('pregen-wizard');
  const c = getPregenCharacter('pregen-cleric');
  const r = getPregenCharacter('pregen-rogue');
  return [f, w, c, r].filter(Boolean) as CharacterBuildState[];
}

/**
 * Selects monster IDs for a PvE wave based on difficulty tier and wave index.
 */
export function getMonstersForWave(
  compendium: SrdCompendium,
  wave: number,
  difficulty: ArenaDifficultyTier = 'medium',
  selectedMonsterIds?: string[],
): string[] {
  if (selectedMonsterIds && selectedMonsterIds.length > 0) {
    return selectedMonsterIds;
  }

  const difficultyMultipliers: Record<ArenaDifficultyTier, number> = {
    easy: 1,
    medium: 2,
    hard: 3,
    deadly: 4,
  };
  const countFactor = difficultyMultipliers[difficulty] ?? 2;

  if (wave === 1) {
    const pool = ['goblin', 'goblin', 'wolf', 'skeleton', 'kobold'];
    return pool.slice(0, Math.min(pool.length, countFactor + 1));
  } else if (wave === 2) {
    const pool = ['orc', 'orc', 'hobgoblin', 'ghoul', 'goblin'];
    return pool.slice(0, Math.min(pool.length, countFactor + 1));
  } else if (wave === 3) {
    const pool = ['ogre', 'hobgoblin', 'hobgoblin', 'wight'];
    return pool.slice(0, Math.min(pool.length, countFactor));
  } else {
    // High wave boss encounter
    const pool = ['minotaur', 'ogre', 'orc', 'orc'];
    return pool.slice(0, Math.min(pool.length, countFactor));
  }
}

/**
 * Creates and starts a PvE Arena combat encounter (Custom Skirmish or Wave Defense).
 */
export function buildArenaPveEncounter(
  config: ArenaConfig,
  partyCharacters: CharacterBuildState[],
  waveNumber: number,
  compendium: SrdCompendium = defaultCompendium,
  rngSeed = 42,
): { state: GameState; transport: LocalTransport } {
  const grid = createArenaGrid(
    config.gridWidth,
    config.gridHeight,
    config.environmentObstacles,
  );

  const characters =
    partyCharacters.length > 0
      ? partyCharacters
      : getDefaultPartyCharacters();

  // 1. Position Party members along bottom edge
  const partyY = Math.max(0, config.gridHeight - 2);
  const partyStartX = Math.max(
    0,
    Math.floor((config.gridWidth - characters.length) / 2),
  );

  const partyCombatants: Combatant[] = characters.map((char, idx) => {
    const sheet = computeDerivedCharacter(char, compendium);
    const pos: GridPoint = { x: partyStartX + idx, y: partyY };
    return createCharacterCombatant(sheet, pos, {
      side: 'party',
      teamId: 'party',
      playerId: 'player-1',
    });
  });

  // 2. Select & Position Monsters along top edge
  const monsterIds = getMonstersForWave(
    compendium,
    waveNumber,
    config.pveSettings?.difficultyTier ?? 'medium',
    config.pveSettings?.selectedMonsterIds,
  );

  const monsterY = 1;
  const monsterStartX = Math.max(
    0,
    Math.floor((config.gridWidth - monsterIds.length) / 2),
  );

  const monsterCombatants: Combatant[] = monsterIds.map((id, idx) => {
    const monsterData = compendium.requireMonster(id);
    const pos: GridPoint = { x: monsterStartX + idx, y: monsterY };
    return createMonsterCombatant(
      monsterData,
      `${id}-${waveNumber}-${idx + 1}`,
      pos,
      {
        side: 'monster',
        teamId: 'monsters',
        name: `${monsterData.name} #${idx + 1}`,
      },
    );
  });

  const initialState = createInitialGameState({
    id: `arena-pve-${Date.now()}`,
    grid,
    party: partyCombatants,
    monsters: monsterCombatants,
    slots: [
      {
        playerId: 'player-1',
        displayName: 'Adventurers',
        controlledCharacterIds: partyCombatants.map((c) => c.id),
      },
    ],
    rngState: rngSeed,
  });

  // Start active combat immediately
  const { nextState } = reduceGame(initialState, {
    type: 'START_COMBAT',
    encounterId: `arena-wave-${waveNumber}`,
    rngState: rngSeed,
  });

  const transport = new LocalTransport({
    initialState: nextState,
    defaultPlayerId: 'player-1',
  });

  return { state: nextState, transport };
}

/**
 * Creates and starts a 1v1 Hot-Seat PvP Arena combat encounter (Red Team vs Blue Team).
 */
export function buildArenaPvpEncounter(
  config: ArenaConfig,
  compendium: SrdCompendium = defaultCompendium,
  rngSeed = 42,
): { state: GameState; transport: LocalTransport } {
  const grid = createArenaGrid(
    config.gridWidth,
    config.gridHeight,
    config.environmentObstacles,
  );

  const pvp = config.pvpSettings;
  const teamARoster =
    pvp?.teamA.roster && pvp.teamA.roster.length > 0
      ? pvp.teamA.roster
      : [
          getPregenCharacter('pregen-fighter')!,
          getPregenCharacter('pregen-rogue')!,
        ].filter(Boolean);

  const teamBRoster =
    pvp?.teamB.roster && pvp.teamB.roster.length > 0
      ? pvp.teamB.roster
      : [
          getPregenCharacter('pregen-cleric')!,
          getPregenCharacter('pregen-wizard')!,
        ].filter(Boolean);

  const teamAPlayerId = pvp?.teamA.playerId ?? 'player_red';
  const teamBPlayerId = pvp?.teamB.playerId ?? 'player_blue';

  // Position Team A (Red) at south edge
  const southY = Math.max(0, config.gridHeight - 2);
  const southStartX = Math.max(
    0,
    Math.floor((config.gridWidth - teamARoster.length) / 2),
  );

  const teamACombatants: Combatant[] = teamARoster.map((char, idx) => {
    const sheet = computeDerivedCharacter(char, compendium);
    const pos: GridPoint = { x: southStartX + idx, y: southY };
    return createCharacterCombatant(sheet, pos, {
      side: 'party',
      teamId: 'team_red',
      playerId: teamAPlayerId,
    });
  });

  // Position Team B (Blue) at north edge
  const northY = 1;
  const northStartX = Math.max(
    0,
    Math.floor((config.gridWidth - teamBRoster.length) / 2),
  );

  const teamBCombatants: Combatant[] = teamBRoster.map((char, idx) => {
    const sheet = computeDerivedCharacter(char, compendium);
    const pos: GridPoint = { x: northStartX + idx, y: northY };
    return createCharacterCombatant(sheet, pos, {
      side: 'monster',
      teamId: 'team_blue',
      playerId: teamBPlayerId,
    });
  });

  const slots = [
    {
      playerId: teamAPlayerId,
      displayName: pvp?.teamA.teamName ?? 'Team Red',
      controlledCharacterIds: teamACombatants.map((c) => c.id),
    },
    {
      playerId: teamBPlayerId,
      displayName: pvp?.teamB.teamName ?? 'Team Blue',
      controlledCharacterIds: teamBCombatants.map((c) => c.id),
    },
  ];

  const initialState = createInitialGameState({
    id: `arena-pvp-${Date.now()}`,
    grid,
    party: teamACombatants,
    monsters: teamBCombatants,
    slots,
    rngState: rngSeed,
  });

  // Start combat with explicit mutual hostility matrix
  const { nextState } = reduceGame(initialState, {
    type: 'START_COMBAT',
    encounterId: `arena-pvp-duel`,
    dispositionMatrix: {
      team_red: { team_blue: 'hostile' },
      team_blue: { team_red: 'hostile' },
    },
    rngState: rngSeed,
  });

  const transport = new LocalTransport({
    initialState: nextState,
    defaultPlayerId: teamAPlayerId,
  });

  return { state: nextState, transport };
}

/**
 * Applies a Short Rest breather to living party members in Wave Defense:
 * Heals 50% max HP, restores spell slots, clears negative conditions.
 */
export function applyArenaBreather(state: GameState): GameState {
  const nextParty = { ...state.party };
  for (const [id, c] of Object.entries(nextParty)) {
    if (!c.isDead && c.currentHp > 0) {
      const healAmount = Math.ceil(c.maxHp * 0.5);
      const newHp = Math.min(c.maxHp, c.currentHp + healAmount);
      const clearedConditions = c.conditions.filter(
        (cond) => cond !== 'poisoned' && cond !== 'frightened' && cond !== 'prone',
      );

      // Restore spell slots
      let restoredSlots = c.spellSlots;
      if (c.spellSlots) {
        restoredSlots = {};
        for (const [lvl, pool] of Object.entries(c.spellSlots)) {
          restoredSlots[lvl] = {
            max: pool.max,
            expended: 0,
            available: pool.max,
          };
        }
      }

      nextParty[id] = {
        ...c,
        currentHp: newHp,
        conditions: clearedConditions,
        spellSlots: restoredSlots,
        deathSaves: { successes: 0, failures: 0 },
        isStable: false,
      };
    }
  }
  return {
    ...state,
    party: nextParty,
  };
}

/**
 * Spawns the next wave of monsters into the current game state and rolls initiative.
 */
export function spawnNextWave(
  state: GameState,
  waveNumber: number,
  config: ArenaConfig,
  compendium: SrdCompendium = defaultCompendium,
  rngSeed = 42,
): GameState {
  const monsterIds = getMonstersForWave(
    compendium,
    waveNumber,
    config.pveSettings?.difficultyTier ?? 'medium',
  );

  const monsterY = 1;
  const monsterStartX = Math.max(
    0,
    Math.floor((config.gridWidth - monsterIds.length) / 2),
  );

  const newMonsters: Combatant[] = monsterIds.map((id, idx) => {
    const monsterData = compendium.requireMonster(id);
    const pos: GridPoint = { x: monsterStartX + idx, y: monsterY };
    return createMonsterCombatant(
      monsterData,
      `${id}-w${waveNumber}-${idx + 1}`,
      pos,
      {
        side: 'monster',
        teamId: 'monsters',
        name: `${monsterData.name} #${idx + 1}`,
      },
    );
  });

  const nextMonstersMap: Record<string, Combatant> = {};
  for (const m of newMonsters) {
    nextMonstersMap[m.id] = m;
  }

  // Preserve living party members
  const livingParty: Combatant[] = Object.values(state.party).filter(
    (c) => !c.isDead && c.currentHp > 0,
  );

  const cleanState: GameState = {
    ...state,
    mode: 'exploration',
    combat: null,
    monsters: nextMonstersMap,
    rngState: rngSeed + waveNumber,
  };

  const { nextState } = reduceGame(cleanState, {
    type: 'START_COMBAT',
    encounterId: `arena-wave-${waveNumber}`,
    combatants: [...livingParty, ...newMonsters],
    rngState: rngSeed + waveNumber,
  });

  return nextState;
}

/**
 * Evaluates tactical outcome for Arena game modes (Spec 06 Section 2.2).
 */
export function evaluateArenaOutcome(
  viewState: PlayerViewState,
  mode: ArenaSubMode,
  pvpSettings?: ArenaPvPSettings,
): {
  status: 'in_progress' | 'victory' | 'defeat' | 'wave_cleared' | 'draw';
  winnerTeamId?: string;
  winnerName?: string;
} {
  const combatants = Object.values(viewState.combatants);

  if (mode === 'pvp_duel') {
    const redLiving = combatants.filter(
      (c) => (c.teamId ?? c.side) === 'team_red' && !c.isDead && c.currentHp > 0,
    );
    const blueLiving = combatants.filter(
      (c) => (c.teamId ?? c.side) === 'team_blue' && !c.isDead && c.currentHp > 0,
    );

    if (redLiving.length === 0 && blueLiving.length === 0) {
      return { status: 'draw' };
    }
    if (blueLiving.length === 0 && redLiving.length > 0) {
      return {
        status: 'victory',
        winnerTeamId: 'team_red',
        winnerName: pvpSettings?.teamA.teamName ?? 'Team Red',
      };
    }
    if (redLiving.length === 0 && blueLiving.length > 0) {
      return {
        status: 'victory',
        winnerTeamId: 'team_blue',
        winnerName: pvpSettings?.teamB.teamName ?? 'Team Blue',
      };
    }
    return { status: 'in_progress' };
  }

  // PvE evaluation
  const partyLiving = combatants.filter(
    (c) => (c.teamId ?? c.side) === 'party' && !c.isDead && c.currentHp > 0,
  );
  const monstersLiving = combatants.filter(
    (c) => (c.teamId ?? c.side) !== 'party' && !c.isDead && c.currentHp > 0,
  );

  if (partyLiving.length === 0) {
    return { status: 'defeat' };
  }

  if (monstersLiving.length === 0 && partyLiving.length > 0) {
    if (mode === 'endless_waves') {
      return { status: 'wave_cleared' };
    }
    return { status: 'victory' };
  }

  return { status: 'in_progress' };
}
