import { describe, expect, it } from 'vitest';
import { compendium, requirePregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import {
  createCharacterCombatant,
  createMonsterCombatant,
  createTurnBudget,
  startCombatEncounter,
  startTurn,
  type Combatant,
} from '../combat/index.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { spendHitDiceForHero } from '../dungeon/rest.js';
import {
  FLAME_TONGUE_ABLAZE_EFFECT_ID,
  hasAttunedMagicItem,
} from '../items/magic-items-1304.js';

function flameBuildState(attuned: boolean) {
  const base = requirePregenCharacter('pregen-fighter');
  return {
    ...base,
    inventory: [
      {
        instanceId: 'inst-flame',
        itemId: 'flame-tongue',
        quantity: 1,
        isMagicItem: true,
        identified: true,
      },
    ],
    attunedItemInstanceIds: attuned ? ['inst-flame'] : [],
  } as unknown as Combatant['buildState'];
}

function makeFlameEncounter(opts: { ablaze: boolean; attuned: boolean }) {
  const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
  const goblinData = compendium.requireMonster('goblin');

  const attackerBase = createCharacterCombatant(fighterSheet, { x: 1, y: 1 }, {
    buildState: flameBuildState(opts.attuned),
  });
  const attacker: Combatant = {
    ...attackerBase,
    activeEffects: opts.ablaze
      ? [
          {
            effectId: FLAME_TONGUE_ABLAZE_EFFECT_ID,
            name: 'Flame Tongue Ablaze',
            requiresConcentration: false,
            remainingRounds: 600,
            modifiers: [],
          },
        ]
      : [],
  };
  const target = createMonsterCombatant(goblinData, 'goblin-1', { x: 2, y: 1 });

  const startRes = startCombatEncounter({
    encounterId: 'enc-flame',
    combatants: [attacker, target],
    rngState: 4242,
  });
  return {
    ...startRes.state,
    activeCombatantId: attacker.id,
    turnBudget: createTurnBudget(attacker, false),
    combatants: {
      [attacker.id]: attacker,
      [target.id]: target,
    },
  };
}

const FLAME_CUSTOM_ATTACK = {
  name: 'Flame Tongue',
  attackType: 'melee_weapon' as const,
  toHitBonus: 20,
  damageDice: '1d8',
  damageBonus: 3,
  damageType: 'slashing' as const,
  reachFeet: 5,
};

describe('SRD-1304: revived magic-item engine mechanics', () => {
  it('flame tongue ablaze adds 2d6 fire on a melee hit (attuned + ignited)', () => {
    const state = makeFlameEncounter({ ablaze: true, attuned: true });
    const res = executeWeaponAttack({
      state,
      attackerId: 'pregen-fighter',
      targetId: 'goblin-1',
      customAttack: FLAME_CUSTOM_ATTACK,
    });
    expect(res.outcome).toBe('hit');
    const fireRolls = res.events.filter(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'flame_tongue_fire',
    );
    expect(fireRolls).toHaveLength(1);
    // Fire damage applied through the authoritative pipeline (magical fire).
    const fireApplied = res.events.filter(
      (e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'fire',
    );
    expect(fireApplied.length).toBeGreaterThanOrEqual(1);
    expect(res.damageDealt).toBeGreaterThan(0);
  });

  it('flame tongue deals no extra fire when not ignited or not attuned', () => {
    for (const opts of [
      { ablaze: false, attuned: true },
      { ablaze: true, attuned: false },
      { ablaze: false, attuned: false },
    ]) {
      const state = makeFlameEncounter(opts);
      const res = executeWeaponAttack({
        state,
        attackerId: 'pregen-fighter',
        targetId: 'goblin-1',
        customAttack: FLAME_CUSTOM_ATTACK,
      });
      expect(res.outcome).toBe('hit');
      expect(
        res.events.filter((e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'flame_tongue_fire'),
      ).toHaveLength(0);
    }
  });

  it('periapt auto-stabilizes a dying wearer at turn start (no death save rolled)', () => {
    const fighterSheet = computeDerivedCharacter(
      requirePregenCharacter('pregen-fighter'),
      compendium,
    );
    const goblinData = compendium.requireMonster('goblin');
    const buildState = {
      inventory: [
        {
          instanceId: 'inst-periapt',
          itemId: 'periapt-of-wound-closure',
          quantity: 1,
          isMagicItem: true,
          identified: true,
        },
      ],
      attunedItemInstanceIds: ['inst-periapt'],
    } as unknown as Combatant['buildState'];

    const dying = createCharacterCombatant(
      { ...fighterSheet, id: 'dying-hero', currentHp: 0 },
      { x: 0, y: 0 },
      { buildState },
    );
    const goblin = createMonsterCombatant(goblinData, 'gob-1', { x: 5, y: 5 });
    expect(hasAttunedMagicItem(dying, 'periapt-of-wound-closure')).toBe(true);

    const state = {
      encounterId: 'enc-periapt',
      round: 1,
      phase: 'active_turn' as const,
      initiativeOrder: [
        { entityId: dying.id, initiative: 20, naturalRoll: 18, dexterityScore: 14, tieBreaker: 1 },
        { entityId: goblin.id, initiative: 10, naturalRoll: 8, dexterityScore: 14, tieBreaker: 1 },
      ],
      activeCombatantIndex: 0,
      activeCombatantId: dying.id,
      turnBudget: null,
      combatants: { [dying.id]: dying, [goblin.id]: goblin },
      surprisedCombatantIds: [],
      outcome: 'in_progress' as const,
      rngState: 7,
    };
    const res = startTurn(state, dying.id);
    const updated = res.state.combatants[dying.id]!;
    expect(updated.isStable).toBe(true);
    expect(updated.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(res.events.some((e) => e.type === 'STABILIZED')).toBe(true);
    // Stabilized before any death save — no save is rolled.
    expect(res.events.some((e) => e.type === 'DEATH_SAVE_ROLLED')).toBe(false);
  });

  it('periapt wearer without attunement still rolls death saves', () => {
    const fighterSheet = computeDerivedCharacter(
      requirePregenCharacter('pregen-fighter'),
      compendium,
    );
    const goblinData = compendium.requireMonster('goblin');
    const buildState = {
      inventory: [
        {
          instanceId: 'inst-periapt',
          itemId: 'periapt-of-wound-closure',
          quantity: 1,
          isMagicItem: true,
          identified: true,
        },
      ],
      attunedItemInstanceIds: [],
    } as unknown as Combatant['buildState'];

    const dying = createCharacterCombatant(
      { ...fighterSheet, id: 'dying-hero-2', currentHp: 0 },
      { x: 0, y: 0 },
      { buildState },
    );
    const goblin = createMonsterCombatant(goblinData, 'gob-1', { x: 5, y: 5 });
    const state = {
      encounterId: 'enc-periapt-2',
      round: 1,
      phase: 'active_turn' as const,
      initiativeOrder: [
        { entityId: dying.id, initiative: 20, naturalRoll: 18, dexterityScore: 14, tieBreaker: 1 },
        { entityId: goblin.id, initiative: 10, naturalRoll: 8, dexterityScore: 14, tieBreaker: 1 },
      ],
      activeCombatantIndex: 0,
      activeCombatantId: dying.id,
      turnBudget: null,
      combatants: { [dying.id]: dying, [goblin.id]: goblin },
      surprisedCombatantIds: [],
      outcome: 'in_progress' as const,
      rngState: 7,
    };
    const res = startTurn(state, dying.id);
    expect(res.events.some((e) => e.type === 'STABILIZED')).toBe(false);
    expect(res.events.some((e) => e.type === 'DEATH_SAVE_ROLLED')).toBe(true);
  });

  it('periapt doubles Hit Die healing on a short rest (seeded)', () => {
    const mkHero = (attuned: boolean) =>
      ({
        currentHp: 1,
        maxHp: 30,
        isDead: false,
        isStable: false,
        conditions: [],
        deathSaves: { successes: 0, failures: 0 },
        characterSheet: {
          abilities: { con: { modifier: 2 } },
          hitDicePools: [{ dieSize: 8, total: 3, spent: 0, available: 3 }],
          currentHp: 1,
          deathSaves: { successes: 0, failures: 0 },
          activeConditions: [],
        },
        buildState: {
          inventory: [
            {
              instanceId: 'inst-periapt',
              itemId: 'periapt-of-wound-closure',
              quantity: 1,
              isMagicItem: true,
              identified: true,
            },
          ],
          attunedItemInstanceIds: attuned ? ['inst-periapt'] : [],
        },
      }) as unknown as Combatant;

    const plain = spendHitDiceForHero(mkHero(false), 1, 999);
    const doubled = spendHitDiceForHero(mkHero(true), 1, 999);
    expect(plain.diceSpent).toBe(1);
    expect(doubled.diceSpent).toBe(1);
    expect(doubled.hpRegained).toBe(plain.hpRegained * 2);
  });

  it('new SRD items flow through the derived sheet (rod, ring, pearl, bag)', () => {
    // Rod of the Pact Keeper: +1 spell attack and save DC on a wizard.
    const wizardBase = requirePregenCharacter('pregen-wizard');
    const wizardPlain = computeDerivedCharacter(wizardBase, compendium);
    const wizardRod = computeDerivedCharacter(
      {
        ...wizardBase,
        inventory: [
          ...(wizardBase.inventory ?? []),
          {
            instanceId: 'inv-rod',
            itemId: 'rod-of-the-pact-keeper-plus-1',
            quantity: 1,
            isMagicItem: true,
          },
        ],
        attunedItemInstanceIds: [...(wizardBase.attunedItemInstanceIds ?? []), 'inv-rod'],
      },
      compendium,
    );
    const plainDc = wizardPlain.spellcasting!.classes[0]!.spellSaveDc;
    const plainAtk = wizardPlain.spellcasting!.classes[0]!.spellAttackBonus;
    expect(wizardRod.spellcasting!.classes[0]!.spellSaveDc).toBe(plainDc + 1);
    expect(wizardRod.spellcasting!.classes[0]!.spellAttackBonus).toBe(plainAtk + 1);

    // Ring of Fire Resistance + Pearl of Power + Bag of Holding on a fighter.
    const fighterBase = requirePregenCharacter('pregen-fighter');
    const fighterItems = computeDerivedCharacter(
      {
        ...fighterBase,
        inventory: [
          ...(fighterBase.inventory ?? []),
          { instanceId: 'inv-ring', itemId: 'ring-of-fire-resistance', quantity: 1, isMagicItem: true },
          { instanceId: 'inv-pearl', itemId: 'pearl-of-power', quantity: 1, isMagicItem: true },
          { instanceId: 'inv-bag', itemId: 'bag-of-holding', quantity: 1, isMagicItem: true },
        ],
        attunedItemInstanceIds: [
          ...(fighterBase.attunedItemInstanceIds ?? []),
          'inv-ring',
          'inv-pearl',
        ],
      },
      compendium,
    );
    expect(fighterItems.damageResistances).toContain('fire');
    expect(fighterItems.resources['pearl-of-power']?.max).toBe(1);
    // Bag of Holding is unattuned but passive: capacity pool is present.
    expect(fighterItems.resources['bag-of-holding-capacity']?.max).toBe(500);
  });
});
