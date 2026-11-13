import type { GearOverlaySpec, MagicItemOverlaySpec } from '../ingestion/overlay.js';

/**
 * Declarative Effect & Modifier DSL overlays for SRD 5.1 Adventuring Gear items.
 */
export const SRD_GEAR_OVERLAYS: Readonly<Record<string, GearOverlaySpec>> = {
  'potion-of-healing': {
    activatedAbilities: [
      {
        id: 'drink-potion-of-healing',
        name: 'Drink Potion of Healing',
        description: 'You regain 2d4 + 2 hit points when you drink this potion.',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'heal',
            diceFormula: '2d4 + 2',
          },
        ],
      },
    ],
  },
  'acid-vial': {
    activatedAbilities: [
      {
        id: 'throw-acid-vial',
        name: 'Throw Acid Vial',
        description:
          'Make a ranged attack against a creature or object within 20 feet, treating the acid as an improvised weapon. On a hit, the target takes 2d6 acid damage.',
        actionCost: 'action',
        targeting: {
          type: 'single',
          rangeFeet: 20,
          targetFilter: 'object_or_creature',
        },
        effects: [
          {
            step: 'attack_roll',
            attackType: 'ranged_weapon',
            onHit: [
              {
                step: 'deal_damage',
                diceFormula: '2d6',
                damageType: 'acid',
              },
            ],
          },
        ],
      },
    ],
  },
  'alchemists-fire': {
    activatedAbilities: [
      {
        id: 'throw-alchemists-fire',
        name: "Throw Alchemist's Fire",
        description:
          'Make a ranged attack against a creature or object within 20 feet. On a hit, the target takes 1d4 fire damage at the start of each of its turns.',
        actionCost: 'action',
        targeting: {
          type: 'single',
          rangeFeet: 20,
          targetFilter: 'object_or_creature',
        },
        effects: [
          {
            step: 'attack_roll',
            attackType: 'ranged_weapon',
            onHit: [
              {
                step: 'deal_damage',
                diceFormula: '1d4',
                damageType: 'fire',
              },
            ],
          },
        ],
      },
    ],
  },
  antitoxin: {
    activatedAbilities: [
      {
        id: 'drink-antitoxin',
        name: 'Drink Antitoxin',
        description:
          'A creature that drinks this vial of liquid gains advantage on saving throws against poison for 1 hour.',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'antitoxin-buff',
            name: 'Antitoxin (Advantage vs Poison)',
            durationRounds: 600,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'roll_mode',
                mode: 'advantage',
                target: 'save:con',
                condition: 'save_against_poison',
              },
            ],
          },
        ],
      },
    ],
  },
};

/**
 * Declarative Effect & Modifier DSL overlays for SRD 5.1 Magic Items.
 */
