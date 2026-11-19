import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  type Combatant,
  type CombatState,
  DerivedCharacterSheetSchema,
  buildWarSquad,
  buildWarSquadMember,
  createTacticalGrid,
  generateWarMissionBattle,
  getWarSquadMonsterPool,
  isWarMissionPoi,
  planAiTurn,
  type DispositionMatrix,
} from '../index.js';

/**
 * SRD-1102 — Dynamic-CR class squads, class-kit AI, multi-wave defense battles
 * (Spec 10 §4, BACKLOG acceptance criteria).
 */

function makeCombatState(
  combatantsList: Combatant[],
  dispositionMatrix?: DispositionMatrix,
  round = 1,
): CombatState {
  const combatants: Record<string, Combatant> = {};
  for (const c of combatantsList) combatants[c.id] = c;
  return {
    encounterId: 'enc-war-1102',
    round,
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
    rngState: 4242,
    dispositionMatrix,
  };
}

function makeGrid() {
  return createTacticalGrid(20, 20);
}

function dummyParty(level = 3) {
  const squad = buildWarSquad({ partyLevel: level, seed: 7, nationId: 'dawn-crown', teamId: 'party' });
  return squad.members.map((m, i) => ({ ...m.combatant, id: `hero_${i + 1}`, side: 'party' as const, teamId: 'party' }));
}

describe('SRD-1102: buildWarSquadMember — dynamic-CR classed NPCs', () => {
  it.each(['fighter', 'wizard', 'cleric', 'rogue'] as const)(
    'builds a valid level-scaled %s via computeDerivedCharacter',
    (classId) => {
      const member = buildWarSquadMember(classId, 3, { seed: 11, nationId: 'ashen-spire' });
      expect(() => DerivedCharacterSheetSchema.parse(member.sheet)).not.toThrow();
      expect(member.sheet.totalLevel).toBe(3);
      expect(member.sheet.classes[0]?.classId).toBe(classId);
      expect(member.combatant.side).toBe('monster');
      expect(member.combatant.teamId).toBe('war_enemies');
      expect(member.combatant.characterSheet).toBeDefined();
    },
  );

  it('scales HP and proficiency with party average level (dynamic CR)', () => {
    const lv1 = buildWarSquadMember('fighter', 1, { seed: 5 });
    const lv5 = buildWarSquadMember('fighter', 5, { seed: 5 });
    expect(lv5.sheet.maxHp).toBeGreaterThan(lv1.sheet.maxHp);
    expect(lv5.sheet.proficiencyBonus).toBeGreaterThanOrEqual(lv1.sheet.proficiencyBonus);
    expect(lv5.sheet.totalLevel).toBe(5);
  });

  it('pins war spells: Lv5 wizard prepares fireball, cleric prepares healing-word', () => {
    const mage = buildWarSquadMember('wizard', 5, { seed: 9 });
    expect(mage.sheet.spellcasting.preparedOrKnownSpellIds).toContain('fireball');
    expect(mage.sheet.spellcasting.preparedOrKnownSpellIds).toContain('magic-missile');
    const priest = buildWarSquadMember('cleric', 3, { seed: 9 });
    expect(priest.sheet.spellcasting.preparedOrKnownSpellIds).toContain('healing-word');
    expect(priest.sheet.spellcasting.preparedOrKnownSpellIds).toContain('cure-wounds');
  });

  it('replays deterministically from the same seed and level', () => {
    const a = buildWarSquad({ partyLevel: 4, seed: 31337, nationId: 'iron-covenant' });
    const b = buildWarSquad({ partyLevel: 4, seed: 31337, nationId: 'iron-covenant' });
    expect(a.members.map((m) => m.sheet)).toEqual(b.members.map((m) => m.sheet));
    expect(a.members).toHaveLength(4);
    expect(a.members.map((m) => m.sheet.classes[0]?.classId).sort()).toEqual(
      ['cleric', 'fighter', 'rogue', 'wizard'],
    );
  });

  it('honors explicit composition overrides', () => {
    const squad = buildWarSquad({ partyLevel: 2, seed: 3, composition: ['fighter', 'fighter'] });
    expect(squad.members).toHaveLength(2);
    expect(squad.members.every((m) => m.sheet.classes[0]?.classId === 'fighter')).toBe(true);
  });
});

