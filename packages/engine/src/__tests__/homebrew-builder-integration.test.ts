import { describe, expect, it } from 'vitest';
import {
  type CharacterBuildState,
  type FeatData,
  createCompendium,
} from '@srd5/data';
import {
  computeDerivedCharacter,
  createDefaultCharacterRuntimeState,
  createDefaultCurrency,
  createDefaultSpellcastingSelection,
  evaluateFeatEligibility,
  validateCharacterChoices,
} from '../character/index.js';

describe('SRD-1006: Engine Integration for Custom Feats and Backgrounds', () => {
  const compendium = createCompendium();

  function createBaseFighter(): CharacterBuildState {
    return {
      id: 'test-hero-1',
      version: 1,
      name: 'Korath',
      portraitId: 'fighter_portrait',
      tokenSpriteId: 'fighter_token',
      alignment: 'neutral_good',
      raceId: 'human',
      racialChoices: {},
      backgroundId: 'custom',
      backgroundChoices: {},
      customBackground: {
        name: 'Crypt Delver',
        description: 'Seasoned explorer of sunken tombs and ancient crypts.',
        skillProficiencies: ['athletics', 'perception'],
        toolProficiencies: ['thieves-tools'],
        languages: ['draconic'],
        feature: {
          name: 'Tomb Sense',
          description: 'You recognize ancient subterranean stonecraft and architectural passages.',
        },
        source: 'homebrew',
        humanReviewed: true,
      },
      abilityMethod: 'standard_array',
      baseAbilities: {
        str: 15,
        dex: 14,
        con: 13,
        int: 12,
        wis: 10,
        cha: 8,
      },
      classes: [
        {
          classId: 'fighter',
          level: 4,
          hpRollsByLevel: [10, 6, 6, 6],
          choiceSelectionsByLevel: {
            1: {
              'fighter-fighting-style': ['defense'],
            },
            3: {
              'martial-archetype': ['champion'],
            },
          },
          asiOrFeatByLevel: {
            4: {
              type: 'feat',
              featId: 'ironclad-sentinel',
            },
          },
        },
      ],
      customFeats: [
        {
          id: 'ironclad-sentinel',
          name: 'Ironclad Sentinel',
          description: 'Original tactical feat granting defensive shield mastery.',
          source: 'homebrew',
          humanReviewed: true,
          prerequisites: [
            { type: 'ability_minimum', ability: 'str', minimum: 13 },
          ],
          modifiers: [
            { type: 'flat_bonus', target: 'ac', value: 1 },
          ],
        },
      ],
      currency: createDefaultCurrency({ gp: 50 }),
      inventory: [
        {
          instanceId: 'chain-mail-inst',
          itemId: 'chain-mail',
          quantity: 1,
        },
        {
          instanceId: 'shield-inst',
          itemId: 'shield',
          quantity: 1,
        },
      ],
      equippedSlots: {
        armorInstanceId: 'chain-mail-inst',
        shieldInstanceId: 'shield-inst',
      },
      attunedItemInstanceIds: [],
      spellcasting: createDefaultSpellcastingSelection(),
      runtime: createDefaultCharacterRuntimeState({
        currentHp: 38,
        tempHp: 0,
      }),
    };
  }

  it('computes derived stats for custom background (name, skills, feature IDs)', () => {
    const hero = createBaseFighter();
    const sheet = computeDerivedCharacter(hero, compendium);

    expect(sheet.backgroundName).toBe('Crypt Delver');
    expect(sheet.backgroundId).toBe('custom');
    expect(sheet.proficiencies.skills).toContain('athletics');
    expect(sheet.proficiencies.skills).toContain('perception');
    expect(sheet.proficiencies.tools).toContain('thieves-tools');
    expect(sheet.proficiencies.languages).toContain('draconic');
    expect(sheet.featureIds).toContain('tomb-sense');
  });

  it('applies custom homebrew feat AC modifier and displays formula tooltip breakdown', () => {
    const hero = createBaseFighter();
    const sheet = computeDerivedCharacter(hero, compendium);

    // Chain Mail (16) + Shield (+2) + Defense Fighting Style (+1) + Ironclad Sentinel (+1) = 20 AC
    expect(sheet.armorClass.totalAc).toBe(20);
    expect(sheet.featIds).toContain('ironclad-sentinel');

    // Transparent formula breakdown includes the custom feat
    expect(sheet.armorClass.formulaTooltip).toContain('Ironclad Sentinel (+1)');
    expect(sheet.armorClass.additiveBonuses.some((b) => b.sourceName === 'Ironclad Sentinel')).toBe(true);
  });

  it('applies custom homebrew feat ability score bonus with tooltip breakdown', () => {
    const hero = createBaseFighter();
    const customStrFeat: FeatData = {
      id: 'titan-grip',
      name: 'Titan Grip',
      description: 'Original feat granting brute force power.',
      source: 'homebrew',
      humanReviewed: true,
      prerequisites: [],
      modifiers: [],
      abilityBonuses: { str: 1 },
    };

    hero.customFeats = [customStrFeat];
    hero.classes[0]!.asiOrFeatByLevel[4] = {
      type: 'feat',
      featId: 'titan-grip',
    };

    const sheet = computeDerivedCharacter(hero, compendium);
    // Base 15 + Human racial 1 + Titan Grip 1 = 17 STR (+3 mod)
    expect(sheet.abilities.str.score).toBe(17);
    expect(sheet.abilities.str.modifier).toBe(3);
    expect(sheet.abilities.str.featBonus).toBe(1);

    const strBreakdown = sheet.abilities.str.breakdown;
    expect(strBreakdown.some((b) => b.sourceName === 'Titan Grip' && b.value === 1)).toBe(true);
  });

  it('detects Product Identity violations in custom background validation', () => {
    const hero = createBaseFighter();
    hero.customBackground!.name = 'Waterdeep Cutpurse';
    hero.customBackground!.description = 'Hails from Faerun.';

    const validation = validateCharacterChoices(hero, compendium);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some(
        (e) => e.includes('Product Identity'),
      ),
    ).toBe(true);
  });

  it('evaluates feat eligibility including custom homebrew feats in build state', () => {
    const hero = createBaseFighter();
    hero.classes[0]!.asiOrFeatByLevel = {};
    const eligibleList = evaluateFeatEligibility(hero, 4, compendium);

    const sentinelInfo = eligibleList.find((f) => f.feat.id === 'ironclad-sentinel');
    expect(sentinelInfo).toBeDefined();
    // Hero has STR 15 + 1 (human) = 16 >= 13 prerequisite
    expect(sentinelInfo?.eligible).toBe(true);

    // If hero's STR is below prerequisite
    hero.baseAbilities.str = 8;
    const lowStrList = evaluateFeatEligibility(hero, 4, compendium);
    const lowStrSentinel = lowStrList.find((f) => f.feat.id === 'ironclad-sentinel');
    expect(lowStrSentinel?.eligible).toBe(false);
    expect(lowStrSentinel?.unmetPrerequisites[0]).toContain('Requires Strength 13 or higher');
  });
});
