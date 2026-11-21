import { describe, expect, it } from 'vitest';
import { BUNDLED_SRD_DATASET, type SpellData } from '@srd5/data';
import {
  COMPREHENSION_BUFF_IDS,
  bearerCanUnderstand,
  combatPartyCanUnderstand,
  combatantCanUnderstand,
  combatantLanguages,
  hasComprehensionMagic,
  partyCanUnderstand,
} from '../language/comprehension.js';
import {
  createTurnBudget,
  executeSpellCast,
  startCombatEncounter,
  type Combatant,
  type CombatState,
} from '../combat/index.js';
import { generateDraftHero, generateDraftParty } from '../remix/draft-party.js';

function srdSpell(id: string): SpellData {
  const spell = BUNDLED_SRD_DATASET.spells.find((s) => s.id === id);
  if (!spell) throw new Error(`Bundled spell "${id}" not found`);
  return spell;
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id,
    name: id,
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x: 2, y: 2 },
    speedFeet: 30,
    currentHp: 40,
    maxHp: 40,
    tempHp: 0,
    armorClass: 12,
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
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    ...overrides,
  } as Combatant;
}

function makeState(combatants: Combatant[], activeId = combatants[0]!.id): CombatState {
  const started = startCombatEncounter({
    encounterId: 'comprehension-test',
    combatants,
    rngState: 1234,
  });
  const active = combatants.find((c) => c.id === activeId) ?? combatants[0]!;
  return {
    ...started.state,
    activeCombatantId: active.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === active.id),
    turnBudget: createTurnBudget(active, false),
  };
}

describe('SRD-1201: comprehend-languages + tongues headless casting', () => {
  it('casts comprehend-languages on self via the bless attach path', () => {
    const caster = makeCombatant('caster', {
      spellSlots: { '1': { max: 4, expended: 0, available: 4 } },
    });
    const state = makeState([caster]);
    const res = executeSpellCast({ state, casterId: 'caster', spell: srdSpell('comprehend-languages') });
    const updated = res.state.combatants['caster']!;
    const buff = updated.activeEffects?.find((e) => e.effectId === 'comprehend-languages-understanding');
    expect(buff).toBeDefined();
    expect(buff?.remainingRounds).toBe(600);
    expect(buff?.requiresConcentration).toBe(false);
    // Not a concentration spell: caster concentration stays clear.
    expect(updated.concentratingOn).toBeUndefined();
    expect(res.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);
  });

  it('casts tongues on a willing creature within touch range', () => {
    const caster = makeCombatant('caster', {
      position: { x: 2, y: 2 },
      spellSlots: { '3': { max: 4, expended: 0, available: 4 } },
    });
    const ally = makeCombatant('ally', { position: { x: 3, y: 2 } });
    const state = makeState([caster, ally]);
    const res = executeSpellCast({
      state,
      casterId: 'caster',
      spell: srdSpell('tongues'),
      targetIds: ['ally'],
    });
    const updatedAlly = res.state.combatants['ally']!;
    const buff = updatedAlly.activeEffects?.find((e) => e.effectId === 'tongues-understanding');
    expect(buff).toBeDefined();
    expect(buff?.remainingRounds).toBe(600);
    expect(res.state.combatants['caster']!.concentratingOn).toBeUndefined();
  });

  it('exposes both buff ids as comprehension magic', () => {
    expect([...COMPREHENSION_BUFF_IDS].sort()).toEqual(
      ['comprehend-languages-understanding', 'tongues-understanding'].sort(),
    );
    expect(hasComprehensionMagic({ activeEffects: [{ effectId: 'comprehend-languages-understanding' }] })).toBe(true);
    expect(hasComprehensionMagic({ activeEffects: [{ effectId: 'tongues-understanding' }] })).toBe(true);
    expect(hasComprehensionMagic({ activeEffects: [{ effectId: 'bless-buff' }] })).toBe(false);
    expect(hasComprehensionMagic({})).toBe(false);
  });
});

