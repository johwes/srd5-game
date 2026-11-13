import { describe, expect, it } from 'vitest';
import {
  ABILITY_IDS,
  ACTION_COSTS,
  ALIGNMENTS,
  AOE_SHAPE_TYPES,
  AbilityIdSchema,
  ActionCostSchema,
  ActivatedAbilitySpecSchema,
  AlignmentSchema,
  AoeShapeTypeSchema,
  CONDITION_IDS,
  CREATURE_SIZES,
  CREATURE_TYPES,
  ChoiceSpecSchema,
  ConditionIdSchema,
  CreatureSizeSchema,
  CreatureTypeSchema,
  DAMAGE_TYPES,
  DamageTypeSchema,
  EffectStepSpecSchema,
  FlatBonusTargetSchema,
  MAGIC_SCHOOLS,
  MagicSchoolSchema,
  ModifierSpecSchema,
  REST_TYPES,
  RestTypeSchema,
  RollModeTargetSchema,
  SKILL_DEFAULT_ABILITY,
  SKILL_IDS,
  SRD_CLASS_IDS,
  SRD_RACE_IDS,
  SRD_SUBCLASS_IDS,
  SRD_SUBRACE_IDS,
  SkillIdSchema,
  SpellTargetSpecSchema,
  SrdClassIdSchema,
  SrdRaceIdSchema,
  SrdSubclassIdSchema,
  SrdSubraceIdSchema,
} from '../index.js';

describe('@srd5/data SRD-102 core enumerations & canonical IDs', () => {
  it('validates all 6 SRD 5.1 Ability Scores', () => {
    expect(ABILITY_IDS).toHaveLength(6);
    for (const id of ABILITY_IDS) {
      expect(AbilityIdSchema.parse(id)).toBe(id);
    }
    expect(AbilityIdSchema.safeParse('luck').success).toBe(false);
  });

  it('validates all 18 SRD 5.1 Skills and maps each to a default AbilityId', () => {
    expect(SKILL_IDS).toHaveLength(18);
    for (const skill of SKILL_IDS) {
      expect(SkillIdSchema.parse(skill)).toBe(skill);
      expect(AbilityIdSchema.parse(SKILL_DEFAULT_ABILITY[skill])).toBeDefined();
    }
    expect(SKILL_DEFAULT_ABILITY['athletics']).toBe('str');
    expect(SKILL_DEFAULT_ABILITY['stealth']).toBe('dex');
    expect(SKILL_DEFAULT_ABILITY['arcana']).toBe('int');
    expect(SKILL_DEFAULT_ABILITY['perception']).toBe('wis');
    expect(SKILL_DEFAULT_ABILITY['persuasion']).toBe('cha');
    expect(SkillIdSchema.safeParse('streetwise').success).toBe(false);
  });

  it('validates all 13 SRD 5.1 Damage Types', () => {
    expect(DAMAGE_TYPES).toHaveLength(13);
    for (const dt of DAMAGE_TYPES) {
      expect(DamageTypeSchema.parse(dt)).toBe(dt);
    }
    expect(DamageTypeSchema.safeParse('shadow').success).toBe(false);
  });

  it('validates all 15 SRD 5.1 Conditions', () => {
    expect(CONDITION_IDS).toHaveLength(15);
    for (const cond of CONDITION_IDS) {
      expect(ConditionIdSchema.parse(cond)).toBe(cond);
    }
    expect(ConditionIdSchema.safeParse('dazed').success).toBe(false);
  });

  it('validates Creature Sizes, Creature Types, Magic Schools, Rest Types, Action Costs, AOE Shapes, and Alignments', () => {
    expect(CREATURE_SIZES).toHaveLength(6);
    expect(CreatureSizeSchema.parse('medium')).toBe('medium');

    expect(CREATURE_TYPES).toHaveLength(14);
    expect(CreatureTypeSchema.parse('fiend')).toBe('fiend');

    expect(MAGIC_SCHOOLS).toHaveLength(8);
    expect(MagicSchoolSchema.parse('evocation')).toBe('evocation');

    expect(REST_TYPES).toHaveLength(5);
    expect(RestTypeSchema.parse('short_rest')).toBe('short_rest');

    expect(ACTION_COSTS).toHaveLength(6);
    expect(ActionCostSchema.parse('bonus_action')).toBe('bonus_action');

    expect(AOE_SHAPE_TYPES).toHaveLength(5);
    expect(AoeShapeTypeSchema.parse('cone')).toBe('cone');

    expect(ALIGNMENTS).toHaveLength(9);
    expect(AlignmentSchema.parse('lawful_good')).toBe('lawful_good');
  });

  it('validates canonical SRD 5.1 Race, Subrace, Class, and Subclass IDs', () => {
    expect(SRD_RACE_IDS).toHaveLength(9);
    expect(SrdRaceIdSchema.parse('dragonborn')).toBe('dragonborn');

    expect(SRD_SUBRACE_IDS).toHaveLength(4);
    expect(SrdSubraceIdSchema.parse('hill-dwarf')).toBe('hill-dwarf');

    expect(SRD_CLASS_IDS).toHaveLength(12);
    expect(SrdClassIdSchema.parse('paladin')).toBe('paladin');

    expect(SRD_SUBCLASS_IDS).toHaveLength(12);
    expect(SrdSubclassIdSchema.parse('evocation')).toBe('evocation');
  });
});