describe('SRD-1102: class-kit tactical AI', () => {
  it('Warrior uses Second Wind below 50% HP and attacks', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('fighter', 3, { seed: 21, teamId: 'war_enemies' });
    const warrior: Combatant = {
      ...member.combatant,
      id: 'war-fighter-1',
      position: { x: 5, y: 5 },
      currentHp: Math.floor(member.combatant.maxHp * 0.4),
    };
    const foe: Combatant = {
      ...dummyParty(3)[0]!,
      id: 'hero-1',
      position: { x: 6, y: 5 },
    };
    const state = makeCombatState([warrior, foe]);
    const plan = planAiTurn({ state, activeCombatantId: warrior.id, grid });
    const secondWind = plan.commands.find(
      (c) => c.type === 'USE_CLASS_FEATURE' && c.featureId === 'use-second-wind',
    );
    expect(secondWind).toBeDefined();
    expect(plan.commands.some((c) => c.type === 'DECLARE_ATTACK')).toBe(true);
  });

  it('Warrior uses Action Surge when engaged in melee at full HP', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('fighter', 3, { seed: 22, teamId: 'war_enemies' });
    const warrior: Combatant = {
      ...member.combatant,
      id: 'war-fighter-2',
      position: { x: 5, y: 5 },
      currentHp: member.combatant.maxHp,
    };
    const foe: Combatant = {
      ...dummyParty(3)[0]!,
      id: 'hero-2',
      position: { x: 6, y: 5 },
    };
    const state = makeCombatState([warrior, foe]);
    const plan = planAiTurn({ state, activeCombatantId: warrior.id, grid });
    expect(
      plan.commands.some((c) => c.type === 'USE_CLASS_FEATURE' && c.featureId === 'use-action-surge'),
    ).toBe(true);
  });

  it('Mage casts Fireball on 2+ clustered hostiles while avoiding allies', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('wizard', 5, { seed: 23, teamId: 'war_enemies' });
    const mage: Combatant = { ...member.combatant, id: 'war-mage-1', position: { x: 0, y: 0 } };
    const e1: Combatant = { ...dummyParty(5)[0]!, id: 'hero-a', position: { x: 10, y: 10 } };
    const e2: Combatant = { ...dummyParty(5)[1]!, id: 'hero-b', position: { x: 11, y: 10 } };
    const e3: Combatant = { ...dummyParty(5)[2]!, id: 'hero-c', position: { x: 10, y: 11 } };
    const ally: Combatant = { ...member.combatant, id: 'war-ally-1', position: { x: 2, y: 2 }, teamId: 'war_enemies', side: 'monster' as const };
    const state = makeCombatState([mage, e1, e2, e3, ally]);
    const plan = planAiTurn({ state, activeCombatantId: mage.id, grid });
    const fireball = plan.commands.find(
      (c) => c.type === 'DECLARE_CAST_SPELL' && c.spellId === 'fireball',
    );
    expect(fireball).toBeDefined();
    if (fireball && fireball.type === 'DECLARE_CAST_SPELL') {
      expect(fireball.slotLevel).toBe(3);
      expect(fireball.targetCell).toBeDefined();
    }
  });

  it('Mage falls back to Magic Missile on a single isolated hostile', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('wizard', 3, { seed: 24, teamId: 'war_enemies' });
    const mage: Combatant = { ...member.combatant, id: 'war-mage-2', position: { x: 0, y: 0 } };
    const foe: Combatant = { ...dummyParty(3)[0]!, id: 'hero-solo', position: { x: 8, y: 8 } };
    const state = makeCombatState([mage, foe]);
    const plan = planAiTurn({ state, activeCombatantId: mage.id, grid });
    expect(
      plan.commands.some(
        (c) => c.type === 'DECLARE_CAST_SPELL' && (c.spellId === 'magic-missile' || c.spellId === 'fire-bolt'),
      ),
    ).toBe(true);
  });

  it('Cleric prioritizes Healing Word on an ally below 60% HP', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('cleric', 3, { seed: 25, teamId: 'war_enemies' });
    const priest: Combatant = { ...member.combatant, id: 'war-priest-1', position: { x: 5, y: 5 } };
    const woundedAlly: Combatant = {
      ...member.combatant,
      id: 'war-ally-wounded',
      position: { x: 6, y: 6 },
      currentHp: Math.floor(member.combatant.maxHp * 0.4),
    };
    const foe: Combatant = { ...dummyParty(3)[0]!, id: 'hero-cleric-foe', position: { x: 12, y: 12 } };
    const state = makeCombatState([priest, woundedAlly, foe]);
    const plan = planAiTurn({ state, activeCombatantId: priest.id, grid });
    const heal = plan.commands.find(
      (c) =>
        c.type === 'DECLARE_CAST_SPELL' && (c.spellId === 'healing-word' || c.spellId === 'cure-wounds'),
    );
    expect(heal).toBeDefined();
    if (heal && heal.type === 'DECLARE_CAST_SPELL') {
      expect(heal.targetIds).toContain(woundedAlly.id);
    }
  });

  it('Cleric casts Bless early with no wounded allies, else Guiding Bolt', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('cleric', 3, { seed: 26, teamId: 'war_enemies' });
    const priest: Combatant = { ...member.combatant, id: 'war-priest-2', position: { x: 5, y: 5 } };
    const ally: Combatant = { ...member.combatant, id: 'war-ally-healthy', position: { x: 6, y: 5 } };
    const foe: Combatant = { ...dummyParty(3)[0]!, id: 'hero-bless-foe', position: { x: 12, y: 12 } };
    const state = makeCombatState([priest, ally, foe], undefined, 1);
    const plan = planAiTurn({ state, activeCombatantId: priest.id, grid });
    expect(
      plan.commands.some(
        (c) =>
          c.type === 'DECLARE_CAST_SPELL' &&
          (c.spellId === 'bless' || c.spellId === 'guiding-bolt' || c.spellId === 'sacred-flame'),
      ),
    ).toBe(true);
  });

  it('Thief uses Cunning Action disengage and Sneak Attacks the flanked mark', () => {
    const grid = makeGrid();
    const member = buildWarSquadMember('rogue', 3, { seed: 27, teamId: 'war_enemies' });
    const thief: Combatant = { ...member.combatant, id: 'war-thief-1', position: { x: 5, y: 5 } };
    const buddy: Combatant = { ...member.combatant, id: 'war-buddy-1', position: { x: 7, y: 6 } };
    const flanked: Combatant = { ...dummyParty(3)[0]!, id: 'hero-flanked', position: { x: 6, y: 5 } };
    const isolated: Combatant = { ...dummyParty(3)[1]!, id: 'hero-isolated', position: { x: 15, y: 15 } };
    const state = makeCombatState([thief, buddy, flanked, isolated]);
    const plan = planAiTurn({ state, activeCombatantId: thief.id, grid });
    const attack = plan.commands.find((c) => c.type === 'DECLARE_ATTACK');
    expect(attack).toBeDefined();
    if (attack && attack.type === 'DECLARE_ATTACK') {
      expect(attack.targetId).toBe(flanked.id);
    }
    expect(
      plan.commands.some(
        (c) => c.type === 'USE_STANDARD_ACTION' && c.action === 'disengage' && c.asBonusAction === true,
      ),
    ).toBe(true);
  });
});

