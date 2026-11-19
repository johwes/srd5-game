import { z } from 'zod';
import type { SkillId } from '@srd5/data';
import { normalizeSeed } from '../dice/prng.js';
import { rollD20 } from '../dice/evaluator.js';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import { type WarBattleModifiers, WarBattleModifiersSchema } from './war-squads.js';
import { RealmError } from './realm-error.js';

/**
 * SRD-1103 — Special-Ops mission catalog & POI-specific 5e Approach resolver
 * (Spec 10 Section 5).
 *
 * Arriving at a mission POI opens an Approach Dialogue offering 3–4
 * context-aware options tied to the POI type & mission kind (Frontal Assault
 * is always available). Every approach reads real 5e `DerivedCharacterSheet`
 * skill bonuses, tool proficiencies, and spell slots (deducting any expended
 * slot) and resolves deterministically via the seeded Mulberry32 PRNG
 * (`rollD20`) into bloodless success or modified tactical battles
 * (`WarBattleModifiers` from SRD-1102).
 *
 * Pure & deterministic: `Math.random()` is never called. All randomness
 * threads `rngState`.
 */

// ---------------------------------------------------------------------------
// Mission kinds & sides
// ---------------------------------------------------------------------------

export const WAR_MISSION_KINDS = [
  'assassinate_general',
  'destroy_bridge',
  'poison_water_supply',
  'sabotage_enemy_mine',
  'rescue_spy',
  'protect_poi',
  'cleanse_cursed_mine',
  'capture_neutral_mine',
  'recover_war_artifact',
] as const;
export const WarMissionKindSchema = z.enum(WAR_MISSION_KINDS);
export type WarMissionKind = z.infer<typeof WarMissionKindSchema>;

export const WAR_MISSION_SIDES = ['offensive', 'domestic', 'defense', 'artifact'] as const;
export const WarMissionSideSchema = z.enum(WAR_MISSION_SIDES);
export type WarMissionSide = z.infer<typeof WarMissionSideSchema>;

/** Strategic side of each mission kind (Spec 10 §5 table). */
export const WAR_MISSION_SIDE_BY_KIND: Record<WarMissionKind, WarMissionSide> = {
  assassinate_general: 'offensive',
  destroy_bridge: 'offensive',
  poison_water_supply: 'offensive',
  sabotage_enemy_mine: 'offensive',
  rescue_spy: 'offensive',
  protect_poi: 'defense',
  cleanse_cursed_mine: 'domestic',
  capture_neutral_mine: 'domestic',
  recover_war_artifact: 'artifact',
};

export function getWarMissionSide(kind: WarMissionKind): WarMissionSide {
  return WAR_MISSION_SIDE_BY_KIND[kind];
}

/** POI kinds each mission kind may target (Spec 10 §5 table). */
export const WAR_MISSION_ELIGIBLE_POIS: Record<WarMissionKind, readonly string[]> = {
  assassinate_general: ['fortress'],
  destroy_bridge: ['bridge'],
  poison_water_supply: ['town', 'supply_depot', 'village', 'capital'],
  sabotage_enemy_mine: ['mine'],
  rescue_spy: ['prison_keep'],
  protect_poi: ['fortress', 'mine', 'bridge', 'supply_depot'],
  cleanse_cursed_mine: ['mine'],
  capture_neutral_mine: ['mine'],
  recover_war_artifact: ['ancient_shrine', 'dungeon_entrance'],
};

export function isPoiEligibleForMission(kind: WarMissionKind, poiKind: string): boolean {
  return WAR_MISSION_ELIGIBLE_POIS[kind]?.includes(poiKind) ?? false;
}

// ---------------------------------------------------------------------------
// Approach options
// ---------------------------------------------------------------------------

export const WarApproachCheckKindSchema = z.enum(['skill', 'tool', 'spell', 'assault']);
export type WarApproachCheckKind = z.infer<typeof WarApproachCheckKindSchema>;

