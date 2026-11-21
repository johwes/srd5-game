import { describe, expect, it } from 'vitest';
import { getPregenCharacter, type CharacterBuildState } from '@srd5/data';
import {
  VETERAN_HIRE_COST_PER_LEVEL_GP,
  VETERAN_MAX_LEVEL,
  VETERAN_MAX_ROSTER_SIZE,
  VETERAN_MIN_LEVEL,
  collectVeteranCandidates,
  getBuildTotalLevel,
  isVeteranEligibleBuild,
  payVeteranHireCost,
  planVeteranRetirement,
  recruitVeteran,
  veteranHireCost,
  type Combatant,
  type VeteranRosterEntry,
} from '../index.js';

/**
 * SRD-1405: Veteran Roster — Heroes Remembered (Spec 13 §7).
 * Acceptance: retirement offered exactly to living heroes ≥ L3 at run
 * conclusion; roster caps at 8 with confirm-to-release; veterans hireable
 * at level-scaled gp and deploy as ordinary members.
 */

function makeBuild(id: string, level: number, gp = 0): CharacterBuildState {
  const base = structuredClone(getPregenCharacter('pregen-fighter')!);
  base.id = id;
  base.name = `Hero ${id}`;
  base.classes = base.classes.map((c) => ({
    ...c,
    level,
    hpRollsByLevel: Array.from({ length: level }, () => c.hpRollsByLevel[0] ?? 8),
  }));
  base.currency = { cp: 0, sp: 0, ep: 0, gp, pp: 0 };
  return base;
}

function makeCombatant(
  id: string,
  build: CharacterBuildState | undefined,
  overrides?: Partial<Combatant>,
): Combatant {
  return {
    id,
    name: build?.name ?? id,
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    ...(build ? { buildState: build } : {}),
    ...overrides,
  };
}

function makeEntry(id: string, level: number, source: VeteranRosterEntry['source'] = 'descent'): VeteranRosterEntry {
  const hero = makeBuild(id, Math.min(level, 10));
  return {
    veteranId: id,
    hero,
    level,
    retiredAt: '2026-11-21T00:00:00.000Z',
    runId: 'run-1',
    source,
  };
}

