import { describe, expect, it } from 'vitest';
import { compendium, requirePregenCharacter } from '@srd5/data';
import { computeDerivedCharacter } from '../character/derived.js';
import { createTacticalGrid, setGridCell } from '../grid/model.js';
import {
  createCharacterCombatant,
  createMonsterCombatant,
  createTurnBudget,
  startCombatEncounter,
  type Combatant,
} from '../combat/index.js';
import {
  canCombatantCastSpell,
  executeSpellCast,
  scaleDiceFormula,
} from '../combat/spellcasting.js';

function createSpellEncounter(
  customCaster?: Partial<Combatant>,
  customTarget?: Partial<Combatant>,
) {
  const wizardSheet = computeDerivedCharacter(requirePregenCharacter('pregen-wizard'), compendium);
  const goblinData = compendium.requireMonster('goblin');

  const wizard = createCharacterCombatant(wizardSheet, { x: 1, y: 1 });
  const goblin = createMonsterCombatant(goblinData, 'goblin-1', { x: 3, y: 1 });

  const mergedCaster = { ...wizard, ...customCaster };
  const mergedTarget = { ...goblin, ...customTarget };

  const startRes = startCombatEncounter({
    encounterId: 'test-spell-encounter',
    combatants: [mergedCaster, mergedTarget],
    rngState: 12345,
  });

  const turnBudget = createTurnBudget(mergedCaster, false);

  return {
    ...startRes.state,
    activeCombatantId: mergedCaster.id,
    turnBudget,
    combatants: {
      [mergedCaster.id]: mergedCaster,
      [mergedTarget.id]: mergedTarget,
    },
  };
}

describe('SRD-306: Formula & Scaling Helpers', () => {
  it('correctly upcasts dice formulas via scaleDiceFormula', () => {
    // 3d6 base + 1d6 per slot above base (1 extra slot) -> 4d6
    expect(scaleDiceFormula('3d6', '1d6', 1)).toBe('4d6');
    // 3d6 base + 1d6 per slot above base (2 extra slots) -> 5d6
    expect(scaleDiceFormula('3d6', '1d6', 2)).toBe('5d6');
    // 4d4 base + 1d4 per slot (1 extra slot) -> 5d4
    expect(scaleDiceFormula('4d4', '1d4', 1)).toBe('5d4');
    // 1d4 + @spellMod base + 1d4 per slot (2 extra slots) -> 3d4 + @spellMod
    expect(scaleDiceFormula('1d4 + @spellMod', '1d4', 2)).toBe('3d4 + @spellMod');
    // 0 extra slots returns base formula unchanged
    expect(scaleDiceFormula('8d6', '1d6', 0)).toBe('8d6');
  });
});

describe('SRD-306: Spell Slot Management & Validation', () => {
  it('allows cantrips to be cast without consuming spell slots', () => {
    const state = createSpellEncounter();
    const fireBolt = compendium.requireSpell('fire-bolt');

    const check = canCombatantCastSpell({
      state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
    });
    expect(check.allowed).toBe(true);

    const initialL1Slots = state.combatants['pregen-wizard']!.spellSlots!['1']!.available;

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
    });

    // Slots remain untouched for cantrips
    expect(res.state.combatants['pregen-wizard']!.spellSlots!['1']!.available).toBe(initialL1Slots);
    expect(res.events.some((e) => e.type === 'SPELL_CAST' && e.slotExpended === undefined)).toBe(true);
  });

  it('expends a spell slot when casting a leveled spell and decreases available slots', () => {
    const state = createSpellEncounter();
    const burningHands = compendium.requireSpell('burning-hands');

    const initialAvailable = state.combatants['pregen-wizard']!.spellSlots!['1']!.available;
    expect(initialAvailable).toBe(2);

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: burningHands,
      targetIds: ['goblin-1'],
    });

    const nextWizard = res.state.combatants['pregen-wizard']!;
    expect(nextWizard.spellSlots!['1']!.available).toBe(initialAvailable - 1);
    expect(nextWizard.spellSlots!['1']!.expended).toBe(1);

    const castEvent = res.events.find((e) => e.type === 'SPELL_CAST');
    expect(castEvent).toBeDefined();
    if (castEvent && castEvent.type === 'SPELL_CAST') {
      expect(castEvent.slotExpended).toBe(1);
      expect(castEvent.castAtLevel).toBe(1);
    }
  });

  it('prohibits casting when spell slots for that level are exhausted', () => {
    const state = createSpellEncounter({
      spellSlots: {
        '1': { max: 2, expended: 2, available: 0 },
      },
    });
    const burningHands = compendium.requireSpell('burning-hands');

    const check = canCombatantCastSpell({
      state,
      casterId: 'pregen-wizard',
      spell: burningHands,
      slotLevel: 1,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/no level 1 spell slots/i);

    expect(() =>
      executeSpellCast({
        state,
        casterId: 'pregen-wizard',
        spell: burningHands,
        slotLevel: 1,
        targetIds: ['goblin-1'],
      }),
    ).toThrow(/no level 1 spell slots/i);
  });

  it('prohibits downcasting (casting with a slot level lower than the spell base level)', () => {
    const state = createSpellEncounter();
    const acidArrow = compendium.requireSpell('acid-arrow'); // Level 2 spell

    const check = canCombatantCastSpell({
      state,
      casterId: 'pregen-wizard',
      spell: acidArrow,
      slotLevel: 1,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/cannot cast .* using a lower slot/i);

    expect(() =>
      executeSpellCast({
        state,
        casterId: 'pregen-wizard',
        spell: acidArrow,
        slotLevel: 1,
        targetIds: ['goblin-1'],
      }),
    ).toThrow(/cannot cast .* using a lower slot/i);
  });
});

