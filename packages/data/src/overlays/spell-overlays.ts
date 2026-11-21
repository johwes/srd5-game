import type { SpellOverlaySpec } from '../ingestion/overlay.js';

/**
 * Declarative Effect & Modifier DSL overlays for core SRD 5.1 Spells.
 */
export const SRD_SPELL_OVERLAYS: Readonly<Record<string, SpellOverlaySpec>> = {
  // Cantrips (Level 0)
  'acid-splash': {
    targeting: {
      type: 'multiple',
      rangeFeet: 60,
      targetFilter: 'creature',
      maxTargets: 2,
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '1d6',
            damageType: 'acid',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d6' },
        '11': { diceFormula: '3d6' },
        '17': { diceFormula: '4d6' },
      },
    },
  },
  'chill-touch': {
    targeting: {
      type: 'single',
      rangeFeet: 120,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d8',
            damageType: 'necrotic',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d8' },
        '11': { diceFormula: '3d8' },
        '17': { diceFormula: '4d8' },
      },
    },
  },
  'eldritch-blast': {
    targeting: {
      type: 'multiple',
      rangeFeet: 120,
      targetFilter: 'creature',
      maxTargets: 1,
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d10',
            damageType: 'force',
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
  },
  'fire-bolt': {
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
  },
  'poison-spray': {
    targeting: {
      type: 'single',
      rangeFeet: 10,
      requiresSight: true,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'con',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '1d12',
            damageType: 'poison',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d12' },
        '11': { diceFormula: '3d12' },
        '17': { diceFormula: '4d12' },
      },
    },
  },
  'produce-flame': {
    targeting: {
      type: 'single',
      rangeFeet: 30,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d8',
            damageType: 'fire',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d8' },
        '11': { diceFormula: '3d8' },
        '17': { diceFormula: '4d8' },
      },
    },
  },
  'ray-of-frost': {
    targeting: {
      type: 'single',
      rangeFeet: 60,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d8',
            damageType: 'cold',
            isMagical: true,
          },
          {
            step: 'apply_active_effect',
            effectId: 'ray-of-frost-slow',
            name: 'Ray of Frost (-10 ft Speed)',
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'flat_bonus',
                target: 'speed',
                value: -10,
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d8' },
        '11': { diceFormula: '3d8' },
        '17': { diceFormula: '4d8' },
      },
    },
  },
  'sacred-flame': {
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '1d8',
            damageType: 'radiant',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d8' },
        '11': { diceFormula: '3d8' },
        '17': { diceFormula: '4d8' },
      },
    },
  },
  'shocking-grasp': {
    targeting: {
      type: 'touch',
      rangeFeet: 5,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'melee_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d8',
            damageType: 'lightning',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d8' },
        '11': { diceFormula: '3d8' },
        '17': { diceFormula: '4d8' },
      },
    },
  },
  'vicious-mockery': {
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '1d4',
            damageType: 'psychic',
            isMagical: true,
          },
          {
            step: 'apply_active_effect',
            effectId: 'vicious-mockery-disadvantage',
            name: 'Vicious Mockery',
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'roll_mode',
                mode: 'disadvantage',
                target: 'attack_rolls',
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'character_level',
      overrides: {
        '5': { diceFormula: '2d4' },
        '11': { diceFormula: '3d4' },
        '17': { diceFormula: '4d4' },
      },
    },
  },

  // Level 1 Spells
  bane: {
    targeting: {
      type: 'multiple',
      rangeFeet: 30,
      requiresSight: true,
      targetFilter: 'enemy',
      maxTargets: 3,
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'cha',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'apply_active_effect',
            effectId: 'bane-debuff',
            name: 'Bane (-1d4 Attacks & Saves)',
            durationRounds: 10,
            requiresConcentration: true,
            modifiers: [
              {
                type: 'flat_bonus',
                target: 'melee_attack',
                value: '-1d4',
              },
              {
                type: 'flat_bonus',
                target: 'ranged_attack',
                value: '-1d4',
              },
              {
                type: 'flat_bonus',
                target: 'spell_attack',
                value: '-1d4',
              },
              {
                type: 'flat_bonus',
                target: 'all_saving_throws',
                value: '-1d4',
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  bless: {
    subclasses: ['life'],
    targeting: {
      type: 'multiple',
      rangeFeet: 30,
      targetFilter: 'ally',
      maxTargets: 3,
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'bless-buff',
        name: 'Bless (+1d4 Attacks & Saves)',
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [
          {
            type: 'flat_bonus',
            target: 'melee_attack',
            value: '1d4',
          },
          {
            type: 'flat_bonus',
            target: 'ranged_attack',
            value: '1d4',
          },
          {
            type: 'flat_bonus',
            target: 'spell_attack',
            value: '1d4',
          },
          {
            type: 'flat_bonus',
            target: 'all_saving_throws',
            value: '1d4',
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  'burning-hands': {
    subclasses: ['fiend'],
    targeting: {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: { shape: 'cone', sizeFeet: 15 },
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '3d6',
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
  },
  'cure-wounds': {
    subclasses: ['life'],
    targeting: {
      type: 'touch',
      rangeFeet: 5,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'heal',
        diceFormula: '1d8 + @spellMod',
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d8',
    },
  },
  'false-life': {
    targeting: {
      type: 'self',
      rangeFeet: 0,
    },
    effects: [
      {
        step: 'grant_temp_hp',
        amountFormula: '1d4 + 4',
      },
    ],
  },
  'guiding-bolt': {
    targeting: {
      type: 'single',
      rangeFeet: 120,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '4d6',
            damageType: 'radiant',
            isMagical: true,
          },
          {
            step: 'apply_active_effect',
            effectId: 'guiding-bolt-advantage',
            name: 'Guiding Bolt (Advantage Against Target)',
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'roll_mode',
                mode: 'advantage',
                target: 'attacks_against_self',
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d6',
    },
  },
  'healing-word': {
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'heal',
        diceFormula: '1d4 + @spellMod',
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d4',
    },
  },
  'hellish-rebuke': {
    reactionTrigger: {
      event: 'damaged_by_visible_creature_within_60ft',
      rangeFeet: 60,
      description: 'In response to being damaged by a creature within 60 feet that you can see',
    },
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'enemy',
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '2d10',
            damageType: 'fire',
            halfOnSaveSuccess: true,
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d10',
    },
  },
  'inflict-wounds': {
    targeting: {
      type: 'touch',
      rangeFeet: 5,
      targetFilter: 'creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'melee_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '3d10',
            damageType: 'necrotic',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d10',
    },
  },
  'mage-armor': {
    targeting: {
      type: 'touch',
      rangeFeet: 5,
      targetFilter: 'willing',
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'mage-armor',
        name: 'Mage Armor (AC 13 + DEX)',
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [
          {
            type: 'ac_calculation',
            id: 'mage_armor',
            formula: '13 + @dexMod',
            allowsShield: true,
            requiresNoArmor: true,
          },
        ],
      },
    ],
  },
  'magic-missile': {
    targeting: {
      type: 'multiple',
      rangeFeet: 120,
      requiresSight: true,
      targetFilter: 'creature',
      maxTargets: '3 + (@slotLevel - 1)',
    },
    effects: [
      {
        step: 'deal_damage',
        diceFormula: '1d4 + 1',
        damageType: 'force',
        isMagical: true,
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  shield: {
    reactionTrigger: {
      event: 'hit_by_attack',
      description: 'When you are hit by an attack or targeted by the magic missile spell',
    },
    targeting: {
      type: 'self',
      rangeFeet: 0,
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'shield-ac-bonus',
        name: 'Shield (+5 AC)',
        durationRounds: 1,
        requiresConcentration: false,
        modifiers: [
          {
            type: 'flat_bonus',
            target: 'ac',
            value: 5,
          },
        ],
      },
    ],
  },
  'shield-of-faith': {
    subclasses: ['devotion'],
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'ally',
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'shield-of-faith-ac',
        name: 'Shield of Faith (+2 AC)',
        durationRounds: 100,
        requiresConcentration: true,
        modifiers: [
          {
            type: 'flat_bonus',
            target: 'ac',
            value: 2,
          },
        ],
      },
    ],
  },
  thunderwave: {
    targeting: {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: { shape: 'cube', sizeFeet: 15 },
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'con',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '2d8',
            damageType: 'thunder',
            halfOnSaveSuccess: true,
            isMagical: true,
          },
          {
            step: 'forced_movement',
            direction: 'push_from_actor',
            distanceFeet: 10,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d8',
    },
  },

  // Level 2 Spells
  'acid-arrow': {
    subclasses: ['land'],
    targeting: {
      type: 'single',
      rangeFeet: 90,
      targetFilter: 'object_or_creature',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '4d4',
            damageType: 'acid',
            isMagical: true,
          },
        ],
        onMiss: [
          {
            step: 'deal_damage',
            diceFormula: '2d4',
            damageType: 'acid',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d4',
    },
  },
  'hold-person': {
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'enemy',
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'apply_condition',
            conditionId: 'paralyzed',
            durationRounds: 10,
            requiresConcentration: true,
            repeatSaveAtTurnEnd: {
              ability: 'wis',
              dcFormula: '@spellSaveDC',
            },
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  'misty-step': {
    subclasses: ['land'],
    targeting: {
      type: 'self',
      rangeFeet: 0,
    },
    effects: [
      {
        step: 'teleport',
        maxDistanceFeet: 30,
      },
    ],
  },
  'scorching-ray': {
    subclasses: ['fiend'],
    targeting: {
      type: 'multiple',
      rangeFeet: 120,
      targetFilter: 'creature',
      maxTargets: 3,
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'ranged_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '2d6',
            damageType: 'fire',
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  shatter: {
    targeting: {
      type: 'point_aoe',
      rangeFeet: 60,
      aoe: { shape: 'sphere', sizeFeet: 10 },
    },
    effects: [
      {
        step: 'saving_throw',
        ability: 'con',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'deal_damage',
            diceFormula: '3d8',
            damageType: 'thunder',
            halfOnSaveSuccess: true,
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d8',
    },
  },
  'spiritual-weapon': {
    subclasses: ['life'],
    targeting: {
      type: 'single',
      rangeFeet: 60,
      targetFilter: 'enemy',
    },
    effects: [
      {
        step: 'attack_roll',
        attackType: 'melee_spell',
        onHit: [
          {
            step: 'deal_damage',
            diceFormula: '1d8 + @spellMod',
            damageType: 'force',
            isMagical: true,
          },
        ],
      },
    ],
  },
  web: {
    subclasses: ['land'],
    targeting: {
      type: 'point_aoe',
      rangeFeet: 60,
      aoe: { shape: 'cube', sizeFeet: 20 },
    },
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'web-zone',
        shape: 'cube',
        sizeFeet: 20,
        durationRounds: 600,
        requiresConcentration: true,
        difficultTerrain: true,
        obscurement: 'light',
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'dex',
            dcFormula: '@spellSaveDC',
            onFail: [
              {
                step: 'apply_condition',
                conditionId: 'restrained',
                durationRounds: 600,
                requiresConcentration: true,
              },
            ],
          },
        ],
      },
    ],
  },

  // Level 3 Spells
  counterspell: {
    reactionTrigger: {
      event: 'creature_within_60ft_casts_spell',
      rangeFeet: 60,
      description: 'When you see a creature within 60 feet of you casting a spell',
    },
    targeting: {
      type: 'single',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'enemy',
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'counterspell-intercept',
        name: 'Counterspell',
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  fireball: {
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
  },
  haste: {
    subclasses: ['land'],
    targeting: {
      type: 'single',
      rangeFeet: 30,
      requiresSight: true,
      targetFilter: 'willing',
    },
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'haste-buff',
        name: 'Haste (+2 AC, Advantage DEX Save, Double Speed)',
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [
          {
            type: 'flat_bonus',
            target: 'ac',
            value: 2,
          },
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'save:dex',
          },
          {
            type: 'flat_bonus',
            target: 'speed',
            value: 30,
          },
        ],
      },
    ],
  },
  'lightning-bolt': {
    subclasses: ['land'],
    targeting: {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: { shape: 'line', sizeFeet: 100, widthFeet: 5 },
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
            damageType: 'lightning',
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
  },
  'mass-healing-word': {
    targeting: {
      type: 'multiple',
      rangeFeet: 60,
      requiresSight: true,
      targetFilter: 'ally',
      maxTargets: 6,
    },
    effects: [
      {
        step: 'heal',
        diceFormula: '1d4 + @spellMod',
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d4',
    },
  },
  revivify: {
    subclasses: ['life'],
    targeting: {
      type: 'touch',
      rangeFeet: 5,
      targetFilter: 'corpse',
    },
    effects: [
      {
        step: 'heal',
        diceFormula: '1',
      },
    ],
  },
  'spirit-guardians': {
    targeting: {
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: { shape: 'sphere', sizeFeet: 15 },
    },
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'spirit-guardians-zone',
        shape: 'sphere',
        sizeFeet: 15,
        durationRounds: 100,
        requiresConcentration: true,
        difficultTerrain: true,
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'wis',
            dcFormula: '@spellSaveDC',
            onFail: [
              {
                step: 'deal_damage',
                diceFormula: '3d8',
                damageType: 'radiant',
                halfOnSaveSuccess: true,
                isMagical: true,
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: 'slot_level',
      bonusDicePerSlotAboveBase: '1d8',
    },
  },

  // --- Combat Tier A Spells (Level 0 - Level 3 additions) ---
  aid: {
    targeting: {
      type: "multiple",
      rangeFeet: 30,
      targetFilter: "ally",
      maxTargets: 3,
    },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "aid-buff",
        name: "Aid (+5 HP)",
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [
          {
            type: "flat_bonus",
            target: "hp_per_level",
            value: 0,
          },
        ],
      },
      {
        step: "heal",
        diceFormula: "5",
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusDicePerSlotAboveBase: "5",
    },
  },
  "arcanists-magic-aura": {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "arcanists-magic-aura-active",
        name: "Arcanist Magic Aura",
        durationRounds: 14400,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  barkskin: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "barkskin-buff",
        name: "Barkskin",
        durationRounds: 600,
        requiresConcentration: true,
        modifiers: [
          {
            type: "ac_calculation",
            id: "barkskin",
            formula: "16",
            allowsShield: true,
            requiresNoArmor: false,
          },
        ],
      },
    ],
  },
  "beacon-of-hope": {
    targeting: { type: "self_aoe", rangeFeet: 0, aoe: { shape: "sphere", sizeFeet: 30 }, targetFilter: "ally" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "beacon-of-hope-buff",
        name: "Beacon of Hope",
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "save:wis",
          },
        ],
      },
    ],
  },
  "blindness-deafness": {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "saving_throw",
        ability: "con",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "blinded",
            durationRounds: 10,
            repeatSaveAtTurnEnd: {
              ability: "con",
              dcFormula: "@spellSaveDC",
            },
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  "call-lightning": {
    targeting: { type: "point_aoe", rangeFeet: 120, aoe: { shape: "cylinder", sizeFeet: 5 } },
    effects: [
      {
        step: "saving_throw",
        ability: "dex",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "deal_damage",
            diceFormula: "3d10",
            damageType: "lightning",
            halfOnSaveSuccess: true,
            isMagical: true,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusDicePerSlotAboveBase: "1d10",
    },
  },
  "charm-person": {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "charmed",
            durationRounds: 600,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  command: {
    targeting: { type: "single", rangeFeet: 60, targetFilter: "creature" },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_active_effect",
            effectId: "command-compelled",
            name: "Command",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  "dancing-lights": {
    targeting: { type: "point_aoe", rangeFeet: 120 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "dancing-lights-active",
        name: "Dancing Lights",
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [],
      },
    ],
  },
  darkness: {
    targeting: { type: "point_aoe", rangeFeet: 60, aoe: { shape: "sphere", sizeFeet: 15 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "darkness-zone",
        shape: "sphere",
        sizeFeet: 15,
        durationRounds: 100,
        requiresConcentration: true,
        difficultTerrain: false,
        obscurement: "heavy",
        onEnterOrStartTurn: [],
      },
    ],
  },
  "detect-magic": {
    targeting: { type: "self", rangeFeet: 0 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "detect-magic-active",
        name: "Detect Magic",
        durationRounds: 100,
        requiresConcentration: true,
        modifiers: [],
      },
    ],
  },
  "dispel-magic": {
    targeting: { type: "single", rangeFeet: 120, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "dispel-magic-resolved",
        name: "Dispel Magic",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  druidcraft: {
    targeting: { type: "point_aoe", rangeFeet: 30 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "druidcraft-effect",
        name: "Druidcraft",
        durationRounds: 1,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  entangle: {
    targeting: { type: "point_aoe", rangeFeet: 90, aoe: { shape: "cube", sizeFeet: 20 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "entangle-zone",
        shape: "cube",
        sizeFeet: 20,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: true,
        onEnterOrStartTurn: [
          {
            step: "saving_throw",
            ability: "str",
            dcFormula: "@spellSaveDC",
            onFail: [
              {
                step: "apply_condition",
                conditionId: "restrained",
                durationRounds: 10,
                repeatSaveAtTurnEnd: {
                  ability: "str",
                  dcFormula: "@spellSaveDC",
                },
              },
            ],
          },
        ],
      },
    ],
  },
  "faerie-fire": {
    targeting: { type: "point_aoe", rangeFeet: 60, aoe: { shape: "cube", sizeFeet: 20 } },
    effects: [
      {
        step: "saving_throw",
        ability: "dex",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_active_effect",
            effectId: "faerie-fire-glowing",
            name: "Faerie Fire",
            durationRounds: 10,
            requiresConcentration: true,
            modifiers: [
              {
                type: "roll_mode",
                mode: "advantage",
                target: "attacks_against_self",
              },
            ],
          },
        ],
      },
    ],
  },
  fear: {
    targeting: { type: "self_aoe", rangeFeet: 0, aoe: { shape: "cone", sizeFeet: 30 } },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "frightened",
            durationRounds: 10,
            repeatSaveAtTurnEnd: {
              ability: "wis",
              dcFormula: "@spellSaveDC",
            },
          },
        ],
      },
    ],
  },
  "feather-fall": {
    reactionTrigger: {
      event: "creature_falls",
      rangeFeet: 60,
    },
    targeting: { type: "multiple", rangeFeet: 60, maxTargets: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "feather-fall-buff",
        name: "Feather Fall",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "flaming-sphere": {
    targeting: { type: "point_aoe", rangeFeet: 60, aoe: { shape: "sphere", sizeFeet: 5 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "flaming-sphere-zone",
        shape: "sphere",
        sizeFeet: 5,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: false,
        onEnterOrStartTurn: [
          {
            step: "saving_throw",
            ability: "dex",
            dcFormula: "@spellSaveDC",
            onFail: [
              {
                step: "deal_damage",
                diceFormula: "2d6",
                damageType: "fire",
                halfOnSaveSuccess: true,
                isMagical: true,
              },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusDicePerSlotAboveBase: "1d6",
    },
  },
  "floating-disk": {
    targeting: { type: "self", rangeFeet: 0 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "floating-disk-active",
        name: "Floating Disk",
        durationRounds: 600,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  fly: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "fly-buff",
        name: "Fly",
        durationRounds: 100,
        requiresConcentration: true,
        modifiers: [
          {
            type: "flat_bonus",
            target: "speed",
            value: 30,
          },
        ],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  grease: {
    targeting: { type: "point_aoe", rangeFeet: 60, aoe: { shape: "cube", sizeFeet: 10 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "grease-zone",
        shape: "cube",
        sizeFeet: 10,
        durationRounds: 10,
        requiresConcentration: false,
        difficultTerrain: true,
        onEnterOrStartTurn: [
          {
            step: "saving_throw",
            ability: "dex",
            dcFormula: "@spellSaveDC",
            onFail: [
              {
                step: "apply_condition",
                conditionId: "prone",
              },
            ],
          },
        ],
      },
    ],
  },
  guidance: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "guidance-buff",
        name: "Guidance",
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [],
      },
    ],
  },
  heroism: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "heroism-buff",
        name: "Heroism",
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [
          {
            type: "condition_immunity",
            conditions: ["frightened"],
          },
        ],
      },
      {
        step: "grant_temp_hp",
        amountFormula: "max(1, @spellMod)",
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  "hideous-laughter": {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "incapacitated",
            durationRounds: 10,
            repeatSaveAtTurnEnd: {
              ability: "wis",
              dcFormula: "@spellSaveDC",
            },
          },
          {
            step: "apply_condition",
            conditionId: "prone",
          },
        ],
      },
    ],
  },
  "hunters-mark": {
    targeting: { type: "single", rangeFeet: 90, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "hunters-mark-target",
        name: "Hunters Mark",
        durationRounds: 600,
        requiresConcentration: true,
        modifiers: [
          {
            type: "flat_bonus",
            target: "ranged_damage",
            value: "1d6",
          },
          {
            type: "flat_bonus",
            target: "melee_damage",
            value: "1d6",
          },
        ],
      },
    ],
  },
  "hypnotic-pattern": {
    targeting: { type: "point_aoe", rangeFeet: 120, aoe: { shape: "cube", sizeFeet: 30 } },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "charmed",
            durationRounds: 10,
          },
          {
            step: "apply_condition",
            conditionId: "incapacitated",
            durationRounds: 10,
          },
        ],
      },
    ],
  },
  identify: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "identify-done",
        name: "Identify",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  invisibility: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_condition",
        conditionId: "invisible",
        durationRounds: 600,
        requiresConcentration: true,
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusTargetsPerSlotAboveBase: 1,
    },
  },
  knock: {
    targeting: { type: "single", rangeFeet: 60, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "knock-unlocked",
        name: "Knock",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "lesser-restoration": {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "lesser-restoration-cure",
        name: "Lesser Restoration",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  light: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "light-active",
        name: "Light",
        durationRounds: 600,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "mage-hand": {
    targeting: { type: "point_aoe", rangeFeet: 30 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "mage-hand-active",
        name: "Mage Hand",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  mending: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "object_or_creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "mending-repair",
        name: "Mending",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "minor-illusion": {
    targeting: { type: "point_aoe", rangeFeet: 30 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "minor-illusion-active",
        name: "Minor Illusion",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "mirror-image": {
    targeting: { type: "self", rangeFeet: 0 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "mirror-image-buff",
        name: "Mirror Image",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "pass-without-trace": {
    targeting: { type: "self_aoe", rangeFeet: 0, aoe: { shape: "sphere", sizeFeet: 30 }, targetFilter: "ally" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "pass-without-trace-buff",
        name: "Pass without Trace",
        durationRounds: 600,
        requiresConcentration: true,
        modifiers: [
          {
            type: "flat_bonus",
            target: "skill:stealth",
            value: 10,
          },
        ],
      },
    ],
  },
  prestidigitation: {
    targeting: { type: "point_aoe", rangeFeet: 10 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "prestidigitation-active",
        name: "Prestidigitation",
        durationRounds: 600,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "protection-from-evil-and-good": {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "protection-evil-good-buff",
        name: "Protection from Evil and Good",
        durationRounds: 100,
        requiresConcentration: true,
        modifiers: [
          {
            type: "condition_immunity",
            conditions: ["charmed", "frightened"],
          },
        ],
      },
    ],
  },
  resistance: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "resistance-buff",
        name: "Resistance",
        durationRounds: 10,
        requiresConcentration: true,
        modifiers: [
          {
            type: "flat_bonus",
            target: "all_saving_throws",
            value: "1d4",
          },
        ],
      },
    ],
  },
  sanctuary: {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "sanctuary-ward",
        name: "Sanctuary",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  shillelagh: {
    targeting: { type: "touch", rangeFeet: 5 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "shillelagh-buff",
        name: "Shillelagh",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  silence: {
    targeting: { type: "point_aoe", rangeFeet: 120, aoe: { shape: "sphere", sizeFeet: 20 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "silence-zone",
        shape: "sphere",
        sizeFeet: 20,
        durationRounds: 100,
        requiresConcentration: true,
        difficultTerrain: false,
        onEnterOrStartTurn: [],
      },
    ],
  },
  sleep: {
    targeting: { type: "point_aoe", rangeFeet: 90, aoe: { shape: "sphere", sizeFeet: 20 } },
    effects: [
      {
        step: "apply_condition",
        conditionId: "unconscious",
        durationRounds: 10,
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      bonusDicePerSlotAboveBase: "2d8",
    },
  },
  slow: {
    targeting: { type: "point_aoe", rangeFeet: 120, aoe: { shape: "cube", sizeFeet: 40 }, maxTargets: 6 },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_active_effect",
            effectId: "slow-debuff",
            name: "Slow",
            durationRounds: 10,
            requiresConcentration: true,
            modifiers: [
              {
                type: "flat_bonus",
                target: "ac",
                value: -2,
              },
              {
                type: "flat_bonus",
                target: "save:dex",
                value: -2,
              },
              {
                type: "flat_bonus",
                target: "speed",
                value: -15,
              },
            ],
          },
        ],
      },
    ],
  },
  "spare-the-dying": {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "spare-the-dying-stabilized",
        name: "Spare the Dying",
        durationRounds: 0,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "spike-growth": {
    targeting: { type: "point_aoe", rangeFeet: 150, aoe: { shape: "sphere", sizeFeet: 20 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "spike-growth-zone",
        shape: "sphere",
        sizeFeet: 20,
        durationRounds: 100,
        requiresConcentration: true,
        difficultTerrain: true,
        onEnterOrStartTurn: [
          {
            step: "deal_damage",
            diceFormula: "2d4",
            damageType: "piercing",
            isMagical: true,
          },
        ],
      },
    ],
  },
  "stinking-cloud": {
    targeting: { type: "point_aoe", rangeFeet: 90, aoe: { shape: "sphere", sizeFeet: 20 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "stinking-cloud-zone",
        shape: "sphere",
        sizeFeet: 20,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: false,
        obscurement: "heavy",
        onEnterOrStartTurn: [
          {
            step: "saving_throw",
            ability: "con",
            dcFormula: "@spellSaveDC",
            onFail: [
              {
                step: "apply_condition",
                conditionId: "incapacitated",
                durationRounds: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  suggestion: {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "saving_throw",
        ability: "wis",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_condition",
            conditionId: "charmed",
            durationRounds: 4800,
            requiresConcentration: true,
          },
        ],
      },
    ],
  },
  thaumaturgy: {
    targeting: { type: "point_aoe", rangeFeet: 30 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "thaumaturgy-wonder",
        name: "Thaumaturgy",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "tiny-hut": {
    targeting: { type: "self_aoe", rangeFeet: 0, aoe: { shape: "sphere", sizeFeet: 10 } },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "tiny-hut-dome",
        name: "Tiny Hut",
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  "true-strike": {
    targeting: { type: "single", rangeFeet: 30, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "true-strike-advantage",
        name: "True Strike",
        durationRounds: 1,
        requiresConcentration: true,
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    ],
  },
  "zone-of-truth": {
    targeting: { type: "point_aoe", rangeFeet: 60, aoe: { shape: "sphere", sizeFeet: 15 } },
    effects: [
      {
        step: "saving_throw",
        ability: "cha",
        dcFormula: "@spellSaveDC",
        onFail: [
          {
            step: "apply_active_effect",
            effectId: "zone-of-truth-bound",
            name: "Zone of Truth",
            durationRounds: 100,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  "fog-cloud": {
    targeting: { type: "point_aoe", rangeFeet: 120, aoe: { shape: "sphere", sizeFeet: 20 } },
    effects: [
      {
        step: "create_hazard_zone",
        zoneId: "fog-cloud-zone",
        shape: "sphere",
        sizeFeet: 20,
        durationRounds: 600,
        requiresConcentration: true,
        difficultTerrain: false,
        obscurement: "heavy",
        onEnterOrStartTurn: [],
      },
    ],
    higherLevelScaling: {
      mode: "slot_level",
      overrides: {
        "2": { sizeFeet: 40 },
        "3": { sizeFeet: 60 },
        "4": { sizeFeet: 80 },
      },
    },
  },
  "blink": {
    targeting: { type: "self", rangeFeet: 0 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "blink-active",
        name: "Blink",
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [],
      },
      {
        step: "manual_adjudication",
        adjudicationId: "blink-vanish",
        title: "Blink — Vanish to Ethereal Plane",
        guidance:
          "At the end of each of your turns, roll a d20. On an 11 or higher, you vanish to the Ethereal Plane until the start of your next turn.",
      },
    ],
  },
  "protection-from-energy": {
    targeting: { type: "single", rangeFeet: 5, targetFilter: "creature" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "protection-from-energy-buff",
        name: "Protection from Energy",
        durationRounds: 600,
        requiresConcentration: true,
        modifiers: [
          {
            type: "damage_mitigation",
            mitigation: "resistance",
            damageTypes: ["fire"],
          },
        ],
      },
    ],
  },
  // --- SRD-1201: Tabletop Fidelity language comprehension buffs ---
  // Same attach path as `bless` (apply_active_effect); consumed by the
  // party-level language gate resolution (§2.2, SRD-1202).
  "comprehend-languages": {
    targeting: { type: "self", rangeFeet: 0 },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "comprehend-languages-understanding",
        name: "Comprehend Languages",
        durationRounds: 600,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
  tongues: {
    targeting: { type: "touch", rangeFeet: 5, targetFilter: "willing" },
    effects: [
      {
        step: "apply_active_effect",
        effectId: "tongues-understanding",
        name: "Tongues",
        durationRounds: 600,
        requiresConcentration: false,
        modifiers: [],
      },
    ],
  },
};
