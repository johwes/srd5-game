import { describe, expect, it } from 'vitest';
import type { MonsterData } from '@srd5/data';
import {
  type Combatant,
  type CombatState,
  createTacticalGrid,
  executeMoveCombatant,
  executeWeaponAttack,
  executeSpellCast,
  startTurn,
  endTurn,
  resolveReactionPrompt,
  detectOpportunityAttackTrigger,
  detectAttackHitReactions,
  detectProtectionTrigger,
  detectCounterspellTrigger,
  canCombatantTakeReaction,
  spendCombatantReaction,
  applyShieldBuff,
} from '../index.js';

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'char-1',
    name: 'Hero',
    side: 'party',
    size: 'medium',
    position: { x: 5, y: 5 },
    speedFeet: 30,
    currentHp: 25,
    maxHp: 25,
    tempHp: 0,
    armorClass: 15,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 12,
    stealthModifier: 2,
    isSurprised: false,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    isDead: false,
    isStable: false,
    attacksPerAction: 1,
    reactionAvailable: true,
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    conditionImmunities: [],
    ...overrides,
  };
}

function makeCombatState(combatantsList: Combatant[], overrides: Partial<CombatState> = {}): CombatState {
  const combatants: Record<string, Combatant> = {};
  for (const c of combatantsList) {
    combatants[c.id] = c;
  }
  return {
    encounterId: 'enc-reactions',
    round: 1,
    phase: 'active_turn',
    initiativeOrder: combatantsList.map((c, i) => ({
      entityId: c.id,
      initiative: 20 - i,
      naturalRoll: 10,
      dexterityScore: c.dexterityScore,
      tieBreaker: 0,
    })),
    activeCombatantIndex: 0,
    activeCombatantId: combatantsList[0]?.id ?? null,
    turnBudget: {
      action: 1,
      bonusAction: 1,
      reactionAvailable: true,
      movementRemainingFeet: combatantsList[0]?.speedFeet ?? 30,
      freeObjectInteraction: 1,
      bonusActionSpellCast: false,
      leveledActionSpellCast: false,
      attackActionTaken: false,
      extraAttacksRemaining: 0,
      disengaged: false,
      dodging: false,
    },
    combatants,
    surprisedCombatantIds: [],
    outcome: 'in_progress',
    rngState: 42,
    ...overrides,
  };
}

