import { describe, expect, it } from 'vitest';
import {
  BUNDLED_SRD_DATASET,
  createCompendium,
  containsProductIdentityMonster,
  containsProductIdentityProperName,
  containsProductIdentitySetting,
  isSrd52OnlyIdentifier,
  screenHomebrewRecord,
  screenProductIdentityText,
  validateSrdDataset,
  type FeatData,
  type BackgroundData,
} from '../index.js';

describe('SRD-1006: Homebrew Provenance and Product Identity Screening Gate', () => {
  describe('Product Identity text and identifier screening', () => {
    it('detects prohibited Product Identity proper names across case and punctuation variations', () => {
      expect(containsProductIdentityProperName("Bigby's Hand")).toBe(true);
      expect(containsProductIdentityProperName('mordenkainen')).toBe(true);
      expect(containsProductIdentityProperName('Curse of Strahd')).toBe(false); // Strahd is a setting/character
      expect(containsProductIdentityProperName('Staff of Vecna')).toBe(true);
      expect(containsProductIdentityProperName('Elminster')).toBe(true);
      expect(containsProductIdentityProperName('Open Game Mechanics')).toBe(false);
    });

    it('detects prohibited Product Identity campaign settings and realms', () => {
      expect(containsProductIdentitySetting('Waterdeep Harbor')).toBe(true);
      expect(containsProductIdentitySetting('Traveler from Faerun')).toBe(true);
      expect(containsProductIdentitySetting('Baldurs Gate')).toBe(true);
      expect(containsProductIdentitySetting('Mists of Barovia')).toBe(true);
      expect(containsProductIdentitySetting('Eberron Artificer')).toBe(true);
      expect(containsProductIdentitySetting('Dark Sun desert')).toBe(true);
      expect(containsProductIdentitySetting('Sunken Tomb of Kaelen')).toBe(false);
    });

    it('detects prohibited Product Identity monster names', () => {
      expect(containsProductIdentityMonster('Eye of the Beholder')).toBe(true);
      expect(containsProductIdentityMonster('Mind Flayer psionics')).toBe(true);
      expect(containsProductIdentityMonster('Displacer Beast cloak')).toBe(true);
      expect(containsProductIdentityMonster('Carrion Crawler tentacles')).toBe(true);
      expect(containsProductIdentityMonster('Fierce Goblin Warrior')).toBe(false);
    });

    it('detects prohibited SRD 5.2-only additions', () => {
      expect(isSrd52OnlyIdentifier('alert')).toBe(true);
      expect(isSrd52OnlyIdentifier('hex')).toBe(true);
      expect(isSrd52OnlyIdentifier('grappler')).toBe(false);
      expect(isSrd52OnlyIdentifier('magic-missile')).toBe(false);
    });

    it('screens freeform text and aggregates all detected PI violations', () => {
      const clean = screenProductIdentityText('Master of tactical positioning in subterranean ruins.');
      expect(clean.valid).toBe(true);
      expect(clean.violations).toEqual([]);

      const dirty = screenProductIdentityText(
        "Learned from Bigby in the taverns of Waterdeep while hunting Beholders.",
      );
      expect(dirty.valid).toBe(false);
      expect(dirty.violations.some((v) => v.toLowerCase().includes('bigby'))).toBe(true);
      expect(dirty.violations.some((v) => v.toLowerCase().includes('waterdeep'))).toBe(true);
      expect(dirty.violations.some((v) => v.toLowerCase().includes('beholder'))).toBe(true);
    });
  });

  describe('Homebrew record screening & human review flag gate', () => {
    it('approves compliant homebrew feat with original mechanics', () => {
      const feat = {
        id: 'ironclad-sentinel',
        name: 'Ironclad Sentinel',
        description: 'Original tactical feat granting defensive fortitude with heavy shields.',
        source: 'homebrew' as const,
        humanReviewed: true,
      };
      const result = screenHomebrewRecord(feat, { requireHumanReview: true });
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.humanReviewConfirmed).toBe(true);
    });

    it('requires human review confirmation when requireHumanReview is enabled', () => {
      const featWithoutReview = {
        id: 'vault-breaker',
        name: 'Vault Breaker',
        description: 'Original dungeoneering feat for picking tricky locks.',
        source: 'homebrew' as const,
      };
      const result = screenHomebrewRecord(featWithoutReview, { requireHumanReview: true });
      expect(result.valid).toBe(false);
      expect(result.humanReviewConfirmed).toBe(false);
      expect(result.violations.some((v) => v.includes('Human review confirmation required'))).toBe(true);

      const approvedResult = screenHomebrewRecord(
        { ...featWithoutReview, humanReviewed: true },
        { requireHumanReview: true },
      );
      expect(approvedResult.valid).toBe(true);
      expect(approvedResult.humanReviewConfirmed).toBe(true);
    });

    it('rejects homebrew records referencing prohibited Product Identity', () => {
      const invalidBg = {
        id: 'waterdeep-criminal',
        name: 'Waterdeep Criminal',
        description: 'A thief from the Sword Coast underworld.',
        source: 'homebrew' as const,
        feature: {
          name: 'Contact in Neverwinter',
          description: 'You know informants in Neverwinter.',
        },
      };
      const result = screenHomebrewRecord(invalidBg);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('waterdeep'))).toBe(true);
      expect(result.violations.some((v) => v.includes('neverwinter'))).toBe(true);
    });

    it('rejects records with invalid source provenance', () => {
      const invalidSource = {
        id: 'custom-trick',
        name: 'Custom Trick',
        source: 'third-party-book',
      };
      const result = screenHomebrewRecord(invalidSource);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('Invalid source provenance'))).toBe(true);
    });
  });

  describe('Compendium source provenance and SRD-only filtering', () => {
    it('correctly filters monsters by source provenance (SRD-only vs Homebrew)', () => {
      const compendium = createCompendium(BUNDLED_SRD_DATASET);

      const allMonsters = compendium.filterMonsters();
      expect(allMonsters.some((m) => m.id === 'goblin-boss')).toBe(true);
      expect(allMonsters.some((m) => m.id === 'goblin')).toBe(true);

      const srdOnlyMonsters = compendium.filterMonsters({ source: 'srd-5.1' });
      expect(srdOnlyMonsters.some((m) => m.id === 'goblin')).toBe(true);
      expect(srdOnlyMonsters.some((m) => m.id === 'goblin-boss')).toBe(false);

      const homebrewMonsters = compendium.filterMonsters({ source: 'homebrew' });
      expect(homebrewMonsters.every((m) => m.source === 'homebrew')).toBe(true);
      expect(homebrewMonsters.some((m) => m.id === 'goblin-boss')).toBe(true);
      expect(homebrewMonsters.some((m) => m.id === 'goblin')).toBe(false);
    });

    it('dynamically registers homebrew feats into compendium and exposes them to filter/search', () => {
      const compendium = createCompendium(BUNDLED_SRD_DATASET);
      const customFeat: FeatData = {
        id: 'shield-warden',
        name: 'Shield Warden',
        description: 'Original reaction-based defensive bulwark feat.',
        source: 'homebrew',
        humanReviewed: true,
        prerequisites: [{ type: 'ability_minimum', ability: 'str', minimum: 13 }],
        modifiers: [{ type: 'flat_bonus', target: 'ac', value: 1 }],
      };

      compendium.registerHomebrewFeat(customFeat);

      expect(compendium.getFeat('shield-warden')).toBeDefined();
      expect(compendium.getFeat('shield-warden')?.name).toBe('Shield Warden');

      const allFeats = compendium.filterFeats();
      expect(allFeats.some((f) => f.id === 'shield-warden')).toBe(true);

      const srdOnlyFeats = compendium.filterFeats({ source: 'srd-5.1' });
      expect(srdOnlyFeats.some((f) => f.id === 'shield-warden')).toBe(false);

      const homebrewFeats = compendium.filterFeats({ source: 'homebrew' });
      expect(homebrewFeats.map((f) => f.id)).toContain('shield-warden');

      const searchResults = compendium.searchCompendium('Warden', { source: 'homebrew' });
      expect(searchResults.some((r) => r.id === 'shield-warden')).toBe(true);

      const srdSearchResults = compendium.searchCompendium('Warden', { source: 'srd-5.1' });
      expect(srdSearchResults.some((r) => r.id === 'shield-warden')).toBe(false);
    });

    it('dynamically registers homebrew backgrounds and prevents PI violations', () => {
      const compendium = createCompendium(BUNDLED_SRD_DATASET);
      const validBg: BackgroundData = {
        id: 'crypt-delver',
        name: 'Crypt Delver',
        description: 'Original explorer of sunken vaults and ancient crypts.',
        source: 'homebrew',
        humanReviewed: true,
        skillProficiencies: ['athletics', 'perception'],
        toolProficiencies: ['thieves-tools'],
        languages: ['draconic'],
        choices: [],
        startingEquipment: [{ itemId: 'torch', quantity: 2 }],
        feature: {
          id: 'tomb-sense',
          name: 'Tomb Sense',
          description: 'You recall ancient stonework and layout patterns.',
        },
      };

      compendium.registerHomebrewBackground(validBg);
      expect(compendium.getBackground('crypt-delver')?.name).toBe('Crypt Delver');

      // Attempting to register PI background throws
      const dirtyBg: BackgroundData = {
        id: 'strahd-vassal',
        name: 'Vassal of Strahd',
        description: 'Servant in Barovia.',
        source: 'homebrew',
        skillProficiencies: ['stealth', 'deception'],
        toolProficiencies: [],
        languages: [],
        choices: [],
        startingEquipment: [],
        feature: {
          id: 'dark-boon',
          name: 'Dark Boon',
          description: 'Castle Ravenloft patron.',
        },
      };

      expect(() => compendium.registerHomebrewBackground(dirtyBg)).toThrow(/Product Identity/);
    });

    it('validates entire dataset with human review gate option', () => {
      const dataset = structuredClone(BUNDLED_SRD_DATASET);
      const normalReport = validateSrdDataset(dataset);
      expect(normalReport.valid).toBe(true);

      // Add unreviewed homebrew record
      dataset.feats.push({
        id: 'unreviewed-feat',
        name: 'Unreviewed Feat',
        description: 'Original feat without human review flag.',
        source: 'homebrew',
        prerequisites: [],
        modifiers: [],
      });

      const strictReport = validateSrdDataset(dataset, { requireHumanReview: true });
      expect(strictReport.valid).toBe(false);
      expect(
        strictReport.errors.some(
          (e) => e.collection === 'feats' && e.message.includes('Human review'),
        ),
      ).toBe(true);
    });
  });
});
