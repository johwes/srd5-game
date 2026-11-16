import type { SpellOverlaySpec } from '../ingestion/overlay.js';

/**
 * A structured "Manual / Adjudicated Resolution" fallback card for spells whose
 * full narrative effect cannot be expressed with tactical Effect DSL primitives.
 * The engine emits `MANUAL_ADJUDICATION_REQUIRED` so the cast never crashes or
 * soft-locks, and the client can surface the guidance to the player/DM.
 */
function adjudicatedSpell(
  adjudicationId: string,
  title: string,
  guidance: string,
  suggestedRoll?: string,
): SpellOverlaySpec {
  return {
    effects: [
      {
        step: 'manual_adjudication',
        adjudicationId,
        title,
        guidance,
        ...(suggestedRoll ? { suggestedRoll } : {}),
      },
    ],
  };
}

/**
 * Combat Tier B (Levels 4–5) & Tier C (Levels 6–9) executable Effect DSL
 * overlays. Every high-level spell in the bundle receives either a fully
 * automated effect pipeline or an explicit adjudication fallback block, so no
 * high-tier spell is an empty no-op.
 */
export const SRD_HIGH_TIER_SPELL_OVERLAYS: Readonly<Record<string, SpellOverlaySpec>> = {
  // ---------------------------------------------------------------- Level 4
  banishment: {
    effects: [
      {
        step: 'saving_throw',
        ability: 'cha',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'apply_condition',
            conditionId: 'incapacitated',
            durationRounds: 10,
            requiresConcentration: true,
          },
          {
            step: 'manual_adjudication',
            adjudicationId: 'banishment-other-plane',
            title: 'Banishment — Remove from the Battlefield',
            guidance:
              'On a failed CHARISMA save the target is sent to another plane. Remove it from combat until concentration ends or 1 minute passes; if the target is native to the plane, it is instead incapacitated for 1 minute.',
          },
        ],
      },
    ],
  },
  'black-tentacles': {
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'black-tentacles-zone',
        shape: 'cube',
        sizeFeet: 20,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: true,
        obscurement: 'heavy',
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'str',
            dcFormula: '@spellSaveDC',
            onFail: [
              { step: 'apply_condition', conditionId: 'restrained', durationRounds: 1 },
              { step: 'deal_damage', diceFormula: '3d6', damageType: 'bludgeoning', isMagical: true },
            ],
          },
        ],
      },
    ],
  },
  blight: {
    effects: [
      {
        step: 'saving_throw',
        ability: 'con',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'deal_damage', diceFormula: '8d8', damageType: 'necrotic', halfOnSaveSuccess: true, isMagical: true },
        ],
      },
    ],
    higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' },
  },
  confusion: {
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'confusion-zone',
        shape: 'sphere',
        sizeFeet: 10,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: false,
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'wis',
            dcFormula: '@spellSaveDC',
            onFail: [
              {
                step: 'manual_adjudication',
                adjudicationId: 'confusion-compelled-action',
                title: 'Confusion — Roll on the Confusion Table',
                guidance:
                  'Until the end of its turn the creature is confused: roll 1d10 each turn to determine its compelled action, repeat the WIS save at the end of each of its turns to end the effect.',
                suggestedRoll: '1d10',
              },
            ],
          },
        ],
      },
    ],
  },
  'death-ward': {
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'death-ward-ward',
        name: 'Death Ward',
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'death-ward-negate',
        title: 'Death Ward — Negate Instant Death',
        guidance:
          'The first time the target would drop to 0 HP, it instead drops to 1 HP and the spell ends. It is also immune to effects that would kill it outright.',
      },
    ],
  },
  'dimension-door': {
    effects: [{ step: 'teleport', maxDistanceFeet: 500 }],
  },
  'faithful-hound': adjudicatedSpell(
    'faithful-hound-summon',
    'Faithful Hound — Place the Phantom Watchdog',
    'Conjure an invisible watchdog in an unoccupied space within range. It has AC 19, 4 HP, and alerts you to any creature that comes within 30 feet. It can make one opportunity attack of 4d8 + your spellcasting ability modifier force damage.',
  ),
  'fire-shield': {
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'fire-shield-resistance',
        name: 'Fire Shield (Cold/Fire Resistance)',
        durationRounds: 10,
        requiresConcentration: false,
        modifiers: [
          { type: 'damage_mitigation', mitigation: 'resistance', damageTypes: ['cold'] },
          { type: 'damage_mitigation', mitigation: 'resistance', damageTypes: ['fire'] },
        ],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'fire-shield-retaliation',
        title: 'Fire Shield — Retaliation Aura',
        guidance:
          'Whenever a creature within 5 feet hits you with a melee attack, it takes 2d8 cold damage (chill shield) or 2d8 fire damage (flame shield).',
      },
    ],
  },
  'freedom-of-movement': {
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'freedom-of-movement-buff',
        name: 'Freedom of Movement',
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'freedom-of-movement-adjudicate',
        title: 'Freedom of Movement — Ignore Restriction',
        guidance:
          'The target ignores difficult terrain and is unaffected by magical slowing/restraint. A grappled creature can escape automatically by spending 5 feet of movement.',
      },
    ],
  },
  'greater-invisibility': {
    effects: [
      {
        step: 'apply_condition',
        conditionId: 'invisible',
        durationRounds: 600,
        requiresConcentration: true,
      },
    ],
  },
  'guardian-of-faith': adjudicatedSpell(
    'guardian-of-faith-summon',
    'Guardian of Faith — Place the Spectral Guardian',
    'A Large spectral guardian occupies an unoccupied space within 30 feet for 1 minute. Hostile creatures that enter or start their turn within 10 feet take 20 radiant damage (DC save for half). It disappears after dealing 60 damage in total.',
  ),
  'ice-storm': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'deal_damage', diceFormula: '2d8', damageType: 'bludgeoning', halfOnSaveSuccess: true, isMagical: true },
          { step: 'deal_damage', diceFormula: '4d6', damageType: 'cold', halfOnSaveSuccess: true, isMagical: true },
        ],
      },
      {
        step: 'create_hazard_zone',
        zoneId: 'ice-storm-difficult-terrain',
        shape: 'cylinder',
        sizeFeet: 20,
        durationRounds: 1,
        requiresConcentration: false,
        difficultTerrain: true,
        onEnterOrStartTurn: [],
      },
    ],
    higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d6' },
  },
  polymorph: {
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          {
            step: 'apply_active_effect',
            effectId: 'polymorph-beast-form',
            name: 'Polymorph (Beast Form)',
            durationRounds: 600,
            requiresConcentration: true,
            modifiers: [],
          },
          {
            step: 'manual_adjudication',
            adjudicationId: 'polymorph-beast-statblock',
            title: 'Polymorph — Assume Beast Statblock',
            guidance:
              'Swap the target’s statistics with a beast of CR ≤ its level/CR. Its HP becomes the beast’s; on dropping to 0 HP it reverts and takes the excess damage. It loses spellcasting and speech while transformed.',
          },
        ],
      },
    ],
  },
  'private-sanctum': adjudicatedSpell(
    'private-sanctum-ward',
    'Private Sanctum — Ward the Area',
    'Ward a 100-foot cube for 24 hours: no one can see/hear into it, teleport in or out, scry it, or summon creatures into it. One of four additional effects applies as described in the spell.',
  ),
  'resilient-sphere': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'str',
        dcFormula: '@spellSaveDC',
        onFail: [{ step: 'apply_condition', conditionId: 'restrained', durationRounds: 10, requiresConcentration: true }],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'resilient-sphere-isolate',
        title: 'Resilient Sphere — Enclose the Target',
        guidance:
          'The target is enclosed in an immovable sphere. Nothing can pass through the sphere and the target cannot escape by mundane means; it can be moved by teleportation or by dispelling the sphere.',
      },
    ],
  },
  'secret-chest': adjudicatedSpell(
    'secret-chest-stash',
    'Secret Chest — Hide the Receptacle',
    'Send a chest and contents to the Ethereal Plane for 60 days. You can call it back with an action; after 60 days it is permanently lost.',
  ),
  stoneskin: {
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'stoneskin-resistance',
        name: 'Stoneskin',
        durationRounds: 600,
        requiresConcentration: true,
        modifiers: [
          {
            type: 'damage_mitigation',
            mitigation: 'resistance',
            damageTypes: ['bludgeoning', 'piercing', 'slashing'],
            bypassedBy: 'magical',
          },
        ],
      },
    ],
  },
  'wall-of-fire': {
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'wall-of-fire-zone',
        shape: 'line',
        sizeFeet: 60,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: false,
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'dex',
            dcFormula: '@spellSaveDC',
            onFail: [
              { step: 'deal_damage', diceFormula: '5d8', damageType: 'fire', halfOnSaveSuccess: true, isMagical: true },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Level 5
  'arcane-hand': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'deal_damage', diceFormula: '4d6', damageType: 'force', isMagical: true },
          { step: 'forced_movement', direction: 'push_from_actor', distanceFeet: 5 },
        ],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'arcane-hand-grapple',
        title: 'Arcane Hand — Grapple / Clenched Fist',
        guidance:
          'The hand can grapple a Large or smaller creature (contested STR (Athletics) vs the target) and restrain it while grappled; you can also use it to interpose for half cover.',
      },
    ],
  },
  cloudkill: {
    effects: [
      {
        step: 'create_hazard_zone',
        zoneId: 'cloudkill-zone',
        shape: 'sphere',
        sizeFeet: 20,
        durationRounds: 10,
        requiresConcentration: true,
        difficultTerrain: false,
        obscurement: 'heavy',
        onEnterOrStartTurn: [
          {
            step: 'saving_throw',
            ability: 'con',
            dcFormula: '@spellSaveDC',
            onFail: [
              { step: 'deal_damage', diceFormula: '5d8', damageType: 'poison', halfOnSaveSuccess: true, isMagical: true },
            ],
          },
        ],
      },
    ],
    higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' },
  },
  commune: adjudicatedSpell(
    'commune-divine-answers',
    'Commune — Ask the Deity',
    'Ask up to three yes/no questions of your deity or a divine proxy. The DM answers truthfully; a deceptive answer is only possible if the proxy is not your deity and chooses to lie.',
  ),
  'dominate-person': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'apply_condition', conditionId: 'charmed', durationRounds: 600, requiresConcentration: true },
          {
            step: 'manual_adjudication',
            adjudicationId: 'dominate-person-control',
            title: 'Dominate Person — Issue Mental Commands',
            guidance:
              'While charmed, the humanoid is dominated. You can issue telepathic commands it must obey; it can repeat the WIS save when it takes damage, ending the effect on a success.',
          },
        ],
      },
    ],
  },
  'greater-restoration': adjudicatedSpell(
    'greater-restoration-cure',
    'Greater Restoration — End a Debilitating Effect',
    'End one of: charmed, petrified, cursed, reduced ability score, or 1d8×100 HP drain. Choose the condition/healing to remove when adjudicating.',
  ),
  hallow: adjudicatedSpell(
    'hallow-consecrate',
    'Hallow — Consecrate an Area',
    'Infuse a 60-foot radius area with holy or unholy power for 24 hours and choose one additional effect (e.g. undead have disadvantage to attack in the area, or the wounded regain 1d8 HP at the start of their turn).',
  ),
  'hold-monster': {
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
            repeatSaveAtTurnEnd: { ability: 'wis', dcFormula: '@spellSaveDC' },
          },
        ],
      },
    ],
    higherLevelScaling: { mode: 'slot_level', bonusTargetsPerSlotAboveBase: 1 },
  },
  'raise-dead': {
    effects: [
      { step: 'heal', diceFormula: '1' },
      {
        step: 'manual_adjudication',
        adjudicationId: 'raise-dead-revive',
        title: 'Raise Dead — Restore Life',
        guidance:
          'The target returns to life with 1 HP (and loses any remaining death save failures). It cannot have been dead longer than 10 days and must not have died of old age.',
      },
    ],
  },
  'telepathic-bond': adjudicatedSpell(
    'telepathic-bond-link',
    'Telepathic Bond — Link the Party',
    'Up to eight willing creatures within 30 feet can communicate telepathically regardless of distance for 1 hour (same plane).',
  ),
  'tree-stride': {
    effects: [
      { step: 'teleport', maxDistanceFeet: 500 },
      {
        step: 'manual_adjudication',
        adjudicationId: 'tree-stride-transit',
        title: 'Tree Stride — Step Between Trees',
        guidance:
          'Enter a tree and step out of another tree of the same kind within 500 feet. Requires a tree of the same kind at both ends of the transit.',
      },
    ],
  },

  // ---------------------------------------------------------------- Level 6
  'freezing-sphere': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'deal_damage', diceFormula: '10d6', damageType: 'cold', halfOnSaveSuccess: true, isMagical: true },
          { step: 'forced_movement', direction: 'push_from_actor', distanceFeet: 5 },
        ],
      },
    ],
  },
  'globe-of-invulnerability': adjudicatedSpell(
    'globe-of-invulnerability-ward',
    'Globe of Invulnerability — Nullify Low-Level Magic',
    'A 10-foot-radius sphere blocks spells of 5th level or lower cast from outside: they fail to pass through. The caster can cast spells through the globe.',
  ),
  'instant-summons': adjudicatedSpell(
    'instant-summons-mark',
    'Instant Summons — Mark and Recall an Item',
    'Place a sapphire gem worth 1,000 gp on an object; later crush the gem to teleport the object to your hand if it is on the same plane.',
  ),
  'irresistible-dance': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'apply_condition', conditionId: 'incapacitated', durationRounds: 10, requiresConcentration: true },
          {
            step: 'apply_active_effect',
            effectId: 'irresistible-dance-debuff',
            name: 'Irresistible Dance (-2 AC,Disadvantage Saves)',
            durationRounds: 10,
            requiresConcentration: true,
            modifiers: [
              { type: 'flat_bonus', target: 'ac', value: -2 },
              { type: 'roll_mode', mode: 'disadvantage', target: 'all_saving_throws' },
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Level 7
  'arcane-sword': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'dex',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'deal_damage', diceFormula: '4d8', damageType: 'force', isMagical: true },
          { step: 'forced_movement', direction: 'push_from_actor', distanceFeet: 10 },
        ],
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'arcane-sword-guard',
        title: 'Arcane Sword — Guard / Strike',
        guidance:
          'The sword can guard a space (granting half cover) and strike a creature that enters or starts its turn within 15 feet for 4d8 force damage.',
      },
    ],
  },
  'magnificent-mansion': adjudicatedSpell(
    'magnificent-mansion-portal',
    'Magnificent Mansion — Open the Door',
    'Create an extradimensional mansion on a solid surface within 300 feet for 24 hours. The entrance is an invisible portal that only you can open; the interior is furnished and comfortable.',
  ),

  // ---------------------------------------------------------------- Level 8
  'dominate-monster': {
    effects: [
      {
        step: 'saving_throw',
        ability: 'wis',
        dcFormula: '@spellSaveDC',
        onFail: [
          { step: 'apply_condition', conditionId: 'charmed', durationRounds: 600, requiresConcentration: true },
          {
            step: 'manual_adjudication',
            adjudicationId: 'dominate-monster-control',
            title: 'Dominate Monster — Issue Mental Commands',
            guidance:
              'The creature is dominated and obeys your telepathic commands. It repeats the WIS save when it takes damage, ending the effect on a success.',
          },
        ],
      },
    ],
  },
  'power-word-stun': {
    effects: [
      {
        step: 'apply_condition',
        conditionId: 'stunned',
        durationRounds: 10,
      },
      {
        step: 'manual_adjudication',
        adjudicationId: 'power-word-stun-hp-gate',
        title: 'Power Word Stun — Check Hit Points',
        guidance:
          'Only applies if the target has 150 HP or fewer. A stunned target repeats a CON save at the end of each of its turns (DC 8 + your spellcasting ability modifier) to end the stun.',
      },
    ],
  },

  // ---------------------------------------------------------------- Level 9
  foresight: {
    effects: [
      {
        step: 'apply_active_effect',
        effectId: 'foresight-buff',
        name: 'Foresight',
        durationRounds: 4800,
        requiresConcentration: false,
        modifiers: [
          { type: 'roll_mode', mode: 'advantage', target: 'attack_rolls' },
          { type: 'roll_mode', mode: 'advantage', target: 'all_saving_throws' },
          { type: 'roll_mode', mode: 'advantage', target: 'all_ability_checks' },
        ],
      },
    ],
  },
  'power-word-kill': adjudicatedSpell(
    'power-word-kill-hp-gate',
    'Power Word Kill — Check Hit Points',
    'If the target has 100 HP or fewer it dies instantly. Creatures that cannot be killed by this spell (e.g. undead) are unaffected. No saving throw.',
  ),
  'time-stop': adjudicatedSpell(
    'time-stop-boon',
    'Time Stop — Take Extra Turns',
    'You take 1d4 + 1 turns in a row before other creatures act again. Other creatures are effectively inactive and cannot react during this window.',
    '1d4 + 1',
  ),
  'true-resurrection': adjudicatedSpell(
    'true-resurrection-revive',
    'True Resurrection — Restore Life Fully',
    'The target returns to life with all its HP, reverting any age changes, missing limbs restored, and no death save failures. It can have been dead up to 200 years and need not have a body.',
  ),
  wish: adjudicatedSpell(
    'wish-adjudicate',
    'Wish — Adjudicate the Request',
    'Wish can duplicate any spell of level 8 or lower (no costly component), or produce an effect beyond normal spellcasting. If used for anything other than duplicating a spell, there is a 33% chance of never being able to cast Wish again and the stress may incapacitate you.',
  ),

  // ---------------------------------- Upcasting for already-automated spells
  'chain-lightning': { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' } },
  'cone-of-cold': { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' } },
  'finger-of-death': { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' } },
  'flame-strike': { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d6' } },
  heal: { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '10' } },
  'mass-cure-wounds': { higherLevelScaling: { mode: 'slot_level', bonusDicePerSlotAboveBase: '1d8' } },
};
