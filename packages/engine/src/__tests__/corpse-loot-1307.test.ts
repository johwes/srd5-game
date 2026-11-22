import { describe, expect, it } from 'vitest';
import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { createInitialGameState, reduceGame } from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import {
  canEndMoveAt,
  detectStepOpportunityAttacks,
  isFootprintStepDifficultTerrain,
  type GridCreature,
} from '../grid/pathfinding.js';
import { createMonsterCombatant } from '../combat/combatant.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { transitionCombatToExploration } from '../dungeon/encounters.js';
import {
  CORPSE_ELITE_CR_THRESHOLD,
  corpseSearchDc,
  getCombatantCr,
  hasClaimableLoot,
  mergeLootBundles,
  resolveCorpseSearch,
  rollCorpseLoot,
  spawnCorpseLootProps,
  sweepUnclaimedCorpseLoot,
} from '../dungeon/corpse-loot.js';
import { claimPropLoot, claimPropLootCoins, rollIndividualTreasure, rollTreasureHoard } from '../dungeon/loot.js';
import { getAvailablePropInteractions } from '../dungeon/props.js';
import { resolveOverworldBattle } from '../overworld/battles.js';
import type { Combatant } from '../combat/types.js';
import type { GameState } from '../state/types.js';

const compendium = defaultCompendium;

function makeHero(id: string, x: number, y: number, skillBonus = 0): Combatant {
  const build = getPregenCharacter('pregen-fighter')!;
  const sheet = computeDerivedCharacter(build, compendium);
  return {
    id,
    name: id,
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: sheet.maxHp,
    maxHp: sheet.maxHp,
    tempHp: 0,
    armorClass: sheet.armorClass.totalAc,
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
    buildState: structuredClone(build),
    characterSheet: {
      ...structuredClone(sheet),
      skills: {
        ...(sheet.skills as Record<string, unknown>),
        investigation: { totalBonus: skillBonus },
        survival: { totalBonus: skillBonus },
      },
    },
  } as unknown as Combatant;
}

function makeDeadMonster(monsterId: string, id: string, x: number, y: number): Combatant {
  const data = compendium.requireMonster(monsterId);
  const c = createMonsterCombatant(data, id, { x, y });
  c.isDead = true;
  c.currentHp = 0;
  return c;
}

function makeCombatState(monsters: Combatant[], heroes: Combatant[]): GameState {
  const grid = createTacticalGrid(12, 12, 'floor_stone', 'bright');
  const s0 = createInitialGameState({ grid, party: heroes, rngState: 424242 });
  const party: Record<string, Combatant> = {};
  for (const h of heroes) party[h.id] = h;
  const monsterMap: Record<string, Combatant> = {};
  for (const m of monsters) monsterMap[m.id] = m;
  return { ...s0, mode: 'combat', party, monsters: monsterMap, props: [] };
}

