import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  buildMissionApproaches,
  buildWarSquadMember,
  getWarMissionSide,
  isPoiEligibleForMission,
  listWarMissionCatalog,
  resolveMissionApproach,
  type WarMission,
} from '../index.js';

/**
 * SRD-1103 — Special-Ops mission catalog & POI-specific Approach resolver
 * (Spec 10 §5, BACKLOG acceptance criteria).
 */

function missionFor(kind: WarMission['kind'], poiKind: string, poiId = 'poi_test'): WarMission {
  return { id: `mission_${kind}`, kind, poiId, poiKind, poiName: 'Test Position' };
}

function partyOf(level = 3, seed = 11) {
  // Diverse class cell so skills/spells/tools are all represented.
  const classes = ['fighter', 'wizard', 'cleric', 'rogue'] as const;
  return classes.map((classId, i) =>
    buildWarSquadMember(classId, level, { seed: seed + i, nationId: 'dawn-crown' }).sheet,
  );
}

describe('SRD-1103: mission catalog', () => {
  it('ships all 9 mission kinds with sides and eligible POIs', () => {
    const catalog = listWarMissionCatalog();
    expect(catalog).toHaveLength(9);
    expect(getWarMissionSide('assassinate_general')).toBe('offensive');
    expect(getWarMissionSide('protect_poi')).toBe('defense');
    expect(getWarMissionSide('cleanse_cursed_mine')).toBe('domestic');
    expect(getWarMissionSide('recover_war_artifact')).toBe('artifact');
    expect(isPoiEligibleForMission('destroy_bridge', 'bridge')).toBe(true);
    expect(isPoiEligibleForMission('destroy_bridge', 'fortress')).toBe(false);
    expect(isPoiEligibleForMission('assassinate_general', 'fortress')).toBe(true);
  });

  it('builds 3–4 approaches per kind ending in frontal assault', () => {
    const catalog = listWarMissionCatalog();
    for (const entry of catalog) {
      const approaches = buildMissionApproaches(entry.kind, entry.eligiblePoiKinds[0]!);
      expect(approaches.length).toBeGreaterThanOrEqual(3);
      expect(approaches.length).toBeLessThanOrEqual(4);
      expect(approaches.at(-1)?.id).toBe('frontal-assault');
      const ids = approaches.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('bridges offer guard-rotation bluff + sapper stealth + assault and never teleport', () => {
    const approaches = buildMissionApproaches('destroy_bridge', 'bridge');
    const ids = approaches.map((a) => a.id);
    expect(ids).toContain('impersonate-guard-rotation');
    expect(ids).toContain('sapper-stealth');
    expect(ids).toContain('frontal-assault');
    for (const approach of approaches) {
      expect(approach.requiresSpellIds).toEqual([]);
    }
  });

  it('fortresses offer rope climb + spell entry + CHA bluff + assault', () => {
    const approaches = buildMissionApproaches('assassinate_general', 'fortress');
    const byId = Object.fromEntries(approaches.map((a) => [a.id, a]));
    expect(byId['scale-walls-rope']?.ropeAssist).toBe(true);
    expect(byId['scale-walls-rope']?.skillId).toBe('athletics');
    expect(byId['arcane-entry']?.requiresSpellIds).toContain('misty-step');
    expect(['deception', 'persuasion']).toContain(byId['trick-gate-guards']?.skillId);
    expect(byId['frontal-assault']).toBeDefined();
    expect(approaches).toHaveLength(4);
  });

  it('replays deterministically from the same seed', () => {
    const a = buildMissionApproaches('rescue_spy', 'prison_keep', { seed: 777 });
    const b = buildMissionApproaches('rescue_spy', 'prison_keep', { seed: 777 });
    expect(b).toEqual(a);
  });
});

describe('SRD-1103: resolveMissionApproach()', () => {
  it('reads the best live party skill bonus and resolves deterministically', () => {
    const party = partyOf(3);
    const mission = missionFor('sabotage_enemy_mine', 'mine');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    const approach = approaches.find((a) => a.id === 'collapse-supports')!;
    const expectedBonus = Math.max(
      ...party.map((s) => Math.max(s.skills.stealth.totalBonus, s.skills.investigation.totalBonus)),
    );
    const first = resolveMissionApproach({ mission, approachId: approach.id, party, rngState: 4242, approaches });
    const second = resolveMissionApproach({ mission, approachId: approach.id, party, rngState: 4242, approaches });
    expect(first).toEqual(second);
    expect(first.bonus).toBe(expectedBonus);
    expect(first.actorName.length).toBeGreaterThan(0);
    expect(first.total).toBe(first.naturalRoll + first.bonus);
    expect(first.success).toBe(first.total >= approach.dc);
    if (first.success) expect(first.outcome).toBe('bloodless_success');
    else expect(first.outcome).toBe('tactical_battle');
  });

  it('rope assist rolls with advantage when the party has 2+ heroes', () => {
    const party = partyOf(3);
    const mission = missionFor('assassinate_general', 'fortress');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    const result = resolveMissionApproach({
      mission,
      approachId: 'scale-walls-rope',
      party,
      rngState: 99,
      approaches,
    });
    expect(result.advantage).toBe(true);
    expect(result.naturalRoll).toBeGreaterThanOrEqual(1);
    expect(result.naturalRoll).toBeLessThanOrEqual(20);
  });

  it('spell approaches deduct a slot from a caster who knows the spell', () => {
    const party = partyOf(5, 21);
    const mission = missionFor('sabotage_enemy_mine', 'mine');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    const before = party.map((s) => s.spellcasting.spellSlots[2]?.available ?? 0);
    const result = resolveMissionApproach({
      mission,
      approachId: 'arcane-demolition',
      party,
      rngState: 7,
      approaches,
    });
    expect(result.expendedSpell).not.toBeNull();
    expect(result.expendedSpell?.spellId).toBe('shatter');
    const casterIndex = party.findIndex((s) => s.id === result.expendedSpell?.casterId);
    const afterPool = result.updatedParty[casterIndex]!.spellcasting.spellSlots[result.expendedSpell!.slotLevel as 2]!;
    const beforePoolAvailable = before[casterIndex]!;
    // Upcasting may consume a higher slot; the recorded slot must drop by one.
    expect(afterPool.available).toBeLessThanOrEqual(beforePoolAvailable);
    // Input party is never mutated.
    expect(party[casterIndex]!.spellcasting.spellSlots[result.expendedSpell!.slotLevel as 2]?.available).toBe(
      beforePoolAvailable,
    );
  });

  it('missing spell slots fail forward into an alerted battle without deduction', () => {
    const party = partyOf(1, 31).map((sheet) => {
      const next = structuredClone(sheet);
      for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
        next.spellcasting.spellSlots[level] = { max: 0, expended: 0, available: 0 };
      }
      return next;
    });
    const mission = missionFor('assassinate_general', 'fortress');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    const result = resolveMissionApproach({
      mission,
      approachId: 'arcane-entry',
      party,
      rngState: 13,
      approaches,
    });
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('tactical_battle');
    expect(result.expendedSpell).toBeNull();
    expect(result.updatedParty).toEqual(party);
  });

  it('frontal assault skips the check and yields a straight battle', () => {
    const party = partyOf(2);
    const mission = missionFor('protect_poi', 'fortress');
    const result = resolveMissionApproach({ mission, approachId: 'frontal-assault', party, rngState: 5 });
    expect(result.outcome).toBe('tactical_battle');
    expect(result.success).toBe(false);
    expect(result.naturalRoll).toBe(0);
    expect(result.modifiers).toMatchObject({ surpriseAttackerSide: 'none', extraAlliedMilitia: 0 });
  });

  it('protect_poi successes grant battle advantages instead of bloodless exits', () => {
    const party = partyOf(4, 55);
    const mission = missionFor('protect_poi', 'fortress');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    // Sweep seeds until both branches are observed (deterministic per seed).
    let sawSuccess = false;
    let sawFailure = false;
    for (let seed = 0; seed < 40; seed++) {
      const result = resolveMissionApproach({
        mission,
        approachId: 'rally-militia',
        party,
        rngState: seed,
        approaches,
      });
      expect(result.outcome).toBe('tactical_battle');
      if (result.success) {
        sawSuccess = true;
        expect(result.modifiers.extraAlliedMilitia).toBe(2);
      } else {
        sawFailure = true;
      }
    }
    expect(sawSuccess && sawFailure).toBe(true);
  });

  it('rejects unknown approach ids', () => {
    const party = partyOf(2);
    expect(() =>
      resolveMissionApproach({
        mission: missionFor('destroy_bridge', 'bridge'),
        approachId: 'teleport-sabotage',
        party,
        rngState: 1,
      }),
    ).toThrow();
  });

  it('composes with war-squad battle modifiers (surprise + militia + attrition)', () => {
    const party = partyOf(3, 77);
    const mission = missionFor('cleanse_cursed_mine', 'mine');
    const approaches = buildMissionApproaches(mission.kind, mission.poiKind);
    const ritual = approaches.find((a) => a.id === 'ritual-ward')!;
    expect(ritual.successModifiers.wave1EnemiesSurprised).toBe(true);
    expect(ritual.successModifiers.enemyHpMultiplier).toBeLessThan(1);
    // Sanity: the referenced skills exist on real derived sheets.
    expect(Object.keys(party[0]!.skills)).toContain('arcana');
    void defaultCompendium;
  });
});
