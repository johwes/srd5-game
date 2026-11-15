import type { CharacterBuildState } from '@srd5/data';

export type CampaignModeId = 'campaign_kaelen' | 'deep_descent' | 'arena';

export type DifficultyPresetId = 'explorer' | 'standard' | 'tactician' | 'custom';

export type DeathSaveRuleId = 'core_raw' | 'forgiving' | 'hardcore';

export interface CampaignDifficultyConfig {
  preset: DifficultyPresetId;
  permadeath: boolean;                // Party wipe deletes save (Tactician default: true)
  campSuppliesRequired: boolean;      // Rations needed for Long Rests (Standard/Tactician: true)
  fogOfWarEnabled: boolean;           // Dynamic Line of Sight mask (Standard: true)
  friendlyFireEnabled: boolean;       // Offensive AOE spells (Fireball, etc.) harm allies (Explorer: false, Standard/Tactician: true)
  deathSaveRule: DeathSaveRuleId;     // 'forgiving' | 'core_raw' | 'hardcore'
  enemyHealthModifier: number;        // Multiplier on monster Max HP (0.8 Explorer, 1.0 Standard, 1.2 Tactician)
  enemyAttackBonus: number;           // Flat modifier to enemy attack rolls & DCs (-1, 0, +1)
  fastAiTurns: boolean;               // Skip or accelerate AI movement animations
}

export interface PartySlotAssignment {
  slotIndex: number;                  // 0, 1, 2, or 3
  roleSuggestion: 'frontline' | 'striker' | 'controller' | 'support';
  character: CharacterBuildState | null;
  seatType: 'local' | 'network_remote';
  playerSeatId?: string;
}

export interface CampaignLaunchConfig {
  mode: CampaignModeId;
  difficulty: CampaignDifficultyConfig;
  party: CharacterBuildState[];
  slotAssignments?: PartySlotAssignment[];
}

export type SlotRoleSuggestion = 'frontline' | 'striker' | 'controller' | 'support';

export const SLOT_ROLE_SUGGESTIONS: SlotRoleSuggestion[] = [
  'frontline',
  'striker',
  'controller',
  'support',
];

export const SLOT_ROLE_LABELS: Record<SlotRoleSuggestion, { title: string; subtitle: string; icon: string }> = {
  frontline: {
    title: 'Frontline Anchor',
    subtitle: 'Tank / Melee (Fighter, Paladin, Barbarian)',
    icon: '🛡️',
  },
  striker: {
    title: 'Striker & Scout',
    subtitle: 'Infiltrator / Traps (Rogue, Ranger, Monk)',
    icon: '🗝️',
  },
  controller: {
    title: 'Arcane Controller',
    subtitle: 'Blaster / Utility (Wizard, Sorcerer, Warlock)',
    icon: '🔮',
  },
  support: {
    title: 'Divine Support',
    subtitle: 'Healer / Buffer (Cleric, Druid, Bard)',
    icon: '✨',
  },
};

export interface CampaignModeMeta {
  id: CampaignModeId;
  title: string;
  tagline: string;
  badge: string;
  icon: string;
  description: string;
  features: string[];
  levelRange: string;
  estimatedTime: string;
}

export interface DifficultyPresetMeta {
  id: DifficultyPresetId;
  title: string;
  badge: string;
  description: string;
  config: CampaignDifficultyConfig;
  highlights: string[];
}

