import { describe, expect, it } from 'vitest';
import {
  getSkillPassiveTier,
  isPassiveTierAtLeast,
  getReligionHealingReceivedBonus,
  getReligionHealingReceivedBonusFor,
  getReligionConsecratedSaveBonus,
  getReligionShrineBlessingExtraRests,
  getHistoryFreeRecallsPerDelve,
  hasHistoryBossResistanceReveal,
  getNatureForageRationBonus,
  getNatureForageRationBonusFor,
  getPartyNatureForageBonus,
  hasNatureAdvantageVsNaturalAffliction,
  getNatureCampSafetySteps,
  getAnimalHandlingAttitudeShift,
  getAnimalHandlingOffRoadDiscount,
  getAnimalHandlingCampPerceptionBonus,
  getMedicineHitDieBonusPerDie,
  getMedicineHitDieBonusPerDieFor,
  hasMedicineFreeDiagnosis,
  hasMedicineStabilizeAdvantage,
  getIntimidationMoraleThreshold,
  hasIntimidationDeceptionFallback,
  INTIMIDATION_DECEPTION_FALLBACK_DC_BONUS,
  hasInsightPassiveCue,
  hasInsightIntentBandReveal,
  getIntentBand,
  hasPerformanceTavernRewards,
  getPerformanceDistractUsesPerCombat,
  getPerformanceTavernPayout,
  summarizePartyPassives,
} from '../skills/skill-passives.js';
import { applyHealing } from '../combat/damage.js';
import type { CombatState, Combatant } from '../combat/types.js';
import { spendHitDiceForHero } from '../dungeon/rest.js';
import { generateDungeonFloor } from '../dungeon/generator.js';
import { generateFloorRecallTags, KnowledgeRecallSpecSchema } from '../dungeon/recall.js';
import { createOverworldTravelState, forageForRations } from '../overworld/travel.js';
import type { OverworldMap } from '../overworld/schemas.js';

function sheetWith(levels: Record<string, 'none' | 'half' | 'proficient' | 'expertise'>) {
  const skills: Record<string, any> = {};
  for (const [skill, proficiencyLevel] of Object.entries(levels)) {
    skills[skill] = {
      skill,
      ability: 'wis',
      proficiencyLevel,
      abilityModifier: 2,
      proficiencyBonus: 2,
      flatBonus: 0,
      totalBonus: proficiencyLevel === 'expertise' ? 6 : proficiencyLevel === 'proficient' ? 4 : 2,
      passiveScore: 10,
      rollMode: 'normal',
      breakdown: [],
    };
  }
  return {
    abilities: {
      str: { score: 10, modifier: 0 },
      dex: { score: 14, modifier: 2 },
      con: { score: 12, modifier: 1 },
      int: { score: 12, modifier: 1 },
      wis: { score: 14, modifier: 2 },
      cha: { score: 10, modifier: 0 },
    },
    proficiencyBonus: 2,
    proficiencies: { tools: [], expertise: [], skills: [], armor: [], weapons: [], savingThrows: [] },
    skills,
    featureIds: [],
    deathSaves: { successes: 0, failures: 0 },
    activeConditions: [],
  } as any;
}

function makeCombatant(id: string, levels: Record<string, 'none' | 'half' | 'proficient' | 'expertise'> = {}, hp = 20): Combatant {
  return {
    id,
    name: id,
    side: 'party',
    size: 'medium',
    position: { x: 0, y: 0 },
    speedFeet: 30,
    currentHp: hp,
    maxHp: 20,
    tempHp: 0,
    armorClass: 14,
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
    characterSheet: sheetWith(levels),
  } as unknown as Combatant;
}

function combatStateWith(target: Combatant): CombatState {
  return {
    combatants: { [target.id]: target },
    initiativeOrder: [],
    activeCombatantId: null,
    round: 1,
    rngState: 7,
    outcome: 'ongoing',
  } as unknown as CombatState;
}

describe('SRD-1213 standing skill passives — tier resolution', () => {
  it('maps proficient/expertise to dividends and none/half to nothing', () => {
    expect(getSkillPassiveTier(makeCombatant('a', { religion: 'proficient' }), 'religion')).toBe('proficient');
    expect(getSkillPassiveTier(makeCombatant('b', { religion: 'expertise' }), 'religion')).toBe('expert');
    expect(getSkillPassiveTier(makeCombatant('c', { religion: 'none' }), 'religion')).toBe('none');
    expect(getSkillPassiveTier(makeCombatant('d', { religion: 'half' }), 'religion')).toBe('none');
    // Missing sheet entry → none.
    expect(getSkillPassiveTier(makeCombatant('e'), 'religion')).toBe('none');
    expect(isPassiveTierAtLeast('expert', 'proficient')).toBe(true);
    expect(isPassiveTierAtLeast('proficient', 'expert')).toBe(false);
    expect(isPassiveTierAtLeast('none', 'proficient')).toBe(false);
  });

  it('resolves monsters via the monster skill map (listed → proficient)', () => {
    const beast = makeCombatant('beast');
    (beast as any).monsterData = { skills: { 'animal-handling': 3 } };
    (beast as any).characterSheet = undefined;
    expect(getSkillPassiveTier(beast, 'animal-handling')).toBe('proficient');
    expect(getSkillPassiveTier(beast, 'religion')).toBe('none');
  });
});

