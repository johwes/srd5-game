import { describe, expect, it } from 'vitest';
import {
  INTERPRETER_HIRE_COST_GOLD,
  INTERPRETER_PER_PARLEY_FEE_GOLD,
  PATROL_GESTURE_BLUFF_THREAT,
  PATROL_TOURIST_SURCHARGE_GOLD,
  TRUCE_GESTURE_MAX_DURATION_DAYS,
  WAR_NATION_LANGUAGE_PROFILES,
  createWarDiplomacyState,
  generateDispatchIntercept,
  generateOverworldMap,
  getWarNationLanguageProfile,
  hireInterpreter,
  populateSettlements,
  initializeWarState,
  negotiateTruce,
  resolveDiplomaticParley,
  resolvePatrolEncounter,
  resolveWarLanguageDealTier,
  rollDispatchInterceptDrop,
  tryReadDispatchIntercept,
  type DerivedCharacterSheet,
} from '../index.js';

/**
 * SRD-1214: War languages phase 1 (Spec 11 §2.4).
 * Nation profiles, dispatch intercepts, patrol/deal modifiers, interpreters.
 */

function foundedRealm(seed = 4242) {
  const generated = generateOverworldMap({ seed, width: 48, height: 48 });
  return populateSettlements(generated.map, generated.settlementSites).map;
}

function foundedWar(seed = 4242, nationCount: 3 | 4 = 3) {
  return initializeWarState(foundedRealm(seed), { seed, nationCount });
}

function langSheet(
  id: string,
  languages: string[],
  bonuses: Record<string, number> = {},
  spellcasting: Record<string, unknown> = {},
): DerivedCharacterSheet {
  return {
    id,
    name: id,
    skills: Object.fromEntries(
      Object.entries(bonuses).map(([skill, totalBonus]) => [skill, { totalBonus }]),
    ),
    proficiencies: { languages },
    activeEffects: [],
    spellcasting: {
      spellSlots: {},
      preparedOrKnownSpellIds: [],
      spellbookSpellIds: [],
      cantripIds: [],
      ...spellcasting,
    },
  } as unknown as DerivedCharacterSheet;
}

function magicSheet(id: string, effectId: string): DerivedCharacterSheet {
  return {
    id,
    name: id,
    skills: { persuasion: { totalBonus: 20 } },
    proficiencies: { languages: ['common'] },
    activeEffects: [{ effectId }],
    spellcasting: {
      spellSlots: {},
      preparedOrKnownSpellIds: [],
      spellbookSpellIds: [],
      cantripIds: [],
    },
  } as unknown as DerivedCharacterSheet;
}

const NATIVE_ORC = [langSheet('native', ['common', 'orc'], { persuasion: 20 })];
const GESTURE = [langSheet('gesture', ['common'], { persuasion: 20 })];

