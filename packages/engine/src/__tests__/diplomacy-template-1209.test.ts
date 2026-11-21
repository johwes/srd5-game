import { describe, expect, it } from 'vitest';
import {
  DIPLOMACY_DEFAULTS,
  previewDiplomacyParley,
  resolveDiplomaticParley,
  type DiplomacyApproach,
} from '../social/diplomacy.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';

/**
 * SRD-1209: Diplomacy template (Spec 11 §5) — History unlocks → Insight
 * reads → triple-approach resolve, fail-forward on tribe/envoy/truce.
 */

function fakeSheet(id: string, bonuses: Record<string, number> = {}): DerivedCharacterSheet {
  return {
    id,
    name: id,
    skills: Object.fromEntries(
      Object.entries(bonuses).map(([skill, totalBonus]) => [
        skill,
        { totalBonus, passiveScore: 10 + totalBonus },
      ]),
    ),
    spellcasting: {
      spellSlots: {},
      preparedOrKnownSpellIds: [],
      spellbookSpellIds: [],
      cantripIds: [],
    },
  } as unknown as DerivedCharacterSheet;
}

const SILVER_TONGUE = [
  fakeSheet('silver', { history: 20, insight: 20, persuasion: 20, deception: 20, intimidation: 20 }),
];
const TONGUE_TIED = [
  fakeSheet('mumbly', { history: -10, insight: -10, persuasion: -10, deception: -10, intimidation: -10 }),
];

function scanSeed(
  approach: DiplomacyApproach,
  party: DerivedCharacterSheet[],
  want: 'success' | 'fail',
  encounterKind: 'tribe' | 'envoy' | 'truce' = 'envoy',
  extra: Record<string, unknown> = {},
): number {
  for (let seed = 1; seed < 5000; seed++) {
    const res = resolveDiplomaticParley({
      encounterKind,
      counterparty: 'the Ashen Spire',
      party,
      approach,
      rngState: seed,
      ...extra,
    });
    if (want === 'success' && res.success) return seed;
    if (want === 'fail' && !res.success) return seed;
  }
  throw new Error(`no seed found for ${want}`);
}

describe('SRD-1209: diplomacy template stages', () => {
  it('history unlocks the top alliance tier on the persuasion path', () => {
    const seed = scanSeed('persuasion', SILVER_TONGUE, 'success');
    const res = resolveDiplomaticParley({
      encounterKind: 'tribe',
      counterparty: 'the Local Orc Tribe',
      party: SILVER_TONGUE,
      approach: 'persuasion',
      rngState: seed,
    });
    expect(res.history.unlocked).toBe(true);
    expect(res.history.dcRelief).toBe(2);
    expect(res.outcome).toBe('alliance');
    expect(res.success).toBe(true);
    expect(res.tributeDue).toBe(0);
    expect(res.progresses).toBe(true);
  });

  it('persuasion without leverage still closes on fair terms', () => {
    // History tanks but persuasion lands: force history DC unreachable-high.
    const party = [
      fakeSheet('scholar', { history: -10, insight: 20, persuasion: 20, deception: 20, intimidation: 20 }),
    ];
    const seed = scanSeed('persuasion', party, 'success', 'envoy', { historyDc: 30 });
    const res = resolveDiplomaticParley({
      encounterKind: 'envoy',
      counterparty: 'the Gilded League',
      party,
      approach: 'persuasion',
      rngState: seed,
      historyDc: 30,
    });
    expect(res.history.unlocked).toBe(false);
    expect(res.outcome).toBe('fair_terms');
    expect(res.tributeDue).toBe(0);
  });

  it('insight passive surfaces the cue and the active read grants +2', () => {
    const party = [fakeSheet('reader', { history: -10, insight: 8, persuasion: 20 })];
    const res = resolveDiplomaticParley({
      encounterKind: 'envoy',
      counterparty: 'the Iron Covenant',
      party,
      approach: 'persuasion',
      rngState: 5,
      speakerDeceptionTotal: 15,
    });
    // Passive 18 beats the lie 15 → cue always present.
    expect(res.insight.passiveBeatsLie).toBe(true);
    expect(res.insight.cue).toContain('something feels off');
    // Bonus threads the read: +2 when the active read lands.
    const expectedBonus = 20 + (res.insight.readSuccess ? 2 : 0);
    expect(res.bonus).toBe(expectedBonus);
  });

  it('deception wins the day but flags later fallout; intimidation costs attitude', () => {
    const lieSeed = scanSeed('deception', SILVER_TONGUE, 'success');
    const trick = resolveDiplomaticParley({
      encounterKind: 'envoy',
      counterparty: 'the Frostbound Clan',
      party: SILVER_TONGUE,
      approach: 'deception',
      rngState: lieSeed,
    });
    expect(trick.outcome).toBe('trick');
    expect(trick.success).toBe(true);
    expect(trick.fallout).toBe(true);
    expect(trick.attitudeCost).toBe(false);
    expect(trick.progresses).toBe(true);

    const fearSeed = scanSeed('intimidation', SILVER_TONGUE, 'success');
    const scare = resolveDiplomaticParley({
      encounterKind: 'envoy',
      counterparty: 'the Frostbound Clan',
      party: SILVER_TONGUE,
      approach: 'intimidation',
      rngState: fearSeed,
    });
    expect(scare.outcome).toBe('compliance');
    expect(scare.attitudeCost).toBe(true);
    expect(scare.threatDelta).toBe(5);
  });

  it('covers tribe, envoy, and truce kinds', () => {
    for (const kind of ['tribe', 'envoy', 'truce'] as const) {
      const seed = scanSeed('persuasion', SILVER_TONGUE, 'success', kind);
      const res = resolveDiplomaticParley({
        encounterKind: kind,
        counterparty: 'them',
        party: SILVER_TONGUE,
        approach: 'persuasion',
        rngState: seed,
      });
      expect(res.success).toBe(true);
      expect(res.progresses).toBe(true);
      if (kind === 'truce') {
        expect(res.durationDays).toBeGreaterThanOrEqual(12);
        expect(res.durationDays).toBeLessThanOrEqual(18);
      } else {
        expect(res.durationDays).toBe(0);
      }
    }
  });
});

