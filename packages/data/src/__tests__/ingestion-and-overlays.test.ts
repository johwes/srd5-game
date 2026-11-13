import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestSrdDirectory } from '../../scripts/ingest-srd.js';
import {
  ABILITY_IDS,
  applyEquipmentOverlays,
  applyFeatOverlays,
  applyFeatureOverlays,
  applyMagicItemOverlays,
  applyMonsterOverlays,
  applyRaceOverlays,
  applySpellOverlays,
  applySubraceOverlays,
  canonicalizeSpellIdentity,
  type ClassLevelProgression,
  DEFAULT_SRD_OVERLAY_BUNDLE,
  getXpForChallengeRating,
  inferMonsterAiArchetype,
  isProhibitedMonsterId,
  normalizeAlignment,
  normalizeChallengeRating,
  normalizeCostToCopper,
  normalizeDiceFormula,
  normalizeSpellCastingTime,
  normalizeSpellComponents,
  normalizeSpellDuration,
  normalizeSpellTargeting,
  parseMonsterActionFromDescription,
  runSrdIngestionPipeline,
  serializeSrdDatasetFiles,
  SKILL_DEFAULT_ABILITY,
  SKILL_IDS,
  SRD_BUNDLE_FILENAMES,
  type SrdIngestionInput,
  toCanonicalAbilityId,
  toCanonicalId,
  toCanonicalSkillId,
  toCanonicalSubclassId,
} from '../index.js';

function buildLevels1To20(): ClassLevelProgression[] {
  return Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
    featureIds: [],
    classSpecific: {},
  }));
}

