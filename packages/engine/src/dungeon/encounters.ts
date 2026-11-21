import {
  type SrdCompendium,
  type MonsterData,
  defaultCompendium,
  SRD_CR_TO_XP,
} from '@srd5/data';
import { type Combatant } from '../combat/types.js';
import { createMonsterCombatant } from '../combat/combatant.js';
import { startCombatEncounter } from '../combat/state-machine.js';
import { hasLineOfSight } from '../grid/vision.js';
import { type GameEvent, type GameState } from '../state/types.js';
import { type DungeonFloorState } from './state.js';
import { awardCharacterXp, getCharacterLevelForXp } from '../character/level-up.js';
import { spawnCorpseLootProps } from './corpse-loot.js';

export interface TransitionCombatToExplorationOptions {
  compendium?: SrdCompendium;
  /**
   * SRD-1307: `'skip'` suppresses per-slay corpse drops (war-battle path stays
   * authoritative via `resolveOverworldBattle` gold awards). Defaults to `'roll'`.
   */
  corpseDrops?: 'roll' | 'skip';
}

function createFallbackMonster(monsterId: string): MonsterData {
  return {
    id: monsterId,
    name: monsterId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    size: 'medium',
    type: 'humanoid',
    alignment: 'unaligned',
    armorClass: { value: 12, type: 'natural' },
    hitPoints: { average: 10, rollFormula: '2d8+2' },
    speed: { walk: 30 },
    abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: {},
    skills: { stealth: 1 },
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    senses: { passivePerception: 10 },
    languages: ['Common'],
    challengeRating: 0.25,
    xp: 50,
    aiArchetype: 'brute',
    traits: [],
    actions: [],
  };
}

export interface TriggerDungeonEncounterOptions {
  compendium?: SrdCompendium;
  explicitSurprisedEntityIds?: string[];
  partyStealthRolls?: Record<string, number>;
  monsterAmbushStealthDc?: number;
  rngState?: number;
}

export interface CheckDungeonEncounterTriggersResult {
  triggered: boolean;
  encounterId?: string;
  nextState: GameState;
  events: GameEvent[];
}

/**
 * Checks all untriggered encounters on the dungeon floor to determine if any
 * conscious party member has Line of Sight to an unspawned monster group.
 * If spotted, transitions exploration to combat immediately (Spec 04 Section 3.1 & SRD-503).
 */
export function checkDungeonEncounterTriggers(
  state: GameState,
  options?: {
    compendium?: SrdCompendium;
    partyStealthRolls?: Record<string, number>;
    explicitSurprisedEntityIds?: string[];
  },
): CheckDungeonEncounterTriggersResult {
  if (state.mode !== 'exploration' || !state.dungeon || !state.dungeon.encounters.length) {
    return { triggered: false, nextState: state, events: [] };
  }

  const untriggered = state.dungeon.encounters.filter((e) => !e.triggered);
  if (untriggered.length === 0) {
    return { triggered: false, nextState: state, events: [] };
  }

  const consciousHeroes = Object.values(state.party).filter(
    (h) => !h.isDead && h.currentHp > 0 && !h.conditions.includes('blinded'),
  );
  if (consciousHeroes.length === 0) {
    return { triggered: false, nextState: state, events: [] };
  }

  const comp = options?.compendium ?? defaultCompendium;

  for (const enc of untriggered) {
    if (!enc.monsters || enc.monsters.length === 0) continue;

    let spotted = false;
    for (const monster of enc.monsters) {
      const monsterData = comp.getMonster(monster.monsterId);
      const monsterSize = monsterData?.size ?? 'medium';

      for (const hero of consciousHeroes) {
        if (
          hasLineOfSight(
            state.grid,
            { id: hero.id, x: hero.position.x, y: hero.position.y, size: hero.size },
            { id: monster.monsterId, x: monster.spawnX, y: monster.spawnY, size: monsterSize },
          )
        ) {
          spotted = true;
          break;
        }
      }
      if (spotted) break;
    }

    if (spotted) {
      const triggerRes = triggerDungeonEncounter(state, enc.id, options);
      return {
        triggered: true,
        encounterId: enc.id,
        nextState: triggerRes.nextState,
        events: triggerRes.events,
      };
    }
  }

  return { triggered: false, nextState: state, events: [] };
}

/**
 * Triggers a dungeon encounter:
 * 1. Instantiates all monsters in the group on the floor grid.
 * 2. Evaluates SRD 5.1 surprise (Party in Stealth vs Monster Passive Perception,
 *    and Monster Ambush Stealth DC vs Party Passive Perception).
 * 3. Rolls initiative and transitions state.mode from 'exploration' to 'combat'.
 */
