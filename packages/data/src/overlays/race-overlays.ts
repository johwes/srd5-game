import type { RaceOverlaySpec } from '../ingestion/overlay.js';

/**
 * Declarative Effect & Modifier DSL overlays for SRD 5.1 Base Races.
 */
export const SRD_RACE_OVERLAYS: Readonly<Record<string, RaceOverlaySpec>> = {
  dwarf: {
    choices: [
      {
        id: 'dwarf-tool-proficiency',
        label: "Choose one artisan's tool proficiency",
        count: 1,
        type: 'tool',
        from: {
          mode: 'explicit',
          options: ['smiths-tools', 'brewers-supplies', 'masons-tools'],
        },
      },
    ],
    traits: {
      'dwarven-resilience': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'save:con',
            condition: 'save_against_poison',
          },
          {
            type: 'damage_mitigation',
            mitigation: 'resistance',
            damageTypes: ['poison'],
          },
        ],
      },
    },
  },
  elf: {
    traits: {
      'keen-senses': {
        modifiers: [],
      },
      'fey-ancestry': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'all_saving_throws',
            condition: 'save_against_charmed',
          },
        ],
      },
    },
  },
  halfling: {
    traits: {
      lucky: {
        modifiers: [
          {
            type: 'die_manipulation',
            rule: 'halfling_lucky',
          },
        ],
      },
      brave: {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'all_saving_throws',
            condition: 'save_against_frightened',
          },
        ],
      },
    },
  },
  human: {
    choices: [
      {
        id: 'human-extra-language',
        label: 'Choose one extra language of your choice',
        count: 1,
        type: 'language',
        from: { mode: 'category', category: 'all_languages' },
      },
    ],
  },
  dragonborn: {
    choices: [
      {
        id: 'draconic-ancestry',
        label: 'Choose your Draconic Ancestry',
        count: 1,
        type: 'feature_option',
        featureGroup: 'draconic-ancestry',
        options: [
          'black',
          'blue',
          'brass',
          'bronze',
          'copper',
          'gold',
          'green',
          'red',
          'silver',
          'white',
        ],
      },
    ],
    traits: {
      'breath-weapon': {
        modifiers: [
          {
            type: 'grant_resource',
            resourceId: 'breath_weapon',
            name: 'Breath Weapon',
            maxFormula: '1',
            recovery: 'short_rest',
          },
        ],
        activatedAbilities: [
          {
            id: 'dragonborn-breath-weapon',
            name: 'Breath Weapon',
            description:
              'Use your action to exhale destructive energy in a 15-foot cone or 5-by-30-foot line based on your Draconic Ancestry (DC = 8 + CON modifier + proficiency bonus).',
            actionCost: 'action',
            resourceCost: { resourceId: 'breath_weapon', amount: 1 },
            targeting: {
              type: 'self_aoe',
              rangeFeet: 0,
              aoe: { shape: 'cone', sizeFeet: 15 },
            },
            effects: [
              {
                step: 'saving_throw',
                ability: 'dex',
                dcFormula: '8 + @conMod + @prof',
                onFail: [
                  {
                    step: 'deal_damage',
                    diceFormula: '2d6',
                    damageType: 'fire',
                    halfOnSaveSuccess: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  gnome: {
    traits: {
      'gnome-cunning': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'save:int',
            condition: 'save_against_magic',
          },
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'save:wis',
            condition: 'save_against_magic',
          },
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'save:cha',
            condition: 'save_against_magic',
          },
        ],
      },
    },
  },
  'half-elf': {
    choices: [
      {
        id: 'half-elf-ability-bonuses',
        label: 'Choose two distinct ability scores other than Charisma to increase by 1',
        count: 2,
        type: 'ability_score_bonus',
        bonus: 1,
        excludeAbilities: ['cha'],
        distinct: true,
      },
      {
        id: 'half-elf-skill-versatility',
        label: 'Choose two skills of your choice',
        count: 2,
        type: 'skill',
        from: { mode: 'category', category: 'all_skills' },
      },
      {
        id: 'half-elf-extra-language',
        label: 'Choose one extra language of your choice',
        count: 1,
        type: 'language',
        from: { mode: 'category', category: 'all_languages' },
      },
    ],
    traits: {
      'fey-ancestry': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'all_saving_throws',
            condition: 'save_against_charmed',
          },
        ],
      },
    },
  },
  'half-orc': {
    traits: {
      'relentless-endurance': {
        modifiers: [
          {
            type: 'grant_resource',
            resourceId: 'relentless_endurance',
            name: 'Relentless Endurance',
            maxFormula: '1',
            recovery: 'long_rest',
          },
        ],
      },
      'savage-attacks': {
        modifiers: [
          {
            type: 'die_manipulation',
            rule: 'savage_attacks',
          },
        ],
      },
    },
  },
  tiefling: {
    traits: {
      'hellish-resistance': {
        modifiers: [
          {
            type: 'damage_mitigation',
            mitigation: 'resistance',
            damageTypes: ['fire'],
          },
        ],
      },
      'infernal-legacy': {
        modifiers: [],
        innateSpells: [
          { spellId: 'thaumaturgy', minCharacterLevel: 1, ability: 'cha' },
          {
            spellId: 'hellish-rebuke',
            minCharacterLevel: 3,
            ability: 'cha',
            oncePerRest: 'long_rest',
            castAtSlotLevel: 2,
          },
          {
            spellId: 'darkness',
            minCharacterLevel: 5,
            ability: 'cha',
            oncePerRest: 'long_rest',
          },
        ],
      },
    },
  },
};

/**
 * Declarative Effect & Modifier DSL overlays for SRD 5.1 Subraces.
 */
export const SRD_SUBRACE_OVERLAYS: Readonly<Record<string, RaceOverlaySpec>> = {
  'hill-dwarf': {
    traits: {
      'dwarven-toughness': {
        modifiers: [
          {
            type: 'flat_bonus',
            target: 'hp_per_level',
            value: 1,
          },
        ],
      },
    },
  },
  'high-elf': {
    choices: [
      {
        id: 'high-elf-cantrip',
        label: 'Choose one cantrip from the Wizard spell list',
        count: 1,
        type: 'spell',
        classList: 'wizard',
        maxSpellLevel: 0,
      },
      {
        id: 'high-elf-extra-language',
        label: 'Choose one extra language of your choice',
        count: 1,
        type: 'language',
        from: { mode: 'category', category: 'all_languages' },
      },
    ],
  },
  'lightfoot-halfling': {
    traits: {
      'naturally-stealthy': {
        modifiers: [],
      },
    },
  },
  'rock-gnome': {
    traits: {
      'artificers-lore': {
        modifiers: [],
      },
      tinker: {
        modifiers: [],
      },
    },
  },
};
