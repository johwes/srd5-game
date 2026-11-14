import type { MonsterData } from '@srd5/data';
import type { DerivedCharacterSheet } from '../character/schemas.js';
import type { GridPoint } from '../grid/model.js';
import type { Combatant, CombatantSide } from './types.js';

export interface CreateCharacterCombatantOptions {
  side?: CombatantSide;
  isSurprised?: boolean;
}

export interface CreateMonsterCombatantOptions {
  side?: CombatantSide;
  isSurprised?: boolean;
  name?: string;
}

/**
 * Creates a Combatant representation from a Player Character's DerivedCharacterSheet.
 */
export function createCharacterCombatant(
  sheet: DerivedCharacterSheet,
  position: GridPoint,
  options?: CreateCharacterCombatantOptions,
): Combatant {
  const isSurprised = Boolean(options?.isSurprised);
  const conditions = sheet.activeConditions.map((c) => c.conditionId);
  const isDead = sheet.deathSaves.failures >= 3;
  const isStable = sheet.currentHp === 0 && sheet.deathSaves.successes >= 3;

  return {
    id: sheet.id,
    name: sheet.name,
    side: options?.side ?? 'party',
    size: sheet.size,
    position,
    speedFeet: sheet.speedFeet,
    currentHp: sheet.currentHp,
    maxHp: sheet.maxHp,
    tempHp: sheet.tempHp,
    armorClass: sheet.armorClass.totalAc,
    dexterityScore: sheet.abilities.dex.score,
    dexterityModifier: sheet.abilities.dex.modifier,
    strengthScore: sheet.abilities.str.score,
    strengthModifier: sheet.abilities.str.modifier,
    initiativeBonus: sheet.initiative.bonus,
    initiativeRollMode: sheet.initiative.rollMode,
    passivePerception: sheet.passivePerception,
    stealthModifier: sheet.skills.stealth.totalBonus,
    isSurprised,
    isDodging: false,
    conditions,
    deathSaves: { ...sheet.deathSaves },
    isDead,
    isStable,
    attacksPerAction: sheet.attacksPerAction,
    concentratingOn: sheet.concentratingOn
      ? {
          sourceId: sheet.concentratingOn.sourceId,
          targetEntityIds: [...sheet.concentratingOn.targetEntityIds],
          remainingRounds: sheet.concentratingOn.remainingRounds,
        }
      : undefined,
    spellSlots:
      sheet.spellcasting?.isSpellcaster && sheet.spellcasting.spellSlots
        ? Object.fromEntries(
            Object.entries(sheet.spellcasting.spellSlots).map(([lvl, pool]) => [
              lvl,
              { max: pool.max, expended: pool.expended, available: pool.available },
            ]),
          )
        : undefined,
    pactMagic: sheet.spellcasting?.pactMagic
      ? {
          slotLevel: sheet.spellcasting.pactMagic.slotLevel,
          maxSlots: sheet.spellcasting.pactMagic.maxSlots,
          expendedSlots: sheet.spellcasting.pactMagic.expendedSlots,
          availableSlots: sheet.spellcasting.pactMagic.availableSlots,
        }
      : undefined,
    characterSheet: sheet,
  };
}

/**
 * Creates a Combatant representation from an SRD 5.1 MonsterData definition.
 */
export function createMonsterCombatant(
  monster: MonsterData,
  instanceId: string,
  position: GridPoint,
  options?: CreateMonsterCombatantOptions,
): Combatant {
  const dexMod = Math.floor((monster.abilities.dex - 10) / 2);
  const stealthMod = monster.skills.stealth ?? dexMod;
  const hp = monster.hitPoints.average;

  const monsterSpellSlots: Record<string, { max: number; expended: number; available: number }> = {};
  if (monster.spellcasting?.slotsByLevel) {
    for (const [lvl, count] of Object.entries(monster.spellcasting.slotsByLevel)) {
      monsterSpellSlots[lvl] = {
        max: count,
        expended: 0,
        available: count,
      };
    }
  }

  return {
    id: instanceId,
    name: options?.name ?? monster.name,
    side: options?.side ?? 'monster',
    size: monster.size,
    position,
    speedFeet: monster.speed.walk,
    currentHp: hp,
    maxHp: monster.hitPoints.average,
    tempHp: 0,
    armorClass: monster.armorClass.value,
    dexterityScore: monster.abilities.dex,
    dexterityModifier: dexMod,
    strengthScore: monster.abilities.str,
    strengthModifier: Math.floor((monster.abilities.str - 10) / 2),
    initiativeBonus: dexMod,
    initiativeRollMode: 'normal',
    passivePerception: monster.senses.passivePerception,
    stealthModifier: stealthMod,
    isSurprised: Boolean(options?.isSurprised),
    isDodging: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: hp <= 0,
    isStable: false,
    attacksPerAction: 1,
    spellSlots: Object.keys(monsterSpellSlots).length > 0 ? monsterSpellSlots : undefined,
    monsterData: monster,
  };
}
