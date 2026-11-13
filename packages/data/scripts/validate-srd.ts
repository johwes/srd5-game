import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidSrdDataset,
  type SrdBundleFilename,
  type SrdIngestionInput,
  type SrdValidationReport,
} from '../src/index.js';

async function readJsonFile<T>(dir: string, filename: SrdBundleFilename): Promise<T> {
  const fullPath = resolve(dir, filename);
  const raw = await readFile(fullPath, 'utf8');
  return JSON.parse(raw) as T;
}

/**
 * Loads all 15 bundled SRD 5.1 JSON files from `dir` (defaulting to `packages/data/src/srd`)
 * and runs the full Zod schema, referential integrity, formula syntax, and Product Identity allowlist checks.
 */
export async function validateSrdDirectory(dir?: string): Promise<SrdValidationReport> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const targetDir = dir ?? resolve(scriptDir, '../src/srd');

  const input: SrdIngestionInput = {
    abilitiesAndSkills: await readJsonFile(targetDir, 'abilities-and-skills.json'),
    conditions: await readJsonFile(targetDir, 'conditions.json'),
    damageTypes: await readJsonFile(targetDir, 'damage-types.json'),
    proficienciesAndLanguages: await readJsonFile(targetDir, 'proficiencies-and-languages.json'),
    races: await readJsonFile(targetDir, 'races.json'),
    subraces: await readJsonFile(targetDir, 'subraces.json'),
    classes: await readJsonFile(targetDir, 'classes.json'),
    subclasses: await readJsonFile(targetDir, 'subclasses.json'),
    features: await readJsonFile(targetDir, 'features.json'),
    backgrounds: await readJsonFile(targetDir, 'backgrounds.json'),
    feats: await readJsonFile(targetDir, 'feats.json'),
    equipment: await readJsonFile(targetDir, 'equipment.json'),
    magicItems: await readJsonFile(targetDir, 'magic-items.json'),
    spells: await readJsonFile(targetDir, 'spells.json'),
    monsters: await readJsonFile(targetDir, 'monsters.json'),
  };

  return assertValidSrdDataset(input);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: tsx scripts/validate-srd.ts [--dir <path>]');
    return;
  }

  const dirIdx = args.indexOf('--dir');
  const dir =
    dirIdx !== -1 && args[dirIdx + 1]
      ? resolve(process.cwd(), args[dirIdx + 1]!)
      : undefined;

  const report = await validateSrdDirectory(dir);
  console.log(
    `[validate-srd] PASS — 100% SRD 5.1 schema & referential integrity verified (${report.counts.races} races, ${report.counts.subraces} subraces, ${report.counts.classes} classes, ${report.counts.subclasses} subclasses, ${report.counts.features} features, ${report.counts.equipment} equipment, ${report.counts.magicItems} magic items, ${report.counts.spells} spells, ${report.counts.monsters} monsters)`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error('[validate-srd] Validation failed:', err);
    process.exitCode = 1;
  });
}