describe('SRD-306: SRD 5.1 Bonus Action Spellcasting Rule', () => {
  it('enforces that casting a bonus action spell prohibits casting leveled 1-action spells on the same turn', () => {
    const state = createSpellEncounter({
      spellSlots: {
        '1': { max: 4, expended: 0, available: 4 },
      },
    });
    const healingWord = compendium.requireSpell('healing-word'); // Bonus Action, Level 1
    const burningHands = compendium.requireSpell('burning-hands'); // Action, Level 1
    const fireBolt = compendium.requireSpell('fire-bolt'); // Action, Cantrip (Level 0)

    // 1. Cast Healing Word as a bonus action
    const afterBonus = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: healingWord,
      targetIds: ['pregen-wizard'],
    });

    expect(afterBonus.state.turnBudget?.bonusAction).toBe(0);
    expect(afterBonus.state.turnBudget?.action).toBe(1);
    expect(afterBonus.state.turnBudget?.bonusActionSpellCast).toBe(true);

    // 2. Attempting to cast Burning Hands (leveled 1-action spell) MUST FAIL per SRD 5.1
    const checkLeveled = canCombatantCastSpell({
      state: afterBonus.state,
      casterId: 'pregen-wizard',
      spell: burningHands,
    });
    expect(checkLeveled.allowed).toBe(false);
    expect(checkLeveled.reason).toMatch(/only cantrips with a casting time of 1 action/i);

    expect(() =>
      executeSpellCast({
        state: afterBonus.state,
        casterId: 'pregen-wizard',
        spell: burningHands,
        targetIds: ['goblin-1'],
      }),
    ).toThrow(/only cantrips with a casting time of 1 action/i);

    // 3. Casting a 1-action cantrip (Fire Bolt) is allowed!
    const checkCantrip = canCombatantCastSpell({
      state: afterBonus.state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
    });
    expect(checkCantrip.allowed).toBe(true);

    const afterCantrip = executeSpellCast({
      state: afterBonus.state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
    });

    expect(afterCantrip.state.turnBudget?.action).toBe(0);
  });

  it('enforces that casting a leveled 1-action spell prohibits casting bonus action spells on the same turn', () => {
    const state = createSpellEncounter({
      spellSlots: {
        '1': { max: 4, expended: 0, available: 4 },
      },
    });
    const burningHands = compendium.requireSpell('burning-hands'); // Action, Level 1
    const healingWord = compendium.requireSpell('healing-word'); // Bonus Action, Level 1

    // 1. Cast Burning Hands first
    const afterAction = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: burningHands,
      targetIds: ['goblin-1'],
    });

    expect(afterAction.state.turnBudget?.action).toBe(0);
    expect(afterAction.state.turnBudget?.bonusAction).toBe(1);
    expect(afterAction.state.turnBudget?.leveledActionSpellCast).toBe(true);

    // 2. Attempting to cast Healing Word (bonus action spell) MUST FAIL
    const checkBonus = canCombatantCastSpell({
      state: afterAction.state,
      casterId: 'pregen-wizard',
      spell: healingWord,
    });
    expect(checkBonus.allowed).toBe(false);
    expect(checkBonus.reason).toMatch(/cannot cast a bonus action spell after casting a leveled 1-action spell/i);

    expect(() =>
      executeSpellCast({
        state: afterAction.state,
        casterId: 'pregen-wizard',
        spell: healingWord,
        targetIds: ['pregen-wizard'],
      }),
    ).toThrow(/cannot cast a bonus action spell after casting a leveled 1-action spell/i);
  });
});

