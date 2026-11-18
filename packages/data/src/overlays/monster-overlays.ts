import type { MonsterOverlaySpec } from "../ingestion/overlay.js";

/**
 * Declarative Effect & Modifier DSL overlays for core SRD 5.1 Monsters (Combat Tier A: CR 0–5).
 */
export const SRD_MONSTER_OVERLAYS: Readonly<Record<string, MonsterOverlaySpec>> = {
  acolyte: {
    aiArchetype: "support",
    actions: {
      club: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 2,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  bandit: {
    aiArchetype: "skirmisher",
    actions: {
      scimitar: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 1",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      "light-crossbow": {
        targeting: { type: "single", rangeFeet: 80, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 1",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  berserker: {
    aiArchetype: "brute",
    traits: {
      reckless: {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      greataxe: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d12 + 3",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
    },
  },
  bugbear: {
    aiArchetype: "brute",
    traits: {
      brute: {
        modifiers: [
          {
            type: "flat_bonus",
            target: "melee_damage",
            value: 4,
          },
        ],
      },
      "surprise-attack": {
        modifiers: [
          {
            type: "flat_bonus",
            target: "melee_damage",
            value: 7,
          },
        ],
      },
    },
    actions: {
      morningstar: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d8 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      javelin: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  "cult-fanatic": {
    aiArchetype: "controller",
    traits: {
      "dark-devotion": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "save:wis",
          },
        ],
      },
    },
    actions: {
      multiattack: {
        effects: [],
      },
      dagger: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  cultist: {
    aiArchetype: "brute",
    traits: {
      "dark-devotion": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "save:wis",
          },
        ],
      },
    },
    actions: {
      scimitar: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 1",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
    },
  },
  "dire-wolf": {
    aiArchetype: "skirmisher",
    traits: {
      "keen-hearing-and-smell": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
      "pack-tactics": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d6 + 3",
                damageType: "piercing",
              },
              {
                step: "saving_throw",
                ability: "str",
                dcFormula: "13",
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
    },
  },
  "gelatinous-cube": {
    aiArchetype: "controller",
    traits: {
      "ooze-cube": { modifiers: [] },
      transparent: { modifiers: [] },
    },
    actions: {
      pseudopod: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "3d6",
                damageType: "acid",
              },
            ],
          },
        ],
      },
    },
  },
  ghoul: {
    aiArchetype: "controller",
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 2,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      claws: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d4 + 2",
                damageType: "slashing",
              },
              {
                step: "saving_throw",
                ability: "con",
                dcFormula: "10",
                onFail: [
                  {
                    step: "apply_condition",
                    conditionId: "paralyzed",
                    durationRounds: 10,
                    repeatSaveAtTurnEnd: {
                      ability: "con",
                      dcFormula: "10",
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
  "giant-bat": {
    aiArchetype: "skirmisher",
    traits: {
      "keen-hearing": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
    },
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  "giant-rat": {
    aiArchetype: "skirmisher",
    traits: {
      "keen-smell": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
      "pack-tactics": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  "giant-spider": {
    aiArchetype: "skirmisher",
    traits: {
      "spider-climb": { modifiers: [] },
    },
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 3",
                damageType: "piercing",
              },
              {
                step: "saving_throw",
                ability: "con",
                dcFormula: "11",
                onFail: [
                  {
                    step: "deal_damage",
                    diceFormula: "2d8",
                    damageType: "poison",
                  },
                ],
                onSuccess: [
                  {
                    step: "deal_damage",
                    diceFormula: "1d8",
                    damageType: "poison",
                  },
                ],
              },
            ],
          },
        ],
      },
      web: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "apply_condition",
                conditionId: "restrained",
                durationRounds: 10,
              },
            ],
          },
        ],
      },
    },
  },
  "giant-wolf-spider": {
    aiArchetype: "skirmisher",
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 1",
                damageType: "piercing",
              },
              {
                step: "saving_throw",
                ability: "con",
                dcFormula: "11",
                onFail: [
                  {
                    step: "deal_damage",
                    diceFormula: "2d6",
                    damageType: "poison",
                  },
                ],
                onSuccess: [
                  {
                    step: "deal_damage",
                    diceFormula: "1d6",
                    damageType: "poison",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  goblin: {
    aiArchetype: "skirmisher",
    traits: {
      "nimble-escape": {
        activatedAbilities: [
          {
            id: "nimble-escape-disengage",
            name: "Nimble Escape (Disengage)",
            description: "Take Disengage action as bonus action.",
            actionCost: "bonus_action",
            effects: [
              {
                step: "apply_active_effect",
                effectId: "disengaged",
                name: "Disengaged",
                durationRounds: 1,
                requiresConcentration: false,
                modifiers: [],
              },
            ],
          },
        ],
      },
    },
    actions: {
      scimitar: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      shortbow: {
        targeting: { type: "single", rangeFeet: 80, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  "goblin-boss": {
    aiArchetype: "skirmisher",
    traits: {
      "nimble-escape": {
        activatedAbilities: [
          {
            id: "nimble-escape-disengage",
            name: "Nimble Escape (Disengage)",
            description: "Take Disengage action as bonus action.",
            actionCost: "bonus_action",
            effects: [
              {
                step: "apply_active_effect",
                effectId: "disengaged",
                name: "Disengaged",
                durationRounds: 1,
                requiresConcentration: false,
                modifiers: [],
              },
            ],
          },
        ],
      },
    },
    actions: {
      multiattack: { effects: [] },
      scimitar: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      javelin: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  guard: {
    aiArchetype: "brute",
    actions: {
      spear: {
        targeting: { type: "single", rangeFeet: 20, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 1",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  harpy: {
    aiArchetype: "controller",
    actions: {
      multiattack: { effects: [] },
      claws: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d4 + 1",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      club: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 1",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
      "luring-song": {
        targeting: { type: "point_aoe", rangeFeet: 300, aoe: { shape: "sphere", sizeFeet: 300 } },
        effects: [
          {
            step: "saving_throw",
            ability: "wis",
            dcFormula: "11",
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
    },
  },
  "hill-giant": {
    aiArchetype: "brute",
    actions: {
      multiattack: { effects: [] },
      greatclub: {
        targeting: { type: "single", rangeFeet: 10, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 8,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "3d8 + 5",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
      rock: {
        targeting: { type: "single", rangeFeet: 60, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 8,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "3d10 + 5",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  hobgoblin: {
    aiArchetype: "brute",
    traits: {
      "martial-advantage": {
        modifiers: [
          {
            type: "flat_bonus",
            target: "melee_damage",
            value: 7,
          },
        ],
      },
    },
    actions: {
      longsword: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 1",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      longbow: {
        targeting: { type: "single", rangeFeet: 150, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 1",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  kobold: {
    aiArchetype: "skirmisher",
    traits: {
      "sunlight-sensitivity": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "disadvantage",
            target: "attack_rolls",
          },
          {
            type: "roll_mode",
            mode: "disadvantage",
            target: "skill:perception",
          },
        ],
      },
      "pack-tactics": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      dagger: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      sling: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d4 + 2",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  manticore: {
    aiArchetype: "artillery",
    traits: {
      "tail-spike-regrowth": { modifiers: [] },
    },
    actions: {
      multiattack: { effects: [] },
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 3",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      claw: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 3",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      "tail-spike": {
        targeting: { type: "single", rangeFeet: 100, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 3",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  minotaur: {
    aiArchetype: "brute",
    traits: {
      charge: {
        modifiers: [
          {
            type: "flat_bonus",
            target: "melee_damage",
            value: 9,
          },
        ],
      },
      reckless: {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      greataxe: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 6,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d12 + 4",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      gore: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 6,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d8 + 4",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  noble: {
    aiArchetype: "skirmisher",
    actions: {
      rapier: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 1",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
    reactions: [
      {
        id: "parry",
        name: "Parry",
        description: "The noble adds 2 to its AC against one melee attack that would hit it. To do so, the noble must see the attacker and be wielding a melee weapon.",
        actionCost: "reaction",
        targeting: { type: "self", rangeFeet: 0 },
        effects: [
          {
            step: "apply_active_effect",
            effectId: "noble-parry",
            name: "Parry (+2 AC)",
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [
              {
                type: "flat_bonus",
                target: "ac",
                value: 2,
              },
            ],
          },
        ],
      },
    ],
  },
  ogre: {
    aiArchetype: "brute",
    actions: {
      greatclub: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 6,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d8 + 4",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
      javelin: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 6,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d6 + 4",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  orc: {
    aiArchetype: "brute",
    traits: {
      aggressive: {
        activatedAbilities: [
          {
            id: "aggressive-dash",
            name: "Aggressive",
            description: "Move up to speed toward hostile as bonus action.",
            actionCost: "bonus_action",
            effects: [
              {
                step: "apply_active_effect",
                effectId: "aggressive-moved",
                name: "Aggressive",
                durationRounds: 1,
                requiresConcentration: false,
                modifiers: [],
              },
            ],
          },
        ],
      },
    },
    actions: {
      greataxe: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d12 + 3",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      javelin: {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 5,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 3",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  owlbear: {
    aiArchetype: "brute",
    traits: {
      "keen-sight-and-smell": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
    },
    actions: {
      multiattack: { effects: [] },
      beak: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 7,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d10 + 5",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      claws: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 7,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d8 + 5",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
    },
  },
  priest: {
    aiArchetype: "support",
    traits: {
      "divine-eminence": {
        activatedAbilities: [
          {
            id: "divine-eminence-activate",
            name: "Divine Eminence",
            description: "Spend 1st-level spell slot to deal extra 3d6 radiant damage on melee weapon hit.",
            actionCost: "bonus_action",
            effects: [
              {
                step: "apply_active_effect",
                effectId: "divine-eminence-buff",
                name: "Divine Eminence",
                durationRounds: 1,
                requiresConcentration: false,
                modifiers: [
                  {
                    type: "flat_bonus",
                    target: "melee_damage",
                    value: "3d6",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    actions: {
      mace: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 2,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  scout: {
    aiArchetype: "skirmisher",
    traits: {
      "keen-hearing-and-sight": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
    },
    actions: {
      multiattack: {
        multiattack: {
          sequence: [{ actionId: "shortsword", count: 2 }],
        },
        effects: [],
      },
      shortsword: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      longbow: {
        targeting: { type: "single", rangeFeet: 150, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  shadow: {
    aiArchetype: "skirmisher",
    actions: {
      "strength-drain": {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d6 + 2",
                damageType: "necrotic",
              },
            ],
          },
        ],
      },
    },
  },
  skeleton: {
    aiArchetype: "artillery",
    actions: {
      shortsword: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      shortbow: {
        targeting: { type: "single", rangeFeet: 80, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  specter: {
    aiArchetype: "skirmisher",
    actions: {
      "life-drain": {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_spell",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "3d6",
                damageType: "necrotic",
              },
            ],
          },
        ],
      },
    },
  },
  spy: {
    aiArchetype: "skirmisher",
    actions: {
      multiattack: {
        multiattack: {
          sequence: [{ actionId: "shortsword", count: 2 }],
        },
        effects: [],
      },
      shortsword: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
      "hand-crossbow": {
        targeting: { type: "single", rangeFeet: 30, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  thug: {
    aiArchetype: "brute",
    traits: {
      "pack-tactics": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      multiattack: {
        multiattack: {
          sequence: [{ actionId: "mace", count: 2 }],
        },
        effects: [],
      },
      mace: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
      "heavy-crossbow": {
        targeting: { type: "single", rangeFeet: 100, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 2,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d10",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  wight: {
    aiArchetype: "controller",
    traits: {
      "sunlight-sensitivity": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "disadvantage",
            target: "attack_rolls",
          },
          {
            type: "roll_mode",
            mode: "disadvantage",
            target: "skill:perception",
          },
        ],
      },
    },
    actions: {
      multiattack: { effects: [] },
      "life-drain": {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 2",
                damageType: "necrotic",
              },
              {
                step: "saving_throw",
                ability: "con",
                dcFormula: "13",
                onFail: [
                  {
                    step: "apply_active_effect",
                    effectId: "life-drained",
                    name: "Life Drained",
                    durationRounds: 4800,
                    requiresConcentration: false,
                    modifiers: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      longsword: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 2",
                damageType: "slashing",
              },
            ],
          },
        ],
      },
      longbow: {
        targeting: { type: "single", rangeFeet: 150, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "ranged_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d8 + 2",
                damageType: "piercing",
              },
            ],
          },
        ],
      },
    },
  },
  "warhorse-skeleton": {
    aiArchetype: "brute",
    actions: {
      hooves: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 6,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d6 + 4",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  wolf: {
    aiArchetype: "skirmisher",
    traits: {
      "keen-hearing-and-smell": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "skill:perception",
          },
        ],
      },
      "pack-tactics": {
        modifiers: [
          {
            type: "roll_mode",
            mode: "advantage",
            target: "attack_rolls",
          },
        ],
      },
    },
    actions: {
      bite: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 4,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "2d4 + 2",
                damageType: "piercing",
              },
              {
                step: "saving_throw",
                ability: "str",
                dcFormula: "11",
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
    },
  },
  zombie: {
    aiArchetype: "brute",
    traits: {
      "undead-fortitude": {
        modifiers: [],
      },
    },
    actions: {
      slam: {
        targeting: { type: "single", rangeFeet: 5, targetFilter: "enemy" },
        effects: [
          {
            step: "attack_roll",
            attackType: "melee_weapon",
            attackBonusOverride: 3,
            onHit: [
              {
                step: "deal_damage",
                diceFormula: "1d6 + 1",
                damageType: "bludgeoning",
              },
            ],
          },
        ],
      },
    },
  },
  mage: {
    aiArchetype: "artillery",
  },
  "adult-black-dragon": {
    aiArchetype: "artillery",
  },
};
