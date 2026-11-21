import { z } from 'zod';
import { rollD20 } from '../dice/evaluator.js';
import type { Combatant, PendingReactionPrompt } from '../combat/types.js';
import type { GameEvent, GameState } from '../state/types.js';

/**
 * SRD-1207: Knowledge recall passives (Spec 11 §3.2).
 *
 * Each tagged location/quest/NPC carries an optional recall spec. A recall
 * attempt is an INT-skill check (History / Religion / Arcana / Nature) vs a
 * DC; success applies a fail-forward reward (quest unlock, trap bonus, ward
 * reveal, lore note) and failure grants no bonus — never a hard block.
 *
 * Arcana doubles as spell identification for the counterspell prompt
 * (Xanathar's-derived homebrew): pass and the reactor sees the incoming
 * spell's name/level before committing a slot; fail and they may still
 * counterspell, but blind (names redacted).
 */

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export const KNOWLEDGE_RECALL_SKILLS = ['history', 'religion', 'arcana', 'nature'] as const;
export const KnowledgeRecallSkillSchema = z.enum(KNOWLEDGE_RECALL_SKILLS);
export type KnowledgeRecallSkill = z.infer<typeof KnowledgeRecallSkillSchema>;

export const KnowledgeRecallRewardSchema = z.discriminatedUnion('kind', [
  // History: unlocks a quest (old battlefield, forgotten cache).
  z.object({
    kind: z.literal('reveal_quest'),
    questId: z.string().min(1),
  }),
  // History: dungeon-scoped trap-detection bonus (e.g. Red Wizard's pit traps).
  z.object({
    kind: z.literal('trap_bonus'),
    bonus: z.number().int().min(1).max(5),
    /** Room id the bonus applies in, or `'dungeon'` for the whole floor. */
    scope: z.string().min(1),
  }),
  // Religion/Arcana: identify a consecration/ward before it triggers.
  z.object({
    kind: z.literal('ward_info'),
    /** Prop id (trap/shrine) or room id whose wards are revealed. */
    target: z.string().min(1),
  }),
  // Any skill: pure lore note (still a mechanical path — it feeds the log).
  z.object({
    kind: z.literal('lore_note'),
    text: z.string().min(1),
  }),
]);
export type KnowledgeRecallReward = z.infer<typeof KnowledgeRecallRewardSchema>;

export const KnowledgeRecallSpecSchema = z.object({
  skill: KnowledgeRecallSkillSchema,
  dc: z.number().int().min(1).max(30),
  reward: KnowledgeRecallRewardSchema,
});
export type KnowledgeRecallSpec = z.infer<typeof KnowledgeRecallSpecSchema>;

// ---------------------------------------------------------------------------
// Skill bonus + trap-bonus markers
// ---------------------------------------------------------------------------

/** Active-effect id prefix for History trap bonuses (`recall-trap-bonus:<scope>`). */
export const RECALL_TRAP_BONUS_EFFECT_PREFIX = 'recall-trap-bonus';

function skillKeyFor(skill: KnowledgeRecallSkill): string {
  return skill;
}

/** INT (History/Religion/Arcana/Nature) total bonus for a combatant. */
export function getRecallSkillBonus(actor: Combatant, skill: KnowledgeRecallSkill): number {
  const sheet = actor.characterSheet as unknown as
    | {
        skills?: Record<string, { totalBonus?: number } | undefined>;
        abilities?: Record<string, { modifier?: number } | undefined>;
        proficiencyBonus?: number;
      }
    | undefined;
  const entry = sheet?.skills?.[skillKeyFor(skill)] ?? sheet?.skills?.[skill.toLowerCase()];
  if (typeof entry?.totalBonus === 'number') return entry.totalBonus;
  // Monster skill map (skillId -> flat modifier).
  const monsterSkills = (actor.monsterData as unknown as { skills?: Record<string, number> } | undefined)?.skills;
  if (typeof monsterSkills?.[skill] === 'number') return monsterSkills[skill]!;
  // Fallback: INT modifier (all four recall skills are INT-based in SRD 5.1).
  const intMod =
    sheet?.abilities?.['int']?.modifier ??
    (actor.characterSheet?.abilities as unknown as { int?: { modifier?: number } } | undefined)?.int?.modifier ??
    0;
  return intMod;
}

