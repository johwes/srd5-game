import { describe, expect, it } from 'vitest';
import { BUNDLED_SRD_DATASET, type SpellData } from '@srd5/data';
import {
  ORC_GESTURE_TRADE_PENALTY_GOLD,
  ORC_TRIBE_GATE_SPEC,
  casterCanBeUnderstoodByTarget,
  getLanguageBarrierIntentCue,
  isTargetUnaffectedByLanguage,
  requiresSharedLanguage,
  resolveLanguageGate,
  resolveOrcTribeParley,
} from '../language/gates.js';
import { partyCanUnderstand } from '../language/comprehension.js';
import {
  createTurnBudget,
  executeSpellCast,
  startCombatEncounter,
  type Combatant,
  type CombatState,
} from '../combat/index.js';
import {
  completeSubFactionQuest,
  type WarDiplomacyState,
  type WarState,
} from '../overworld/index.js';
import { createWarDiplomacyState } from '../overworld/war-threat.js';
import { generateOverworldMap } from '../overworld/generator.js';
import { populateSettlements } from '../overworld/settlements.js';
import { initializeWarState } from '../overworld/war.js';

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
    encounterId: 'language-gate-test',
    combatants,
    rngState: 4242,
  });
  const active = combatants.find((c) => c.id === activeId) ?? combatants[0]!;
  return {
    ...started.state,
    activeCombatantId: active.id,
    activeCombatantIndex: started.state.initiativeOrder.findIndex((e) => e.entityId === active.id),
    turnBudget: createTurnBudget(active, false),
  };
}

describe('SRD-1202: generic language-gated encounters (§2.2)', () => {
  it('resolves the LanguageGateSpec against a conscious party', () => {
    const open = resolveLanguageGate(
      { requiredLanguage: 'orc', fallback: 'gesture' },
      [{ languages: ['common', 'orc'] }, { languages: ['elvish'] }],
    );
    expect(open.opened).toBe(true);
    expect(open.via).toBe('native');
    expect(open.fallback).toBeUndefined();

    const byMagic = resolveLanguageGate(
      { requiredLanguage: 'orc', fallback: 'fetch_translator' },
      [
        { languages: ['common'] },
        { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }] },
      ],
    );
    expect(byMagic.opened).toBe(true);
    expect(byMagic.via).toBe('magic');

    const closed = resolveLanguageGate(
      { requiredLanguage: 'orc', fallback: 'gesture' },
      [{ languages: ['common'] }, { languages: ['elvish'] }],
    );
    expect(closed.opened).toBe(false);
    expect(closed.via).toBe('none');
    expect(closed.fallback).toBe('gesture');
    expect(closed.intentCue.cues.length).toBeGreaterThan(0);
    // Never a soft-lock: gesture trade / bribe / stealth / combat remain.
    expect(closed.intentCue.alwaysAvailable).toContain('gesture_trade');
    expect(closed.intentCue.alwaysAvailable).toContain('combat');
  });

  it('maps each fallback to non-blocking intent cues', () => {
    expect(getLanguageBarrierIntentCue('gesture').alwaysAvailable).toContain('gesture_trade');
    expect(getLanguageBarrierIntentCue('hostile').alwaysAvailable).toContain('combat');
    expect(getLanguageBarrierIntentCue('hostile').attitude).toBe('unfriendly');
    expect(getLanguageBarrierIntentCue('fetch_translator').alwaysAvailable).toContain(
      'fetch_translator',
    );
  });

  it('rejects invalid gate specs without mutating the party', () => {
    expect(() =>
      resolveLanguageGate({ requiredLanguage: '', fallback: 'gesture' }, [{ languages: ['orc'] }]),
    ).toThrow();
    // Empty party simply closes the gate (party-level: nobody present).
    expect(
      resolveLanguageGate({ requiredLanguage: 'orc', fallback: 'hostile' }, []).opened,
    ).toBe(false);
  });
});