export function triggerDungeonEncounter(
  state: GameState,
  encounterId: string,
  options?: TriggerDungeonEncounterOptions,
): { nextState: GameState; events: GameEvent[] } {
  if (!state.dungeon) {
    throw new Error('Cannot trigger dungeon encounter without active dungeon floor state');
  }

  const enc = state.dungeon.encounters.find((e) => e.id === encounterId);
  if (!enc) {
    throw new Error(`Dungeon encounter not found: ${encounterId}`);
  }

  if (enc.triggered) {
    return { nextState: state, events: [] };
  }

  const comp = options?.compendium ?? defaultCompendium;
  const spawnedMonsters: Record<string, Combatant> = {};
  const spawnedMonsterIds: string[] = [];

  for (let i = 0; i < enc.monsters.length; i++) {
    const mSpec = enc.monsters[i]!;
    const instanceId = `${enc.id}-${mSpec.monsterId}-${i + 1}`;
    const monsterData = comp.getMonster(mSpec.monsterId) ?? createFallbackMonster(mSpec.monsterId);
    const combatant = createMonsterCombatant(
      monsterData,
      instanceId,
      { x: mSpec.spawnX, y: mSpec.spawnY },
      { side: 'monster', teamId: 'monster' },
    );
    combatant.roomId = enc.roomId;
    spawnedMonsters[instanceId] = combatant;
    spawnedMonsterIds.push(instanceId);
  }

  const nextMonsters = { ...state.monsters, ...spawnedMonsters };
  // Only living party members (including unconscious heroes who must roll
  // death saves) plus the freshly spawned encounter group enter initiative.
  // Corpses from prior encounters stay in state.monsters as battlefield
  // remains but must never re-enter a new fight's turn order.
  const combatantsList = [...Object.values(state.party), ...Object.values(spawnedMonsters)];

  const partyStealth = state.partyInStealth
    ? {
        partyInStealth: true,
        partyStealthRolls: options?.partyStealthRolls,
      }
    : undefined;

  const monsterAmbush =
    options?.monsterAmbushStealthDc !== undefined
      ? {
          monstersAmbushing: true,
          monsterStealthDc: options.monsterAmbushStealthDc,
        }
      : enc.surpriseCondition?.monstersStealthedDc
        ? {
            monstersAmbushing: true,
            monsterStealthDc: enc.surpriseCondition.monstersStealthedDc,
          }
        : undefined;

  const transition = startCombatEncounter({
    encounterId: enc.id,
    combatants: combatantsList,
    rngState: options?.rngState ?? state.rngState,
    partyStealth,
    monsterAmbush,
    explicitSurprisedEntityIds: options?.explicitSurprisedEntityIds,
    props: state.props,
  });

  const nextParty: Record<string, Combatant> = {};
  // Preserve prior-encounter corpses in state.monsters (battlefield remains)
  // while syncing the current fight's participants from the transition.
  const finalMonsters: Record<string, Combatant> = { ...state.monsters };
  for (const [id, c] of Object.entries(transition.state.combatants)) {
    if (c.side === 'party') {
      nextParty[id] = c;
    } else {
      finalMonsters[id] = c;
    }
  }

  const updatedEncounters = state.dungeon.encounters.map((e) =>
    e.id === enc.id ? { ...e, triggered: true } : e,
  );

  const nextDungeon: DungeonFloorState = {
    ...state.dungeon,
    encounters: updatedEncounters,
  };

  const nextState: GameState = {
    ...state,
    mode: 'combat',
    combat: transition.state,
    party: nextParty,
    monsters: finalMonsters,
    rngState: transition.state.rngState,
    dungeon: nextDungeon,
  };

  const events: GameEvent[] = [];
  const surprisedIds = new Set(transition.state.surprisedCombatantIds);
  const partyHasSurprise = Object.keys(nextParty).some((id) => surprisedIds.has(id));
  const monstersHaveSurprise = spawnedMonsterIds.some((id) => surprisedIds.has(id));

  events.push({
    type: 'ENCOUNTER_TRIGGERED',
    encounterId: enc.id,
    roomId: enc.roomId,
    monsterIds: spawnedMonsterIds,
    isSurprisedParty: partyHasSurprise,
    isSurprisedMonsters: monstersHaveSurprise,
  });

  events.push({
    type: 'MODE_CHANGED',
    fromMode: state.mode,
    toMode: 'combat',
  });

  events.push(...transition.events);

  return { nextState, events };
}

/**
 * Transitions from combat mode back to exploration mode after all hostiles are defeated (Spec 04 Section 3).
 * Resets temporary combat states and checks if rooms are cleared.
 *
 * SRD-1307: also spawns one lootable `corpse` prop per newly slain monster
 * (CR-scaled individual treasure, hoard rolls for elite/boss CRs), threading
 * `state.rngState` deterministically.
 */