describe('@srd5/data SRD-105 ID Canonicalization & Normalization Utilities', () => {
  it('canonicalizes display names, punctuation, and symbols into lowercase kebab-case IDs', () => {
    expect(toCanonicalId('Sleight of Hand')).toBe('sleight-of-hand');
    expect(toCanonicalId("Thieves' Tools")).toBe('thieves-tools');
    expect(toCanonicalId('Half-Orc')).toBe('half-orc');
    expect(toCanonicalId('Weapon, +1')).toBe('weapon-plus-1');
    expect(toCanonicalId('Rod & Staff')).toBe('rod-and-staff');
  });

  it('normalizes Ability, Skill, and Subclass identifiers', () => {
    expect(toCanonicalAbilityId('Strength')).toBe('str');
    expect(toCanonicalAbilityId('Saving Throw: DEX')).toBe('dex');
    expect(() => toCanonicalAbilityId('Luck')).toThrow();

    expect(toCanonicalSkillId('Skill: Animal Handling')).toBe('animal-handling');
    expect(toCanonicalSkillId("Sleight of Hand")).toBe('sleight-of-hand');
    expect(() => toCanonicalSkillId('Streetwise')).toThrow();

    expect(toCanonicalSubclassId('Path of the Berserker')).toBe('berserker');
    expect(toCanonicalSubclassId('Way of the Open Hand')).toBe('open-hand');
    expect(toCanonicalSubclassId('The Fiend')).toBe('fiend');
    expect(() => toCanonicalSubclassId('Hexblade')).toThrow();
  });

  it('canonicalizes PHB-named spells into SRD 5.1 open-content spell names and blocks Product Identity spells', () => {
    expect(canonicalizeSpellIdentity("Melf's Acid Arrow")).toEqual({
      id: 'acid-arrow',
      name: 'Acid Arrow',
    });
    expect(canonicalizeSpellIdentity('bigbys-hand', "Bigby's Hand")).toEqual({
      id: 'arcane-hand',
      name: 'Arcane Hand',
    });
    expect(canonicalizeSpellIdentity("Tasha's Hideous Laughter")).toEqual({
      id: 'hideous-laughter',
      name: 'Hideous Laughter',
    });
    expect(canonicalizeSpellIdentity("Mordenkainen's Magnificent Mansion")).toEqual({
      id: 'magnificent-mansion',
      name: 'Magnificent Mansion',
    });

    expect(() => canonicalizeSpellIdentity('Arms of Hadar')).toThrow(/Product Identity/);
    expect(() => canonicalizeSpellIdentity('Armor of Agathys')).toThrow(/Product Identity/);
  });

  it('detects prohibited Product Identity monsters while allowing SRD 5.1 monsters', () => {
    expect(isProhibitedMonsterId('beholder')).toBe(true);
    expect(isProhibitedMonsterId('Mind Flayer')).toBe(true);
    expect(isProhibitedMonsterId('Displacer Beast')).toBe(true);
    expect(isProhibitedMonsterId('Carrion Crawler')).toBe(true);
    expect(isProhibitedMonsterId('Umber Hulk')).toBe(true);
    expect(isProhibitedMonsterId('Yuan-ti Malison')).toBe(true);
    expect(isProhibitedMonsterId('Githyanki Warrior')).toBe(true);

    expect(isProhibitedMonsterId('goblin')).toBe(false);
    expect(isProhibitedMonsterId('Adult Black Dragon')).toBe(false);
    expect(isProhibitedMonsterId('Owlbear')).toBe(false);
    expect(isProhibitedMonsterId('Gelatinous Cube')).toBe(false);
  });

  it('normalizes currency, Challenge Ratings, XP, alignments, and dice formulas', () => {
    expect(normalizeCostToCopper({ quantity: 15, unit: 'gp' })).toBe(1500);
    expect(normalizeCostToCopper('5 sp')).toBe(50);
    expect(normalizeCostToCopper('2 pp')).toBe(2000);
    expect(normalizeCostToCopper('1 ep')).toBe(50);
    expect(normalizeCostToCopper('25 cp')).toBe(25);
    expect(normalizeCostToCopper(100)).toBe(100);

    expect(normalizeChallengeRating('1/8')).toBe(0.125);
    expect(normalizeChallengeRating('1/4')).toBe(0.25);
    expect(normalizeChallengeRating('1/2')).toBe(0.5);
    expect(normalizeChallengeRating(14)).toBe(14);
    expect(getXpForChallengeRating(0.25)).toBe(50);
    expect(getXpForChallengeRating(14)).toBe(11500);

    expect(normalizeAlignment('Lawful Good')).toBe('lawful_good');
    expect(normalizeAlignment('neutral')).toBe('true_neutral');
    expect(normalizeAlignment('Unaligned')).toBe('unaligned');

    expect(normalizeDiceFormula('2d6+3')).toBe('2d6 + 3');
    expect(normalizeDiceFormula('1d8+@strMod')).toBe('1d8 + @strMod');
  });

  it('normalizes spell casting time, duration, components, and targeting', () => {
    expect(normalizeSpellCastingTime('1 action')).toBe('action');
    expect(normalizeSpellCastingTime('1 bonus action')).toBe('bonus_action');
    expect(normalizeSpellCastingTime('1 reaction, which you take when hit')).toBe('reaction');
    expect(normalizeSpellCastingTime('10 minutes')).toBe('10_minutes');

    expect(normalizeSpellDuration('Instantaneous')).toEqual({ type: 'instantaneous' });
    expect(normalizeSpellDuration('1 round')).toEqual({ type: 'rounds', rounds: 1 });
    expect(normalizeSpellDuration('Concentration, up to 1 minute')).toEqual({
      type: 'rounds',
      rounds: 10,
    });
    expect(normalizeSpellDuration('8 hours')).toEqual({ type: 'hours', amount: 8 });
    expect(normalizeSpellDuration('Until dispelled')).toEqual({ type: 'until_dispelled' });

    const revivifyComp = normalizeSpellComponents(
      ['V', 'S', 'M'],
      'diamonds worth 300 gp, which the spell consumes',
    );
    expect(revivifyComp).toEqual({
      verbal: true,
      somatic: true,
      material: true,
      materialDescription: 'diamonds worth 300 gp, which the spell consumes',
      materialCostGold: 300,
      materialConsumed: true,
    });

    expect(normalizeSpellTargeting('Self (15-foot cone)')).toEqual({
      type: 'self_aoe',
      rangeFeet: 0,
      aoe: { shape: 'cone', sizeFeet: 15 },
    });
    expect(normalizeSpellTargeting('Touch')).toEqual({
      type: 'touch',
      rangeFeet: 5,
    });
    expect(
      normalizeSpellTargeting('150 feet', { shape: 'sphere', sizeFeet: 20 }),
    ).toEqual({
      type: 'point_aoe',
      rangeFeet: 150,
      aoe: { shape: 'sphere', sizeFeet: 20 },
    });
  });

  it('infers monster AI archetypes and parses monster actions from SRD text', () => {
    expect(
      inferMonsterAiArchetype({
        abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        traits: [{ id: 'nimble-escape', name: 'Nimble Escape' }],
      }),
    ).toBe('skirmisher');

    expect(
      inferMonsterAiArchetype({
        abilities: { str: 10, dex: 10, con: 12, int: 13, wis: 16, cha: 13 },
        spellIds: ['cure-wounds', 'bless', 'spiritual-weapon'],
      }),
    ).toBe('support');

    expect(
      inferMonsterAiArchetype({
        abilities: { str: 9, dex: 14, con: 11, int: 17, wis: 12, cha: 11 },
        spellIds: ['fireball', 'magic-missile', 'cone-of-cold'],
      }),
    ).toBe('artillery');

    const scimitarAction = parseMonsterActionFromDescription({
      name: 'Scimitar',
      description:
        'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.',
    });
    expect(scimitarAction.id).toBe('scimitar');
    expect(scimitarAction.targeting?.rangeFeet).toBe(5);
    expect(scimitarAction.effects[0]).toEqual({
      step: 'attack_roll',
      attackType: 'melee_weapon',
      attackBonusOverride: 4,
      onHit: [
        {
          step: 'deal_damage',
          diceFormula: '1d6 + 2',
          damageType: 'slashing',
        },
      ],
    });

    const fireBreathAction = parseMonsterActionFromDescription({
      name: 'Fire Breath (Recharge 5–6)',
      description:
        'The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one.',
    });
    expect(fireBreathAction.id).toBe('fire-breath');
    expect(fireBreathAction.recharge).toEqual({ minRoll: 5, die: 6 });
    expect(fireBreathAction.targeting?.aoe).toEqual({ shape: 'cone', sizeFeet: 15 });
    expect(fireBreathAction.effects[0]).toEqual({
      step: 'saving_throw',
      ability: 'dex',
      dcFormula: '13',
      onFail: [
        {
          step: 'deal_damage',
          diceFormula: '7d6',
          damageType: 'fire',
          halfOnSaveSuccess: true,
        },
      ],
    });
  });
});

