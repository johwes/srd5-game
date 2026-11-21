import { describe, expect, it } from 'vitest';
import {
  RELEVANCE_TRACKING_TICKET,
  SKILL_IDS,
  defaultCompendium,
  getLanguageRelevanceInfo,
  getSkillRelevanceInfo,
  getSpellRelevanceInfo,
} from '@srd5/data';
import {
  ENGINE_SKILL_CONSUMERS,
  assertEngineRelevanceGate,
  getEngineLanguageConsumers,
  getEngineSkillConsumers,
  validateEngineRelevance,
} from '../tabletop/relevance-gate.js';

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

describe('SRD-1212: relevance integrity gate (engine)', () => {
  it('every canonical skill maps to at least one engine verb', () => {
    expect(Object.keys(ENGINE_SKILL_CONSUMERS).sort()).toEqual([...SKILL_IDS].sort());
    for (const skillId of SKILL_IDS) {
      expect(getEngineSkillConsumers(skillId).length).toBeGreaterThan(0);
      const info = getSkillRelevanceInfo(skillId);
      expect(info.status).toBe('supported');
    }
  });

  it('every bundled language opens an engine-backed gate', () => {
    const known = defaultCompendium.languages.map((l) => l.id);
    expect(known.length).toBeGreaterThan(0);
    for (const lang of defaultCompendium.languages) {
      const info = getLanguageRelevanceInfo(lang.id, known);
      expect(info.status).toBe('supported');
      expect(getEngineLanguageConsumers(lang.id).length).toBeGreaterThan(0);
    }
  });

  it('every bundled spell has an executable engine path (or explicit ticket)', () => {
    expect(defaultCompendium.spells.length).toBeGreaterThan(0);
    for (const spell of defaultCompendium.spells) {
      const info = getSpellRelevanceInfo(spell.id, spellLookup);
      if (info.status === 'supported') {
        expect(info.paths.length).toBeGreaterThan(0);
      } else {
        expect(info.trackingTicket).toBe(RELEVANCE_TRACKING_TICKET);
      }
    }
  });

  it('validateEngineRelevance passes on the bundled dataset + draft parties', () => {
    expect(validateEngineRelevance()).toEqual([]);
  });

  it('assertEngineRelevanceGate does not throw on the bundled dataset', () => {
    expect(() => assertEngineRelevanceGate()).not.toThrow();
  });
});
