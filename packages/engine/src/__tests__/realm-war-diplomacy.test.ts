import { describe, expect, it } from 'vitest';
import {
  WarStateSchema,
  advanceWarSimulation,
  buildHunterKillerSquad,
  buildWarSquadMember,
  completeSubFactionQuest,
  createWarDiplomacyState,
  decayWarThreats,
  generateOverworldMap,
  getNationThreat,
  getWarNationTotal,
  getWarThreatTier,
  hireMercenaryCompany,
  hireThievesGuild,
  initializeWarState,
  negotiateTruce,
  populateSettlements,
  reportPatrolKill,
  resolvePatrolEncounter,
  rollPatrolEncounter,
  type DerivedCharacterSheet,
  type WarDiplomacyState,
} from '../index.js';

/**
 * SRD-1104 — Diplomacy, sub-faction patronage & enemy-territory patrols
 * (Spec 10 Sections 6–7, BACKLOG acceptance criteria).
 */

function foundedRealm(seed = 4242) {
  const generated = generateOverworldMap({ seed, width: 48, height: 48 });
  const settled = populateSettlements(generated.map, generated.settlementSites);
  return settled.map;
}

function foundedWar(seed = 4242, nationCount: 3 | 4 = 3) {
  return initializeWarState(foundedRealm(seed), { seed, nationCount });
}

/** Minimal fake sheet with fixed skill bonuses (guaranteed pass/fail bands). */
function fakeSheet(
  id: string,
  bonuses: Record<string, number> = {},
  spellcasting: Record<string, unknown> = {},
): DerivedCharacterSheet {
  return {
    id,
    name: id,
    skills: Object.fromEntries(
      Object.entries(bonuses).map(([skill, totalBonus]) => [skill, { totalBonus }]),
    ),
    spellcasting: {
      spellSlots: {},
      preparedOrKnownSpellIds: [],
      spellbookSpellIds: [],
      cantripIds: [],
      ...spellcasting,
    },
  } as unknown as DerivedCharacterSheet;
}

const SILVER_TONGUE = [fakeSheet('silver', { persuasion: 20, deception: 20 })];
const TONGUE_TIED = [fakeSheet('mumbly', { persuasion: -10, deception: -10 })];
const GHOST = [fakeSheet('ghost', { stealth: 20, survival: 20 })];
const CLUMSY = [fakeSheet('clumsy', { stealth: -10, survival: -10 })];

function cellParty(level = 3, seed = 11) {
  const classes = ['fighter', 'wizard', 'cleric', 'rogue'] as const;
  return classes.map(
    (classId, i) => buildWarSquadMember(classId, level, { seed: seed + i, nationId: 'dawn-crown' }).sheet,
  );
}

describe('SRD-1104: threat tiers', () => {
  it('maps 0..100 onto the four Spec 10 bands', () => {
    expect(getWarThreatTier(0)).toBe('unnoticed');
    expect(getWarThreatTier(24)).toBe('unnoticed');
    expect(getWarThreatTier(25)).toBe('suspicious');
    expect(getWarThreatTier(54)).toBe('suspicious');
    expect(getWarThreatTier(55)).toBe('hunted');
    expect(getWarThreatTier(79)).toBe('hunted');
    expect(getWarThreatTier(80)).toBe('most_wanted');
    expect(getWarThreatTier(100)).toBe('most_wanted');
  });

  it('starts empty and decays naturally (-6 outside, -2 undetected, 0 detected)', () => {
    let diplomacy = createWarDiplomacyState();
    expect(getNationThreat(diplomacy, 'ashen-spire')).toBe(0);
    diplomacy = {
      ...diplomacy,
      threats: { 'ashen-spire': 60, 'bloodtusk-horde': 60, 'iron-covenant': 60 },
    };
    const outside = decayWarThreats(diplomacy, { days: 3 });
    expect(getNationThreat(outside.diplomacy, 'ashen-spire')).toBe(42);
    expect(outside.stoodDown).toContain('ashen-spire');

    const inside = decayWarThreats(diplomacy, { days: 3, undetectedNationIds: ['ashen-spire'] });
    expect(getNationThreat(inside.diplomacy, 'ashen-spire')).toBe(54);
    expect(inside.stoodDown).toContain('ashen-spire');

    const detected = decayWarThreats(diplomacy, { days: 3, detectedNationIds: ['ashen-spire'] });
    expect(getNationThreat(detected.diplomacy, 'ashen-spire')).toBe(60);
    expect(detected.stoodDown).not.toContain('ashen-spire');
    expect(detected.stoodDown).toHaveLength(2);
  });
});