describe('SRD-1102: generateWarMissionBattle — multi-wave protect_poi', () => {
  const party = () => dummyParty(3);

  it('spawns a level-scaled opening garrison with timed reinforcements', () => {
    const result = generateWarMissionBattle(
      { seed: 101, missionKind: 'protect_poi', party: party(), partyAverageLevel: 3, nationId: 'ashen-spire' },
      defaultCompendium,
    );
    expect(result.enemies.length).toBeGreaterThanOrEqual(3);
    expect(result.waves).toHaveLength(2);
    expect(result.waves[0]?.deployRound).toBe(1);
    expect(result.waves[1]?.deployRound).toBe(3);
    expect(result.reinforcementQueue.length).toBeGreaterThan(0);
    for (const enemy of [...result.enemies, ...result.reinforcementQueue]) {
      expect(enemy.side).toBe('monster');
      expect(enemy.characterSheet ?? enemy.monsterData).toBeDefined();
    }
  });

  it('adds a third elite wave for parties of level 5+', () => {
    const low = generateWarMissionBattle(
      { seed: 102, missionKind: 'protect_poi', party: party(), partyAverageLevel: 3 },
      defaultCompendium,
    );
    const high = generateWarMissionBattle(
      { seed: 102, missionKind: 'protect_poi', party: dummyParty(6), partyAverageLevel: 6 },
      defaultCompendium,
    );
    expect(low.waves).toHaveLength(2);
    expect(high.waves).toHaveLength(3);
    expect(high.waves[2]?.deployRound).toBe(5);
  });

  it('applies Approach-phase battleModifiers (surprise, militia, HP attrition)', () => {
    const base = generateWarMissionBattle(
      { seed: 103, missionKind: 'protect_poi', party: party(), partyAverageLevel: 3 },
      defaultCompendium,
    );
    const modified = generateWarMissionBattle(
      {
        seed: 103,
        missionKind: 'protect_poi',
        party: party(),
        partyAverageLevel: 3,
        modifiers: {
          surpriseAttackerSide: 'party',
          wave1EnemiesSurprised: true,
          extraAlliedMilitia: 2,
          enemyCountMultiplier: 1,
          enemyHpMultiplier: 0.5,
        },
      },
      defaultCompendium,
    );
    expect(modified.enemies.every((e) => e.isSurprised)).toBe(true);
    expect(modified.alliedMilitia).toHaveLength(2);
    expect(modified.alliedMilitia.every((m) => m.side === 'party')).toBe(true);
    for (let i = 0; i < modified.enemies.length; i++) {
      expect(modified.enemies[i]!.maxHp).toBeLessThanOrEqual(base.enemies[i]!.maxHp);
    }
  });

  it('replays bit-exactly from the same seed', () => {
    const opts = { seed: 777, missionKind: 'protect_poi', party: party(), partyAverageLevel: 4, nationId: 'iron-covenant' } as const;
    const a = generateWarMissionBattle({ ...opts }, defaultCompendium);
    const b = generateWarMissionBattle({ ...opts }, defaultCompendium);
    expect(b).toEqual(a);
  });

  it('exposes war-mission POI helpers', () => {
    expect(isWarMissionPoi({ kind: 'fortress' })).toBe(true);
    expect(isWarMissionPoi({ kind: 'town' })).toBe(false);
    expect(getWarSquadMonsterPool('ashen-spire')).toContain('orc');
    expect(getWarSquadMonsterPool('dawn-crown')).toContain('guard');
  });
});
