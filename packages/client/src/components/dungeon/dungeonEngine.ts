import {
  type CharacterBuildState,
  type DungeonFloorSpec,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type Combatant,
  type DeepDescentRunState,
  type GameState,
  type GridPoint,
  type InteractiveProp,
  type RogueliteRunSession,
  computeDerivedCharacter,
  createCharacterCombatant,
  createDailyDescentRun,
  createDungeonGameState,
  startRogueliteRun,
  advanceRogueliteFloor,
  sweepUnclaimedCorpseLoot,
} from '@srd5/engine';
import { LocalTransport, type PlayerViewProp } from '@srd5/transport';

/**
 * Returns fallback pregenerated party characters if the player party is empty.
 */
export function getDefaultDungeonPartyCharacters(): CharacterBuildState[] {
  return [
    getPregenCharacter('pregen-fighter')!,
    getPregenCharacter('pregen-cleric')!,
    getPregenCharacter('pregen-rogue')!,
    getPregenCharacter('pregen-wizard')!,
  ].filter((c): c is CharacterBuildState => c !== undefined);
}

/**
 * Initializes a new authoritative GameState and LocalTransport for a dungeon floor.
 */
export function buildDungeonSession(
  floorSpec: DungeonFloorSpec,
  partyCharacters: CharacterBuildState[] = [],
  compendium: SrdCompendium = defaultCompendium,
  existingPartyCombatants?: Combatant[],
): {
  transport: LocalTransport;
  initialState: GameState;
} {
  const characters =
    partyCharacters.length > 0 ? partyCharacters : getDefaultDungeonPartyCharacters();

  let partyCombatants: Combatant[];

  if (existingPartyCombatants && existingPartyCombatants.length > 0) {
    // Preserve existing combatant state across floor transitions
    partyCombatants = existingPartyCombatants.map((c, idx) => {
      const spawnPoint =
        floorSpec.partySpawnCells[idx] ??
        floorSpec.partySpawnCells[0] ?? { x: 0, y: 0 };
      return {
        ...structuredClone(c),
        position: { x: spawnPoint.x, y: spawnPoint.y },
      };
    });
  } else {
    // Fresh dungeon entry: derive stats from CharacterBuildState
    partyCombatants = characters.map((char, idx) => {
      const sheet = computeDerivedCharacter(char, compendium);
      const spawnPoint =
        floorSpec.partySpawnCells[idx] ??
        floorSpec.partySpawnCells[0] ?? { x: 0, y: 0 };
      return createCharacterCombatant(sheet, spawnPoint, {
        side: 'party',
        teamId: 'party',
        playerId: 'player-1',
        buildState: char,
      });
    });
  }

  const initialState = createDungeonGameState({
    floor: floorSpec,
    party: partyCombatants,
    leadExplorerId: partyCombatants[0]?.id ?? 'hero-1',
    formation: 'single_file',
    partyInStealth: false,
  });

  const transport = new LocalTransport({
    initialState,
    defaultPlayerId: 'player-1',
  });

  return { transport, initialState };
}

/**
 * Finds all interactive props adjacent (within Chebyshev distance 1.5) to a position.
 */
export function getAdjacentProps(
  pos: GridPoint,
  props: ReadonlyArray<InteractiveProp | PlayerViewProp>,
): Array<InteractiveProp | PlayerViewProp> {
  return props.filter((p) => {
    const dx = Math.abs(p.x - pos.x);
    const dy = Math.abs(p.y - pos.y);
    return dx <= 1 && dy <= 1;
  });
}

/**
 * Checks if the lead explorer or party is standing on or adjacent to stairs.
 */
export function findNearbyStairs(
  pos: GridPoint,
  props: ReadonlyArray<InteractiveProp | PlayerViewProp>,
): {
  stairsDown?: InteractiveProp | PlayerViewProp;
  stairsUp?: InteractiveProp | PlayerViewProp;
} {
  const adjacent = getAdjacentProps(pos, props);
  return {
    stairsDown: adjacent.find((p) => p.kind === 'stairs_down'),
    stairsUp: adjacent.find((p) => p.kind === 'stairs_up'),
  };
}