describe('SRD-1202: shared-language precondition on enchantments', () => {
  it('flags exactly the six SRD language-dependent enchantments', () => {
    for (const id of [
      'command',
      'suggestion',
      'charm-person',
      'hideous-laughter',
      'vicious-mockery',
      'divine-word',
    ]) {
      expect(requiresSharedLanguage(id)).toBe(true);
    }
    expect(requiresSharedLanguage('fireball')).toBe(false);
    expect(requiresSharedLanguage('cure-wounds')).toBe(false);
    expect(requiresSharedLanguage('COMMAND')).toBe(true);
  });

  it('requires a shared tongue, caster tongues, or target-side magic', () => {
    // Shared tongue.
    expect(
      casterCanBeUnderstoodByTarget({ languages: ['common', 'orc'] }, { languages: ['orc'] }),
    ).toBe(true);
    // No shared tongue.
    expect(casterCanBeUnderstoodByTarget({ languages: ['common'] }, { languages: ['orc'] })).toBe(
      false,
    );
    // Caster-side tongues speaks to anyone.
    expect(
      casterCanBeUnderstoodByTarget(
        { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }] },
        { languages: ['orc'] },
      ),
    ).toBe(true);
    // Target-side comprehension lets the listener follow the caster.
    expect(
      casterCanBeUnderstoodByTarget(
        { languages: ['common'] },
        { languages: ['orc'], activeEffects: [{ effectId: 'comprehend-languages-understanding' }] },
      ),
    ).toBe(true);
    // Asymmetry: caster-side comprehend-languages does NOT make the caster understood.
    expect(
      casterCanBeUnderstoodByTarget(
        { languages: ['common'], activeEffects: [{ effectId: 'comprehend-languages-understanding' }] },
        { languages: ['orc'] },
      ),
    ).toBe(false);
    // Unconscious listeners understand nothing.
    expect(
      casterCanBeUnderstoodByTarget(
        { languages: ['orc'] },
        { languages: ['orc'], conditions: ['unconscious'] },
      ),
    ).toBe(false);
  });

  it('isTargetUnaffectedByLanguage only gates the six enchantments', () => {
    expect(
      isTargetUnaffectedByLanguage('command', { languages: ['common'] }, { languages: ['orc'] }),
    ).toBe(true);
    expect(
      isTargetUnaffectedByLanguage('fireball', { languages: ['common'] }, { languages: ['orc'] }),
    ).toBe(false);
  });

  it('leaves vicious-mockery unaffected without a shared tongue (no save rolled)', () => {
    const caster = makeCombatant('bard', {
      position: { x: 2, y: 2 },
      characterSheet: {
        proficiencies: { languages: ['common'] },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    const target = makeCombatant('orc-brute', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 3, y: 2 },
      monsterData: {
        languages: ['orc'],
        abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 },
      } as unknown as NonNullable<Combatant['monsterData']>,
    });
    const state = makeState([caster, target], 'bard');
    const res = executeSpellCast({ state, casterId: 'bard', spell: srdSpell('vicious-mockery'), targetIds: ['orc-brute'] });
    expect(res.targetsUnaffectedByLanguage).toContain('orc-brute');
    expect(res.targetsFailedSave).not.toContain('orc-brute');
    expect(res.targetsSaved).not.toContain('orc-brute');
    expect(
      res.events.some(
        (e) => e.type === 'SPELL_TARGET_UNAFFECTED' && (e as { targetId: string }).targetId === 'orc-brute',
      ),
    ).toBe(true);
    // No save was rolled for the gated target.
    expect(
      res.events.filter(
        (e) => e.type === 'SAVING_THROW_RESOLVED' && (e as { entityId: string }).entityId === 'orc-brute',
      ),
    ).toHaveLength(0);
  });

  it('resolves vicious-mockery normally with a shared tongue', () => {
    const caster = makeCombatant('bard', {
      position: { x: 2, y: 2 },
      characterSheet: {
        proficiencies: { languages: ['common', 'orc'] },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    const target = makeCombatant('orc-brute', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 3, y: 2 },
      monsterData: {
        languages: ['orc'],
        abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 },
      } as unknown as NonNullable<Combatant['monsterData']>,
    });
    const state = makeState([caster, target], 'bard');
    const res = executeSpellCast({ state, casterId: 'bard', spell: srdSpell('vicious-mockery'), targetIds: ['orc-brute'] });
    expect(res.targetsUnaffectedByLanguage ?? []).toHaveLength(0);
    expect(
      res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED'),
    ).toBe(true);
  });
});

