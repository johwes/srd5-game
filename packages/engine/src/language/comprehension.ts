import type { Combatant } from '../combat/types.js';

/**
 * SRD-1201: Language comprehension buff markers (Spec 11 §2.1).
 *
 * `comprehend-languages` and `tongues` resolve as executable overlays via the
 * same `apply_active_effect` attach path as `bless`. The resulting buffs are
 * consumed by the party-level language gate resolution (§2.2, SRD-1202).
 */
export const COMPREHEND_LANGUAGES_BUFF_ID = 'comprehend-languages-understanding' as const;
export const TONGUES_BUFF_ID = 'tongues-understanding' as const;

/** Active-effect ids that grant magical language comprehension. */
export const COMPREHENSION_BUFF_IDS = [
  COMPREHEND_LANGUAGES_BUFF_ID,
  TONGUES_BUFF_ID,
] as const;

export type ComprehensionBuffId = (typeof COMPREHENSION_BUFF_IDS)[number];

const COMPREHENSION_BUFF_SET: ReadonlySet<string> = new Set(COMPREHENSION_BUFF_IDS);

/**
 * Minimal language-bearing surface shared by derived sheets, combatants,
 * dungeon party members, and unit-test fixtures.
 */
export interface LanguageBearer {
  readonly languages?: readonly string[] | undefined;
  readonly activeEffects?: readonly { readonly effectId: string }[] | undefined;
  readonly isDead?: boolean | undefined;
  readonly currentHp?: number | undefined;
  readonly isConscious?: boolean | undefined;
  readonly conditions?: readonly string[] | undefined;
}

const UNCONSCIOUS_CONDITIONS: ReadonlySet<string> = new Set([
  'unconscious',
  'incapacitated',
]);

function normalizeLanguageId(id: string): string {
  return id.trim().toLowerCase();
}

/** Returns false for dead / zero-HP / unconscious bearers. */
export function isBearerConscious(bearer: LanguageBearer): boolean {
  if (bearer.isConscious === false) return false;
  if (bearer.isDead === true) return false;
  if (bearer.currentHp !== undefined && bearer.currentHp <= 0) return false;
  if (bearer.conditions?.some((c) => UNCONSCIOUS_CONDITIONS.has(normalizeLanguageId(c)))) {
    return false;
  }
  return true;
}

/** True when the bearer natively speaks `languageId` (case-insensitive). */
export function speaksLanguage(bearer: LanguageBearer, languageId: string): boolean {
  const want = normalizeLanguageId(languageId);
  if (!want) return false;
  return (bearer.languages ?? []).some((l) => normalizeLanguageId(l) === want);
}

/** True when the bearer carries a live comprehension buff. */
export function hasComprehensionMagic(bearer: LanguageBearer): boolean {
  return (bearer.activeEffects ?? []).some((e) => COMPREHENSION_BUFF_SET.has(e.effectId));
}

/**
 * Single-bearer comprehension check: native speaker OR comprehension magic.
 * Unconscious bearers understand nothing.
 */
export function bearerCanUnderstand(bearer: LanguageBearer, languageId: string): boolean {
  if (!isBearerConscious(bearer)) return false;
  if (speaksLanguage(bearer, languageId)) return true;
  return hasComprehensionMagic(bearer);
}

export type LanguageGateVia = 'native' | 'magic' | 'none';

export interface PartyComprehensionResult {
  readonly understood: boolean;
  /** How the gate opened: a native speaker, comprehension magic, or not at all. */
  readonly via: LanguageGateVia;
  /** Index of the first party member that opened the gate (-1 when closed). */
  readonly understoodByIndex: number;
}

/**
 * Party-level language gate resolution (Spec 11 §2.2 foundation).
 *
 * If any conscious party member in the scene speaks the language — or is
 * under `comprehend-languages` / `tongues` — the gate opens. Callers map the
 * `none` outcome to their `fallback` (`gesture` | `hostile` | `fetch_translator`).
 */
export function partyCanUnderstand(
  requiredLanguage: string,
  party: readonly LanguageBearer[],
): PartyComprehensionResult {
  const want = normalizeLanguageId(requiredLanguage);
  if (!want) return { understood: false, via: 'none', understoodByIndex: -1 };

  // Native speakers take precedence over magical comprehension.
  for (let i = 0; i < party.length; i++) {
    const member = party[i]!;
    if (!isBearerConscious(member)) continue;
    if (speaksLanguage(member, want)) {
      return { understood: true, via: 'native', understoodByIndex: i };
    }
  }
  for (let i = 0; i < party.length; i++) {
    const member = party[i]!;
    if (!isBearerConscious(member)) continue;
    if (hasComprehensionMagic(member)) {
      return { understood: true, via: 'magic', understoodByIndex: i };
    }
  }
  return { understood: false, via: 'none', understoodByIndex: -1 };
}

/**
 * Extracts the spoken-language list for a combatant from its derived sheet
 * (heroes) or monster statblock (monsters), for gate checks.
 */
export function combatantLanguages(combatant: Combatant): string[] {
  const fromSheet = combatant.characterSheet?.proficiencies?.languages;
  if (fromSheet && fromSheet.length > 0) return [...fromSheet];
  const fromMonster = combatant.monsterData?.languages;
  if (fromMonster && fromMonster.length > 0) return [...fromMonster];
  return [];
}

/** Combatant-level comprehension check (conscious + native speaker or magic). */
export function combatantCanUnderstand(combatant: Combatant, languageId: string): boolean {
  return bearerCanUnderstand(
    {
      languages: combatantLanguages(combatant),
      activeEffects: combatant.activeEffects,
      isDead: combatant.isDead,
      currentHp: combatant.currentHp,
      conditions: combatant.conditions,
    },
    languageId,
  );
}

/**
 * Party-of-combatants gate check. Dead / zero-HP / unconscious combatants
 * cannot open the gate.
 */
export function combatPartyCanUnderstand(
  requiredLanguage: string,
  party: readonly Combatant[],
): PartyComprehensionResult {
  return partyCanUnderstand(
    requiredLanguage,
    party.map((c) => ({
      languages: combatantLanguages(c),
      activeEffects: c.activeEffects,
      isDead: c.isDead,
      currentHp: c.currentHp,
      conditions: c.conditions,
    })),
  );
}