/**
 * Transitions party to the next dungeon floor, carrying over HP, spell slots, inventory, etc.
 */
export function transitionToNextFloor(
  currentGameState: GameState,
  nextFloorSpec: DungeonFloorSpec,
  compendium: SrdCompendium = defaultCompendium,
): {
  transport: LocalTransport;
  nextState: GameState;
  /** Corpse props auto-collected by the SRD-1307 floor-exit sweep. */
  sweptCorpsePropIds: string[];
} {
  // SRD-1307 floor-exit sweep: unclaimed corpse drops join the party before
  // the floor (and its props) is discarded, so loot is never silently lost.
  const swept = sweepUnclaimedCorpseLoot(currentGameState, compendium);
  const partyList = Object.values(swept.nextState.party);

  const updatedCombatants = partyList.map((c, idx) => {
    const spawnPoint =
      nextFloorSpec.partySpawnCells[idx] ??
      nextFloorSpec.partySpawnCells[0] ?? { x: 0, y: 0 };
    return {
      ...structuredClone(c),
      position: { x: spawnPoint.x, y: spawnPoint.y },
    };
  });

  const nextState = createDungeonGameState({
    floor: nextFloorSpec,
    party: updatedCombatants,
    marchingOrder: currentGameState.marchingOrder?.order,
    formation: currentGameState.marchingOrder?.formation ?? 'single_file',
    leadExplorerId: currentGameState.marchingOrder?.leadExplorerId ?? updatedCombatants[0]?.id,
    partyInStealth: currentGameState.partyInStealth ?? false,
    rngState: currentGameState.rngState,
  });

  const transport = new LocalTransport({
    initialState: nextState,
    defaultPlayerId: 'player-1',
  });

  return { transport, nextState, sweptCorpsePropIds: swept.sweptPropIds };
}

/**
 * Checks whether the final campaign boss is defeated.
 */
export function isFinalCampaignBossDefeated(gameState: GameState): boolean {
  if (gameState.dungeon?.floorId !== 'kaelen-floor-3') {
    return false;
  }
  const boss = Object.values(gameState.monsters).find((m) =>
    m.id.toLowerCase().includes('kaelen') || m.name.toLowerCase().includes('kaelen'),
  );
  if (!boss) {
    // If monsters map is empty or boss was defeated and cleared
    return gameState.mode === 'exploration' && Object.keys(gameState.monsters).length === 0;
  }
  return boss.isDead || boss.currentHp <= 0;
}

/**
 * Initializes a new Deep Descent Roguelite run session and LocalTransport (Spec 06 Section 3.1).
 */
export function buildRogueliteSession(
  partyCharacters: CharacterBuildState[] = [],
  compendium: SrdCompendium = defaultCompendium,
  seed?: number,
  options?: { isDaily?: boolean; dailyDate?: string; worldOptions?: import('@srd5/engine').WorldOptions },
): {
  transport: LocalTransport;
  initialState: GameState;
  session: RogueliteRunSession;
} {
  const session = options?.isDaily
    ? createDailyDescentRun({
        partyCharacters,
        compendium,
        seed,
        date: options.dailyDate,
        ...(options.worldOptions ? { worldOptions: options.worldOptions } : {}),
      })
    : startRogueliteRun({
        partyCharacters,
        compendium,
        seed: seed ?? options?.worldOptions?.seed ?? 1337,
        ...(options?.worldOptions ? { worldOptions: options.worldOptions } : {}),
      });

  const transport = new LocalTransport({
    initialState: session.gameState,
    defaultPlayerId: 'player-1',
  });

  return { transport, initialState: session.gameState, session };
}