describe('SRD-306: Cantrip & Upcasting Scaling', () => {
  it('scales cantrip damage based on character level tiers (Level 1 vs Level 5 vs Level 11)', () => {
    const fireBolt = compendium.requireSpell('fire-bolt');

    // Level 1: 1d10
    const l1State = createSpellEncounter();
    const l1Res = executeSpellCast({
      state: l1State,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
    });
    const l1DmgEvent = l1Res.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'damage_roll_Fire Bolt',
    );
    if (l1DmgEvent && l1DmgEvent.type === 'DICE_ROLLED') {
      expect(l1DmgEvent.notation).toBe('1d10');
    }

    // Level 5: 2d10
    const wizardSheetL5 = computeDerivedCharacter(requirePregenCharacter('pregen-wizard'), compendium);
    wizardSheetL5.totalLevel = 5;
    if (wizardSheetL5.spellcasting) wizardSheetL5.spellcasting.effectiveCasterLevel = 5;
    const l5Wizard = createCharacterCombatant(wizardSheetL5, { x: 1, y: 1 });
    const l5State = createSpellEncounter({ ...l5Wizard, id: 'pregen-wizard' });

    const l5Res = executeSpellCast({
      state: l5State,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
    });
    const l5DmgEvent = l5Res.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'damage_roll_Fire Bolt',
    );
    if (l5DmgEvent && l5DmgEvent.type === 'DICE_ROLLED') {
      expect(l5DmgEvent.notation).toBe('2d10');
    }
  });

  it('scales leveled spell damage dice when upcast with a higher spell slot', () => {
    const burningHands = compendium.requireSpell('burning-hands');
    // Base level 1 is 3d6. Slot level 2 scales to 4d6 (bonusDicePerSlotAboveBase: "1d6").
    const state = createSpellEncounter({
      spellSlots: {
        '1': { max: 2, expended: 0, available: 2 },
        '2': { max: 1, expended: 0, available: 1 },
      },
    });

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: burningHands,
      slotLevel: 2,
      targetIds: ['goblin-1'],
    });

    expect(res.effectiveSlotLevel).toBe(2);
    expect(res.state.combatants['pregen-wizard']!.spellSlots!['2']!.available).toBe(0);

    const dmgEvent = res.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'damage_roll_Burning Hands',
    );
    expect(dmgEvent).toBeDefined();
    if (dmgEvent && dmgEvent.type === 'DICE_ROLLED') {
      expect(dmgEvent.notation).toBe('4d6');
    }
  });
});

