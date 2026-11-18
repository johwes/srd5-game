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

    it('keeps SRD 5.2 content out of the SRD 5.1-scoped bundle (verified against the official SRD FAQ tables)', () => {
      // Identifiers the official SRD FAQ lists as *added* in 5.2, i.e. absent
      // from SRD 5.1. Any bundled record matching these must be re-homed as
      // `homebrew` (see the provenance test below) — never shipped as SRD.
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      const v52Added = new Set(
        [
          // Monsters added in 5.2.
          'allosaurus', 'ankylosaurus', 'archelon', 'bugbear stalker', 'goblin boss',
          'goblin minion', 'guard captain', 'hippopotamus', 'hobgoblin captain',
          'pirate', 'pirate captain', 'pteranodon', 'sphinx of wonder',
          'swarm of crawling claws', 'tough boss', 'troll limb', 'vampire familiar',
          // Spells added in 5.2.
          'aura of life', 'charm monster', 'chromatic orb', 'dissonant whispers',
          'divine smite', "dragon's breath", 'elementalism', 'ensnaring strike',
          'hex', 'ice knife', 'mind spike', 'phantasmal force', 'power word heal',
          'ray of sickness', 'searing smite', 'sorcerous burst', 'starry wisp',
          'summon dragon', 'tsunami', 'vitriolic sphere',
          // Magic items added in 5.2 (plus the 2 renamed new-form names).
          'bead of nourishment', 'cloak of invisibility', 'elixir of health',
          'energy bow', 'gloves of thievery', 'hat of many spells',
          'potion of invulnerability', 'potion of longevity', 'potion of vitality',
          'quarterstaff of the acrobat', 'rod of resurrection', 'sending stones',
          'sentinel shield', 'shield of the cavalier', 'thunderous greatclub',
          'mysterious deck', 'dragon orb',
          // Feats and backgrounds added in 5.2.
          'alert', 'magic initiate', 'savage attacker', 'ability score improvement',
          'archery', 'great weapon fighting', 'two weapon fighting',
          'boon of combat prowess', 'boon of dimensional travel', 'boon of fate',
          'boon of irresistible offense', 'boon of the night spirit',
          'boon of spell slots', 'boon of spell recall', 'boon of truesight',
          'criminal', 'sage', 'soldier',
        ].map(norm),
      );
      const asSrd = (source: string | undefined) => source ?? 'srd-5.1';
      const offenders: string[] = [];
      for (const m of BUNDLED_SRD_DATASET.monsters) {
        if (asSrd(m.source) === 'srd-5.1' && (v52Added.has(norm(m.id)) || v52Added.has(norm(m.name)))) {
          offenders.push(`monster:${m.id}`);
        }
      }
      for (const s of BUNDLED_SRD_DATASET.spells) {
        if (asSrd(s.source) === 'srd-5.1' && (v52Added.has(norm(s.id)) || v52Added.has(norm(s.name)))) {
          offenders.push(`spell:${s.id}`);
        }
      }
      for (const i of BUNDLED_SRD_DATASET.magicItems) {
        if (asSrd(i.source) === 'srd-5.1' && (v52Added.has(norm(i.id)) || v52Added.has(norm(i.name)))) {
          offenders.push(`magic-item:${i.id}`);
        }
      }
      for (const f of BUNDLED_SRD_DATASET.feats) {
        if (v52Added.has(norm(f.id)) || v52Added.has(norm(f.name))) {
          offenders.push(`feat:${f.id}`);
        }
      }
      for (const b of BUNDLED_SRD_DATASET.backgrounds) {
        if (v52Added.has(norm(b.id)) || v52Added.has(norm(b.name))) {
          offenders.push(`background:${b.id}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('tracks provenance: valid source values and an explicit homebrew roster', () => {
      const valid = new Set(['srd-5.1', 'homebrew', undefined]);
      for (const m of BUNDLED_SRD_DATASET.monsters) {
        expect(valid.has((m as { source?: string }).source)).toBe(true);
      }
      // Tripwire: adding homebrew content requires explicitly extending this
      // roster (human review), so nothing slips in unlabeled.
      const homebrew = BUNDLED_SRD_DATASET.monsters
        .filter((m) => (m as { source?: string }).source === 'homebrew')
        .map((m) => m.id)
        .sort();
      expect(homebrew).toEqual(['goblin-boss']);
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

    it('enforces the two-track SRD 5.1 vs Homebrew gate and rejects SRD 5.2 additions', () => {
      // 1. Original homebrew feat and background pass validation when labeled source: 'homebrew'
      const withHomebrew = cloneDataset();
      withHomebrew.feats = [
        ...withHomebrew.feats,
        {
          id: 'ironclad-sentinel',
          name: 'Ironclad Sentinel',
          source: 'homebrew',
          description: 'Original tactical shield mastery feat.',
          prerequisites: [{ type: 'ability_minimum', ability: 'str', minimum: 13 }],
          modifiers: [{ type: 'flat_bonus', target: 'ac', value: 1 }],
        },
      ];
      withHomebrew.backgrounds = [
        ...withHomebrew.backgrounds,
        {
          id: 'crypt-delver',
          name: 'Crypt Delver',
          source: 'homebrew',
          skillProficiencies: ['athletics', 'perception'],
          toolProficiencies: [],
          languages: [],
          choices: [],
          startingEquipment: [],
          feature: {
            id: 'tomb-sense',
            name: 'Tomb Sense',
            description: 'You recall the layout of ancient subterranean masonry.',
          },
          description: 'A seasoned explorer of sunken vaults.',
        },
      ];
      const validHomebrewReport = validateSrdDataset(withHomebrew);
      expect(validHomebrewReport.errors).toEqual([]);
      expect(validHomebrewReport.valid).toBe(true);

      // 2. Unlabeled feat/background or SRD 5.2 content is rejected
      const withViolations = cloneDataset();
      withViolations.feats = [
        ...withViolations.feats,
        // Unlabeled custom feat rejected by SRD 5.1 allowlist
        {
          id: 'unlabeled-feat',
          name: 'Unlabeled Feat',
          description: 'Missing homebrew provenance.',
          prerequisites: [],
          modifiers: [],
        },
        // SRD 5.2 feat rejected even if labeled homebrew
        {
          id: 'alert',
          name: 'Alert',
          source: 'homebrew',
          description: 'SRD 5.2 feat not allowed.',
          prerequisites: [],
          modifiers: [],
        },
      ];
      // SRD 5.2 spell on SRD 5.1 track rejected
      const hexSpell = structuredClone(withViolations.spells[0]!);
      hexSpell.id = 'hex';
      hexSpell.name = 'Hex';
      withViolations.spells = [...withViolations.spells, hexSpell];
      // SRD 5.2 monster without homebrew provenance rejected
      const allosaurus = structuredClone(withViolations.monsters[0]!);
      allosaurus.id = 'allosaurus';
      allosaurus.name = 'Allosaurus';
      delete allosaurus.source;
      withViolations.monsters = [...withViolations.monsters, allosaurus];

      const violationReport = validateSrdDataset(withViolations);
      expect(violationReport.valid).toBe(false);
      expect(
        violationReport.errors.some((e) => e.collection === 'feats' && e.entityId === 'unlabeled-feat'),
      ).toBe(true);
      expect(
        violationReport.errors.some((e) => e.collection === 'feats' && e.entityId === 'alert'),
      ).toBe(true);
      expect(
        violationReport.errors.some((e) => e.collection === 'spells' && e.entityId === 'hex'),
      ).toBe(true);
      expect(
        violationReport.errors.some((e) => e.collection === 'monsters' && e.entityId === 'allosaurus'),
      ).toBe(true);
    });
  });
});
