import { describe, expect, it } from 'vitest';
import {
  ArmorSchema,
  EquipmentPackSchema,
  EquipmentSchema,
  GearSchema,
  MagicItemSchema,
  MonsterSchema,
  SpellSchema,
  ToolSchema,
  WeaponSchema,
} from '../index.js';

describe('@srd5/data SRD-104 Equipment, Weapon, Armor, and Magic Item schemas', () => {
  it('validates melee and ranged weapons via WeaponSchema and EquipmentSchema', () => {
    const longsword = EquipmentSchema.parse({
      id: 'longsword',
      kind: 'weapon',
      name: 'Longsword',
      category: 'martial',
      rangeType: 'melee',
      costCopper: 1500,
      weightLb: 3,
      damageDice: '1d8',
      damageType: 'slashing',
      versatileDamageDice: '1d10',
      properties: ['versatile'],
    });

    expect(longsword.kind).toBe('weapon');
    if (longsword.kind === 'weapon') {
      expect(longsword.versatileDamageDice).toBe('1d10');
    }

    const longbow = WeaponSchema.parse({
      id: 'longbow',
      kind: 'weapon',
      name: 'Longbow',
      category: 'martial',
      rangeType: 'ranged',
      costCopper: 5000,
      weightLb: 2,
      damageDice: '1d8',
      damageType: 'piercing',
      properties: ['ammunition', 'heavy', 'range', 'two-handed'],
      rangeFeet: { normal: 150, long: 600 },
    });

    expect(longbow.rangeFeet?.normal).toBe(150);
    expect(longbow.rangeFeet?.long).toBe(600);
  });

  it('rejects weapons where long range is less than normal range', () => {
    expect(
      WeaponSchema.safeParse({
        id: 'broken-bow',
        kind: 'weapon',
        name: 'Broken Bow',
        category: 'simple',
        rangeType: 'ranged',
        costCopper: 2500,
        weightLb: 2,
        damageDice: '1d6',
        damageType: 'piercing',
        properties: ['ammunition', 'range'],
        rangeFeet: { normal: 100, long: 50 },
      }).success,
    ).toBe(false);
  });

  it('validates light, medium, heavy armor and shields via ArmorSchema', () => {
    const halfPlate = ArmorSchema.parse({
      id: 'half-plate',
      kind: 'armor',
      name: 'Half Plate',
      category: 'medium',
      costCopper: 75000,
      weightLb: 40,
      baseAc: 15,
      addDexModifier: true,
      maxDexBonus: 2,
      stealthDisadvantage: true,
    });

    expect(halfPlate.maxDexBonus).toBe(2);

    const chainMail = ArmorSchema.parse({
      id: 'chain-mail',
      kind: 'armor',
      name: 'Chain Mail',
      category: 'heavy',
      costCopper: 7500,
      weightLb: 55,
      baseAc: 16,
      addDexModifier: false,
      strengthRequirement: 13,
      stealthDisadvantage: true,
    });

    expect(chainMail.strengthRequirement).toBe(13);

    const shield = ArmorSchema.parse({
      id: 'shield',
      kind: 'armor',
      name: 'Shield',
      category: 'shield',
      costCopper: 1000,
      weightLb: 6,
      baseAc: 2,
      addDexModifier: false,
      stealthDisadvantage: false,
    });

    expect(shield.category).toBe('shield');
  });

  it('validates adventuring gear, tools, and equipment packs in EquipmentSchema', () => {
    const healingPotion = GearSchema.parse({
      id: 'potion-of-healing',
      kind: 'gear',
      name: 'Potion of Healing',
      category: 'consumable',
      costCopper: 5000,
      weightLb: 0.5,
      activatedAbilities: [
        {
          id: 'drink-potion-of-healing',
          name: 'Drink Potion of Healing',
          description: 'You regain 2d4 + 2 hit points when you drink this potion.',
          actionCost: 'action',
          targeting: { type: 'self', rangeFeet: 0 },
          effects: [{ step: 'heal', diceFormula: '2d4 + 2' }],
        },
      ],
    });
    expect(healingPotion.activatedAbilities).toHaveLength(1);

    const thievesTools = ToolSchema.parse({
      id: 'thieves-tools',
      kind: 'tool',
      name: "Thieves' Tools",
      category: 'thieves_tools',
      costCopper: 2500,
      weightLb: 1,
      defaultAbility: 'dex',
    });
    expect(thievesTools.defaultAbility).toBe('dex');

    const explorersPack = EquipmentPackSchema.parse({
      id: 'explorers-pack',
      kind: 'pack',
      name: "Explorer's Pack",
      costCopper: 1000,
      weightLb: 59,
      contents: [
        { itemId: 'backpack', quantity: 1 },
        { itemId: 'bedroll', quantity: 1 },
        { itemId: 'torch', quantity: 10 },
        { itemId: 'rations-1-day', quantity: 10 },
        { itemId: 'waterskin', quantity: 1 },
        { itemId: 'hempen-rope-50ft', quantity: 1 },
      ],
    });
    expect(explorersPack.contents).toHaveLength(6);

    expect(EquipmentSchema.parse(healingPotion).kind).toBe('gear');
    expect(EquipmentSchema.parse(thievesTools).kind).toBe('tool');
    expect(EquipmentSchema.parse(explorersPack).kind).toBe('pack');
  });

  it('validates Magic Items with passive modifiers, attunement, and charges', () => {
    const cloakOfProtection = MagicItemSchema.parse({
      id: 'cloak-of-protection',
      name: 'Cloak of Protection',
      category: 'wondrous',
      rarity: 'uncommon',
      requiresAttunement: true,
      modifiers: [
        { type: 'flat_bonus', target: 'ac', value: 1 },
        { type: 'flat_bonus', target: 'all_saving_throws', value: 1 },
      ],
      description:
        'You gain a +1 bonus to AC and saving throws while you wear this cloak.',
    });
    expect(cloakOfProtection.requiresAttunement).toBe(true);
    expect(cloakOfProtection.modifiers).toHaveLength(2);

    const gauntletsOfOgrePower = MagicItemSchema.parse({
      id: 'gauntlets-of-ogre-power',
      name: 'Gauntlets of Ogre Power',
      category: 'wondrous',
      rarity: 'uncommon',
      requiresAttunement: true,
      modifiers: [
        {
          type: 'set_ability_minimum',
          ability: 'str',
          minimum: 19,
        },
      ],
      description: 'Your Strength score is 19 while you wear these gauntlets.',
    });
    expect(gauntletsOfOgrePower.modifiers[0]?.type).toBe('set_ability_minimum');

    const wandOfMagicMissiles = MagicItemSchema.parse({
      id: 'wand-of-magic-missiles',
      name: 'Wand of Magic Missiles',
      category: 'wand',
      rarity: 'uncommon',
      requiresAttunement: false,
      charges: {
        max: 7,
        rechargeFormula: '1d6 + 1',
        rechargeTiming: 'dawn',
      },
      modifiers: [],
      activatedAbilities: [
        {
          id: 'wand-cast-magic-missile',
          name: 'Magic Missile (1 Charge)',
          description: 'Expend 1 charge to cast magic missile as a 1st-level spell.',
          actionCost: 'action',
          targeting: {
            type: 'multiple',
            rangeFeet: 120,
            requiresSight: true,
            targetFilter: 'creature',
            maxTargets: 3,
          },
          effects: [
            {
              step: 'deal_damage',
              diceFormula: '1d4 + 1',
              damageType: 'force',
              isMagical: true,
            },
          ],
        },
      ],
      description: 'This wand has 7 charges. While holding it, you can use an action to expend 1 or more of its charges to cast the magic missile spell from it.',
    });
    expect(wandOfMagicMissiles.charges?.max).toBe(7);
  });
});

