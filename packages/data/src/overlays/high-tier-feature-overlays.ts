import type { ActionCost } from '../schemas/index.js';
import type { FeatureOverlaySpec } from '../ingestion/overlay.js';

/**
 * Builds a structured "Manual / Adjudicated Resolution" activated ability for
 * a high-tier feature whose full effect cannot be automated by the tactical
 * DSL. Uses `free` action cost by default so adding the hook never changes a
 * combatant's action economy.
 */
function adjudicatedFeatureAbility(
  id: string,
  title: string,
  guidance: string,
  options?: { actionCost?: ActionCost; suggestedRoll?: string; description?: string },
): FeatureOverlaySpec {
  return {
    activatedAbilities: [
      {
        id,
        name: title,
        description: options?.description ?? guidance,
        actionCost: options?.actionCost ?? 'free',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [
          {
            step: 'manual_adjudication',
            adjudicationId: id,
            title,
            guidance,
            ...(options?.suggestedRoll ? { suggestedRoll: options.suggestedRoll } : {}),
          },
        ],
      },
    ],
  };
}

/** Shared Evasion adjudication hook used by both Monk and Rogue. */
const EVASION_OVERLAY: FeatureOverlaySpec = adjudicatedFeatureAbility(
  'adjudicate-evasion',
  'Evasion — Halve or Negate Area Damage',
  'When you succeed on a DEX saving throw against an area effect, you take no damage; on a failure you take only half damage.',
);

/**
 * Combat Tier B (Levels 6–10) & Tier C (Levels 11–20) executable Effect DSL
 * overlays for class/subclass features. Mechanical features receive real
 * ModifierSpec/EffectStepSpec definitions; narrative or DM-adjudicated
 * features receive an explicit adjudication hook so they are never silent
 * no-ops.
 */
