import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import { type PlayerViewCombatant } from '@srd5/transport';
import {
  getSpellTargetDisposition,
  getSpellMaxTargets,
  resolveSpellTargets,
} from './combatTargeting.js';

describe('combatTargeting utility', () => {
  const blessSpell = defaultCompendium.requireSpell('bless');
  const cureWoundsSpell = defaultCompendium.requireSpell('cure-wounds');
  const sacredFlameSpell = defaultCompendium.requireSpell('sacred-flame');
  const shieldSpell = defaultCompendium.requireSpell('shield');

  const cleric: PlayerViewCombatant = {
    id: 'cleric-1',
    name: 'Kyra (Cleric)',
    side: 'party',
    position: { x: 5, y: 5 },
    size: 'medium',
    speedFeet: 30,
    currentHp: 10,
    maxHp: 10,
    tempHp: 0,
    armorClass: 16,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const fighter: PlayerViewCombatant = {
    id: 'fighter-1',
    name: 'Valeros (Fighter)',
    side: 'party',
    position: { x: 5, y: 6 }, // 5 ft away
    size: 'medium',
    speedFeet: 30,
    currentHp: 4,
    maxHp: 12, // Wounded
    tempHp: 0,
    armorClass: 17,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const rogue: PlayerViewCombatant = {
    id: 'rogue-1',
    name: 'Merisiel (Rogue)',
    side: 'party',
    position: { x: 7, y: 5 }, // 10 ft away
    size: 'medium',
    speedFeet: 30,
    currentHp: 9,
    maxHp: 9,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const wizard: PlayerViewCombatant = {
    id: 'wizard-1',
    name: 'Ezren (Wizard)',
    side: 'party',
    position: { x: 4, y: 4 }, // 5 ft away
    size: 'medium',
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    armorClass: 12,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const goblin1: PlayerViewCombatant = {
    id: 'goblin-1',
    name: 'Goblin Scout',
    side: 'monster',
    position: { x: 8, y: 5 }, // 15 ft away
    size: 'small',
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const goblin2: PlayerViewCombatant = {
    id: 'goblin-2',
    name: 'Goblin Archer',
    side: 'monster',
    position: { x: 9, y: 5 }, // 20 ft away
    size: 'small',
    speedFeet: 30,
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    armorClass: 15,
    conditions: [],
    isDead: false,
    isStable: true,
  };

  const combatants: Record<string, PlayerViewCombatant> = {
    [cleric.id]: cleric,
    [fighter.id]: fighter,
    [rogue.id]: rogue,
    [wizard.id]: wizard,
    [goblin1.id]: goblin1,
    [goblin2.id]: goblin2,
  };

  it('correctly classifies spell target disposition', () => {
    expect(getSpellTargetDisposition(blessSpell)).toBe('friendly');
    expect(getSpellTargetDisposition(cureWoundsSpell)).toBe('friendly');
    expect(getSpellTargetDisposition(sacredFlameSpell)).toBe('hostile');
    expect(getSpellTargetDisposition(shieldSpell)).toBe('self');
  });

  it('correctly calculates maximum targets for spells', () => {
    expect(getSpellMaxTargets(blessSpell, 1)).toBe(3);
    expect(getSpellMaxTargets(blessSpell, 2)).toBe(4); // L2 slot adds +1 target
    expect(getSpellMaxTargets(cureWoundsSpell)).toBe(1);
    expect(getSpellMaxTargets(sacredFlameSpell)).toBe(1);
    expect(getSpellMaxTargets(shieldSpell)).toBe(1);
  });

  it('targets up to 3 allies and ZERO enemies when casting Bless', () => {
    const res = resolveSpellTargets({
      spell: blessSpell,
      slotLevel: 1,
      caster: cleric,
      combatants,
      selectedCombatantId: null,
    });

    expect(res.disposition).toBe('friendly');
    expect(res.errorFeedback).toBeUndefined();
    expect(res.targetIds.length).toBe(3);

    // Must be allies only
    expect(res.targetIds).not.toContain(goblin1.id);
    expect(res.targetIds).not.toContain(goblin2.id);

    // All targets belong to party
    for (const tid of res.targetIds) {
      expect(combatants[tid]?.side).toBe('party');
    }
  });

  it('prioritizes player-selected ally when casting Bless', () => {
    const res = resolveSpellTargets({
      spell: blessSpell,
      slotLevel: 1,
      caster: cleric,
      combatants,
      selectedCombatantId: wizard.id,
    });

    expect(res.targetIds[0]).toBe(wizard.id);
    expect(res.targetIds.length).toBe(3);
    expect(res.targetIds).not.toContain(goblin1.id);
  });

  it('targets the most wounded ally when casting Cure Wounds without selection', () => {
    const res = resolveSpellTargets({
      spell: cureWoundsSpell,
      slotLevel: 1,
      caster: cleric,
      combatants,
      selectedCombatantId: null,
    });

    expect(res.disposition).toBe('friendly');
    expect(res.targetIds).toEqual([fighter.id]); // Fighter is at 4/12 HP
    expect(res.primaryTarget?.id).toBe(fighter.id);
  });

  it('targets selected ally for Cure Wounds if in touch range', () => {
    const res = resolveSpellTargets({
      spell: cureWoundsSpell,
      slotLevel: 1,
      caster: cleric,
      combatants,
      selectedCombatantId: wizard.id, // 5 ft away
    });

    expect(res.targetIds).toEqual([wizard.id]);
    expect(res.primaryTarget?.id).toBe(wizard.id);
  });

  it('returns error feedback if selected ally is out of touch range for Cure Wounds', () => {
    const res = resolveSpellTargets({
      spell: cureWoundsSpell,
      slotLevel: 1,
      caster: cleric,
      combatants,
      selectedCombatantId: rogue.id, // 10 ft away, touch is 5 ft
    });

    expect(res.targetIds.length).toBe(0);
    expect(res.errorFeedback).toMatch(/out of spell range/i);
  });

  it('auto-targets closest hostile enemy when casting Sacred Flame, even if an ally was selected', () => {
    const res = resolveSpellTargets({
      spell: sacredFlameSpell,
      slotLevel: 0,
      caster: cleric,
      combatants,
      selectedCombatantId: fighter.id, // Ally selected
    });

    expect(res.disposition).toBe('hostile');
    // Does NOT target ally with hostile spell!
    expect(res.targetIds).toEqual([goblin1.id]); // Goblin 1 is closest (15 ft)
  });

  it('targets selected enemy when casting Sacred Flame', () => {
    const res = resolveSpellTargets({
      spell: sacredFlameSpell,
      slotLevel: 0,
      caster: cleric,
      combatants,
      selectedCombatantId: goblin2.id,
    });

    expect(res.targetIds).toEqual([goblin2.id]);
    expect(res.primaryTarget?.id).toBe(goblin2.id);
  });

  it('strictly targets caster for self spells like Shield', () => {
    const res = resolveSpellTargets({
      spell: shieldSpell,
      slotLevel: 1,
      caster: wizard,
      combatants,
      selectedCombatantId: goblin1.id, // Enemy selected
    });

    expect(res.disposition).toBe('self');
    expect(res.targetIds).toEqual([wizard.id]);
    expect(res.primaryTarget?.id).toBe(wizard.id);
  });
});