export function transitionCombatToExploration(
  state: GameState,
  options?: TransitionCombatToExplorationOptions,
): {
  nextState: GameState;
  events: GameEvent[];
} {
  if (state.mode !== 'combat') {
    return { nextState: state, events: [] };
  }

  const events: GameEvent[] = [];
  const compendium = options?.compendium ?? defaultCompendium;

  // Reset temporary combat properties on party members
  const nextParty: Record<string, Combatant> = {};
  for (const [id, hero] of Object.entries(state.party)) {
    nextParty[id] = {
      ...hero,
      isSurprised: false,
      isDodging: false,
      reactionAvailable: true,
    };
  }

  // Calculate XP from defeated monsters (Spec 04 Section 4.3 & SRD-505)
  const defeatedMonsters = Object.values(state.monsters).filter((m) => m.isDead || m.currentHp <= 0);
  const totalMonsterXp = defeatedMonsters.reduce((sum, m) => {
    if (m.monsterData?.xp !== undefined) {
      return sum + m.monsterData.xp;
    }
    if (m.monsterData?.challengeRating !== undefined) {
      const crVal = m.monsterData.challengeRating;
      const crXp = (SRD_CR_TO_XP as Record<number, number>)[crVal] ?? 0;
      return sum + crXp;
    }
    return sum;
  }, 0);

  const survivingHeroes = Object.values(nextParty).filter((h) => !h.isDead);
  const xpPerHero = survivingHeroes.length > 0 ? Math.floor(totalMonsterXp / survivingHeroes.length) : 0;

  // SRD-1307: per-slay corpse drops on the corpse cells (idempotent —
  // prior-encounter remains already have corpse props). Skipped for
  // war-battle resolutions, where `resolveOverworldBattle` awards spoils.
  let corpseProps = state.props;
  let corpseRng = state.rngState;
  if (options?.corpseDrops !== 'skip') {
    const spawned = spawnCorpseLootProps(state.props, defeatedMonsters, state.rngState, compendium);
    corpseProps = spawned.nextProps;
    corpseRng = spawned.nextRng;
  }

  if (xpPerHero > 0) {
    for (const hero of survivingHeroes) {
      if (hero.buildState) {
        const xpRes = awardCharacterXp(hero.buildState, xpPerHero);
        const currentLevel =
          hero.characterSheet?.totalLevel ??
          hero.buildState.classes.reduce((sum, c) => sum + c.level, 0);
        const eligibleLevel = xpRes.eligibleLevelForXp;
        const canLevelUp = xpRes.canLevelUp;

        nextParty[hero.id] = {
          ...hero,
          buildState: xpRes.state,
          levelUpAvailable: canLevelUp,
          characterSheet: hero.characterSheet
            ? {
                ...hero.characterSheet,
                xp: xpRes.newXp,
              }
            : undefined,
        };

        if (canLevelUp) {
          events.push({
            type: 'LEVEL_UP_UNLOCKED',
            characterId: hero.id,
            currentLevel,
            eligibleLevel,
          });
        }
      } else if (hero.characterSheet) {
        const currentXp = hero.characterSheet.xp ?? 0;
        const newXp = currentXp + xpPerHero;
        const currentLevel = hero.characterSheet.totalLevel;
        const eligibleLevel = getCharacterLevelForXp(newXp);
        const canLevelUp = eligibleLevel > currentLevel;

        nextParty[hero.id] = {
          ...hero,
          levelUpAvailable: canLevelUp,
          characterSheet: {
            ...hero.characterSheet,
            xp: newXp,
          },
        };

        if (canLevelUp) {
          events.push({
            type: 'LEVEL_UP_UNLOCKED',
            characterId: hero.id,
            currentLevel,
            eligibleLevel,
          });
        }
      }
    }
  }

  if (totalMonsterXp > 0 || defeatedMonsters.length > 0) {
    events.push({
      type: 'ENCOUNTER_VICTORY',
      encounterId: state.combat?.encounterId,
      outcome: 'party_victory',
      round: state.combat?.round ?? 1,
      xpAwarded: xpPerHero,
      totalXp: totalMonsterXp,
      survivingHeroIds: survivingHeroes.map((h) => h.id),
    });
  }

  let nextDungeon = state.dungeon;
  if (nextDungeon) {
    const updatedRooms = { ...nextDungeon.rooms };
    let roomsChanged = false;

    for (const [roomId, room] of Object.entries(updatedRooms)) {
      if (room.cleared) continue;

      const roomEncounters = nextDungeon.encounters.filter((e) => e.roomId === roomId);
      if (roomEncounters.length > 0) {
        const allTriggered = roomEncounters.every((e) => e.triggered);
        const allMonstersDefeated = roomEncounters.every((e) => {
          return e.monsters.every((_, idx) => {
            const instanceId = `${e.id}-${e.monsters[idx]!.monsterId}-${idx + 1}`;
            const m = state.monsters[instanceId];
            return !m || m.isDead || m.currentHp <= 0;
          });
        });

        if (allTriggered && allMonstersDefeated) {
          updatedRooms[roomId] = {
            ...room,
            cleared: true,
          };
          roomsChanged = true;
          events.push({
            type: 'ROOM_CLEARED',
            roomId,
            roomName: room.name,
          });
        }
      }
    }

    if (roomsChanged) {
      nextDungeon = {
        ...nextDungeon,
        rooms: updatedRooms,
      };
    }
  }

  const nextState: GameState = {
    ...state,
    mode: 'exploration',
    combat: null,
    party: nextParty,
    dungeon: nextDungeon,
    props: corpseProps,
    rngState: corpseRng,
  };

  events.push({
    type: 'MODE_CHANGED',
    fromMode: 'combat',
    toMode: 'exploration',
  });

  return { nextState, events };
}