describe('SRD-1213 religion dividend', () => {
  it('grants +1 (prof) / +2 (expert) when receiving magical healing', () => {
    expect(getReligionHealingReceivedBonus('none')).toBe(0);
    expect(getReligionHealingReceivedBonus('proficient')).toBe(1);
    expect(getReligionHealingReceivedBonus('expert')).toBe(2);
    expect(getReligionHealingReceivedBonusFor(makeCombatant('p', { religion: 'proficient' }))).toBe(1);
    expect(getReligionConsecratedSaveBonus('proficient')).toBe(0);
    expect(getReligionConsecratedSaveBonus('expert')).toBe(1);
    expect(getReligionShrineBlessingExtraRests('proficient')).toBe(0);
    expect(getReligionShrineBlessingExtraRests('expert')).toBe(1);
  });

  it('applyHealing adds the bonus automatically and caps at maxHp', () => {
    const target = makeCombatant('cleric', { religion: 'proficient' }, 10);
    const res = applyHealing({ state: combatStateWith(target), targetId: 'cleric', amount: 5 });
    expect(res.amount).toBe(6);
    expect(res.hpAfter).toBe(16);

    const expert = makeCombatant('priest', { religion: 'expertise' }, 10);
    const resExpert = applyHealing({ state: combatStateWith(expert), targetId: 'priest', amount: 5 });
    expect(resExpert.amount).toBe(7);

    const untrained = makeCombatant('rogue', {}, 10);
    const resRaw = applyHealing({ state: combatStateWith(untrained), targetId: 'rogue', amount: 5 });
    expect(resRaw.amount).toBe(5);

    // Cap at maxHp: 19 + 5 + 1 clamps to 20.
    const nearFull = makeCombatant('cleric2', { religion: 'proficient' }, 19);
    const resCapped = applyHealing({ state: combatStateWith(nearFull), targetId: 'cleric2', amount: 5 });
    expect(resCapped.hpAfter).toBe(20);
    expect(resCapped.amount).toBe(1);

    // Opt-out preserves raw tabletop math.
    const bypass = applyHealing({
      state: combatStateWith(makeCombatant('cleric3', { religion: 'proficient' }, 10)),
      targetId: 'cleric3',
      amount: 5,
      applyPassiveBonus: false,
    });
    expect(bypass.amount).toBe(5);
  });
});

describe('SRD-1213 medicine dividend', () => {
  it('grants +1 per Hit Die (prof and expert alike)', () => {
    expect(getMedicineHitDieBonusPerDie('none')).toBe(0);
    expect(getMedicineHitDieBonusPerDie('proficient')).toBe(1);
    expect(getMedicineHitDieBonusPerDie('expert')).toBe(1);
    expect(getMedicineHitDieBonusPerDieFor(makeCombatant('m', { medicine: 'proficient' }))).toBe(1);
    expect(hasMedicineFreeDiagnosis('proficient')).toBe(true);
    expect(hasMedicineFreeDiagnosis('none')).toBe(false);
    expect(hasMedicineStabilizeAdvantage('proficient')).toBe(false);
    expect(hasMedicineStabilizeAdvantage('expert')).toBe(true);
  });

  function hdHero(id: string, medicine: 'none' | 'proficient' | 'expertise'): Combatant {
    const hero = makeCombatant(id, { medicine }, 5);
    (hero.characterSheet as any).hitDicePools = [{ dieSize: 8, total: 3, spent: 0, available: 3 }];
    return hero;
  }

  it('spendHitDiceForHero heals +1 per die for proficient medics (same seed)', () => {
    const plain = hdHero('plain', 'none');
    const medic = hdHero('medic', 'proficient');
    const plainRes = spendHitDiceForHero(structuredClone(plain), 2, 1234);
    const medicRes = spendHitDiceForHero(structuredClone(medic), 2, 1234);
    expect(medicRes.diceSpent).toBe(plainRes.diceSpent);
    expect(medicRes.diceSpent).toBe(2);
    // Identical rolls + conMod; the only delta is +1 per die.
    expect(medicRes.hpRegained - plainRes.hpRegained).toBe(2);
  });

  it('expert medics gain the same +1 per die (no double-stack)', () => {
    const prof = hdHero('prof', 'proficient');
    const expert = hdHero('expert', 'expertise');
    const profRes = spendHitDiceForHero(structuredClone(prof), 2, 99);
    const expertRes = spendHitDiceForHero(structuredClone(expert), 2, 99);
    expect(expertRes.hpRegained).toBe(profRes.hpRegained);
  });
});

