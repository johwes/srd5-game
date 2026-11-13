import { describe, expect, it } from 'vitest';
import {
  compendium,
  createCompendium,
  filterArmors,
  filterBackgrounds,
  filterClasses,
  filterEquipment,
  filterFeats,
  filterFeatures,
  filterMagicItems,
  filterMonsters,
  filterRaces,
  filterSpells,
  filterSubclasses,
  filterSubraces,
  filterWeapons,
  getAbility,
  getArmor,
  getBackground,
  getClass,
  getCondition,
  getDamageType,
  getEquipment,
  getEquipmentPack,
  getFeat,
  getFeature,
  getGear,
  getLanguage,
  getMagicItem,
  getMonster,
  getProficiency,
  getRace,
  getSkill,
  getSpell,
  getSubclass,
  getSubrace,
  getTool,
  getWeapon,
  searchCompendium,
} from '../index.js';

describe('@srd5/data Typed Compendium Lookup & Search API (SRD-107)', () => {
  it('provides O(1) direct ID lookups and strict require* lookups across all collections', () => {
    expect(getAbility('str')?.name).toBe('Strength');
    expect(compendium.requireAbility('dex').abbreviation).toBe('DEX');
    expect(() => compendium.requireAbility('unknown')).toThrow(/Unknown SRD 5\.1 ability ID/);

    expect(getSkill('stealth')?.ability).toBe('dex');
    expect(compendium.requireSkill('perception').name).toBe('Perception');
    expect(() => compendium.requireSkill('unknown')).toThrow(/Unknown SRD 5\.1 skill ID/);

    expect(getCondition('paralyzed')?.name).toBe('Paralyzed');
    expect(compendium.requireCondition('blinded').id).toBe('blinded');
    expect(() => compendium.requireCondition('unknown')).toThrow(/Unknown SRD 5\.1 condition ID/);

    expect(getDamageType('fire')?.name).toBe('Fire');
    expect(compendium.requireDamageType('radiant').id).toBe('radiant');
    expect(() => compendium.requireDamageType('unknown')).toThrow(
      /Unknown SRD 5\.1 damage type ID/,
    );

    expect(getProficiency('martial-weapons')?.category).toBe('weapon');
    expect(compendium.requireProficiency('heavy-armor').name).toBe('Heavy Armor');
    expect(() => compendium.requireProficiency('unknown')).toThrow(
      /Unknown SRD 5\.1 proficiency ID/,
    );

    expect(getLanguage('elvish')?.category).toBe('standard');
    expect(compendium.requireLanguage('draconic').category).toBe('exotic');
    expect(() => compendium.requireLanguage('unknown')).toThrow(/Unknown SRD 5\.1 language ID/);

    expect(getRace('dwarf')?.speedFeet).toBe(25);
    expect(compendium.requireRace('elf').subraceIds).toContain('high-elf');
    expect(() => compendium.requireRace('unknown')).toThrow(/Unknown SRD 5\.1 race ID/);

    expect(getSubrace('hill-dwarf')?.parentRaceId).toBe('dwarf');
    expect(compendium.requireSubrace('high-elf').parentRaceId).toBe('elf');
    expect(() => compendium.requireSubrace('unknown')).toThrow(/Unknown SRD 5\.1 subrace ID/);

    expect(getClass('wizard')?.hitDie).toBe(6);
    expect(compendium.requireClass('fighter').hitDie).toBe(10);
    expect(() => compendium.requireClass('unknown')).toThrow(/Unknown SRD 5\.1 class ID/);

    expect(getSubclass('evocation')?.classId).toBe('wizard');
    expect(compendium.requireSubclass('life').classId).toBe('cleric');
    expect(() => compendium.requireSubclass('unknown')).toThrow(/Unknown SRD 5\.1 subclass ID/);

    expect(getFeature('second-wind')?.classId).toBe('fighter');
    expect(compendium.requireFeature('action-surge').level).toBe(2);
    expect(() => compendium.requireFeature('unknown')).toThrow(/Unknown SRD 5\.1 feature ID/);

    expect(getBackground('acolyte')?.name).toBe('Acolyte');
    expect(compendium.requireBackground('acolyte').skillProficiencies).toEqual([
      'insight',
      'religion',
    ]);
    expect(() => compendium.requireBackground('unknown')).toThrow(
      /Unknown SRD 5\.1 background ID/,
    );

    expect(getFeat('grappler')?.name).toBe('Grappler');
    expect(compendium.requireFeat('grappler').id).toBe('grappler');
    expect(() => compendium.requireFeat('unknown')).toThrow(/Unknown SRD 5\.1 feat ID/);

    expect(getEquipment('longsword')?.kind).toBe('weapon');
    expect(compendium.requireEquipment('plate-armor').kind).toBe('armor');
    expect(() => compendium.requireEquipment('unknown')).toThrow(/Unknown SRD 5\.1 equipment ID/);

    expect(getWeapon('longsword')?.damageDice).toBe('1d8');
    expect(getWeapon('plate-armor')).toBeUndefined();
    expect(compendium.requireWeapon('greatsword').damageDice).toBe('2d6');
    expect(() => compendium.requireWeapon('plate-armor')).toThrow(/Unknown SRD 5\.1 weapon ID/);

    expect(getArmor('chain-mail')?.baseAc).toBe(16);
    expect(compendium.requireArmor('shield').category).toBe('shield');
    expect(() => compendium.requireArmor('longsword')).toThrow(/Unknown SRD 5\.1 armor ID/);

    expect(getGear('alchemists-fire')?.kind).toBe('gear');
    expect(compendium.requireGear('torch').kind).toBe('gear');
    expect(() => compendium.requireGear('longsword')).toThrow(/Unknown SRD 5\.1 gear ID/);

    expect(getTool('thieves-tools')?.category).toBe('thieves_tools');
    expect(compendium.requireTool('smiths-tools').category).toBe('artisans_tools');
    expect(() => compendium.requireTool('longsword')).toThrow(/Unknown SRD 5\.1 tool ID/);

    expect(getEquipmentPack('explorers-pack')?.kind).toBe('pack');
    expect(compendium.requireEquipmentPack('dungeoneers-pack').contents.length).toBeGreaterThan(0);
    expect(() => compendium.requireEquipmentPack('longsword')).toThrow(
      /Unknown SRD 5\.1 equipment pack ID/,
    );

    expect(getMagicItem('cloak-of-protection')?.requiresAttunement).toBe(true);
    expect(compendium.requireMagicItem('bag-of-holding').category).toBe('wondrous');
    expect(() => compendium.requireMagicItem('unknown')).toThrow(
      /Unknown SRD 5\.1 magic item ID/,
    );

    expect(getSpell('fireball')?.level).toBe(3);
    expect(compendium.requireSpell('magic-missile').school).toBe('evocation');
    expect(() => compendium.requireSpell('unknown')).toThrow(/Unknown SRD 5\.1 spell ID/);

    expect(getMonster('goblin')?.challengeRating).toBe(0.25);
    expect(compendium.requireMonster('adult-black-dragon').type).toBe('dragon');
    expect(() => compendium.requireMonster('unknown')).toThrow(/Unknown SRD 5\.1 monster ID/);
  });

  it('indexes relational queries for subraces, subclasses, class features, feature groups, and spell lists', () => {
    const dwarfSubraces = compendium.getSubracesForRace('dwarf');
    expect(dwarfSubraces.map((s) => s.id)).toEqual(['hill-dwarf']);
    expect(compendium.getSubracesForRace('human')).toEqual([]);

    const wizardSubclasses = compendium.getSubclassesForClass('wizard');
    expect(wizardSubclasses.map((s) => s.id)).toEqual(['evocation']);

    const fighterL1Features = compendium.getFeaturesForClass('fighter', 1);
    expect(fighterL1Features.map((f) => f.id)).toContain('second-wind');
    expect(fighterL1Features.map((f) => f.id)).toContain('fighting-style-fighter');
    expect(fighterL1Features.every((f) => f.level <= 1)).toBe(true);

    const fighterAllFeatures = compendium.getFeaturesForClass('fighter');
    expect(fighterAllFeatures.length).toBeGreaterThan(fighterL1Features.length);

    const championL3Features = compendium.getFeaturesForSubclass('champion', 3);
    expect(championL3Features.map((f) => f.id)).toContain('improved-critical');
    expect(championL3Features.every((f) => f.level <= 3)).toBe(true);

    const fightingStyles = compendium.getFeaturesByGroup('fighting-style');
    expect(fightingStyles.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        'fighting-style-archery',
        'fighting-style-defense',
        'fighting-style-dueling',
        'fighting-style-great-weapon-fighting',
        'fighting-style-protection',
        'fighting-style-two-weapon-fighting',
      ]),
    );

    const wizardCantrips = compendium.getSpellsForClass('wizard', { level: 0 });
    expect(wizardCantrips.length).toBeGreaterThan(5);
    expect(
      wizardCantrips.every((s) => s.level === 0 && s.classes.includes('wizard')),
    ).toBe(true);

    const allClericSpells = compendium.getSpellsForClass('cleric');
    expect(allClericSpells.length).toBeGreaterThan(20);

    const lifeDomainL1Spells = compendium.getSpellsForSubclass('life', 1);
    expect(lifeDomainL1Spells.map((s) => s.id)).toEqual(['bless', 'cure-wounds']);

    const lifeDomainAllSpells = compendium.getSpellsForSubclass('life');
    expect(lifeDomainAllSpells.length).toBeGreaterThan(lifeDomainL1Spells.length);

    const standardLangs = compendium.getLanguagesByCategory('standard');
    const exoticLangs = compendium.getLanguagesByCategory('exotic');
    expect(standardLangs.map((l) => l.id)).toContain('common');
    expect(exoticLangs.map((l) => l.id)).toContain('draconic');

    const armorProfs = compendium.getProficienciesByCategory('armor');
    expect(armorProfs.map((p) => p.id)).toEqual(
      expect.arrayContaining(['light-armor', 'medium-armor', 'heavy-armor', 'shields']),
    );
  });

  it('resolves equipment categories, equipment proficiencies, and ChoiceSpec option lists', () => {
    const martialMelee = compendium.resolveEquipmentCategory('martial_melee_weapons');
    expect(martialMelee.length).toBeGreaterThan(10);
    expect(
      martialMelee.every(
        (item) =>
          item.kind === 'weapon' && item.category === 'martial' && item.rangeType === 'melee',
      ),
    ).toBe(true);

    const simpleWeapons = compendium.resolveEquipmentCategory('simple_weapons');
    expect(simpleWeapons.map((w) => w.id)).toContain('dagger');
    expect(simpleWeapons.map((w) => w.id)).toContain('shortbow');

    expect(
      compendium.isProficientWithEquipment(['simple-weapons', 'longsword'], 'dagger'),
    ).toBe(true);
    expect(
      compendium.isProficientWithEquipment(['simple-weapons', 'longsword'], 'longsword'),
    ).toBe(true);
    expect(
      compendium.isProficientWithEquipment(['simple-weapons', 'longsword'], 'greatsword'),
    ).toBe(false);
    expect(
      compendium.isProficientWithEquipment(['martial-weapons'], 'greatsword'),
    ).toBe(true);
    expect(
      compendium.isProficientWithEquipment(['light-armor', 'shields'], 'studded-leather-armor'),
    ).toBe(true);
    expect(
      compendium.isProficientWithEquipment(['light-armor', 'shields'], 'shield'),
    ).toBe(true);
    expect(
      compendium.isProficientWithEquipment(['light-armor', 'shields'], 'plate-armor'),
    ).toBe(false);

    // Verify resolveChoiceOptions on real ChoiceSpec objects from the dataset
    const halfElf = compendium.requireRace('half-elf');
    for (const choice of halfElf.choices) {
      const options = compendium.resolveChoiceOptions(choice);
      expect(options.length).toBeGreaterThan(0);
      if (choice.type === 'ability_score_bonus') {
        expect(options).not.toContain('cha');
        expect(options).toHaveLength(5);
      }
    }

    const highElf = compendium.requireSubrace('high-elf');
    const cantripChoice = highElf.choices.find((c) => c.type === 'spell');
    expect(cantripChoice).toBeDefined();
    if (cantripChoice) {
      const cantripIds = compendium.resolveChoiceOptions(cantripChoice);
      expect(cantripIds).toContain('fire-bolt');
      expect(cantripIds).toContain('mage-hand');
    }

    const fighter = compendium.requireClass('fighter');
    const skillOpts = compendium.resolveChoiceOptions(fighter.skillChoices);
    expect(skillOpts).toContain('athletics');
    for (const eqChoice of fighter.startingEquipmentChoices) {
      const branchIds = compendium.resolveChoiceOptions(eqChoice);
      expect(branchIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('filters races, subraces, classes, subclasses, features, backgrounds, and feats', () => {
    const smallRaces = filterRaces({ size: 'small', hasDarkvision: true });
    expect(smallRaces.map((r) => r.id)).toEqual(['gnome']);

    const strRaces = filterRaces({ abilityBonus: 'str', query: 'breath' });
    expect(strRaces.map((r) => r.id)).toEqual(['dragonborn']);

    const elfSubraces = filterSubraces({ parentRaceId: 'elf', abilityBonus: 'int' });
    expect(elfSubraces.map((s) => s.id)).toEqual(['high-elf']);

    const fullCasters = filterClasses({
      isSpellcaster: true,
      spellcastingProgression: 'full',
      spellcastingAbility: 'wis',
    });
    expect(fullCasters.map((c) => c.id)).toEqual(expect.arrayContaining(['cleric', 'druid']));

    const d12Classes = filterClasses({ hitDie: 12 });
    expect(d12Classes.map((c) => c.id)).toEqual(['barbarian']);

    const clericSubclasses = filterSubclasses({ classId: 'cleric', query: 'healing' });
    expect(clericSubclasses.map((sc) => sc.id)).toEqual(['life']);

    const fightingStyleFeatures = filterFeatures({ featureGroup: 'fighting-style' });
    expect(fightingStyleFeatures.length).toBeGreaterThanOrEqual(6);

    const acolyteBgs = filterBackgrounds({ skillProficiency: 'religion', query: 'temple' });
    expect(acolyteBgs.map((b) => b.id)).toEqual(['acolyte']);

    const prereqFeats = filterFeats({ hasPrerequisites: true, query: 'grapple' });
    expect(prereqFeats.map((f) => f.id)).toEqual(['grappler']);
  });

  it('filters equipment, weapons, armors, magic items, spells, and monsters', () => {
    const finesseWeapons = filterWeapons({
      category: 'martial',
      rangeType: 'melee',
      property: 'finesse',
    });
    expect(finesseWeapons.map((w) => w.id)).toEqual(
      expect.arrayContaining(['rapier', 'scimitar', 'shortsword', 'whip']),
    );

    const stealthMediumArmors = filterArmors({
      category: 'medium',
      stealthDisadvantage: false,
    });
    expect(stealthMediumArmors.map((a) => a.id)).toEqual(
      expect.arrayContaining(['hide-armor', 'chain-shirt', 'breastplate']),
    );
    expect(stealthMediumArmors.map((a) => a.id)).not.toContain('half-plate');

    const cheapTools = filterEquipment({
      kind: 'tool',
      toolCategory: 'musical_instrument',
      maxCostCopper: 500,
    });
    expect(cheapTools.length).toBeGreaterThan(0);

    const rareAttunedItems = filterMagicItems({
      rarity: ['uncommon', 'rare'],
      requiresAttunement: true,
      query: 'protection',
    });
    expect(rareAttunedItems.map((m) => m.id)).toEqual(
      expect.arrayContaining(['cloak-of-protection', 'ring-of-protection']),
    );

    const fireAoESpells = filterSpells({
      level: 3,
      school: 'evocation',
      damageType: 'fire',
      savingThrowAbility: 'dex',
      aoeShape: 'sphere',
    });
    expect(fireAoESpells.map((s) => s.id)).toContain('fireball');

    const reactionSpells = filterSpells({
      castingTime: 'reaction',
      classId: 'wizard',
    });
    expect(reactionSpells.map((s) => s.id)).toEqual(
      expect.arrayContaining(['shield', 'counterspell', 'feather-fall']),
    );

    const lowCrUndead = filterMonsters({
      type: 'undead',
      maxCr: 1,
      conditionImmunity: 'poisoned',
    });
    expect(lowCrUndead.map((m) => m.id)).toEqual(
      expect.arrayContaining(['skeleton', 'zombie']),
    );

    const legendaryDragons = filterMonsters({
      type: 'dragon',
      hasLegendaryActions: true,
      movementMode: 'fly',
      minCr: 10,
    });
    expect(legendaryDragons.map((m) => m.id)).toContain('adult-black-dragon');
  });

  it('performs ranked cross-collection full-text search via searchCompendium()', () => {
    const fireballResults = searchCompendium('fireball');
    expect(fireballResults.length).toBeGreaterThan(0);
    expect(fireballResults[0]?.id).toBe('fireball');
    expect(fireballResults[0]?.kind).toBe('spell');
    expect(fireballResults[0]?.score).toBe(100);

    const spellOnlyResults = searchCompendium('shield', { kinds: 'spell', limit: 5 });
    expect(spellOnlyResults.length).toBeLessThanOrEqual(5);
    expect(spellOnlyResults.every((r) => r.kind === 'spell')).toBe(true);
    expect(spellOnlyResults[0]?.id).toBe('shield');

    const emptyQueryResults = searchCompendium('', { kinds: ['race', 'class'], limit: 10 });
    expect(emptyQueryResults).toHaveLength(10);

    // Custom compendium instance creation works identically
    const customCompendium = createCompendium();
    expect(customCompendium.races).toHaveLength(9);
    expect(customCompendium.classes).toHaveLength(12);
  });
});