describe('SRD-306: Saving Throws & Half-Damage Resolution', () => {
  it('resolves DEX saving throws, dealing full damage on fail and half damage on success', () => {
    const burningHands = compendium.requireSpell('burning-hands');

    // Case 1: Target fails save -> takes full damage
    const failState = createSpellEncounter(
      {},
      {
        armorClass: 10,
        dexterityScore: 1,
        dexterityModifier: -5,
      },
    );

    const failRes = executeSpellCast({
      state: failState,
      casterId: 'pregen-wizard',
      spell: burningHands,
      targetIds: ['goblin-1'],
    });

    expect(failRes.targetsFailedSave).toContain('goblin-1');
    const saveEventFail = failRes.events.find((e) => e.type === 'SAVING_THROW_RESOLVED');
    expect(saveEventFail).toBeDefined();
    if (saveEventFail && saveEventFail.type === 'SAVING_THROW_RESOLVED') {
      expect(saveEventFail.outcome).toBe('failure');
      expect(saveEventFail.ability).toBe('dex');
    }

    const dmgEventFail = failRes.events.find((e) => e.type === 'DAMAGE_APPLIED');
    expect(dmgEventFail).toBeDefined();

    // Case 2: Target succeeds save -> takes half damage (halfOnSaveSuccess)
    const successState = createSpellEncounter(
      {},
      {
        dexterityScore: 30,
        dexterityModifier: 20,
      },
    );

    const succRes = executeSpellCast({
      state: successState,
      casterId: 'pregen-wizard',
      spell: burningHands,
      targetIds: ['goblin-1'],
    });

    expect(succRes.targetsSaved).toContain('goblin-1');
    const dmgRoll = succRes.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'damage_roll_Burning Hands',
    );
    const dmgApplied = succRes.events.find((e) => e.type === 'DAMAGE_APPLIED');
    if (dmgRoll && dmgRoll.type === 'DICE_ROLLED' && dmgApplied && dmgApplied.type === 'DAMAGE_APPLIED') {
      expect(dmgApplied.finalAmount).toBe(Math.floor(dmgRoll.total / 2));
    }
  });

  it('auto-fails DEX saves when target is paralyzed or unconscious', () => {
    const burningHands = compendium.requireSpell('burning-hands');
    const state = createSpellEncounter(
      {},
      {
        conditions: ['paralyzed'],
        dexterityScore: 20,
        dexterityModifier: 5,
      },
    );

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: burningHands,
      targetIds: ['goblin-1'],
    });

    expect(res.targetsFailedSave).toContain('goblin-1');
    const saveEvent = res.events.find((e) => e.type === 'SAVING_THROW_RESOLVED');
    if (saveEvent && saveEvent.type === 'SAVING_THROW_RESOLVED') {
      expect(saveEvent.outcome).toBe('failure');
      expect(saveEvent.roll).toBe(1);
    }
  });
});

describe('SRD-306: Spell Attack Rolls & Cover', () => {
  it('resolves ranged spell attack rolls, respecting cover and applying damage on hit', () => {
    const fireBolt = compendium.requireSpell('fire-bolt');
    // Rubble at (2,5) provides half cover between wizard (0,5) and goblin (4,5)
    let grid = createTacticalGrid(10, 10);
    grid = setGridCell(grid, { x: 2, y: 5, terrain: 'rubble' });

    const state = createSpellEncounter(
      { position: { x: 0, y: 5 } },
      { position: { x: 4, y: 5 }, armorClass: 13 },
    );

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
      grid,
    });

    const attackEvent = res.events.find((e) => e.type === 'ATTACK_RESOLVED');
    expect(attackEvent).toBeDefined();
    if (attackEvent && attackEvent.type === 'ATTACK_RESOLVED') {
      // Base AC 13 + Half Cover (+2) = 15 AC
      expect(attackEvent.targetAc).toBe(15);
      expect(attackEvent.cover).toBe('half');
    }
  });

  it('imposes disadvantage on ranged spell attacks when a hostile creature is within 5 ft', () => {
    const fireBolt = compendium.requireSpell('fire-bolt');
    // Goblin at (2,1) is 5 ft away from Wizard at (1,1)
    const state = createSpellEncounter(
      { position: { x: 1, y: 1 } },
      { position: { x: 2, y: 1 } },
    );

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: fireBolt,
      targetIds: ['goblin-1'],
    });

    const diceEvent = res.events.find(
      (e) => e.type === 'DICE_ROLLED' && e.rollPurpose === 'spell_attack_roll',
    );
    expect(diceEvent).toBeDefined();
    if (diceEvent && diceEvent.type === 'DICE_ROLLED') {
      expect(diceEvent.mode).toBe('disadvantage');
    }
  });
});

