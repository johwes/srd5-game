import { describe, expect, it } from 'vitest';
import {
  OVERWORLD_POI_KINDS,
  OverworldMapSchema,
  OverworldPOISchema,
  STRATEGIC_POI_STATUSES,
  WAR_BASELINE_ARCANA_PER_TICK,
  WAR_BASELINE_MORALE_PER_TICK,
  WAR_EVIL_ARCHETYPE_IDS,
  WAR_GOOD_ARCHETYPE_IDS,
  WAR_NATION_ARCHETYPES,
  WAR_SIM_TUNING,
  WarStateSchema,
  advanceWarSimulation,
  evaluateWarOutcome,
  generateOverworldMap,
  getStrategicPOIs,
  getWarNationTotal,
  getWarPowerTotal,
  initializeWarState,
  populateSettlements,
} from '../index.js';

/**
 * SRD-1101 — War Core schemas, nation archetypes, strategic POIs, war tick
 * (Spec 10 Sections 1–3, BACKLOG acceptance criteria).
 */

function foundedRealm(seed = 4242) {
  const generated = generateOverworldMap({ seed, width: 48, height: 48 });
  const settled = populateSettlements(generated.map, generated.settlementSites);
  return settled.map;
}

describe('SRD-1101: War Core schemas & nation archetypes', () => {
  it('ships exactly 8 balanced archetypes (3 Good / 3 Neutral / 2 Evil)', () => {
    expect(WAR_NATION_ARCHETYPES).toHaveLength(8);
    expect(WAR_GOOD_ARCHETYPE_IDS).toHaveLength(3);
    expect(WAR_EVIL_ARCHETYPE_IDS).toHaveLength(2);
    const neutrals = WAR_NATION_ARCHETYPES.filter((a) => a.alignment === 'neutral');
    expect(neutrals).toHaveLength(3);

    const ids = WAR_NATION_ARCHETYPES.map((a) => a.id);
    expect(new Set(ids).size).toBe(8);
    for (const archetype of WAR_NATION_ARCHETYPES) {
      expect(archetype.nationName.length).toBeGreaterThan(0);
      expect(archetype.ruler.length).toBeGreaterThan(0);
      expect(archetype.perk.length).toBeGreaterThan(0);
    }
    // Spot-check the canonical Spec 10 table.
    const byId = Object.fromEntries(WAR_NATION_ARCHETYPES.map((a) => [a.id, a]));
    expect(byId['dawn-crown']?.ruler).toBe('Queen Evelyn');
    expect(byId['ashen-spire']?.alignment).toBe('evil');
    expect(byId['bloodtusk-horde']?.alignment).toBe('evil');
  });

  it('extends OverworldPOI kinds with the 6 strategic kinds and 6 statuses', () => {
    for (const kind of ['fortress', 'mine', 'bridge', 'supply_depot', 'prison_keep', 'subfaction_camp'] as const) {
      expect(OVERWORLD_POI_KINDS).toContain(kind);
    }
    expect(STRATEGIC_POI_STATUSES).toEqual(
      expect.arrayContaining(['intact', 'sabotaged', 'destroyed', 'cursed', 'contested', 'under_attack']),
    );
    const parsed = OverworldPOISchema.parse({
      id: 'war_test_mine_1',
      name: 'Test Mine',
      kind: 'mine',
      q: 1,
      r: 2,
      strategicStatus: 'under_attack',
      statusChangedDay: 4,
      attackDeadlineDay: 10,
      powerValue: 2,
      ownerNationId: 'dawn-crown',
      contestedByNationId: 'ashen-spire',
    });
    expect(parsed.strategicStatus).toBe('under_attack');
    expect(parsed.powerValue).toBe(2);
  });
});