describe('SRD-1202: Orc-tribe reference quest parley (§2.3)', () => {
  it('opens full negotiation for a native Orcish speaker', () => {
    const res = resolveOrcTribeParley({
      party: [{ languages: ['common', 'orc'] }],
      historyCheckPassed: true,
    });
    expect(res.mode).toBe('full');
    expect(res.via).toBe('native');
    expect(res.fullNegotiation).toBe(true);
    expect(res.historyUnlocked).toBe(true);
    expect(res.tradePenaltyGold).toBe(0);
    expect(res.tributeGold).toBe(100);
    expect(res.allowedSkills).toEqual(expect.arrayContaining(['persuasion', 'intimidation']));
  });

  it('opens full negotiation via comprehension magic (baseline, no penalty)', () => {
    const res = resolveOrcTribeParley({
      party: [
        { languages: ['common'] },
        { languages: ['common'], activeEffects: [{ effectId: 'tongues-understanding' }] },
      ],
    });
    expect(res.mode).toBe('full');
    expect(res.via).toBe('magic');
    expect(res.tradePenaltyGold).toBe(0);
    // Without a passed History check there is no leverage — but no block either.
    expect(res.historyUnlocked).toBe(false);
  });

  it('falls back to gesture with trade penalty and skill alternatives', () => {
    const res = resolveOrcTribeParley({ party: [{ languages: ['common', 'elvish'] }] });
    expect(res.mode).toBe('gesture');
    expect(res.via).toBe('none');
    expect(res.fullNegotiation).toBe(false);
    expect(res.historyUnlocked).toBe(false);
    expect(res.tradePenaltyGold).toBe(ORC_GESTURE_TRADE_PENALTY_GOLD);
    expect(res.tributeGold).toBe(100 + ORC_GESTURE_TRADE_PENALTY_GOLD);
    expect(res.allowedSkills).toEqual(expect.arrayContaining(['persuasion', 'intimidation']));
    expect(res.intentCue.alwaysAvailable).toContain('gesture_trade');
    expect(res.intentCue.alwaysAvailable).toContain('combat');
  });

  it('uses the orc gate spec with the gesture fallback', () => {
    expect(ORC_TRIBE_GATE_SPEC).toEqual({ requiredLanguage: 'orc', fallback: 'gesture' });
    expect(partyCanUnderstand('orc', [{ languages: ['orc'] }]).understood).toBe(true);
  });

  it('plays the Orc chain end-to-end with and without Orcish (never blocked)', () => {
    const foundedRealm = () => {
      const generated = generateOverworldMap({ seed: 11, width: 48, height: 48 });
      return populateSettlements(generated.map, generated.settlementSites).map;
    };
    const foundedWarResult = initializeWarState(foundedRealm(), { seed: 11 });
    const foundedWar = foundedWarResult.war;
    const playerTarget = Object.values(foundedWar.nations).find((n) => !n.isPlayerNation)!;
    const runChain = (party: Array<{ languages: string[] }>) => {
      let diplomacy: WarDiplomacyState = createWarDiplomacyState();
      let currentWar: WarState = foundedWar;
      // The gate grades the parley; the chain itself always advances.
      const parley = resolveOrcTribeParley({ party });
      const chain = ['orc-raid-relief', 'orc-warchief-parley', 'orc-war-path'] as const;
      let last = '';
      for (const questId of chain) {
        const step = completeSubFactionQuest({
          diplomacy,
          war: currentWar,
          subfactionId: 'local_orc_tribe',
          questId,
          targetNationId: playerTarget.id,
        });
        diplomacy = step.diplomacy;
        currentWar = step.war;
        last = step.headline;
      }
      return { parley, allied: diplomacy.subfactions['local_orc_tribe']?.allied, last, drains: currentWar.guerrillaDrains.length };
    };

    const withOrcish = runChain([{ languages: ['common', 'orc'] }]);
    expect(withOrcish.parley.mode).toBe('full');
    expect(withOrcish.allied).toBe(true);
    expect(withOrcish.drains).toBe(1);

    const gesture = runChain([{ languages: ['common'] }]);
    expect(gesture.parley.mode).toBe('gesture');
    expect(gesture.allied).toBe(true);
    expect(gesture.drains).toBe(1);
    expect(gesture.last).toContain('blood-oath');
  });
});