describe('SRD-309: Reaction Interrupt Architecture', () => {
  describe('General Reaction Rules & State Transitions', () => {
    it('allows reactions when reactionAvailable is true and creature is eligible', () => {
      const hero = makeCombatant({ reactionAvailable: true, currentHp: 20 });
      expect(canCombatantTakeReaction(hero)).toBe(true);
    });

    it('disallows reactions when reaction is already spent', () => {
      const hero = makeCombatant({ reactionAvailable: false });
      expect(canCombatantTakeReaction(hero)).toBe(false);
    });

    it('disallows reactions when creature is incapacitated, unconscious, or dead', () => {
      const unconscious = makeCombatant({ conditions: ['unconscious'], currentHp: 0 });
      expect(canCombatantTakeReaction(unconscious)).toBe(false);

      const dead = makeCombatant({ isDead: true, currentHp: 0 });
      expect(canCombatantTakeReaction(dead)).toBe(false);

      const paralyzed = makeCombatant({ conditions: ['paralyzed'] });
      expect(canCombatantTakeReaction(paralyzed)).toBe(false);
    });

    it('disallows reactions on round 1 while surprised, and restores reaction when surprise ends', () => {
      const surprisedHero = makeCombatant({ isSurprised: true });
      expect(canCombatantTakeReaction(surprisedHero)).toBe(false);

      const state = makeCombatState([surprisedHero]);
      // At the end of first turn, surprise ends and reaction becomes available
      const endTurnRes = endTurn(state);
      const updatedHero = endTurnRes.state.combatants[surprisedHero.id]!;
      expect(updatedHero.isSurprised).toBe(false);
      expect(updatedHero.reactionAvailable).toBe(true);
    });

    it('refreshes reaction at the start of a combatant turn', () => {
      const hero = makeCombatant({ reactionAvailable: false });
      const state = makeCombatState([hero]);
      const turnRes = startTurn(state, hero.id);
      expect(turnRes.state.combatants[hero.id]!.reactionAvailable).toBe(true);
      expect(turnRes.state.turnBudget!.reactionAvailable).toBe(true);
    });
  });

  describe('Shield Reaction (Turning a Hit into a Miss)', () => {
    it('detects Shield reaction when hit by an attack roll and target has 1st-level slot', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        armorClass: 12,
        spellSlots: { '1': { max: 4, expended: 0, available: 4 } },
        activeEffects: [{ effectId: 'shield_spell_known', name: 'Shield', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const goblin = makeCombatant({
        id: 'gob-1',
        name: 'Goblin',
        side: 'monster',
      });
      const state = makeCombatState([goblin, wizard]);

      // Goblin rolls 15 to hit (hits AC 12, but < AC 12 + 5 = 17)
      const prompt = detectAttackHitReactions(state, goblin.id, wizard.id, 15, 12, false);
      expect(prompt).not.toBeNull();
      expect(prompt?.reactorEntityId).toBe('wiz-1');
      expect(prompt?.availableReactions[0]?.reactionType).toBe('shield');
    });

    it('pauses attack resolution with reaction_prompt when player hero is hit and can cast Shield', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        armorClass: 14,
        spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
        activeEffects: [{ effectId: 'shield', name: 'Shield', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([orc, wizard]);

      // Orc attacks Wizard with custom attack that will hit (roll 16 vs AC 14)
      const attackRes = executeWeaponAttack({
        state,
        attackerId: orc.id,
        targetId: wizard.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d12',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      // Wizard is player party: execution pauses at reaction prompt!
      expect(attackRes.state.phase).toBe('reaction_prompt');
      expect(attackRes.state.pendingReactionPrompt).not.toBeNull();
      expect(attackRes.state.pendingReactionPrompt?.reactorEntityId).toBe('wiz-1');
      expect(attackRes.events.some((e) => e.type === 'REACTION_PROMPTED')).toBe(true);
    });

    it('resumes and turns hit into a miss when player executes Shield reaction (AC +5)', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        currentHp: 20,
        armorClass: 14,
        spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
        activeEffects: [{ effectId: 'shield', name: 'Shield', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([orc, wizard]);

      const attackRes = executeWeaponAttack({
        state,
        attackerId: orc.id,
        targetId: wizard.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d12',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      const promptId = attackRes.state.pendingReactionPrompt!.promptId;

      // Wizard decides to execute Shield reaction
      const resumeRes = resolveReactionPrompt(attackRes.state, {
        promptId,
        decision: {
          execute: true,
          reactionId: 'cast_shield',
          slotLevel: 1,
        },
      });

      // Verification:
      // 1. Phase restored to active_turn
      expect(resumeRes.state.phase).toBe('active_turn');
      expect(resumeRes.state.pendingReactionPrompt).toBeNull();

      // 2. Wizard's AC increased by +5 (14 -> 19)
      const wizardAfter = resumeRes.state.combatants[wizard.id]!;
      expect(wizardAfter.armorClass).toBe(19);

      // 3. Wizard's 1st-level slot is expended (2 -> 1)
      expect(wizardAfter.spellSlots?.['1']?.available).toBe(1);

      // 4. Wizard's reaction is spent
      expect(wizardAfter.reactionAvailable).toBe(false);

      // 5. Wizard took 0 damage (hit turned into miss!)
      expect(wizardAfter.currentHp).toBe(20);

      // 6. Events contain SPELL_CAST (Shield) and ATTACK_RESOLVED (outcome: 'miss')
      expect(resumeRes.events.some((e) => e.type === 'SPELL_CAST' && e.spellId === 'shield')).toBe(true);
      const attackEvent = resumeRes.events.find((e) => e.type === 'ATTACK_RESOLVED');
      expect(attackEvent).toBeDefined();
      if (attackEvent && attackEvent.type === 'ATTACK_RESOLVED') {
        expect(attackEvent.outcome).toBe('miss');
      }
    });

    it('resumes and applies full damage when player passes on Shield reaction', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        currentHp: 20,
        armorClass: 14,
        spellSlots: { '1': { max: 2, expended: 0, available: 2 } },
        activeEffects: [{ effectId: 'shield', name: 'Shield', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([orc, wizard]);

      const attackRes = executeWeaponAttack({
        state,
        attackerId: orc.id,
        targetId: wizard.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d12',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      const promptId = attackRes.state.pendingReactionPrompt!.promptId;

      // Player passes
      const resumeRes = resolveReactionPrompt(attackRes.state, {
        promptId,
        decision: { execute: false },
      });

      expect(resumeRes.state.phase).toBe('active_turn');
      const wizardAfter = resumeRes.state.combatants[wizard.id]!;
      // Hit lands, damage is applied!
      expect(wizardAfter.currentHp).toBeLessThan(20);
      // Reaction and slot were NOT spent
      expect(wizardAfter.reactionAvailable).toBe(true);
      expect(wizardAfter.spellSlots?.['1']?.available).toBe(2);
    });

    it('expires Shield AC bonus (+5) at the start of reactor next turn', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        armorClass: 12,
      });
      const buffed = applyShieldBuff(wizard);
      expect(buffed.armorClass).toBe(17);

      const state = makeCombatState([buffed]);
      const turnRes = startTurn(state, wizard.id);
      expect(turnRes.state.combatants[wizard.id]!.armorClass).toBe(12);
    });

    it('AI monster casts Shield synchronously turning a hit into a miss', () => {
      const evilMage = makeCombatant({
        id: 'mage-1',
        name: 'Evil Mage',
        side: 'monster',
        armorClass: 12,
        currentHp: 30,
        spellSlots: { '1': { max: 4, expended: 0, available: 4 } },
        activeEffects: [{ effectId: 'shield', name: 'Shield', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const hero = makeCombatant({
        id: 'hero-1',
        name: 'Fighter',
        side: 'party',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([hero, evilMage]);

      // Fighter attacks Evil Mage with toHitBonus: 3 (will hit AC 12, but miss AC 17)
      const attackRes = executeWeaponAttack({
        state,
        attackerId: hero.id,
        targetId: evilMage.id,
        customAttack: {
          name: 'Longsword',
          attackType: 'melee_weapon',
          toHitBonus: 3,
          damageDice: '1d8',
          damageBonus: 2,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      // Synchronous AI resolution: Evil Mage casts Shield, attack misses, 0 damage!
      expect(attackRes.state.phase).toBe('active_turn');
      const mageAfter = attackRes.state.combatants[evilMage.id]!;
      expect(mageAfter.armorClass).toBe(17);
      expect(mageAfter.currentHp).toBe(30);
      expect(mageAfter.reactionAvailable).toBe(false);
      expect(attackRes.outcome).toBe('miss');
    });
  });

  describe('Opportunity Attack Reaction', () => {
    it('detects Opportunity Attack when a hostile creature moves out of reach without Disengage', () => {
      const hero = makeCombatant({
        id: 'hero-1',
        side: 'party',
        position: { x: 5, y: 5 },
      });
      const goblin = makeCombatant({
        id: 'gob-1',
        side: 'monster',
        position: { x: 5, y: 6 }, // 5 ft adjacent
      });
      const state = makeCombatState([goblin, hero]);

      // Goblin moves from (5,6) to (5,7) exiting Hero's 5 ft reach
      const trigger = detectOpportunityAttackTrigger(state, goblin.id, { x: 5, y: 6 }, { x: 5, y: 7 });
      expect(trigger).not.toBeNull();
      expect(trigger?.reactor.id).toBe('hero-1');
    });

    it('does NOT provoke Opportunity Attack when mover has Disengaged', () => {
      const hero = makeCombatant({ id: 'hero-1', side: 'party', position: { x: 5, y: 5 } });
      const goblin = makeCombatant({ id: 'gob-1', side: 'monster', position: { x: 5, y: 6 } });
      const state = makeCombatState([goblin, hero], {
        turnBudget: {
          action: 0,
          bonusAction: 1,
          reactionAvailable: true,
          movementRemainingFeet: 30,
          freeObjectInteraction: 1,
          bonusActionSpellCast: false,
          leveledActionSpellCast: false,
          attackActionTaken: false,
          extraAttacksRemaining: 0,
          disengaged: true, // Disengaged!
          dodging: false,
        },
      });

      const trigger = detectOpportunityAttackTrigger(state, goblin.id, { x: 5, y: 6 }, { x: 5, y: 7 });
      expect(trigger).toBeNull();
    });

    it('pauses movement with reaction prompt when monster exits player hero reach', () => {
      const hero = makeCombatant({
        id: 'hero-1',
        name: 'Fighter',
        side: 'party',
        position: { x: 5, y: 5 },
      });
      const goblin = makeCombatant({
        id: 'gob-1',
        name: 'Goblin',
        side: 'monster',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([goblin, hero]);

      // Goblin moves out of reach from (5,6) to (5,8)
      const moveRes = executeMoveCombatant(state, {
        actorId: goblin.id,
        path: [
          { x: 5, y: 7 },
          { x: 5, y: 8 },
        ],
      });

      expect(moveRes.state.phase).toBe('reaction_prompt');
      expect(moveRes.state.pendingReactionPrompt?.reactorEntityId).toBe('hero-1');
    });

    it('halts mover at stepFrom if Opportunity Attack kills or downs the mover', () => {
      const hero = makeCombatant({
        id: 'hero-1',
        name: 'Fighter',
        side: 'party',
        position: { x: 5, y: 5 },
      });
      // Goblin with only 1 HP
      const fragileGoblin = makeCombatant({
        id: 'gob-1',
        name: 'Goblin',
        side: 'monster',
        position: { x: 5, y: 6 },
        currentHp: 1,
        armorClass: 5, // very easy to hit
      });
      const state = makeCombatState([fragileGoblin, hero]);

      const moveRes = executeMoveCombatant(state, {
        actorId: fragileGoblin.id,
        path: [
          { x: 5, y: 7 },
          { x: 5, y: 8 },
        ],
      });

      const promptId = moveRes.state.pendingReactionPrompt!.promptId;

      // Hero takes Opportunity Attack
      const resumeRes = resolveReactionPrompt(moveRes.state, {
        promptId,
        decision: {
          execute: true,
          reactionId: 'opportunity_attack',
        },
      });

      const goblinAfter = resumeRes.state.combatants[fragileGoblin.id]!;
      expect(goblinAfter.currentHp).toBe(0);
      expect(goblinAfter.isDead).toBe(true);
      // Mover was halted before leaving reach at (5, 6)!
      expect(goblinAfter.position).toEqual({ x: 5, y: 6 });
    });
  });

  describe('Fighting Style: Protection Reaction', () => {
    it('detects Protection reaction when ally within 5 ft is attacked and reactor has shield', () => {
      const paladin = makeCombatant({
        id: 'pal-1',
        name: 'Paladin',
        side: 'party',
        position: { x: 5, y: 5 },
        characterSheet: {
          armorClass: { shieldBonus: 2 } as any,
          featureIds: ['fighting_style_protection'],
        } as any,
      });
      const cleric = makeCombatant({
        id: 'clr-1',
        name: 'Cleric',
        side: 'party',
        position: { x: 5, y: 6 }, // 5 ft adjacent to Paladin
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 7 },
      });
      const state = makeCombatState([orc, paladin, cleric]);

      const trigger = detectProtectionTrigger(state, orc.id, cleric.id);
      expect(trigger).not.toBeNull();
      expect(trigger?.protector.id).toBe('pal-1');
    });

    it('pauses attack and applies Disadvantage when Protection is executed', () => {
      const paladin = makeCombatant({
        id: 'pal-1',
        name: 'Paladin',
        side: 'party',
        position: { x: 5, y: 5 },
        characterSheet: {
          armorClass: { shieldBonus: 2 } as any,
          featureIds: ['fighting_style_protection'],
        } as any,
      });
      const cleric = makeCombatant({
        id: 'clr-1',
        name: 'Cleric',
        side: 'party',
        position: { x: 5, y: 6 },
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 7 },
      });
      const state = makeCombatState([orc, paladin, cleric]);

      // Orc attacks Cleric
      const attackRes = executeWeaponAttack({
        state,
        attackerId: orc.id,
        targetId: cleric.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 5,
          damageDice: '1d12',
          damageBonus: 3,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      expect(attackRes.state.phase).toBe('reaction_prompt');
      const promptId = attackRes.state.pendingReactionPrompt!.promptId;

      const resumeRes = resolveReactionPrompt(attackRes.state, {
        promptId,
        decision: {
          execute: true,
          reactionId: 'protection',
        },
      });

      // Protection spent paladin's reaction and imposed disadvantage
      expect(resumeRes.state.combatants[paladin.id]!.reactionAvailable).toBe(false);
      expect(resumeRes.events.some((e) => e.type === 'DICE_ROLLED' && e.mode === 'disadvantage')).toBe(true);
    });
  });

  describe('Uncanny Dodge Reaction', () => {
    it('detects Uncanny Dodge when Rogue Level 5+ is hit by an attack', () => {
      const rogue = makeCombatant({
        id: 'rogue-1',
        name: 'Rogue',
        side: 'party',
        characterSheet: {
          classes: [{ classId: 'rogue', level: 5 }],
          featureIds: ['uncanny_dodge'],
        } as any,
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
      });
      const state = makeCombatState([orc, rogue]);

      const prompt = detectAttackHitReactions(state, orc.id, rogue.id, 16, 14, false);
      expect(prompt).not.toBeNull();
      expect(prompt?.availableReactions.some((r) => r.reactionType === 'uncanny_dodge')).toBe(true);
    });

    it('halves incoming damage when Uncanny Dodge reaction is executed', () => {
      const rogue = makeCombatant({
        id: 'rogue-1',
        name: 'Rogue',
        side: 'party',
        currentHp: 30,
        maxHp: 30,
        armorClass: 14,
        characterSheet: {
          classes: [{ classId: 'rogue', level: 5 }],
          featureIds: ['uncanny_dodge'],
        } as any,
      });
      const orc = makeCombatant({
        id: 'orc-1',
        name: 'Orc',
        side: 'monster',
        position: { x: 5, y: 6 },
      });
      const state = makeCombatState([orc, rogue]);

      const attackRes = executeWeaponAttack({
        state,
        attackerId: orc.id,
        targetId: rogue.id,
        customAttack: {
          name: 'Greataxe',
          attackType: 'melee_weapon',
          toHitBonus: 10, // Guaranteed hit
          damageDice: '10', // Flat 10 damage
          damageBonus: 0,
          damageType: 'slashing',
          reachFeet: 5,
        },
      });

      const promptId = attackRes.state.pendingReactionPrompt!.promptId;

      // Execute Uncanny Dodge
      const resumeRes = resolveReactionPrompt(attackRes.state, {
        promptId,
        decision: {
          execute: true,
          reactionId: 'uncanny_dodge',
        },
      });

      const rogueAfter = resumeRes.state.combatants[rogue.id]!;
      // 10 damage halved to 5! (30 - 5 = 25 HP)
      expect(rogueAfter.currentHp).toBe(25);
      expect(rogueAfter.reactionAvailable).toBe(false);
    });
  });

  describe('Counterspell Reaction', () => {
    it('detects Counterspell trigger when an enemy within 60 ft casts a spell', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        position: { x: 5, y: 5 },
        spellSlots: { '3': { max: 2, expended: 0, available: 2 } },
        activeEffects: [{ effectId: 'counterspell', name: 'Counterspell', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const evilMage = makeCombatant({
        id: 'mage-1',
        name: 'Evil Mage',
        side: 'monster',
        position: { x: 10, y: 10 }, // 35 ft away (within 60 ft)
      });
      const state = makeCombatState([evilMage, wizard]);

      const trigger = detectCounterspellTrigger(
        state,
        evilMage.id,
        { id: 'fireball', name: 'Fireball', level: 3 } as any,
        3,
      );
      expect(trigger).not.toBeNull();
      expect(trigger?.reactor.id).toBe('wiz-1');
    });

    it('automatically interrupts and cancels a spell when Counterspell slot >= spell level', () => {
      const wizard = makeCombatant({
        id: 'wiz-1',
        name: 'Wizard',
        side: 'party',
        position: { x: 5, y: 5 },
        spellSlots: { '3': { max: 2, expended: 0, available: 2 } },
        activeEffects: [{ effectId: 'counterspell', name: 'Counterspell', requiresConcentration: false, remainingRounds: 10, modifiers: [] }],
      });
      const evilMage = makeCombatant({
        id: 'mage-1',
        name: 'Evil Mage',
        side: 'monster',
        position: { x: 6, y: 6 },
        spellSlots: { '3': { max: 2, expended: 0, available: 2 } },
      });
      const state = makeCombatState([evilMage, wizard]);

      // Evil Mage casts Fireball (level 3)
      const castRes = executeSpellCast({
        state,
        casterId: evilMage.id,
        spellId: 'fireball',
        slotLevel: 3,
        originCell: { x: 5, y: 5 },
      });

      expect(castRes.state.phase).toBe('reaction_prompt');
      const promptId = castRes.state.pendingReactionPrompt!.promptId;

      // Wizard casts Counterspell with 3rd level slot
      const resumeRes = resolveReactionPrompt(castRes.state, {
        promptId,
        decision: {
          execute: true,
          reactionId: 'counterspell_slot_3',
          slotLevel: 3,
        },
      });

      // Verification:
      expect(resumeRes.state.phase).toBe('active_turn');
      const wizardAfter = resumeRes.state.combatants[wizard.id]!;
      const mageAfter = resumeRes.state.combatants[evilMage.id]!;

      // Wizard spent 3rd-level slot and reaction
      expect(wizardAfter.spellSlots?.['3']?.available).toBe(1);
      expect(wizardAfter.reactionAvailable).toBe(false);

      // Evil Mage lost the 3rd-level slot
      expect(mageAfter.spellSlots?.['3']?.available).toBe(1);

      // Fireball was cancelled: Wizard took NO damage!
      expect(wizardAfter.currentHp).toBe(25);
    });
  });
});