describe('SRD-1201: party-level language gate foundation (§2.2)', () => {
  it('opens for a native speaker and prefers the native path over magic', () => {
    const party = [
      { languages: ['common', 'orc'] },
      { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }] },
    ];
    const res = partyCanUnderstand('orc', party);
    expect(res).toEqual({ understood: true, via: 'native', understoodByIndex: 0 });
    // Case-insensitive match.
    expect(partyCanUnderstand('ORC', party).understood).toBe(true);
  });

  it('opens via comprehension magic when nobody speaks the tongue', () => {
    const party = [
      { languages: ['common', 'elvish'] },
      { languages: ['common'], activeEffects: [{ effectId: 'comprehend-languages-understanding' }] },
    ];
    expect(partyCanUnderstand('orc', party)).toEqual({
      understood: true,
      via: 'magic',
      understoodByIndex: 1,
    });
  });

  it('stays closed without a speaker or magic (gesture/hostile/translator fallback)', () => {
    const party = [{ languages: ['common'] }, { languages: ['elvish'] }];
    expect(partyCanUnderstand('orc', party)).toEqual({
      understood: false,
      via: 'none',
      understoodByIndex: -1,
    });
    expect(partyCanUnderstand('', party).understood).toBe(false);
  });

  it('ignores unconscious, dead, and zero-HP bearers', () => {
    expect(bearerCanUnderstand({ languages: ['orc'], currentHp: 0 }, 'orc')).toBe(false);
    expect(bearerCanUnderstand({ languages: ['orc'], isDead: true }, 'orc')).toBe(false);
    expect(bearerCanUnderstand({ languages: ['orc'], conditions: ['unconscious'] }, 'orc')).toBe(false);
    expect(
      bearerCanUnderstand(
        { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }], conditions: ['unconscious'] },
        'orc',
      ),
    ).toBe(false);
    // Conscious magic bearer still opens the gate.
    expect(
      bearerCanUnderstand(
        { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }], currentHp: 5 },
        'orc',
      ),
    ).toBe(true);
  });

  it('resolves combatant sheets and monster statblocks through the gate', () => {
    const hero = makeCombatant('hero', {
      characterSheet: {
        proficiencies: { languages: ['common', 'orc'] },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    expect(combatantLanguages(hero)).toContain('orc');
    expect(combatantCanUnderstand(hero, 'orc')).toBe(true);

    const brute = makeCombatant('brute', {
      side: 'monster',
      monsterData: { languages: ['giant'] } as unknown as NonNullable<Combatant['monsterData']>,
    });
    expect(combatPartyCanUnderstand('orc', [brute]).understood).toBe(false);
    expect(combatPartyCanUnderstand('orc', [brute, hero]).via).toBe('native');

    const buffedCommoner = makeCombatant('commoner', {
      activeEffects: [
        {
          effectId: 'comprehend-languages-understanding',
          name: 'Comprehend Languages',
          sourceEntityId: 'caster',
          requiresConcentration: false,
          remainingRounds: 600,
          modifiers: [],
        },
      ],
    });
    expect(combatPartyCanUnderstand('orc', [buffedCommoner])).toEqual({
      understood: true,
      via: 'magic',
      understoodByIndex: 0,
    });
  });
});

describe('SRD-1201: dangling draft-party comprehend-languages reference', () => {
  it('resolves every wizard spellbook id in the compendium', () => {
    const { hero } = generateDraftHero({ seed: 7, classId: 'wizard' });
    expect(hero.spellcasting?.spellbookSpellIds).toContain('comprehend-languages');
    expect(hero.spellcasting?.spellbookSpellIds).toContain('detect-magic');
    for (const id of hero.spellcasting?.spellbookSpellIds ?? []) {
      expect(() => srdSpell(id)).not.toThrow();
    }
  });

  it('contains no dangling comprehend-languages reference across full draft parties', () => {
    const party = generateDraftParty({ seed: 99, partySize: 4 });
    expect(party).toHaveLength(4);
    for (const hero of party) {
      const ids = [
        ...(hero.spellcasting?.knownCantripIds ?? []),
        ...(hero.spellcasting?.knownSpellIds ?? []),
        ...(hero.spellcasting?.preparedSpellIds ?? []),
        ...(hero.spellcasting?.spellbookSpellIds ?? []),
      ];
      // SRD-1201 scope: the comprehend-languages id must resolve (other
      // pre-existing template ids such as hex/arms-of-hadar track separately).
      for (const id of ids) {
        if (id === 'comprehend-languages' || id === 'detect-magic') {
          expect(BUNDLED_SRD_DATASET.spells.some((s) => s.id === id)).toBe(true);
        }
      }
    }
  });
});
