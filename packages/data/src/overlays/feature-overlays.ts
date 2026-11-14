import type { FeatOverlaySpec, FeatureOverlaySpec } from '../ingestion/overlay.js';

/**
 * Declarative Effect & Modifier DSL overlays for SRD 5.1 Class and Subclass Features.
 */
export const SRD_FEATURE_OVERLAYS: Readonly<Record<string, FeatureOverlaySpec>> = {
  // Barbarian
  rage: {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'rage',
        name: 'Rage',
        maxFormula: '2',
        recovery: 'long_rest',
      },
    ],
    activatedAbilities: [
      {
        id: 'enter-rage',
        name: 'Enter Rage',
        description:
          'Enter a rage as a bonus action for 1 minute (10 rounds): gain advantage on STR checks and saves, bonus melee STR damage, and resistance to bludgeoning, piercing, and slashing damage.',
        actionCost: 'bonus_action',
        resourceCost: { resourceId: 'rage', amount: 1 },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'barbarian-rage',
            name: 'Rage',
            durationRounds: 10,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'roll_mode',
                mode: 'advantage',
                target: 'save:str',
              },
              {
                type: 'flat_bonus',
                target: 'melee_damage',
                value: 2,
                condition: 'not_wearing_heavy_armor',
              },
              {
                type: 'damage_mitigation',
                mitigation: 'resistance',
                damageTypes: ['bludgeoning', 'piercing', 'slashing'],
              },
            ],
          },
        ],
      },
    ],
  },
  'barbarian-unarmored-defense': {
    modifiers: [
      {
        type: 'ac_calculation',
        id: 'unarmored_barbarian',
        formula: '10 + @dexMod + @conMod',
        allowsShield: true,
        requiresNoArmor: true,
      },
    ],
  },
  'danger-sense': {
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'save:dex',
        condition: 'save_against_traps',
      },
    ],
  },
  'fast-movement': {
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'speed',
        value: 10,
        condition: 'not_wearing_heavy_armor',
      },
    ],
  },
  'feral-instinct': {
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'initiative',
      },
    ],
  },
  'brutal-critical': {
    modifiers: [
      {
        type: 'die_manipulation',
        rule: 'brutal_critical',
        params: { extraDice: 1 },
      },
    ],
  },
  'primal-champion': {
    modifiers: [
      {
        type: 'ability_score',
        ability: 'str',
        bonus: 4,
        maxCap: 24,
      },
      {
        type: 'ability_score',
        ability: 'con',
        bonus: 4,
        maxCap: 24,
      },
    ],
  },

  // Bard
  'bardic-inspiration': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'bardic_inspiration',
        name: 'Bardic Inspiration',
        maxFormula: 'max(1, @chaMod)',
        recovery: 'long_rest',
      },
    ],
  },

  // Cleric
  'channel-divinity-cleric': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'channel_divinity',
        name: 'Channel Divinity',
        maxFormula: '1',
        recovery: 'short_rest',
      },
    ],
    activatedAbilities: [
      {
        id: 'turn-undead',
        name: 'Channel Divinity: Turn Undead',
        description: 'Each undead that can see or hear you within 30 feet must make a Wisdom saving throw or be turned for 1 minute.',
        actionCost: 'action',
        resourceCost: { resourceId: 'channel_divinity', amount: 1 },
        targeting: { type: 'self_aoe', rangeFeet: 0, aoe: { shape: 'sphere', sizeFeet: 30 } },
        effects: [
          {
            step: 'saving_throw',
            ability: 'wis',
            dcFormula: '@spellSaveDC',
            onFail: [
              {
                step: 'apply_condition',
                conditionId: 'frightened',
                durationRounds: 10,
              },
            ],
          },
        ],
      },
    ],
  },
  'channel-divinity-preserve-life': {
    activatedAbilities: [
      {
        id: 'preserve-life',
        name: 'Channel Divinity: Preserve Life',
        description:
          'As an action, restore up to 5 times your Cleric level in hit points divided among creatures within 30 feet (up to half a creature’s hit point maximum).',
        actionCost: 'action',
        resourceCost: { resourceId: 'channel_divinity', amount: 1 },
        targeting: {
          type: 'multiple',
          rangeFeet: 30,
          targetFilter: 'ally',
        },
        effects: [
          {
            step: 'heal',
            diceFormula: '5 * @classLevel',
          },
        ],
      },
    ],
  },

  // Fighter
  'fighting-style-fighter': {
    choices: [
      {
        id: 'fighter-fighting-style',
        label: 'Choose a Fighting Style',
        count: 1,
        type: 'feature_option',
        featureGroup: 'fighting-style',
        options: [
          'fighting-style-archery',
          'fighting-style-defense',
          'fighting-style-dueling',
          'fighting-style-great-weapon-fighting',
          'fighting-style-protection',
          'fighting-style-two-weapon-fighting',
        ],
      },
    ],
    modifiers: [],
  },
  'fighting-style-archery': {
    featureGroup: 'fighting-style',
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'ranged_attack',
        value: 2,
        condition: 'wielding_ranged_weapon',
      },
    ],
  },
  'fighting-style-defense': {
    featureGroup: 'fighting-style',
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'ac',
        value: 1,
        condition: 'wearing_armor',
      },
    ],
  },
  'fighting-style-dueling': {
    featureGroup: 'fighting-style',
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'melee_damage',
        value: 2,
        condition: 'one_handed_melee_no_other_weapon',
      },
    ],
  },
  'fighting-style-great-weapon-fighting': {
    featureGroup: 'fighting-style',
    modifiers: [
      {
        type: 'die_manipulation',
        rule: 'great_weapon_fighting',
      },
    ],
  },
  'fighting-style-protection': {
    featureGroup: 'fighting-style',
    modifiers: [],
    activatedAbilities: [
      {
        id: 'protection-reaction',
        name: 'Protection',
        description:
          'When a creature you can see attacks a target other than you that is within 5 feet of you, you can use your reaction to impose disadvantage on the attack roll. You must be wielding a shield.',
        actionCost: 'reaction',
        reactionTrigger: {
          event: 'ally_within_5ft_targeted_by_attack',
          rangeFeet: 5,
        },
        targeting: {
          type: 'single',
          rangeFeet: 5,
          targetFilter: 'enemy',
        },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'protection-disadvantage',
            name: 'Protection (Disadvantage)',
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
  },
  'fighting-style-two-weapon-fighting': {
    featureGroup: 'fighting-style',
    modifiers: [],
  },
  'second-wind': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'second_wind',
        name: 'Second Wind',
        maxFormula: '1',
        recovery: 'short_rest',
      },
    ],
    activatedAbilities: [
      {
        id: 'use-second-wind',
        name: 'Second Wind',
        description:
          'On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.',
        actionCost: 'bonus_action',
        resourceCost: { resourceId: 'second_wind', amount: 1 },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'heal',
            diceFormula: '1d10 + @classLevel',
          },
        ],
      },
    ],
  },
  'action-surge': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'action_surge',
        name: 'Action Surge',
        maxFormula: '1',
        recovery: 'short_rest',
      },
    ],
    activatedAbilities: [
      {
        id: 'use-action-surge',
        name: 'Action Surge',
        description: 'On your turn, you can take one additional action on top of your regular action.',
        actionCost: 'free',
        resourceCost: { resourceId: 'action_surge', amount: 1 },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'spend_resource',
            resourceId: 'action_surge',
            amount: 1,
          },
        ],
      },
    ],
  },
  'extra-attack': {
    modifiers: [
      {
        type: 'extra_attack',
        attacksPerAction: 2,
      },
    ],
  },
  'extra-attack-2': {
    modifiers: [
      {
        type: 'extra_attack',
        attacksPerAction: 3,
      },
    ],
  },
  'extra-attack-3': {
    modifiers: [
      {
        type: 'extra_attack',
        attacksPerAction: 4,
      },
    ],
  },
  'improved-critical': {
    modifiers: [
      {
        type: 'die_manipulation',
        rule: 'expanded_crit_range',
        params: { minCritRoll: 19 },
      },
    ],
  },
  'superior-critical': {
    modifiers: [
      {
        type: 'die_manipulation',
        rule: 'expanded_crit_range',
        params: { minCritRoll: 18 },
      },
    ],
  },

  // Monk
  'monk-unarmored-defense': {
    modifiers: [
      {
        type: 'ac_calculation',
        id: 'unarmored_monk',
        formula: '10 + @dexMod + @wisMod',
        allowsShield: false,
        requiresNoArmor: true,
      },
    ],
  },
  ki: {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'ki',
        name: 'Ki Points',
        maxFormula: '@classLevel',
        recovery: 'short_rest',
      },
    ],
  },
  'unarmored-movement': {
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'speed',
        value: 10,
        condition: 'wearing_no_armor',
      },
    ],
  },

  // Paladin
  'lay-on-hands': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'lay_on_hands',
        name: 'Lay on Hands Pool',
        maxFormula: '5 * @classLevel',
        recovery: 'long_rest',
      },
    ],
  },
  'aura-of-protection': {
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'all_saving_throws',
        value: 'max(1, @chaMod)',
      },
    ],
  },

  // Rogue
  'cunning-action': {
    modifiers: [],
  },
  'uncanny-dodge': {
    modifiers: [],
    activatedAbilities: [
      {
        id: 'use-uncanny-dodge',
        name: 'Uncanny Dodge',
        description:
          'When an attacker that you can see hits you with an attack, you can use your reaction to halve the attack’s damage against you.',
        actionCost: 'reaction',
        reactionTrigger: {
          event: 'hit_by_attack',
        },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'uncanny-dodge-halve-damage',
            name: 'Uncanny Dodge',
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: 'damage_mitigation',
                mitigation: 'resistance',
                damageTypes: [
                  'acid',
                  'bludgeoning',
                  'cold',
                  'fire',
                  'force',
                  'lightning',
                  'necrotic',
                  'piercing',
                  'poison',
                  'psychic',
                  'radiant',
                  'slashing',
                  'thunder',
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Sorcerer
  'font-of-magic': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'sorcery_points',
        name: 'Sorcery Points',
        maxFormula: '@classLevel',
        recovery: 'long_rest',
      },
    ],
  },
  'draconic-resilience': {
    modifiers: [
      {
        type: 'flat_bonus',
        target: 'hp_per_level',
        value: 1,
      },
      {
        type: 'ac_calculation',
        id: 'draconic_resilience',
        formula: '13 + @dexMod',
        allowsShield: true,
        requiresNoArmor: true,
      },
    ],
  },

  // Wizard
  'arcane-recovery': {
    modifiers: [
      {
        type: 'grant_resource',
        resourceId: 'arcane_recovery',
        name: 'Arcane Recovery',
        maxFormula: '1',
        recovery: 'long_rest',
      },
    ],
  },

  "reckless-attack": {
    activatedAbilities: [
      {
        id: "reckless-attack",
        name: "Reckless Attack",
        description: "Gain advantage on melee weapon attack rolls using Strength during this turn, but attack rolls against you have advantage until your next turn.",
        actionCost: "special",
        effects: [
          {
            step: "apply_active_effect",
            effectId: "reckless-attack-buff",
            name: "Reckless Attack",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: "roll_mode",
                mode: "advantage",
                target: "attack_rolls",
              },
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
  frenzy: {
    activatedAbilities: [
      {
        id: "frenzy-attack",
        name: "Frenzy Attack",
        description: "While raging, make a single melee weapon attack as a bonus action.",
        actionCost: "bonus_action",
        effects: [
          {
            step: "apply_active_effect",
            effectId: "frenzy-active",
            name: "Frenzy",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  "totem-spirit": {
    modifiers: [
      {
        type: "damage_mitigation",
        mitigation: "resistance",
        damageTypes: [
          "acid",
          "cold",
          "fire",
          "force",
          "lightning",
          "necrotic",
          "poison",
          "radiant",
          "thunder",
        ],
      },
    ],
  },
  "extra-attack-barbarian": {
    modifiers: [{ type: "extra_attack", attacksPerAction: 2 }],
  },
  "extra-attack-monk": {
    modifiers: [{ type: "extra_attack", attacksPerAction: 2 }],
  },
  "extra-attack-paladin": {
    modifiers: [{ type: "extra_attack", attacksPerAction: 2 }],
  },
  "extra-attack-ranger": {
    modifiers: [{ type: "extra_attack", attacksPerAction: 2 }],
  },
  "extra-attack-fighter": {
    modifiers: [{ type: "extra_attack", attacksPerAction: 2 }],
  },
  "jack-of-all-trades": {
    modifiers: [
      {
        type: "flat_bonus",
        target: "initiative",
        value: "floor(@prof / 2)",
      },
    ],
  },
  "song-of-rest": {
    modifiers: [],
  },
  "cutting-words": {
    activatedAbilities: [
      {
        id: "cutting-words",
        name: "Cutting Words",
        description: "Subtract Bardic Inspiration die from enemy attack roll, damage roll, or ability check.",
        actionCost: "reaction",
        reactionTrigger: {
          event: "custom",
          description: "Enemy rolls attack, ability check, or damage roll",
          rangeFeet: 60,
        },
        resourceCost: { resourceId: "bardic_inspiration", amount: 1 },
        effects: [
          {
            step: "apply_active_effect",
            effectId: "cutting-words-debuff",
            name: "Cutting Words",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  "font-of-inspiration": {
    modifiers: [],
  },
  "disciple-of-life": {
    modifiers: [],
  },
  "bonus-proficiency-life": {
    modifiers: [],
  },
  "destroy-undead": {
    modifiers: [],
  },
  "natural-recovery": {
    modifiers: [],
  },
  "wild-shape": {
    modifiers: [
      {
        type: "grant_resource",
        resourceId: "wild_shape",
        name: "Wild Shape",
        maxFormula: "2",
        recovery: "short_rest",
      },
    ],
  },
  "martial-arts": {
    modifiers: [
      {
        type: "flat_bonus",
        target: "melee_damage",
        value: 0,
      },
    ],
    activatedAbilities: [
      {
        id: "martial-arts-bonus-strike",
        name: "Martial Arts Unarmed Strike",
        description: "Make an unarmed strike as a bonus action.",
        actionCost: "bonus_action",
        targeting: { type: "touch", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + @dexMod",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    ],
  },
  "open-hand-technique": {
    modifiers: [],
  },
  "deflect-missiles": {
    activatedAbilities: [
      {
        id: "deflect-missiles",
        name: "Deflect Missiles",
        description: "Reduce ranged weapon attack damage.",
        actionCost: "reaction",
        reactionTrigger: {
          event: "hit_by_attack",
          rangeFeet: 60,
        },
        effects: [
          {
            step: "apply_active_effect",
            effectId: "deflect-missiles-reduction",
            name: "Deflect Missiles",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  "slow-fall": {
    activatedAbilities: [
      {
        id: "slow-fall",
        name: "Slow Fall",
        description: "Reduce falling damage as a reaction.",
        actionCost: "reaction",
        reactionTrigger: {
          event: "creature_falls",
          rangeFeet: 0,
        },
        effects: [
          {
            step: "apply_active_effect",
            effectId: "slow-fall-active",
            name: "Slow Fall",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [],
          },
        ],
      },
    ],
  },
  "stunning-strike": {
    activatedAbilities: [
      {
        id: "stunning-strike",
        name: "Stunning Strike",
        description: "Target must make CON save or be stunned.",
        actionCost: "special",
        resourceCost: { resourceId: "ki", amount: 1 },
        effects: [
          {
            step: "saving_throw",
            ability: "con",
            dcFormula: "@spellSaveDC",
            onFail: [
              {
                step: "apply_condition",
                conditionId: "stunned",
                durationRounds: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  "divine-sense": {
    modifiers: [
      {
        type: "grant_resource",
        resourceId: "divine_sense",
        name: "Divine Sense",
        maxFormula: "1 + @chaMod",
        recovery: "long_rest",
      },
    ],
  },
  "divine-smite": {
    activatedAbilities: [
      {
        id: "divine-smite",
        name: "Divine Smite",
        description: "Deal extra radiant damage on melee hit.",
        actionCost: "special",
        effects: [
          {
            step: "deal_damage",
            diceFormula: "2d8",
            damageType: "radiant",
            isMagical: true,
          },
        ],
      },
    ],
  },
  "divine-health": {
    modifiers: [],
  },
  "sacred-weapon": {
    activatedAbilities: [
      {
        id: "sacred-weapon",
        name: "Channel Divinity: Sacred Weapon",
        description: "Add Charisma modifier to attack rolls.",
        actionCost: "action",
        resourceCost: { resourceId: "channel_divinity", amount: 1 },
        effects: [
          {
            step: "apply_active_effect",
            effectId: "sacred-weapon-buff",
            name: "Sacred Weapon",
            durationRounds: 10,
            requiresConcentration: false,
            modifiers: [
              {
                type: "flat_bonus",
                target: "melee_attack",
                value: "@chaMod",
              },
            ],
          },
        ],
      },
    ],
  },
  "turn-the-unholy": {
    activatedAbilities: [
      {
        id: "turn-the-unholy",
        name: "Channel Divinity: Turn the Unholy",
        description: "Turn fiends and undead within 30 ft.",
        actionCost: "action",
        resourceCost: { resourceId: "channel_divinity", amount: 1 },
        targeting: { type: "self_aoe", rangeFeet: 0, aoe: { shape: "sphere", sizeFeet: 30 } },
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
              },
            ],
          },
        ],
      },
    ],
  },
  "favored-enemy": {
    modifiers: [
      {
        type: "roll_mode",
        mode: "advantage",
        target: "skill:survival",
      },
    ],
  },
  "natural-explorer": {
    modifiers: [],
  },
  "primeval-awareness": {
    modifiers: [],
  },
  "hunters-prey": {
    modifiers: [
      {
        type: "flat_bonus",
        target: "melee_damage",
        value: "1d8",
      },
    ],
  },
  "sneak-attack": {
    modifiers: [
      {
        type: "flat_bonus",
        target: "melee_damage",
        value: "1d6",
      },
      {
        type: "flat_bonus",
        target: "ranged_damage",
        value: "1d6",
      },
    ],
  },
  "fast-hands": {
    modifiers: [],
  },
  "second-story-work": {
    modifiers: [],
  },
  metamagic: {
    modifiers: [],
  },
  "dark-ones-blessing": {
    modifiers: [],
  },
  "eldritch-invocations": {
    modifiers: [],
  },
  "pact-boon": {
    modifiers: [],
  },
  "sculpt-spells": {
    modifiers: [],
  },
  "asi-barbarian": { modifiers: [] },
  "asi-bard": { modifiers: [] },
  "asi-cleric": { modifiers: [] },
  "asi-druid": { modifiers: [] },
  "asi-fighter": { modifiers: [] },
  "asi-monk": { modifiers: [] },
  "asi-paladin": { modifiers: [] },
  "asi-ranger": { modifiers: [] },
  "asi-rogue": { modifiers: [] },
  "asi-sorcerer": { modifiers: [] },
  "asi-warlock": { modifiers: [] },
  "asi-wizard": { modifiers: [] },
};

export const SRD_FEAT_OVERLAYS: Readonly<Record<string, FeatOverlaySpec>> = {
  grappler: {
    prerequisites: [
      {
        type: 'ability_minimum',
        ability: 'str',
        minimum: 13,
      },
    ],
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'attack_rolls',
        condition: {
          type: 'target_grappled_by_self',
        },
      },
    ],
    activatedAbilities: [
      {
        id: 'grappler-pin',
        name: 'Pin Grappled Creature',
        description:
          'You can use your action to try to pin a creature grappled by you. To do so, make another grapple check. If you succeed, you and the creature are both restrained until the grapple ends.',
        actionCost: 'action',
        targeting: {
          type: 'touch',
          rangeFeet: 5,
          targetFilter: 'enemy',
        },
        effects: [
          {
            step: 'apply_condition',
            conditionId: 'restrained',
          },
        ],
      },
    ],
  },
};
