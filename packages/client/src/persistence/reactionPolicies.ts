import type { PendingReactionPrompt } from '@srd5/engine';
import type { RosterStorageAdapter } from './rosterPersistence.js';
import { defaultRosterStorageAdapter } from './rosterPersistence.js';

// ============================================================================
// SRD-1509: Reactions policy (Ask / Auto / Off per reaction) — Spec 14 §12.
//
// Client-side only, over the existing prompt flow. No engine changes:
// - `Ask` (default) keeps today's interrupt modal.
// - `Auto` answers the prompt immediately with the first valid option.
// - `Off` declines the prompt immediately.
// Policies persist per character in roster storage (same offline
// IndexedDB + localStorage/memory fallback machinery as the party roster).
// The combat path also keeps a synchronous localStorage/memory mirror so
// `TacticalCombatHud` can auto-resolve without awaiting IndexedDB.
// ============================================================================

export const REACTION_POLICY_MODES = ['ask', 'auto', 'off'] as const;
export type ReactionPolicyMode = (typeof REACTION_POLICY_MODES)[number];

export const REACTION_POLICY_STORAGE_KEY = 'srd5:reaction-policies:v1' as const;

/** Canonical per-character policy map: reaction key -> mode. */
export type ReactionPolicyMap = Record<string, ReactionPolicyMode>;

/** All characters' policies: characterId -> policy map. */
export type AllReactionPolicies = Record<string, ReactionPolicyMap>;

function isPolicyMode(value: unknown): value is ReactionPolicyMode {
  return value === 'ask' || value === 'auto' || value === 'off';
}

/**
 * Normalizes a prompt `AvailableReaction.id` to its canonical policy key.
 *
 * Prompt ids carry per-slot variants (`counterspell_slot_3`,
 * `cast_shield`, `shield_slot_2`); one policy covers all slot levels for
 * that reaction (Auto picks the first valid option in prompt order).
 */
export function normalizeReactionPolicyKey(reactionId: string): string {
  const id = reactionId.trim().toLowerCase();
  if (id.length === 0) return 'custom';
  if (id === 'opportunity_attack' || id === 'opportunity-attack' || id === 'oa') {
    return 'opportunity_attack';
  }
  if (id.startsWith('counterspell')) return 'counterspell';
  if (id.startsWith('cast_shield') || id === 'shield' || id.startsWith('shield')) {
    return 'shield';
  }
  if (id.startsWith('uncanny')) return 'uncanny_dodge';
  if (id.startsWith('protection') || id.includes('protection')) return 'protection';
  if (id === 'custom') return 'custom';
  return id;
}

export function getDefaultReactionPolicy(_key: string): ReactionPolicyMode {
  return 'ask';
}

function sanitizePolicyMap(raw: unknown): ReactionPolicyMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: ReactionPolicyMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length > 0 && isPolicyMode(value)) {
      out[normalizeReactionPolicyKey(key)] = value;
    }
  }
  return out;
}

function sanitizeAllPolicies(raw: unknown): AllReactionPolicies {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: AllReactionPolicies = {};
  for (const [charId, map] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof charId === 'string' && charId.length > 0) {
      out[charId] = sanitizePolicyMap(map);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synchronous mirror (localStorage + in-memory) for the time-sensitive
// combat auto-resolve path. Async IndexedDB stays the durable store; the
// mirror is best-effort and never throws.
// ---------------------------------------------------------------------------

const memoryMirror = new Map<string, string>();

function readMirrorRaw(): unknown {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      const raw = localStorage.getItem(REACTION_POLICY_STORAGE_KEY);
      if (raw !== null) return JSON.parse(raw) as unknown;
    }
  } catch {
    // Fall through to memory mirror.
  }
  const mem = memoryMirror.get(REACTION_POLICY_STORAGE_KEY);
  return mem !== undefined ? (JSON.parse(mem) as unknown) : undefined;
}

function writeMirrorRaw(value: AllReactionPolicies): void {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  memoryMirror.set(REACTION_POLICY_STORAGE_KEY, serialized);
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.setItem(REACTION_POLICY_STORAGE_KEY, serialized);
    }
  } catch {
    // Ignore quota/security errors — memory mirror + IndexedDB still hold it.
  }
}

/** Synchronous read of every character's policies (never throws). */
export function readAllReactionPoliciesSync(): AllReactionPolicies {
  try {
    return sanitizeAllPolicies(readMirrorRaw());
  } catch {
    return {};
  }
}

/** Synchronous read of one character's policy map (never throws). */
export function getReactionPoliciesForCharacterSync(characterId: string): ReactionPolicyMap {
  return readAllReactionPoliciesSync()[characterId] ?? {};
}

/** Synchronous read of one reaction's mode (defaults to `ask`). */
export function getReactionPolicySync(characterId: string, reactionKey: string): ReactionPolicyMode {
  const map = getReactionPoliciesForCharacterSync(characterId);
  return map[normalizeReactionPolicyKey(reactionKey)] ?? 'ask';
}