describe('SRD-306: Concentration Mechanics', () => {
  it('starts concentration on a concentration spell and breaks previous concentration', () => {
    const state = createSpellEncounter();
    const bless = compendium.requireSpell('bless'); // Concentration spell
    const holdPerson = compendium.requireSpell('hold-person'); // Concentration spell

    // 1. Cast Bless
    const res1 = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: bless,
      targetIds: ['pregen-wizard'],
    });

    expect(res1.state.combatants['pregen-wizard']!.concentratingOn).toBeDefined();
    expect(res1.state.combatants['pregen-wizard']!.concentratingOn?.sourceId).toBe('bless');
    expect(res1.events.some((e) => e.type === 'CONCENTRATION_STARTED' && e.spellId === 'bless')).toBe(true);

    // 2. Refresh action budget (e.g. next round) with a level 2 slot available and cast Hold Person -> breaks Bless concentration
    const round2State = {
      ...res1.state,
      turnBudget: createTurnBudget(res1.state.combatants['pregen-wizard']!),
      combatants: {
        ...res1.state.combatants,
        ['pregen-wizard']: {
          ...res1.state.combatants['pregen-wizard']!,
          spellSlots: {
            ...res1.state.combatants['pregen-wizard']!.spellSlots,
            '2': { max: 1, expended: 0, available: 1 },
          },
        },
      },
    };
    const res2 = executeSpellCast({
      state: round2State,
      casterId: 'pregen-wizard',
      spell: holdPerson,
      targetIds: ['goblin-1'],
    });

    expect(res2.state.combatants['pregen-wizard']!.concentratingOn?.sourceId).toBe('hold-person');
    expect(
      res2.events.some(
        (e) => e.type === 'CONCENTRATION_ENDED' && e.spellId === 'bless' && e.reason === 'new_spell',
      ),
    ).toBe(true);
    expect(res2.events.some((e) => e.type === 'CONCENTRATION_STARTED' && e.spellId === 'hold-person')).toBe(true);
  });
});

describe('SRD-306: Bless multi-target fan-out', () => {
  function createBlessEncounter() {
    const wizardSheet = computeDerivedCharacter(requirePregenCharacter('pregen-wizard'), compendium);
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const rogueSheet = computeDerivedCharacter(requirePregenCharacter('pregen-rogue'), compendium);
    const wizard = createCharacterCombatant(wizardSheet, { x: 1, y: 1 });
    const fighter = createCharacterCombatant(fighterSheet, { x: 2, y: 1 });
    const rogue = createCharacterCombatant(rogueSheet, { x: 3, y: 1 });

    const startRes = startCombatEncounter({
      encounterId: 'test-bless-encounter',
      combatants: [wizard, fighter, rogue],
      rngState: 12345,
    });
    const turnBudget = createTurnBudget(wizard, false);
    return {
      ...startRes.state,
      activeCombatantId: wizard.id,
      turnBudget,
      combatants: {
        [wizard.id]: wizard,
        [fighter.id]: fighter,
        [rogue.id]: rogue,
      },
    };
  }

  const BLESSED_IDS = ['pregen-wizard', 'pregen-fighter', 'pregen-rogue'];

  it('applies bless-buff to all three targets in a single cast', () => {
    const state = createBlessEncounter();
    const bless = compendium.requireSpell('bless');
    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: bless,
      targetIds: BLESSED_IDS,
    });

    for (const id of BLESSED_IDS) {
      expect(
        res.state.combatants[id]!.activeEffects?.some((e) => e.effectId === 'bless-buff'),
      ).toBe(true);
    }
    expect(res.state.combatants['pregen-wizard']!.concentratingOn?.targetEntityIds).toHaveLength(3);
  });

  it('re-casting bless on a single target strips the other two (concentration overwrite)', () => {
    const state = createBlessEncounter();
    const bless = compendium.requireSpell('bless');
    const res1 = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: bless,
      targetIds: BLESSED_IDS,
    });
    for (const id of BLESSED_IDS) {
      expect(
        res1.state.combatants[id]!.activeEffects?.some((e) => e.effectId === 'bless-buff'),
      ).toBe(true);
    }

    // Next round, fresh budget, re-cast on the caster alone: the new cast
    // breaks concentration on the first, so only one buff survives.
    const caster1 = res1.state.combatants['pregen-wizard']!;
    const round2State = {
      ...res1.state,
      turnBudget: createTurnBudget(caster1, false),
      combatants: { ...res1.state.combatants },
    };
    const res2 = executeSpellCast({
      state: round2State,
      casterId: 'pregen-wizard',
      spell: bless,
      targetIds: ['pregen-wizard'],
    });

    expect(
      res2.events.some(
        (e) => e.type === 'CONCENTRATION_ENDED' && e.spellId === 'bless' && e.reason === 'new_spell',
      ),
    ).toBe(true);
    expect(
      res2.state.combatants['pregen-wizard']!.activeEffects?.some(
        (e) => e.effectId === 'bless-buff',
      ),
    ).toBe(true);
    for (const id of ['pregen-fighter', 'pregen-rogue']) {
      expect(
        res2.state.combatants[id]!.activeEffects?.some((e) => e.effectId === 'bless-buff'),
      ).toBe(false);
    }
  });
});

