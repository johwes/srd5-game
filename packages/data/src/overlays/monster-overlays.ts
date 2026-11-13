import type { MonsterOverlaySpec } from '../ingestion/overlay.js';

/**
 * Declarative Effect & Modifier DSL overlays for core SRD 5.1 Monsters.
 */
export const SRD_MONSTER_OVERLAYS: Readonly<Record<string, MonsterOverlaySpec>> = {
  goblin: {
    aiArchetype: 'skirmisher',
    traits: {
      'nimble-escape': {
        modifiers: [],
      },
    },
  },
  kobold: {
    aiArchetype: 'skirmisher',
    traits: {
      'pack-tactics': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'attack_rolls',
            condition: 'ally_within_5ft_of_target',
          },
        ],
      },
      'sunlight-sensitivity': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'disadvantage',
            target: 'attack_rolls',
            condition: 'in_sunlight',
          },
          {
            type: 'roll_mode',
            mode: 'disadvantage',
            target: 'skill:perception',
            condition: 'in_sunlight',
          },
        ],
      },
    },
  },
  wolf: {
    aiArchetype: 'skirmisher',
    traits: {
      'pack-tactics': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'attack_rolls',
            condition: 'ally_within_5ft_of_target',
          },
        ],
      },
    },
  },
  'dire-wolf': {
    aiArchetype: 'skirmisher',
    traits: {
      'pack-tactics': {
        modifiers: [
          {
            type: 'roll_mode',
            mode: 'advantage',
            target: 'attack_rolls',
            condition: 'ally_within_5ft_of_target',
          },
        ],
      },
    },
  },
  skeleton: {
    aiArchetype: 'artillery',
  },
  zombie: {
    aiArchetype: 'brute',
  },
  orc: {
    aiArchetype: 'brute',
  },
  hobgoblin: {
    aiArchetype: 'brute',
  },
  bugbear: {
    aiArchetype: 'brute',
  },
  ogre: {
    aiArchetype: 'brute',
  },
  owlbear: {
    aiArchetype: 'brute',
  },
  ghoul: {
    aiArchetype: 'controller',
    actions: {
      claws: {
        targeting: { type: 'single', rangeFeet: 5, targetFilter: 'enemy' },
        effects: [
          {
            step: 'attack_roll',
            attackType: 'melee_weapon',
            attackBonusOverride: 4,
            onHit: [
              {
                step: 'deal_damage',
                diceFormula: '2d4 + 2',
                damageType: 'slashing',
              },
              {
                step: 'saving_throw',
                ability: 'con',
                dcFormula: '10',
                onFail: [
                  {
                    step: 'apply_condition',
                    conditionId: 'paralyzed',
                    durationRounds: 10,
                    repeatSaveAtTurnEnd: {
                      ability: 'con',
                      dcFormula: '10',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  'gelatinous-cube': {
    aiArchetype: 'controller',
  },
  priest: {
    aiArchetype: 'support',
  },
  'cult-fanatic': {
    aiArchetype: 'controller',
  },
  mage: {
    aiArchetype: 'artillery',
  },
  'adult-black-dragon': {
    aiArchetype: 'artillery',
  },
};
