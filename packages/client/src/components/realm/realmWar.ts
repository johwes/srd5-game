/** War Campaign helpers: party-sheet access, war-clock sync, mission battle setup and mission completion (SRD-1102/1105, Spec 10). */
import {
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  type Combatant,
  type GameEvent,
  type GeneratedOverworldBattle,
  type GameState,
  type WarBattleModifiers,
  type WarState,
  type WaveReinforcementSpec,
  RealmError,
  advanceWarSimulation,
  createInitialGameState,
  decayWarThreats,
  evaluateWarOutcome,
  startCombatEncounter,
} from '@srd5/engine';

import {
  getLivingParty,
  getPartyList,
} from './realmExpeditions.js';
import {
  RealmSessionEvent,
  RealmSessionState,
} from './realmSession.js';
// ---------------------------------------------------------------------------
// War Campaign helpers (SRD-1105, Spec 10)
// ---------------------------------------------------------------------------

/** Live DerivedCharacterSheets for Approach / patrol / diplomacy 5e checks. */
export function getPartySheets(session: RealmSessionState) {
  return getPartyList(session)
    .map((c) => c.characterSheet)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
}

/** Mean total character level across the living party (dynamic-CR scaling). */
export function getPartyAverageLevel(session: RealmSessionState): number {
  const sheets = getPartySheets(session);
  if (sheets.length === 0) return 1;
  const total = sheets.reduce((sum, s) => sum + Math.max(1, Math.min(20, s.totalLevel ?? 1)), 0);
  return Math.max(1, Math.min(20, Math.round(total / sheets.length)));
}

/** Writes Approach-resolver slot deductions back onto party combatants. */
export function syncSheetsToParty(
  session: RealmSessionState,
  updatedSheets: Array<{ id: string } & Record<string, unknown>>,
): void {
  for (const sheet of updatedSheets) {
    const hero = session.party[sheet.id];
    if (hero) {
      hero.characterSheet = sheet as unknown as Combatant['characterSheet'];
    }
  }
}

/**
 * Advances the living war simulation (and Threat decay) to the travel clock.
 * Runs after every travel/camp command that moves `travel.currentDay` while a
 * war is active. Chronicle headlines surface as `REALM_LOG` entries.
 */
export function syncWarToTravelDay(next: RealmSessionState, events: RealmSessionEvent[]): void {
  if (!next.war || next.war.outcome !== 'ongoing') return;
  const prevDay = next.war.currentDay;
  if (next.travel.currentDay <= prevDay) return;
  const result = advanceWarSimulation(next.war, next.map, { toDay: next.travel.currentDay });
  next.war = result.war;
  next.map = result.map;
  for (const entry of result.events) {
    events.push({ type: 'REALM_LOG', message: `⚔️ ${entry.headline}` });
  }
  const daysElapsed = Math.max(0, next.travel.currentDay - prevDay);
  if (daysElapsed > 0) {
    const decayed = decayWarThreats(next.diplomacy, { days: daysElapsed });
    next.diplomacy = decayed.diplomacy;
    for (const headline of decayed.headlines) {
      events.push({ type: 'REALM_LOG', message: headline });
    }
  }
}

export function requireWar(session: RealmSessionState): WarState {
  if (!session.war) throw new RealmError('The war campaign has not begun — select your nation first');
  return session.war;
}

/**
 * Starts a war-mission tactical battle: the living party deploys on the west
 * edge, the wave-1 classed garrison plus allied militia hold the east edge,
 * Approach-phase surprise is applied, and waves 2+ queue as timed
 * reinforcements for `RealmBattleView` (SRD-1102/1105).
 */
export function startWarMissionBattleState(
  session: RealmSessionState,
  generated: { battle: GeneratedOverworldBattle; waves: WaveReinforcementSpec[]; reinforcementQueue: Combatant[]; modifiers: WarBattleModifiers; enemies: Combatant[]; alliedMilitia: Combatant[] },
  compendium: SrdCompendium = defaultCompendium,
): { battle: GeneratedOverworldBattle; gameState: GameState; events: GameEvent[] } {
  void compendium;
  const living = getLivingParty(session);
  const party = living.map((hero, index) => {
    const spawn =
      generated.battle.partySpawnCells[index] ?? generated.battle.partySpawnCells[0]!;
    return { ...structuredClone(hero), side: 'party' as const, teamId: 'party', position: { ...spawn }, isSurprised: false };
  });
  const enemyIds = new Set(generated.enemies.map((e) => e.id));
  const surprisedEnemies =
    generated.modifiers.surpriseAttackerSide === 'party' || generated.modifiers.wave1EnemiesSurprised;
  const surprisedParty = generated.modifiers.surpriseAttackerSide === 'enemy';
  const enemies = generated.enemies.map((e) => ({
    ...structuredClone(e),
    isSurprised: surprisedEnemies ? true : e.isSurprised,
  }));
  const militia = generated.alliedMilitia.map((m) => structuredClone(m));
  const explicitSurprisedEntityIds = [
    ...(surprisedEnemies ? [...enemyIds] : []),
    ...(surprisedParty ? party.map((p) => p.id) : []),
  ];

  let gameState = createInitialGameState({
    id: generated.battle.battleId,
    grid: generated.battle.grid,
    party,
    monsters: [...enemies, ...militia.filter((m) => m.side !== 'party')],
    rngState: generated.battle.nextRngState,
  });
  // Allied militia fight on the party side: fold them into the party mirror.
  for (const ally of militia.filter((m) => m.side === 'party')) {
    gameState.party[ally.id] = ally;
  }

  const transition = startCombatEncounter({
    encounterId: generated.battle.battleId,
    combatants: [...party, ...enemies, ...militia],
    rngState: generated.battle.nextRngState,
    explicitSurprisedEntityIds: explicitSurprisedEntityIds.length > 0 ? explicitSurprisedEntityIds : undefined,
  });

  const nextParty: Record<string, Combatant> = {};
  const nextMonsters: Record<string, Combatant> = {};
  for (const [id, combatant] of Object.entries(transition.state.combatants)) {
    if (combatant.side === 'party') nextParty[id] = combatant;
    else nextMonsters[id] = combatant;
  }
  gameState = {
    ...gameState,
    mode: 'combat',
    combat: transition.state,
    party: nextParty,
    monsters: nextMonsters,
    rngState: transition.state.rngState,
  };
  return {
    battle: generated.battle,
    gameState,
    events: [{ type: 'MODE_CHANGED', fromMode: 'exploration', toMode: 'combat' }, ...transition.events],
  };
}