describe('SRD-1104: temporary truces', () => {
  it('seals a 12–18 day truce on a passed Persuasion challenge', () => {
    const { war } = foundedWar(101);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const result = negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: target, rngState: 7 });
    expect(result.success).toBe(true);
    expect(result.durationDays).toBeGreaterThanOrEqual(12);
    expect(result.durationDays).toBeLessThanOrEqual(18);
    expect(result.untilDay).toBe(war.currentDay + result.durationDays);
    expect(result.war.truces).toHaveLength(1);
    expect(result.goldSpent).toBe(0);
    expect(result.dc).toBe(14);
    expect(result.war.chronicle.some((e) => e.kind === 'truce_signed')).toBe(true);
    expect(WarStateSchema.safeParse(result.war).success).toBe(true);
  });

  it('lowers the DC with gold tribute (spent only on success)', () => {
    const { war } = foundedWar(102);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const modest = negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: target, rngState: 7, tributeGold: 100 });
    expect(modest.dc).toBe(12);
    expect(modest.goldSpent).toBe(100);
    const deep = negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: target, rngState: 7, tributeGold: 250 });
    expect(deep.dc).toBe(10);
    const failed = negotiateTruce({ war, party: TONGUE_TIED, targetNationId: target, rngState: 7, tributeGold: 250 });
    expect(failed.success).toBe(false);
    expect(failed.durationDays).toBe(0);
    expect(failed.goldSpent).toBe(0);
    expect(failed.war.truces).toHaveLength(0);
  });

  it('rejects truces with your own nation, duplicates, and strangers', () => {
    const { war } = foundedWar(103);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    expect(() => negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: war.playerNationId, rngState: 1 })).toThrow();
    expect(() => negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: 'no-such-nation', rngState: 1 })).toThrow();
    const sealed = negotiateTruce({ war, party: SILVER_TONGUE, targetNationId: target, rngState: 1 });
    expect(() =>
      negotiateTruce({ war: sealed.war, party: SILVER_TONGUE, targetNationId: target, rngState: 2 }),
    ).toThrow();
  });

  it('pauses raids and patrol hostility while active', () => {
    const { war, map } = foundedWar(104);
    let negotiated = war;
    for (const rival of war.nationOrder.filter((id) => id !== war.playerNationId)) {
      negotiated = negotiateTruce({ war: negotiated, party: SILVER_TONGUE, targetNationId: rival, rngState: 3 }).war;
    }
    const ticked = advanceWarSimulation(negotiated, map, { toDay: 1 + war.tickIntervalDays * 2 });
    const hostile = new Set(['mine_cursed', 'poi_sabotaged', 'poi_attacked', 'mine_contested']);
    expect(ticked.events.some((e) => hostile.has(e.kind))).toBe(false);

    const rival = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const patrol = rollPatrolEncounter({ rngState: 9, onRoad: true, nationId: rival, party: cellParty(), war: negotiated });
    expect(patrol.encountered).toBe(false);
    expect(patrol.reason).toBe('truce');
  });

  it('replays deterministically from the same seed', () => {
    const { war } = foundedWar(105);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const a = negotiateTruce({ war, party: cellParty(), targetNationId: target, rngState: 77, tributeGold: 100 });
    const b = negotiateTruce({ war, party: cellParty(), targetNationId: target, rngState: 77, tributeGold: 100 });
    expect(b).toEqual(a);
  });
});

