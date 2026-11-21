import { describe, expect, it } from 'vitest';
import { createTacticalGrid } from '../grid/model.js';
import { createInitialGameState, reduceGame } from '../state/reducer.js';
import { resolveUseItem } from '../dungeon/use-item.js';
import type { Combatant } from '../combat/types.js';
import type { GameState } from '../state/types.js';

function makeHero(
  id: string,
  x: number,
  y: number,
  opts: { hp?: number; maxHp?: number; inventory?: Array<Record<string, unknown>>; slots3?: number } = {},
): Combatant {
  const hp = opts.hp ?? 20;
  const maxHp = opts.maxHp ?? 20;
  const c = {
    id,
    name: id,
    side: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: hp,
    maxHp,
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
    spellSlots:
      opts.slots3 !== undefined
        ? { '3': { max: 2, expended: 2 - opts.slots3, available: opts.slots3 } }
        : undefined,
    characterSheet: {
      abilities: {
        str: { score: 10, modifier: 0 },
        dex: { score: 14, modifier: 2 },
        con: { score: 14, modifier: 2 },
        int: { score: 12, modifier: 1 },
        wis: { score: 14, modifier: 2 },
        cha: { score: 12, modifier: 1 },
      },
      proficiencyBonus: 2,
      totalLevel: 3,
      classes: [{ level: 3 }],
      spellcasting:
        opts.slots3 !== undefined
          ? {
              classes: [{ level: 3, spellSaveDc: 13, abilityModifier: 2 }],
              spellSlots: { '3': { max: 2, expended: 2 - opts.slots3, available: opts.slots3 } },
            }
          : { classes: [{ level: 1, spellSaveDc: 13, abilityModifier: 2 }] },
      deathSaves: { successes: 0, failures: 0 },
      activeConditions: [],
    },
    buildState: {
      inventory: opts.inventory ?? [],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    },
  } as unknown as Combatant;
  return c;
}

function makeGoblin(id: string, x: number, y: number): Combatant {
  return {
    id,
    name: id,
    side: 'monster',
    size: 'small',
    position: { x, y },
    speedFeet: 30,
    currentHp: 30,
    maxHp: 30,
    tempHp: 0,
    armorClass: 13,
    dexterityScore: 14,
    dexterityModifier: 2,
    initiativeBonus: 2,
    initiativeRollMode: 'normal',
    passivePerception: 9,
    stealthModifier: 6,
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
  } as unknown as Combatant;
}

function potionInstance(instanceId: string, itemId = 'potion-of-healing', quantity = 1) {
  return { instanceId, itemId, quantity, isMagicItem: false, identified: true };
}

/** Advance turns until the given hero is the active combatant (bounded). */
function activateHero(state: GameState, heroId: string): GameState {
  let s = state;
  for (let i = 0; i < 6; i++) {
    if (s.combat?.activeCombatantId === heroId) return s;
    const active = s.combat?.activeCombatantId;
    if (!active) return s;
    s = reduceGame(s, { type: 'END_TURN', actorId: active }).nextState;
  }
  return s;
}