describe('SRD-1307: CR-scaled corpse drops', () => {
  it('rolls individual treasure for low CR with monster_drop provenance, deterministically', () => {
    const goblin = makeDeadMonster('goblin', 'goblin-1', 4, 4);
    const first = rollCorpseLoot(goblin, 999, compendium);
    const second = rollCorpseLoot(goblin, 999, compendium);
    expect(first.loot).toEqual(second.loot);
    expect(first.nextRng).toBe(second.nextRng);
    expect(hasClaimableLoot(first.loot)).toBe(true);
    expect(first.loot.origin).toBe('monster_drop');
    expect(first.loot.sourceName).toBe(goblin.name);

    // CR < elite threshold: exactly the individual-treasure roll, no hoard.
    const expected = rollIndividualTreasure(getCombatantCr(goblin), 999);
    expect(first.loot).toMatchObject({ ...expected.loot });
    expect(first.nextRng).toBe(expected.nextRng);
  });

  it('adds a hoard roll for elite/boss CRs at the CR tier', () => {
    expect(CORPSE_ELITE_CR_THRESHOLD).toBe(5);
    const troll = makeDeadMonster('troll', 'troll-1', 4, 4);
    expect(getCombatantCr(troll)).toBeGreaterThanOrEqual(5);
    const rolled = rollCorpseLoot(troll, 777, compendium);

    let rng = 777;
    const individual = rollIndividualTreasure(5, rng);
    rng = individual.nextRng;
    const hoard = rollTreasureHoard(5, rng, compendium);
    const expected = mergeLootBundles(individual.loot, hoard.loot);
    expect(rolled.loot).toMatchObject({ ...expected, origin: 'monster_drop', sourceName: troll.name });
    expect(rolled.nextRng).toBe(hoard.nextRng);
    expect(rolled.loot.origin).toBe('monster_drop');
  });

  it('summons never drop loot', () => {
    const goblin = makeDeadMonster('goblin', 'goblin-1', 4, 4);
    const summoned = { ...goblin, isSummon: true };
    const rolled = rollCorpseLoot(summoned, 999, compendium);
    expect(rolled.loot).toEqual({});
    expect(hasClaimableLoot(rolled.loot)).toBe(false);
  });

  it('spawns one open, non-blocking corpse prop per newly slain monster (idempotent)', () => {
    const g1 = makeDeadMonster('goblin', 'goblin-1', 4, 4);
    const g2 = makeDeadMonster('goblin', 'goblin-2', 5, 4);
    const first = spawnCorpseLootProps([], [g1, g2], 424242, compendium);
    expect(first.spawnedPropIds).toEqual(['corpse-goblin-1', 'corpse-goblin-2']);
    const [corpse] = first.nextProps;
    expect(corpse).toMatchObject({
      kind: 'corpse',
      state: 'open',
      blocksMovement: false,
      blocksSight: false,
      discovered: true,
      monsterId: 'goblin-1',
      label: `Remains of ${g1.name}`,
      searched: false,
      x: 4,
      y: 4,
    });
    expect(corpsesHaveLoot(first)).toBe(true);

    // Idempotent: re-running on the same battlefield spawns nothing new.
    const again = spawnCorpseLootProps(first.nextProps, [g1, g2], first.nextRng, compendium);
    expect(again.spawnedPropIds).toEqual([]);
    expect(again.nextProps).toHaveLength(2);
  });

  it('skips living monsters, existing corpses, and summons', () => {
    const dead = makeDeadMonster('goblin', 'goblin-1', 4, 4);
    const aliveData = compendium.requireMonster('goblin');
    const alive = createMonsterCombatant(aliveData, 'goblin-9', { x: 1, y: 1 });
    const summoned = { ...makeDeadMonster('goblin', 'goblin-3', 2, 2), isSummon: true };
    const res = spawnCorpseLootProps([], [dead, alive, summoned], 7, compendium);
    expect(res.spawnedPropIds).toEqual(['corpse-goblin-1']);
  });

  function corpsesHaveLoot(res: { nextProps: { lootTable?: unknown }[] }): boolean {
    return res.nextProps.every((p) => hasClaimableLoot(p.lootTable as never));
  }
});

