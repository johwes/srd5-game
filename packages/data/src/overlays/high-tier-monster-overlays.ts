import type { MonsterOverlaySpec } from '../ingestion/overlay.js';

/**
 * Combat Tier B (CR 6–10) & Tier C (CR 11–20) executable Effect DSL overlays
 * for high Challenge Rating monsters. Low-CR stat blocks already carry their
 * executable action pipelines from the base bundle; these overlays add the
 * spellcasting, trait, and reaction coverage required for mid/high-tier foes.
 */
export const SRD_HIGH_TIER_MONSTER_OVERLAYS: Readonly<Record<string, MonsterOverlaySpec>> = {
  mage: {
    aiArchetype: 'artillery',
    spellcasting: {
      ability: 'int',
      spellSaveDc: 15,
      spellAttackBonus: 7,
      casterLevel: 6,
      classId: 'wizard',
      slotsByLevel: { '1': 4, '2': 3, '3': 3, '4': 2, '5': 1 },
      preparedSpellIds: [
        'magic-missile',
        'shield',
        'invisibility',
        'fly',
        'fireball',
        'lightning-bolt',
        'counterspell',
        'cone-of-cold',
        'stoneskin',
      ],
    },
    reactions: [
      {
        id: 'mage-shield',
        name: 'Shield (Reaction)',
        description: 'The mage casts shield in response to being hit by an attack, gaining +5 AC until the start of its next turn.',
        actionCost: 'reaction',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'apply_active_effect',
            effectId: 'mage-shield-ac',
            name: 'Shield (+5 AC)',
            durationRounds: 1,
            requiresConcentration: false,
            modifiers: [{ type: 'flat_bonus', target: 'ac', value: 5 }],
          },
        ],
      },
    ],
  },
  medusa: {
    aiArchetype: 'controller',
    traits: {
      'petrifying-gaze': {
        activatedAbilities: [
          {
            id: 'petrifying-gaze',
            name: 'Petrifying Gaze',
            description:
              'A creature that can see the medusa’s eyes must succeed on a DC 14 CON save at the start of its turn or be petrified until freed by greater restoration.',
            actionCost: 'free',
            targeting: { type: 'single', rangeFeet: 30, requiresSight: true, targetFilter: 'enemy' },
            effects: [
              {
                step: 'saving_throw',
                ability: 'con',
                dcFormula: '14',
                onFail: [
                  {
                    step: 'apply_condition',
                    conditionId: 'petrified',
                    durationRounds: 600,
                    repeatSaveAtTurnEnd: { ability: 'con', dcFormula: '14' },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  'young-black-dragon': {
    aiArchetype: 'artillery',
    traits: {
      amphibious: { modifiers: [] },
    },
  },
  'adult-black-dragon': {
    // Preserve the Tier A artillery archetype; Tier C only adds trait coverage.
    aiArchetype: 'artillery',
    traits: {
      amphibious: { modifiers: [] },
      'legendary-resistance': {
        activatedAbilities: [
          {
            id: 'legendary-resistance',
            name: 'Legendary Resistance (3/Day)',
            description: 'If the dragon fails a saving throw, it can choose to succeed instead.',
            actionCost: 'free',
            targeting: { type: 'self', rangeFeet: 0 },
            effects: [
              {
                step: 'manual_adjudication',
                adjudicationId: 'adult-black-dragon-legendary-resistance',
                title: 'Legendary Resistance — Succeed on a Failed Save',
                guidance:
                  'If the dragon fails a saving throw, it can choose to succeed instead. It has three uses of this feature per day.',
              },
            ],
          },
        ],
      },
    },
  },
};
