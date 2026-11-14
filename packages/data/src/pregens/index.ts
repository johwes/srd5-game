import { z } from 'zod';
import { type SrdCompendium, defaultCompendium } from '../compendium/compendium.js';
import {
  containsProductIdentityProperName,
  isProhibitedMonsterId,
} from '../ingestion/index.js';
import {
  type CharacterBuildState,
  CharacterBuildStateSchema,
} from '../schemas/character.js';
import pregensJson from '../srd/pregens.json' with { type: 'json' };

/**
 * Canonical IDs for the 4 pre-generated Level 1 SRD 5.1 iconic party members.
 */
export const ICONIC_PARTY_IDS = [
  'pregen-fighter',
  'pregen-wizard',
  'pregen-cleric',
  'pregen-rogue',
] as const;

export const IconicPartyMemberIdSchema = z.enum(ICONIC_PARTY_IDS);
export type IconicPartyMemberId = z.infer<typeof IconicPartyMemberIdSchema>;

/**
 * Canonical class IDs represented in the 4-hero iconic party.
 */
export const ICONIC_PARTY_CLASS_IDS = [
  'fighter',
  'wizard',
  'cleric',
  'rogue',
] as const;
export type IconicPartyClassId = (typeof ICONIC_PARTY_CLASS_IDS)[number];

/**
 * UI & lobby metadata for an iconic party archetype.
 */
export interface IconicPartyMemberMetadata {
  id: IconicPartyMemberId;
  name: string;
  classId: IconicPartyClassId;
  raceId: string;
  subraceId?: string;
  roleTitle: string;
  summary: string;
  tacticalHighlights: readonly string[];
}

/**
 * Rich descriptive metadata for the 4 iconic party members used in Quick-Start,
 * Lobby Slot Assignment, and Character Builder templates.
 */
export const ICONIC_PARTY_METADATA: Readonly<
  Record<IconicPartyMemberId, IconicPartyMemberMetadata>
> = {
  'pregen-fighter': {
    id: 'pregen-fighter',
    name: 'Garrick Vance',
    classId: 'fighter',
    raceId: 'human',
    roleTitle: 'Frontline Martial Defender',
    summary:
      'A disciplined Human Fighter clad in chain mail with sword and shield, trained to hold narrow dungeon chokepoints and protect the party backline.',
    tacticalHighlights: [
      'AC 19 with Chain Mail, Shield, and Defense Fighting Style',
      'Second Wind (1d10 + 1 bonus action self-heal, recharges on Short Rest)',
      'Versatile Longsword (+5 to hit, 1d8+3 slashing) and thrown Handaxes',
    ],
  },
  'pregen-wizard': {
    id: 'pregen-wizard',
    name: 'Lyra Silversun',
    classId: 'wizard',
    raceId: 'elf',
    subraceId: 'high-elf',
    roleTitle: 'Arcane Blaster & Battlefield Controller',
    summary:
      'A keen-minded High Elf Wizard armed with offensive evocations, crowd control, and protective abjurations drawn from her spellbook.',
    tacticalHighlights: [
      '4 Cantrips including Fire Bolt (1d10 fire) and Ray of Frost (1d8 cold + slow)',
      'Prepared Magic Missile, Burning Hands, Sleep, Mage Armor, and Shield reaction',
      'Arcane Recovery restores 1 expended 1st-level spell slot on a Short Rest',
    ],
  },
  'pregen-cleric': {
    id: 'pregen-cleric',
    name: 'Bram Ironheart',
    classId: 'cleric',
    raceId: 'dwarf',
    subraceId: 'hill-dwarf',
    roleTitle: 'Divine Healer & Armored Support',
    summary:
      'A resilient Hill Dwarf Life Domain Cleric who bolsters allies with divine blessings while restoring extra hit points with every healing spell.',
    tacticalHighlights: [
      'AC 18 in heavy Chain Mail and Shield with Dwarven Toughness (+1 HP/level)',
      'Disciple of Life adds +2 + spell level HP to Cure Wounds and Healing Word',
      'Always-prepared Bless and Cure Wounds plus Guiding Bolt and Sacred Flame',
    ],
  },
  'pregen-rogue': {
    id: 'pregen-rogue',
    name: 'Vex Tealeaf',
    classId: 'rogue',
    raceId: 'halfling',
    subraceId: 'lightfoot-halfling',
    roleTitle: 'Stealth Scout, Trapfinder & Striker',
    summary:
      'A nimble Lightfoot Halfling Rogue with Expertise in Stealth and Thieves’ Tools, dealing precision Sneak Attack damage from the shadows.',
    tacticalHighlights: [
      'Expertise (+7 bonus) in both Stealth and Thieves’ Tools for locks and traps',
      'Sneak Attack (+1d6 damage) with Rapier or Shortbow when an ally is adjacent or with Advantage',
      'Halfling Lucky re-rolls natural 1s on attack rolls, ability checks, and saving throws',
    ],
  },
};

