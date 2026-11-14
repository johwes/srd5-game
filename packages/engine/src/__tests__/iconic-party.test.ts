import {
  BUNDLED_PREGEN_CHARACTERS,
  compendium,
  createIconicPartyStates,
  requirePregenCharacter,
} from '@srd5/data';
import { describe, expect, it } from 'vitest';
import {
  DerivedCharacterSheetSchema,
  applyLevelUp,
  computeDerivedCharacter,
  validateAbilityGeneration,
  validateCharacterChoices,
} from '../index.js';

describe('SRD-206: Pre-generated SRD 5.1 Iconic Party Members (@srd5/engine integration)', () => {
  it('validates all 4 pre-generated characters through ability generation and strict choice validation', () => {
    for (const char of BUNDLED_PREGEN_CHARACTERS) {
      const abilityResult = validateAbilityGeneration({
        method: char.abilityMethod,
        baseAbilities: char.baseAbilities,
      });
      expect(abilityResult.valid, `Ability validation failed for ${char.id}`).toBe(true);
      expect(abilityResult.errors).toEqual([]);

      const choiceReport = validateCharacterChoices(char, compendium, {
        requireStartingEquipmentChoices: true,
        requireExpertiseChoices: true,
      });
      expect(
        choiceReport.errors,
        `Choice validation errors for ${char.id}: ${JSON.stringify(choiceReport.errors)}`,
      ).toEqual([]);
      expect(choiceReport.valid).toBe(true);
      expect(choiceReport.unresolvedDuplicates).toEqual([]);
    }
  });

  it('computes exact derived stats for Level 1 Fighter (Garrick Vance)', () => {
    const fighter = requirePregenCharacter('pregen-fighter');
    const sheet = computeDerivedCharacter(fighter, compendium);
    expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();

    expect(sheet.name).toBe('Garrick Vance');
    expect(sheet.totalLevel).toBe(1);
    expect(sheet.proficiencyBonus).toBe(2);
    expect(sheet.size).toBe('medium');
    expect(sheet.speedFeet).toBe(30);

    // Human (+1 to all 6 abilities): 15/13/14/10/12/8 -> 16/14/15/11/13/9
    expect(sheet.abilities.str.score).toBe(16);
    expect(sheet.abilities.str.modifier).toBe(3);
    expect(sheet.abilities.dex.score).toBe(14);
    expect(sheet.abilities.dex.modifier).toBe(2);
    expect(sheet.abilities.con.score).toBe(15);
    expect(sheet.abilities.con.modifier).toBe(2);
    expect(sheet.abilities.int.score).toBe(11);
    expect(sheet.abilities.int.modifier).toBe(0);
    expect(sheet.abilities.wis.score).toBe(13);
    expect(sheet.abilities.wis.modifier).toBe(1);
    expect(sheet.abilities.cha.score).toBe(9);
    expect(sheet.abilities.cha.modifier).toBe(-1);

    // HP: 10 (Fighter d10) + 2 (CON) = 12
    expect(sheet.maxHp).toBe(12);
    expect(sheet.currentHp).toBe(12);

    // AC: 16 (Chain Mail) + 2 (Shield) + 1 (Defense Fighting Style) = 19
    expect(sheet.armorClass.totalAc).toBe(19);
    expect(sheet.armorClass.baseAc).toBe(16);
    expect(sheet.armorClass.shieldBonus).toBe(2);
    expect(sheet.armorClass.stealthDisadvantage).toBe(true);

    // Proficiencies & Skills: Athletics, Perception (Fighter) + Insight, Religion (Acolyte)
    expect(sheet.savingThrows.str.proficient).toBe(true);
    expect(sheet.savingThrows.str.totalBonus).toBe(5);
    expect(sheet.savingThrows.con.proficient).toBe(true);
    expect(sheet.savingThrows.con.totalBonus).toBe(4);
    expect(sheet.skills.athletics.totalBonus).toBe(5);
    expect(sheet.skills.perception.totalBonus).toBe(3);
    expect(sheet.skills.insight.totalBonus).toBe(3);
    expect(sheet.skills.religion.totalBonus).toBe(2);

    // Weapon Attacks: Longsword (+5 to hit, 1d8+3) & Handaxe (+5 to hit, 1d6+3)
    const longsword = sheet.weaponAttacks.find((w) => w.weaponId === 'longsword');
    expect(longsword).toBeDefined();
    expect(longsword?.toHitBonus).toBe(5);
    expect(longsword?.damageBonus).toBe(3);

    // Resources: Second Wind (1 charge, short rest)
    expect(sheet.resources['second_wind']?.max).toBe(1);
    expect(sheet.resources['second_wind']?.recovery).toBe('short_rest');
    expect(sheet.spellcasting.isSpellcaster).toBe(false);
  });

  it('computes exact derived stats for Level 1 Wizard (Lyra Silversun)', () => {
    const wizard = requirePregenCharacter('pregen-wizard');
    const sheet = computeDerivedCharacter(wizard, compendium);
    expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();

    expect(sheet.name).toBe('Lyra Silversun');
    expect(sheet.totalLevel).toBe(1);
    expect(sheet.proficiencyBonus).toBe(2);
    expect(sheet.senses.darkvisionFeet).toBe(60);

    // High Elf (+2 DEX, +1 INT): 8/14/13/15/12/10 -> 8/16/13/16/12/10
    expect(sheet.abilities.str.score).toBe(8);
    expect(sheet.abilities.dex.score).toBe(16);
    expect(sheet.abilities.dex.modifier).toBe(3);
    expect(sheet.abilities.con.score).toBe(13);
    expect(sheet.abilities.con.modifier).toBe(1);
    expect(sheet.abilities.int.score).toBe(16);
    expect(sheet.abilities.int.modifier).toBe(3);
    expect(sheet.abilities.wis.score).toBe(12);
    expect(sheet.abilities.wis.modifier).toBe(1);

    // HP: 6 (Wizard d6) + 1 (CON) = 7
    expect(sheet.maxHp).toBe(7);
    expect(sheet.currentHp).toBe(7);

    // AC: Unarmored 10 + 3 (DEX) = 13
    expect(sheet.armorClass.totalAc).toBe(13);
    expect(sheet.armorClass.stealthDisadvantage).toBe(false);

    // Spellcasting: INT +3, Prof +2 -> DC 13, Attack +5, 2 L1 slots, 4 cantrips (3 Wizard + 1 High Elf)
    expect(sheet.spellcasting.isSpellcaster).toBe(true);
    expect(sheet.spellcasting.primaryAbility).toBe('int');
    expect(sheet.spellcasting.primarySpellSaveDc).toBe(13);
    expect(sheet.spellcasting.primarySpellAttackBonus).toBe(5);
    expect(sheet.spellcasting.spellSlots[1].max).toBe(2);
    expect(sheet.spellcasting.cantripIds).toEqual(
      expect.arrayContaining(['fire-bolt', 'mage-hand', 'light', 'ray-of-frost']),
    );
    expect(sheet.spellcasting.spellbookSpellIds).toHaveLength(6);
    expect(sheet.spellcasting.preparedOrKnownSpellIds).toEqual([
      'magic-missile',
      'mage-armor',
      'shield',
      'burning-hands',
    ]);
  });

  it('computes exact derived stats for Level 1 Cleric (Bram Ironheart)', () => {
    const cleric = requirePregenCharacter('pregen-cleric');
    const sheet = computeDerivedCharacter(cleric, compendium);
    expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();

    expect(sheet.name).toBe('Bram Ironheart');
    expect(sheet.totalLevel).toBe(1);
    expect(sheet.speedFeet).toBe(25);
    expect(sheet.senses.darkvisionFeet).toBe(60);
    expect(sheet.damageResistances).toContain('poison');

    // Hill Dwarf (+2 CON, +1 WIS): 14/10/13/8/15/12 -> 14/10/15/8/16/12
    expect(sheet.abilities.str.score).toBe(14);
    expect(sheet.abilities.str.modifier).toBe(2);
    expect(sheet.abilities.con.score).toBe(15);
    expect(sheet.abilities.con.modifier).toBe(2);
    expect(sheet.abilities.wis.score).toBe(16);
    expect(sheet.abilities.wis.modifier).toBe(3);

    // HP: 8 (Cleric d8) + 2 (CON) + 1 (Dwarven Toughness) = 11
    expect(sheet.maxHp).toBe(11);
    expect(sheet.currentHp).toBe(11);

    // AC: 16 (Chain Mail, proficient via Life Domain Bonus Proficiency) + 2 (Shield) = 18
    expect(sheet.proficiencies.armor).toContain('heavy-armor');
    expect(sheet.armorClass.totalAc).toBe(18);

    // Spellcasting: WIS +3, Prof +2 -> DC 13, Attack +5, Life Domain always-prepared spells (bless, cure-wounds)
    expect(sheet.spellcasting.isSpellcaster).toBe(true);
    expect(sheet.spellcasting.primaryAbility).toBe('wis');
    expect(sheet.spellcasting.primarySpellSaveDc).toBe(13);
    expect(sheet.spellcasting.primarySpellAttackBonus).toBe(5);
    expect(sheet.spellcasting.spellSlots[1].max).toBe(2);
    expect(sheet.spellcasting.alwaysPreparedSpellIds).toEqual(
      expect.arrayContaining(['bless', 'cure-wounds']),
    );
    expect(sheet.spellcasting.preparedOrKnownSpellIds).toEqual(
      expect.arrayContaining([
        'bless',
        'cure-wounds',
        'healing-word',
        'guiding-bolt',
        'shield-of-faith',
        'sanctuary',
      ]),
    );
  });

  it('computes exact derived stats for Level 1 Rogue (Vex Tealeaf)', () => {
    const rogue = requirePregenCharacter('pregen-rogue');
    const sheet = computeDerivedCharacter(rogue, compendium);
    expect(() => DerivedCharacterSheetSchema.parse(sheet)).not.toThrow();

    expect(sheet.name).toBe('Vex Tealeaf');
    expect(sheet.totalLevel).toBe(1);
    expect(sheet.size).toBe('small');
    expect(sheet.speedFeet).toBe(25);

    // Lightfoot Halfling (+2 DEX, +1 CHA): 8/15/14/12/10/13 -> 8/17/14/12/10/14
    expect(sheet.abilities.dex.score).toBe(17);
    expect(sheet.abilities.dex.modifier).toBe(3);
    expect(sheet.abilities.con.score).toBe(14);
    expect(sheet.abilities.con.modifier).toBe(2);
    expect(sheet.abilities.cha.score).toBe(14);
    expect(sheet.abilities.cha.modifier).toBe(2);

    // HP: 8 (Rogue d8) + 2 (CON) = 10
    expect(sheet.maxHp).toBe(10);
    expect(sheet.currentHp).toBe(10);

    // AC: 11 (Leather Armor) + 3 (DEX) = 14
    expect(sheet.armorClass.totalAc).toBe(14);
    expect(sheet.armorClass.stealthDisadvantage).toBe(false);

    // Expertise in Stealth (+3 DEX + 4 Expertise = +7) and Thieves' Tools
    expect(sheet.skills.stealth.proficiencyLevel).toBe('expertise');
    expect(sheet.skills.stealth.totalBonus).toBe(7);
    expect(sheet.proficiencies.expertise).toEqual(
      expect.arrayContaining(['stealth', 'thieves-tools']),
    );

    // Weapon Attacks: Rapier (finesse uses DEX +3 +2 prof = +5 to hit, 1d8+3) & Shortbow (+5 to hit, 1d6+3)
    const rapier = sheet.weaponAttacks.find((w) => w.weaponId === 'rapier');
    expect(rapier?.abilityUsed).toBe('dex');
    expect(rapier?.toHitBonus).toBe(5);
    expect(rapier?.damageBonus).toBe(3);

    const shortbow = sheet.weaponAttacks.find((w) => w.weaponId === 'shortbow');
    expect(shortbow?.toHitBonus).toBe(5);
    expect(shortbow?.damageBonus).toBe(3);
  });

  it('supports leveling up all 4 iconic party members from Level 1 to Level 2', () => {
    const party = createIconicPartyStates();
    for (const member of party) {
      member.runtime.xp = 300;
      const classId = member.classes[0]!.classId;
      const levelUpResult = applyLevelUp(
        member,
        {
          classId,
          hpMethod: 'fixed',
          subclassId: classId === 'wizard' ? 'evocation' : undefined,
          spellcastingUpdates:
            classId === 'wizard'
              ? { addedSpellbookSpellIds: ['charm-person', 'thunderwave'] }
              : undefined,
        },
        compendium,
      );
      expect(levelUpResult.summary.newTotalLevel).toBe(2);
      expect(levelUpResult.sheet.totalLevel).toBe(2);
      expect(levelUpResult.sheet.maxHp).toBeGreaterThan(member.runtime.currentHp);
    }
  });
});
