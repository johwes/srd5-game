import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ingestSrdDirectory } from '../../scripts/ingest-srd.js';
import { validateSrdDirectory } from '../../scripts/validate-srd.js';
import {
  ALLOWED_SRD_BACKGROUND_IDS,
  ALLOWED_SRD_CLASS_IDS,
  ALLOWED_SRD_FEAT_IDS,
  ALLOWED_SRD_RACE_IDS,
  ALLOWED_SRD_SUBCLASS_IDS,
  ALLOWED_SRD_SUBRACE_IDS,
  ABILITY_IDS,
  BUNDLED_SRD_DATASET,
  CONDITION_IDS,
  DAMAGE_TYPES,
  SKILL_IDS,
  assertValidSrdDataset,
  validateFormulaSyntax,
  validateSrdDataset,
  type SrdIngestionInput,
} from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRD_DIR = path.resolve(__dirname, '../srd');

function cloneDataset(base: SrdIngestionInput = BUNDLED_SRD_DATASET): SrdIngestionInput {
  return structuredClone(base);
}

describe('SRD-106: Bundled SRD 5.1 JSON Dataset & Referential Integrity Suite', () => {
  describe('Bundled SRD 5.1 Dataset Completeness & Zero-Error Validation', () => {
    it('passes validateSrdDataset with 0 errors across all 15 collections', () => {
      const report = validateSrdDataset(BUNDLED_SRD_DATASET);
      expect(report.errors).toEqual([]);
      expect(report.valid).toBe(true);

      // Verify canonical collection counts
      expect(report.counts.abilities).toBe(6);
      expect(report.counts.skills).toBe(18);
      expect(report.counts.conditions).toBe(15);
      expect(report.counts.damageTypes).toBe(13);
      expect(report.counts.races).toBe(9);
      expect(report.counts.subraces).toBe(4);
      expect(report.counts.classes).toBe(12);
      expect(report.counts.subclasses).toBe(12);
      expect(report.counts.backgrounds).toBe(1);
      expect(report.counts.feats).toBe(1);
      expect(report.counts.features).toBeGreaterThanOrEqual(80);
      expect(report.counts.equipment).toBeGreaterThanOrEqual(100);
      expect(report.counts.magicItems).toBeGreaterThanOrEqual(20);
      expect(report.counts.spells).toBeGreaterThanOrEqual(80);
      expect(report.counts.monsters).toBeGreaterThanOrEqual(20);
    });

    it('contains every canonical SRD 5.1 race, subrace, class (L1-20), subclass, background, and feat', () => {
      const raceIds = new Set(BUNDLED_SRD_DATASET.races.map((r) => r.id));
      for (const id of ALLOWED_SRD_RACE_IDS) {
        expect(raceIds.has(id)).toBe(true);
      }

      const subraceIds = new Set(BUNDLED_SRD_DATASET.subraces.map((s) => s.id));
      for (const id of ALLOWED_SRD_SUBRACE_IDS) {
        expect(subraceIds.has(id)).toBe(true);
      }

      const classIds = new Set(BUNDLED_SRD_DATASET.classes.map((c) => c.id));
      for (const id of ALLOWED_SRD_CLASS_IDS) {
        expect(classIds.has(id)).toBe(true);
      }
      for (const cls of BUNDLED_SRD_DATASET.classes) {
        expect(cls.levels).toHaveLength(20);
        expect(cls.levels.map((l) => l.level)).toEqual(
          Array.from({ length: 20 }, (_, idx) => idx + 1),
        );
      }

      const subclassIds = new Set(BUNDLED_SRD_DATASET.subclasses.map((sc) => sc.id));
      for (const id of ALLOWED_SRD_SUBCLASS_IDS) {
        expect(subclassIds.has(id)).toBe(true);
      }

      const backgroundIds = new Set(BUNDLED_SRD_DATASET.backgrounds.map((b) => b.id));
      for (const id of ALLOWED_SRD_BACKGROUND_IDS) {
        expect(backgroundIds.has(id)).toBe(true);
      }

      const featIds = new Set(BUNDLED_SRD_DATASET.feats.map((f) => f.id));
      for (const id of ALLOWED_SRD_FEAT_IDS) {
        expect(featIds.has(id)).toBe(true);
      }
    });

    it('contains all canonical abilities, skills, conditions, and damage types', () => {
      expect(BUNDLED_SRD_DATASET.abilitiesAndSkills.abilities.map((a) => a.id)).toEqual([
        ...ABILITY_IDS,
      ]);
      expect(BUNDLED_SRD_DATASET.abilitiesAndSkills.skills.map((s) => s.id)).toEqual([
        ...SKILL_IDS,
      ]);
      expect(new Set(BUNDLED_SRD_DATASET.conditions.map((c) => c.id))).toEqual(
        new Set(CONDITION_IDS),
      );
      expect(new Set(BUNDLED_SRD_DATASET.damageTypes.map((d) => d.id))).toEqual(
        new Set(DAMAGE_TYPES),
      );
    });

    it('passes CLI directory validation on packages/data/src/srd and is idempotent under ingestSrdDirectory', async () => {
      const cliReport = await validateSrdDirectory(SRD_DIR);
      expect(cliReport.valid).toBe(true);
      expect(cliReport.errors).toEqual([]);

      const ingested = await ingestSrdDirectory({
        inDir: SRD_DIR,
        outDir: SRD_DIR,
        dryRun: true,
      });
      expect(ingested.races).toHaveLength(9);
      expect(ingested.classes).toHaveLength(12);
      expect(ingested.spells.length).toBe(BUNDLED_SRD_DATASET.spells.length);
      expect(ingested.monsters.length).toBe(BUNDLED_SRD_DATASET.monsters.length);
    });
  });

  describe('Formula Syntax Validator (validateFormulaSyntax)', () => {
    it('accepts valid dice expressions, arithmetic, variables, and functions', () => {
      const validFormulas = [
        '1d8 + @strMod',
        '10 + @dexMod + @conMod',
        '8 + @prof + @spellMod',
        'max(1, @chaMod)',
        'floor(@classLevel / 2)',
        'ceil(@charLevel / 2)',
        'min(20, 10 + @dexMod)',
        '(@slotLevel + 5)d6',
        '(@slotLevel)d8 + @spellMod',
        '4d6kh3',
        '2d20kl1 + 5',
        '5d4 * 10',
        '2 + 1d4',
      ];
      for (const formula of validFormulas) {
        const res = validateFormulaSyntax(formula);
        expect(res, `Expected "${formula}" to be valid`).toEqual({ valid: true });
      }
    });

    it('rejects malformed formulas, unknown variables, and unknown functions', () => {
      expect(validateFormulaSyntax('').valid).toBe(false);
      expect(validateFormulaSyntax('10 + @unknownMod').valid).toBe(false);
      expect(validateFormulaSyntax('sqrt(@level)').valid).toBe(false);
      expect(validateFormulaSyntax('max(1, @chaMod').valid).toBe(false);
      expect(validateFormulaSyntax('1d8 + )').valid).toBe(false);
      expect(validateFormulaSyntax('max()').valid).toBe(false);
      expect(validateFormulaSyntax('1d8 +').valid).toBe(false);
      expect(validateFormulaSyntax('* 2d6').valid).toBe(false);
    });
  });

  describe('Referential Integrity & Allowlist Negative Tests', () => {
    it('detects broken featureId cross-references in classes and subclasses', () => {
      const broken = cloneDataset();
      broken.classes[0]!.levels[0]!.featureIds.push('non-existent-feature-id');
      broken.subclasses[0]!.levels[0]!.featureIds.push('missing-subclass-feature');

      const report = validateSrdDataset(broken);
      expect(report.valid).toBe(false);
      expect(
        report.errors.some(
          (e) =>
            e.category === 'cross_reference' &&
            e.collection === 'classes' &&
            e.message.includes('non-existent-feature-id'),
        ),
      ).toBe(true);
      expect(
        report.errors.some(
          (e) =>
            e.category === 'cross_reference' &&
            e.collection === 'subclasses' &&
            e.message.includes('missing-subclass-feature'),
        ),
      ).toBe(true);
    });

    it('detects broken spellId cross-references in races, subclasses, and monster spellcasting', () => {
      const broken = cloneDataset();
      const tiefling = broken.races.find((r) => r.id === 'tiefling')!;
      tiefling.traits[0]!.innateSpells = [
        {
          spellId: 'missing-racial-spell',
          ability: 'cha',
          minCharacterLevel: 1,
        },
      ];
      const subclassWithSpells = broken.subclasses.find(
        (s) => s.spells && s.spells.length > 0,
      )!;
      subclassWithSpells.spells![0]!.spellIds.push('missing-domain-spell');

      const spellcasterMonster = broken.monsters[0]!;
      spellcasterMonster.spellcasting = {
        ability: 'wis',
        spellSaveDc: 12,
        spellAttackBonus: 4,
        atWillSpellIds: ['missing-monster-cantrip'],
      };

      const report = validateSrdDataset(broken);
      expect(report.valid).toBe(false);
      expect(
        report.errors.some((e) => e.message.includes('missing-racial-spell')),
      ).toBe(true);
      expect(
        report.errors.some((e) => e.message.includes('missing-domain-spell')),
      ).toBe(true);
      expect(
        report.errors.some((e) => e.message.includes('missing-monster-cantrip')),
      ).toBe(true);
    });

    it('detects broken equipmentId cross-references in equipment packs, starting equipment, magic items, and monsters', () => {
      const broken = cloneDataset();
      const pack = broken.equipment.find((e) => e.kind === 'pack');
      if (pack && pack.kind === 'pack') {
        pack.contents.push({ itemId: 'missing-pack-item', quantity: 1 });
      }
      broken.backgrounds[0]!.startingEquipment.push({
        itemId: 'missing-bg-item',
        quantity: 1,
      });
      broken.magicItems[0]!.baseEquipmentId = 'missing-base-weapon';
      broken.monsters[0]!.armorClass.armorIds = ['missing-monster-armor'];

      const report = validateSrdDataset(broken);
      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.message.includes('missing-pack-item'))).toBe(true);
      expect(report.errors.some((e) => e.message.includes('missing-bg-item'))).toBe(true);
      expect(report.errors.some((e) => e.message.includes('missing-base-weapon'))).toBe(true);
      expect(report.errors.some((e) => e.message.includes('missing-monster-armor'))).toBe(true);
    });

    it('detects broken monster multiattack sequence actionIds', () => {
      const broken = cloneDataset();
      const monster = broken.monsters[0]!;
      monster.actions[0]!.multiattack = {
        description: 'Broken multiattack',
        sequence: [{ actionId: 'non-existent-claw-attack', count: 2 }],
      };

      const report = validateSrdDataset(broken);
      expect(report.valid).toBe(false);
      expect(
        report.errors.some(
          (e) =>
            e.collection === 'monsters' &&
            e.entityId === monster.id &&
            e.message.includes('non-existent-claw-attack'),
        ),
      ).toBe(true);
    });

    it('detects duplicate IDs, invalid formulas, and prohibited Product Identity items', () => {
      const broken = cloneDataset();
      const dupSpell = structuredClone(broken.spells[0]!);
      const invalidSpell = structuredClone(broken.spells[1]!);
      invalidSpell.effects = [
        {
          step: 'deal_damage',
          damageType: 'fire',
          diceFormula: '1d10 + @invalidVar',
        },
      ];
      broken.spells = [invalidSpell, dupSpell, ...broken.spells];

      // Prohibited Product Identity monster
      const beholder = structuredClone(broken.monsters[0]!);
      beholder.id = 'beholder';
      beholder.name = 'Beholder';
      broken.monsters = [...broken.monsters, beholder];

      expect(() => assertValidSrdDataset(broken)).toThrow(/SRD 5\.1 Dataset Validation Failed/);

      const report = validateSrdDataset(broken);
      expect(report.errors.some((e) => e.category === 'duplicate_id')).toBe(true);
      expect(report.errors.some((e) => e.category === 'formula_syntax')).toBe(true);
      expect(
        report.errors.some(
          (e) => e.category === 'allowlist' && e.entityId === 'beholder',
        ),
      ).toBe(true);
    });
  });
});
