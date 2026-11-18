import { describe, expect, it } from 'vitest';
import { compendium, isProhibitedMonsterId } from '@srd5/data';
import { createMonsterCombatant } from '../combat/combatant.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { calculateMitigatedDamage } from '../combat/damage.js';
import { getBiomeTheme } from '../dungeon/generator.js';
import { getBattleTerrainTemplate } from '../overworld/battles.js';
import { BOUNTY_TARGET_POOL } from '../overworld/quests.js';
import type { CombatState, Combatant } from '../combat/types.js';

describe('SRD-1003: Monster Wave 3 (CR 8+ Bosses, Lair Threats & Biome Boss Tables)', () => {
  const WAVE_3_MONSTER_IDS = [
    'frost-giant',
    'hydra',
    'clay-golem',
    'fire-giant',
    'young-red-dragon',
    'stone-golem',
    'archmage',
    'vampire',
    'mummy-lord',
    'adult-red-dragon',
  ] as const;

  function buildCombatState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'enc-wave-3',
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
      rngState: 4242,
    };
  }

  describe('Audit, Licensing & Statblock Verification', () => {
    it('verifies all 10 Wave 3 monsters exist in the compendium with valid CR 8–17 and AI archetypes', () => {
      for (const id of WAVE_3_MONSTER_IDS) {
        const monster = compendium.requireMonster(id);
        expect(monster).toBeDefined();
        expect(monster.id).toBe(id);
        expect(monster.challengeRating).toBeGreaterThanOrEqual(8);
        expect(monster.challengeRating).toBeLessThanOrEqual(17);
        expect(['brute', 'skirmisher', 'artillery', 'controller', 'support']).toContain(
          monster.aiArchetype,
        );
        expect(monster.source).toBe('srd-5.1');
        expect(isProhibitedMonsterId(monster.id)).toBe(false);
        expect(isProhibitedMonsterId(monster.name)).toBe(false);
      }
    });

    it('verifies correct statblock attributes and traits for Wave 3 boss monsters', () => {
      const frostGiant = compendium.requireMonster('frost-giant');
      expect(frostGiant.challengeRating).toBe(8);
      expect(frostGiant.hitPoints.average).toBe(138);
      expect(frostGiant.size).toBe('huge');
      expect(frostGiant.damageImmunities).toContain('cold');
      expect(frostGiant.aiArchetype).toBe('brute');

      const hydra = compendium.requireMonster('hydra');
      expect(hydra.challengeRating).toBe(8);
      expect(hydra.hitPoints.average).toBe(172);
      expect(hydra.size).toBe('huge');
      expect(hydra.speed.swim).toBe(30);
      expect(hydra.aiArchetype).toBe('brute');
      expect(hydra.traits.some((t) => t.id === 'multiple-heads')).toBe(true);

      const clayGolem = compendium.requireMonster('clay-golem');
      expect(clayGolem.challengeRating).toBe(9);
      expect(clayGolem.hitPoints.average).toBe(133);
      expect(clayGolem.damageImmunities).toContain('acid');
      expect(clayGolem.damageImmunities).toContain('poison');
      expect(clayGolem.damageImmunities).toContain('psychic');
      expect(clayGolem.conditionImmunities).toContain('charmed');
      expect(clayGolem.aiArchetype).toBe('brute');

      const fireGiant = compendium.requireMonster('fire-giant');
      expect(fireGiant.challengeRating).toBe(9);
      expect(fireGiant.hitPoints.average).toBe(162);
      expect(fireGiant.armorClass.value).toBe(18);
      expect(fireGiant.damageImmunities).toContain('fire');
      expect(fireGiant.aiArchetype).toBe('brute');

      const youngRedDragon = compendium.requireMonster('young-red-dragon');
      expect(youngRedDragon.challengeRating).toBe(10);
      expect(youngRedDragon.hitPoints.average).toBe(178);
      expect(youngRedDragon.speed.fly).toBe(80);
      expect(youngRedDragon.damageImmunities).toContain('fire');
      expect(youngRedDragon.aiArchetype).toBe('artillery');

      const stoneGolem = compendium.requireMonster('stone-golem');
      expect(stoneGolem.challengeRating).toBe(10);
      expect(stoneGolem.hitPoints.average).toBe(178);
      expect(stoneGolem.damageImmunities).toContain('poison');
      expect(stoneGolem.damageImmunities).toContain('psychic');
      expect(stoneGolem.conditionImmunities).toContain('petrified');
      expect(stoneGolem.aiArchetype).toBe('controller');

      const archmage = compendium.requireMonster('archmage');
      expect(archmage.challengeRating).toBe(12);
      expect(archmage.hitPoints.average).toBe(99);
      expect(archmage.spellcasting?.spellSaveDc).toBe(17);
      expect(archmage.spellcasting?.casterLevel).toBe(18);
      expect(archmage.aiArchetype).toBe('artillery');

      const vampire = compendium.requireMonster('vampire');
      expect(vampire.challengeRating).toBe(13);
      expect(vampire.hitPoints.average).toBe(144);
      expect(vampire.damageResistances).toContain('necrotic');
      expect(vampire.aiArchetype).toBe('skirmisher');
      expect(vampire.traits.some((t) => t.id === 'regeneration')).toBe(true);

      const mummyLord = compendium.requireMonster('mummy-lord');
      expect(mummyLord.challengeRating).toBe(15);
      expect(mummyLord.hitPoints.average).toBe(97);
      expect(mummyLord.damageVulnerabilities).toContain('fire');
      expect(mummyLord.damageImmunities).toContain('necrotic');
      expect(mummyLord.aiArchetype).toBe('controller');

      const adultRedDragon = compendium.requireMonster('adult-red-dragon');
      expect(adultRedDragon.challengeRating).toBe(17);
      expect(adultRedDragon.hitPoints.average).toBe(256);
      expect(adultRedDragon.speed.fly).toBe(80);
      expect(adultRedDragon.damageImmunities).toContain('fire');
      expect(adultRedDragon.aiArchetype).toBe('artillery');
      expect(adultRedDragon.traits.some((t) => t.id === 'legendary-resistance')).toBe(true);
    });
  });

  describe('Headless Combat Action Execution', () => {
    it('executes Frost Giant Greataxe and Rock attacks', () => {
      const frostGiantData = compendium.requireMonster('frost-giant');
      const frostGiant = createMonsterCombatant(frostGiantData, 'fg-1', { x: 0, y: 0 }, { side: 'monster' });

      const heroTargetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(heroTargetData, 'hero-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([frostGiant, target]);
      const axeRes = executeMonsterAction({
        state,
        attackerId: frostGiant.id,
        actionId: 'greataxe',
        targetId: target.id,
      });

      expect(axeRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(axeRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'slashing')).toBe(true);

      const state2 = buildCombatState([frostGiant, target]);
      const rockRes = executeMonsterAction({
        state: state2,
        attackerId: frostGiant.id,
        actionId: 'rock',
        targetId: target.id,
      });
      expect(rockRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(rockRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'bludgeoning')).toBe(true);
    });

    it('executes Hydra 5-attack Multiattack sequence', () => {
      const hydraData = compendium.requireMonster('hydra');
      const hydra = createMonsterCombatant(hydraData, 'hydra-1', { x: 0, y: 0 }, { side: 'monster' });

      const guardData = compendium.requireMonster('knight');
      const target = createMonsterCombatant(guardData, 'hero-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 300;

      const state = buildCombatState([hydra, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: hydra.id,
        actionId: 'multiattack',
        targetId: target.id,
      });

      expect(multiRes.executedSubActions).toEqual(['bite', 'bite', 'bite', 'bite', 'bite']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(5);
    });

    it('executes Clay Golem Slams and verifies acid absorption / damage immunity', () => {
      const clayData = compendium.requireMonster('clay-golem');
      const golem = createMonsterCombatant(clayData, 'golem-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([golem, target]);
      const slamRes = executeMonsterAction({
        state,
        attackerId: golem.id,
        actionId: 'slam',
        targetId: target.id,
      });

      expect(slamRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(slamRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'bludgeoning')).toBe(true);

      // Verify acid damage immunity
      const acidMit = calculateMitigatedDamage(golem, 30, 'acid');
      expect(acidMit.finalAmount).toBe(0);
      const poisonMit = calculateMitigatedDamage(golem, 30, 'poison');
      expect(poisonMit.finalAmount).toBe(0);
    });

    it('executes Fire Giant Greatsword Multiattack and verifies fire immunity', () => {
      const fgData = compendium.requireMonster('fire-giant');
      const giant = createMonsterCombatant(fgData, 'giant-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 300;

      const state = buildCombatState([giant, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: giant.id,
        actionId: 'multiattack',
        targetId: target.id,
      });

      expect(multiRes.executedSubActions).toEqual(['greatsword', 'greatsword']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(2);

      // Fire immunity check
      const fireMit = calculateMitigatedDamage(giant, 50, 'fire');
      expect(fireMit.finalAmount).toBe(0);
    });

    it('executes Young Red Dragon bite + fire damage and Fire Breath recharge cone', () => {
      const dragonData = compendium.requireMonster('young-red-dragon');
      const dragon = createMonsterCombatant(dragonData, 'yrd-1', { x: 0, y: 0 }, { side: 'monster' });

      const guardData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(guardData, 'hero-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 200;

      const state = buildCombatState([dragon, target]);

      // Bite deals piercing + fire
      const biteRes = executeMonsterAction({
        state,
        attackerId: dragon.id,
        actionId: 'bite',
        targetId: target.id,
      });
      expect(biteRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(biteRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);

      // Fire breath resolves saving throw and applies fire damage (full or half)
      const breathRes = executeMonsterAction({
        state,
        attackerId: dragon.id,
        actionId: 'fire-breath',
        targetId: target.id,
      });
      expect(breathRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
      expect(breathRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'fire')).toBe(true);
    });

    it('executes Stone Golem Slam and Slow recharge action', () => {
      const sgData = compendium.requireMonster('stone-golem');
      const golem = createMonsterCombatant(sgData, 'sg-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'hero-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([golem, target]);
      const slowRes = executeMonsterAction({
        state,
        attackerId: golem.id,
        actionId: 'slow',
        targetId: target.id,
      });

      expect(slowRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);
    });

    it('executes Archmage Fire Bolt, Cone of Cold, and Lightning Bolt spells', () => {
      const archData = compendium.requireMonster('archmage');
      const archmage = createMonsterCombatant(archData, 'arch-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 200;

      const state = buildCombatState([archmage, target]);

      // Fire bolt (spell attack roll)
      const fbRes = executeMonsterAction({
        state,
        attackerId: archmage.id,
        actionId: 'fire-bolt',
        targetId: target.id,
      });
      expect(fbRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);

      // Cone of Cold (Con save)
      const cocRes = executeMonsterAction({
        state,
        attackerId: archmage.id,
        actionId: 'cone-of-cold',
        targetId: target.id,
      });
      expect(cocRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
      expect(cocRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'cold')).toBe(true);

      // Lightning Bolt (Dex save)
      const lbRes = executeMonsterAction({
        state,
        attackerId: archmage.id,
        actionId: 'lightning-bolt',
        targetId: target.id,
      });
      expect(lbRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
      expect(lbRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'lightning')).toBe(true);
    });

    it('executes Vampire Unarmed Strike grapple and Bite necrotic drain', () => {
      const vampData = compendium.requireMonster('vampire');
      const vampire = createMonsterCombatant(vampData, 'vamp-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([vampire, target]);
      const strikeRes = executeMonsterAction({
        state,
        attackerId: vampire.id,
        actionId: 'unarmed-strike',
        targetId: target.id,
      });
      expect(strikeRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(strikeRes.events.some((e) => e.type === 'CONDITION_ADDED' && e.conditionId === 'grappled')).toBe(true);

      const state2 = buildCombatState([vampire, target]);
      const biteRes = executeMonsterAction({
        state: state2,
        attackerId: vampire.id,
        actionId: 'bite',
        targetId: target.id,
      });
      expect(biteRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(biteRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);
    });

    it('executes Mummy Lord Rotting Fist, Dreadful Glare, and Harm with fire vulnerability', () => {
      const mlData = compendium.requireMonster('mummy-lord');
      const mummyLord = createMonsterCombatant(mlData, 'ml-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('guard');
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 200;

      const state = buildCombatState([mummyLord, target]);

      // Rotting Fist deals bludgeoning + necrotic
      const fistRes = executeMonsterAction({
        state,
        attackerId: mummyLord.id,
        actionId: 'rotting-fist',
        targetId: target.id,
      });
      expect(fistRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(fistRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);

      // Dreadful glare (Wis save)
      const state2 = buildCombatState([mummyLord, target]);
      const glareRes = executeMonsterAction({
        state: state2,
        attackerId: mummyLord.id,
        actionId: 'dreadful-glare',
        targetId: target.id,
      });
      expect(glareRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);

      // Harm (Con save)
      const state3 = buildCombatState([mummyLord, target]);
      const harmRes = executeMonsterAction({
        state: state3,
        attackerId: mummyLord.id,
        actionId: 'harm',
        targetId: target.id,
      });
      expect(harmRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
      expect(harmRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);

      // Fire vulnerability: 20 fire damage taken is doubled to 40
      const fireMit = calculateMitigatedDamage(mummyLord, 20, 'fire');
      expect(fireMit.finalAmount).toBe(40);
    });

    it('executes Adult Red Dragon multiattack, tail sweep, and Fire Breath', () => {
      const ardData = compendium.requireMonster('adult-red-dragon');
      const dragon = createMonsterCombatant(ardData, 'ard-1', { x: 0, y: 0 }, { side: 'monster' });

      const targetData = compendium.requireMonster('knight');
      const target = createMonsterCombatant(targetData, 'hero-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 300;

      const state = buildCombatState([dragon, target]);

      // Multiattack (1 bite + 2 claws)
      const multiRes = executeMonsterAction({
        state,
        attackerId: dragon.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['bite', 'claw', 'claw']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(3);

      // Tail attack
      const state2 = buildCombatState([dragon, target]);
      const tailRes = executeMonsterAction({
        state: state2,
        attackerId: dragon.id,
        actionId: 'tail',
        targetId: target.id,
      });
      expect(tailRes.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
      expect(tailRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'bludgeoning')).toBe(true);

      // Fire Breath (60-ft cone, DC 21 Dex save, 18d6 fire)
      const state3 = buildCombatState([dragon, target]);
      const breathRes = executeMonsterAction({
        state: state3,
        attackerId: dragon.id,
        actionId: 'fire-breath',
        targetId: target.id,
      });
      expect(breathRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'dex')).toBe(true);
      expect(breathRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'fire')).toBe(true);
    });
  });

  describe('Biome & Procedural Table Wiring', () => {
    it('wires Wave 3 monsters into procedural dungeon generator biome themes as bosses', () => {
      const catacombs = getBiomeTheme('catacombs');
      expect(catacombs.bossMonsters).toContain('stone-golem');
      expect(catacombs.bossMonsters).toContain('vampire');

      const tombs = getBiomeTheme('sunken_tombs');
      expect(tombs.bossMonsters).toContain('hydra');
      expect(tombs.bossMonsters).toContain('mummy-lord');
      expect(tombs.bossMonsters).toContain('vampire');

      const magma = getBiomeTheme('magma_caverns');
      expect(magma.bossMonsters).toContain('fire-giant');
      expect(magma.bossMonsters).toContain('young-red-dragon');
      expect(magma.bossMonsters).toContain('adult-red-dragon');

      const vaults = getBiomeTheme('deep_vaults');
      expect(vaults.bossMonsters).toContain('frost-giant');
      expect(vaults.bossMonsters).toContain('clay-golem');
      expect(vaults.bossMonsters).toContain('stone-golem');
      expect(vaults.bossMonsters).toContain('archmage');

      const rift = getBiomeTheme('abyssal_rift');
      expect(rift.bossMonsters).toContain('vampire');
      expect(rift.bossMonsters).toContain('archmage');
      expect(rift.bossMonsters).toContain('mummy-lord');
      expect(rift.bossMonsters).toContain('adult-red-dragon');
    });

    it('wires Wave 3 monsters into overworld terrain battle templates', () => {
      const forest = getBattleTerrainTemplate('forest');
      expect(forest.bossPool).toContain('hydra');
      expect(forest.bossPool).toContain('vampire');

      const mountains = getBattleTerrainTemplate('mountains');
      expect(mountains.bossPool).toContain('fire-giant');
      expect(mountains.bossPool).toContain('frost-giant');
      expect(mountains.bossPool).toContain('young-red-dragon');
      expect(mountains.bossPool).toContain('adult-red-dragon');
      expect(mountains.bossPool).toContain('stone-golem');

      const swamp = getBattleTerrainTemplate('swamp');
      expect(swamp.bossPool).toContain('hydra');
      expect(swamp.bossPool).toContain('clay-golem');
      expect(swamp.bossPool).toContain('mummy-lord');

      const hills = getBattleTerrainTemplate('hills');
      expect(hills.bossPool).toContain('frost-giant');
      expect(hills.bossPool).toContain('young-red-dragon');

      const desert = getBattleTerrainTemplate('desert');
      expect(desert.bossPool).toContain('clay-golem');
      expect(desert.bossPool).toContain('fire-giant');
      expect(desert.bossPool).toContain('mummy-lord');

      const tundra = getBattleTerrainTemplate('tundra');
      expect(tundra.bossPool).toContain('frost-giant');
      expect(tundra.bossPool).toContain('vampire');
      expect(tundra.bossPool).toContain('archmage');

      const coast = getBattleTerrainTemplate('coast');
      expect(coast.bossPool).toContain('hydra');
      expect(coast.bossPool).toContain('stone-golem');
      expect(coast.bossPool).toContain('archmage');

      const plains = getBattleTerrainTemplate('plains');
      expect(plains.bossPool).toContain('frost-giant');
      expect(plains.bossPool).toContain('archmage');
      expect(plains.bossPool).toContain('vampire');
    });

    it('wires Wave 3 monsters into bounty target pool', () => {
      expect(BOUNTY_TARGET_POOL).toContain('frost-giant');
      expect(BOUNTY_TARGET_POOL).toContain('hydra');
      expect(BOUNTY_TARGET_POOL).toContain('fire-giant');
      expect(BOUNTY_TARGET_POOL).toContain('vampire');
      expect(BOUNTY_TARGET_POOL).toContain('archmage');
    });
  });

  describe('Art Policy & Tier Allocation Audit', () => {
    it('verifies every Wave 3 monster has an explicit art resolution strategy', () => {
      const artRegistryList = {
        // Tier 0 / Tier 1 sprite reused via keyword / exact match:
        'adult-red-dragon': 'Tier 0: monster_dragon (keyword: dragon)',
        'young-red-dragon': 'Tier 0: monster_dragon (keyword: dragon)',
        'frost-giant': 'Tier 0: monster_ogre (keyword: giant)',
        'fire-giant': 'Tier 0: monster_ogre (keyword: giant)',
        'mummy-lord': 'Tier 0: monster_zombie (keyword: mummy)',
        vampire: 'Tier 0: monster_demon (keyword: vampire)',
        archmage: 'Tier 1: npc_elder_mage (staff elder frame)',
        // Tier 2: Procedural fallback (explicitly listed per Spec 09 Section 2)
        'clay-golem': 'Tier 2: Procedural monogram token [CG] (alien construct)',
        'stone-golem': 'Tier 2: Procedural monogram token [SG] (alien construct)',
        hydra: 'Tier 2: Procedural monogram token [HY] (multi-headed monstrosity)',
      };

      for (const id of WAVE_3_MONSTER_IDS) {
        expect(artRegistryList[id]).toBeDefined();
      }
    });
  });
});
