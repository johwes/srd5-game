import { describe, expect, it } from 'vitest';
import {
  RELEVANCE_TRACKING_TICKET,
  SKILL_IDS,
  defaultCompendium,
  getLanguageRelevanceInfo as getDataLanguageInfo,
  getSkillRelevanceInfo as getDataSkillInfo,
  getSpellRelevanceInfo as getDataSpellInfo,
} from '@srd5/data';
import {
  getLanguageMechanicalInfo,
  getSkillMechanicalInfo,
  getSpellMechanicalInfo,
} from '../components/builder/relevance.js';

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

/**
 * SRD-1212: client badges must agree with the canonical `@srd5/data`
 * relevance registry. The data/transport integrity gate fails on new
 * dangling offered content; this parity suite fails on UI/registry drift
 * (a badge claiming support the gate denies, or vice versa).
 */
describe('SRD-1212: builder badge / registry parity (client)', () => {
  it('every bundled language badge matches the canonical registry', () => {
    const known = defaultCompendium.languages.map((l) => l.id);
    for (const lang of defaultCompendium.languages) {
      const ui = getLanguageMechanicalInfo(lang.id);
      const data = getDataLanguageInfo(lang.id, known);
      expect(ui.status).toBe(data.status);
      expect(ui.badge).toBe(data.badge);
      expect(ui.uses).toEqual(data.uses);
      expect(ui.trackingTicket).toBe(data.trackingTicket);
    }
  });

  it('every canonical skill badge matches the canonical registry', () => {
    for (const skillId of SKILL_IDS) {
      const ui = getSkillMechanicalInfo(skillId);
      const data = getDataSkillInfo(skillId);
      expect(ui.status).toBe(data.status);
      expect(ui.badge).toBe(data.badge);
      expect(ui.uses).toEqual(data.uses);
      expect(ui.trackingTicket).toBe(data.trackingTicket);
    }
  });

  it('every bundled spell badge matches the canonical registry', () => {
    for (const spell of defaultCompendium.spells) {
      const ui = getSpellMechanicalInfo(spell.id);
      const data = getDataSpellInfo(spell.id, spellLookup);
      expect(ui.status).toBe(data.status);
      expect(ui.paths).toEqual(data.paths);
      expect(ui.badge).toBe(data.badge);
      expect(ui.trackingTicket).toBe(data.trackingTicket);
    }
  });

  it('unknown ids are unsupported with the SRD-1212 ticket on both sides', () => {
    expect(getLanguageMechanicalInfo('klingon').trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
    expect(getDataLanguageInfo('klingon', []).trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
    expect(getSkillMechanicalInfo('not-a-skill').trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
    expect(getDataSkillInfo('not-a-skill').trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
    expect(getSpellMechanicalInfo('not-a-real-spell-xyz').trackingTicket).toBe(
      RELEVANCE_TRACKING_TICKET,
    );
    expect(getDataSpellInfo('not-a-real-spell-xyz', spellLookup).trackingTicket).toBe(
      RELEVANCE_TRACKING_TICKET,
    );
  });
});