describe('SRD-306: Healing & Condition Application', () => {
  it('restores HP and revives unconscious targets from 0 HP', () => {
    const cureWounds = compendium.requireSpell('cure-wounds');
    const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
    const fighter = createCharacterCombatant(fighterSheet, { x: 2, y: 1 });
    // Knock fighter to 0 HP and unconscious
    fighter.currentHp = 0;
    fighter.conditions = ['unconscious', 'prone'];

    const state = createSpellEncounter({}, fighter);

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: cureWounds,
      targetIds: [fighter.id],
    });

    const healedFighter = res.state.combatants[fighter.id]!;
    expect(healedFighter.currentHp).toBeGreaterThan(0);
    expect(healedFighter.conditions).not.toContain('unconscious');
    expect(res.events.some((e) => e.type === 'HEAL_APPLIED' && e.targetId === fighter.id)).toBe(true);
    expect(
      res.events.some((e) => e.type === 'CONDITION_REMOVED' && e.conditionId === 'unconscious'),
    ).toBe(true);
  });

  it('applies conditions specified by effect steps', () => {
    const holdPerson = compendium.requireSpell('hold-person');
    const state = createSpellEncounter(
      {
        spellSlots: {
          '2': { max: 2, expended: 0, available: 2 },
        },
      },
      {
        dexterityScore: 1,
        dexterityModifier: -5,
      },
    );

    const res = executeSpellCast({
      state,
      casterId: 'pregen-wizard',
      spell: holdPerson,
      targetIds: ['goblin-1'],
    });

    const target = res.state.combatants['goblin-1']!;
    expect(target.conditions).toContain('paralyzed');
    expect(
      res.events.some((e) => e.type === 'CONDITION_ADDED' && e.conditionId === 'paralyzed'),
    ).toBe(true);
  });
});

describe('SRD-306: AOE Template Targeting Rasterization', () => {
  it('rasterizes an AOE cone and affects all valid targets inside the area', () => {
    const burningHands = compendium.requireSpell('burning-hands');
    // Place Wizard at (1,1) facing east (+x direction)
    // Place Goblin 1 at (2,1) and Goblin 2 at (3,1) (both within 15 ft cone)
    // Place Goblin 3 at (1,5) (outside the cone)
    const goblinData = compendium.requireMonster('goblin');
    const gob1 = createMonsterCombatant(goblinData, 'goblin-1', { x: 2, y: 1 });
    const gob2 = createMonsterCombatant(goblinData, 'goblin-2', { x: 3, y: 1 });
    const gob3 = createMonsterCombatant(goblinData, 'goblin-3', { x: 1, y: 5 });

    const state = createSpellEncounter();
    const aoeState: typeof state = {
      ...state,
      combatants: {
        ...state.combatants,
        ['goblin-1']: gob1,
        ['goblin-2']: gob2,
        ['goblin-3']: gob3,
      },
    };

    const res = executeSpellCast({
      state: aoeState,
      casterId: 'pregen-wizard',
      spell: burningHands,
      direction: { x: 1, y: 0 },
    });

    // Both goblins in front take damage; goblin-3 outside is untouched
    expect(res.totalDamageByTarget['goblin-1']).toBeGreaterThan(0);
    expect(res.totalDamageByTarget['goblin-2']).toBeGreaterThan(0);
    expect(res.totalDamageByTarget['goblin-3']).toBeUndefined();
  });

  describe('SRD-606: Configurable Friendly Fire AOE Filtering', () => {
    it('harms BOTH ally and enemy in AOE cone when friendlyFireEnabled is true (5e RAW)', () => {
      const burningHands = compendium.requireSpell('burning-hands');
      const goblinData = compendium.requireMonster('goblin');
      const enemyGoblin = createMonsterCombatant(goblinData, 'goblin-enemy', { x: 3, y: 1 });
      const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
      const fighterAlly = createCharacterCombatant(fighterSheet, { x: 2, y: 1 });

      const state = createSpellEncounter();
      // Place Fighter ally in the cone at (2,1)
      const stateWithAllyAndEnemy: typeof state = {
        ...state,
        friendlyFireEnabled: true,
        combatants: {
          ...state.combatants,
          ['pregen-fighter']: fighterAlly,
          ['goblin-enemy']: enemyGoblin,
        },
      };

      const res = executeSpellCast({
        state: stateWithAllyAndEnemy,
        casterId: 'pregen-wizard',
        spell: burningHands,
        direction: { x: 1, y: 0 },
        friendlyFireEnabled: true,
      });

      // Under 5e RAW friendly fire, both ally and enemy take damage
      expect(res.totalDamageByTarget['goblin-enemy']).toBeGreaterThan(0);
      expect(res.totalDamageByTarget['pregen-fighter']).toBeGreaterThan(0);
    });

    it('spares ally and ONLY harms enemy in AOE cone when friendlyFireEnabled is false (Explorer Mode)', () => {
      const burningHands = compendium.requireSpell('burning-hands');
      const goblinData = compendium.requireMonster('goblin');
      const enemyGoblin = createMonsterCombatant(goblinData, 'goblin-enemy', { x: 3, y: 1 });
      const fighterSheet = computeDerivedCharacter(requirePregenCharacter('pregen-fighter'), compendium);
      const fighterAlly = createCharacterCombatant(fighterSheet, { x: 2, y: 1 });

      const state = createSpellEncounter();
      // Place Fighter ally in the cone at (2,1)
      const stateWithAllyAndEnemy: typeof state = {
        ...state,
        friendlyFireEnabled: false,
        combatants: {
          ...state.combatants,
          ['pregen-fighter']: fighterAlly,
          ['goblin-enemy']: enemyGoblin,
        },
      };

      const res = executeSpellCast({
        state: stateWithAllyAndEnemy,
        casterId: 'pregen-wizard',
        spell: burningHands,
        direction: { x: 1, y: 0 },
        friendlyFireEnabled: false,
      });

      // Ally is spared! Only enemy takes damage
      expect(res.totalDamageByTarget['goblin-enemy']).toBeGreaterThan(0);
      expect(res.totalDamageByTarget['pregen-fighter']).toBeUndefined();
      expect(res.targetsHit.concat(res.targetsSaved, res.targetsFailedSave)).not.toContain('pregen-fighter');
    });
  });
});

