import {
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';

export interface BossRushWave {
  waveNumber: number;
  title: string;
  subtitle: string;
  bossMonsterIds: string[];
  crRating: string;
  description: string;
}

/**
 * Canonical 7-stage CR-escalating Boss Rush Gauntlet waves.
 */
export const BOSS_RUSH_WAVES: readonly BossRushWave[] = Object.freeze([
  {
    waveNumber: 1,
    title: 'The Proving Champions',
    subtitle: 'Minotaur & Knight',
    bossMonsterIds: ['minotaur', 'knight'],
    crRating: 'CR 3',
    description: 'A labyrinthine horned brute paired with a battle-hardened knight vanguard.',
  },
  {
    waveNumber: 2,
    title: 'Blood & Regeneration',
    subtitle: 'Troll & Gladiator',
    bossMonsterIds: ['troll', 'gladiator'],
    crRating: 'CR 5',
    description: 'An unstoppable flesh-mending troll flanked by an arena champion gladiator.',
  },
  {
    waveNumber: 3,
    title: 'The Dread Shapers',
    subtitle: 'Oni & Wyvern',
    bossMonsterIds: ['oni', 'wyvern'],
    crRating: 'CR 6–7',
    description: 'A shapechanging ogre mage of dark sorcery commanding a venomous flying drake.',
  },
  {
    waveNumber: 4,
    title: 'The Colossi of Ice & Many-Headed Ruin',
    subtitle: 'Frost Giant & Hydra',
    bossMonsterIds: ['frost-giant', 'hydra'],
    crRating: 'CR 8',
    description: 'A towering glacial titan wielding greataxes beside an ever-sprouting hydra.',
  },
  {
    waveNumber: 5,
    title: 'The Ancient Sentinels',
    subtitle: 'Stone Golem & Young Red Dragon',
    bossMonsterIds: ['stone-golem', 'young-red-dragon'],
    crRating: 'CR 10',
    description: 'An impervious slow-pulsing stone juggernaut backed by a crimson fire-breather.',
  },
  {
    waveNumber: 6,
    title: 'The Undead Sovereigns',
    subtitle: 'Vampire & Mummy Lord',
    bossMonsterIds: ['vampire', 'mummy-lord'],
    crRating: 'CR 13–15',
    description: 'The apex blood sovereign of the night paired with a tomb-cursing mummy pharaoh.',
  },
  {
    waveNumber: 7,
    title: 'The Red Calamity',
    subtitle: 'Adult Red Dragon',
    bossMonsterIds: ['adult-red-dragon'],
    crRating: 'CR 17',
    description: 'The supreme volcanic scourge of dragons, unleashing cataclysmic dragonfire breath.',
  },
]);

export interface BossRushScoreFactors {
  wavesCleared: number;
  monstersDefeated: number;
  totalXp: number;
  livingPartyCount: number;
  turnsTaken: number;
  breathersUsed: number;
}

/**
 * Pure calculation of the Boss Rush Final Score.
 * Formula:
 * BossRushScore = (WavesCleared * 2,500) + TotalXP + (LivingHeroes * 500) + (MonstersDefeated * 250) - (TurnsTaken * 5) - (BreathersUsed * 100)
 * Clamped to >= 0.
 */
export function calculateBossRushScore(factors: BossRushScoreFactors): number {
  const raw =
    factors.wavesCleared * 2500 +
    factors.totalXp +
    factors.livingPartyCount * 500 +
    factors.monstersDefeated * 250 -
    factors.turnsTaken * 5 -
    factors.breathersUsed * 100;
  return Math.max(0, Math.floor(raw));
}

/**
 * Returns boss monster IDs for a given Boss Rush wave number.
 */
export function getBossRushMonstersForWave(
  waveNumber: number,
  compendium: SrdCompendium = defaultCompendium,
  difficultyMultiplier = 1,
): string[] {
  const waveIndex = Math.max(0, waveNumber - 1);
  const matchedWave = BOSS_RUSH_WAVES[waveIndex] ?? BOSS_RUSH_WAVES[BOSS_RUSH_WAVES.length - 1]!;
  const monsterIds = [...matchedWave.bossMonsterIds];

  // Validate monster presence in compendium
  return monsterIds.filter((id) => {
    try {
      return Boolean(compendium.getMonster(id));
    } catch {
      return false;
    }
  });
}