describe('@srd5/data SRD-102 ChoiceSpec schemas', () => {
  it('validates proficiency, skill, language, and tool choices (explicit and category modes)', () => {
    const fighterSkills = ChoiceSpecSchema.parse({
      id: 'fighter-skills',
      label: 'Choose two skills from the Fighter list',
      count: 2,
      type: 'skill',
      from: {
        mode: 'explicit',
        options: [
          'acrobatics',
          'animal-handling',
          'athletics',
          'history',
          'insight',
          'intimidation',
          'perception',
          'survival',
        ],
      },
    });
    expect(fighterSkills.type).toBe('skill');

    const extraLanguage = ChoiceSpecSchema.parse({
      id: 'human-extra-language',
      label: 'Choose one extra language of your choice',
      count: 1,
      type: 'language',
      from: {
        mode: 'category',
        category: 'standard_or_exotic_languages',
      },
    });
    expect(extraLanguage.type).toBe('language');
  });

  it('validates Half-Elf ability_score_bonus choice', () => {
    const halfElfBonus = ChoiceSpecSchema.parse({
      id: 'half-elf-ability-bonus',
      label: 'Choose two other ability scores to increase by 1',
      count: 2,
      type: 'ability_score_bonus',
      bonus: 1,
      excludeAbilities: ['cha'],
      distinct: true,
    });
    expect(halfElfBonus.type).toBe('ability_score_bonus');
  });

  it('validates High Elf spell choice', () => {
    const highElfCantrip = ChoiceSpecSchema.parse({
      id: 'high-elf-cantrip',
      label: 'Choose one cantrip from the Wizard spell list',
      count: 1,
      type: 'spell',
      classList: 'wizard',
      maxSpellLevel: 0,
    });
    expect(highElfCantrip.type).toBe('spell');
  });

  it('validates Fighter Fighting Style feature_option choice', () => {
    const fightingStyle = ChoiceSpecSchema.parse({
      id: 'fighter-fighting-style',
      label: 'Choose a Fighting Style',
      count: 1,
      type: 'feature_option',
      featureGroup: 'fighting-style',
      options: [
        'archery',
        'defense',
        'dueling',
        'great-weapon-fighting',
        'protection',
        'two-weapon-fighting',
      ],
    });
    expect(fightingStyle.type).toBe('feature_option');
  });

  it('validates equipment_bundle choices with item and category_choice entries', () => {
    const equipmentChoice = ChoiceSpecSchema.parse({
      id: 'fighter-equip-weapons',
      label: 'Choose starting martial weapons',
      count: 1,
      type: 'equipment_bundle',
      options: [
        {
          id: 'weapon-and-shield',
          label: '(a) a martial weapon and a shield',
          items: [
            { kind: 'category_choice', category: 'martial_weapons', count: 1 },
            { kind: 'item', itemId: 'shield', quantity: 1 },
          ],
        },
        {
          id: 'two-martial-weapons',
          label: '(b) two martial weapons',
          items: [{ kind: 'category_choice', category: 'martial_weapons', count: 2 }],
        },
      ],
    });
    expect(equipmentChoice.type).toBe('equipment_bundle');
  });

  it('rejects malformed ChoiceSpec payloads', () => {
    expect(
      ChoiceSpecSchema.safeParse({
        id: 'bad',
        label: 'Bad count',
        count: 0,
        type: 'skill',
        from: { mode: 'explicit', options: [] },
      }).success,
    ).toBe(false);
  });
});

