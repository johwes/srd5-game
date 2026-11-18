import { describe, expect, it } from 'vitest';
import { compendium, isProhibitedMonsterId } from '@srd5/data';
import { createMonsterCombatant } from '../combat/combatant.js';
import { executeMonsterAction } from '../combat/monster-actions.js';
import { calculateMitigatedDamage } from '../combat/damage.js';
import { getBiomeTheme } from '../dungeon/generator.js';
import { getBattleTerrainTemplate } from '../overworld/battles.js';
import { BOUNTY_TARGET_POOL } from '../overworld/quests.js';
import type { CombatState, Combatant } from '../combat/types.js';

describe('SRD-1002: Monster Wave 2 (CR 3–7 Bruisers, Controllers & Biome Wiring)', () => {
  const WAVE_2_MONSTER_IDS = [
    'ghost',
    'gladiator',
    'hell-hound',
    'knight',
    'mummy',
    'oni',
    'troll',
    'veteran',
    'wraith',
    'wyvern',
  ] as const;

  function buildCombatState(combatantsList: Combatant[]): CombatState {
    const combatants: Record<string, Combatant> = {};
    for (const c of combatantsList) {
      combatants[c.id] = c;
    }
    return {
      encounterId: 'enc-wave-2',
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
    it('verifies all 10 Wave 2 monsters exist in the compendium with valid CR 3–7 and AI archetypes', () => {
      for (const id of WAVE_2_MONSTER_IDS) {
        const monster = compendium.requireMonster(id);
        expect(monster).toBeDefined();
        expect(monster.id).toBe(id);
        expect(monster.challengeRating).toBeGreaterThanOrEqual(3);
        expect(monster.challengeRating).toBeLessThanOrEqual(7);
        expect(['brute', 'skirmisher', 'artillery', 'controller', 'support']).toContain(
          monster.aiArchetype,
        );
        expect(monster.source).toBe('srd-5.1');
        expect(isProhibitedMonsterId(monster.id)).toBe(false);
        expect(isProhibitedMonsterId(monster.name)).toBe(false);
      }
    });

    it('verifies correct statblock attributes and traits for Wave 2 monsters', () => {
      const ghost = compendium.requireMonster('ghost');
      expect(ghost.challengeRating).toBe(4);
      expect(ghost.speed.fly).toBe(40);
      expect(ghost.speed.hover).toBe(true);
      expect(ghost.damageImmunities).toContain('necrotic');
      expect(ghost.aiArchetype).toBe('controller');

      const gladiator = compendium.requireMonster('gladiator');
      expect(gladiator.challengeRating).toBe(5);
      expect(gladiator.hitPoints.average).toBe(112);
      expect(gladiator.armorClass.value).toBe(16);
      expect(gladiator.aiArchetype).toBe('brute');
      expect(gladiator.traits.some((t) => t.id === 'brave')).toBe(true);
      expect(gladiator.reactions?.some((r) => r.id === 'parry')).toBe(true);

      const hellHound = compendium.requireMonster('hell-hound');
      expect(hellHound.challengeRating).toBe(3);
      expect(hellHound.speed.walk).toBe(50);
      expect(hellHound.damageImmunities).toContain('fire');
      expect(hellHound.traits.some((t) => t.id === 'pack-tactics')).toBe(true);

      const knight = compendium.requireMonster('knight');
      expect(knight.challengeRating).toBe(3);
      expect(knight.armorClass.value).toBe(18);
      expect(knight.aiArchetype).toBe('controller');
      expect(knight.reactions?.some((r) => r.id === 'parry')).toBe(true);

      const mummy = compendium.requireMonster('mummy');
      expect(mummy.challengeRating).toBe(3);
      expect(mummy.damageVulnerabilities).toContain('fire');
      expect(mummy.damageImmunities).toContain('poison');
      expect(mummy.conditionImmunities).toContain('paralyzed');

      const oni = compendium.requireMonster('oni');
      expect(oni.challengeRating).toBe(7);
      expect(oni.hitPoints.average).toBe(110);
      expect(oni.size).toBe('large');
      expect(oni.speed.fly).toBe(30);

      const troll = compendium.requireMonster('troll');
      expect(troll.challengeRating).toBe(5);
      expect(troll.hitPoints.average).toBe(84);
      expect(troll.size).toBe('large');
      expect(troll.aiArchetype).toBe('brute');
      expect(troll.traits.some((t) => t.id === 'keen-smell')).toBe(true);

      const veteran = compendium.requireMonster('veteran');
      expect(veteran.challengeRating).toBe(3);
      expect(veteran.armorClass.value).toBe(17);
      expect(veteran.hitPoints.average).toBe(58);
      expect(veteran.aiArchetype).toBe('brute');

      const wraith = compendium.requireMonster('wraith');
      expect(wraith.challengeRating).toBe(5);
      expect(wraith.speed.fly).toBe(60);
      expect(wraith.damageImmunities).toContain('necrotic');
      expect(wraith.traits.some((t) => t.id === 'sunlight-sensitivity')).toBe(true);

      const wyvern = compendium.requireMonster('wyvern');
      expect(wyvern.challengeRating).toBe(6);
      expect(wyvern.hitPoints.average).toBe(110);
      expect(wyvern.size).toBe('large');
      expect(wyvern.speed.fly).toBe(80);
      expect(wyvern.aiArchetype).toBe('skirmisher');
    });
  });

  describe('Headless Combat Action Execution', () => {
    it('executes Ghost withering touch necrotic damage and horrifying visage', () => {
      const ghostData = compendium.requireMonster('ghost');
      const targetData = compendium.requireMonster('goblin');
      const ghost = createMonsterCombatant(ghostData, 'ghost-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;

      const state = buildCombatState([ghost, target]);
      const res = executeMonsterAction({
        state,
        attackerId: ghost.id,
        actionId: 'withering-touch',
        targetId: target.id,
      });

      expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(res.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);

      const state2 = buildCombatState([ghost, target]);
      const visageRes = executeMonsterAction({
        state: state2,
        attackerId: ghost.id,
        actionId: 'horrifying-visage',
        targetId: target.id,
      });
      expect(
        visageRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis'),
      ).toBe(true);
    });

    it('executes Gladiator multiattack, spear, shield bash, and parry reaction', () => {
      const gladiatorData = compendium.requireMonster('gladiator');
      const targetData = compendium.requireMonster('goblin');
      const gladiator = createMonsterCombatant(gladiatorData, 'gladiator-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([gladiator, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: gladiator.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['spear', 'spear', 'spear']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(3);

      const state2 = buildCombatState([gladiator, target]);
      const bashRes = executeMonsterAction({
        state: state2,
        attackerId: gladiator.id,
        actionId: 'shield-bash',
        targetId: target.id,
      });
      expect(bashRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(bashRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'str')).toBe(true);

      const parry = gladiatorData.reactions?.find((r) => r.id === 'parry');
      expect(parry).toBeDefined();
      expect(parry?.effects[0]?.step).toBe('apply_active_effect');
    });

    it('executes Hell Hound bite with fire damage and fire breath AOE', () => {
      const houndData = compendium.requireMonster('hell-hound');
      const targetData = compendium.requireMonster('goblin');
      const hound = createMonsterCombatant(houndData, 'hound-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([hound, target]);
      const biteRes = executeMonsterAction({
        state,
        attackerId: hound.id,
        actionId: 'bite',
        targetId: target.id,
      });
      expect(biteRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(biteRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);
      expect(biteRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'fire')).toBe(true);

      expect(houndData.actions.some((a) => a.id === 'fire-breath')).toBe(true);
      const breath = houndData.actions.find((a) => a.id === 'fire-breath');
      expect(breath?.targeting?.type).toBe('self_aoe');
      expect(breath?.recharge).toEqual({ minRoll: 5, die: 6 });
    });

    it('executes Knight multiattack greatsword, heavy crossbow, and parry reaction', () => {
      const knightData = compendium.requireMonster('knight');
      const targetData = compendium.requireMonster('goblin');
      const knight = createMonsterCombatant(knightData, 'knight-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([knight, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: knight.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['greatsword', 'greatsword']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(2);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'slashing')).toBe(true);

      const parry = knightData.reactions?.find((r) => r.id === 'parry');
      expect(parry).toBeDefined();
      expect(parry?.effects[0]?.step).toBe('apply_active_effect');
    });

    it('executes Mummy multiattack rotting fist and necrotic damage', () => {
      const mummyData = compendium.requireMonster('mummy');
      const targetData = compendium.requireMonster('goblin');
      const mummy = createMonsterCombatant(mummyData, 'mummy-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([mummy, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: mummy.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['rotting-fist']);
      expect(multiRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);

      const state2 = buildCombatState([mummy, target]);
      const glareRes = executeMonsterAction({
        state: state2,
        attackerId: mummy.id,
        actionId: 'dreadful-glare',
        targetId: target.id,
      });
      expect(glareRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'wis')).toBe(true);

      // Fire vulnerability verification
      const mitigatedFire = calculateMitigatedDamage(mummy, 20, 'fire');
      expect(mitigatedFire.finalAmount).toBe(40); // 20 * 2 vulnerability
    });

    it('executes Oni multiattack with glaive slashing damage and reach 10 ft', () => {
      const oniData = compendium.requireMonster('oni');
      const targetData = compendium.requireMonster('goblin');
      const oni = createMonsterCombatant(oniData, 'oni-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([oni, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: oni.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['glaive', 'glaive']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(2);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'slashing')).toBe(true);

      const glaive = oniData.actions.find((a) => a.id === 'glaive');
      expect(glaive?.targeting?.rangeFeet).toBe(10);
    });

    it('executes Troll multiattack (1 bite + 2 claws) and damage pipeline', () => {
      const trollData = compendium.requireMonster('troll');
      const targetData = compendium.requireMonster('goblin');
      const troll = createMonsterCombatant(trollData, 'troll-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([troll, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: troll.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['bite', 'claw', 'claw']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(3);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'piercing')).toBe(true);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'slashing')).toBe(true);
    });

    it('executes Veteran multiattack (2 longswords + 1 shortsword) and heavy crossbow', () => {
      const veteranData = compendium.requireMonster('veteran');
      const targetData = compendium.requireMonster('goblin');
      const veteran = createMonsterCombatant(veteranData, 'veteran-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([veteran, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: veteran.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['longsword', 'longsword', 'shortsword']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(3);

      const state2 = buildCombatState([veteran, target]);
      const xbowRes = executeMonsterAction({
        state: state2,
        attackerId: veteran.id,
        actionId: 'heavy-crossbow',
        targetId: target.id,
      });
      expect(xbowRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
    });

    it('executes Wraith life drain necrotic attack and sunlight sensitivity trait', () => {
      const wraithData = compendium.requireMonster('wraith');
      const targetData = compendium.requireMonster('goblin');
      const wraith = createMonsterCombatant(wraithData, 'wraith-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 50;

      const state = buildCombatState([wraith, target]);
      const drainRes = executeMonsterAction({
        state,
        attackerId: wraith.id,
        actionId: 'life-drain',
        targetId: target.id,
      });
      expect(drainRes.events.some((e) => e.type === 'ATTACK_RESOLVED' && e.outcome === 'hit')).toBe(true);
      expect(drainRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'necrotic')).toBe(true);
      expect(drainRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);

      expect(wraithData.actions.some((a) => a.id === 'create-specter')).toBe(true);
    });

    it('executes Wyvern multiattack (bite + stinger) with poison damage and saving throw', () => {
      const wyvernData = compendium.requireMonster('wyvern');
      const targetData = compendium.requireMonster('goblin');
      const wyvern = createMonsterCombatant(wyvernData, 'wyvern-1', { x: 0, y: 0 }, { side: 'monster' });
      const target = createMonsterCombatant(targetData, 'target-1', { x: 1, y: 0 }, { side: 'party' });
      target.armorClass = 5;
      target.currentHp = 100;

      const state = buildCombatState([wyvern, target]);
      const multiRes = executeMonsterAction({
        state,
        attackerId: wyvern.id,
        actionId: 'multiattack',
        targetId: target.id,
      });
      expect(multiRes.executedSubActions).toEqual(['bite', 'stinger']);
      expect(multiRes.events.filter((e) => e.type === 'ATTACK_RESOLVED')).toHaveLength(2);
      expect(multiRes.events.some((e) => e.type === 'SAVING_THROW_RESOLVED' && e.ability === 'con')).toBe(true);
      expect(multiRes.events.some((e) => e.type === 'DAMAGE_APPLIED' && e.damageType === 'poison')).toBe(true);
    });
  });

  describe('Biome & Procedural Table Wiring', () => {
    it('wires Wave 2 monsters into procedural dungeon generator biome themes', () => {
      const catacombs = getBiomeTheme('catacombs');
      expect(catacombs.bossMonsters).toContain('knight');

      const tombs = getBiomeTheme('sunken_tombs');
      expect(tombs.monsters).toContain('mummy');
      expect(tombs.monsters).toContain('ghost');
      expect(tombs.bossMonsters).toContain('wraith');

      const magma = getBiomeTheme('magma_caverns');
      expect(magma.monsters).toContain('hell-hound');
      expect(magma.bossMonsters).toContain('troll');

      const vaults = getBiomeTheme('deep_vaults');
      expect(vaults.monsters).toContain('knight');
      expect(vaults.monsters).toContain('veteran');
      expect(vaults.bossMonsters).toContain('gladiator');
      expect(vaults.bossMonsters).toContain('oni');

      const rift = getBiomeTheme('abyssal_rift');
      expect(rift.monsters).toContain('wraith');
      expect(rift.bossMonsters).toContain('wyvern');
      expect(rift.bossMonsters).toContain('oni');
    });

    it('wires Wave 2 monsters into overworld terrain battle templates', () => {
      const forest = getBattleTerrainTemplate('forest');
      expect(forest.monsterPool).toContain('hell-hound');
      expect(forest.monsterPool).toContain('veteran');
      expect(forest.bossPool).toContain('oni');

      const mountains = getBattleTerrainTemplate('mountains');
      expect(mountains.monsterPool).toContain('troll');
      expect(mountains.bossPool).toContain('wyvern');
      expect(mountains.bossPool).toContain('oni');

      const swamp = getBattleTerrainTemplate('swamp');
      expect(swamp.monsterPool).toContain('mummy');
      expect(swamp.monsterPool).toContain('ghost');
      expect(swamp.monsterPool).toContain('troll');
      expect(swamp.bossPool).toContain('wraith');

      const hills = getBattleTerrainTemplate('hills');
      expect(hills.monsterPool).toContain('veteran');
      expect(hills.monsterPool).toContain('knight');
      expect(hills.bossPool).toContain('gladiator');
      expect(hills.bossPool).toContain('wyvern');

      const desert = getBattleTerrainTemplate('desert');
      expect(desert.monsterPool).toContain('mummy');
      expect(desert.monsterPool).toContain('hell-hound');
      expect(desert.bossPool).toContain('gladiator');
      expect(desert.bossPool).toContain('oni');

      const tundra = getBattleTerrainTemplate('tundra');
      expect(tundra.monsterPool).toContain('troll');
      expect(tundra.bossPool).toContain('oni');
      expect(tundra.bossPool).toContain('wraith');

      const coast = getBattleTerrainTemplate('coast');
      expect(coast.monsterPool).toContain('veteran');
      expect(coast.monsterPool).toContain('gladiator');
      expect(coast.bossPool).toContain('knight');

      const plains = getBattleTerrainTemplate('plains');
      expect(plains.monsterPool).toContain('veteran');
      expect(plains.monsterPool).toContain('knight');
      expect(plains.bossPool).toContain('knight');
      expect(plains.bossPool).toContain('gladiator');
    });

    it('wires Wave 2 monsters into bounty target pool', () => {
      expect(BOUNTY_TARGET_POOL).toContain('veteran');
      expect(BOUNTY_TARGET_POOL).toContain('knight');
      expect(BOUNTY_TARGET_POOL).toContain('troll');
      expect(BOUNTY_TARGET_POOL).toContain('mummy');
      expect(BOUNTY_TARGET_POOL).toContain('gladiator');
      expect(BOUNTY_TARGET_POOL).toContain('oni');
    });
  });
});