/**
 * Applies war-mission completion (SRD-1105): POI status flips, War Power
 * shifts, and Power Dominance evaluation. Pure on cloned session slices —
 * the reducer owns persistence.
 */
export function applyWarMissionCompletion(
  next: RealmSessionState,
  events: RealmSessionEvent[],
  victory: boolean,
): void {
  const missionState = next.activeWarMission;
  const war = requireWar(next);
  const day = next.travel.currentDay;
  const poi = next.map.pois[missionState?.poiId ?? ''];
  const playerId = war.playerNationId;

  const adjustPower = (nationId: string, pillar: 'military' | 'economy' | 'arcana' | 'morale', delta: number): void => {
    const nation = next.war!.nations[nationId];
    if (!nation) return;
    nation.power[pillar] = Math.max(0, nation.power[pillar] + delta);
  };

  if (!missionState) throw new RealmError('No active war mission to complete');
  const kind = missionState.mission.kind;

  if (victory) {
    switch (kind) {
      case 'destroy_bridge': {
        if (poi) {
          poi.strategicStatus = 'destroyed';
          poi.statusChangedDay = day;
          poi.recoveryDay = day + 9;
        }
        if (missionState.targetNationId) adjustPower(missionState.targetNationId, 'economy', -3);
        adjustPower(playerId, 'morale', 2);
        break;
      }
      case 'protect_poi': {
        if (poi && poi.strategicStatus === 'under_attack') {
          poi.strategicStatus = 'intact';
          poi.statusChangedDay = day;
          delete poi.attackDeadlineDay;
          delete poi.contestedByNationId;
        }
        adjustPower(playerId, 'military', 2);
        break;
      }
      case 'cleanse_cursed_mine': {
        if (poi) {
          poi.strategicStatus = 'intact';
          poi.statusChangedDay = day;
        }
        adjustPower(playerId, 'arcana', 2);
        break;
      }
      case 'capture_neutral_mine': {
        if (poi) {
          poi.strategicStatus = 'intact';
          poi.statusChangedDay = day;
          poi.ownerNationId = playerId;
          poi.factionId = playerId;
          delete poi.contestedByNationId;
          next.map.tiles[`${poi.q},${poi.r}`]!.factionControlId = playerId;
        }
        adjustPower(playerId, 'economy', 2);
        break;
      }
      case 'recover_war_artifact': {
        adjustPower(playerId, 'arcana', 3);
        break;
      }
      default: {
        // assassinate_general, poison_water_supply, sabotage_enemy_mine, rescue_spy
        if (poi) {
          poi.strategicStatus = 'sabotaged';
          poi.statusChangedDay = day;
        }
        if (missionState.targetNationId) adjustPower(missionState.targetNationId, 'military', -3);
        adjustPower(playerId, 'morale', 2);
        break;
      }
    }
    events.push({ type: 'REALM_LOG', message: `🏆 War mission complete: ${missionState.poiName} (${kind})` });
  } else {
    adjustPower(playerId, 'morale', -1);
    events.push({ type: 'REALM_LOG', message: `💀 War mission failed at ${missionState.poiName} — the enemy holds the field` });
  }

  missionState.status = 'complete';
  next.activeWarMission = null;
  next.pendingWarBattle = null;

  const verdict = evaluateWarOutcome(next.war!);
  if (verdict.outcome !== 'ongoing' && next.war!.outcome === 'ongoing') {
    next.war!.outcome = verdict.outcome;
    next.war!.outcomeReason = verdict.reason;
    next.war!.chronicle = [
      ...next.war!.chronicle,
      { day, kind: verdict.outcome, headline: verdict.reason ?? verdict.outcome },
    ];
    events.push({ type: 'REALM_LOG', message: verdict.reason ?? verdict.outcome });
  }
}