/**
 * Zod schema for the bundled array of pre-generated `CharacterBuildState` records.
 */
export const PregenCharacterListSchema = z.array(CharacterBuildStateSchema).length(4);

/**
 * Bundled, immutable array of the 4 pre-generated Level 1 SRD 5.1 iconic party members.
 */
export const BUNDLED_PREGEN_CHARACTERS: readonly CharacterBuildState[] = Object.freeze(
  PregenCharacterListSchema.parse(pregensJson).map((char) => Object.freeze(char)),
);

/**
 * Alias for `BUNDLED_PREGEN_CHARACTERS`.
 */
export const ICONIC_PARTY_MEMBERS: readonly CharacterBuildState[] = BUNDLED_PREGEN_CHARACTERS;

const pregenByIdMap = new Map<string, CharacterBuildState>(
  BUNDLED_PREGEN_CHARACTERS.map((char) => [char.id, char]),
);

const pregenByClassMap = new Map<string, CharacterBuildState>(
  BUNDLED_PREGEN_CHARACTERS.map((char) => [char.classes[0]!.classId, char]),
);

/**
 * Looks up a pre-generated character by canonical ID (`pregen-fighter`, `pregen-wizard`,
 * `pregen-cleric`, `pregen-rogue`) and returns a deep clone safe for mutation.
 */
export function getPregenCharacter(id: string): CharacterBuildState | undefined {
  const found = pregenByIdMap.get(id);
  return found ? structuredClone(found) : undefined;
}

/**
 * Strictly looks up a pre-generated character by canonical ID and returns a deep clone.
 * Throws a descriptive error if the ID is unknown.
 */
export function requirePregenCharacter(id: string): CharacterBuildState {
  const found = getPregenCharacter(id);
  if (!found) {
    throw new Error(
      `Unknown pre-generated character ID "${id}". Expected one of: ${ICONIC_PARTY_IDS.join(', ')}`,
    );
  }
  return found;
}

/**
 * Looks up a pre-generated iconic party member by primary class ID
 * (`fighter`, `wizard`, `cleric`, `rogue`) and returns a deep clone.
 */
export function getPregenCharacterByClass(classId: string): CharacterBuildState | undefined {
  const found = pregenByClassMap.get(classId);
  return found ? structuredClone(found) : undefined;
}

/**
 * Options for instantiating a fresh 4-hero iconic party for a campaign or skirmish.
 */
export interface CreateIconicPartyOptions {
  /**
   * Optional player IDs to assign to each party slot in canonical order
   * (or keyed by `IconicPartyMemberId`).
   */
  playerIds?: readonly string[] | Partial<Record<IconicPartyMemberId, string>>;
}

/**
 * Returns a fresh deep-cloned array of all 4 Level 1 iconic party `CharacterBuildState`
 * records, optionally stamped with `playerId` assignments.
 */
