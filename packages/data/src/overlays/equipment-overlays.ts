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
  'flame-tongue': {
    requiresAttunement: true,
    baseEquipmentId: 'longsword',
    modifiers: [],
    activatedAbilities: [
      {
        id: 'ignite-flame-tongue',
        name: 'Ignite Flame Tongue',
        description:
          'You use a bonus action to speak the command word, causing flames to erupt from the blade (bright light 40 ft, dim light 40 ft). While ablaze, the sword deals an extra 2d6 fire damage to any target it hits. Use a bonus action to speak the command word again (or drop or sheathe the sword) to extinguish the flames.',
        actionCost: 'bonus_action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'flame-tongue-ablaze',
            name: 'Flame Tongue Ablaze',
            durationRounds: 600,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  'periapt-of-wound-closure': {
    requiresAttunement: true,
    modifiers: [],
    activatedAbilities: [
      {
        id: 'periapt-wound-closure',
        name: 'Wound Closure',
        description:
          'While you wear this pendant, you stabilize whenever you are dying at the start of your turn, and whenever you roll a Hit Die to regain hit points, double the number of hit points it restores. (Passive — no action required.)',
        actionCost: 'action',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'manual_adjudication',
            adjudicationId: 'periapt-wound-closure',
            title: 'Wound Closure',
            guidance:
              'You stabilize at 0 HP (death saves reset, stable) at the start of your turn while dying, and you double Hit Die healing while attuned and wearing this pendant.',
          },
        ],
      },
    ],
  },
  'bag-of-holding': {
    requiresAttunement: false,
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'bag-of-holding-capacity',
        name: 'Bag of Holding Capacity (500 lb)',
        maxFormula: '500',
        recovery: 'dawn',
      },
    ],
  },
  'scroll-of-fireball': {
    requiresAttunement: false,
    modifiers: [],
    activatedAbilities: [
      {
        id: 'cast-fireball-from-scroll',
        name: 'Cast Fireball (Scroll)',
        description:
          'A spell scroll bearing the words of the fireball spell (Save DC 15). Casting from the scroll is slot-free and consumes the scroll.',
        actionCost: 'action',
        targeting: {
          type: 'point_aoe',
          rangeFeet: 150,
          aoe: { shape: 'sphere', sizeFeet: 20 },
        },
        effects: [
          {
            step: 'saving_throw',
            ability: 'dex',
            dcFormula: '15',
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
      },
    ],
  },
  'rod-of-the-pact-keeper-plus-1': {
    requiresAttunement: true,
    attunementRestriction: 'warlock',
    modifiers: [
      { type: 'flat_bonus', target: 'spell_attack', value: 1 },
      { type: 'flat_bonus', target: 'spell_save_dc', value: 1 },
    ],
  },
  'ring-of-fire-resistance': {
    requiresAttunement: true,
    modifiers: [
      { type: 'damage_mitigation', mitigation: 'resistance', damageTypes: ['fire'] },
    ],
  },
  'pearl-of-power': {
    requiresAttunement: true,
    attunementRestriction: 'spellcaster',
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'pearl-of-power',
        name: 'Pearl of Power',
        maxFormula: '1',
        recovery: 'dawn',
      },
    ],
  },
};
