import {
  type SrdCompendium,
  type CharacterBuildState,
  defaultCompendium,
} from '@srd5/data';

export const MAX_ATTUNED_ITEMS = 3 as const;

export interface CanAttuneResult {
  canAttune: boolean;
  reason?: string | undefined;
}

const SPELLCASTER_CLASSES = new Set([
  'bard',
  'cleric',
  'druid',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
  'wizard',
]);

/**
 * Checks whether a character meets the spellcaster prerequisite for magic item attunement.
 */
export function isCharacterSpellcaster(character: CharacterBuildState): boolean {
  if (character.classes.some((c) => SPELLCASTER_CLASSES.has(c.classId))) {
    return true;
  }
  if (
    character.spellcasting.knownCantripIds.length > 0 ||
    character.spellcasting.knownSpellIds.length > 0 ||
    character.spellcasting.preparedSpellIds.length > 0 ||
    character.spellcasting.spellbookSpellIds.length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Validates whether a character can attune to a specific magic item instance in their inventory.
 * Enforces SRD 5.1 rules:
 * 1. Must be in inventory.
 * 2. Must require attunement.
 * 3. Max 3 attuned items per character.
 * 4. Not already attuned.
 * 5. Satisfies any class, spellcaster, or alignment restrictions.
 */
export function canAttuneMagicItem(
  character: CharacterBuildState,
  itemInstanceId: string,
  compendium: SrdCompendium = defaultCompendium,
): CanAttuneResult {
  const invItem = character.inventory.find((i) => i.instanceId === itemInstanceId);
  if (!invItem) {
    return { canAttune: false, reason: 'Item is not in character inventory.' };
  }

  const magicItem = compendium.getMagicItem(invItem.itemId);
  if (!magicItem) {
    return { canAttune: false, reason: 'Item is not a recognized magic item.' };
  }

  if (!magicItem.requiresAttunement) {
    return { canAttune: false, reason: 'Item does not require attunement.' };
  }

  if (character.attunedItemInstanceIds.includes(itemInstanceId)) {
    return { canAttune: false, reason: 'Character is already attuned to this item.' };
  }

  if (character.attunedItemInstanceIds.length >= MAX_ATTUNED_ITEMS) {
    return {
      canAttune: false,
      reason: `Cannot exceed maximum of ${MAX_ATTUNED_ITEMS} attuned magic items (SRD 5.1).`,
    };
  }

  // Evaluate attunement restrictions (e.g. "requires attunement by a spellcaster")
  if (magicItem.attunementRestriction) {
    const restriction = magicItem.attunementRestriction.toLowerCase();

    if (restriction.includes('spellcaster') && !isCharacterSpellcaster(character)) {
      return {
        canAttune: false,
        reason: `Item requires attunement by a spellcaster (${magicItem.attunementRestriction}).`,
      };
    }

    // Check specific class restrictions (e.g. "cleric, druid, or paladin")
    for (const className of [
      'barbarian',
      'bard',
      'cleric',
      'druid',
      'fighter',
      'monk',
      'paladin',
      'ranger',
      'rogue',
      'sorcerer',
      'warlock',
      'wizard',
    ]) {
      if (restriction.includes(className)) {
        const hasClass = character.classes.some((c) => c.classId === className);
        if (!hasClass) {
          // If the restriction specifies multiple classes (e.g. "cleric or paladin"), check if any match
          const allowedClasses = ['cleric', 'druid', 'paladin', 'wizard', 'sorcerer', 'warlock', 'bard', 'ranger', 'barbarian', 'fighter', 'monk', 'rogue'].filter((c) =>
            restriction.includes(c),
          );
          const meetsAny = character.classes.some((c) => allowedClasses.includes(c.classId));
          if (!meetsAny) {
            return {
              canAttune: false,
              reason: `Item requires attunement by: ${magicItem.attunementRestriction}.`,
            };
          }
        }
      }
    }
  }

  return { canAttune: true };
}

/**
 * Attunes a character to a magic item instance in their inventory.
 * Throws if the character does not qualify or has already reached the maximum of 3 attuned items.
 */
export function attuneMagicItem(
  character: CharacterBuildState,
  itemInstanceId: string,
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuildState {
  const check = canAttuneMagicItem(character, itemInstanceId, compendium);
  if (!check.canAttune) {
    throw new Error(`Cannot attune to item ${itemInstanceId}: ${check.reason}`);
  }

  return {
    ...character,
    attunedItemInstanceIds: [...character.attunedItemInstanceIds, itemInstanceId],
  };
}

/**
 * Unattunes a character from a magic item instance.
 */
export function unattuneMagicItem(
  character: CharacterBuildState,
  itemInstanceId: string,
): CharacterBuildState {
  return {
    ...character,
    attunedItemInstanceIds: character.attunedItemInstanceIds.filter((id) => id !== itemInstanceId),
  };
}

/**
 * Toggles attunement state for a magic item in a character's inventory.
 * Unattunes if currently attuned; attunes if eligible.
 */
export function toggleMagicItemAttunement(
  character: CharacterBuildState,
  itemInstanceId: string,
  compendium: SrdCompendium = defaultCompendium,
): CharacterBuildState {
  if (character.attunedItemInstanceIds.includes(itemInstanceId)) {
    return unattuneMagicItem(character, itemInstanceId);
  }
  return attuneMagicItem(character, itemInstanceId, compendium);
}