describe('@srd5/data SRD-105 Effect DSL Overlays & Ingestion Pipeline', () => {
  it('merges Effect DSL overlays onto Races, Subraces, Features, Feats, Equipment, Magic Items, Spells, and Monsters', () => {
    const overlaidRaces = applyRaceOverlays(
      [
        {
          id: 'dwarf',
          name: 'Dwarf',
          size: 'medium',
          speedFeet: 25,
          abilityBonuses: { con: 2 },
          choices: [],
          senses: { darkvisionFeet: 60 },
          proficiencies: ['battleaxe', 'handaxe', 'light-hammer', 'warhammer'],
          languages: ['common', 'dwarvish'],
          traits: [
            {
              id: 'dwarven-resilience',
              name: 'Dwarven Resilience',
              description: 'Advantage vs poison and poison resistance.',
              modifiers: [],
            },
          ],
          subraceIds: ['hill-dwarf'],
          description: 'Bold and hardy dwarves.',
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.races ?? {},
    );
    expect(overlaidRaces[0]?.choices).toHaveLength(1);
    expect(overlaidRaces[0]?.traits[0]?.modifiers).toHaveLength(2);

    const overlaidSubraces = applySubraceOverlays(
      [
        {
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
              description: '+1 HP per level.',
              modifiers: [],
            },
          ],
          description: 'Keen senses and resilience.',
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.subraces ?? {},
    );
    expect(overlaidSubraces[0]?.traits[0]?.modifiers[0]).toEqual({
      type: 'flat_bonus',
      target: 'hp_per_level',
      value: 1,
    });

    const overlaidFeatures = applyFeatureOverlays(
      [
        {
          id: 'second-wind',
          name: 'Second Wind',
          classId: 'fighter',
          level: 1,
          description: 'Regain 1d10 + fighter level HP.',
          modifiers: [],
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.features ?? {},
    );
    expect(overlaidFeatures[0]?.modifiers).toHaveLength(1);
    expect(overlaidFeatures[0]?.activatedAbilities).toHaveLength(1);

    const overlaidFeats = applyFeatOverlays(
      [
        {
          id: 'grappler',
          name: 'Grappler',
          description: 'Close-quarters grappling specialist.',
          prerequisites: [],
          modifiers: [],
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.feats ?? {},
    );
    expect(overlaidFeats[0]?.prerequisites).toHaveLength(1);
    expect(overlaidFeats[0]?.activatedAbilities).toHaveLength(1);

    const overlaidEquipment = applyEquipmentOverlays(
      [
        {
          id: 'potion-of-healing',
          kind: 'gear',
          name: 'Potion of Healing',
          category: 'consumable',
          costCopper: 5000,
          weightLb: 0.5,
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.gear ?? {},
    );
    expect(
      overlaidEquipment[0]?.kind === 'gear' && overlaidEquipment[0].activatedAbilities,
    ).toHaveLength(1);

    const overlaidMagicItems = applyMagicItemOverlays(
      [
        {
          id: 'cloak-of-protection',
          name: 'Cloak of Protection',
          category: 'wondrous',
          rarity: 'uncommon',
          requiresAttunement: false,
          modifiers: [],
          description: '+1 to AC and saving throws.',
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.magicItems ?? {},
    );
    expect(overlaidMagicItems[0]?.requiresAttunement).toBe(true);
    expect(overlaidMagicItems[0]?.modifiers).toHaveLength(2);

    const overlaidSpells = applySpellOverlays(
      [
        {
          id: 'fireball',
          name: 'Fireball',
          level: 3,
          school: 'evocation',
          castingTime: 'action',
          ritual: false,
          concentration: false,
          duration: { type: 'instantaneous' },
          components: { verbal: true, somatic: true, material: true },
          classes: ['sorcerer', 'wizard'],
          targeting: { type: 'single', rangeFeet: 150 },
          effects: [],
          description: 'Explosion of flame.',
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.spells ?? {},
    );
    expect(overlaidSpells[0]?.targeting.type).toBe('point_aoe');
    expect(overlaidSpells[0]?.effects).toHaveLength(1);

    const overlaidMonsters = applyMonsterOverlays(
      [
        {
          id: 'ghoul',
          name: 'Ghoul',
          size: 'medium',
          type: 'undead',
          alignment: 'chaotic_evil',
          armorClass: { value: 12, type: 'natural' },
          hitPoints: { average: 22, rollFormula: '5d8' },
          speed: { walk: 30 },
          abilities: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
          savingThrows: {},
          skills: {},
          damageVulnerabilities: [],
          damageResistances: [],
          damageImmunities: ['poison'],
          conditionImmunities: ['charmed', 'exhaustion', 'poisoned'],
          senses: { darkvisionFeet: 60, passivePerception: 10 },
          languages: ['common'],
          challengeRating: 1,
          xp: 200,
          aiArchetype: 'brute',
          traits: [],
          actions: [
            {
              id: 'claws',
              name: 'Claws',
              description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target.',
              actionCost: 'action',
              effects: [],
            },
          ],
        },
      ],
      DEFAULT_SRD_OVERLAY_BUNDLE.monsters ?? {},
    );
    expect(overlaidMonsters[0]?.aiArchetype).toBe('controller');
    expect(overlaidMonsters[0]?.actions[0]?.effects).toHaveLength(1);
  });

  it('executes full ingestion pipeline, serializes all 15 dataset files, and round-trips via ingestSrdDirectory', async () => {
    const sampleInput: SrdIngestionInput = {
      abilitiesAndSkills: {
        abilities: ABILITY_IDS.map((id) => ({
          id,
          name: id.toUpperCase(),
          abbreviation: id.toUpperCase(),
          description: `${id.toUpperCase()} ability score.`,
          skills: SKILL_IDS.filter((sk) => SKILL_DEFAULT_ABILITY[sk] === id),
        })),
        skills: SKILL_IDS.map((id) => ({
          id,
          name: id,
          ability: SKILL_DEFAULT_ABILITY[id],
          description: `${id} skill check.`,
        })),
      },
      conditions: [
        {
          id: 'blinded',
          name: 'Blinded',
          description: 'A blinded creature cannot see.',
          bullets: [
            'A blinded creature cannot see and automatically fails any ability check that requires sight.',
            "Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
          ],
        },
      ],
      damageTypes: [
        {
          id: 'fire',
          name: 'Fire',
          description: 'Red dragons breathe fire, and many spells conjure flames to deal fire damage.',
        },
      ],
      proficienciesAndLanguages: {
        proficiencies: [
          {
            id: 'simple-weapons',
            name: 'Simple Weapons',
            category: 'weapon',
          },
        ],
        languages: [
          {
            id: 'common',
            name: 'Common',
            category: 'standard',
            typicalSpeakers: ['Humans'],
            script: 'Common',
          },
        ],
      },
      races: [
        {
          id: 'dwarf',
          name: 'Dwarf',
          size: 'medium',
          speedFeet: 25,
          abilityBonuses: { con: 2 },
          choices: [],
          senses: { darkvisionFeet: 60 },
          proficiencies: [],
          languages: ['common', 'dwarvish'],
          traits: [
            {
              id: 'dwarven-resilience',
              name: 'Dwarven Resilience',
              description: 'Poison resilience.',
              modifiers: [],
            },
          ],
          subraceIds: ['hill-dwarf'],
          description: 'Dwarf race.',
        },
      ],
      subraces: [
        {
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
              description: '+1 HP per level.',
              modifiers: [],
            },
          ],
          description: 'Hill dwarf subrace.',
        },
      ],
      classes: [
        {
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
            label: 'Choose two skills',
            count: 2,
            type: 'skill',
            from: { mode: 'explicit', options: ['athletics', 'perception'] },
          },
          startingEquipmentChoices: [],
          startingGoldFormula: '5d4 * 10',
          subclassLevel: 3,
          subclassTitle: 'Martial Archetype',
          subclassIds: ['champion'],
          levels: buildLevels1To20(),
        },
      ],
      subclasses: [
        {
          id: 'champion',
          classId: 'fighter',
          name: 'Champion',
          subclassFlavor: 'Martial Archetype',
          description: 'Champion archetype.',
          levels: [{ level: 3, featureIds: ['improved-critical'] }],
        },
      ],
      features: [
        {
          id: 'improved-critical',
          name: 'Improved Critical',
          classId: 'fighter',
          subclassId: 'champion',
          level: 3,
          description: 'Weapon attacks score a critical hit on a roll of 19 or 20.',
          modifiers: [],
        },
      ],
      backgrounds: [
        {
          id: 'acolyte',
          name: 'Acolyte',
          skillProficiencies: ['insight', 'religion'],
          toolProficiencies: [],
          languages: [],
          choices: [],
          startingEquipment: [],
          feature: {
            id: 'shelter-of-the-faithful',
            name: 'Shelter of the Faithful',
            description: 'Temple shelter.',
          },
          description: 'Temple acolyte.',
        },
      ],
      feats: [
        {
          id: 'grappler',
          name: 'Grappler',
          description: 'Grappling expert.',
          prerequisites: [],
          modifiers: [],
        },
      ],
      equipment: [
        {
          id: 'potion-of-healing',
          kind: 'gear',
          name: 'Potion of Healing',
          category: 'consumable',
          costCopper: 5000,
          weightLb: 0.5,
        },
      ],
      magicItems: [
        {
          id: 'cloak-of-protection',
          name: 'Cloak of Protection',
          category: 'wondrous',
          rarity: 'uncommon',
          requiresAttunement: false,
          modifiers: [],
          description: '+1 to AC and saves.',
        },
      ],
      spells: [
        {
          id: 'melfs-acid-arrow',
          name: "Melf's Acid Arrow",
          level: 2,
          school: 'evocation',
          castingTime: 'action',
          ritual: false,
          concentration: false,
          duration: { type: 'instantaneous' },
          components: { verbal: true, somatic: true, material: true },
          classes: ['wizard'],
          targeting: { type: 'single', rangeFeet: 90 },
          effects: [],
          description: 'Shimmering green arrow.',
        },
      ],
      monsters: [
        {
          id: 'goblin',
          name: 'Goblin',
          size: 'small',
          type: 'humanoid',
          subtype: 'goblinoid',
          alignment: 'neutral_evil',
          armorClass: { value: 15, type: 'armor' },
          hitPoints: { average: 7, rollFormula: '2d6' },
          speed: { walk: 30 },
          abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
          savingThrows: {},
          skills: { stealth: 6 },
          damageVulnerabilities: [],
          damageResistances: [],
          damageImmunities: [],
          conditionImmunities: [],
          senses: { darkvisionFeet: 60, passivePerception: 9 },
          languages: ['common', 'goblin'],
          challengeRating: 0.25,
          xp: 50,
          aiArchetype: 'brute',
          traits: [],
          actions: [],
        },
      ],
    };

    const dataset = runSrdIngestionPipeline(sampleInput);
    expect(dataset.spells[0]?.id).toBe('acid-arrow');
    expect(dataset.spells[0]?.name).toBe('Acid Arrow');
    expect(dataset.spells[0]?.effects).toHaveLength(1);
    expect(dataset.monsters[0]?.aiArchetype).toBe('skirmisher');

    const serialized = serializeSrdDatasetFiles(dataset);
    expect(Object.keys(serialized)).toEqual([...SRD_BUNDLE_FILENAMES]);

    // Test round-trip file ingestion using a temporary directory
    const tempDir = await mkdtemp(join(tmpdir(), 'srd5-ingest-test-'));
    try {
      const { writeFile } = await import('node:fs/promises');
      for (const filename of SRD_BUNDLE_FILENAMES) {
        await writeFile(join(tempDir, filename), serialized[filename], 'utf8');
      }

      const roundTripped = await ingestSrdDirectory({
        inDir: tempDir,
        outDir: tempDir,
      });
      expect(roundTripped.races).toHaveLength(1);
      expect(roundTripped.spells[0]?.id).toBe('acid-arrow');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