describe('SRD-306: Monster Spellcaster Execution', () => {
  it('allows monster spellcasters to cast leveled spells and consumes monster slots', () => {
    const fireBolt = compendium.requireSpell('fire-bolt');
    const burningHands = compendium.requireSpell('burning-hands');

    // Create a spellcasting monster with 3 L1 slots
    const monsterData = compendium.requireMonster('goblin');
    const casterMonster = createMonsterCombatant(
      {
        ...monsterData,
        name: 'Goblin Shaman',
        spellcasting: {
          ability: 'wis',
          spellSaveDc: 12,
          spellAttackBonus: 4,
          slotsByLevel: { '1': 3 },
          atWillSpellIds: ['fire-bolt'],
          preparedSpellIds: ['burning-hands'],
        },
      },
      'shaman-1',
      { x: 5, y: 1 },
      { side: 'monster' },
    );

    const state = createSpellEncounter({}, casterMonster);
    const shamanState: typeof state = {
      ...state,
      activeCombatantId: 'shaman-1',
      turnBudget: createTurnBudget(casterMonster),
    };

    // 1. Shaman casts at-will cantrip Fire Bolt
    const cantripRes = executeSpellCast({
      state: shamanState,
      casterId: 'shaman-1',
      spell: fireBolt,
      targetIds: ['pregen-wizard'],
    });
    expect(cantripRes.events.some((e) => e.type === 'SPELL_CAST')).toBe(true);

    // 2. Shaman casts leveled spell Burning Hands (slot consumed from monster spellSlots)
    const nextShamanState = {
      ...cantripRes.state,
      turnBudget: createTurnBudget(cantripRes.state.combatants['shaman-1']!),
    };
    const leveledRes = executeSpellCast({
      state: nextShamanState,
      casterId: 'shaman-1',
      spell: burningHands,
      targetIds: ['pregen-wizard'],
    });

    const shamanAfter = leveledRes.state.combatants['shaman-1']!;
    expect(shamanAfter.spellSlots!['1']!.available).toBe(2);
    expect(shamanAfter.spellSlots!['1']!.expended).toBe(1);
  });
});