export const SRD_HIGH_TIER_FEATURE_OVERLAYS: Readonly<Record<string, FeatureOverlaySpec>> = {
  // --------------------------------------------------------------- Bard
  countercharm: {
    modifiers: [
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'all_saving_throws',
        condition: 'save_against_charmed',
      },
      {
        type: 'roll_mode',
        mode: 'advantage',
        target: 'all_saving_throws',
        condition: 'save_against_frightened',
      },
    ],
  },
  'additional-fighting-style': adjudicatedFeatureAbility(
    'adjudicate-additional-fighting-style',
    'Additional Fighting Style — Choose a Second Style',
    'Choose a second Fighting Style option from the fighter list (or the champion list if applicable).',
  ),
  'additional-magical-secrets': adjudicatedFeatureAbility(
    'adjudicate-additional-magical-secrets',
    'Additional Magical Secrets — Learn Spells',
    'Choose two spells from any class list that you have the spell slots to cast. Add them to your known spells.',
  ),
  'magical-secrets': adjudicatedFeatureAbility(
    'adjudicate-magical-secrets',
    'Magical Secrets — Learn Spells',
    'Choose two spells from any class list that you have the spell slots to cast. Add them to your known spells.',
  ),
  'peerless-skill': adjudicatedFeatureAbility(
    'adjudicate-peerless-skill',
    'Peerless Skill — Add Bardic Inspiration',
    'Expend one use of Bardic Inspiration and add the die result to an ability check you just made.',
    { suggestedRoll: '1d12' },
  ),
  'superior-inspiration': adjudicatedFeatureAbility(
    'adjudicate-superior-inspiration',
    'Superior Inspiration — Refill on Initiative',
    'When you roll initiative and have no uses of Bardic Inspiration left, you regain one use.',
  ),

  // --------------------------------------------------------------- Barbarian
  'intimidating-presence': {
    activatedAbilities: [
      {
        id: 'intimidating-presence-frighten',
        name: 'Intimidating Presence',
        description: 'Use your action to frighten a creature within 30 feet of you.',
        actionCost: 'action',
        targeting: { type: 'single', rangeFeet: 30, targetFilter: 'enemy' },
        effects: [
          {
            step: 'saving_throw',
            ability: 'wis',
            dcFormula: '@spellSaveDC',
            onFail: [{ step: 'apply_condition', conditionId: 'frightened', durationRounds: 10 }],
          },
        ],
      },
    ],
  },
  indomitable: adjudicatedFeatureAbility(
    'adjudicate-indomitable',
    'Indomitable — Reroll a Failed Save',
    'Reroll a saving throw you just failed. You must use the new roll.',
    { suggestedRoll: '1d20' },
  ),
  'relentless-rage': adjudicatedFeatureAbility(
    'adjudicate-relentless-rage',
    'Relentless Rage — Survive at 0 HP',
    'If you drop to 0 HP while raging and did not die outright, make a CON save (DC 10 + 5 per previous use since a short rest) to drop to 1 HP instead.',
    { suggestedRoll: '1d20 + @conMod' },
  ),
  retaliation: adjudicatedFeatureAbility(
    'adjudicate-retaliation',
    'Retaliation — Reactive Attack',
    'When a creature within 5 feet damages you, you can use your reaction to make a melee weapon attack against it.',
  ),
  'indomitable-might': adjudicatedFeatureAbility(
    'adjudicate-indomitable-might',
    'Indomitable Might — Minimum Strength Check',
    'If your total for a Strength check is less than your Strength score, you can use that score in place of the total.',
  ),
  'persistent-rage': adjudicatedFeatureAbility(
    'adjudicate-persistent-rage',
    'Persistent Rage — Sustain Rage',
    'Your rage lasts until you fall unconscious or choose to end it, rather than ending after 1 minute.',
  ),

  // --------------------------------------------------------------- Cleric
  'blessed-healer': adjudicatedFeatureAbility(
    'adjudicate-blessed-healer',
    'Blessed Healer — Shared Healing',
    'When you cast a healing spell on another creature, you regain 2 + the spell’s level hit points.',
  ),
  'divine-intervention': adjudicatedFeatureAbility(
    'adjudicate-divine-intervention',
    'Divine Intervention — Call on Your Deity',
    'You can call on your deity to intervene; describe the desired aid and the DM determines whether and how it occurs. Once used, you cannot use it again for 7 days.',
  ),
  'supreme-healing': adjudicatedFeatureAbility(
    'adjudicate-supreme-healing',
    'Supreme Healing — Maximum Healing Dice',
    'When you would roll one or more dice to restore HP with a spell, use the maximum result instead.',
  ),

  // --------------------------------------------------------------- Druid
  'lands-stride': adjudicatedFeatureAbility(
    'adjudicate-lands-stride',
    'Land’s Stride — Ignore Difficult Terrain',
    'Moving through nonmagical difficult terrain costs you no extra movement, and you can pass through nonmagical plants without being slowed or damaged.',
  ),
  'natures-ward': adjudicatedFeatureAbility(
    'adjudicate-natures-ward',
    'Nature’s Ward — Elemental/Fey Resistance',
    'You cannot be charmed or frightened by elementals or fey, and you are immune to poison and being poisoned.',
  ),
  'natures-sanctuary': adjudicatedFeatureAbility(
    'adjudicate-natures-sanctuary',
    'Nature’s Sanctuary — Beasts and Plants Hesitate',
    'Beasts and plants are hesitant to attack you; they have disadvantage on attack rolls against you unless you attack them first.',
  ),
  'beast-spells': adjudicatedFeatureAbility(
    'adjudicate-beast-spells',
    'Beast Spells — Cast in Wild Shape',
    'You can cast many of your druid spells while in a Wild Shape beast form, and you can use verbal and somatic components in beast form.',
  ),
  archdruid: adjudicatedFeatureAbility(
    'adjudicate-archdruid',
    'Archdruid — Unlimited Wild Shape',
    'You can use Wild Shape an unlimited number of times and can assume a form with a CR of 1 or lower as a bonus action.',
  ),

  // --------------------------------------------------------------- Fighter
  'remarkable-athlete': adjudicatedFeatureAbility(
    'adjudicate-remarkable-athlete',
    'Remarkable Athlete — Half Proficiency',
    'Add half your proficiency bonus (rounded up) to any Strength, Dexterity, or Constitution check that does not already include your proficiency bonus.',
  ),
  'survivor': {
    activatedAbilities: [
      {
        id: 'survivor-heal',
        name: 'Survivor',
        description: 'Regain hit points at the start of each of your turns if at or below half maximum HP.',
        actionCost: 'free',
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'heal', diceFormula: '5 + @conMod' }],
      },
    ],
  },

  // --------------------------------------------------------------- Monk
  'ki-empowered-strikes': adjudicatedFeatureAbility(
    'adjudicate-ki-empowered-strikes',
    'Ki-Empowered Strikes — Magical Unarmed Attacks',
    'Your unarmed strikes count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.',
  ),
  'wholeness-of-body': {
    activatedAbilities: [
      {
        id: 'wholeness-of-body-heal',
        name: 'Wholeness of Body',
        description: 'As an action, spend 2 ki points to regain hit points equal to three times your monk level.',
        actionCost: 'action',
        resourceCost: { resourceId: 'ki', amount: 2 },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'heal', diceFormula: '@classLevel * 3' }],
      },
    ],
  },
  'stillness-of-mind': adjudicatedFeatureAbility(
    'adjudicate-stillness-of-mind',
    'Stillness of Mind — End Charm/Fear',
    'Use your action to end one effect on yourself that is causing you to be charmed or frightened.',
    { actionCost: 'action' },
  ),
  'diamond-soul': adjudicatedFeatureAbility(
    'adjudicate-diamond-soul',
    'Diamond Soul — Proficiency in All Saves',
    'You have proficiency in all saving throws. If you already have proficiency in a save from another source, you gain no additional benefit.',
  ),
  'timeless-body-monk': adjudicatedFeatureAbility(
    'adjudicate-timeless-body-monk',
    'Timeless Body — Slow Aging',
    'Your ki sustains you so that you suffer none of the frailty of old age; you cannot be aged magically and no longer need food or water.',
  ),
  'evasion-monk': EVASION_OVERLAY,

  // --------------------------------------------------------------- Paladin
  'divine-strike-life': adjudicatedFeatureAbility(
    'adjudicate-divine-strike-life',
    'Divine Strike — Extra Radiant Damage',
    'Once per turn when you hit a creature with a weapon attack, deal an extra 1d8 radiant damage.',
  ),
  'cleansing-touch': adjudicatedFeatureAbility(
    'adjudicate-cleansing-touch',
    'Cleansing Touch — End a Spell',
    'Use your action to end one spell on yourself or a willing creature you touch.',
    { actionCost: 'action' },
  ),
  'purity-of-spirit': adjudicatedFeatureAbility(
    'adjudicate-purity-of-spirit',
    'Purity of Spirit — Permanent Protection',
    'You are always under the effects of a protection from evil and good spell (advantage on saves against aberrations, celestials, elementals, fey, fiends, and undead).',
  ),
  'holy-nimbus': adjudicatedFeatureAbility(
    'adjudicate-holy-nimbus',
    'Holy Nimbus — Radiant Aura',
    'As an action, emanate sunlight for 1 minute. Hostile creatures that start their turn within 30 feet take 10 radiant damage and are blinded until the end of their turn.',
    { actionCost: 'action', suggestedRoll: '10' },
  ),

  // --------------------------------------------------------------- Ranger
  'lands-stride-ranger': adjudicatedFeatureAbility(
    'adjudicate-lands-stride-ranger',
    'Land’s Stride — Ignore Difficult Terrain',
    'Moving through nonmagical difficult terrain costs you no extra movement, and you can pass through nonmagical plants without being slowed or damaged.',
  ),
  'defensive-tactics': adjudicatedFeatureAbility(
    'adjudicate-defensive-tactics',
    'Defensive Tactics — Choose a Benefit',
    'Choose Escape the Horde (disadvantage on opportunity attacks against you), Multiattack Defense (+4 AC against attacks from a creature that hit you), or Steel Wind Strike-style protection.',
  ),
  'multiattack-hunter': adjudicatedFeatureAbility(
    'adjudicate-multiattack-hunter',
    'Multiattack — Volley or Whirlwind Attack',
    'Choose Volley (ranged attacks against up to two targets within 10 feet of each other) or Whirlwind Attack (melee attacks against all creatures within 5 feet).',
  ),
  'superior-hunters-defense': adjudicatedFeatureAbility(
    'adjudicate-superior-hunters-defense',
    'Superior Hunter’s Defense — Choose a Benefit',
    'Choose Evasion, Stand Against the Tide (reaction to force a miss to reroll), or Uncanny Dodge (halve damage on a hit).',
  ),
  'hide-in-plain-sight': adjudicatedFeatureAbility(
    'adjudicate-hide-in-plain-sight',
    'Hide in Plain Sight — Camouflage',
    'Spend 1 minute to create camouflage for yourself, granting advantage on DEX (Stealth) checks while you do not move.',
  ),
  vanish: adjudicatedFeatureAbility(
    'adjudicate-vanish',
    'Vanish — Bonus Action Hide',
    'You can take the Hide action as a bonus action on your turn.',
    { actionCost: 'bonus_action' },
  ),
  'foe-slayer': adjudicatedFeatureAbility(
    'adjudicate-foe-slayer',
    'Foe Slayer — Add Wisdom to Attack/Damage',
    'Add your Wisdom modifier to the attack roll or damage roll of one attack against your favored enemy per turn.',
  ),

  // --------------------------------------------------------------- Rogue
  'evasion-rogue': EVASION_OVERLAY,
  'supreme-sneak': adjudicatedFeatureAbility(
    'adjudicate-supreme-sneak',
    'Supreme Sneak — Advantage on Stealth',
    'You have advantage on a DEX (Stealth) check if you move no more than half your speed on the same turn.',
  ),
  'reliable-talent': adjudicatedFeatureAbility(
    'adjudicate-reliable-talent',
    'Reliable Talent — Minimum 10 on Proficiency Checks',
    'Whenever you make an ability check that lets you add your proficiency bonus, treat a d20 roll of 9 or lower as a 10.',
  ),
  blindsense: adjudicatedFeatureAbility(
    'adjudicate-blindsense',
    'Blindsense — Locate Hidden Creatures',
    'If you can hear, you are aware of the location of any hidden or invisible creature within 10 feet of you.',
  ),
  'use-magic-device': adjudicatedFeatureAbility(
    'adjudicate-use-magic-device',
    'Use Magic Device — Improvise Items',
    'You can use almost any magic item, ignoring class/race/alignment requirements, and can mimic class features to activate wands and scrolls.',
  ),
  'slippery-mind': adjudicatedFeatureAbility(
    'adjudicate-slippery-mind',
    'Slippery Mind — Wisdom Save Proficiency',
    'You gain proficiency in Wisdom saving throws.',
  ),
  'thiefs-reflexes': adjudicatedFeatureAbility(
    'adjudicate-thiefs-reflexes',
    'Thief’s Reflexes — Two Turns in the First Round',
    'You can take two turns during the first round of any combat. The second turn occurs immediately after your first.',
  ),
  'stroke-of-luck': adjudicatedFeatureAbility(
    'adjudicate-stroke-of-luck',
    'Stroke of Luck — Turn a Miss into a Hit',
    'Once per short rest, turn a missed attack into a hit or fail an ability check you just made into a success.',
  ),

  // --------------------------------------------------------------- Sorcerer
  'elemental-affinity': adjudicatedFeatureAbility(
    'adjudicate-elemental-affinity',
    'Elemental Affinity — Ignore Resistance',
    'When you cast a spell that deals damage matching your draconic ancestry, you ignore the target’s resistance to that damage type, and add your CHARISMA modifier to one damage roll of the spell.',
  ),
  'draconic-presence': adjudicatedFeatureAbility(
    'adjudicate-draconic-presence',
    'Draconic Presence — Frighten with Ancestry',
    'As an action, spend 5 sorcery points to cause creatures within 60 feet that can see you to be frightened for 1 minute (WIS save to end).',
    { actionCost: 'action', suggestedRoll: '1d20 + @wisMod' },
  ),

  // --------------------------------------------------------------- Warlock
  'dark-ones-own-luck': adjudicatedFeatureAbility(
    'adjudicate-dark-ones-own-luck',
    'Dark One’s Own Luck — Add 1d10 to a Roll',
    'When you make an ability check or saving throw, you can add 1d10 to the roll. Once you do so, you cannot use this feature again until you finish a short or long rest.',
    { suggestedRoll: '1d10' },
  ),
  'fiendish-resilience': adjudicatedFeatureAbility(
    'adjudicate-fiendish-resilience',
    'Fiendish Resilience — Choose a Resistance',
    'Choose one damage type when you finish a short or long rest. You gain resistance to that damage type until you choose a different one with this feature.',
  ),
  'hurl-through-hell': adjudicatedFeatureAbility(
    'adjudicate-hurl-through-hell',
    'Hurl Through Hell — Banish on Hit',
    'When you hit a creature with an attack, you can teleport it to the Feywild or another plane for one round, dealing 10d10 psychic damage when it returns.',
  ),
  'eldritch-master': adjudicatedFeatureAbility(
    'adjudicate-eldritch-master',
    'Eldritch Master — Refill Spell Slots',
    'Spend 1 minute entreating your patron to regain all your expended warlock spell slots. Once used, you cannot do so again until you finish a long rest.',
  ),

  // --------------------------------------------------------------- Wizard
  'potent-cantrip': adjudicatedFeatureAbility(
    'adjudicate-potent-cantrip',
    'Potent Cantrip — Half Damage on Save',
    'Your damaging cantrips affect even creatures that avoid the brunt of the effect: a target that succeeds on the save takes half the cantrip’s damage.',
  ),
  'empowered-evocation': adjudicatedFeatureAbility(
    'adjudicate-empowered-evocation',
    'Empowered Evocation — Add INT to Damage',
    'Add your Intelligence modifier to one damage roll of any wizard evocation spell you cast.',
  ),
  overchannel: adjudicatedFeatureAbility(
    'adjudicate-overchannel',
    'Overchannel — Maximum Damage',
    'Deal maximum damage with a wizard spell of level 5 or lower. Using this feature on a spell of level 1–5 causes 2d12 necrotic damage to you and locks it out until a long rest.',
  ),
  'spell-mastery': adjudicatedFeatureAbility(
    'adjudicate-spell-mastery',
    'Spell Mastery — At-Will Spell',
    'Choose one 1st-level and one 2nd-level wizard spell you know; you can cast them at their lowest level without expending a spell slot.',
  ),
  'signature-spells': adjudicatedFeatureAbility(
    'adjudicate-signature-spells',
    'Signature Spells — At-Will 3rd Level',
    'Choose two 3rd-level wizard spells you know; you can cast each of them once without expending a spell slot, regaining the uses on a short or long rest.',
  ),

  // ------------------------------------------- Shared / multiclass features
  'improved-divine-smite': adjudicatedFeatureAbility(
    'adjudicate-improved-divine-smite',
    'Improved Divine Smite — Radiant Damage on Every Hit',
    'Whenever you hit a creature with a melee weapon, the creature takes an extra 1d8 radiant damage.',
  ),
  tranquility: adjudicatedFeatureAbility(
    'adjudicate-tranquility',
    'Tranquility — Aura of Peace',
    'Enter a special meditation for 10 minutes. Hostile creatures that start their turn within 30 feet must succeed on a WIS save or be charmed by you for 1 minute.',
  ),
  'mystic-arcanum-6': adjudicatedFeatureAbility(
    'adjudicate-mystic-arcanum-6',
    'Mystic Arcanum (6th Level)',
    'You gain a 6th-level warlock spell that you can cast once per long rest without expending a spell slot.',
  ),
  'mystic-arcanum-7': adjudicatedFeatureAbility(
    'adjudicate-mystic-arcanum-7',
    'Mystic Arcanum (7th Level)',
    'You gain a 7th-level warlock spell that you can cast once per long rest without expending a spell slot.',
  ),
  'mystic-arcanum-8': adjudicatedFeatureAbility(
    'adjudicate-mystic-arcanum-8',
    'Mystic Arcanum (8th Level)',
    'You gain an 8th-level warlock spell that you can cast once per long rest without expending a spell slot.',
  ),
  'mystic-arcanum-9': adjudicatedFeatureAbility(
    'adjudicate-mystic-arcanum-9',
    'Mystic Arcanum (9th Level)',
    'You gain a 9th-level warlock spell that you can cast once per long rest without expending a spell slot.',
  ),
  'tongue-of-the-sun-and-moon': adjudicatedFeatureAbility(
    'adjudicate-tongue-of-the-sun-and-moon',
    'Tongue of the Sun and Moon — Understand All Speech',
    'You can understand all spoken languages, and any creature that understands a language you speak can understand you.',
  ),
  'sorcerous-restoration': adjudicatedFeatureAbility(
    'adjudicate-sorcerous-restoration',
    'Sorcerous Restoration — Refund Sorcery Points',
    'You regain 4 expended sorcery points whenever you finish a short rest.',
  ),
  'perfect-self': adjudicatedFeatureAbility(
    'adjudicate-perfect-self',
    'Perfect Self — Refund Ki on Initiative',
    'When you roll for initiative and have no ki points remaining, you regain 4 ki points.',
  ),
  'timeless-body-druid': adjudicatedFeatureAbility(
    'adjudicate-timeless-body-druid',
    'Timeless Body — Slow Aging',
    'The primal magic you wield causes you to age more slowly; you cannot be aged magically and no longer need food or water.',
  ),
  'dragon-wings': adjudicatedFeatureAbility(
    'adjudicate-dragon-wings',
    'Dragon Wings — Fly',
    'Sprout draconic wings, gaining a flying speed equal to your walking speed.',
  ),
  'quivering-palm': adjudicatedFeatureAbility(
    'adjudicate-quivering-palm',
    'Quivering Palm — Delayed Death',
    'Spend 3 ki points to set lethal vibrations in a creature you hit. Within 1 year, use an action to force a CON save (DC 8 + WIS + prof); on a failure the target drops to 0 HP, on a success it takes 10d10 necrotic damage.',
    { actionCost: 'action' },
  ),
  'empty-body': {
    activatedAbilities: [
      {
        id: 'empty-body-invisibility',
        name: 'Empty Body — Invisibility',
        description: 'Spend 4 ki points to become invisible for 1 minute.',
        actionCost: 'action',
        resourceCost: { resourceId: 'ki', amount: 4 },
        targeting: { type: 'self', rangeFeet: 0 },
        effects: [{ step: 'apply_condition', conditionId: 'invisible', durationRounds: 10 }],
      },
    ],
  },
  elusive: adjudicatedFeatureAbility(
    'adjudicate-elusive',
    'Elusive — No Advantage Against You',
    'No attack roll has advantage against you while you aren’t incapacitated.',
  ),
  'feral-senses': adjudicatedFeatureAbility(
    'adjudicate-feral-senses',
    'Feral Senses — Fight the Unseen',
    'You are aware of the location of any invisible creature within 30 feet, and you do not suffer disadvantage on attack rolls against creatures you cannot see.',
  ),
};