export const CAMPAIGN_MODES: Record<CampaignModeId, CampaignModeMeta> = {
  campaign_kaelen: {
    id: 'campaign_kaelen',
    title: 'The Sunken Crypt of Kaelen',
    tagline: 'Narrative Campaign',
    badge: 'Levels 1–4 · Handcrafted Crypt',
    icon: '🏰',
    description:
      'Delve into the ancient sunken crypt of Lord Kaelen beneath Blackwood Ridge. Brave devious traps, secret chambers, and undead horrors to retrieve the lost Sunstone Relic.',
    features: [
      '3 Handcrafted Dungeon Floors',
      'Interactive Puzzles, Levers & Traps',
      'Boss Encounter: High Priest Kaelen',
      'Story-Driven CRPG Experience',
    ],
    levelRange: 'Levels 1–4',
    estimatedTime: '2–3 Hours',
  },
  deep_descent: {
    id: 'deep_descent',
    title: 'The Deep Descent',
    tagline: 'Endless Roguelite Gauntlet',
    badge: 'Levels 1–20 · Procedural Biomes',
    icon: '💀',
    description:
      'A NetHack-inspired descending dungeon crawl into shifting abysses. Battle depth-scaled monsters across distinct biomes, pray at Shrines of Fate, and survive permadeath for high scores.',
    features: [
      'Procedural BSP Floor Generation',
      'Dynamic Biomes: Tombs, Magma, Vaults',
      'Supply Scarcity & Exhaustion Tension',
      'Shrines of Fate & Graveyard High Scores',
    ],
    levelRange: 'Levels 1–20+',
    estimatedTime: 'Endless Run',
  },
  arena: {
    id: 'arena',
    title: 'The Arena',
    tagline: 'Tactical Skirmish & Party Duels',
    badge: 'Configurable · Instant Combat',
    icon: '⚔️',
    description:
      'Enter the grand proving grounds for instant 5e tactical turn-based combat. Test your builds in PvE monster wave survival or battle in local 1v1 hot-seat party duels.',
    features: [
      'Instant 5-ft Grid Tactical Combat',
      'PvE Custom Monster Packs & Waves',
      'Hot-Seat 1v1 Party Duels',
      'Full Reaction & Spellcasting Engine',
    ],
    levelRange: 'Any Level',
    estimatedTime: '15–30 Mins',
  },
};

export const DIFFICULTY_PRESETS: Record<Exclude<DifficultyPresetId, 'custom'>, DifficultyPresetMeta> = {
  explorer: {
    id: 'explorer',
    title: 'Explorer (Story)',
    badge: 'Narrative Focus',
    description:
      'Relaxed ruleset for adventurers who want to experience the narrative and tactical combat without lethal punishment.',
    highlights: [
      'Relaxed SRD Rules & No Friendly Fire',
      'Advantage on Death Saving Throws',
      'Free Long Rests (Supplies Not Required)',
      'Enemy HP -20% & -1 Attack/DC Penalty',
      'Permadeath Disabled',
    ],
    config: {
      preset: 'explorer',
      permadeath: false,
      campSuppliesRequired: false,
      fogOfWarEnabled: true,
      friendlyFireEnabled: false,
      deathSaveRule: 'forgiving',
      enemyHealthModifier: 0.8,
      enemyAttackBonus: -1,
      fastAiTurns: false,
    },
  },
  standard: {
    id: 'standard',
    title: 'Standard (5e Core RAW)',
    badge: 'Authentic 5e RAW',
    description:
      'The authentic tabletop 5e experience. Full SRD rules, standard DC 10 death saves, and ration management during long rests.',
    highlights: [
      '100% SRD 5.1 RAW Ruleset',
      'Friendly Fire Enabled (AOE Affects All)',
      'Standard Death Saves (DC 10)',
      'Camp Supplies Required for Long Rests',
      '100% Monster HP & Normal SRD Stats',
      'Permadeath Optional',
    ],
    config: {
      preset: 'standard',
      permadeath: false,
      campSuppliesRequired: true,
      fogOfWarEnabled: true,
      friendlyFireEnabled: true,
      deathSaveRule: 'core_raw',
      enemyHealthModifier: 1.0,
      enemyAttackBonus: 0,
      fastAiTurns: false,
    },
  },
  tactician: {
    id: 'tactician',
    title: 'Tactician (Hardcore)',
    badge: 'Brutal & Lethal',
    description:
      'High-stakes tactical punishment. Lethal monsters, ruthless AI focus, iron man permadeath, and unforgiving death saves.',
    highlights: [
      'Strict RAW + Hardcore Enforcement',
      'Friendly Fire Enabled (Full AOE Lethality)',
      'Lethal Death Saves (Nat 1 = Instant Death)',
      'Iron Man Permadeath Enabled',
      'Enemy HP +20% & +1 to Hit/DCs',
      'Hostile AI Focuses Downed Heroes',
    ],
    config: {
      preset: 'tactician',
      permadeath: true,
      campSuppliesRequired: true,
      fogOfWarEnabled: true,
      friendlyFireEnabled: true,
      deathSaveRule: 'hardcore',
      enemyHealthModifier: 1.2,
      enemyAttackBonus: 1,
      fastAiTurns: false,
    },
  },
};

export const DEFAULT_CAMPAIGN_DIFFICULTY: CampaignDifficultyConfig =
  DIFFICULTY_PRESETS.standard.config;
