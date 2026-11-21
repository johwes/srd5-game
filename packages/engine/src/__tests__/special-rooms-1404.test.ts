import { describe, expect, it } from 'vitest';
import { defaultCompendium } from '@srd5/data';
import {
  CURSED_SHRINE_GP_COST,
  CURSED_SHRINE_HP_COST,
  CURSED_SHRINE_TYPE,
  NEST_PACK_MAX,
  NEST_PACK_MIN,
  NEST_XP_MULTIPLIER,
  SPECIAL_ROOM_FLOOR_CHANCE,
  VAULT_LOCK_DC_MAX,
  VAULT_LOCK_DC_MIN,
  VAULT_TRAP_CHANCE,
  createDungeonGameState,
  cursedShrineCostPreview,
  generateDungeonFloor,
  getAvailablePropInteractions,
  getTableForDepth,
  reduceGame,
  rollCursedBoon,
  rollNestPack,
  rollNestPackSize,
  rollSpecialRoomForFloor,
  rollVaultHoard,
  specialRoomDisplayName,
  startRogueliteRun,
  transitionCombatToExploration,
  triggerDungeonEncounter,
  vaultLockDcForDepth,
  verifyDungeonConnectivity,
  type Combatant,
  type DungeonFloorSpec,
  type GameState,
} from '../index.js';

/**
 * SRD-1404: Special Rooms & Delve Events (Spec 13 §6).
 * Acceptance: ≤1 special room per floor (never depth 1); vault opens to a
 * magic-biased hoard; cursed shrine costs then boons (decline free); nest
 * listenable + bonus XP via the existing award path.
 */

function makeHero(id: string, x = 2, y = 2, overrides?: Partial<Combatant>): Combatant {
  return {
    id,
    name: 'Fighter',
    side: 'party',
    teamId: 'party',
    size: 'medium',
    position: { x, y },
    speedFeet: 30,
    currentHp: 20,
    maxHp: 20,
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

function makeNestFloor(): DungeonFloorSpec {
  const cells: DungeonFloorSpec['cells'] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      cells.push({ x, y, terrain: 'floor_stone', baseLight: 'bright', elevationFeet: 0 });
    }
  }
  return {
    id: 'floor_nest_test',
    name: 'Nest Test Floor',
    width: 8,
    height: 8,
    partySpawnCells: [{ x: 1, y: 1 }],
    cells,
    props: [],
    encounters: [
      {
        id: 'enc_nest',
        roomId: 'room_den',
        triggered: false,
        monsters: [
          { monsterId: 'goblin', spawnX: 5, spawnY: 4 },
          { monsterId: 'goblin', spawnX: 6, spawnY: 4 },
          { monsterId: 'goblin', spawnX: 5, spawnY: 5 },
        ],
        xpMultiplier: NEST_XP_MULTIPLIER,
      },
    ],
    rooms: [{ id: 'room_den', name: 'Gnawed Nest', specialRoom: 'nest' }],
  };
}

/** Finds the first seed in [from, to] whose floor at `depth` carries `kind`. */
function findSeedWithSpecial(
  kind: 'vault' | 'cursed_shrine' | 'nest',
  depth = 2,
  from = 1,
  to = 400,
): number {
  for (let seed = from; seed <= to; seed++) {
    const gen = generateDungeonFloor({ depth, seed, width: 36, height: 36, targetRoomCount: 5 });
    if (gen.floor.rooms?.some((r) => r.specialRoom === kind)) return seed;
  }
  throw new Error(`no ${kind} room found at depth ${depth} in seeds ${from}..${to}`);
}