describe('@srd5/data SRD-102 Declarative Modifier & Effect DSL schemas', () => {
  it('validates FlatBonusTarget and RollModeTarget template literals', () => {
    expect(FlatBonusTargetSchema.parse('ac')).toBe('ac');
    expect(FlatBonusTargetSchema.parse('save:con')).toBe('save:con');
    expect(FlatBonusTargetSchema.parse('skill:stealth')).toBe('skill:stealth');
    expect(FlatBonusTargetSchema.safeParse('save:luck').success).toBe(false);
    expect(FlatBonusTargetSchema.safeParse('skill:swimming').success).toBe(false);

    expect(RollModeTargetSchema.parse('attack_rolls')).toBe('attack_rolls');
    expect(RollModeTargetSchema.parse('concentration_saves')).toBe('concentration_saves');
    expect(RollModeTargetSchema.parse('save:wis')).toBe('save:wis');
    expect(RollModeTargetSchema.parse('skill:perception')).toBe('skill:perception');
    expect(RollModeTargetSchema.safeParse('invalid_target').success).toBe(false);
  });

  it('validates all ModifierSpec variants', () => {
    const primalChampion = ModifierSpecSchema.parse({
      type: 'ability_score',
      ability: 'str',
      bonus: 4,
      maxCap: 24,
    });
    expect(primalChampion.type).toBe('ability_score');

    const gauntletsOfOgrePower = ModifierSpecSchema.parse({
      type: 'set_ability_minimum',
      ability: 'str',
      minimum: 19,
    });
    expect(gauntletsOfOgrePower.type).toBe('set_ability_minimum');

    const barbarianUnarmored = ModifierSpecSchema.parse({
      type: 'ac_calculation',
      id: 'unarmored_barbarian',
      formula: '10 + @dexMod + @conMod',
      allowsShield: true,
      requiresNoArmor: true,
    });
    expect(barbarianUnarmored.type).toBe('ac_calculation');

    const archeryStyle = ModifierSpecSchema.parse({
      type: 'flat_bonus',
      target: 'ranged_attack',
      value: 2,
      condition: 'wielding_ranged_weapon',
    });
    expect(archeryStyle.type).toBe('flat_bonus');

    const dwarvenResilienceRoll = ModifierSpecSchema.parse({
      type: 'roll_mode',
      mode: 'advantage',
      target: 'save:con',
      condition: 'save_against_poison',
    });
    expect(dwarvenResilienceRoll.type).toBe('roll_mode');

    const rageResistance = ModifierSpecSchema.parse({
      type: 'damage_mitigation',
      mitigation: 'resistance',
      damageTypes: ['bludgeoning', 'piercing', 'slashing'],
    });
    expect(rageResistance.type).toBe('damage_mitigation');

    const conditionImmunity = ModifierSpecSchema.parse({
      type: 'condition_immunity',
      conditions: ['charmed', 'frightened'],
    });
    expect(conditionImmunity.type).toBe('condition_immunity');

    const improvedCritical = ModifierSpecSchema.parse({
      type: 'die_manipulation',
      rule: 'expanded_crit_range',
      params: { minCritRoll: 19 },
    });
    expect(improvedCritical.type).toBe('die_manipulation');

    const extraAttack = ModifierSpecSchema.parse({
      type: 'extra_attack',
      attacksPerAction: 2,
    });
    expect(extraAttack.type).toBe('extra_attack');

    const kiResource = ModifierSpecSchema.parse({
      type: 'grant_resource',
      resourceId: 'ki',
      name: 'Ki Points',
      maxFormula: '@classLevel',
      recovery: 'short_rest',
    });
    expect(kiResource.type).toBe('grant_resource');
  });

  it('validates recursive EffectStepSpec pipelines (Fireball, Acid Arrow, Hold Person, Web, Second Wind)', () => {
    // Fireball: DEX save -> 8d6 fire (half on save)
    const fireballEffect = EffectStepSpecSchema.parse({
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
      onSuccess: [
        {
          step: 'deal_damage',
          diceFormula: '8d6',
          damageType: 'fire',
          halfOnSaveSuccess: true,
          isMagical: true,
        },
      ],
    });
    expect(fireballEffect.step).toBe('saving_throw');

    // Acid Arrow: Ranged spell attack with onHit and onMiss branches
    const acidArrowEffect = EffectStepSpecSchema.parse({
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
          diceFormula: 'floor(4d4 / 2)',
          damageType: 'acid',
          isMagical: true,
        },
      ],
    });
    expect(acidArrowEffect.step).toBe('attack_roll');

    // Hold Person: WIS save -> Paralyzed with repeat save at turn end
    const holdPersonEffect = EffectStepSpecSchema.parse({
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
    });
    expect(holdPersonEffect.step).toBe('saving_throw');

    // Web: Create hazard zone with difficult terrain and nested DEX save on enter/start of turn
    const webZoneEffect = EffectStepSpecSchema.parse({
      step: 'create_hazard_zone',
      zoneId: 'web',
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
              requiresConcentration: true,
            },
          ],
        },
      ],
    });
    expect(webZoneEffect.step).toBe('create_hazard_zone');

    // Bless: apply_active_effect
    const blessEffect = EffectStepSpecSchema.parse({
      step: 'apply_active_effect',
      effectId: 'bless',
      name: 'Bless',
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
          target: 'all_saving_throws',
          value: '1d4',
        },
      ],
    });
    expect(blessEffect.step).toBe('apply_active_effect');

    // Thunderwave push, Misty Step teleport, False Life temp HP, Second Wind heal + spend_resource
    expect(
      EffectStepSpecSchema.parse({
        step: 'forced_movement',
        direction: 'push_from_actor',
        distanceFeet: 10,
      }).step,
    ).toBe('forced_movement');

    expect(
      EffectStepSpecSchema.parse({
        step: 'teleport',
        maxDistanceFeet: 30,
      }).step,
    ).toBe('teleport');

    expect(
      EffectStepSpecSchema.parse({
        step: 'grant_temp_hp',
        amountFormula: '1d4 + 4',
      }).step,
    ).toBe('grant_temp_hp');

    const secondWindAbility = ActivatedAbilitySpecSchema.parse({
      id: 'second-wind',
      name: 'Second Wind',
      description: 'Use a bonus action to regain 1d10 + fighter level hit points.',
      actionCost: 'bonus_action',
      resourceCost: {
        resourceId: 'second_wind',
        amount: 1,
      },
      targeting: {
        type: 'self',
        rangeFeet: 0,
      },
      effects: [
        {
          step: 'spend_resource',
          resourceId: 'second_wind',
          amount: 1,
        },
        {
          step: 'heal',
          diceFormula: '1d10 + @classLevel',
        },
      ],
    });
    expect(secondWindAbility.id).toBe('second-wind');
  });

  it('validates SpellTargetSpec AOE shapes and multi-target formulas', () => {
    const fireballTarget = SpellTargetSpecSchema.parse({
      type: 'point_aoe',
      rangeFeet: 150,
      aoe: {
        shape: 'sphere',
        sizeFeet: 20,
      },
    });
    expect(fireballTarget.aoe?.shape).toBe('sphere');

    const magicMissileTarget = SpellTargetSpecSchema.parse({
      type: 'multiple',
      rangeFeet: 120,
      requiresSight: true,
      targetFilter: 'creature',
      maxTargets: '3 + (@slotLevel - 1)',
    });
    expect(magicMissileTarget.maxTargets).toBe('3 + (@slotLevel - 1)');
  });
});
