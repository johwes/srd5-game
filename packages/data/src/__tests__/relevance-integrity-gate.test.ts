import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  RELEVANCE_TRACKING_TICKET,
  SKILL_IDS,
  TRACKED_UNSUPPORTED_LANGUAGES,
  TRACKED_UNSUPPORTED_SKILLS,
  TRACKED_UNSUPPORTED_SPELLS,
  collectOfferedSpellRefs,
  defaultCompendium,
  getLanguageRelevanceInfo,
  getSkillRelevanceInfo,
  getSpellRelevanceInfo,
  validateRelevanceCoverage,
  validateSrdDataset,
  type SrdIngestionInput,
} from '../index.js';

function cloneDataset(base: SrdIngestionInput = BUNDLED_SRD_DATASET): SrdIngestionInput {
  return structuredClone(base);
}

function spellLookup(id: string) {
  const spell = defaultCompendium.getSpell(id);
  return spell
    ? {
        id: spell.id,
        name: spell.name,
        level: spell.level,
        school: spell.school,
        ritual: spell.ritual,
        concentration: spell.concentration,
        description: spell.description,
      }
    : undefined;
}

describe('SRD-1212: relevance integrity gate (data)', () => {
  it('every bundled spell resolves with an executable relevance path', () => {
    expect(defaultCompendium.spells.length).toBeGreaterThan(0);
    for (const spell of defaultCompendium.spells) {
      const info = getSpellRelevanceInfo(spell.id, spellLookup);
      expect(info.status).toBe('supported');
      expect(info.paths.length).toBeGreaterThan(0);
      expect(info.trackingTicket).toBeUndefined();
    }
    // No explicitly-tracked unsupported spells today: everything is executable.
    expect(Object.keys(TRACKED_UNSUPPORTED_SPELLS)).toEqual([]);
  });

  it('every canonical skill has a supported verb or an explicit tracking ticket', () => {
    expect([...SKILL_IDS]).toHaveLength(18);
    for (const skillId of SKILL_IDS) {
      const info = getSkillRelevanceInfo(skillId);
      if (info.status === 'supported') {
        expect(info.uses.length).toBeGreaterThan(0);
        expect(info.badge.length).toBeGreaterThan(0);
      } else {
        expect(info.trackingTicket).toBeDefined();
        expect(TRACKED_UNSUPPORTED_SKILLS[skillId]).toBe(info.trackingTicket);
      }
    }
  });

  it('every bundled language opens a gate or carries an explicit tracking ticket', () => {
    const known = defaultCompendium.languages.map((l) => l.id);
    expect(known.length).toBeGreaterThanOrEqual(16);
    for (const lang of defaultCompendium.languages) {
      const info = getLanguageRelevanceInfo(lang.id, known);
      if (info.status === 'supported') {
        expect(info.uses.length).toBeGreaterThan(0);
        expect(info.badge.length).toBeGreaterThan(0);
      } else {
        expect(info.trackingTicket).toBeDefined();
        expect(TRACKED_UNSUPPORTED_LANGUAGES[lang.id]).toBe(info.trackingTicket);
      }
    }
    expect(Object.keys(TRACKED_UNSUPPORTED_LANGUAGES)).toEqual([]);
  });

  it('unknown spell/skill/language ids are unsupported with the SRD-1212 ticket', () => {
    expect(getSpellRelevanceInfo('not-a-real-spell-xyz', spellLookup).status).toBe('unsupported');
    expect(getSpellRelevanceInfo('not-a-real-spell-xyz', spellLookup).trackingTicket).toBe(
      RELEVANCE_TRACKING_TICKET,
    );
    expect(getSkillRelevanceInfo('not-a-real-skill').trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
    expect(getLanguageRelevanceInfo('klingon', []).trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
  });

  it('validateRelevanceCoverage passes on the bundled dataset', () => {
    expect(validateRelevanceCoverage(BUNDLED_SRD_DATASET)).toEqual([]);
  });

  it('validateSrdDataset includes the relevance gate (bundled dataset stays green)', () => {
    const report = validateSrdDataset(BUNDLED_SRD_DATASET);
    expect(report.errors.filter((e) => e.category === 'relevance')).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('fails on a dangling offered spell ref (innate spell that does not resolve)', () => {
    const broken = cloneDataset();
    broken.races[0]!.traits[0]!.innateSpells = [
      { spellId: 'missing-offered-spell-xyz', ability: 'cha', minCharacterLevel: 1 },
    ];
    const errors = validateRelevanceCoverage(broken);
    expect(errors.some((e) => e.message.includes('missing-offered-spell-xyz'))).toBe(true);
    const report = validateSrdDataset(broken);
    expect(report.valid).toBe(false);
    expect(
      report.errors.some(
        (e) => e.category === 'relevance' && e.message.includes('missing-offered-spell-xyz'),
      ),
    ).toBe(true);
  });

  it('fails on a dangling subclass spell grant', () => {
    const broken = cloneDataset();
    const withGrants = broken.subclasses.find((s) => s.spells && s.spells.length > 0)!;
    withGrants.spells![0]!.spellIds.push('missing-grant-spell-xyz');
    const errors = validateRelevanceCoverage(broken);
    expect(errors.some((e) => e.message.includes('missing-grant-spell-xyz'))).toBe(true);
  });

  it('fails on a dangling monster spellcasting ref', () => {
    const broken = cloneDataset();
    broken.monsters[0]!.spellcasting = {
      ability: 'wis',
      spellSaveDc: 12,
      spellAttackBonus: 4,
      atWillSpellIds: ['missing-monster-spell-xyz'],
    };
    const errors = validateRelevanceCoverage(broken);
    expect(errors.some((e) => e.message.includes('missing-monster-spell-xyz'))).toBe(true);
  });

  it('fails on an offered skill choice that does not resolve to a canonical skill', () => {
    const broken = cloneDataset();
    broken.backgrounds[0]!.choices = [
      {
        id: 'bg-test-skills',
        label: 'Test skills',
        type: 'skill',
        from: { mode: 'explicit', options: ['not-a-skill-xyz'] },
        count: 1,
      },
    ];
    const errors = validateRelevanceCoverage(broken);
    expect(errors.some((e) => e.message.includes('not-a-skill-xyz'))).toBe(true);
  });

  it('fails on an offered language that does not resolve in proficiencies-and-languages', () => {
    const broken = cloneDataset();
    broken.backgrounds[0]!.choices = [
      {
        id: 'bg-test-langs',
        label: 'Test languages',
        type: 'language',
        from: { mode: 'explicit', options: ['klingon'] },
        count: 1,
      },
    ];
    const errors = validateRelevanceCoverage(broken);
    expect(errors.some((e) => e.message.includes('klingon'))).toBe(true);
  });

  it('collectOfferedSpellRefs covers innate, grant, and monster casting sources', () => {
    const refs = collectOfferedSpellRefs(BUNDLED_SRD_DATASET);
    // The bundled dataset offers spells through several sources; the gate
    // must see at least the subclass-grant and monster-casting channels.
    const collections = new Set(refs.map((r) => r.collection));
    expect(collections.has('subclasses') || collections.has('monsters')).toBe(true);
    for (const ref of refs) {
      expect(defaultCompendium.getSpell(ref.spellId)).toBeDefined();
    }
  });
});
