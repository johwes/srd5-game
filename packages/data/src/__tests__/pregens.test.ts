import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PREGEN_CHARACTERS,
  CharacterBuildStateSchema,
  ICONIC_PARTY_CLASS_IDS,
  ICONIC_PARTY_IDS,
  ICONIC_PARTY_MEMBERS,
  ICONIC_PARTY_METADATA,
  compendium,
  createIconicPartyStates,
  getPregenCharacter,
  getPregenCharacterByClass,
  requirePregenCharacter,
  validatePregenCharacters,
} from '../index.js';

describe('SRD-206: Pre-generated SRD 5.1 Iconic Party Members (@srd5/data)', () => {
  it('bundles all 4 iconic Level 1 party members (Fighter, Wizard, Cleric, Rogue)', () => {
    expect(BUNDLED_PREGEN_CHARACTERS).toHaveLength(4);
    expect(ICONIC_PARTY_MEMBERS).toBe(BUNDLED_PREGEN_CHARACTERS);
    expect(BUNDLED_PREGEN_CHARACTERS.map((c) => c.id)).toEqual([...ICONIC_PARTY_IDS]);
    expect(BUNDLED_PREGEN_CHARACTERS.map((c) => c.classes[0]?.classId)).toEqual([
      ...ICONIC_PARTY_CLASS_IDS,
    ]);

    for (const char of BUNDLED_PREGEN_CHARACTERS) {
      expect(() => CharacterBuildStateSchema.parse(char)).not.toThrow();
      expect(char.classes).toHaveLength(1);
      expect(char.classes[0]?.level).toBe(1);
      expect(char.abilityMethod).toBe('standard_array');
      expect(char.runtime.xp).toBe(0);
      expect(char.runtime.currentHp).toBeGreaterThan(0);

      const meta = ICONIC_PARTY_METADATA[char.id as keyof typeof ICONIC_PARTY_METADATA];
      expect(meta).toBeDefined();
      expect(meta.name).toBe(char.name);
      expect(meta.classId).toBe(char.classes[0]?.classId);
      expect(meta.raceId).toBe(char.raceId);
      expect(meta.subraceId).toBe(char.subraceId);
      expect(meta.tacticalHighlights.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('passes validatePregenCharacters with 0 errors against the SRD 5.1 Compendium', () => {
    const report = validatePregenCharacters(BUNDLED_PREGEN_CHARACTERS, compendium);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('provides deep-cloned characters via getPregenCharacter, requirePregenCharacter,getPregenCharacterByClass, and createIconicPartyStates', () => {
    const fighter1 = requirePregenCharacter('pregen-fighter');
    const fighter2 = getPregenCharacter('pregen-fighter');
    expect(fighter2).toBeDefined();
    expect(fighter1).toEqual(fighter2);
    expect(fighter1).not.toBe(fighter2);

    // Mutating returned clone never mutates the bundled singleton
    fighter1.name = 'Mutated Fighter';
    fighter1.runtime.currentHp = 1;
    expect(requirePregenCharacter('pregen-fighter').name).toBe('Garrick Vance');
    expect(requirePregenCharacter('pregen-fighter').runtime.currentHp).toBe(12);

    expect(getPregenCharacter('non-existent')).toBeUndefined();
    expect(() => requirePregenCharacter('non-existent')).toThrow(
      /Unknown pre-generated character ID/,
    );

    for (const classId of ICONIC_PARTY_CLASS_IDS) {
      const byClass = getPregenCharacterByClass(classId);
      expect(byClass).toBeDefined();
      expect(byClass?.classes[0]?.classId).toBe(classId);
    }
    expect(getPregenCharacterByClass('bard')).toBeUndefined();

    // Test createIconicPartyStates with array and record playerIds
    const partyWithArrayIds = createIconicPartyStates({
      playerIds: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(partyWithArrayIds.map((c) => c.playerId)).toEqual(['p1', 'p2', 'p3', 'p4']);

    const partyWithRecordIds = createIconicPartyStates({
      playerIds: {
        'pregen-fighter': 'host-player',
        'pregen-cleric': 'guest-player',
      },
    });
    expect(partyWithRecordIds[0]?.playerId).toBe('host-player');
    expect(partyWithRecordIds[1]?.playerId).toBeUndefined();
    expect(partyWithRecordIds[2]?.playerId).toBe('guest-player');
    expect(partyWithRecordIds[3]?.playerId).toBeUndefined();
  });

  it('detects invalid references, bad equipped slots, and prohibited Product Identity terms in validatePregenCharacters', () => {
    const brokenFighter = requirePregenCharacter('pregen-fighter');
    brokenFighter.name = 'Mordenkainen the Fighter';
    brokenFighter.raceId = 'unknown-race';
    brokenFighter.subraceId = 'high-elf';
    brokenFighter.backgroundId = 'unknown-bg';
    brokenFighter.equippedSlots.armorInstanceId = 'fighter-longsword'; // weapon in armor slot
    brokenFighter.equippedSlots.shieldInstanceId = 'missing-instance';
    brokenFighter.inventory.push({
      instanceId: 'bad-item',
      itemId: 'non-existent-sword',
      quantity: 1,
    });

    const brokenWizard = requirePregenCharacter('pregen-wizard');
    brokenWizard.spellcasting.knownCantripIds.push('magic-missile'); // level 1 spell in cantrips
    brokenWizard.spellcasting.preparedSpellIds.push('fire-bolt'); // cantrip in prepared spells
    brokenWizard.spellcasting.spellbookSpellIds.push('unknown-spell');

    const report = validatePregenCharacters([brokenFighter, brokenWizard], compendium);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.field === 'name')).toBe(true);
    expect(report.errors.some((e) => e.field === 'raceId')).toBe(true);
    expect(report.errors.some((e) => e.field === 'subraceId')).toBe(true);
    expect(report.errors.some((e) => e.field === 'backgroundId')).toBe(true);
    expect(report.errors.some((e) => e.field === 'equippedSlots.armorInstanceId')).toBe(true);
    expect(report.errors.some((e) => e.field === 'equippedSlots.shieldInstanceId')).toBe(true);
    expect(report.errors.some((e) => e.field === 'inventory.bad-item')).toBe(true);
    expect(report.errors.some((e) => e.field === 'spellcasting.knownCantripIds')).toBe(true);
    expect(report.errors.some((e) => e.field === 'spellcasting.preparedSpellIds')).toBe(true);
    expect(report.errors.some((e) => e.field === 'spellcasting.spellbookSpellIds')).toBe(true);
  });
});