describe('SRD-1104: mercenaries & thieves guild', () => {
  it('hires a company for +Military power at the 200gp list price', () => {
    const { war } = foundedWar(201);
    const before = getWarNationTotal(war.nations[war.playerNationId]!);
    const hired = hireMercenaryCompany({ war, goldAvailable: 500, rngState: 1 });
    expect(hired.success).toBe(true);
    expect(hired.reliable).toBe(false);
    expect(hired.cost).toBe(200);
    expect(hired.goldSpent).toBe(200);
    expect(hired.remainingGold).toBe(300);
    expect(hired.powerGained).toBe(3);
    expect(getWarNationTotal(hired.war.nations[hired.war.playerNationId]!)).toBe(before + 3);
    expect(hired.war.chronicle.some((e) => e.kind === 'mercenaries_hired')).toBe(true);
  });

  it('rewards a passed parley with discount + reliable troops, and honors Gilded coffers', () => {
    const { war } = foundedWar(202);
    const haggled = hireMercenaryCompany({ war, party: SILVER_TONGUE, goldAvailable: 500, rngState: 4 });
    expect(haggled.reliable).toBe(true);
    expect(haggled.cost).toBe(160);
    expect(haggled.powerGained).toBe(5);

    const leagueSeed = (() => {
      for (let seed = 0; seed < 200; seed++) {
        try {
          return initializeWarState(foundedRealm(seed), {
            seed,
            nationCount: 4,
            playerNationArchetypeId: 'gilded-league',
          });
        } catch {
          continue;
        }
      }
      throw new Error('no seed seats the Gilded League');
    })();
    const league = leagueSeed;
    const leagueBase = hireMercenaryCompany({ war: league.war, goldAvailable: 500, rngState: 4 });
    expect(leagueBase.cost).toBe(170);
    const leagueHaggled = hireMercenaryCompany({ war: league.war, party: SILVER_TONGUE, goldAvailable: 500, rngState: 4 });
    expect(leagueHaggled.cost).toBe(136);
    expect(leagueHaggled.powerGained).toBe(5);
  });

  it('turns away empty war chests without touching the war', () => {
    const { war } = foundedWar(203);
    const broke = hireMercenaryCompany({ war, goldAvailable: 50, rngState: 1 });
    expect(broke.success).toBe(false);
    expect(broke.goldSpent).toBe(0);
    expect(broke.war).toEqual(war);
  });

  it('runs guild sabotage against intact rival mines/depots with a clean-job check', () => {
    const { war, map } = foundedWar(204);
    const rival = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const targetId = Object.values(map.pois).find(
      (poi) =>
        (poi.ownerNationId ?? poi.factionId) === rival &&
        (poi.kind === 'mine' || poi.kind === 'supply_depot') &&
        poi.strategicStatus === 'intact',
    )!.id;
    const clean = hireThievesGuild({ war, map, party: SILVER_TONGUE, targetPoiId: targetId, goldAvailable: 500, rngState: 6 });
    expect(clean.success).toBe(true);
    expect(clean.map.pois[targetId]?.strategicStatus).toBe('sabotaged');
    expect(clean.goldSpent).toBe(150);
    expect(clean.remainingGold).toBe(350);
    expect(clean.war.chronicle.some((e) => e.kind === 'covert_strike')).toBe(true);

    const blown = hireThievesGuild({ war, map, party: TONGUE_TIED, targetPoiId: targetId, goldAvailable: 500, rngState: 6 });
    expect(blown.success).toBe(false);
    expect(blown.map.pois[targetId]?.strategicStatus).toBe('intact');
    expect(blown.goldSpent).toBe(150);

    const broke = hireThievesGuild({ war, map, party: SILVER_TONGUE, targetPoiId: targetId, goldAvailable: 10, rngState: 6 });
    expect(broke.success).toBe(false);
    expect(broke.goldSpent).toBe(0);
  });

  it('rejects guild strikes on own, wrong-kind, or ruined holdings', () => {
    const { war, map } = foundedWar(205);
    const ownId = Object.values(map.pois).find(
      (poi) => (poi.ownerNationId ?? poi.factionId) === war.playerNationId && poi.kind === 'mine',
    )!.id;
    const fortressId = Object.values(map.pois).find((poi) => poi.kind === 'fortress')!.id;
    expect(() =>
      hireThievesGuild({ war, map, party: SILVER_TONGUE, targetPoiId: ownId, goldAvailable: 500, rngState: 1 }),
    ).toThrow();
    expect(() =>
      hireThievesGuild({ war, map, party: SILVER_TONGUE, targetPoiId: fortressId, goldAvailable: 500, rngState: 1 }),
    ).toThrow();
    const ruined = structuredClone(map);
    const rival = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const targetId = Object.values(ruined.pois).find(
      (poi) => (poi.ownerNationId ?? poi.factionId) === rival && poi.kind === 'mine',
    )!.id;
    ruined.pois[targetId] = { ...ruined.pois[targetId]!, strategicStatus: 'sabotaged', statusChangedDay: 1 };
    expect(() =>
      hireThievesGuild({ war, map: ruined, party: SILVER_TONGUE, targetPoiId: targetId, goldAvailable: 500, rngState: 1 }),
    ).toThrow();
  });
});