export const SRD_MAGIC_ITEM_OVERLAYS: Readonly<Record<string, MagicItemOverlaySpec>> = {
  'cloak-of-protection': {
    requiresAttunement: true,
    modifiers: [
      { type: 'flat_bonus', target: 'ac', value: 1 },
      { type: 'flat_bonus', target: 'all_saving_throws', value: 1 },
    ],
  },
  'ring-of-protection': {
    requiresAttunement: true,
    modifiers: [
      { type: 'flat_bonus', target: 'ac', value: 1 },
      { type: 'flat_bonus', target: 'all_saving_throws', value: 1 },
    ],
  },
  'bracers-of-defense': {
    requiresAttunement: true,
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'ac',
        value: 2,
        condition: 'wearing_no_armor',
      },
    ],
  },
  'gauntlets-of-ogre-power': {
    requiresAttunement: true,
    modifiers: [
      {
        type: 'set_ability_minimum',
        ability: 'str',
        minimum: 19,
      },
    ],
  },
  'amulet-of-health': {
    requiresAttunement: true,
    modifiers: [
      {
        type: 'set_ability_minimum',
        ability: 'con',
        minimum: 19,
      },
    ],
  },
  'belt-of-hill-giant-strength': {
    requiresAttunement: true,
    modifiers: [
      {
        type: 'set_ability_minimum',
        ability: 'str',
        minimum: 21,
      },
    ],
  },
  'boots-of-elvenkind': {
    requiresAttunement: false,
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'skill:stealth',
      },
    ],
  },
  'cloak-of-elvenkind': {
    requiresAttunement: true,
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'skill:stealth',
      },
    ],
  },
  'weapon-plus-1': {
    requiresAttunement: false,
    modifiers: [
      { type: 'flat_bonus', target: 'melee_attack', value: 1 },
      { type: 'flat_bonus', target: 'ranged_attack', value: 1 },
      { type: 'flat_bonus', target: 'melee_damage', value: 1 },
      { type: 'flat_bonus', target: 'ranged_damage', value: 1 },
    ],
  },
  'weapon-plus-2': {
    requiresAttunement: false,
    modifiers: [
      { type: 'flat_bonus', target: 'melee_attack', value: 2 },
      { type: 'flat_bonus', target: 'ranged_attack', value: 2 },
      { type: 'flat_bonus', target: 'melee_damage', value: 2 },
      { type: 'flat_bonus', target: 'ranged_damage', value: 2 },
    ],
  },
  'weapon-plus-3': {
    requiresAttunement: false,
    modifiers: [
      { type: 'flat_bonus', target: 'melee_attack', value: 3 },
      { type: 'flat_bonus', target: 'ranged_attack', value: 3 },
      { type: 'flat_bonus', target: 'melee_damage', value: 3 },
      { type: 'flat_bonus', target: 'ranged_damage', value: 3 },
    ],
  },
  'armor-plus-1': {
    requiresAttunement: false,
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 1, condition: 'wearing_armor' }],
  },
  'armor-plus-2': {
    requiresAttunement: false,
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 2, condition: 'wearing_armor' }],
  },
  'armor-plus-3': {
    requiresAttunement: false,
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 3, condition: 'wearing_armor' }],
  },
  'shield-plus-1': {
    requiresAttunement: false,
    baseEquipmentId: 'shield',
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 1, condition: 'wielding_shield' }],
  },
  'shield-plus-2': {
    requiresAttunement: false,
    baseEquipmentId: 'shield',
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 2, condition: 'wielding_shield' }],
  },
  'shield-plus-3': {
    requiresAttunement: false,
    baseEquipmentId: 'shield',
    modifiers: [{ type: 'flat_bonus', target: 'ac', value: 3, condition: 'wielding_shield' }],
  },
  'potion-of-greater-healing': {
    requiresAttunement: false,
    modifiers: [],
    activatedAbilities: [
      {
        id: 'drink-potion-of-greater-healing',
        name: 'Drink Potion of Greater Healing',
        description: 'You regain 4d4 + 4 hit points when you drink this potion.',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'heal', diceFormula: '4d4 + 4' }],
      },
    ],
  },
  'potion-of-superior-healing': {
    requiresAttunement: false,
    modifiers: [],
    activatedAbilities: [
      {
        id: 'drink-potion-of-superior-healing',
        name: 'Drink Potion of Superior Healing',
        description: 'You regain 8d4 + 8 hit points when you drink this potion.',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'heal', diceFormula: '8d4 + 8' }],
      },
    ],
  },
  'potion-of-supreme-healing': {
    requiresAttunement: false,
    modifiers: [],
    activatedAbilities: [
      {
        id: 'drink-potion-of-supreme-healing',
        name: 'Drink Potion of Supreme Healing',
        description: 'You regain 10d4 + 20 hit points when you drink this potion.',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'heal', diceFormula: '10d4 + 20' }],
      },
    ],
  },
  'wand-of-magic-missiles': {
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
        description:
          'Expend 1 charge to cast magic missile as a 1st-level spell (3 darts dealing 1d4 + 1 force damage each).',
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
  },
};