describe('SRD-1404: Special Rooms & Delve Events', () => {
  describe('pure rolls (seeded, deterministic)', () => {
    it('never picks a special room on depth 1 and consumes no RNG there', () => {
      for (const seed of [1, 7, 4242, 99999]) {
        const roll = rollSpecialRoomForFloor(seed, 1, 4);
        expect(roll.kind).toBeUndefined();
        expect(roll.nextState).toBe(seed);
      }
    });

    it('is deterministic per seed and observes the floor chance in bounds', () => {
      const a = rollSpecialRoomForFloor(12345, 3, 4);
      expect(a).toEqual(rollSpecialRoomForFloor(12345, 3, 4));
      expect(SPECIAL_ROOM_FLOOR_CHANCE).toBe(0.4);

      let hits = 0;
      const N = 3000;
      for (let seed = 1; seed <= N; seed++) {
        if (rollSpecialRoomForFloor(seed, 3, 4).kind !== undefined) hits++;
      }
      const rate = hits / N;
      expect(rate).toBeGreaterThan(0.3);
      expect(rate).toBeLessThan(0.5);
    });

    it('rolls all three kinds across seeds with a valid room index', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 3000 && seen.size < 3; seed++) {
        const roll = rollSpecialRoomForFloor(seed, 4, 5);
        if (roll.kind) {
          seen.add(roll.kind);
          expect(roll.eligibleIndex).toBeGreaterThanOrEqual(0);
          expect(roll.eligibleIndex).toBeLessThan(5);
        }
      }
      expect([...seen].sort()).toEqual(['cursed_shrine', 'nest', 'vault']);
    });

    it('scales vault lock DC 15–20 by depth', () => {
      expect(VAULT_LOCK_DC_MIN).toBe(15);
      expect(VAULT_LOCK_DC_MAX).toBe(20);
      expect(vaultLockDcForDepth(2)).toBe(15);
      expect(vaultLockDcForDepth(3)).toBe(15);
      for (let d = 1; d <= 20; d++) {
        const dc = vaultLockDcForDepth(d);
        expect(dc).toBeGreaterThanOrEqual(15);
        expect(dc).toBeLessThanOrEqual(20);
      }
      expect(vaultLockDcForDepth(13)).toBe(20);
      expect(vaultLockDcForDepth(20)).toBe(20);
    });

    it('rolls vault hoards with depth-scaled gold and a guaranteed magic item', () => {
      const { loot, nextRng } = rollVaultHoard(777, 4);
      expect(loot.gp).toBeGreaterThan(0);
      expect(loot.items?.length).toBeGreaterThanOrEqual(2);
      expect(loot.origin).toBe('cache');
      for (const id of loot.items ?? []) {
        const resolves =
          defaultCompendium.getMagicItem(id) !== undefined ||
          defaultCompendium.getEquipment(id) !== undefined;
        expect(resolves, `vault item ${id} resolves in compendium`).toBe(true);
      }
      // Deterministic replay.
      expect(rollVaultHoard(777, 4)).toEqual({ loot, nextRng });
      // Deeper delves hoard more gold on average.
      let shallow = 0;
      let deep = 0;
      for (let s = 1; s <= 20; s++) {
        shallow += rollVaultHoard(s, 2).loot.gp ?? 0;
        deep += rollVaultHoard(s, 10).loot.gp ?? 0;
      }
      expect(deep).toBeGreaterThan(shallow);
    });

    it('rolls nest packs of 3–5 from the depth band', () => {
      expect(NEST_PACK_MIN).toBe(3);
      expect(NEST_PACK_MAX).toBe(5);
      const band = new Set(getTableForDepth(4).map((e) => e.monsterId));
      for (let seed = 1; seed <= 60; seed++) {
        const pack = rollNestPack(seed, 4);
        expect(pack.packSize).toBeGreaterThanOrEqual(3);
        expect(pack.packSize).toBeLessThanOrEqual(5);
        expect(band.has(pack.monsterId), `nest pick ${pack.monsterId} in band`).toBe(true);
      }
      expect(rollNestPackSize(99)).toEqual(rollNestPackSize(99));
    });

    it('rolls both cursed boons across seeds, deterministically', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 100; seed++) seen.add(rollCursedBoon(seed).boon);
      expect([...seen].sort()).toEqual(['arcane', 'blood']);
      expect(cursedShrineCostPreview()).toMatch(/10 HP/);
      expect(cursedShrineCostPreview()).toMatch(/50 gp/);
      expect(cursedShrineCostPreview()).toMatch(/decline free/i);
      expect(specialRoomDisplayName('vault')).toBe('Sealed Vault');
      expect(specialRoomDisplayName('cursed_shrine')).toBe('Cursed Shrine');
      expect(specialRoomDisplayName('nest')).toBe('Gnawed Nest');
    });
  });

  describe('generator wiring (≤1 per floor, never depth 1)', () => {
    it('places no special room on depth 1 across seeds', () => {
      for (const seed of [11, 22, 33, 4242, 777001]) {
        const gen = generateDungeonFloor({ depth: 1, seed, width: 36, height: 36, targetRoomCount: 5 });
        expect(gen.floor.rooms?.some((r) => r.specialRoom !== undefined)).toBe(false);
        expect(gen.floor.props.some((p) => p.id.startsWith('vault_'))).toBe(false);
        expect(gen.floor.props.some((p) => p.shrineType === CURSED_SHRINE_TYPE)).toBe(false);
      }
    });

    it('marks at most one special room per floor and stays deterministic', () => {
      const seenKinds = new Set<string>();
      for (let seed = 1; seed <= 120; seed++) {
        const gen = generateDungeonFloor({ depth: 4, seed, width: 36, height: 36, targetRoomCount: 5 });
        const marked = (gen.floor.rooms ?? []).filter((r) => r.specialRoom !== undefined);
        expect(marked.length).toBeLessThanOrEqual(1);
        for (const r of marked) seenKinds.add(r.specialRoom!);
        const again = generateDungeonFloor({ depth: 4, seed, width: 36, height: 36, targetRoomCount: 5 });
        expect(JSON.stringify(again.floor)).toBe(JSON.stringify(gen.floor));
        expect(verifyDungeonConnectivity(gen.floor).isFullyConnected).toBe(true);
      }
      expect([...seenKinds].sort()).toEqual(['cursed_shrine', 'nest', 'vault']);
    });

    it('never marks the entrance or the boss (stairs-down) room special', () => {
      for (let seed = 1; seed <= 60; seed++) {
        const gen = generateDungeonFloor({ depth: 3, seed, width: 36, height: 36, targetRoomCount: 6 });
        const stairsDown = gen.floor.props.find((p) => p.kind === 'stairs_down')!;
        const bossCell = gen.floor.cells.find((c) => c.x === stairsDown.x && c.y === stairsDown.y);
        const entrance = gen.floor.rooms?.[0];
        for (const room of gen.floor.rooms ?? []) {
          if (room.specialRoom === undefined) continue;
          expect(room.id).not.toBe(entrance?.id);
          if (bossCell?.roomId) expect(room.id).not.toBe(bossCell.roomId);
        }
      }
    });
  });

  describe('treasure vault (locked room + magic-biased hoard)', () => {
    it('locks the vault threshold DC 15–20 and stocks a magic-biased hoard chest', () => {
      const seed = findSeedWithSpecial('vault');
      const gen = generateDungeonFloor({ depth: 2, seed, width: 36, height: 36, targetRoomCount: 5 });
      const vaultRoom = gen.floor.rooms!.find((r) => r.specialRoom === 'vault')!;
      expect(vaultRoom.name).toBe('Sealed Vault');

      const doors = gen.floor.props.filter((p) => p.kind === 'door' && p.state === 'locked');
      expect(doors.length).toBeGreaterThan(0);
      for (const d of doors) {
        expect(d.lockDc).toBeGreaterThanOrEqual(15);
        expect(d.lockDc).toBeLessThanOrEqual(20);
      }

      const chest = gen.floor.props.find((p) => p.id === 'vault_chest_2')!;
      expect(chest).toMatchObject({ kind: 'chest', state: 'locked' });
      expect(chest.lockDc).toBeGreaterThanOrEqual(15);
      expect(chest.lootTable?.items?.length).toBeGreaterThanOrEqual(2);
      expect(chest.lootTable?.origin).toBe('cache');
    });

    it('traps roughly half of vault chests across seeds (existing trap pipeline)', () => {
      let trapped = 0;
      let total = 0;
      for (let seed = 1; seed <= 400 && total < 60; seed++) {
        const gen = generateDungeonFloor({ depth: 5, seed, width: 36, height: 36, targetRoomCount: 5 });
        const chest = gen.floor.props.find((p) => p.id === 'vault_chest_5');
        if (!chest) continue;
        total++;
        if (chest.trapDamageFormula !== undefined) {
          trapped++;
          expect(chest.detectionDc).toBeGreaterThan(0);
          expect(chest.disarmDc).toBeGreaterThan(0);
        }
      }
      expect(total).toBeGreaterThan(20);
      const rate = trapped / total;
      expect(rate).toBeGreaterThan(0.3);
      expect(rate).toBeLessThan(0.7);
      expect(VAULT_TRAP_CHANCE).toBe(0.5);
    });

    it('opens the vault through the prop card pipeline to a magic-biased hoard', () => {
      const seed = findSeedWithSpecial('vault');
      const gen = generateDungeonFloor({ depth: 2, seed, width: 36, height: 36, targetRoomCount: 5 });
      const chest = gen.floor.props.find((p) => p.id === 'vault_chest_2')!;

      // Card offers the state-gated locked-chest actions with check previews.
      const options = getAvailablePropInteractions(
        { ...chest, discovered: true },
        makeHero('rogue-1', chest.x + 1, chest.y),
      );
      expect(options.map((o) => o.interaction)).toEqual(
        expect.arrayContaining(['pick_lock', 'force_open']),
      );
      const pick = options.find((o) => o.interaction === 'pick_lock')!;
      expect(pick.checkHint).toMatch(new RegExp(`DC ${chest.lockDc}`));
      if (chest.trapDamageFormula) {
        expect(pick.riskHint).toMatch(/trap/i);
      }

      // A master thief picks the vault lock, then opens it to the hoard.
      // (+24 tools bonus beats any vault DC 15–20 on any d20 roll.)
      const rogue = makeHero('rogue-1', chest.x + 1, chest.y, {
        dexterityScore: 30,
        dexterityModifier: 10,
      });
      (rogue as unknown as { characterSheet: object }).characterSheet = {
        abilities: { dex: { modifier: 10 } },
        proficiencyBonus: 14,
        proficiencies: { tools: ['thieves_tools'] },
        skills: {},
        savingThrows: {},
      };
      let state = createDungeonGameState({ floor: gen.floor, party: [rogue] });
      // March the rogue up to the vault chest (movement is covered elsewhere).
      state = {
        ...state,
        party: {
          ...state.party,
          'rogue-1': {
            ...state.party['rogue-1']!,
            position: { x: chest.x + 1, y: chest.y },
          },
        },
      };
      const picked = reduceGame(state, {
        type: 'INTERACT_PROP',
        actorId: 'rogue-1',
        propId: chest.id,
        interaction: 'pick_lock',
      });
      expect(picked.nextState.props.find((p) => p.id === chest.id)?.state).toBe('closed');
      state = picked.nextState;
      const opened = reduceGame(state, {
        type: 'INTERACT_PROP',
        actorId: 'rogue-1',
        propId: chest.id,
        interaction: 'open',
      });
      const loot = opened.events.find((e) => e.type === 'LOOT_ACQUIRED');
      expect(loot).toBeDefined();
      expect(loot).toMatchObject({ propId: chest.id });
      const bundle = (loot as unknown as { loot: { items?: string[]; origin?: string } }).loot;
      expect(bundle.items?.length).toBeGreaterThanOrEqual(2);
      expect(bundle.origin).toBe('cache');
    });
  });

  describe('cursed shrine (pay HP/gp for a seeded boon, decline free)', () => {
    function cursedRunState(seed = 4242) {
      const session = startRogueliteRun({ seed });
      const heroId = Object.keys(session.gameState.party)[0]!;
      const hero = session.gameState.party[heroId]!;
      const nextGame = structuredClone(session.gameState);
      nextGame.props.push({
        id: 'cursed_test',
        x: hero.position.x + 1,
        y: hero.position.y,
        kind: 'shrine',
        shrineType: CURSED_SHRINE_TYPE,
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
      });
      return { session, heroId, gameState: nextGame as GameState };
    }

    it('demands an explicit offering instead of firing for free', () => {
      const { session, heroId, gameState } = cursedRunState();
      expect(() =>
        reduceGame(gameState, { type: 'ACTIVATE_SHRINE', actorId: heroId, shrineId: 'cursed_test' }),
      ).toThrow(/offering/);
      expect(session).toBeDefined();
    });

    it('declining is free: no cost, no boon, shrine stays sealed', () => {
      const { session, heroId, gameState } = cursedRunState();
      const before = structuredClone(gameState);
      const res = reduceGame(gameState, {
        type: 'ACTIVATE_SHRINE',
        actorId: heroId,
        shrineId: 'cursed_test',
        offering: 'decline',
      });
      expect(res.events.filter((e) => e.type === 'SHRINE_ACTIVATED')).toHaveLength(0);
      expect(res.nextState.props.find((p) => p.id === 'cursed_test')?.state).toBe('closed');
      expect(res.nextState.party[heroId]).toEqual(before.party[heroId]);
    });

    it('paying HP costs 10 HP then grants the seeded blood/arcane boon', () => {
      const { heroId, gameState } = cursedRunState();
      const beforeHp = gameState.party[heroId]!.currentHp;
      const boon = rollCursedBoon(gameState.rngState).boon;
      const res = reduceGame(gameState, {
        type: 'ACTIVATE_SHRINE',
        actorId: heroId,
        shrineId: 'cursed_test',
        offering: 'hp',
      });
      const hero = res.nextState.party[heroId]!;
      expect(hero.currentHp).toBe(beforeHp - CURSED_SHRINE_HP_COST);
      const shrineEvent = res.events.find((e) => e.type === 'SHRINE_ACTIVATED');
      expect(shrineEvent).toMatchObject({ shrineId: 'cursed_test', shrineType: CURSED_SHRINE_TYPE });
      expect(res.nextState.props.find((p) => p.id === 'cursed_test')?.state).toBe('open');
      if (boon === 'blood') {
        expect(hero.blessings).toContain('shrine_blood_god');
      }
    });

    it('paying gp debits 50 gp with an inventory event, and rejects poor heroes', () => {
      const { heroId, gameState } = cursedRunState();
      const funded = structuredClone(gameState);
      funded.party[heroId]!.buildState = {
        ...funded.party[heroId]!.buildState!,
        currency: { cp: 0, sp: 0, ep: 0, gp: 200, pp: 0 },
        inventory: [],
      };
      const res = reduceGame(funded, {
        type: 'ACTIVATE_SHRINE',
        actorId: heroId,
        shrineId: 'cursed_test',
        offering: 'gp',
      });
      expect(res.events.find((e) => e.type === 'SHRINE_ACTIVATED')).toBeDefined();
      expect(res.events.find((e) => e.type === 'INVENTORY_UPDATED')).toMatchObject({
        characterId: heroId,
      });
      expect(res.nextState.party[heroId]!.buildState!.currency.gp).toBe(
        200 - CURSED_SHRINE_GP_COST,
      );

      const poor = structuredClone(gameState);
      poor.party[heroId]!.buildState = {
        ...poor.party[heroId]!.buildState!,
        currency: { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 },
        inventory: [],
      };
      expect(() =>
        reduceGame(poor, {
          type: 'ACTIVATE_SHRINE',
          actorId: heroId,
          shrineId: 'cursed_test',
          offering: 'gp',
        }),
      ).toThrow(/cannot pay 50 gp/);
    });

    it('rejects the HP offering from heroes too weak to pay', () => {
      const { heroId, gameState } = cursedRunState();
      const weak = structuredClone(gameState);
      weak.party[heroId]!.currentHp = 10;
      expect(() =>
        reduceGame(weak, {
          type: 'ACTIVATE_SHRINE',
          actorId: heroId,
          shrineId: 'cursed_test',
          offering: 'hp',
        }),
      ).toThrow(/too weak/);
    });
  });

  describe('nest (high-density pack, bonus XP, listenable)', () => {
    it('packs 3–5 of one in-band monster with a 1.5× XP multiplier', () => {
      const seed = findSeedWithSpecial('nest', 4);
      const gen = generateDungeonFloor({ depth: 4, seed, width: 36, height: 36, targetRoomCount: 5 });
      const nestRoom = gen.floor.rooms!.find((r) => r.specialRoom === 'nest')!;
      const enc = gen.floor.encounters.find((e) => e.roomId === nestRoom.id)!;
      expect(enc).toBeDefined();
      expect(enc.monsters.length).toBeGreaterThanOrEqual(3);
      expect(enc.monsters.length).toBeLessThanOrEqual(5);
      const ids = new Set(enc.monsters.map((m) => m.monsterId));
      expect(ids.size).toBe(1);
      const band = new Set(getTableForDepth(4).map((e) => e.monsterId));
      expect(band.has([...ids][0]!)).toBe(true);
      expect(enc.xpMultiplier).toBe(NEST_XP_MULTIPLIER);
    });

    it('awards the 1.5× bonus through the existing victory award path', () => {
      const floor = makeNestFloor();
      const state = createDungeonGameState({
        floor,
        party: [makeHero('hero-1', 1, 1), makeHero('hero-2', 1, 2)],
      });
      const triggered = triggerDungeonEncounter(state, 'enc_nest');
      expect(triggered.nextState.mode).toBe('combat');

      const cleared: GameState = {
        ...triggered.nextState,
        monsters: Object.fromEntries(
          Object.entries(triggered.nextState.monsters).map(([id, m]) => [
            id,
            { ...m, isDead: true, currentHp: 0 },
          ]),
        ),
      };
      const res = transitionCombatToExploration(cleared);
      const victory = res.events.find((e) => e.type === 'ENCOUNTER_VICTORY') as
        | { xpAwarded: number; totalXp: number }
        | undefined;
      // 3 goblins × 50 XP = 150 base; nest pays floor(150 × 1.5) = 225.
      expect(victory?.totalXp).toBe(225);
      expect(victory?.xpAwarded).toBe(Math.floor(225 / 2));

      // Control: the same pack without the multiplier pays base XP.
      const plain: DungeonFloorSpec = {
        ...floor,
        encounters: [{ ...floor.encounters[0]!, xpMultiplier: undefined }],
      };
      const plainState = createDungeonGameState({
        floor: plain,
        party: [makeHero('hero-1', 1, 1), makeHero('hero-2', 1, 2)],
      });
      const plainTriggered = triggerDungeonEncounter(plainState, 'enc_nest');
      const plainCleared: GameState = {
        ...plainTriggered.nextState,
        monsters: Object.fromEntries(
          Object.entries(plainTriggered.nextState.monsters).map(([id, m]) => [
            id,
            { ...m, isDead: true, currentHp: 0 },
          ]),
        ),
      };
      const plainRes = transitionCombatToExploration(plainCleared);
      const plainVictory = plainRes.events.find((e) => e.type === 'ENCOUNTER_VICTORY') as
        | { totalXp: number }
        | undefined;
      expect(plainVictory?.totalXp).toBe(150);
    });

    it('is listenable: a neighboring door reports nest sounds without triggering', () => {
      const cells: DungeonFloorSpec['cells'] = [];
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const isWall = x === 0 || x === 9 || y === 0 || y === 9;
          cells.push({
            x,
            y,
            roomId: x <= 4 ? 'room_a' : 'room_nest',
            terrain: isWall ? 'wall_solid' : 'floor_stone',
            baseLight: 'bright',
            elevationFeet: 0,
          });
        }
      }
      const floor: DungeonFloorSpec = {
        id: 'nest_listen_floor',
        name: 'Nest Listen Floor',
        width: 10,
        height: 10,
        partySpawnCells: [{ x: 3, y: 4 }],
        cells,
        props: [
          {
            id: 'door_nest',
            x: 4,
            y: 4,
            kind: 'door',
            state: 'closed',
            blocksMovement: true,
            blocksSight: true,
            listenDc: 10,
          },
        ],
        encounters: [
          {
            id: 'enc-nest-listen',
            roomId: 'room_nest',
            triggered: false,
            monsters: [
              { monsterId: 'wolf', spawnX: 6, spawnY: 3 },
              { monsterId: 'wolf', spawnX: 6, spawnY: 4 },
              { monsterId: 'wolf', spawnX: 6, spawnY: 5 },
              { monsterId: 'wolf', spawnX: 7, spawnY: 4 },
            ],
            xpMultiplier: NEST_XP_MULTIPLIER,
          },
        ],
        rooms: [
          { id: 'room_a', name: 'Antechamber', description: 'West', isSafeRoom: false },
          { id: 'room_nest', name: 'Gnawed Nest', description: 'East', isSafeRoom: false, specialRoom: 'nest' },
        ],
      };
      const listener = makeHero('listener', 3, 4, { passivePerception: 20 });
      const state = createDungeonGameState({ floor, party: [listener], rngState: 7 });
      const res = reduceGame(state, {
        type: 'LISTEN_AT_DOOR',
        actorId: 'listener',
        propId: 'door_nest',
      });
      const check = res.events.find((e) => e.type === 'CHECK_RESOLVED') as
        | { success: boolean; note?: string }
        | undefined;
      expect(check?.success).toBe(true);
      expect(check?.note).toMatch(/snuffling|movers|movement/i);
      expect(res.nextState.dungeon!.encounters.every((e) => !e.triggered)).toBe(true);
    });
  });
});
