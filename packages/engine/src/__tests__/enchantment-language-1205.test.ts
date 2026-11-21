import { describe, expect, it } from 'vitest';
import { BUNDLED_SRD_DATASET, type SpellData } from '@srd5/data';
import {
  executeSpellCast,
  type Combatant,
  type CombatState,
} from '../combat/index.js';
import { createTacticalGrid } from '../grid/model.js';

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

function makeState(combatants: Combatant[], rngState = 4242): CombatState {
  const map: Record<string, Combatant> = {};
  for (const c of combatants) map[c.id] = c;
  return {
    encounterId: 'enchantment-language-1205',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: combatants.map((c) => ({
      entityId: c.id,
      initiative: 10,
      naturalRoll: 10,
      dexterityScore: 14,
      tieBreaker: 0,
    })),
    activeCombatantIndex: 0,
    activeCombatantId: combatants[0]!.id,
    turnBudget: null,
    combatants: map,
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState,
  };
}

/** Level-1/2 caster speaking only Common (DC 13), adjacent to the target. */
function commonCaster(id = 'bard', position = { x: 2, y: 2 }): Combatant {
  return makeCombatant(id, {
    position,
    spellSlots: {
      '1': { max: 2, expended: 0, available: 2 },
      '2': { max: 2, expended: 0, available: 2 },
    },
    characterSheet: {
      proficiencies: { languages: ['common'] },
      spellcasting: {
        primarySpellSaveDc: 13,
        primarySpellAttackBonus: 5,
        primaryAbility: 'cha',
      },
    } as unknown as NonNullable<Combatant['characterSheet']>,
  });
}

/** Orc-only monster adjacent to the caster. */
function orcTarget(id = 'orc-brute', position = { x: 3, y: 2 }): Combatant {
  return makeCombatant(id, {
    side: 'monster',
    teamId: 'monsters',
    position,
    monsterData: {
      languages: ['orc'],
      abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 },
    } as unknown as NonNullable<Combatant['monsterData']>,
  });
}

function savesFor(events: { type: string; entityId?: string }[], entityId: string): number {
  return events.filter((e) => e.type === 'SAVING_THROW_RESOLVED' && e.entityId === entityId).length;
}

describe('SRD-1205: shared-language preconditions on single-target enchantments', () => {
  const cases = [
    { spellId: 'suggestion', slot: 2 },
    { spellId: 'charm-person', slot: 1 },
    { spellId: 'hideous-laughter', slot: 1 },
  ] as const;
  for (const { spellId, slot } of cases) {
    it(`${spellId} leaves a non-understanding target unaffected (no save, slot spent)`, () => {
      const caster = commonCaster();
      const target = orcTarget();
      const state = makeState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: 'bard',
        spell: srdSpell(spellId),
        slotLevel: slot,
        targetIds: ['orc-brute'],
      });
      expect(res.targetsUnaffectedByLanguage).toContain('orc-brute');
      expect(savesFor(res.events as never, 'orc-brute')).toBe(0);
      expect(
        res.events.some(
          (e) => e.type === 'SPELL_TARGET_UNAFFECTED' && (e as { targetId: string }).targetId === 'orc-brute',
        ),
      ).toBe(true);
      // The slot is still expended even though the target is unaffected.
      expect(
        res.events.some(
          (e) => e.type === 'SPELL_CAST' && (e as { slotExpended?: number }).slotExpended === slot,
        ),
      ).toBe(true);
      expect(res.state.combatants['bard']!.spellSlots![String(slot)]!.available).toBe(1);
      // No condition leaked onto the gated target.
      expect(res.state.combatants['orc-brute']!.conditions).toHaveLength(0);
    });

    it(`${spellId} resolves normally with a shared tongue`, () => {
      const caster = commonCaster();
      (caster.characterSheet as unknown as { proficiencies: { languages: string[] } }).proficiencies =
        { languages: ['common', 'orc'] };
      const target = orcTarget();
      const state = makeState([caster, target]);
      const res = executeSpellCast({
        state,
        casterId: 'bard',
        spell: srdSpell(spellId),
        slotLevel: slot,
        targetIds: ['orc-brute'],
      });
      expect(res.targetsUnaffectedByLanguage ?? []).toHaveLength(0);
      expect(savesFor(res.events as never, 'orc-brute')).toBe(1);
    });
  }
});

describe('SRD-1205: divine-word AOE filters per-target by shared language', () => {
  function divineWordState(): { state: CombatState; grid: ReturnType<typeof createTacticalGrid> } {
    const grid = createTacticalGrid(10, 10);
    const caster = makeCombatant('cleric', {
      position: { x: 0, y: 0 },
      spellSlots: { '7': { max: 1, expended: 0, available: 1 } },
      characterSheet: {
        proficiencies: { languages: ['common'] },
        spellcasting: {
          primarySpellSaveDc: 13,
          primarySpellAttackBonus: 5,
          primaryAbility: 'wis',
        },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    const friend = makeCombatant('friend', {
      position: { x: 1, y: 0 },
      characterSheet: {
        proficiencies: { languages: ['common'] },
      } as unknown as NonNullable<Combatant['characterSheet']>,
    });
    const foe = makeCombatant('foe', {
      side: 'monster',
      teamId: 'monsters',
      position: { x: 2, y: 0 },
      monsterData: {
        languages: ['orc'],
        abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 },
      } as unknown as NonNullable<Combatant['monsterData']>,
    });
    return { state: makeState([caster, friend, foe]), grid };
  }

  it('rolls saves for the understanding target, skips the other before its save', () => {
    const { state, grid } = divineWordState();
    const res = executeSpellCast({
      state,
      casterId: 'cleric',
      spell: srdSpell('divine-word'),
      slotLevel: 7,
      targetIds: ['friend', 'foe'],
      originCell: { x: 1, y: 0 },
      grid,
    });
    expect(res.targetsUnaffectedByLanguage).toContain('foe');
    expect(res.targetsUnaffectedByLanguage).not.toContain('friend');
    expect(savesFor(res.events as never, 'friend')).toBe(1);
    expect(savesFor(res.events as never, 'foe')).toBe(0);
    expect(
      res.events.some(
        (e) => e.type === 'SPELL_TARGET_UNAFFECTED' && (e as { targetId: string }).targetId === 'foe',
      ),
    ).toBe(true);
    expect(res.state.combatants['cleric']!.spellSlots!['7']!.available).toBe(0);
  });
});