describe('SRD-1307: encounter-clear corpse spawn via transitionCombatToExploration', () => {
  it('spawns corpse props on party victory and threads rng deterministically', () => {
    const heroes = [makeHero('fighter-1', 1, 1), makeHero('wizard-1', 1, 2)];
    const monsters = [makeDeadMonster('goblin', 'goblin-1', 4, 4), makeDeadMonster('wolf', 'wolf-1', 5, 5)];
    const runOnce = () => transitionCombatToExploration(makeCombatState(monsters, heroes));
    const first = runOnce();
    const second = runOnce();

    const corpses = first.nextState.props.filter((p) => p.kind === 'corpse');
    expect(corpses.map((p) => p.id).sort()).toEqual(['corpse-goblin-1', 'corpse-wolf-1']);
    // Bit-exact replay: identical seeds produce identical corpse loot.
    expect(first.nextState.props).toEqual(second.nextState.props);
    expect(first.nextState.rngState).toBe(second.nextState.rngState);
    // rng advanced past the pre-transition seed.
    expect(first.nextState.rngState).not.toBe(424242);
    // Party + XP flow untouched.
    const victory = first.events.find((e) => e.type === 'ENCOUNTER_VICTORY');
    expect(victory).toBeDefined();
  });

  it('supports corpseDrops: skip for the war-battle path', () => {
    const heroes = [makeHero('fighter-1', 1, 1)];
    const monsters = [makeDeadMonster('goblin', 'goblin-1', 4, 4)];
    const res = transitionCombatToExploration(makeCombatState(monsters, heroes), {
      corpseDrops: 'skip',
    });
    expect(res.nextState.props.filter((p) => p.kind === 'corpse')).toHaveLength(0);
    expect(res.events.some((e) => e.type === 'ENCOUNTER_VICTORY')).toBe(true);
  });

  it('END_COMBAT through the reducer spawns corpse props', () => {
    const heroes = [makeHero('fighter-1', 1, 1)];
    const monsters = [makeDeadMonster('goblin', 'goblin-1', 4, 4)];
    const res = reduceGame(makeCombatState(monsters, heroes), { type: 'END_COMBAT' });
    expect(res.nextState.mode).toBe('exploration');
    expect(res.nextState.props.some((p) => p.id === 'corpse-goblin-1')).toBe(true);
  });

  it('resolveOverworldBattle never spawns corpse props (no war double-dip)', () => {
    const heroes = [makeHero('fighter-1', 1, 1)];
    const monsters = [makeDeadMonster('goblin', 'goblin-1', 4, 4)];
    const res = resolveOverworldBattle(makeCombatState(monsters, heroes), { compendium });
    expect(res.nextState.props.filter((p) => p.kind === 'corpse')).toHaveLength(0);
    expect(res.goldAwarded).toBeGreaterThanOrEqual(0);
  });
});