describe('SRD-1104: sub-faction patronage chains', () => {
  it('runs the 3-quest Orc chain into an ongoing guerrilla drain', () => {
    const { war } = foundedWar(301);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    let diplomacy = createWarDiplomacyState();
    let state = { diplomacy, war };
    for (const questId of ['orc-raid-relief', 'orc-warchief-parley'] as const) {
      const step = completeSubFactionQuest({ ...state, subfactionId: 'local_orc_tribe', questId });
      expect(step.allied).toBe(false);
      state = step;
    }
    expect(state.war.guerrillaDrains).toHaveLength(0);
    const sealed = completeSubFactionQuest({ ...state, subfactionId: 'local_orc_tribe', questId: 'orc-war-path', targetNationId: target });
    expect(sealed.allied).toBe(true);
    expect(sealed.diplomacy.subfactions['local_orc_tribe']?.allied).toBe(true);
    expect(sealed.war.guerrillaDrains).toHaveLength(1);
    expect(sealed.war.chronicle.some((e) => e.kind === 'guerrilla_started')).toBe(true);

    const { map } = foundedWar(301);
    const clean = advanceWarSimulation(state.war, map, { disableRandomEvents: true });
    const drained = advanceWarSimulation(sealed.war, map, { disableRandomEvents: true });
    expect(getWarNationTotal(drained.war.nations[target]!)).toBe(
      getWarNationTotal(clean.war.nations[target]!) - 6,
    );
  });

  it('runs the 2-quest Druid chain into Power + trail blessing', () => {
    const { war } = foundedWar(302);
    let diplomacy = createWarDiplomacyState();
    const first = completeSubFactionQuest({ diplomacy, war, subfactionId: 'local_druid_circle', questId: 'druid-blighted-grove' });
    expect(first.allied).toBe(false);
    expect(first.diplomacy.druidBlessingActive).toBe(false);
    const before = getWarNationTotal(first.war.nations[first.war.playerNationId]!);
    const sealed = completeSubFactionQuest({ ...first, subfactionId: 'local_druid_circle', questId: 'druid-circle-rite' });
    expect(sealed.allied).toBe(true);
    expect(sealed.diplomacy.druidBlessingActive).toBe(true);
    expect(getWarNationTotal(sealed.war.nations[sealed.war.playerNationId]!)).toBe(before + 10);
    expect(sealed.war.chronicle.some((e) => e.kind === 'druid_blessing')).toBe(true);
  });

  it('enforces chain order, uniqueness, and alliance targets', () => {
    const { war } = foundedWar(303);
    const diplomacy = createWarDiplomacyState();
    expect(() =>
      completeSubFactionQuest({ diplomacy, war, subfactionId: 'local_orc_tribe', questId: 'orc-war-path' }),
    ).toThrow();
    expect(() =>
      completeSubFactionQuest({ diplomacy, war, subfactionId: 'local_druid_circle', questId: 'nope' }),
    ).toThrow();
    const first = completeSubFactionQuest({ diplomacy, war, subfactionId: 'local_orc_tribe', questId: 'orc-raid-relief' });
    expect(() =>
      completeSubFactionQuest({ ...first, subfactionId: 'local_orc_tribe', questId: 'orc-raid-relief' }),
    ).toThrow();
    const second = completeSubFactionQuest({ ...first, subfactionId: 'local_orc_tribe', questId: 'orc-warchief-parley' });
    expect(() =>
      completeSubFactionQuest({ ...second, subfactionId: 'local_orc_tribe', questId: 'orc-war-path' }),
    ).toThrow();
    expect(() =>
      completeSubFactionQuest({
        ...second,
        subfactionId: 'local_orc_tribe',
        questId: 'orc-war-path',
        targetNationId: second.war.playerNationId,
      }),
    ).toThrow();
  });
});