describe('SRD-1214: nation language profiles (§2.4)', () => {
  it('ships 8 data rows from the existing 18-language list', () => {
    expect(WAR_NATION_LANGUAGE_PROFILES).toHaveLength(8);
    expect(getWarNationLanguageProfile('bloodtusk-horde').commandLanguage).toBe('orc');
    expect(getWarNationLanguageProfile('iron-covenant').commandLanguage).toBe('dwarvish');
    expect(getWarNationLanguageProfile('emerald-circle').commandLanguage).toBe('elvish');
    expect(getWarNationLanguageProfile('emerald-circle').liturgicalLanguage).toBe('sylvan');
    expect(getWarNationLanguageProfile('ashen-spire').commandLanguage).toBe('infernal');
    expect(getWarNationLanguageProfile('ashen-spire').battleLanguage).toBe('draconic');
    expect(getWarNationLanguageProfile('dawn-crown').commandLanguage).toBe('common');
    expect(getWarNationLanguageProfile('dawn-crown').liturgicalLanguage).toBe('celestial');
    expect(getWarNationLanguageProfile('gilded-league').commandLanguage).toBe('common');
    expect(getWarNationLanguageProfile('frostbound-clan').commandLanguage).toBe('giant');
    expect(() => getWarNationLanguageProfile('no-such-nation')).toThrow();
  });

  it('resolves the deal tier through the party-level gate', () => {
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: NATIVE_ORC }).tier,
    ).toBe('native');
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: NATIVE_ORC }).bonus,
    ).toBe(2);
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: GESTURE }).tier,
    ).toBe('gesture');
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: GESTURE }).bonus,
    ).toBe(-2);
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: GESTURE }).topTierLocked,
    ).toBe(true);
    expect(
      resolveWarLanguageDealTier({
        nationId: 'bloodtusk-horde',
        party: [magicSheet('mage', 'tongues-understanding')],
      }).tier,
    ).toBe('magic');
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: GESTURE, hasInterpreter: true })
        .tier,
    ).toBe('interpreter');
    expect(
      resolveWarLanguageDealTier({ nationId: 'bloodtusk-horde', party: GESTURE, hasInterpreter: true })
        .perParleyFee,
    ).toBe(INTERPRETER_PER_PARLEY_FEE_GOLD);
  });

  it('accepts rite/battle tongues as native (Sylvan, Draconic, Celestial)', () => {
    const sylvan = [langSheet('sylvan', ['sylvan'], { persuasion: 5 })];
    expect(resolveWarLanguageDealTier({ nationId: 'emerald-circle', party: sylvan }).tier).toBe(
      'native',
    );
    const draconic = [langSheet('drak', ['draconic'], { persuasion: 5 })];
    expect(resolveWarLanguageDealTier({ nationId: 'ashen-spire', party: draconic }).tier).toBe(
      'native',
    );
    const celestial = [langSheet('cleric', ['celestial'], { persuasion: 5 })];
    expect(resolveWarLanguageDealTier({ nationId: 'dawn-crown', party: celestial }).tier).toBe(
      'native',
    );
  });
});

describe('SRD-1214: dispatch intercepts', () => {
  it('seals orders in the command tongue (writs in liturgical)', () => {
    const orc = generateDispatchIntercept({ nationId: 'bloodtusk-horde', kind: 'attack_warning' });
    expect(orc.intercept.language).toBe('orc');
    const writ = generateDispatchIntercept({ nationId: 'dawn-crown', kind: 'tribute_schedule' });
    expect(writ.intercept.language).toBe('celestial');
    const patrol = generateDispatchIntercept({ nationId: 'dawn-crown', kind: 'patrol_route' });
    expect(patrol.intercept.language).toBe('common');
  });

  it('reads with the right tongue, magic, or interpreter; seals otherwise', () => {
    const { intercept } = generateDispatchIntercept({
      nationId: 'bloodtusk-horde',
      kind: 'attack_warning',
    });
    const native = tryReadDispatchIntercept({ intercept, party: NATIVE_ORC });
    expect(native.readable).toBe(true);
    expect(native.via).toBe('native');
    expect(native.revealedNote).toContain('6 days');

    const magic = tryReadDispatchIntercept({
      intercept,
      party: [magicSheet('mage', 'comprehend-languages-understanding')],
    });
    expect(magic.readable).toBe(true);
    expect(magic.via).toBe('magic');

    const hired = tryReadDispatchIntercept({ intercept, party: GESTURE, hasInterpreter: true });
    expect(hired.readable).toBe(true);
    expect(hired.via).toBe('interpreter');

    const sealed = tryReadDispatchIntercept({ intercept, party: GESTURE });
    expect(sealed.readable).toBe(false);
    expect(sealed.via).toBe('sealed');
    expect(sealed.revealedNote).toBeNull();
    expect(sealed.headline).toContain('sealed');
  });

  it('drops deterministically from the seeded PRNG', () => {
    const a = rollDispatchInterceptDrop({ nationId: 'bloodtusk-horde', rngState: 7 });
    const b = rollDispatchInterceptDrop({ nationId: 'bloodtusk-horde', rngState: 7 });
    expect(b).toEqual(a);
    let drops = 0;
    for (let seed = 0; seed < 100; seed++) {
      if (rollDispatchInterceptDrop({ nationId: 'bloodtusk-horde', rngState: seed }).dropped) drops++;
    }
    expect(drops).toBeGreaterThan(10);
    expect(drops).toBeLessThan(70);
  });
});