export function createIconicPartyStates(
  options?: CreateIconicPartyOptions,
): CharacterBuildState[] {
  return BUNDLED_PREGEN_CHARACTERS.map((template, index) => {
    const cloned = structuredClone(template);
    const playerIds = options?.playerIds;
    if (Array.isArray(playerIds)) {
      const pid = playerIds[index];
      if (pid) {
        cloned.playerId = pid;
      }
    } else if (playerIds && typeof playerIds === 'object') {
      const map = playerIds as Partial<Record<IconicPartyMemberId, string>>;
      const pid = map[cloned.id as IconicPartyMemberId];
      if (pid) {
        cloned.playerId = pid;
      }
    }
    return cloned;
  });
}

/**
 * Validation issue reported by `validatePregenCharacters()`.
 */
export interface PregenValidationError {
  characterId: string;
  field: string;
  message: string;
}

/**
 * Validation report returned by `validatePregenCharacters()`.
 */
export interface PregenValidationReport {
  valid: boolean;
  errors: PregenValidationError[];
}

/**
 * Validates an array of pre-generated `CharacterBuildState` records against the
 * SRD 5.1 Compendium for schema conformance, referential integrity, equipment
 * slot consistency, and CC-BY-4.0 Product Identity guardrails.
 */
export function validatePregenCharacters(
  pregens: readonly CharacterBuildState[] = BUNDLED_PREGEN_CHARACTERS,
  compendium: SrdCompendium = defaultCompendium,
): PregenValidationReport {
  const errors: PregenValidationError[] = [];
  const seenIds = new Set<string>();

  for (const rawChar of pregens) {
    const parsed = CharacterBuildStateSchema.safeParse(rawChar);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          characterId: rawChar?.id ?? '<unknown>',
          field: issue.path.join('.') || 'root',
          message: issue.message,
        });
      }
      continue;
    }

    const char = parsed.data;
    if (seenIds.has(char.id)) {
      errors.push({
        characterId: char.id,
        field: 'id',
        message: `Duplicate pre-generated character ID "${char.id}"`,
      });
    }
    seenIds.add(char.id);

    // Check prohibited Product Identity terms in character name
    const nameTokens = char.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (
      containsProductIdentityProperName(char.name) ||
      nameTokens.some((token) => isProhibitedMonsterId(token))
    ) {
      errors.push({
        characterId: char.id,
        field: 'name',
        message: `Character name "${char.name}" contains a prohibited Product Identity term`,
      });
    }

    // 1. Race & Subrace references
    const race = compendium.getRace(char.raceId);
    if (!race) {
      errors.push({
        characterId: char.id,
        field: 'raceId',
        message: `Unknown raceId "${char.raceId}"`,
      });
    }
    if (char.subraceId) {
      const subrace = compendium.getSubrace(char.subraceId);
      if (!subrace) {
        errors.push({
          characterId: char.id,
          field: 'subraceId',
          message: `Unknown subraceId "${char.subraceId}"`,
        });
      } else if (subrace.parentRaceId !== char.raceId) {
        errors.push({
          characterId: char.id,
          field: 'subraceId',
          message: `Subrace "${char.subraceId}" belongs to race "${subrace.parentRaceId}", not "${char.raceId}"`,
        });
      }
    }

    // 2. Background reference
    if (!compendium.getBackground(char.backgroundId)) {
      errors.push({
        characterId: char.id,
        field: 'backgroundId',
        message: `Unknown backgroundId "${char.backgroundId}"`,
      });
    }

    // 3. Classes & Subclasses references
    for (const clsEntry of char.classes) {
      const clsData = compendium.getClass(clsEntry.classId);
      if (!clsData) {
        errors.push({
          characterId: char.id,
          field: 'classes.classId',
          message: `Unknown classId "${clsEntry.classId}"`,
        });
      }
      if (clsEntry.subclassId) {
        const scData = compendium.getSubclass(clsEntry.subclassId);
        if (!scData) {
          errors.push({
            characterId: char.id,
            field: 'classes.subclassId',
            message: `Unknown subclassId "${clsEntry.subclassId}"`,
          });
        } else if (scData.classId !== clsEntry.classId) {
          errors.push({
            characterId: char.id,
            field: 'classes.subclassId',
            message: `Subclass "${clsEntry.subclassId}" belongs to class "${scData.classId}", not "${clsEntry.classId}"`,
          });
        }
      }
    }

    // 4. Inventory items & Equipped slots
    const inventoryByInstanceId = new Map(
      char.inventory.map((item) => [item.instanceId, item]),
    );
    for (const item of char.inventory) {
      const exists = item.isMagicItem
        ? compendium.getMagicItem(item.itemId) !== undefined
        : compendium.getEquipment(item.itemId) !== undefined;
      if (!exists) {
        errors.push({
          characterId: char.id,
          field: `inventory.${item.instanceId}`,
          message: `Unknown itemId "${item.itemId}" in inventory instance "${item.instanceId}"`,
        });
      }
    }

    for (const [slotName, instanceId] of Object.entries(char.equippedSlots)) {
      if (!instanceId) continue;
      const invItem = inventoryByInstanceId.get(instanceId);
      if (!invItem) {
        errors.push({
          characterId: char.id,
          field: `equippedSlots.${slotName}`,
          message: `Equipped slot "${slotName}" references missing inventory instanceId "${instanceId}"`,
        });
        continue;
      }

      const eqData = compendium.getEquipment(invItem.itemId);
      if (slotName === 'armorInstanceId') {
        if (!eqData || eqData.kind !== 'armor' || eqData.category === 'shield') {
          errors.push({
            characterId: char.id,
            field: `equippedSlots.${slotName}`,
            message: `Equipped armor slot "${instanceId}" ("${invItem.itemId}") is not body armor`,
          });
        }
      } else if (slotName === 'shieldInstanceId') {
        if (!eqData || eqData.kind !== 'armor' || eqData.category !== 'shield') {
          errors.push({
            characterId: char.id,
            field: `equippedSlots.${slotName}`,
            message: `Equipped shield slot "${instanceId}" ("${invItem.itemId}") is not a shield`,
          });
        }
      } else if (
        slotName === 'mainHandInstanceId' ||
        slotName === 'offHandInstanceId' ||
        slotName === 'rangedInstanceId'
      ) {
        if (!eqData || eqData.kind !== 'weapon') {
          errors.push({
            characterId: char.id,
            field: `equippedSlots.${slotName}`,
            message: `Equipped weapon slot "${slotName}" ("${invItem.itemId}") is not a weapon`,
          });
        }
      }
    }

    // 5. Spellcasting references
    for (const spellId of char.spellcasting.knownCantripIds) {
      const spell = compendium.getSpell(spellId);
      if (!spell) {
        errors.push({
          characterId: char.id,
          field: 'spellcasting.knownCantripIds',
          message: `Unknown cantrip spellId "${spellId}"`,
        });
      } else if (spell.level !== 0) {
        errors.push({
          characterId: char.id,
          field: 'spellcasting.knownCantripIds',
          message: `Spell "${spellId}" in knownCantripIds has level ${spell.level} (expected 0)`,
        });
      }
    }

    for (const [listName, spellIds] of [
      ['knownSpellIds', char.spellcasting.knownSpellIds],
      ['spellbookSpellIds', char.spellcasting.spellbookSpellIds],
      ['preparedSpellIds', char.spellcasting.preparedSpellIds],
    ] as const) {
      for (const spellId of spellIds) {
        const spell = compendium.getSpell(spellId);
        if (!spell) {
          errors.push({
            characterId: char.id,
            field: `spellcasting.${listName}`,
            message: `Unknown spellId "${spellId}" in ${listName}`,
          });
        } else if (spell.level < 1) {
          errors.push({
            characterId: char.id,
            field: `spellcasting.${listName}`,
            message: `Cantrip "${spellId}" should not appear in ${listName}`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