describe('SRD-1213 nature / animal-handling dividends', () => {
  it('nature: +1 ration, affliction advantage, expert camp safety', () => {
    expect(getNatureForageRationBonus('none')).toBe(0);
    expect(getNatureForageRationBonus('proficient')).toBe(1);
    expect(getNatureForageRationBonus('expert')).toBe(1);
    expect(getNatureForageRationBonusFor(makeCombatant('n', { nature: 'proficient' }))).toBe(1);
    expect(hasNatureAdvantageVsNaturalAffliction('proficient')).toBe(true);
    expect(hasNatureAdvantageVsNaturalAffliction('none')).toBe(false);
    expect(getNatureCampSafetySteps('proficient')).toBe(0);
    expect(getNatureCampSafetySteps('expert')).toBe(1);
  });

  it('party forage bonus takes the highest conscious member (no stacking)', () => {
    const party = {
      a: makeCombatant('a', { nature: 'proficient' }),
      b: makeCombatant('b', { nature: 'expertise' }),
      c: makeCombatant('c'),
    };
    expect(getPartyNatureForageBonus(party)).toBe(1);
    const dead: Record<string, Combatant> = {
      a: { ...makeCombatant('a', { nature: 'expertise' }), isDead: true, currentHp: 0 },
    };
    expect(getPartyNatureForageBonus(dead)).toBe(0);
  });

  function smallMap(): OverworldMap {
    const tiles: OverworldMap['tiles'] = {};
    for (let r = 0; r < 3; r++) {
      for (let q = 0; q < 3; q++) {
        tiles[`${q},${r}`] = { q, r, terrain: 'plains', movementCost: 1, elevation: 0.5 };
      }
    }
    return { worldSeed: 1234, worldName: 'Testrealm', width: 3, height: 3, tiles, pois: {}, factions: {} };
  }

  it('forageForRations adds the nature bonus on success only', () => {
    const map = smallMap();
    const base = createOverworldTravelState(map, { seed: 2026, initialWeather: 'clear' });
    const plain = forageForRations(base, map, { survivalBonus: 5 });
    expect(plain.success).toBe(true);
    const withBonus = forageForRations(base, map, { survivalBonus: 5, natureBonusRations: 1 });
    expect(withBonus.rationsFound).toBe(plain.rationsFound + 1);
    expect(withBonus.state.rations).toBe(base.rations + plain.rationsFound + 1);
    // Failure yields nothing even with the bonus.
    const failBase = createOverworldTravelState(map, { seed: 77, initialWeather: 'storm' });
    const fail = forageForRations(failBase, map, { survivalBonus: -10, natureBonusRations: 1 });
    expect(fail.success).toBe(false);
    expect(fail.rationsFound).toBe(0);
  });

  it('animal handling: friendlier beasts, expert off-road + camp perception', () => {
    expect(getAnimalHandlingAttitudeShift('none')).toBe(0);
    expect(getAnimalHandlingAttitudeShift('proficient')).toBe(1);
    expect(getAnimalHandlingAttitudeShift('expert')).toBe(1);
    expect(getAnimalHandlingOffRoadDiscount('proficient')).toBe(0);
    expect(getAnimalHandlingOffRoadDiscount('expert')).toBe(1);
    expect(getAnimalHandlingCampPerceptionBonus('proficient')).toBe(0);
    expect(getAnimalHandlingCampPerceptionBonus('expert')).toBe(1);
  });
});