describe('@srd5/data SRD-104 Spell schemas', () => {
  it('validates cantrips, reaction spells, concentration buffs, and AoE attack spells', () => {
    const fireBolt = SpellSchema.parse({
      id: 'fire-bolt',
      name: 'Fire Bolt',
      level: 0,
      school: 'evocation',
      castingTime: 'action',
      ritual: false,
      concentration: false,
      duration: { type: 'instantaneous' },
      components: { verbal: true, somatic: true, material: false },
      classes: ['sorcerer', 'wizard'],
      targeting: {
        type: 'single',
        rangeFeet: 120,
        targetFilter: 'object_or_creature',
      },
      effects: [
        {
          step: 'attack_roll',
          attackType: 'ranged_spell',
          onHit: [
            {
              step: 'deal_damage',
              diceFormula: '1d10',
              damageType: 'fire',
              isMagical: true,
            },
          ],
        },
      ],
      higherLevelScaling: {
        mode: 'character_level',
        overrides: {
          '5': { diceFormula: '2d10' },
          '11': { diceFormula: '3d10' },
          '17': { diceFormula: '4d10' },
        },
      },
      description: 'You hurl a mote of fire at a creature or object within range.',
    });
    expect(fireBolt.level).toBe(0);
    expect(fireBolt.higherLevelScaling?.mode).toBe('character_level');

    const shieldSpell = SpellSchema.parse({
      id: 'shield',
      name: 'Shield',
      level: 1,
      school: 'abjuration',
      castingTime: 'reaction',
      reactionTrigger: {
        event: 'hit_by_attack',
        description: 'When you are hit by an attack or targeted by the magic missile spell',
      },
      ritual: false,
      concentration: false,
      duration: { type: 'rounds', rounds: 1 },
      components: { verbal: true, somatic: true, material: false },
      classes: ['sorcerer', 'wizard'],
      targeting: { type: 'self', rangeFeet: 0 },
      effects: [
        {
          step: 'apply_active_effect',
          effectId: 'shield-ac-bonus',
          name: 'Shield (+5 AC)',
          durationRounds: 1,
          requiresConcentration: false,
          modifiers: [{ type: 'flat_bonus', target: 'ac', value: 5 }],
        },
      ],
      description:
        'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC.',
    });
    expect(shieldSpell.castingTime).toBe('reaction');
    expect(shieldSpell.reactionTrigger?.event).toBe('hit_by_attack');

    const fireball = SpellSchema.parse({
      id: 'fireball',
      name: 'Fireball',
      level: 3,
      school: 'evocation',
      castingTime: 'action',
      ritual: false,
      concentration: false,
      duration: { type: 'instantaneous' },
      components: {
        verbal: true,
        somatic: true,
        material: true,
        materialDescription: 'a tiny ball of bat guano and sulfur',
      },
      classes: ['sorcerer', 'wizard'],
      subclasses: ['fiend'],
      targeting: {
        type: 'point_aoe',
        rangeFeet: 150,
        aoe: { shape: 'sphere', sizeFeet: 20 },
      },
      effects: [
        {
          step: 'saving_throw',
          ability: 'dex',
          dcFormula: '@spellSaveDC',
          onFail: [
            {
              step: 'deal_damage',
              diceFormula: '8d6',
              damageType: 'fire',
              halfOnSaveSuccess: true,
              isMagical: true,
            },
          ],
        },
      ],
      higherLevelScaling: {
        mode: 'slot_level',
        bonusDicePerSlotAboveBase: '1d6',
      },
      description:
        'A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame.',
      higherLevelDescription:
        'When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.',
    });
    expect(fireball.targeting.aoe?.shape).toBe('sphere');
    expect(fireball.targeting.aoe?.sizeFeet).toBe(20);
  });
});

