import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SRD_OVERLAY_BUNDLE,
  type NormalizedSrdDataset,
  runSrdIngestionPipeline,
  serializeSrdDatasetFiles,
  SRD_BUNDLE_FILENAMES,
  type SrdBundleFilename,
  type SrdIngestionInput,
  type SrdOverlayBundle,
} from '../src/index.js';

export interface IngestDirectoryOptions {
  inDir: string;
  outDir?: string;
  dryRun?: boolean;
  overlays?: SrdOverlayBundle;
}

async function readJsonFile<T>(dir: string, filename: SrdBundleFilename): Promise<T> {
  const fullPath = resolve(dir, filename);
  const raw = await readFile(fullPath, 'utf8');
  return JSON.parse(raw) as T;
}

/**
 * Reads an SRD 5.1 JSON directory, executes normalization, Product Identity verification,
 * Effect DSL overlay merging, and Zod validation, and optionally writes the normalized output.
 */
export async function ingestSrdDirectory(
  options: IngestDirectoryOptions,
): Promise<NormalizedSrdDataset> {
  const { inDir, outDir = inDir, dryRun = false, overlays = DEFAULT_SRD_OVERLAY_BUNDLE } = options;

  const input: SrdIngestionInput = {
    abilitiesAndSkills: await readJsonFile(inDir, 'abilities-and-skills.json'),
    conditions: await readJsonFile(inDir, 'conditions.json'),
    damageTypes: await readJsonFile(inDir, 'damage-types.json'),
    proficienciesAndLanguages: await readJsonFile(inDir, 'proficiencies-and-languages.json'),
    races: await readJsonFile(inDir, 'races.json'),
    subraces: await readJsonFile(inDir, 'subraces.json'),
    classes: await readJsonFile(inDir, 'classes.json'),
    subclasses: await readJsonFile(inDir, 'subclasses.json'),
    features: await readJsonFile(inDir, 'features.json'),
    backgrounds: await readJsonFile(inDir, 'backgrounds.json'),
    feats: await readJsonFile(inDir, 'feats.json'),
    equipment: await readJsonFile(inDir, 'equipment.json'),
    magicItems: await readJsonFile(inDir, 'magic-items.json'),
    spells: await readJsonFile(inDir, 'spells.json'),
    monsters: await readJsonFile(inDir, 'monsters.json'),
  };

  const normalized = runSrdIngestionPipeline(input, overlays);

  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
    const serialized = serializeSrdDatasetFiles(normalized);
    for (const filename of SRD_BUNDLE_FILENAMES) {
      await writeFile(resolve(outDir, filename), serialized[filename], 'utf8');
    }
  }

  return normalized;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: tsx scripts/ingest-srd.ts [--in-dir <path>] [--out-dir <path>] [--dry-run]',
    );
    return;
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultSrdDir = resolve(scriptDir, '../src/srd');

  const inDirIdx = args.indexOf('--in-dir');
  const outDirIdx = args.indexOf('--out-dir');
  const dryRun = args.includes('--dry-run');

  const inDir =
    inDirIdx !== -1 && args[inDirIdx + 1]
      ? resolve(process.cwd(), args[inDirIdx + 1]!)
      : defaultSrdDir;
  const outDir =
    outDirIdx !== -1 && args[outDirIdx + 1]
      ? resolve(process.cwd(), args[outDirIdx + 1]!)
      : inDir;

  const dataset = await ingestSrdDirectory({ inDir, outDir, dryRun });
  console.log(
    `[ingest-srd] Validated & normalized SRD 5.1 dataset (${dataset.races.length} races, ${dataset.classes.length} classes, ${dataset.spells.length} spells, ${dataset.monsters.length} monsters)${dryRun ? ' [dry-run]' : ` -> ${outDir}`}`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error('[ingest-srd] Fatal error:', err);
    process.exitCode = 1;
  });
}