describe('SRD-1209: fail-forward (never a dead end)', () => {
  it('failed envoy parleys degrade to tribute, backlash costs more + Threat', () => {
    const seed = scanSeed('persuasion', TONGUE_TIED, 'fail');
    const res = resolveDiplomaticParley({
      encounterKind: 'envoy',
      counterparty: 'the Emerald Circle',
      party: TONGUE_TIED,
      approach: 'persuasion',
      rngState: seed,
    });
    expect(res.success).toBe(false);
    expect(res.progresses).toBe(true);
    expect(['degraded', 'backlash']).toContain(res.outcome);
    if (res.outcome === 'degraded') {
      expect(res.tributeDue).toBe(DIPLOMACY_DEFAULTS.envoy.baseTributeGold);
    } else {
      expect(res.tributeDue).toBeGreaterThan(DIPLOMACY_DEFAULTS.envoy.baseTributeGold);
      expect(res.threatDelta).toBe(5);
    }
    expect(res.headline).toContain('never dies');
  });

  it('failed truces still cool the war (3-day / 1-day ceasefire)', () => {
    const seed = scanSeed('persuasion', TONGUE_TIED, 'fail', 'truce');
    const res = resolveDiplomaticParley({
      encounterKind: 'truce',
      counterparty: 'the Bloodtusk Horde',
      party: TONGUE_TIED,
      approach: 'persuasion',
      rngState: seed,
    });
    expect(res.success).toBe(false);
    expect(res.progresses).toBe(true);
    expect(res.durationDays).toBeGreaterThan(0);
    if (res.outcome === 'degraded') expect(res.durationDays).toBe(3);
    else expect(res.durationDays).toBe(1);
  });

  it('gesture-path penalty raises the DC by +2', () => {
    const seed = scanSeed('persuasion', SILVER_TONGUE, 'success');
    const clean = resolveDiplomaticParley({
      encounterKind: 'tribe',
      counterparty: 'the Local Orc Tribe',
      party: SILVER_TONGUE,
      approach: 'persuasion',
      rngState: seed,
    });
    const gestured = resolveDiplomaticParley({
      encounterKind: 'tribe',
      counterparty: 'the Local Orc Tribe',
      party: SILVER_TONGUE,
      approach: 'persuasion',
      rngState: seed,
      dcModifier: 2,
    });
    expect(gestured.dc).toBe(clean.dc + 2);
  });

  it('replays deterministically from the same seed', () => {
    const opts = {
      encounterKind: 'envoy' as const,
      counterparty: 'the Dawn Crown',
      party: SILVER_TONGUE,
      approach: 'deception' as const,
      rngState: 77,
    };
    expect(resolveDiplomaticParley(opts)).toEqual(resolveDiplomaticParley(opts));
  });
});

describe('SRD-1209: preview odds rows', () => {
  it('lists all three approaches with live bonuses and DCs (no RNG spent)', () => {
    const rows = previewDiplomacyParley({ encounterKind: 'truce', party: SILVER_TONGUE });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.approach)).toEqual(['persuasion', 'deception', 'intimidation']);
    for (const row of rows) {
      expect(row.bonus).toBe(20);
      expect(row.dc).toBe(DIPLOMACY_DEFAULTS.truce.baseDc);
      expect(row.historyDc).toBe(DIPLOMACY_DEFAULTS.truce.historyDc);
    }
  });
});