describe('SRD-1104: enemy territory patrols', () => {
  it('runs hotter on roads than off-road, mitigated by Survival/Stealth', () => {
    let road = 0;
    let offroad = 0;
    let ghostRoad = 0;
    for (let seed = 0; seed < 300; seed++) {
      if (rollPatrolEncounter({ rngState: seed, onRoad: true, nationId: 'ashen-spire', party: CLUMSY }).encountered) road++;
      if (rollPatrolEncounter({ rngState: seed, onRoad: false, nationId: 'ashen-spire', party: CLUMSY }).encountered) offroad++;
      if (rollPatrolEncounter({ rngState: seed, onRoad: true, nationId: 'ashen-spire', party: GHOST }).encountered) ghostRoad++;
    }
    expect(road).toBeGreaterThan(offroad);
    expect(ghostRoad).toBeLessThan(road);
  });

  it('bluffs and evasions pass quietly, failures join battle', () => {
    const diplomacy = createWarDiplomacyState();
    const bluff = resolvePatrolEncounter({ diplomacy, party: SILVER_TONGUE, nationId: 'ashen-spire', approach: 'bluff', rngState: 1 });
    expect(bluff.outcome).toBe('passed');
    expect(bluff.threatDelta).toBe(0);
    expect(getNationThreat(bluff.diplomacy, 'ashen-spire')).toBe(0);

    const exposed = resolvePatrolEncounter({ diplomacy, party: TONGUE_TIED, nationId: 'ashen-spire', approach: 'bluff', rngState: 1 });
    expect(exposed.outcome).toBe('tactical_battle');

    const ghosted = resolvePatrolEncounter({ diplomacy, party: GHOST, nationId: 'ashen-spire', approach: 'evade', rngState: 1 });
    expect(ghosted.outcome).toBe('passed');
    const chased = resolvePatrolEncounter({ diplomacy, party: CLUMSY, nationId: 'ashen-spire', approach: 'evade', rngState: 1 });
    expect(chased.outcome).toBe('tactical_battle');
  });

  it('passes disguised bands automatically while expending the veil slot', () => {
    const diplomacy = createWarDiplomacyState();
    const veiled = fakeSheet('hedge-witch', { persuasion: -10 }, {
      preparedOrKnownSpellIds: ['disguise-self'],
      spellSlots: { 1: { max: 2, expended: 0, available: 2 } },
    });
    const result = resolvePatrolEncounter({ diplomacy, party: [veiled], nationId: 'ashen-spire', approach: 'bluff', rngState: 1 });
    expect(result.outcome).toBe('passed');
    expect(result.success).toBe(true);
    expect(result.threatDelta).toBe(0);
    const slots = result.updatedParty[0]!.spellcasting?.spellSlots as unknown as Record<number, { available: number }>;
    expect(slots[1]!.available).toBe(1);
  });

  it('bribes pass with +5 Threat; empty purses draw steel', () => {
    const diplomacy = createWarDiplomacyState();
    const paid = resolvePatrolEncounter({ diplomacy, party: SILVER_TONGUE, nationId: 'ashen-spire', approach: 'bribe', rngState: 1, goldAvailable: 120 });
    expect(paid.outcome).toBe('passed');
    expect(paid.threatDelta).toBe(5);
    expect(paid.goldSpent).toBe(50);
    expect(paid.remainingGold).toBe(70);
    expect(getNationThreat(paid.diplomacy, 'ashen-spire')).toBe(5);

    const broke = resolvePatrolEncounter({ diplomacy, party: SILVER_TONGUE, nationId: 'ashen-spire', approach: 'bribe', rngState: 1, goldAvailable: 10 });
    expect(broke.outcome).toBe('tactical_battle');
  });

  it('escalates +20 per killed patrol and starts pursuit at 55', () => {
    const { war } = foundedWar(401);
    let diplomacy: WarDiplomacyState = createWarDiplomacyState();
    const fight = resolvePatrolEncounter({ diplomacy, party: cellParty(), nationId: 'ashen-spire', approach: 'fight', rngState: 1 });
    expect(fight.outcome).toBe('tactical_battle');
    expect(getNationThreat(fight.diplomacy, 'ashen-spire')).toBe(0);

    const first = reportPatrolKill({ diplomacy, nationId: 'ashen-spire' });
    expect(first.threat).toBe(20);
    expect(first.pursuitActive).toBe(false);
    expect(first.pursuitStarted).toBe(false);
    const second = reportPatrolKill({ diplomacy: first.diplomacy, nationId: 'ashen-spire' });
    expect(second.threat).toBe(40);
    expect(second.tier).toBe('suspicious');
    expect(second.pursuitActive).toBe(false);
    const third = reportPatrolKill({ diplomacy: second.diplomacy, war, nationId: 'ashen-spire' });
    expect(third.threat).toBe(60);
    expect(third.tier).toBe('hunted');
    expect(third.pursuitActive).toBe(true);
    expect(third.pursuitStarted).toBe(true);
    expect(third.headline).toContain('pursuit');
    expect(third.war!.chronicle.some((e) => e.kind === 'patrol_skirmish')).toBe(true);
    expect(third.war!.chronicle.some((e) => e.kind === 'pursuit_started')).toBe(true);

    const fourth = reportPatrolKill({ diplomacy: third.diplomacy, nationId: 'ashen-spire' });
    expect(fourth.threat).toBe(80);
    expect(fourth.tier).toBe('most_wanted');
    expect(fourth.pursuitStarted).toBe(false);
  });

  it('fields hunter-killer pursuit squads at dynamic CR', () => {
    const squad = buildHunterKillerSquad(5, 'ashen-spire', 99);
    expect(squad.members).toHaveLength(4);
    expect(squad.averageLevel).toBe(5);
    expect(squad.members[0]!.combatant.id).toContain('hunter_killer_ashen-spire');
  });

  it('replays patrol rolls deterministically', () => {
    const a = rollPatrolEncounter({ rngState: 55, onRoad: true, nationId: 'ashen-spire', party: cellParty() });
    const b = rollPatrolEncounter({ rngState: 55, onRoad: true, nationId: 'ashen-spire', party: cellParty() });
    expect(b).toEqual(a);
    const c = resolvePatrolEncounter({ diplomacy: createWarDiplomacyState(), party: cellParty(), nationId: 'ashen-spire', approach: 'evade', rngState: 55 });
    const d = resolvePatrolEncounter({ diplomacy: createWarDiplomacyState(), party: cellParty(), nationId: 'ashen-spire', approach: 'evade', rngState: 55 });
    expect(d).toEqual(c);
  });
});