export const WarApproachSuccessTypeSchema = z.enum(['bloodless', 'battle']);
export type WarApproachSuccessType = z.infer<typeof WarApproachSuccessTypeSchema>;

export const MissionApproachOptionSchema = z.object({
  /** Stable slug unique within its mission kind (e.g. `scale-walls-rope`). */
  id: z.string().min(1),
  missionKind: WarMissionKindSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  checkKind: WarApproachCheckKindSchema,
  /** Primary 5e skill for the check (`frontal-assault` uses none). */
  skillId: z.string().min(1).optional(),
  /** Alternate skill accepted with OR logic (uses the better of the two). */
  alternateSkillId: z.string().min(1).optional(),
  /** Ability-check DC (12–15 band per Spec 10 stealth/bluff norms). */
  dc: z.number().int().min(1).max(30),
  /** When true, a second hero secures the climb: roll with advantage. */
  ropeAssist: z.boolean().default(false),
  /** Tool proficiency gating the attempt (e.g. `thieves_tools`). */
  requiresTool: z.string().min(1).optional(),
  /** Spell ids any of which satisfy a spell-entry/demolition approach. */
  requiresSpellIds: z.array(z.string().min(1)).default([]),
  /** Minimum spell slot level consumed when a spell approach is attempted. */
  requiredSlotLevel: z.number().int().min(1).max(9).default(1),
  /** Resolves to no combat on success when true. */
  bloodlessOnSuccess: z.boolean().default(false),
  /** Battle tuning applied on success (surprise, militia, attrition). */
  successModifiers: WarBattleModifiersSchema.default({}),
  /** Battle tuning applied on failure (alarm raised, no surprise). */
  failureModifiers: WarBattleModifiersSchema.default({}),
});
export type MissionApproachOption = z.infer<typeof MissionApproachOptionSchema>;

export const WarMissionSchema = z.object({
  id: z.string().min(1),
  kind: WarMissionKindSchema,
  poiId: z.string().min(1),
  poiKind: z.string().min(1),
  poiName: z.string().min(1).optional(),
  targetNationId: z.string().min(1).optional(),
});
export type WarMission = z.infer<typeof WarMissionSchema>;

const FRONTAL_ASSAULT_MODIFIERS: WarBattleModifiers = {
  surpriseAttackerSide: 'none',
  extraAlliedMilitia: 0,
  wave1EnemiesSurprised: false,
  enemyCountMultiplier: 1,
  enemyHpMultiplier: 1,
};

function assaultOption(kind: WarMissionKind, label = 'Frontal Assault'): MissionApproachOption {
  return MissionApproachOptionSchema.parse({
    id: 'frontal-assault',
    missionKind: kind,
    label,
    description: 'Storm the position head-on. No check — a straight tactical battle.',
    checkKind: 'assault',
    dc: 10,
    ropeAssist: false,
    requiresSpellIds: [],
    requiredSlotLevel: 1,
    bloodlessOnSuccess: false,
    successModifiers: { ...FRONTAL_ASSAULT_MODIFIERS },
    failureModifiers: { ...FRONTAL_ASSAULT_MODIFIERS },
  });
}

interface ApproachTemplate {
  id: string;
  label: string;
  description: string;
  checkKind: WarApproachCheckKind;
  skillId?: string;
  alternateSkillId?: string;
  dc: number;
  ropeAssist?: boolean;
  requiresTool?: string;
  requiresSpellIds?: string[];
  requiredSlotLevel?: number;
  bloodlessOnSuccess?: boolean;
  successModifiers?: WarBattleModifiers;
  failureModifiers?: WarBattleModifiers;
}