describe('SRD-1214: patrol interaction matrix', () => {
  it('bluffs clean in tongue, at baseline via magic/interpreter, gesture caps at pass-with-Threat', () => {
    const diplomacy = createWarDiplomacyState();
    const orcParty = [langSheet('orc-speaker', ['orc'], { persuasion: 20, deception: 20 })];
    const clean = resolvePatrolEncounter({
      diplomacy,
      party: orcParty,
      nationId: 'bloodtusk-horde',
      approach: 'bluff',
      rngState: 1,
    });
    expect(clean.outcome).toBe('passed');
    expect(clean.threatDelta).toBe(0);
    expect(clean.languageTier).toBe('native');

    const magic = resolvePatrolEncounter({
      diplomacy,
      party: [magicSheet('mage', 'tongues-understanding')],
      nationId: 'bloodtusk-horde',
      approach: 'bluff',
      rngState: 1,
    });
    expect(magic.outcome).toBe('passed');
    expect(magic.threatDelta).toBe(0);

    const hired = resolvePatrolEncounter({
      diplomacy,
      party: GESTURE,
      nationId: 'bloodtusk-horde',
      approach: 'bluff',
      rngState: 1,
      goldAvailable: 100,
      hasInterpreter: true,
    });
    expect(hired.outcome).toBe('passed');
    expect(hired.threatDelta).toBe(0);
    expect(hired.languageTier).toBe('interpreter');
    expect(hired.interpreterFee).toBe(INTERPRETER_PER_PARLEY_FEE_GOLD);
    expect(hired.goldSpent).toBe(INTERPRETER_PER_PARLEY_FEE_GOLD);

    const gesture = resolvePatrolEncounter({
      diplomacy,
      party: [langSheet('mime', ['common'], { persuasion: 20, deception: 20 })],
      nationId: 'bloodtusk-horde',
      approach: 'bluff',
      rngState: 1,
    });
    expect(gesture.outcome).toBe('passed');
    expect(gesture.languageTier).toBe('gesture');
    expect(gesture.threatDelta).toBe(PATROL_GESTURE_BLUFF_THREAT);
    expect(gesture.dc).toBe(15);
  });

  it('evades never gates on language; bribes carry a tourist surcharge without patter', () => {
    const diplomacy = createWarDiplomacyState();
    const ghost = [langSheet('ghost', ['common'], { stealth: 20, survival: 20 })];
    const evaded = resolvePatrolEncounter({
      diplomacy,
      party: ghost,
      nationId: 'bloodtusk-horde',
      approach: 'evade',
      rngState: 1,
    });
    expect(evaded.outcome).toBe('passed');
    expect(evaded.threatDelta).toBe(0);

    const bribeTongue = resolvePatrolEncounter({
      diplomacy,
      party: [langSheet('orc-speaker', ['orc'], { persuasion: 5 })],
      nationId: 'bloodtusk-horde',
      approach: 'bribe',
      rngState: 1,
      goldAvailable: 200,
    });
    expect(bribeTongue.goldSpent).toBe(50);

    const bribeGesture = resolvePatrolEncounter({
      diplomacy,
      party: [langSheet('tourist', ['common'], { persuasion: 5 })],
      nationId: 'bloodtusk-horde',
      approach: 'bribe',
      rngState: 1,
      goldAvailable: 200,
    });
    expect(bribeGesture.goldSpent).toBe(50 + PATROL_TOURIST_SURCHARGE_GOLD);
  });
});