function sanitizeScope(scope: string): string {
  return scope.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function recallTrapBonusEffectId(scope: string): string {
  return `${RECALL_TRAP_BONUS_EFFECT_PREFIX}-${sanitizeScope(scope)}`;
}

/** Sums active History trap bonuses applicable to a room (`dungeon` scope always applies). */
export function getRecallTrapBonus(actor: Combatant, roomId?: string): number {
  let total = 0;
  for (const effect of actor.activeEffects ?? []) {
    if (!effect.effectId.startsWith(RECALL_TRAP_BONUS_EFFECT_PREFIX)) continue;
    const scope = effect.effectId.slice(RECALL_TRAP_BONUS_EFFECT_PREFIX.length + 1);
    if (scope === 'dungeon' || (roomId && scope === sanitizeScope(roomId))) {
      for (const mod of effect.modifiers ?? []) {
        if (
          mod.type === 'flat_bonus' &&
          (mod.target === 'skill:perception' || mod.target === 'skill:investigation') &&
          typeof mod.value === 'number'
        ) {
          total = Math.max(total, mod.value);
        }
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Recall resolution
// ---------------------------------------------------------------------------

export interface RecallAttemptOptions {
  state: GameState;
  actorId: string;
  spec: KnowledgeRecallSpec;
  /** Room context for `trap_bonus` scope matching and `ward_info` sweeps. */
  roomId?: string;
}

export interface RecallOutcome {
  skill: KnowledgeRecallSkill;
  success: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  /** Quest unlocked on a successful `reveal_quest` (undefined otherwise). */
  questId?: string;
  /** Trap bonus granted on a successful `trap_bonus` (0 when failed/other). */
  trapBonus?: number;
  /** Prop ids revealed by a successful `ward_info`. */
  revealedPropIds?: string[];
  /** Lore text surfaced on a successful `lore_note`. */
  loreNote?: string;
  headline: string;
}

export interface RecallAttemptResult {
  nextState: GameState;
  events: GameEvent[];
  outcome: RecallOutcome;
}

function pushRecallTrapBonus(actor: Combatant, bonus: number, scope: string): void {
  const effectId = recallTrapBonusEffectId(scope);
  const existing = actor.activeEffects ?? [];
  if (existing.some((e) => e.effectId === effectId)) return;
  actor.activeEffects = [
    ...existing,
    {
      effectId,
      name: `Recall: +${bonus} trap detection (${scope})`,
      requiresConcentration: false,
      modifiers: [
        { type: 'flat_bonus', target: 'skill:perception', value: bonus },
        { type: 'flat_bonus', target: 'skill:investigation', value: bonus },
      ],
    },
  ];
}

function isWardedProp(kind: string, trapFormula: string | undefined): boolean {
  if (kind === 'shrine') return true;
  return trapFormula !== undefined;
}

/**
 * Resolves one knowledge recall attempt. Always emits `CHECK_RESOLVED`
 * (checkType = the recall skill) plus `RECALL_RESOLVED`; on success the
 * reward path also emits `SECRET_DISCOVERED` (ward_info) and attaches a
 * trap-bonus marker (trap_bonus). Failure is fail-forward: no bonus, no
 * throw, progression never blocks.
 */
export function resolveRecallAttempt(options: RecallAttemptOptions): RecallAttemptResult {
  const spec = KnowledgeRecallSpecSchema.parse(options.spec);
  const { actorId, roomId } = options;
  const nextState = structuredClone(options.state);

  const inCombat = nextState.mode === 'combat' && nextState.combat !== null;
  const actor: Combatant | undefined =
    (inCombat ? nextState.combat!.combatants[actorId] : undefined) ??
    nextState.party[actorId] ??
    nextState.monsters[actorId];
  if (!actor) throw new Error(`Recall actor not found: ${actorId}`);
  if (actor.isDead || actor.currentHp <= 0) throw new Error(`Recall actor ${actorId} is down`);

  const modifier = getRecallSkillBonus(actor, spec.skill);
  let rngState = inCombat ? nextState.combat!.rngState : nextState.rngState;
  const rollRes = rollD20(rngState, { modifier, mode: 'normal' });
  rngState = rollRes.nextState;
  const success = rollRes.total >= spec.dc;

  const events: GameEvent[] = [];
  events.push({
    type: 'CHECK_RESOLVED',
    actorId,
    checkType: spec.skill,
    dc: spec.dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
  } as unknown as GameEvent);

  const outcome: RecallOutcome = {
    skill: spec.skill,
    success,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    dc: spec.dc,
    headline: success
      ? `${actor.name} recalls ${spec.skill} lore (${rollRes.total} vs DC ${spec.dc}).`
      : `${actor.name} cannot recall the ${spec.skill} lore (${rollRes.total} vs DC ${spec.dc}) — no bonus.`,
  };

  if (success) {
    switch (spec.reward.kind) {
      case 'reveal_quest': {
        outcome.questId = spec.reward.questId;
        outcome.headline = `${actor.name}'s ${spec.skill} recall uncovers the trail to "${spec.reward.questId}" (${rollRes.total} vs DC ${spec.dc}).`;
        break;
      }
      case 'trap_bonus': {
        outcome.trapBonus = spec.reward.bonus;
        pushRecallTrapBonus(actor, spec.reward.bonus, spec.reward.scope);
        outcome.headline = `${actor.name}'s ${spec.skill} recall grants +${spec.reward.bonus} to trap detection in ${spec.reward.scope} (${rollRes.total} vs DC ${spec.dc}).`;
        break;
      }
      case 'ward_info': {
        const target = spec.reward.target;
        const revealed: string[] = [];
        for (const prop of nextState.props) {
          const inTarget =
            prop.id === target || (roomId !== undefined && target === roomId && propMatchesRoom(nextState, prop, roomId));
          const matchesScope = prop.id === target || target === 'dungeon' || inTarget;
          if (!matchesScope) continue;
          if (!isWardedProp(prop.kind, prop.trapDamageFormula)) continue;
          if (!prop.discovered) {
            prop.discovered = true;
            revealed.push(prop.id);
            events.push({ type: 'SECRET_DISCOVERED', propId: prop.id, finderId: actorId, kind: prop.kind });
          }
        }
        outcome.revealedPropIds = revealed;
        outcome.headline =
          revealed.length > 0
            ? `${actor.name}'s ${spec.skill} recall identifies the ward on ${revealed.join(', ')} (${rollRes.total} vs DC ${spec.dc}).`
            : `${actor.name}'s ${spec.skill} recall finds no active wards on ${target} (${rollRes.total} vs DC ${spec.dc}).`;
        break;
      }
      case 'lore_note': {
        outcome.loreNote = spec.reward.text;
        outcome.headline = `${actor.name} recalls: ${spec.reward.text}`;
        break;
      }
    }
  }

  events.push({
    type: 'RECALL_RESOLVED',
    actorId,
    skill: spec.skill,
    dc: spec.dc,
    roll: rollRes.naturalRoll,
    modifier,
    total: rollRes.total,
    success,
    ...(outcome.questId !== undefined ? { questId: outcome.questId } : {}),
    ...(outcome.trapBonus !== undefined ? { trapBonus: outcome.trapBonus, scope: spec.reward.kind === 'trap_bonus' ? spec.reward.scope : undefined } : {}),
    ...(outcome.revealedPropIds !== undefined ? { revealedPropIds: outcome.revealedPropIds } : {}),
    ...(outcome.loreNote !== undefined ? { loreNote: outcome.loreNote } : {}),
    headline: outcome.headline,
  } as unknown as GameEvent);

  nextState.rngState = rngState;
  if (nextState.combat) {
    nextState.combat.rngState = rngState;
    for (const [id, c] of Object.entries(nextState.combat.combatants)) {
      if (c.side === 'party') nextState.party[id] = c;
      else nextState.monsters[id] = c;
    }
  }

  return { nextState, events, outcome };
}

function propMatchesRoom(state: GameState, prop: { x: number; y: number }, roomId: string): boolean {
  const cell = state.grid.cells.find((c) => c.x === prop.x && c.y === prop.y);
  return cell?.roomId === roomId;
}

// ---------------------------------------------------------------------------
// Arcana spell identification (counterspell gating, Spec 11 §3.2)
// ---------------------------------------------------------------------------

/** Free-identification DC before the counterspell decision (table-friendly Xanathar's variant). */
export function getSpellIdentifyDc(spellLevel: number): number {
  return 10 + Math.max(0, spellLevel);
}

export interface SpellIdentificationOptions {
  observer: Combatant;
  spellId: string;
  spellName: string;
  spellLevel: number;
  rngState: number;
  dcOverride?: number;
}

export interface SpellIdentification {
  identified: boolean;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  /** Real name when identified, `'an unknown spell'` when blind. */
  displayName: string;
  /** Real level when identified, undefined when blind. */
  displayLevel?: number;
}

/**
 * Rolls INT (Arcana) to identify a spell being cast. Pass → the reactor sees
 * name/level before deciding; fail → they may still counterspell, but blind.
 */
export function resolveArcanaSpellIdentification(options: SpellIdentificationOptions): {
  identification: SpellIdentification;
  nextRngState: number;
} {
  const dc = options.dcOverride ?? getSpellIdentifyDc(options.spellLevel);
  const modifier = getRecallSkillBonus(options.observer, 'arcana');
  const rollRes = rollD20(options.rngState, { modifier, mode: 'normal' });
  const identified = rollRes.total >= dc;
  return {
    nextRngState: rollRes.nextState,
    identification: {
      identified,
      roll: rollRes.naturalRoll,
      modifier,
      total: rollRes.total,
      dc,
      displayName: identified ? options.spellName : 'an unknown spell',
      ...(identified ? { displayLevel: options.spellLevel } : {}),
    },
  };
}

/**
 * Applies an identification outcome to a counterspell prompt copy: on a
 * failed Arcana check the spell name/level are redacted, but every
 * `counterspell_slot_N` reaction remains offered (blind counterspell).
 */
export function applyIdentificationToCounterspellPrompt(
  prompt: PendingReactionPrompt,
  identification: SpellIdentification,
): PendingReactionPrompt {
  if (identification.identified) return prompt;
  return {
    ...prompt,
    triggerDescription: 'A hostile caster is casting an unknown spell within 60 ft. Cast Counterspell blind?',
    availableReactions: prompt.availableReactions.map((r) => ({
      ...r,
      description: 'Commit a spell slot to attempt to interrupt the unknown spell (DC 10 + spell level — you cannot see its level).',
    })),
  };
}

// ---------------------------------------------------------------------------
// Procedural recall tags (Spec 11 §3.5)
// ---------------------------------------------------------------------------

export type RecallTagTheme = 'undead_crypt' | 'wizard_lair' | 'wilds' | 'generic';

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Classifies a floor's monster roster into a recall-tag theme (seeded tables). */
export function classifyRecallTheme(monsterIds: string[]): RecallTagTheme {
  const norm = monsterIds.map((m) => m.toLowerCase());
  const undeadHits = norm.filter((m) =>
    ['skeleton', 'zombie', 'ghoul', 'wight', 'mummy', 'ghost', 'specter', 'wraith', 'vampire', 'mummy-lord'].some((k) => m.includes(k)),
  ).length;
  const arcaneHits = norm.filter((m) =>
    ['mage', 'archmage', 'cult-fanatic', 'cultist', 'acolyte', 'priest'].some((k) => m.includes(k)),
  ).length;
  const wildHits = norm.filter((m) =>
    ['wolf', 'spider', 'bear', 'bat', 'rat', 'beast', 'owlbear', 'boar'].some((k) => m.includes(k)),
  ).length;
  if (undeadHits >= 2 || (undeadHits >= 1 && norm.length <= 3)) return 'undead_crypt';
  if (arcaneHits >= 1 && arcaneHits >= wildHits) return 'wizard_lair';
  if (wildHits >= 2) return 'wilds';
  return 'generic';
}

/**
 * Deterministically derives per-room recall tags from the same seeded inputs
 * that drive traps/loot (floor id + seed + room id). Pure function of its
 * inputs — calling it never perturbs generation RNG, so bit-exact replay of
 * `generateDungeonFloor` stays green.
 */
export function generateFloorRecallTags(options: {
  floorId: string;
  seed: number;
  rooms: Array<{ id: string; name?: string }>;
  monsterIds?: string[];
  depth?: number;
}): Record<string, KnowledgeRecallSpec[]> {
  const theme = classifyRecallTheme(options.monsterIds ?? []);
  const depth = options.depth ?? 1;
  const tags: Record<string, KnowledgeRecallSpec[]> = {};
  for (let idx = 0; idx < options.rooms.length; idx++) {
    const room = options.rooms[idx]!;
    const h = fnv1a(`${options.floorId}|${options.seed}|${room.id}|${theme}`);
    const roll = h % 100;
    const dcBase = 10 + Math.min(6, depth);
    const roomTags: KnowledgeRecallSpec[] = [];
    switch (theme) {
      case 'undead_crypt': {
        // Religion ward tag on ~2/3 of rooms; History trap-bonus on the rest.
        // The first room always carries the signature Religion ward so every
        // undead floor ships with its table stake (Spec 11 §3.5).
        if (idx === 0 || roll < 66) {
          roomTags.push({ skill: 'religion', dc: dcBase + 2, reward: { kind: 'ward_info', target: room.id } });
        } else {
          roomTags.push({ skill: 'history', dc: dcBase, reward: { kind: 'trap_bonus', bonus: 2, scope: room.id } });
        }
        break;
      }
      case 'wizard_lair': {
        // Alternate Arcana ward tags and History lore notes.
        if (roll < 50) {
          roomTags.push({ skill: 'arcana', dc: dcBase + 2, reward: { kind: 'ward_info', target: room.id } });
        } else {
          roomTags.push({
            skill: 'history',
            dc: dcBase,
            reward: { kind: 'lore_note', text: `The weave hangs heavy here — a wizard once worked rites in ${room.id}.` },
          });
        }
        break;
      }
      case 'wilds': {
        if (roll < 60) {
          roomTags.push({
            skill: 'nature',
            dc: dcBase,
            reward: { kind: 'lore_note', text: `Beast-sign and spoor mark ${room.id}; forage here is worth a careful look.` },
          });
        } else {
          roomTags.push({ skill: 'history', dc: dcBase, reward: { kind: 'trap_bonus', bonus: 2, scope: room.id } });
        }
        break;
      }
      default: {
        if (roll < 40) {
          roomTags.push({
            skill: 'history',
            dc: dcBase,
            reward: { kind: 'lore_note', text: `Old stonework in ${room.id} remembers older delves.` },
          });
        }
        break;
      }
    }
    if (roomTags.length > 0) tags[room.id] = roomTags;
  }
  return tags;
}