describe('@srd5/data SRD-104 Monster schemas', () => {
  it('validates a low-CR skirmisher Monster (Goblin) and a Boss Dragon with Multiattack, Recharge Breath, and Legendary Actions', () => {
    const goblin = MonsterSchema.parse({
      id: 'goblin',
      name: 'Goblin',
      size: 'small',
      type: 'humanoid',
      subtype: 'goblinoid',
      alignment: 'neutral_evil',
      armorClass: {
        value: 15,
        type: 'armor',
        armorIds: ['leather-armor', 'shield'],
        hasShield: true,
      },
      hitPoints: {
        average: 7,
        rollFormula: '2d6',
      },
      speed: { walk: 30 },
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      savingThrows: {},
      skills: { stealth: 6 },
      damageVulnerabilities: [],
      damageResistances: [],
      damageImmunities: [],
      conditionImmunities: [],
      senses: {
        darkvisionFeet: 60,
        passivePerception: 9,
      },
      languages: ['common', 'goblin'],
      challengeRating: 0.25,
      xp: 50,
      aiArchetype: 'skirmisher',
      traits: [
        {
          id: 'nimble-escape',
          name: 'Nimble Escape',
          description:
            'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.',
        },
      ],
      actions: [
        {
          id: 'scimitar',
          name: 'Scimitar',
          description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
          actionCost: 'action',
          targeting: { type: 'single', rangeFeet: 5, targetFilter: 'enemy' },
          effects: [
            {
              step: 'attack_roll',
              attackType: 'melee_weapon',
              attackBonusOverride: 4,
              onHit: [
                {
                  step: 'deal_damage',
                  diceFormula: '1d6 + 2',
                  damageType: 'slashing',
                },
              ],
            },
          ],
        },
        {
          id: 'shortbow',
          name: 'Shortbow',
          description: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.',
          actionCost: 'action',
          targeting: { type: 'single', rangeFeet: 80, targetFilter: 'enemy' },
          effects: [
            {
              step: 'attack_roll',
              attackType: 'ranged_weapon',
              attackBonusOverride: 4,
              onHit: [
                {
                  step: 'deal_damage',
                  diceFormula: '1d6 + 2',
                  damageType: 'piercing',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(goblin.challengeRating).toBe(0.25);
    expect(goblin.skills.stealth).toBe(6);
    expect(goblin.actions).toHaveLength(2);

    const adultBlackDragon = MonsterSchema.parse({
      id: 'adult-black-dragon',
      name: 'Adult Black Dragon',
      size: 'huge',
      type: 'dragon',
      alignment: 'chaotic_evil',
      armorClass: {
        value: 19,
        type: 'natural',
      },
      hitPoints: {
        average: 195,
        rollFormula: '17d12 + 85',
      },
      speed: {
        walk: 40,
        fly: 80,
        swim: 40,
      },
      abilities: { str: 23, dex: 14, con: 21, int: 14, wis: 13, cha: 17 },
      savingThrows: { dex: 7, con: 10, wis: 6, cha: 8 },
      skills: { perception: 11, stealth: 7 },
      damageVulnerabilities: [],
      damageResistances: [],
      damageImmunities: ['acid'],
      conditionImmunities: [],
      senses: {
        blindsightFeet: 60,
        darkvisionFeet: 120,
        passivePerception: 21,
      },
      languages: ['common', 'draconic'],
      challengeRating: 14,
      xp: 11500,
      aiArchetype: 'artillery',
      traits: [
        {
          id: 'amphibious',
          name: 'Amphibious',
          description: 'The dragon can breathe air and water.',
        },
      ],
      actions: [
        {
          id: 'multiattack',
          name: 'Multiattack',
          description: 'The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.',
          actionCost: 'action',
          multiattack: {
            sequence: [
              { actionId: 'bite', count: 1 },
              { actionId: 'claw', count: 2 },
            ],
          },
          effects: [],
        },
        {
          id: 'bite',
          name: 'Bite',
          description: 'Melee Weapon Attack: +11 to hit, reach 10 ft., one target.',
          actionCost: 'action',
          targeting: { type: 'single', rangeFeet: 10, targetFilter: 'enemy' },
          effects: [
            {
              step: 'attack_roll',
              attackType: 'melee_weapon',
              attackBonusOverride: 11,
              onHit: [
                { step: 'deal_damage', diceFormula: '2d10 + 6', damageType: 'piercing' },
                { step: 'deal_damage', diceFormula: '1d8', damageType: 'acid' },
              ],
            },
          ],
        },
        {
          id: 'claw',
          name: 'Claw',
          description: 'Melee Weapon Attack: +11 to hit, reach 5 ft., one target.',
          actionCost: 'action',
          targeting: { type: 'single', rangeFeet: 5, targetFilter: 'enemy' },
          effects: [
            {
              step: 'attack_roll',
              attackType: 'melee_weapon',
              attackBonusOverride: 11,
              onHit: [
                { step: 'deal_damage', diceFormula: '2d6 + 6', damageType: 'slashing' },
              ],
            },
          ],
        },
        {
          id: 'acid-breath',
          name: 'Acid Breath (Recharge 5–6)',
          description: 'The dragon exhales acid in a 60-foot line that is 5 feet wide.',
          actionCost: 'action',
          recharge: { minRoll: 5, die: 6 },
          targeting: {
            type: 'self_aoe',
            rangeFeet: 0,
            aoe: { shape: 'line', sizeFeet: 60, widthFeet: 5 },
          },
          effects: [
            {
              step: 'saving_throw',
              ability: 'dex',
              dcFormula: '18',
              onFail: [
                {
                  step: 'deal_damage',
                  diceFormula: '12d8',
                  damageType: 'acid',
                  halfOnSaveSuccess: true,
                },
              ],
            },
          ],
        },
      ],
      legendaryActions: {
        perRound: 3,
        actions: [
          {
            id: 'tail-attack',
            name: 'Tail Attack',
            description: 'The dragon makes a tail attack.',
            actionCost: 'special',
            legendaryCost: 1,
            targeting: { type: 'single', rangeFeet: 15, targetFilter: 'enemy' },
            effects: [
              {
                step: 'attack_roll',
                attackType: 'melee_weapon',
                attackBonusOverride: 11,
                onHit: [
                  { step: 'deal_damage', diceFormula: '2d8 + 6', damageType: 'bludgeoning' },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(adultBlackDragon.challengeRating).toBe(14);
    expect(adultBlackDragon.legendaryActions?.perRound).toBe(3);
  });

  it('rejects invalid Challenge Ratings or unknown skill keys on MonsterSchema', () => {
    expect(
      MonsterSchema.safeParse({
        id: 'invalid-cr-monster',
        name: 'Invalid CR',
        size: 'medium',
        type: 'beast',
        alignment: 'unaligned',
        armorClass: { value: 12, type: 'natural' },
        hitPoints: { average: 10, rollFormula: '2d8 + 2' },
        speed: { walk: 30 },
        abilities: { str: 10, dex: 10, con: 10, int: 2, wis: 10, cha: 5 },
        savingThrows: {},
        skills: {},
        damageVulnerabilities: [],
        damageResistances: [],
        damageImmunities: [],
        conditionImmunities: [],
        senses: { passivePerception: 10 },
        languages: [],
        challengeRating: 0.75, // invalid SRD CR
        xp: 100,
        aiArchetype: 'brute',
        traits: [],
        actions: [],
      }).success,
    ).toBe(false);
  });
});