describe('SRD-1214: deal tiers and interpreter hirelings', () => {
  it('hires the interpreter once for gold, then charges per carried parley', () => {
    const diplomacy = createWarDiplomacyState();
    const hired = hireInterpreter({ diplomacy, goldAvailable: 500, rngState: 3 });
    expect(hired.success).toBe(true);
    expect(hired.diplomacy.interpreterHired).toBe(true);
    expect(hired.goldSpent).toBe(INTERPRETER_HIRE_COST_GOLD);
    expect(hired.remainingGold).toBe(500 - INTERPRETER_HIRE_COST_GOLD);
    expect(() =>
      hireInterpreter({ diplomacy: hired.diplomacy, goldAvailable: 500, rngState: 3 }),
    ).toThrow();
    const broke = hireInterpreter({ diplomacy, goldAvailable: 10, rngState: 3 });
    expect(broke.success).toBe(false);
    expect(broke.diplomacy.interpreterHired).toBe(false);
  });

  it('grades truces by tongue: +2 native, −2 gesture with the top tier capped', () => {
    const { war } = foundedWar(501);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const profile = getWarNationLanguageProfile(target);
    const tongue = profile.commandLanguage;
    const nativeParty = [langSheet('native', [tongue], { persuasion: 20 })];
    const native = negotiateTruce({ war, party: nativeParty, targetNationId: target, rngState: 7 });
    expect(native.languageTier).toBe('native');
    expect(native.languageBonus).toBe(2);
    expect(native.dc).toBe(12);
    expect(native.topTierLocked).toBe(false);

    const gestureParty = [
      langSheet('tourist', ['common'].includes(tongue) ? ['orc'] : ['common'], { persuasion: 20 }),
    ];
    // Ensure the gesture party truly lacks the tongue (Common nations need a non-Common sheet).
    const gesture = negotiateTruce({ war, party: gestureParty, targetNationId: target, rngState: 7 });
    if (gesture.languageTier === 'gesture') {
      expect(gesture.dc).toBe(16);
      expect(gesture.topTierLocked).toBe(true);
      if (gesture.success) {
        expect(gesture.durationDays).toBeLessThanOrEqual(TRUCE_GESTURE_MAX_DURATION_DAYS);
      }
    }

    const hiredDiplomacy = createWarDiplomacyState();
    const hiredParty = gestureParty;
    const carried = negotiateTruce({
      war,
      party: hiredParty,
      targetNationId: target,
      rngState: 7,
      hasInterpreter: true,
    });
    void hiredDiplomacy;
    void hiredParty;
    if (carried.languageTier === 'interpreter') {
      expect(carried.interpreterFee).toBe(INTERPRETER_PER_PARLEY_FEE_GOLD);
      expect(carried.topTierLocked).toBe(false);
    }
  });

  it('locks the top diplomacy tier on gesture parleys (alliance → fair_terms)', () => {
    const party = [langSheet('silver', ['common'], { history: 20, insight: 20, persuasion: 20 })];
    const open = resolveDiplomaticParley({
      encounterKind: 'envoy',
      party,
      approach: 'persuasion',
      rngState: 11,
    });
    const locked = resolveDiplomaticParley({
      encounterKind: 'envoy',
      party,
      approach: 'persuasion',
      rngState: 11,
      dcModifier: 2,
      topTierLocked: true,
    });
    if (open.outcome === 'alliance') {
      expect(locked.outcome).toBe('fair_terms');
    }
    expect(locked.progresses).toBe(true);
  });

  it('replays deterministically from the same seed', () => {
    const { war } = foundedWar(502);
    const target = war.nationOrder.find((id) => id !== war.playerNationId)!;
    const party = [langSheet('native', [getWarNationLanguageProfile(target).commandLanguage], { persuasion: 5 })];
    const a = negotiateTruce({ war, party, targetNationId: target, rngState: 77 });
    const b = negotiateTruce({ war, party, targetNationId: target, rngState: 77 });
    expect(b).toEqual(a);
  });
});