describe('SRD-1405: Veteran Roster (Spec 13 §7)', () => {
  describe('1. Eligibility thresholds', () => {
    it(`admits exactly levels ${VETERAN_MIN_LEVEL}–${VETERAN_MAX_LEVEL}`, () => {
      expect(VETERAN_MIN_LEVEL).toBe(3);
      expect(isVeteranEligibleBuild(makeBuild('l1', 1))).toBe(false);
      expect(isVeteranEligibleBuild(makeBuild('l2', 2))).toBe(false);
      expect(isVeteranEligibleBuild(makeBuild('l3', 3))).toBe(true);
      expect(isVeteranEligibleBuild(makeBuild('l10', 10))).toBe(true);
      expect(isVeteranEligibleBuild(makeBuild('l11', 11))).toBe(false);
      expect(isVeteranEligibleBuild(makeBuild('l20', 20))).toBe(false);
    });

    it('sums multiclass levels for the threshold', () => {
      const build = makeBuild('multi', 1);
      build.classes = [
        { ...build.classes[0]!, level: 2 },
        { ...build.classes[0]!, classId: 'rogue', level: 2 },
      ];
      expect(getBuildTotalLevel(build)).toBe(4);
      expect(isVeteranEligibleBuild(build)).toBe(true);
    });

    it('collects only living heroes with snapshots in band', () => {
      const party: Record<string, Combatant> = {
        'h1': makeCombatant('h1', makeBuild('h1', 5)),
        'h2': makeCombatant('h2', makeBuild('h2', 2)),
        'h3': makeCombatant('h3', makeBuild('h3', 6), { isDead: true, currentHp: 0 }),
        'h4': makeCombatant('h4', makeBuild('h4', 0), { currentHp: 0 }),
        'h5': makeCombatant('h5', makeBuild('h5', 12)),
        'h6': makeCombatant('h6', makeBuild('h6', 4), { exhaustionLevel: 6 }),
        'h7': makeCombatant('h7', undefined),
        'h8': makeCombatant('h8', makeBuild('h8', 3)),
      };
      const candidates = collectVeteranCandidates(party);
      expect(candidates.map((c) => c.id).sort()).toEqual(['h1', 'h8']);
      // Snapshots are clones, not aliases
      expect(candidates[0]).not.toBe(party['h1']!.buildState);
    });

    it('returns no candidates for a fresh level-1 party', () => {
      const party: Record<string, Combatant> = {
        'h1': makeCombatant('h1', makeBuild('h1', 1)),
      };
      expect(collectVeteranCandidates(party)).toEqual([]);
    });
  });

  describe('2. Retirement planning and VETERAN_RETIRED events', () => {
    it('retires eligible heroes with events carrying heroId/level/source/runId', () => {
      const planned = planVeteranRetirement(
        [],
        [makeBuild('h1', 4), makeBuild('h2', 2), makeBuild('h3', 7)],
        { runId: 'run-9', source: 'delve' },
      );
      expect(planned.requiresConfirmation).toBe(false);
      expect(planned.retired.map((v) => v.veteranId)).toEqual(['h1', 'h3']);
      expect(planned.roster.map((v) => v.veteranId)).toEqual(['h1', 'h3']);
      expect(planned.released).toEqual([]);
      expect(planned.events).toEqual([
        { type: 'VETERAN_RETIRED', heroId: 'h1', level: 4, runId: 'run-9', source: 'delve' },
        { type: 'VETERAN_RETIRED', heroId: 'h3', level: 7, runId: 'run-9', source: 'delve' },
      ]);
      expect(planned.retired[0]!.level).toBe(4);
      expect(planned.retired[0]!.source).toBe('delve');
    });

    it('skips duplicates already on the roster and ineligible builds', () => {
      const roster = [makeEntry('h1', 4)];
      const planned = planVeteranRetirement(
        roster,
        [makeBuild('h1', 4), makeBuild('h1', 4), makeBuild('low', 1)],
        { source: 'realm' },
      );
      expect(planned.retired).toEqual([]);
      expect(planned.roster.map((v) => v.veteranId)).toEqual(['h1']);
      expect(planned.events).toEqual([]);
    });

    it('requires confirmation when over cap and applies FIFO release on confirm', () => {
      const full: VeteranRosterEntry[] = Array.from(
        { length: VETERAN_MAX_ROSTER_SIZE },
        (_, i) => makeEntry(`old-${i}`, 3 + (i % 5)),
      );
      expect(VETERAN_MAX_ROSTER_SIZE).toBe(8);

      const blocked = planVeteranRetirement(full, [makeBuild('n1', 5), makeBuild('n2', 6)]);
      expect(blocked.requiresConfirmation).toBe(true);
      expect(blocked.roster.map((v) => v.veteranId)).toEqual(full.map((v) => v.veteranId));
      expect(blocked.retired).toEqual([]);
      expect(blocked.released).toEqual([]);
      expect(blocked.wouldRelease.map((v) => v.veteranId)).toEqual(['old-0', 'old-1']);
      expect(blocked.pendingCount).toBe(2);
      expect(blocked.events).toEqual([]);

      const applied = planVeteranRetirement(
        full,
        [makeBuild('n1', 5), makeBuild('n2', 6)],
        { confirmRelease: true, source: 'realm', runId: 'war-1' },
      );
      expect(applied.requiresConfirmation).toBe(false);
      expect(applied.released.map((v) => v.veteranId)).toEqual(['old-0', 'old-1']);
      expect(applied.retired.map((v) => v.veteranId)).toEqual(['n1', 'n2']);
      expect(applied.roster).toHaveLength(VETERAN_MAX_ROSTER_SIZE);
      expect(applied.roster.map((v) => v.veteranId)).toEqual([
        'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7', 'n1', 'n2',
      ]);
      expect(applied.events.map((e) => e.type)).toEqual(['VETERAN_RETIRED', 'VETERAN_RETIRED']);
    });
  });

  describe('3. Recruitment and level-scaled hire cost', () => {
    it('scales hire cost linearly with level', () => {
      expect(VETERAN_HIRE_COST_PER_LEVEL_GP).toBe(100);
      expect(veteranHireCost(3)).toBe(300);
      expect(veteranHireCost(10)).toBe(1000);
    });

    it('recruits a veteran as an ordinary snapshot member with VETERAN_RECRUITED', () => {
      const roster = [makeEntry('v1', 4), makeEntry('v2', 8)];
      const res = recruitVeteran(roster, 'v1');
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error('expected ok');
      expect(res.roster.map((v) => v.veteranId)).toEqual(['v2']);
      expect(res.hero.id).toBe('v1');
      expect(res.hireCostGp).toBe(400);
      expect(res.events).toEqual([{ type: 'VETERAN_RECRUITED', heroId: 'v1', hireCostGp: 400 }]);
      // Snapshot is a clone
      expect(res.hero).not.toBe(roster[0]!.hero);
    });

    it('rejects unknown veteran ids without mutating the roster', () => {
      const roster = [makeEntry('v1', 4)];
      const res = recruitVeteran(roster, 'nope');
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.error).toContain('nope');
      expect(res.roster).toEqual(roster);
    });
  });

  describe('4. Hire payment from seated party gold', () => {
    it('deducts in seat order and reports the paid total', () => {
      const party = [makeBuild('a', 1, 120), makeBuild('b', 1, 200), makeBuild('c', 1, 50)];
      const res = payVeteranHireCost(party, 300);
      expect(res.ok).toBe(true);
      expect(res.paid).toBe(300);
      expect(res.shortfall).toBe(0);
      expect(res.party.map((c) => c.currency.gp)).toEqual([0, 20, 50]);
      // Input untouched
      expect(party.map((c) => c.currency.gp)).toEqual([120, 200, 50]);
    });

    it('is atomic on shortfall: party unchanged with the missing amount', () => {
      const party = [makeBuild('a', 1, 40), makeBuild('b', 1, 10)];
      const res = payVeteranHireCost(party, 300);
      expect(res.ok).toBe(false);
      expect(res.paid).toBe(0);
      expect(res.shortfall).toBe(250);
      expect(res.party.map((c) => c.currency.gp)).toEqual([40, 10]);
    });

    it('treats zero cost as a free no-op', () => {
      const party = [makeBuild('a', 1, 5)];
      const res = payVeteranHireCost(party, 0);
      expect(res.ok).toBe(true);
      expect(res.paid).toBe(0);
      expect(res.party[0]!.currency.gp).toBe(5);
    });
  });
});