describe('SRD-1101: initializeWarState()', () => {
  it('rolls 3–4 nations with at least 1 Good and 1 Evil, and seats the player nation', () => {
    for (const seed of [1, 7, 42, 99, 1234, 55555]) {
      const { war, map } = initializeWarState(foundedRealm(seed), { seed });
      expect([3, 4]).toContain(war.nationOrder.length);
      expect(Object.keys(war.nations)).toHaveLength(war.nationOrder.length);
      const alignments = war.nationOrder.map((id) => war.nations[id]!.alignment);
      expect(alignments).toContain('good');
      expect(alignments).toContain('evil');
      expect(war.nations[war.playerNationId]?.isPlayerNation).toBe(true);
      expect(war.playerNationId).toBe(war.nationOrder.find((id) => war.nations[id]!.isPlayerNation));
      expect(war.currentDay).toBe(1);
      expect(war.outcome).toBe('ongoing');
      expect(WarStateSchema.safeParse(war).success).toBe(true);
      expect(OverworldMapSchema.safeParse(map).success).toBe(true);
    }
  });

  it('honors explicit nationCount and player nation overrides', () => {
    const { war } = initializeWarState(foundedRealm(11), {
      seed: 11,
      nationCount: 4,
      playerNationArchetypeId: 'gilded-league',
    });
    expect(war.nationOrder).toHaveLength(4);
    expect(war.playerNationId).toBe('gilded-league');
    expect(war.nations['gilded-league']?.isPlayerNation).toBe(true);
  });

  it('replays bit-exactly from the same seed', () => {
    const first = initializeWarState(foundedRealm(2024), { seed: 2024 });
    const second = initializeWarState(foundedRealm(2024), { seed: 2024 });
    expect(second.war).toEqual(first.war);
    expect(second.map).toEqual(first.map);
  });

  it('plants intact strategic POIs with power values owned by war nations', () => {
    const { war, map } = initializeWarState(foundedRealm(77), { seed: 77, nationCount: 3 });
    const strategic = getStrategicPOIs(map);
    // 4 per nation + 2 neutral mines.
    expect(strategic.length).toBe(3 * 4 + 2);
    for (const poi of strategic) {
      expect(poi.strategicStatus).toBe('intact');
      expect(poi.powerValue).toBeGreaterThan(0);
    }
    const neutrals = strategic.filter((poi) => !(poi.ownerNationId ?? poi.factionId));
    expect(neutrals.length).toBe(2);
    expect(neutrals.every((poi) => poi.kind === 'mine')).toBe(true);
    for (const nationId of war.nationOrder) {
      const owned = strategic.filter((poi) => (poi.ownerNationId ?? poi.factionId) === nationId);
      expect(owned.length).toBe(4);
      expect(owned.map((poi) => poi.kind).sort()).toEqual(['bridge', 'fortress', 'mine', 'supply_depot']);
    }
  });
});