/**
 * Synchronous write of one reaction's policy. Updates the sync mirror
 * immediately and persists to IndexedDB in the background (fire-and-forget).
 */
export function setReactionPolicySync(
  characterId: string,
  reactionKey: string,
  mode: ReactionPolicyMode,
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): ReactionPolicyMap {
  const key = normalizeReactionPolicyKey(reactionKey);
  const all = readAllReactionPoliciesSync();
  const next: ReactionPolicyMap = { ...(all[characterId] ?? {}), [key]: mode };
  writeMirrorRaw({ ...all, [characterId]: next });
  // Durable IndexedDB copy — fire-and-forget so combat/checkout paths stay sync.
  void (async () => {
    try {
      const stored = sanitizeAllPolicies(await adapter.getItem(REACTION_POLICY_STORAGE_KEY));
      await adapter.setItem(REACTION_POLICY_STORAGE_KEY, { ...stored, [characterId]: next });
    } catch {
      // Mirror already holds the value; IndexedDB write is best-effort.
    }
  })();
  return next;
}

/** Test helper: clears the sync mirror (localStorage + memory). */
export function clearReactionPolicyMirrorForTests(): void {
  memoryMirror.delete(REACTION_POLICY_STORAGE_KEY);
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      localStorage.removeItem(REACTION_POLICY_STORAGE_KEY);
    }
  } catch {
    // Ignore.
  }
}

// ---------------------------------------------------------------------------
// Async IndexedDB-backed API (roster-storage parity, used by settings UIs
// and tests). Every write also refreshes the sync mirror.
// ---------------------------------------------------------------------------

/** Loads every character's policies from roster storage (empty when absent). */
export async function loadAllReactionPolicies(
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<AllReactionPolicies> {
  try {
    const raw = await adapter.getItem(REACTION_POLICY_STORAGE_KEY);
    if (raw === undefined || raw === null) return {};
    return sanitizeAllPolicies(raw);
  } catch {
    return {};
  }
}

/** Loads one character's policy map (empty when absent). */
export async function loadReactionPoliciesForCharacter(
  characterId: string,
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<ReactionPolicyMap> {
  const all = await loadAllReactionPolicies(adapter);
  return all[characterId] ?? {};
}

/** Persists one reaction's policy for a character (async roster-storage path). */
export async function saveReactionPolicy(
  characterId: string,
  reactionKey: string,
  mode: ReactionPolicyMode,
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<ReactionPolicyMap> {
  const key = normalizeReactionPolicyKey(reactionKey);
  const all = await loadAllReactionPolicies(adapter);
  const next: ReactionPolicyMap = { ...(all[characterId] ?? {}), [key]: mode };
  const merged = { ...all, [characterId]: next };
  await adapter.setItem(REACTION_POLICY_STORAGE_KEY, merged);
  writeMirrorRaw(merged);
  return next;
}

/** Replaces a character's full policy map (used by reset flows). */
export async function saveReactionPolicyMap(
  characterId: string,
  map: ReactionPolicyMap,
  adapter: RosterStorageAdapter = defaultRosterStorageAdapter,
): Promise<ReactionPolicyMap> {
  const next = sanitizePolicyMap(map);
  const all = await loadAllReactionPolicies(adapter);
  const merged = { ...all, [characterId]: next };
  await adapter.setItem(REACTION_POLICY_STORAGE_KEY, merged);
  writeMirrorRaw(merged);
  return next;
}

// ---------------------------------------------------------------------------
// Prompt-flow decision (pure, engine-free).
// ---------------------------------------------------------------------------

export type ReactionPromptDecision =
  | { action: 'show' }
  | { action: 'auto'; reactionId: string; slotLevel?: number }
  | { action: 'pass' };

/**
 * Decides how a `PendingReactionPrompt` resolves under a character's policy
 * map (missing entries default to `ask`):
 * - first `auto` option in prompt order wins (with its `slotLevel`);
 * - `pass` only when every option is `off`;
 * - otherwise the modal stays (`show`) so the player can choose.
 */
export function decideReactionPromptAction(
  prompt: PendingReactionPrompt,
  policies: ReactionPolicyMap,
): ReactionPromptDecision {
  let allOff = true;
  for (const option of prompt.availableReactions) {
    const mode = policies[normalizeReactionPolicyKey(option.id)] ?? 'ask';
    if (mode === 'auto') {
      return {
        action: 'auto',
        reactionId: option.id,
        ...(option.slotLevel !== undefined ? { slotLevel: option.slotLevel } : {}),
      };
    }
    if (mode !== 'off') allOff = false;
  }
  if (allOff && prompt.availableReactions.length > 0) return { action: 'pass' };
  return { action: 'show' };
}

/**
 * Convenience wrapper: decides for a reactor character id using the sync
 * mirror (defaults to `show` when no policies are stored).
 */
export function decideReactionPromptActionForCharacter(
  prompt: PendingReactionPrompt,
  characterId: string,
): ReactionPromptDecision {
  return decideReactionPromptAction(prompt, getReactionPoliciesForCharacterSync(characterId));
}