describe('SRD-1307: searching the fallen (Investigation / Survival)', () => {
  function stateWithCorpse(skillBonus: number, monsterId = 'goblin'): GameState {
    const heroes = [makeHero('fighter-1', 1, 1, skillBonus)];
    const monsters = [makeDeadMonster(monsterId, 'mob-1', 2, 1)];
    const combat = makeCombatState(monsters, heroes);
    const transitioned = transitionCombatToExploration(combat);
    expect(transitioned.nextState.mode).toBe('exploration');
    return transitioned.nextState;
  }

  it('a successful Investigation merges a bonus roll with a Keen Eye attribution', () => {
    const state = stateWithCorpse(30);
    const propId = 'corpse-mob-1';
    const before = structuredClone(state.props.find((p) => p.id === propId)!.lootTable!);
    const res = resolveCorpseSearch({ state, actorId: 'fighter-1', propId });
    const afterProp = res.nextState.props.find((p) => p.id === propId)!;
    expect(afterProp.searched).toBe(true);

    const check = res.events.find(
      (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'investigation',
    );
    expect(check).toBeDefined();
    if (check && check.type === 'CHECK_RESOLVED') {
      expect(check.success).toBe(true);
      expect(check.dc).toBe(corpseSearchDc(0.25));
      expect(check.note).toMatch(/Keen Eye \(Investigation\)/);
    }
    // Bonus merged: every pre-search coin/item still present.
    const after = afterProp.lootTable!;
    expect(after.gp ?? 0).toBeGreaterThanOrEqual(before.gp ?? 0);
    expect(after.origin).toBe('monster_drop');
  });

  it('a failed Investigation still marks the corpse searched (one attempt)', () => {
    // +0 vs DC 10 with a low natural roll: find a failing seed deterministically.
    let state = stateWithCorpse(0);
    let attempts = 0;
    let res = resolveCorpseSearch({ state, actorId: 'fighter-1', propId: 'corpse-mob-1' });
    while (
      attempts < 200 &&
      res.events.some(
        (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'investigation' && e.success,
      )
    ) {
      attempts += 1;
      state = { ...stateWithCorpse(0), rngState: 424242 + attempts * 7919 };
      res = resolveCorpseSearch({ state, actorId: 'fighter-1', propId: 'corpse-mob-1' });
    }
    const check = res.events.find(
      (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'investigation',
    );
    expect(check).toBeDefined();
    if (check && check.type === 'CHECK_RESOLVED') {
      expect(check.success).toBe(false);
      expect(check.note).toMatch(/no hidden spoils/);
    }
    expect(res.nextState.props.find((p) => p.id === 'corpse-mob-1')!.searched).toBe(true);
    // Second attempt throws.
    expect(() =>
      resolveCorpseSearch({ state: res.nextState, actorId: 'fighter-1', propId: 'corpse-mob-1' }),
    ).toThrow(/already been searched/);
  });

  it('beast remains grant a Survival harvest with Field Dressing attribution', () => {
    const state = stateWithCorpse(30, 'wolf');
    const res = resolveCorpseSearch({ state, actorId: 'fighter-1', propId: 'corpse-mob-1' });
    const checks = res.events.filter((e) => e.type === 'CHECK_RESOLVED');
    expect(checks).toHaveLength(2);
    const survival = res.events.find(
      (e) => e.type === 'CHECK_RESOLVED' && e.checkType === 'survival',
    );
    expect(survival).toBeDefined();
    if (survival && survival.type === 'CHECK_RESOLVED') {
      expect(survival.success).toBe(true);
      expect(survival.note).toMatch(/Field Dressing \(Survival\)/);
      expect(survival.note).toMatch(/rations 1 day/);
    }
    const after = res.nextState.props.find((p) => p.id === 'corpse-mob-1')!.lootTable!;
    expect(after.items).toContain('rations-1-day');
  });

  it('non-beast remains resolve Investigation only', () => {
    const state = stateWithCorpse(30, 'goblin');
    const res = resolveCorpseSearch({ state, actorId: 'fighter-1', propId: 'corpse-mob-1' });
    expect(res.events.filter((e) => e.type === 'CHECK_RESOLVED')).toHaveLength(1);
  });

  it('rejects non-corpses, missing actors, and non-adjacent searchers', () => {
    const state = stateWithCorpse(30);
    expect(() =>
      resolveCorpseSearch({ state, actorId: 'nobody', propId: 'corpse-mob-1' }),
    ).toThrow(/Actor not found/);
    // Far-away hero cannot search.
    const far = {
      ...state,
      party: {
        ...state.party,
        'far-1': makeHero('far-1', 11, 11, 30),
      },
    };
    expect(() =>
      resolveCorpseSearch({ state: far, actorId: 'far-1', propId: 'corpse-mob-1' }),
    ).toThrow(/not adjacent/);
  });

  it('corpse card offers Search the Fallen until searched', () => {
    const state = stateWithCorpse(5);
    const prop = state.props.find((p) => p.id === 'corpse-mob-1')!;
    const hero = state.party['fighter-1']!;
    const options = getAvailablePropInteractions(prop, hero);
    expect(options.map((o) => o.interaction)).toEqual(['search']);
    expect(options[0]!.label).toBe('Search the Fallen');
    expect(options[0]!.checkHint).toMatch(/DC 10/);
    expect(getAvailablePropInteractions({ ...prop, searched: true }, hero)).toEqual([]);
  });
});

describe('SRD-1307: claiming corpse loot and floor-exit sweep', () => {
  function stateWithCorpse(): { state: GameState; propId: string } {
    const heroes = [makeHero('fighter-1', 1, 1), makeHero('wizard-1', 1, 2)];
    const monsters = [
      makeDeadMonster('goblin', 'goblin-1', 2, 1),
      makeDeadMonster('goblin', 'goblin-2', 2, 2),
    ];
    const transitioned = transitionCombatToExploration(makeCombatState(monsters, heroes));
    return { state: transitioned.nextState, propId: 'corpse-goblin-1' };
  }

  it('CLAIM_LOOT on a corpse awards provenance-tagged loot and retires the card', () => {
    const { state, propId } = stateWithCorpse();
    const beforeGp = state.party['fighter-1']!.buildState!.currency.gp;
    const beforeCount = state.party['fighter-1']!.buildState!.inventory.length;
    const res = reduceGame(state, {
      type: 'CLAIM_LOOT',
      characterId: 'fighter-1',
      propId,
    });
    const hero = res.nextState.party['fighter-1']!;
    // Goblin individual-treasure drops are coin-heavy: purse grows, bag never shrinks.
    const lootGp = state.props.find((p) => p.id === propId)!.lootTable!.gp ?? 0;
    expect(hero.buildState!.currency.gp).toBe(beforeGp + lootGp);
    expect(hero.buildState!.inventory.length).toBeGreaterThanOrEqual(beforeCount);
    expect(res.nextState.props.find((p) => p.id === propId)!.lootTable).toBeUndefined();

    const acquired = res.events.find((e) => e.type === 'LOOT_ACQUIRED');
    expect(acquired).toBeDefined();
    if (acquired && acquired.type === 'LOOT_ACQUIRED') {
      expect(acquired.propId).toBe(propId);
      expect(acquired.loot.origin).toBe('monster_drop');
      expect(acquired.loot.sourceName).toContain('Goblin');
    }
    // INVENTORY_UPDATED carries the post-claim inventory (not the stale pre-claim one).
    const updated = res.events.find((e) => e.type === 'INVENTORY_UPDATED');
    expect(updated).toBeDefined();
    if (updated && updated.type === 'INVENTORY_UPDATED') {
      expect(updated.inventory).toHaveLength(hero.buildState!.inventory.length);
    }
    // Fully-looted corpse stays inert: second claim is a no-op bundle.
    const again = claimPropLoot(res.nextState, propId, 'fighter-1', compendium);
    expect(again.loot).toEqual({});
    expect(again.events).toHaveLength(0);
  });

  it('CLAIM_LOOT with itemIndex takes a single item and leaves the rest', () => {
    const { state, propId } = stateWithCorpse();
    const planted: GameState = {
      ...state,
      props: state.props.map((p) =>
        p.id === propId
          ? { ...p, lootTable: { ...p.lootTable, items: ['dagger', 'potion-of-healing'], gp: 5 } }
          : p,
      ),
    };
    const beforeCount = planted.party['fighter-1']!.buildState!.inventory.length;
    const res = reduceGame(planted, {
      type: 'CLAIM_LOOT',
      characterId: 'fighter-1',
      propId,
      itemIndex: 0,
    });

    // Dagger lands in the bag; the potion and all coins stay on the corpse.
    const hero = res.nextState.party['fighter-1']!;
    expect(hero.buildState!.inventory.length).toBe(beforeCount + 1);
    expect(hero.buildState!.inventory[hero.buildState!.inventory.length - 1]!.itemId).toBe('dagger');
    const table = res.nextState.props.find((p) => p.id === propId)!.lootTable!;
    expect(table.items).toEqual(['potion-of-healing']);
    expect(table.gp).toBe(5);

    const acquired = res.events.find((e) => e.type === 'LOOT_ACQUIRED');
    expect(acquired).toBeDefined();
    if (acquired && acquired.type === 'LOOT_ACQUIRED') {
      expect(acquired.loot.items).toEqual(['dagger']);
      expect(acquired.loot.gp).toBeUndefined();
    }
  });

  it('taking the last item with no coins clears the corpse table', () => {
    const { state, propId } = stateWithCorpse();
    const planted: GameState = {
      ...state,
      props: state.props.map((p) =>
        p.id === propId ? { ...p, lootTable: { items: ['dagger'] } } : p,
      ),
    };
    const res = reduceGame(planted, {
      type: 'CLAIM_LOOT',
      characterId: 'fighter-1',
      propId,
      itemIndex: 0,
    });
    expect(res.nextState.props.find((p) => p.id === propId)!.lootTable).toBeUndefined();
  });

  it('claimPropLootItem rejects out-of-range indexes and closed props', () => {
    const { state, propId } = stateWithCorpse();
    expect(() =>
      reduceGame(planted(state, propId), {
        type: 'CLAIM_LOOT',
        characterId: 'fighter-1',
        propId,
        itemIndex: 7,
      }),
    ).toThrow(/No loot item at index/);

    function planted(s: GameState, id: string): GameState {
      return {
        ...s,
        props: s.props.map((p) =>
          p.id === id ? { ...p, lootTable: { items: ['dagger'] } } : p,
        ),
      };
    }
  });

  it('CLAIM_LOOT with takeCoins takes only the gold pile and leaves items', () => {
    const { state, propId } = stateWithCorpse();
    const planted: GameState = {
      ...state,
      props: state.props.map((p) =>
        p.id === propId ? { ...p, lootTable: { ...p.lootTable, items: ['dagger'], gp: 23 } } : p,
      ),
    };
    const beforeGp = planted.party['fighter-1']!.buildState!.currency.gp;
    const res = reduceGame(planted, {
      type: 'CLAIM_LOOT',
      characterId: 'fighter-1',
      propId,
      takeCoins: true,
    });

    const hero = res.nextState.party['fighter-1']!;
    expect(hero.buildState!.currency.gp).toBe(beforeGp + 23);
    const table = res.nextState.props.find((p) => p.id === propId)!.lootTable!;
    expect(table.items).toEqual(['dagger']);
    expect(table.gp).toBeUndefined();

    const acquired = res.events.find((e) => e.type === 'LOOT_ACQUIRED');
    expect(acquired).toBeDefined();
    if (acquired && acquired.type === 'LOOT_ACQUIRED') {
      expect(acquired.loot.gp).toBe(23);
      expect(acquired.loot.items).toBeUndefined();
    }
  });

  it('claimPropLootCoins on an empty purse is a no-op', () => {
    const { state, propId } = stateWithCorpse();
    const planted: GameState = {
      ...state,
      props: state.props.map((p) =>
        p.id === propId ? { ...p, lootTable: { items: ['dagger'] } } : p,
      ),
    };
    const res = claimPropLootCoins(planted, propId, 'fighter-1', compendium);
    expect(res.loot).toEqual({});
    expect(res.events).toHaveLength(0);
  });

  it('claimPropLoot mints deterministic instance ids with a prefix', () => {
    const { state, propId } = stateWithCorpse();
    const bundle = state.props.find((p) => p.id === propId)!.lootTable!;
    const itemCount = bundle.items?.length ?? 0;
    const res = claimPropLoot(state, propId, 'fighter-1', compendium, 'unit-seed');
    const fresh = res.nextState.party['fighter-1']!.buildState!.inventory.slice(-Math.max(itemCount, 1));
    for (const inst of fresh) {
      if (itemCount > 0 && (bundle.items ?? []).includes(inst.itemId)) {
        expect(inst.instanceId.startsWith('unit-seed-')).toBe(true);
      }
    }
    // Deterministic replay.
    const replay = claimPropLoot(state, propId, 'fighter-1', compendium, 'unit-seed');
    expect(replay.nextState.party['fighter-1']!.buildState!.inventory).toEqual(
      res.nextState.party['fighter-1']!.buildState!.inventory,
    );
  });

  it('floor-exit sweep round-robins unclaimed drops and clears every corpse', () => {
    // Hand-rolled item bundles (individual-treasure rolls are coin-only, so
    // rolled corpses would mint no instances to assert prefixes on).
    const heroes = [makeHero('fighter-1', 1, 1), makeHero('wizard-1', 1, 2)];
    const grid = createTacticalGrid(12, 12, 'floor_stone', 'bright');
    const s0 = createInitialGameState({ grid, party: heroes, rngState: 5 });
    const state: GameState = {
      ...s0,
      mode: 'exploration',
      party: Object.fromEntries(heroes.map((h) => [h.id, h])),
      props: [
        {
          id: 'corpse-goblin-1',
          x: 2,
          y: 1,
          kind: 'corpse',
          state: 'open',
          blocksMovement: false,
          blocksSight: false,
          discovered: true,
          monsterId: 'goblin-1',
          label: 'Remains of Goblin',
          searched: true,
          lootTable: { gp: 5, items: ['acid-vial'], origin: 'monster_drop', sourceName: 'Goblin' },
        },
        {
          id: 'corpse-goblin-2',
          x: 2,
          y: 2,
          kind: 'corpse',
          state: 'open',
          blocksMovement: false,
          blocksSight: false,
          discovered: true,
          monsterId: 'goblin-2',
          label: 'Remains of Goblin',
          searched: false,
          lootTable: { gp: 7, items: ['acid-vial'], origin: 'monster_drop', sourceName: 'Goblin' },
        },
      ],
    };
    const fighterBefore = state.party['fighter-1']!.buildState!.currency;
    const wizardBefore = state.party['wizard-1']!.buildState!.currency;
    const res = sweepUnclaimedCorpseLoot(state, compendium);
    expect(res.sweptPropIds.sort()).toEqual(['corpse-goblin-1', 'corpse-goblin-2']);
    for (const id of res.sweptPropIds) {
      expect(res.nextState.props.find((p) => p.id === id)!.lootTable).toBeUndefined();
    }
    // Round-robin across conscious heroes sorted by id: one bundle each.
    const fighterItems = res.nextState.party['fighter-1']!.buildState!.inventory;
    const wizardItems = res.nextState.party['wizard-1']!.buildState!.inventory;
    expect(fighterItems.find((i) => i.itemId === 'acid-vial')?.instanceId).toBe(
      'sweep-corpse-goblin-1-acid-vial-0',
    );
    expect(wizardItems.find((i) => i.itemId === 'acid-vial')?.instanceId).toBe(
      'sweep-corpse-goblin-2-acid-vial-0',
    );
    expect(res.nextState.party['fighter-1']!.buildState!.currency.gp).toBe(
      fighterBefore.gp + 5,
    );
    expect(res.nextState.party['wizard-1']!.buildState!.currency.gp).toBe(
      wizardBefore.gp + 7,
    );
    const acquisitions = res.events.filter((e) => e.type === 'LOOT_ACQUIRED');
    expect(acquisitions).toHaveLength(2);
    for (const ev of acquisitions) {
      if (ev.type === 'LOOT_ACQUIRED') expect(ev.loot.origin).toBe('monster_drop');
    }
    // Deterministic replay.
    const replay = sweepUnclaimedCorpseLoot(state, compendium);
    expect(replay.nextState.party).toEqual(res.nextState.party);
  });

  it('sweep is a no-op without lootable corpses or conscious heroes', () => {
    const { state } = stateWithCorpse();
    const empty = sweepUnclaimedCorpseLoot({ ...state, props: [] }, compendium);
    expect(empty.sweptPropIds).toEqual([]);
    expect(empty.events).toEqual([]);

    const allDead = structuredClone(state);
    for (const hero of Object.values(allDead.party)) {
      hero.isDead = true;
      hero.currentHp = 0;
    }
    const wiped = sweepUnclaimedCorpseLoot(allDead, compendium);
    expect(wiped.sweptPropIds).toEqual([]);
  });
});

describe('SRD-1307: corpses never block movement or threaten', () => {
  const grid = createTacticalGrid(8, 8, 'floor_stone', 'bright');
  const mover: GridCreature = { id: 'hero', x: 1, y: 1, size: 'medium', faction: 'party' };
  const deadFoe: GridCreature = {
    id: 'goblin',
    x: 2,
    y: 1,
    size: 'medium',
    faction: 'enemy',
    isDead: true,
  };
  const liveFoe: GridCreature = { ...deadFoe, isDead: false };

  it('heroes end, pass, and path through corpse cells at normal cost', () => {
    expect(canEndMoveAt(grid, mover, { x: 2, y: 1 }, [deadFoe])).toBe(true);
    expect(canEndMoveAt(grid, mover, { x: 2, y: 1 }, [liveFoe])).toBe(false);
    expect(isFootprintStepDifficultTerrain(grid, mover, { x: 2, y: 1 }, [deadFoe])).toBe(false);
    expect(isFootprintStepDifficultTerrain(grid, mover, { x: 2, y: 1 }, [liveFoe])).toBe(true);
  });

  it('corpses never provoke Opportunity Attacks', () => {
    const deadTriggers = detectStepOpportunityAttacks(
      mover,
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      [{ ...deadFoe, x: 2, y: 1 }],
    );
    expect(deadTriggers).toEqual([]);
    const liveTriggers = detectStepOpportunityAttacks(
      mover,
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      [{ ...liveFoe, x: 2, y: 1 }],
    );
    expect(liveTriggers.length).toBeGreaterThan(0);
  });
});