describe('SRD-1101: advanceWarSimulation() living tick', () => {
  it('accrues War Power from intact POIs with random raids disabled', () => {
    const { war, map } = initializeWarState(foundedRealm(5), { seed: 5, nationCount: 3 });
    const before = Object.fromEntries(
      war.nationOrder.map((id) => [id, getWarNationTotal(war.nations[id]!)]),
    );
    const after = advanceWarSimulation(war, map, { disableRandomEvents: true });
    expect(after.war.tickCount).toBe(1);
    expect(after.war.currentDay).toBe(1 + after.war.tickIntervalDays);
    for (const id of after.war.nationOrder) {
      const nation = after.war.nations[id]!;
      // Baseline drift alone guarantees growth; POI income adds more.
      const minGain = WAR_BASELINE_ARCANA_PER_TICK + WAR_BASELINE_MORALE_PER_TICK;
      expect(getWarNationTotal(nation) - before[id]!).toBeGreaterThanOrEqual(minGain);
    }
    expect(OverworldMapSchema.safeParse(after.map).success).toBe(true);
  });

  it('rebuilds destroyed bridges once currentDay reaches recoveryDay', () => {
    const { war, map } = initializeWarState(foundedRealm(9), { seed: 9, nationCount: 3 });
    const bridge = getStrategicPOIs(map).find((poi) => poi.kind === 'bridge')!;
    const broken = structuredClone(map);
    broken.pois[bridge.id] = {
      ...bridge,
      strategicStatus: 'destroyed',
      statusChangedDay: 1,
      recoveryDay: 1 + war.tickIntervalDays,
    };
    const after = advanceWarSimulation(war, broken, { disableRandomEvents: true });
    expect(after.map.pois[bridge.id]?.strategicStatus).toBe('intact');
    expect(after.map.pois[bridge.id]?.recoveryDay).toBeUndefined();
    expect(after.events.some((event) => event.kind === 'bridge_rebuilt')).toBe(true);
  });

  it('leaves destroyed bridges ruined before recoveryDay', () => {
    const { war, map } = initializeWarState(foundedRealm(9), { seed: 9, nationCount: 3 });
    const bridge = getStrategicPOIs(map).find((poi) => poi.kind === 'bridge')!;
    const broken = structuredClone(map);
    broken.pois[bridge.id] = {
      ...bridge,
      strategicStatus: 'destroyed',
      statusChangedDay: 1,
      recoveryDay: 1 + war.tickIntervalDays * 3,
    };
    const after = advanceWarSimulation(war, broken, { disableRandomEvents: true });
    expect(after.map.pois[bridge.id]?.strategicStatus).toBe('destroyed');
  });

  it('undefended under_attack POIs fall when the deadline passes', () => {
    const { war, map } = initializeWarState(foundedRealm(13), { seed: 13, nationCount: 3 });
    const fortress = getStrategicPOIs(map).find((poi) => poi.kind === 'fortress')!;
    const bridge = getStrategicPOIs(map).find((poi) => poi.kind === 'bridge')!;
    const besieged = structuredClone(map);
    const attacker = war.nationOrder.find((id) => id !== war.playerNationId)!;
    besieged.pois[fortress.id] = {
      ...fortress,
      strategicStatus: 'under_attack',
      statusChangedDay: 1,
      attackDeadlineDay: 1 + war.tickIntervalDays,
      contestedByNationId: attacker,
    };
    besieged.pois[bridge.id] = {
      ...bridge,
      strategicStatus: 'under_attack',
      statusChangedDay: 1,
      attackDeadlineDay: 1 + war.tickIntervalDays,
      contestedByNationId: attacker,
    };
    const after = advanceWarSimulation(war, besieged, { disableRandomEvents: true });
    expect(after.map.pois[fortress.id]?.strategicStatus).toBe('sabotaged');
    expect(after.map.pois[bridge.id]?.strategicStatus).toBe('destroyed');
    expect(after.map.pois[bridge.id]?.recoveryDay).toBe(
      1 + war.tickIntervalDays + WAR_SIM_TUNING.bridgeRebuildDays,
    );
    expect(after.events.some((event) => event.kind === 'poi_lost')).toBe(true);
  });

  it('spawns contests, curses, and attack warnings across a multi-tick war', () => {
    const seen = new Set<string>();
    for (const seed of [3, 8, 21, 34, 55, 89, 144, 233]) {
      const founded = initializeWarState(foundedRealm(seed), { seed, nationCount: 4 });
      const result = advanceWarSimulation(founded.war, founded.map, {
        toDay: 1 + founded.war.tickIntervalDays * 8,
      });
      for (const event of result.events) seen.add(event.kind);
      // The simulation stays schema-valid no matter which raids fire.
      expect(WarStateSchema.safeParse(result.war).success).toBe(true);
      expect(OverworldMapSchema.safeParse(result.map).success).toBe(true);
    }
    expect(seen.has('mine_contested')).toBe(true);
    expect(seen.has('mine_cursed')).toBe(true);
    expect(seen.has('poi_attacked')).toBe(true);
  });

  it('truces shield a nation from raids while active, then expire back to war', () => {
    const { war, map } = initializeWarState(foundedRealm(31), { seed: 31, nationCount: 3 });
    const rivals = war.nationOrder.filter((id) => id !== war.playerNationId);
    const truced: typeof war = {
      ...war,
      truces: rivals.map((id) => ({ nationIdA: war.playerNationId, nationIdB: id, untilDay: 1 + war.tickIntervalDays * 4 })),
    };
    const oneTick = advanceWarSimulation(truced, map, { toDay: 1 + war.tickIntervalDays * 2 });
    const hostileKinds = new Set(['mine_cursed', 'poi_sabotaged', 'poi_attacked', 'mine_contested']);
    expect(oneTick.events.some((event) => hostileKinds.has(event.kind))).toBe(false);

    const pastExpiry = advanceWarSimulation(truced, map, { toDay: 1 + war.tickIntervalDays * 5 });
    expect(pastExpiry.war.truces).toHaveLength(0);
    expect(pastExpiry.events.some((event) => event.kind === 'truce_expired')).toBe(true);
  });

  it('applies guerrilla drains to the target nation every tick', () => {
    const { war, map } = initializeWarState(foundedRealm(17), { seed: 17, nationCount: 3 });
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const before = getWarNationTotal(war.nations[target]!);
    const drained: typeof war = {
      ...war,
      guerrillaDrains: [{ id: 'orc-guerrilla', label: 'Orc guerrilla warfare', targetNationId: target, militaryDrain: 3, economyDrain: 3 }],
    };
    const after = advanceWarSimulation(drained, map, { disableRandomEvents: true });
    // Income (+POI + baseline) minus 6 drain must net below the no-drain result.
    const clean = advanceWarSimulation(war, map, { disableRandomEvents: true });
    expect(getWarNationTotal(after.war.nations[target]!)).toBe(
      getWarNationTotal(clean.war.nations[target]!) - 6,
    );
    expect(getWarNationTotal(after.war.nations[target]!)).toBeLessThan(before + 20);
  });

  it('evaluates Power Dominance victory and collapse defeat', () => {
    const { war, map } = initializeWarState(foundedRealm(23), { seed: 23, nationCount: 3 });
    // Player on the brink of dominance wins the next tick.
    const ascendant: typeof war = {
      ...war,
      nations: {
        ...war.nations,
        [war.playerNationId]: {
          ...war.nations[war.playerNationId]!,
          power: { military: 40, economy: 40, arcana: 10, morale: 10 },
        },
      },
    };
    const won = advanceWarSimulation(ascendant, map, { disableRandomEvents: true });
    expect(won.war.outcome).toBe('victory');
    expect(won.events.some((event) => event.kind === 'victory')).toBe(true);

    // A collapsed player nation loses even before rivals peak.
    // (All of its holdings are sabotaged so no POI income can revive it.)
    const ruined = structuredClone(map);
    for (const poi of Object.values(ruined.pois)) {
      if ((poi.ownerNationId ?? poi.factionId) === war.playerNationId && poi.strategicStatus === 'intact') {
        poi.strategicStatus = 'sabotaged';
        poi.statusChangedDay = 1;
      }
    }
    const collapsed: typeof war = {
      ...war,
      nations: {
        ...war.nations,
        [war.playerNationId]: {
          ...war.nations[war.playerNationId]!,
          power: { military: 0, economy: 0, arcana: 0, morale: 0 },
        },
      },
    };
    const lost = advanceWarSimulation(collapsed, ruined, { disableRandomEvents: true, toDay: 4 });
    expect(lost.war.outcome).toBe('defeat');
    expect(evaluateWarOutcome(collapsed).outcome).toBe('defeat');

    // Rival dominance also defeats the player.
    const rivalId = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const eclipsed: typeof war = {
      ...war,
      nations: {
        ...war.nations,
        [rivalId]: {
          ...war.nations[rivalId]!,
          power: { military: 40, economy: 40, arcana: 10, morale: 10 },
        },
      },
    };
    expect(evaluateWarOutcome(eclipsed).outcome).toBe('defeat');
  });

  it('is deterministic: the same seed replays identical ticks', () => {
    const first = initializeWarState(foundedRealm(31337), { seed: 31337 });
    const second = initializeWarState(foundedRealm(31337), { seed: 31337 });
    const a = advanceWarSimulation(first.war, first.map, { toDay: 1 + first.war.tickIntervalDays * 6 });
    const b = advanceWarSimulation(second.war, second.map, { toDay: 1 + second.war.tickIntervalDays * 6 });
    expect(b.war).toEqual(a.war);
    expect(b.map).toEqual(a.map);
    expect(b.events).toEqual(a.events);
  });

  it('sums the four power pillars into the dominance total', () => {
    expect(getWarPowerTotal({ military: 10, economy: 20, arcana: 30, morale: 40 })).toBe(100);
  });
});
