import { describe, expect, it } from 'vitest';
import { compendium, isProhibitedMonsterId } from '@srd5/data';
import { createMonsterCombatant } from '../combat/combatant.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { executeWeaponAttack } from '../combat/attack.js';
import { calculateMitigatedDamage } from '../combat/damage.js';
import { generateDungeonFloor } from '../dungeon/generator.js';
import { getBattleTerrainTemplate } from '../overworld/battles.js';
import { BOUNTY_TARGET_POOL } from '../overworld/quests.js';
import type { CombatState, Combatant } from '../combat/types.js';

describe('SRD-1001: Monster Wave 1 (CR 0–2 Staples & Biome Table Wiring)', () => {
  const WAVE_1_MONSTER_IDS = [
    'guard',
    'noble',
    'giant-bat',
    'giant-wolf-spider',
    'warhorse-skeleton',
    'shadow',
    'thug',
    'scout',
    'specter',
    'spy',
    'berserker',
  ] as const;

  function buildCombatState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'enc-wave-1',
      round: 1,
      phase: 'active_turn',
      initiativeOrder: combatantsList.map((c) => ({
        entityId: c.id,
        initiative: 10,
        naturalRoll: 10,
        dexterityScore: c.dexterityScore,
        tieBreaker: c.dexterityScore,
      })),
      activeCombatantIndex: 0,
      activeCombatantId: combatantsList[0]?.id ?? null,
      turnBudget: {
        action: 1,
        bonusAction: 1,
        reactionAvailable: true,
        movementRemainingFeet: 30,
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
      rngState: 1337,
    };
  }

  describe('Audit, Licensing & Statblock Verification', () => {
    it('verifies all 11 Wave 1 monsters exist in the compendium with valid CR and AI archetypes', () => {
      for (const id of WAVE_1_MONSTER_IDS) {
        const monster = compendium.requireMonster(id);
        expect(monster).toBeDefined();
        expect(monster.id).toBe(id);
        expect(monster.challengeRating).toBeGreaterThanOrEqual(0.125);
        expect(monster.challengeRating).toBeLessThanOrEqual(2);
        expect(['brute', 'skirmisher', 'artillery', 'controller', 'support']).toContain(
          monster.aiArchetype,
        );
        expect(monster.source).toBe('srd-5.1');
        expect(isProhibitedMonsterId(monster.id)).toBe(false);
        expect(isProhibitedMonsterId(monster.name)).toBe(false);
      }
    });

    it('verifies correct statblock attributes and traits for Wave 1 monsters', () => {
      const guard = compendium.requireMonster('guard');
      expect(guard.armorClass.value).toBe(16);
      expect(guard.armorClass.hasShield).toBe(true);
      expect(guard.hitPoints.average).toBe(11);
      expect(guard.aiArchetype).toBe('brute');

      const noble = compendium.requireMonster('noble');
      expect(noble.armorClass.value).toBe(15);
      expect(noble.hitPoints.average).toBe(9);
      expect(noble.reactions?.some((r) => r.id === 'parry')).toBe(true);

      const bat = compendium.requireMonster('giant-bat');
      expect(bat.size).toBe('large');
      expect(bat.speed.fly).toBe(60);
      expect(bat.senses.blindsightFeet).toBe(60);

      const spider = compendium.requireMonster('giant-wolf-spider');
      expect(spider.speed.climb).toBe(40);
      expect(spider.senses.darkvisionFeet).toBe(60);

      const horse = compendium.requireMonster('warhorse-skeleton');
      expect(horse.damageVulnerabilities).toContain('bludgeoning');
      expect(horse.damageImmunities).toContain('poison');
      expect(horse.conditionImmunities).toContain('exhaustion');

      const shadow = compendium.requireMonster('shadow');
      expect(shadow.damageVulnerabilities).toContain('radiant');
      expect(shadow.damageImmunities).toContain('necrotic');
      expect(shadow.damageImmunities).toContain('poison');

      const thug = compendium.requireMonster('thug');
      expect(thug.traits.some((t) => t.id === 'pack-tactics')).toBe(true);
      expect(thug.actions.some((a) => a.id === 'multiattack')).toBe(true);

      const scout = compendium.requireMonster('scout');
      expect(scout.traits.some((t) => t.id === 'keen-hearing-and-sight')).toBe(true);
      expect(scout.actions.some((a) => a.id === 'multiattack')).toBe(true);

      const specter = compendium.requireMonster('specter');
      expect(specter.speed.fly).toBe(50);
      expect(specter.speed.hover).toBe(true);
      expect(specter.damageImmunities).toContain('necrotic');

      const spy = compendium.requireMonster('spy');
      expect(spy.traits.some((t) => t.id === 'cunning-action')).toBe(true);
      expect(spy.traits.some((t) => t.id === 'sneak-attack')).toBe(true);

      const berserker = compendium.requireMonster('berserker');
      expect(berserker.hitPoints.average).toBe(67);
      expect(berserker.traits.some((t) => t.id === 'reckless')).toBe(true);
      expect(berserker.aiArchetype).toBe('brute');
    });
  });

  describe('Headless Combat Action Execution', () => {
    it('executes Guard spear attack with piercing damage', () => {
      const guardData = compendium.requireMonster('guard');
      const targetData = compendium.requireMonster('goblin');
      const guard = createMonsterCombatant(guardData, 'guard-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5; // guarantee hit
      target.currentHp = 10;

      const state = buildCombatState([guard, target]);
      const res = executeMonsterAction({
        state,
        attackerId: guard.id,
        actionId: 'spear',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);
      expect(res.state.combatants[target.id]!.currentHp).toBeLessThan(10);
    });

    it('executes Noble rapier attack and verifies Parry reaction spec', () => {
      const nobleData = compendium.requireMonster('noble');
      const targetData = compendium.requireMonster('goblin');
      const noble = createMonsterCombatant(nobleData, 'noble-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([noble, target]);
      const res = executeMonsterAction({
        state,
        attackerId: noble.id,
        actionId: 'rapier',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);

      const parryReaction = nobleData.reactions?.find((r) => r.id === 'parry');
      expect(parryReaction).toBeDefined();
      expect(parryReaction?.effects[0]?.step).toBe('apply_active_effect');
    });

    it('executes Giant Bat bite attack', () => {
      const batData = compendium.requireMonster('giant-bat');
      const targetData = compendium.requireMonster('goblin');
      const bat = createMonsterCombatant(batData, 'bat-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([bat, target]);
      const res = executeMonsterAction({
        state,
        attackerId: bat.id,
        actionId: 'bite',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);
    });

    it('executes Giant Wolf Spider bite with piercing and poison damage saving throw', () => {
      const spiderData = compendium.requireMonster('giant-wolf-spider');
      const targetData = compendium.requireMonster('goblin');
      const spider = createMonsterCombatant(spiderData, 'spider-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 30;

      const state = buildCombatState([spider, target]);
      const res = executeMonsterAction({
        state,
        attackerId: spider.id,
        actionId: 'bite',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'poison')).toBe(true);
    });

    it('executes Warhorse Skeleton hooves attack and verifies bludgeoning vulnerability', () => {
      const horseData = compendium.requireMonster('warhorse-skeleton');
      const targetData = compendium.requireMonster('goblin');
      const horse = createMonsterCombatant(horseData, 'horse-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([horse, target]);
      const res = executeMonsterAction({
        state,
        attackerId: horse.id,
        actionId: 'hooves',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'bludgeoning')).toBe(true);

      // Verify bludgeoning vulnerability via calculateMitigatedDamage
      const dmgRes = calculateMitigatedDamage(horse, 10, 'bludgeoning');
      expect(dmgRes.vulnerabilityApplied).toBe(true);
      expect(dmgRes.finalAmount).toBe(20);
    });

    it('executes Shadow strength-drain with necrotic damage and radiant vulnerability', () => {
      const shadowData = compendium.requireMonster('shadow');
      const targetData = compendium.requireMonster('goblin');
      const shadow = createMonsterCombatant(shadowData, 'shadow-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([shadow, target]);
      const res = executeMonsterAction({
        state,
        attackerId: shadow.id,
        actionId: 'strength-drain',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);

      const radDmg = calculateMitigatedDamage(shadow, 8, 'radiant');
      expect(radDmg.vulnerabilityApplied).toBe(true);
      expect(radDmg.finalAmount).toBe(16);
    });

    it('executes Thug multiattack resolving 2 mace attacks sequentially', () => {
      const thugData = compendium.requireMonster('thug');
      const targetData = compendium.requireMonster('goblin');
      const thug = createMonsterCombatant(thugData, 'thug-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50; // survive both attacks

      const state = buildCombatState([thug, target]);
      const res = executeMonsterAction({
        state,
        attackerId: thug.id,
        actionId: 'multiattack',
        targetId: target.id,
      });

      expect(res.executedSubActions).toEqual(['mace', 'mace']);
      const attacks = res.events.filter((e) => e.type === 'ATTACK_RESOLVED');
      expect(attacks).toHaveLength(2);
      expect(res.state.combatants[target.id]!.currentHp).toBeLessThan(50);
    });

    it('executes Scout multiattack resolving 2 shortsword attacks and longbow', () => {
      const scoutData = compendium.requireMonster('scout');
      const targetData = compendium.requireMonster('goblin');
      const scout = createMonsterCombatant(scoutData, 'scout-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([scout, target]);
      const res = executeMonsterAction({
        state,
        attackerId: scout.id,
        actionId: 'multiattack',
        targetId: target.id,
      });

      expect(res.executedSubActions).toEqual(['shortsword', 'shortsword']);
      const attacks = res.events.filter((e) => e.type === 'ATTACK_RESOLVED');
      expect(attacks).toHaveLength(2);

      // Also verify longbow
      const bowRes = executeMonsterAction({
        state,
        attackerId: scout.id,
        actionId: 'longbow',
        targetId: target.id,
      });
      expect(bowRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
    });

    it('executes Specter life drain with necrotic damage', () => {
      const specterData = compendium.requireMonster('specter');
      const targetData = compendium.requireMonster('goblin');
      const specter = createMonsterCombatant(specterData, 'specter-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([specter, target]);
      const res = executeMonsterAction({
        state,
        attackerId: specter.id,
        actionId: 'life-drain',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);
    });

    it('executes Spy multiattack and hand crossbow', () => {
      const spyData = compendium.requireMonster('spy');
      const targetData = compendium.requireMonster('goblin');
      const spy = createMonsterCombatant(spyData, 'spy-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([spy, target]);
      const res = executeMonsterAction({
        state,
        attackerId: spy.id,
        actionId: 'multiattack',
        targetId: target.id,
      });

      expect(res.executedSubActions).toEqual(['shortsword', 'shortsword']);
      expect(res.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(2);

      const xbowRes = executeMonsterAction({
        state,
        attackerId: spy.id,
        actionId: 'hand-crossbow',
        targetId: target.id,
      });
      expect(xbowRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
    });

    it('executes Berserker greataxe attack with 1d12+3 slashing damage', () => {
      const berserkerData = compendium.requireMonster('berserker');
      const targetData = compendium.requireMonster('goblin');
      const berserker = createMonsterCombatant(berserkerData, 'berserker-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([berserker, target]);
      const res = executeMonsterAction({
        state,
        attackerId: berserker.id,
        actionId: 'greataxe',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'slashing')).toBe(true);
    });
  });

  describe('Biome & Procedural Table Wiring', () => {
    it('wires Wave 1 monsters into procedural dungeon generator themes', () => {
      const floorCatacombs = generateDungeonFloor({ depth: 1, seed: 1234, width: 32, height: 32 });
      expect(floorCatacombs.biome).toBe('catacombs');

      const floorTombs = generateDungeonFloor({ depth: 5, seed: 5678, width: 32, height: 32 });
      expect(floorTombs.biome).toBe('sunken_tombs');

      const floorMagma = generateDungeonFloor({ depth: 8, seed: 9012, width: 32, height: 32 });
      expect(floorMagma.biome).toBe('magma_caverns');
    });

    it('wires Wave 1 monsters into overworld terrain battle templates', () => {
      const forest = getBattleTerrainTemplate('forest');
      expect(forest.monsterPool).toContain('giant-wolf-spider');
      expect(forest.monsterPool).toContain('scout');

      const swamp = getBattleTerrainTemplate('swamp');
      expect(swamp.monsterPool).toContain('giant-bat');
      expect(swamp.monsterPool).toContain('shadow');
      expect(swamp.bossPool).toContain('specter');

      const mountains = getBattleTerrainTemplate('mountains');
      expect(mountains.monsterPool).toContain('berserker');

      const coast = getBattleTerrainTemplate('coast');
      expect(coast.monsterPool).toContain('guard');
      expect(coast.monsterPool).toContain('thug');
      expect(coast.monsterPool).toContain('spy');
      expect(coast.bossPool).toContain('noble');

      const plains = getBattleTerrainTemplate('plains');
      expect(plains.monsterPool).toContain('guard');
      expect(plains.monsterPool).toContain('warhorse-skeleton');
      expect(plains.bossPool).toContain('berserker');
    });

    it('wires Wave 1 monsters into bounty target pool', () => {
      expect(BOUNTY_TARGET_POOL).toContain('thug');
      expect(BOUNTY_TARGET_POOL).toContain('berserker');
      expect(BOUNTY_TARGET_POOL).toContain('specter');
    });
  });
});
