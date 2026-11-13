import { describe, expect, it } from 'vitest';
import {
  BackgroundSchema,
  type ClassLevelProgression,
  ClassSchema,
  FeatSchema,
  FeatureSchema,
  RaceSchema,
  SubclassSchema,
  SubraceSchema,
} from '../index.js';

function buildLevels1To20(
  customize?: (level: number, defaultBonus: number) => Partial<ClassLevelProgression>,
): ClassLevelProgression[] {
  return Array.from({ length: 20 }, (_, i) => {
    const level = i + 1;
    const proficiencyBonus = 2 + Math.floor((level - 1) / 4);
    const base: ClassLevelProgression = {
      level,
      proficiencyBonus,
      featureIds: [],
      classSpecific: {},
    };
    return {
      ...base,
      ...(customize ? customize(level, proficiencyBonus) : {}),
    };
  });
}

describe('@srd5/data SRD-103 Race & Subrace schemas', () => {
  it('validates Dwarf base race and Hill Dwarf subrace with modifiers', () => {
    const dwarf = RaceSchema.parse({
      id: 'dwarf',
      name: 'Dwarf',
      size: 'medium',
      speedFeet: 25,
      abilityBonuses: { con: 2 },
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
      senses: { darkvisionFeet: 60 },
      proficiencies: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'],
      languages: ['common', 'dwarvish'],
      traits: [
        {
          id: 'dwarven-resilience',
          name: 'Dwarven Resilience',
          description:
            'You have advantage on saving throws against poison, and you have resistance against poison damage.',
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
      ],
      subraceIds: ['hill-dwarf'],
      description: 'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone and metal.',
    });

    expect(dwarf.id).toBe('dwarf');
    expect(dwarf.abilityBonuses.con).toBe(2);
    expect(dwarf.senses.darkvisionFeet).toBe(60);

    const hillDwarf = SubraceSchema.parse({
      id: 'hill-dwarf',
      parentRaceId: 'dwarf',
      name: 'Hill Dwarf',
      abilityBonuses: { wis: 1 },
      choices: [],
      proficiencies: [],
      traits: [
        {
          id: 'dwarven-toughness',
          name: 'Dwarven Toughness',
          description: 'Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.',
          modifiers: [
            {
              type: 'flat_bonus',
              target: 'hp_per_level',
              value: 1,
            },
          ],
        },
      ],
      description: 'As a hill dwarf, you have keen senses, deep intuition, and remarkable resilience.',
    });

    expect(hillDwarf.parentRaceId).toBe('dwarf');
    expect(hillDwarf.traits[0]?.modifiers[0]?.type).toBe('flat_bonus');
  });

  it('validates Dragonborn activated Breath Weapon and Tiefling innate spells', () => {
    const dragonborn = RaceSchema.parse({
      id: 'dragonborn',
      name: 'Dragonborn',
      size: 'medium',
      speedFeet: 30,
      abilityBonuses: { str: 2, cha: 1 },
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
      senses: {},
      proficiencies: [],
      languages: ['common', 'draconic'],
      traits: [
        {
          id: 'breath-weapon',
          name: 'Breath Weapon',
          description: 'You can use your action to exhale destructive energy.',
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
              id: 'breath-weapon-fire-cone',
              name: 'Breath Weapon (Fire Cone)',
              description: 'Each creature in a 15-foot cone must make a DEX saving throw.',
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
      ],
      subraceIds: [],
      description: 'Born of dragons, as their name proclaims, the dragonborn walk proudly through a world that greets them with fearful incomprehension.',
    });

    expect(dragonborn.traits[0]?.activatedAbilities).toHaveLength(1);

    const tiefling = RaceSchema.parse({
      id: 'tiefling',
      name: 'Tiefling',
      size: 'medium',
      speedFeet: 30,
      abilityBonuses: { int: 1, cha: 2 },
      choices: [],
      senses: { darkvisionFeet: 60 },
      proficiencies: [],
      languages: ['common', 'infernal'],
      traits: [
        {
          id: 'infernal-legacy',
          name: 'Infernal Legacy',
          description: 'You know the thaumaturgy cantrip. At 3rd level, you can cast hellish rebuke once per long rest.',
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
      ],
      subraceIds: [],
      description: 'To be greeted with stares and whispers, to suffer violence and insult on the street, to see mistrust and fear in every eye: this is the lot of the tiefling.',
    });

    expect(tiefling.traits[0]?.innateSpells).toHaveLength(3);
  });

  it('rejects unknown ability keys in abilityBonuses or non-positive speedFeet', () => {
    expect(
      RaceSchema.safeParse({
        id: 'bad-race',
        name: 'Bad Race',
        size: 'medium',
        speedFeet: 0,
        abilityBonuses: { str: 1 },
        choices: [],
        senses: {},
        proficiencies: [],
        languages: ['common'],
        traits: [],
        subraceIds: [],
        description: 'Invalid speed.',
      }).success,
    ).toBe(false);

    expect(
      RaceSchema.safeParse({
        id: 'bad-race-ability',
        name: 'Bad Race',
        size: 'medium',
        speedFeet: 30,
        abilityBonuses: { luck: 2 },
        choices: [],
        senses: {},
        proficiencies: [],
        languages: ['common'],
        traits: [],
        subraceIds: [],
        description: 'Invalid ability.',
      }).success,
    ).toBe(false);
  });
});

describe('@srd5/data SRD-103 Class (L1–20), Subclass, and Feature schemas', () => {
  it('validates a full 20-level martial Class (Fighter) and Champion Subclass', () => {
    const fighter = ClassSchema.parse({
      id: 'fighter',
      name: 'Fighter',
      hitDie: 10,
      primaryAbilities: ['str', 'dex'],
      savingThrowProficiencies: ['str', 'con'],
      armorProficiencies: ['light-armor', 'medium-armor', 'heavy-armor', 'shields'],
      weaponProficiencies: ['simple-weapons', 'martial-weapons'],
      toolProficiencies: [],
      skillChoices: {
        id: 'fighter-skills',
        label: 'Choose two skills from Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, and Survival',
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
      },
      startingEquipmentChoices: [
        {
          id: 'fighter-armor-choice',
          label: '(a) chain mail or (b) leather armor, longbow, and 20 arrows',
          count: 1,
          type: 'equipment_bundle',
          options: [
            {
              id: 'chain-mail',
              label: 'Chain mail',
              items: [{ kind: 'item', itemId: 'chain-mail', quantity: 1 }],
            },
            {
              id: 'leather-and-bow',
              label: 'Leather armor, longbow, and 20 arrows',
              items: [
                { kind: 'item', itemId: 'leather-armor', quantity: 1 },
                { kind: 'item', itemId: 'longbow', quantity: 1 },
                { kind: 'item', itemId: 'arrow', quantity: 20 },
              ],
            },
          ],
        },
      ],
      startingGoldFormula: '5d4 * 10',
      subclassLevel: 3,
      subclassTitle: 'Martial Archetype',
      subclassIds: ['champion'],
      levels: buildLevels1To20((level) => ({
        featureIds:
          level === 1
            ? ['fighting-style', 'second-wind']
            : level === 2
              ? ['action-surge']
              : level === 5
                ? ['extra-attack']
                : [],
        classSpecific: {
          action_surges: level >= 17 ? 2 : level >= 2 ? 1 : 0,
          indomitable_uses: level >= 17 ? 3 : level >= 13 ? 2 : level >= 9 ? 1 : 0,
          extra_attacks: level >= 20 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0,
        },
      })),
    });

    expect(fighter.levels).toHaveLength(20);
    expect(fighter.levels[0]?.proficiencyBonus).toBe(2);
    expect(fighter.levels[19]?.proficiencyBonus).toBe(6);

    const champion = SubclassSchema.parse({
      id: 'champion',
      classId: 'fighter',
      name: 'Champion',
      subclassFlavor: 'Martial Archetype',
      description: 'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
      levels: [
        { level: 3, featureIds: ['improved-critical'] },
        { level: 7, featureIds: ['remarkable-athlete'] },
        { level: 10, featureIds: ['additional-fighting-style'] },
        { level: 15, featureIds: ['superior-critical'] },
        { level: 18, featureIds: ['survivor'] },
      ],
    });

    expect(champion.levels).toHaveLength(5);

    const improvedCritical = FeatureSchema.parse({
      id: 'improved-critical',
      name: 'Improved Critical',
      classId: 'fighter',
      subclassId: 'champion',
      level: 3,
      description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
      modifiers: [
        {
          type: 'die_manipulation',
          rule: 'expanded_crit_range',
          params: { minCritRoll: 19 },
        },
      ],
    });

    expect(improvedCritical.subclassId).toBe('champion');
  });

  it('validates a full 20-level spellcasting Class (Cleric) and Subclass spell grants (Life Domain)', () => {
    const cleric = ClassSchema.parse({
      id: 'cleric',
      name: 'Cleric',
      hitDie: 8,
      primaryAbilities: ['wis'],
      savingThrowProficiencies: ['wis', 'cha'],
      armorProficiencies: ['light-armor', 'medium-armor', 'shields'],
      weaponProficiencies: ['simple-weapons'],
      toolProficiencies: [],
      skillChoices: {
        id: 'cleric-skills',
        label: 'Choose two skills from History, Insight, Medicine, Persuasion, and Religion',
        count: 2,
        type: 'skill',
        from: {
          mode: 'explicit',
          options: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
        },
      },
      startingEquipmentChoices: [],
      startingGoldFormula: '5d4 * 10',
      subclassLevel: 1,
      subclassTitle: 'Divine Domain',
      subclassIds: ['life'],
      spellcasting: {
        ability: 'wis',
        progression: 'full',
        preparationMode: 'prepared_full_list',
        cantripsKnownByLevel: [
          3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        ],
        ritualCasting: true,
        spellcastingFocusType: 'holy-symbol',
      },
      levels: buildLevels1To20((level) => ({
        featureIds: level === 1 ? ['spellcasting-cleric', 'divine-domain'] : [],
        classSpecific: {
          channel_divinity_charges: level >= 18 ? 3 : level >= 6 ? 2 : level >= 2 ? 1 : 0,
        },
        spellSlots: {
          level1: level >= 2 ? 3 : 2,
          level2: level >= 3 ? 2 : 0,
          level3: level >= 5 ? 2 : 0,
          level4: level >= 7 ? 1 : 0,
          level5: level >= 9 ? 1 : 0,
          level6: level >= 11 ? 1 : 0,
          level7: level >= 13 ? 1 : 0,
          level8: level >= 15 ? 1 : 0,
          level9: level >= 17 ? 1 : 0,
        },
      })),
    });

    expect(cleric.spellcasting?.progression).toBe('full');
    expect(cleric.levels[0]?.spellSlots?.level1).toBe(2);

    const lifeDomain = SubclassSchema.parse({
      id: 'life',
      classId: 'cleric',
      name: 'Life Domain',
      subclassFlavor: 'Divine Domain',
      description: 'The Life domain focuses on the vibrant positive energy that sustains all life.',
      levels: [
        { level: 1, featureIds: ['bonus-proficiency-life', 'disciple-of-life'] },
        { level: 2, featureIds: ['channel-divinity-preserve-life'] },
        { level: 6, featureIds: ['blessed-healer'] },
        { level: 8, featureIds: ['divine-strike-life'] },
        { level: 17, featureIds: ['supreme-healing'] },
      ],
      spells: [
        { classLevel: 1, spellIds: ['bless', 'cure-wounds'], mode: 'always_prepared' },
        { classLevel: 3, spellIds: ['lesser-restoration', 'spiritual-weapon'], mode: 'always_prepared' },
        { classLevel: 5, spellIds: ['beacon-of-hope', 'revivify'], mode: 'always_prepared' },
        { classLevel: 7, spellIds: ['death-ward', 'guardian-of-faith'], mode: 'always_prepared' },
        { classLevel: 9, spellIds: ['mass-cure-wounds', 'raise-dead'], mode: 'always_prepared' },
      ],
    });

    expect(lifeDomain.spells).toHaveLength(5);
  });

  it('rejects a Class with non-sequential or incomplete level progression', () => {
    const badLevels = buildLevels1To20();
    badLevels[5] = { ...badLevels[5]!, level: 7 };

    expect(
      ClassSchema.safeParse({
        id: 'bad-class',
        name: 'Bad Class',
        hitDie: 8,
        primaryAbilities: ['str'],
        savingThrowProficiencies: ['str', 'con'],
        armorProficiencies: [],
        weaponProficiencies: [],
        toolProficiencies: [],
        skillChoices: {
          id: 'skills',
          label: 'Skills',
          count: 2,
          type: 'skill',
          from: { mode: 'explicit', options: ['athletics', 'perception'] },
        },
        startingEquipmentChoices: [],
        startingGoldFormula: '4d4 * 10',
        subclassLevel: 3,
        subclassTitle: 'Archetype',
        levels: badLevels,
      }).success,
    ).toBe(false);
  });
});

describe('@srd5/data SRD-103 Background and Feat schemas', () => {
  it('validates the SRD 5.1 Acolyte Background', () => {
    const acolyte = BackgroundSchema.parse({
      id: 'acolyte',
      name: 'Acolyte',
      skillProficiencies: ['insight', 'religion'],
      toolProficiencies: [],
      languages: [],
      choices: [
        {
          id: 'acolyte-languages',
          label: 'Choose two languages of your choice',
          count: 2,
          type: 'language',
          from: { mode: 'category', category: 'all_languages' },
        },
      ],
      startingEquipment: [
        { itemId: 'amulet', quantity: 1 },
        { itemId: 'common-clothes', quantity: 1 },
        { itemId: 'pouch', quantity: 1 },
      ],
      startingCurrency: { gp: 15 },
      feature: {
        id: 'shelter-of-the-faithful',
        name: 'Shelter of the Faithful',
        description:
          'As an acolyte, you command the respect of those who share your faith, and you can perform the religious ceremonies of your deity.',
      },
      suggestedCharacteristics: {
        personalityTraits: ['I idolize a particular hero of my faith, and constantly refer to that person’s deeds and example.'],
        ideals: ['Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld. (Lawful)'],
        bonds: ['I would die to recover an ancient relic of my faith that was lost long ago.'],
        flaws: ['I judge others harshly, and myself even more severely.'],
      },
      description: 'You have spent your life in the service of a temple to a specific god or pantheon of gods.',
    });

    expect(acolyte.id).toBe('acolyte');
    expect(acolyte.skillProficiencies).toEqual(['insight', 'religion']);
    expect(acolyte.startingCurrency?.gp).toBe(15);
  });

  it('validates the SRD 5.1 Grappler Feat with prerequisites, modifiers, and activated abilities', () => {
    const grappler = FeatSchema.parse({
      id: 'grappler',
      name: 'Grappler',
      description:
        'You’ve developed the skills necessary to hold your own in close-quarters grappling.',
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
    });

    expect(grappler.id).toBe('grappler');
    expect(grappler.prerequisites[0]?.type).toBe('ability_minimum');
    expect(grappler.activatedAbilities).toHaveLength(1);
  });
});