describe('SRD-1213 history / intimidation / insight / performance dividends', () => {
  it('history: one free recall per delve; experts reveal boss resistances', () => {
    expect(getHistoryFreeRecallsPerDelve('none')).toBe(0);
    expect(getHistoryFreeRecallsPerDelve('proficient')).toBe(1);
    expect(getHistoryFreeRecallsPerDelve('expert')).toBe(1);
    expect(hasHistoryBossResistanceReveal('proficient')).toBe(false);
    expect(hasHistoryBossResistanceReveal('expert')).toBe(true);
  });

  it('intimidation: earlier morale checks; expert deception fallback at +2 DC', () => {
    expect(getIntimidationMoraleThreshold('none')).toBe(0.5);
    expect(getIntimidationMoraleThreshold('proficient')).toBe(0.6);
    expect(getIntimidationMoraleThreshold('expert')).toBe(0.6);
    expect(hasIntimidationDeceptionFallback('proficient')).toBe(false);
    expect(hasIntimidationDeceptionFallback('expert')).toBe(true);
    expect(INTIMIDATION_DECEPTION_FALLBACK_DC_BONUS).toBe(2);
  });

  it('insight: passive cue at prof; intent band reveal at expert', () => {
    expect(hasInsightPassiveCue('none')).toBe(false);
    expect(hasInsightPassiveCue('proficient')).toBe(true);
    expect(hasInsightIntentBandReveal('proficient')).toBe(false);
    expect(hasInsightIntentBandReveal('expert')).toBe(true);
    expect(getIntentBand(20, 10)).toBe('demand');
    expect(getIntentBand(12, 10)).toBe('fear');
    expect(getIntentBand(8, 10)).toBe('bluff');
  });

  it('performance: tavern rewards at prof; distract 1/combat at expert', () => {
    expect(hasPerformanceTavernRewards('none')).toBe(false);
    expect(hasPerformanceTavernRewards('proficient')).toBe(true);
    expect(getPerformanceDistractUsesPerCombat('proficient')).toBe(0);
    expect(getPerformanceDistractUsesPerCombat('expert')).toBe(1);
    // Fail-forward: a failed tavern roll still surfaces the rumor.
    expect(getPerformanceTavernPayout(5, 12)).toEqual({ gp: 0, rumor: true });
    expect(getPerformanceTavernPayout(12, 12)).toEqual({ gp: 1, rumor: true });
    expect(getPerformanceTavernPayout(17, 12).gp).toBeGreaterThanOrEqual(1);
    expect(getPerformanceTavernPayout(17, 12).rumor).toBe(true);
  });

  it('summarizePartyPassives reports the best conscious tier per skill', () => {
    const party = {
      lore: makeCombatant('lore', { history: 'proficient', religion: 'none' }),
      chap: makeCombatant('chap', { religion: 'expertise' }),
      down: { ...makeCombatant('down', { nature: 'expertise' }), isDead: true, currentHp: 0 },
    };
    const summary = summarizePartyPassives(party);
    expect(summary).toHaveLength(8);
    expect(summary.find((s) => s.skill === 'history')!.bestTier).toBe('proficient');
    expect(summary.find((s) => s.skill === 'religion')!.bestTier).toBe('expert');
    // The dead expert naturalist contributes nothing.
    expect(summary.find((s) => s.skill === 'nature')!.bestTier).toBe('none');
  });
});

describe('SRD-1213 generator recall-tag emission (seeded theme tables)', () => {
  it('emits deterministic per-room tags and validates against the schema', () => {
    const rooms = [{ id: 'room-a' }, { id: 'room-b' }, { id: 'room-c' }];
    const first = generateFloorRecallTags({ floorId: 'f1', seed: 42, rooms, monsterIds: ['skeleton', 'zombie'], depth: 2 });
    const second = generateFloorRecallTags({ floorId: 'f1', seed: 42, rooms, monsterIds: ['skeleton', 'zombie'], depth: 2 });
    expect(second).toEqual(first);
    for (const tags of Object.values(first)) {
      for (const tag of tags) {
        expect(() => KnowledgeRecallSpecSchema.parse(tag)).not.toThrow();
      }
    }
    // Undead floors carry the signature Religion ward tag.
    expect(Object.values(first).flat().some((t) => t.skill === 'religion')).toBe(true);
  });

  it('attaches recall tags to generated floors without perturbing RNG replay', () => {
    const config = { depth: 2, seed: 987654321, width: 36, height: 36, targetRoomCount: 5 };
    const run1 = generateDungeonFloor(config);
    const run2 = generateDungeonFloor(config);
    expect(JSON.stringify(run1.floor)).toBe(JSON.stringify(run2.floor));
    expect(run1.nextRngState).toBe(run2.nextRngState);
    // Every room with tags validates; at least one room carries a tag.
    const rooms = run1.floor.rooms ?? [];
    expect(rooms.length).toBeGreaterThan(0);
    let tagged = 0;
    for (const room of rooms) {
      for (const tag of (room as any).recallTags ?? []) {
        expect(() => KnowledgeRecallSpecSchema.parse(tag)).not.toThrow();
        tagged++;
      }
    }
    expect(tagged).toBeGreaterThan(0);
  });

  it('varies tags with the seed (theme tables are seed-driven)', () => {
    const rooms = [{ id: 'room-a' }, { id: 'room-b' }, { id: 'room-c' }, { id: 'room-d' }];
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      const tags = generateFloorRecallTags({ floorId: 'f1', seed, rooms, monsterIds: ['mage', 'cult-fanatic'], depth: 4 });
      seen.add(JSON.stringify(tags));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