describe('SRD-1303 USE_ITEM consumables engine path', () => {
  it('drinking a potion in exploration heals, consumes the stack, and emits ITEM_CONSUMED (seeded, no Math.random)', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('hero-1', 1, 1, {
      hp: 5,
      inventory: [potionInstance('inst-potion-1')],
    });
    const s0 = createInitialGameState({ grid, party: [hero], rngState: 12345 });
    expect(s0.mode).toBe('exploration');

    const res = reduceGame(s0, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-potion-1',
    });

    const after = res.nextState.party['hero-1']!;
    // 2d4+2 => 4..10 healing (plus possible Religion passive, still > 0).
    expect(after.currentHp).toBeGreaterThan(5);
    expect(after.currentHp).toBeLessThanOrEqual(20);
    expect(after.buildState!.inventory).toHaveLength(0);

    const consumed = res.events.find((e) => e.type === 'ITEM_CONSUMED');
    expect(consumed).toMatchObject({
      characterId: 'hero-1',
      itemInstanceId: 'inst-potion-1',
      itemId: 'potion-of-healing',
      quantityRemaining: 0,
    });
    expect(res.events.some((e) => e.type === 'INVENTORY_UPDATED')).toBe(true);
    expect(res.events.some((e) => e.type === 'HEAL_APPLIED')).toBe(true);

    // Deterministic replay: same seed + same command => identical healing.
    const again = reduceGame(
      createInitialGameState({
        grid,
        party: [makeHero('hero-1', 1, 1, { hp: 5, inventory: [potionInstance('inst-potion-1')] })],
        rngState: 12345,
      }),
      { type: 'USE_ITEM', actorId: 'hero-1', itemInstanceId: 'inst-potion-1' },
    );
    expect(again.nextState.party['hero-1']!.currentHp).toBe(after.currentHp);
  });

  it('drinking a potion in combat heals and spends the action', () => {
    const grid = createTacticalGrid(12, 12);
    const hero = makeHero('hero-1', 2, 2, {
      hp: 6,
      inventory: [potionInstance('inst-potion-1')],
    });
    const goblin = makeGoblin('goblin-1', 7, 7);
    let s = createInitialGameState({ grid, party: [hero], monsters: [goblin], rngState: 777 });
    s = reduceGame(s, { type: 'START_COMBAT', encounterId: 'enc-1' }).nextState;
    s = activateHero(s, 'hero-1');
    expect(s.combat?.activeCombatantId).toBe('hero-1');
    const actionBefore = s.combat!.turnBudget!.action;

    const res = reduceGame(s, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-potion-1',
    });

    const afterHero = res.nextState.combat!.combatants['hero-1']!;
    expect(afterHero.currentHp).toBeGreaterThan(6);
    expect(res.nextState.combat!.turnBudget!.action).toBe(actionBefore - 1);
    expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
  });

  it('antitoxin applies its buff out of combat and is consumed', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('hero-1', 1, 1, {
      inventory: [{ instanceId: 'inst-anti-1', itemId: 'antitoxin', quantity: 1, identified: true }],
    });
    const s0 = createInitialGameState({ grid, party: [hero], rngState: 42 });
    const res = reduceGame(s0, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-anti-1',
    });
    const after = res.nextState.party['hero-1']!;
    expect(after.activeEffects?.some((e) => e.effectId === 'antitoxin-buff')).toBe(true);
    expect(after.buildState!.inventory).toHaveLength(0);
    expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
  });

  it('acid vial requires combat; in combat it resolves an attack roll and is consumed', () => {
    const grid = createTacticalGrid(12, 12);
    // Exploration use must be rejected (hostile item).
    const heroExp = makeHero('hero-1', 1, 1, {
      inventory: [{ instanceId: 'inst-acid-1', itemId: 'acid-vial', quantity: 1, identified: true }],
    });
    const sExp = createInitialGameState({ grid, party: [heroExp], rngState: 9 });
    expect(() =>
      reduceGame(sExp, { type: 'USE_ITEM', actorId: 'hero-1', itemInstanceId: 'inst-acid-1' }),
    ).toThrow(/requires combat/);

    // Combat use resolves the overlay attack_roll chain at the target.
    const hero = makeHero('hero-1', 2, 2, {
      inventory: [{ instanceId: 'inst-acid-1', itemId: 'acid-vial', quantity: 1, identified: true }],
    });
    const goblin = makeGoblin('goblin-1', 3, 2);
    let s = createInitialGameState({ grid, party: [hero], monsters: [goblin], rngState: 31337 });
    s = reduceGame(s, { type: 'START_COMBAT', encounterId: 'enc-acid' }).nextState;
    s = activateHero(s, 'hero-1');

    const res = reduceGame(s, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-acid-1',
      targetId: 'goblin-1',
    });
    expect(res.events.some((e) => e.type === 'ATTACK_RESOLVED')).toBe(true);
    expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
    expect(res.nextState.party['hero-1']!.buildState!.inventory).toHaveLength(0);
  });

  it('wand of magic missiles decrements charges, refuses at 0, and recharges at dawn', () => {
    const grid = createTacticalGrid(20, 20);
    const wand = {
      instanceId: 'inst-wand-1',
      itemId: 'wand-of-magic-missiles',
      quantity: 1,
      isMagicItem: true,
      chargesRemaining: 1,
      identified: true,
    };
    const hero = makeHero('hero-1', 2, 2, { inventory: [wand] });
    const goblin = makeGoblin('goblin-1', 4, 2);
    let s = createInitialGameState({ grid, party: [hero], monsters: [goblin], rngState: 2024 });
    s = reduceGame(s, { type: 'START_COMBAT', encounterId: 'enc-wand' }).nextState;
    s = activateHero(s, 'hero-1');
    const goblinHpBefore = s.combat!.combatants['goblin-1']!.currentHp;

    const used = reduceGame(s, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-wand-1',
      targetId: 'goblin-1',
    });
    const chargesEvt = used.events.find((e) => e.type === 'CHARGES_CHANGED');
    expect(chargesEvt).toMatchObject({
      characterId: 'hero-1',
      itemInstanceId: 'inst-wand-1',
      itemId: 'wand-of-magic-missiles',
      chargesRemaining: 0,
      chargesMax: 7,
    });
    // Wand is not consumed from inventory — only its charges drop.
    expect(used.nextState.party['hero-1']!.buildState!.inventory).toHaveLength(1);
    // Magic missile auto-hits for force damage.
    const goblinAfter = used.nextState.combat!.combatants['goblin-1']!;
    expect(goblinAfter.currentHp).toBeLessThan(goblinHpBefore);

    // Second use at 0 charges is refused.
    expect(() =>
      reduceGame(used.nextState, {
        type: 'USE_ITEM',
        actorId: 'hero-1',
        itemInstanceId: 'inst-wand-1',
        targetId: 'goblin-1',
      }),
    ).toThrow(/no charges remaining/);

    // Dawn recharge: long rest refills charges (seeded 1d6+1, capped at 7).
    const restGrid = createTacticalGrid(10, 10);
    const restHero = makeHero('hero-1', 1, 1, {
      inventory: [
        {
          instanceId: 'inst-wand-1',
          itemId: 'wand-of-magic-missiles',
          quantity: 1,
          isMagicItem: true,
          chargesRemaining: 0,
          identified: true,
        },
      ],
    });
    const restState = createInitialGameState({ grid: restGrid, party: [restHero], rngState: 555 });
    const rested = reduceGame(
      restState,
      { type: 'START_REST', restType: 'long', forceSafe: true },
      undefined,
    );
    const recharged = rested.nextState.party['hero-1']!.buildState!.inventory[0]!;
    expect(recharged.chargesRemaining).toBeGreaterThan(0);
    expect(recharged.chargesRemaining).toBeLessThanOrEqual(7);
    expect(rested.events.some((e) => e.type === 'CHARGES_CHANGED')).toBe(true);
  });

  it('scroll of fireball is consumed to cast slot-free in combat', () => {
    const grid = createTacticalGrid(24, 24);
    const hero = makeHero('hero-1', 2, 2, {
      slots3: 0,
      inventory: [
        { instanceId: 'inst-scroll-1', itemId: 'scroll-of-fireball', quantity: 1, identified: true },
      ],
    });
    const goblin = makeGoblin('goblin-1', 5, 5);
    let s = createInitialGameState({ grid, party: [hero], monsters: [goblin], rngState: 9001 });
    s = reduceGame(s, { type: 'START_COMBAT', encounterId: 'enc-scroll' }).nextState;
    s = activateHero(s, 'hero-1');
    const goblinHpBefore = s.combat!.combatants['goblin-1']!.currentHp;

    const res = reduceGame(s, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-scroll-1',
      targetId: 'goblin-1',
    });

    const castEvt = res.events.find((e) => e.type === 'SPELL_CAST');
    expect(castEvt).toMatchObject({ actorId: 'hero-1', spellId: 'fireball' });
    // Slot-free: the marker carries no slot expenditure and pools stay empty.
    expect((castEvt as unknown as { slotExpended?: number }).slotExpended).toBeUndefined();
    const casterAfter = res.nextState.combat!.combatants['hero-1']!;
    expect(casterAfter.spellSlots?.['3']?.available ?? 0).toBe(0);
    // Scroll consumed, goblin damaged by the AOE.
    expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
    expect(res.nextState.party['hero-1']!.buildState!.inventory).toHaveLength(0);
    const goblinAfter = res.nextState.combat!.combatants['goblin-1']!;
    expect(goblinAfter.currentHp).toBeLessThanOrEqual(goblinHpBefore);
  });

  it('quantity stacks decrement instead of removing the instance', () => {
    const grid = createTacticalGrid(10, 10);
    const hero = makeHero('hero-1', 1, 1, {
      hp: 4,
      inventory: [potionInstance('inst-potion-stack', 'potion-of-healing', 2)],
    });
    const s0 = createInitialGameState({ grid, party: [hero], rngState: 11 });
    const res = reduceGame(s0, {
      type: 'USE_ITEM',
      actorId: 'hero-1',
      itemInstanceId: 'inst-potion-stack',
    });
    const inv = res.nextState.party['hero-1']!.buildState!.inventory;
    expect(inv).toHaveLength(1);
    expect(inv[0]!.quantity).toBe(1);
    expect(res.events).toContainEqual(
      expect.objectContaining({ type: 'ITEM_CONSUMED', quantityRemaining: 1 }),
    );
  });

  it('soak: every bundled consumable resolves or rejects cleanly with seeded dice', () => {
    // Direct resolveUseItem soak across all consumable overlays — no throws
    // other than the documented requires-combat rejections, no Math.random.
    const grid = createTacticalGrid(12, 12);
    const cases: Array<{ itemId: string; hostile: boolean }> = [
      { itemId: 'potion-of-healing', hostile: false },
      { itemId: 'antitoxin', hostile: false },
      { itemId: 'acid-vial', hostile: true },
      { itemId: "alchemists-fire", hostile: true },
    ];
    for (const [idx, c] of cases.entries()) {
      const hero = makeHero(`hero-${idx}`, 2, 2, {
        hp: 10,
        inventory: [{ instanceId: `inst-${idx}`, itemId: c.itemId, quantity: 1, identified: true }],
      });
      const goblin = makeGoblin(`gob-${idx}`, 3, 2);
      const base = createInitialGameState({ grid, party: [hero], monsters: [goblin], rngState: 1000 + idx });
      if (!c.hostile) {
        const res = resolveUseItem(base, { actorId: hero.id, itemInstanceId: `inst-${idx}` });
        expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
      } else {
        expect(() =>
          resolveUseItem(base, { actorId: hero.id, itemInstanceId: `inst-${idx}` }),
        ).toThrow(/requires combat/);
        let s = reduceGame(base, { type: 'START_COMBAT', encounterId: `enc-soak-${idx}` }).nextState;
        s = activateHero(s, hero.id);
        const res = reduceGame(s, {
          type: 'USE_ITEM',
          actorId: hero.id,
          itemInstanceId: `inst-${idx}`,
          targetId: `gob-${idx}`,
        });
        expect(res.events.some((e) => e.type === 'ITEM_CONSUMED')).toBe(true);
      }
    }
  });
});