function toOption(kind: WarMissionKind, template: ApproachTemplate): MissionApproachOption {
  return MissionApproachOptionSchema.parse({
    id: template.id,
    missionKind: kind,
    label: template.label,
    description: template.description,
    checkKind: template.checkKind,
    ...(template.skillId ? { skillId: template.skillId } : {}),
    ...(template.alternateSkillId ? { alternateSkillId: template.alternateSkillId } : {}),
    dc: template.dc,
    ropeAssist: template.ropeAssist ?? false,
    ...(template.requiresTool ? { requiresTool: template.requiresTool } : {}),
    requiresSpellIds: template.requiresSpellIds ?? [],
    requiredSlotLevel: template.requiredSlotLevel ?? 1,
    bloodlessOnSuccess: template.bloodlessOnSuccess ?? false,
    successModifiers: template.successModifiers ?? { ...FRONTAL_ASSAULT_MODIFIERS },
    failureModifiers: template.failureModifiers ?? { ...FRONTAL_ASSAULT_MODIFIERS },
  });
}

/**
 * Canonical 3-option approach cores per mission kind (before the mandatory
 * Frontal Assault). Builders add deterministic seeded variety on top
 * (bluff-skill rotation) without changing counts or guarantees.
 */
const MISSION_APPROACH_CORES: Record<WarMissionKind, ApproachTemplate[]> = {
  assassinate_general: [
    {
      id: 'scale-walls-rope',
      label: 'Scale the Walls (Athletics + Rope)',
      description:
        'One hero climbs the curtain wall and secures a rope for the party. Success grants Surprise.',
      checkKind: 'skill',
      skillId: 'athletics',
      dc: 13,
      ropeAssist: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
      failureModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 1.25,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'arcane-entry',
      label: 'Arcane Entry (Misty Step / Dimension Door)',
      description:
        'Slip past the battlements with teleportation or a veil. Expends one spell slot; success grants Surprise.',
      checkKind: 'spell',
      skillId: 'stealth',
      dc: 12,
      requiresSpellIds: ['misty-step', 'dimension-door', 'invisibility', 'disguise-self'],
      requiredSlotLevel: 2,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
      failureModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'trick-gate-guards',
      label: 'Trick the Gate Guards (Deception)',
      description:
        'Bluff or fast-talk the gate watch into opening the postern. Bloodless entry on success.',
      checkKind: 'skill',
      skillId: 'deception',
      alternateSkillId: 'persuasion',
      dc: 14,
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.75,
        enemyHpMultiplier: 1,
      },
    },
  ],
  destroy_bridge: [
    {
      id: 'impersonate-guard-rotation',
      label: 'Impersonate the Guard Rotation (Deception)',
      description:
        'Pose as the relief watch and order the span cleared. Bloodless demolition on success.',
      checkKind: 'skill',
      skillId: 'deception',
      alternateSkillId: 'persuasion',
      dc: 14,
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.5,
        enemyHpMultiplier: 0.75,
      },
    },
    {
      id: 'sapper-stealth',
      label: 'Sapper Stealth (Stealth / Thieves’ Tools)',
      description:
        'Creep under the span and pack the charges. Requires thieves’ tools; bloodless on success.',
      checkKind: 'tool',
      skillId: 'stealth',
      dc: 13,
      requiresTool: 'thieves_tools',
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.5,
        enemyHpMultiplier: 0.75,
      },
    },
  ],
  poison_water_supply: [
    {
      id: 'disguised-supply-cart',
      label: 'Disguised Supply Cart (Deception)',
      description:
        'Roll in as provisioners — or under a Disguise Self veil. Bloodless on success.',
      checkKind: 'skill',
      skillId: 'deception',
      dc: 13,
      requiresSpellIds: [],
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.75,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'cistern-infiltration',
      label: 'Cistern Infiltration (Athletics / Stealth)',
      description:
        'Swim or climb the culverts into the cistern. Success grants Surprise on the raid.',
      checkKind: 'skill',
      skillId: 'athletics',
      alternateSkillId: 'stealth',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
  sabotage_enemy_mine: [
    {
      id: 'collapse-supports',
      label: 'Sneak & Collapse the Supports (Stealth)',
      description:
        'Slip to the timber supports and bring the shafts down. Bloodless on a clean job.',
      checkKind: 'skill',
      skillId: 'stealth',
      alternateSkillId: 'investigation',
      dc: 13,
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.5,
        enemyHpMultiplier: 0.75,
      },
    },
    {
      id: 'arcane-demolition',
      label: 'Arcane Demolition (Shatter / Fireball)',
      description:
        'Blast the supports with battle magic. Expends one spell slot; weakens the garrison either way.',
      checkKind: 'spell',
      skillId: 'arcana',
      dc: 12,
      requiresSpellIds: ['shatter', 'fireball'],
      requiredSlotLevel: 2,
      bloodlessOnSuccess: false,
      successModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 0.75,
        enemyHpMultiplier: 0.5,
      },
      failureModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 0.75,
      },
    },
  ],
  rescue_spy: [
    {
      id: 'forge-transfer-orders',
      label: 'Forge Transfer Orders (Deception)',
      description:
        'Present forged writs — or a Charm Person smile — and walk the asset out. Bloodless on success.',
      checkKind: 'skill',
      skillId: 'deception',
      alternateSkillId: 'persuasion',
      dc: 14,
      requiresSpellIds: [],
      bloodlessOnSuccess: true,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 0.75,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'lockpick-jailbreak',
      label: 'Lockpick Jailbreak (Thieves’ Tools)',
      description:
        'Pick the cell block under cover of stealth. Requires thieves’ tools; success grants Surprise.',
      checkKind: 'tool',
      skillId: 'stealth',
      dc: 13,
      requiresTool: 'thieves_tools',
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'arcane-extraction',
      label: 'Arcane Extraction (Misty Step)',
      description:
        'Bypass bars and wards with teleportation or a strong arm. Expends one spell slot on spell entry.',
      checkKind: 'spell',
      skillId: 'athletics',
      dc: 13,
      ropeAssist: true,
      requiresSpellIds: ['misty-step', 'dimension-door', 'invisibility'],
      requiredSlotLevel: 2,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
  protect_poi: [
    {
      id: 'fortify-barricades',
      label: 'Fortify the Barricades (Athletics)',
      description:
        'Raise barricades and spike the approaches. Success thins and weakens the first wave.',
      checkKind: 'skill',
      skillId: 'athletics',
      dc: 12,
      successModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 0.75,
        enemyHpMultiplier: 0.85,
      },
    },
    {
      id: 'rally-militia',
      label: 'Rally the Militia (Persuasion)',
      description:
        'Rouse the locals to stand the walls with you. Success brings allied militia to the battle.',
      checkKind: 'skill',
      skillId: 'persuasion',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 2,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'set-ambush-traps',
      label: 'Set Ambush Traps (Survival)',
      description:
        'Seed the approaches with pits and snares. Success leaves Wave 1 Surprised.',
      checkKind: 'skill',
      skillId: 'survival',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
  cleanse_cursed_mine: [
    {
      id: 'ritual-ward',
      label: 'Ritual Ward (Arcana / Religion)',
      description:
        'Consecrate the shafts before descending. Success weakens the undead and grants Surprise.',
      checkKind: 'skill',
      skillId: 'arcana',
      alternateSkillId: 'religion',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 0.75,
      },
    },
    {
      id: 'stealth-recon',
      label: 'Stealth Recon (Stealth)',
      description:
        'Map the crypt shafts unseen. Success grants Surprise on the first undead pack.',
      checkKind: 'skill',
      skillId: 'stealth',
      dc: 12,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
  capture_neutral_mine: [
    {
      id: 'scout-and-ambush',
      label: 'Scout & Ambush (Survival / Stealth)',
      description:
        'Read the spoil heaps, then hit the claim-jumpers from cover. Success grants Surprise.',
      checkKind: 'skill',
      skillId: 'survival',
      alternateSkillId: 'stealth',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
    {
      id: 'rally-miners',
      label: 'Rally the Miners (Persuasion)',
      description:
        'Talk the crews into holding the shafts beside you. Success brings allied militia.',
      checkKind: 'skill',
      skillId: 'persuasion',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'none',
        extraAlliedMilitia: 2,
        wave1EnemiesSurprised: false,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
  recover_war_artifact: [
    {
      id: 'decipher-wards',
      label: 'Decipher the Wards (Arcana / History)',
      description:
        'Unbind the vault seals cleanly. Success weakens the guardians and grants Surprise.',
      checkKind: 'skill',
      skillId: 'arcana',
      alternateSkillId: 'history',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 0.75,
      },
    },
    {
      id: 'outrace-rivals',
      label: 'Outrace Rival Agents (Survival / Perception)',
      description:
        'Cut the rival column off at the vault mouth. Success grants Surprise on the delve guard.',
      checkKind: 'skill',
      skillId: 'survival',
      alternateSkillId: 'perception',
      dc: 13,
      successModifiers: {
        surpriseAttackerSide: 'party',
        extraAlliedMilitia: 0,
        wave1EnemiesSurprised: true,
        enemyCountMultiplier: 1,
        enemyHpMultiplier: 1,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Approach builder (3–4 POI-specific options + mandatory assault)
// ---------------------------------------------------------------------------

export const BuildMissionApproachesOptionsSchema = z.object({
  seed: z.number().int().optional(),
});
export type BuildMissionApproachesOptions = z.infer<typeof BuildMissionApproachesOptionsSchema>;

/**
 * Builds the 3–4 context-aware Approach Dialogue options for a mission kind
 * at a POI kind. Frontal Assault is always the final option. Bridges never
 * receive teleport/spell-entry approaches; fortresses always offer rope
 * climb + spell entry + CHA bluff + assault.
 *
 * Deterministic seeded variety: bluff approaches rotate their featured skill
 * (`deception` vs `persuasion`) from `seed` without changing counts.
 */
export function buildMissionApproaches(
  missionKind: WarMissionKind,
  poiKind: string,
  rawOptions: Partial<BuildMissionApproachesOptions> = {},
): MissionApproachOption[] {
  const kind = WarMissionKindSchema.parse(missionKind);
  const options = BuildMissionApproachesOptionsSchema.parse(rawOptions);
  const cores = MISSION_APPROACH_CORES[kind];
  if (!cores) throw new RealmError(`Unknown war mission kind '${missionKind}'`);

  const rngState = normalizeSeed(options.seed ?? stableMissionSeed(kind, poiKind));
  // Seeded bluff-skill rotation: odd draws feature persuasion first.
  const bluffFirst = rngState % 2 === 1;

  const tuned = cores
    .filter((template) => {
      // Bridges never offer teleport: drop any spell approach requiring
      // teleportation when the POI is a bridge (Spec 10 §5).
      if (poiKind === 'bridge' && (template.requiresSpellIds?.length ?? 0) > 0) return false;
      return true;
    })
    .map((template) => {
      if (bluffFirst && template.alternateSkillId === 'persuasion' && template.skillId === 'deception') {
        return { ...template, skillId: 'persuasion', alternateSkillId: 'deception' };
      }
      return template;
    });

  const options_ = tuned.map((template) => toOption(kind, template));
  const assaultLabel = kind === 'protect_poi' ? 'Hold the Line' : kind === 'recover_war_artifact' ? 'Direct Delve' : undefined;
  options_.push(assaultOption(kind, assaultLabel));
  return options_;
}

function stableMissionSeed(kind: string, poiKind: string): number {
  let hash = 2166136261;
  const text = `${kind}:${poiKind}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

// ---------------------------------------------------------------------------
// Approach resolution (real 5e bonuses + spell slots, seeded d20)
// ---------------------------------------------------------------------------

export const ResolveMissionApproachOptionsSchema = z.object({
  mission: WarMissionSchema,
  /** Approach id from `buildMissionApproaches()` (e.g. `sapper-stealth`). */
  approachId: z.string().min(1),
  /** Persistent party sheets (skill bonuses + spell slots are read live). */
  party: z.array(z.any()).min(1).max(6),
  /** Seeded PRNG state for the d20 test. */
  rngState: z.number().int().default(0),
  /** The exact approach list offered (defaults to the catalog builder). */
  approaches: z.array(MissionApproachOptionSchema).optional(),
  /** Compendium for spell-level lookup (reserved for future slot scaling). */
  compendium: z.any().optional(),
});
export type ResolveMissionApproachOptionsInput = z.input<typeof ResolveMissionApproachOptionsSchema>;

export const MissionApproachOutcomeSchema = z.enum(['bloodless_success', 'tactical_battle']);
export type MissionApproachOutcome = z.infer<typeof MissionApproachOutcomeSchema>;

export interface ResolvedMissionApproach {
  mission: WarMission;
  approach: MissionApproachOption;
  outcome: MissionApproachOutcome;
  success: boolean;
  /** Acting hero (best bonus holder) for the check. */
  actorId: string;
  actorName: string;
  bonus: number;
  dc: number;
  naturalRoll: number;
  total: number;
  advantage: boolean;
  /** Battle tuning for the follow-up tactical fight (ignored on bloodless). */
  modifiers: WarBattleModifiers;
  /** Spell slot consumed by the attempt, if any. */
  expendedSpell: { casterId: string; casterName: string; spellId: string; slotLevel: number } | null;
  /** Party sheets with any expended slot deducted (input never mutated). */
  updatedParty: DerivedCharacterSheet[];
  nextRngState: number;
  headline: string;
}

function skillBonusOf(sheet: DerivedCharacterSheet, skillId: string): number {
  const skills = sheet.skills as unknown as Record<string, { totalBonus?: number } | undefined>;
  const entry = skills[skillId];
  if (entry && typeof entry.totalBonus === 'number') return entry.totalBonus;
  return 0;
}

function hasToolProficiency(sheet: DerivedCharacterSheet, tool: string): boolean {
  const tools = sheet.proficiencies?.tools ?? [];
  const normalized = tool.toLowerCase().replace(/[-_\s]+/g, '');
  return tools.some((entry) => entry.toLowerCase().replace(/[-_\s]+/g, '') === normalized);
}

function availableSlotsAt(sheet: DerivedCharacterSheet, level: number): number {
  const pool = (sheet.spellcasting?.spellSlots as unknown as Record<number, { available?: number } | undefined>)?.[level];
  return pool?.available ?? 0;
}

function findSpellCaster(
  party: DerivedCharacterSheet[],
  spellIds: string[],
  slotLevel: number,
): { sheet: DerivedCharacterSheet; spellId: string } | null {
  if (spellIds.length === 0) return null;
  for (const sheet of party) {
    const prepared = new Set([
      ...(sheet.spellcasting?.preparedOrKnownSpellIds ?? []),
      ...(sheet.spellcasting?.spellbookSpellIds ?? []),
      ...(sheet.spellcasting?.cantripIds ?? []),
    ]);
    const spellId = spellIds.find((id) => prepared.has(id));
    if (!spellId) continue;
    if (availableSlotsAt(sheet, slotLevel) > 0) return { sheet, spellId };
    // Allow upcasting: any higher slot with availability also satisfies.
    for (let level = slotLevel + 1; level <= 9; level++) {
      if (availableSlotsAt(sheet, level) > 0) return { sheet, spellId };
    }
  }
  return null;
}

function deductSlot(
  sheet: DerivedCharacterSheet,
  requestedLevel: number,
): { updated: DerivedCharacterSheet; slotLevel: number } {
  const next = structuredClone(sheet);
  const slots = next.spellcasting.spellSlots as unknown as Record<
    number,
    { max: number; expended: number; available: number }
  >;
  for (let level = requestedLevel; level <= 9; level++) {
    const pool = slots[level];
    if (pool && pool.available > 0) {
      pool.expended += 1;
      pool.available = Math.max(0, pool.available - 1);
      return { updated: next, slotLevel: level };
    }
  }
  throw new RealmError(`Caster ${sheet.name} has no available spell slot at level ${requestedLevel}+`);
}

/**
 * Resolves one Approach Dialogue choice: reads the best live party skill
 * bonus (OR logic across `skillId`/`alternateSkillId`), verifies tool and
 * spell-slot prerequisites from real sheets (deducting the slot), then rolls
 * a deterministic d20 (`rollD20`) against the approach DC.
 *
 * - `frontal-assault` skips the check and always yields a straight battle.
 * - Skill/spell success yields `bloodless_success` when `bloodlessOnSuccess`
 *   is set, otherwise a `tactical_battle` with `successModifiers`.
 * - Failure always yields a `tactical_battle` with `failureModifiers`.
 */
export function resolveMissionApproach(rawOptions: ResolveMissionApproachOptionsInput): ResolvedMissionApproach {
  const options = ResolveMissionApproachOptionsSchema.parse(rawOptions);
  const mission = WarMissionSchema.parse(options.mission);
  const party = options.party as DerivedCharacterSheet[];
  const approaches =
    options.approaches ?? buildMissionApproaches(mission.kind, mission.poiKind);
  const approach = approaches.find((entry) => entry.id === options.approachId);
  if (!approach) throw new RealmError(`Unknown approach '${options.approachId}' for mission '${mission.kind}'`);

  let rngState = normalizeSeed(options.rngState);

  if (approach.checkKind === 'assault') {
    return {
      mission,
      approach,
      outcome: 'tactical_battle',
      success: false,
      actorId: party[0]!.id,
      actorName: party[0]!.name,
      bonus: 0,
      dc: approach.dc,
      naturalRoll: 0,
      total: 0,
      advantage: false,
      modifiers: WarBattleModifiersSchema.parse(approach.successModifiers),
      expendedSpell: null,
      updatedParty: structuredClone(party),
      nextRngState: rngState,
      headline: `${approach.label}: the company storms ${mission.poiName ?? 'the position'} head-on.`,
    };
  }

  // Acting hero: best live bonus across the primary/alternate skill.
  const candidates = party.map((sheet) => {
    const primary = approach.skillId ? skillBonusOf(sheet, approach.skillId) : Number.NEGATIVE_INFINITY;
    const alternate = approach.alternateSkillId ? skillBonusOf(sheet, approach.alternateSkillId) : Number.NEGATIVE_INFINITY;
    return { sheet, bonus: Math.max(primary, alternate) };
  });
  candidates.sort((a, b) => b.bonus - a.bonus);
  const actor = candidates[0]!;
  const actorSheet = actor.sheet;

  // Tool gating: the acting hero (or any hero) must hold the proficiency;
  // without it the attempt fails forward into an alerted battle.
  if (approach.requiresTool) {
    const holder = party.find((sheet) => hasToolProficiency(sheet, approach.requiresTool!));
    if (!holder) {
      return {
        mission,
        approach,
        outcome: 'tactical_battle',
        success: false,
        actorId: actorSheet.id,
        actorName: actorSheet.name,
        bonus: actor.bonus === Number.NEGATIVE_INFINITY ? 0 : actor.bonus,
        dc: approach.dc,
        naturalRoll: 0,
        total: 0,
        advantage: false,
        modifiers: WarBattleModifiersSchema.parse(approach.failureModifiers),
        expendedSpell: null,
        updatedParty: structuredClone(party),
        nextRngState: rngState,
        headline: `${actorSheet.name} lacks ${approach.requiresTool} and the ${mission.kind} approach is exposed — battle is joined.`,
      };
    }
  }

  // Spell gating: some hero must know a listed spell and hold a slot.
  let updatedParty = structuredClone(party);
  let expendedSpell: ResolvedMissionApproach['expendedSpell'] = null;
  if (approach.requiresSpellIds.length > 0) {
    const caster = findSpellCaster(updatedParty, approach.requiresSpellIds, approach.requiredSlotLevel);
    if (!caster) {
      return {
        mission,
        approach,
        outcome: 'tactical_battle',
        success: false,
        actorId: actorSheet.id,
        actorName: actorSheet.name,
        bonus: actor.bonus === Number.NEGATIVE_INFINITY ? 0 : actor.bonus,
        dc: approach.dc,
        naturalRoll: 0,
        total: 0,
        advantage: Boolean(approach.ropeAssist && party.length > 1),
        modifiers: WarBattleModifiersSchema.parse(approach.failureModifiers),
        expendedSpell: null,
        updatedParty: structuredClone(party),
        nextRngState: rngState,
        headline: `No hero holds ${approach.requiresSpellIds.join(' / ')} with a free slot — the ${mission.kind} approach falls back to battle.`,
      };
    }
    const index = updatedParty.findIndex((sheet) => sheet.id === caster.sheet.id);
    const deducted = deductSlot(updatedParty[index]!, approach.requiredSlotLevel);
    updatedParty[index] = deducted.updated;
    expendedSpell = {
      casterId: caster.sheet.id,
      casterName: caster.sheet.name,
      spellId: caster.spellId,
      slotLevel: deducted.slotLevel,
    };
  }

  const advantage = Boolean(approach.ropeAssist && party.length > 1);
  const roll = rollD20(rngState, {
    modifier: actor.bonus === Number.NEGATIVE_INFINITY ? 0 : actor.bonus,
    mode: advantage ? 'advantage' : 'normal',
  });
  rngState = roll.nextState;
  const success = roll.total >= approach.dc;
  const outcome: MissionApproachOutcome =
    success && approach.bloodlessOnSuccess ? 'bloodless_success' : 'tactical_battle';
  const modifiers = WarBattleModifiersSchema.parse(
    success ? approach.successModifiers : approach.failureModifiers,
  );
  const headline = success
    ? outcome === 'bloodless_success'
      ? `${actorSheet.name} pulls off ${approach.label} (${roll.total} vs DC ${approach.dc}) — bloodless success.`
      : `${actorSheet.name} pulls off ${approach.label} (${roll.total} vs DC ${approach.dc}) — the battle turns in our favor.`
    : `${actorSheet.name} fails ${approach.label} (${roll.total} vs DC ${approach.dc}) — battle is joined on enemy terms.`;

  return {
    mission,
    approach,
    outcome,
    success,
    actorId: actorSheet.id,
    actorName: actorSheet.name,
    bonus: actor.bonus === Number.NEGATIVE_INFINITY ? 0 : actor.bonus,
    dc: approach.dc,
    naturalRoll: roll.naturalRoll,
    total: roll.total,
    advantage,
    modifiers,
    expendedSpell,
    updatedParty,
    nextRngState: rngState,
    headline,
  };
}

/** Lists every mission kind with its side and eligible POI kinds. */
export function listWarMissionCatalog(): Array<{
  kind: WarMissionKind;
  side: WarMissionSide;
  eligiblePoiKinds: readonly string[];
  approachCount: number;
}> {
  return WAR_MISSION_KINDS.map((kind) => ({
    kind,
    side: getWarMissionSide(kind),
    eligiblePoiKinds: WAR_MISSION_ELIGIBLE_POIS[kind]!,
    approachCount: buildMissionApproaches(kind, WAR_MISSION_ELIGIBLE_POIS[kind]![0]!).length,
  }));
}
