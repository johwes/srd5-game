import { describe, expect, it } from 'vitest';
import {
  SUNKEN_CRYPT_OF_KAELEN,
  getCampaignFloor,
  getSunkenCryptModule,
  validateCampaignModule,
} from '../campaigns/index.js';
import { CampaignModuleSpecSchema } from '../schemas/dungeon.js';
import { defaultCompendium } from '../compendium/compendium.js';

describe('SRD-506: The Sunken Crypt of Kaelen Campaign Module', () => {
  it('parses successfully against CampaignModuleSpecSchema', () => {
    const parsed = CampaignModuleSpecSchema.parse(SUNKEN_CRYPT_OF_KAELEN);
    expect(parsed.id).toBe('sunken-crypt-of-kaelen');
    expect(parsed.name).toBe('The Sunken Crypt of Kaelen');
    expect(parsed.levelRange).toEqual({ min: 1, max: 4 });
    expect(parsed.startingFloorId).toBe('kaelen-floor-1');
    expect(parsed.floors).toHaveLength(3);
  });

  it('passes comprehensive campaign referential integrity validation', () => {
    const validation = validateCampaignModule(SUNKEN_CRYPT_OF_KAELEN, defaultCompendium);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(validation.floorCount).toBe(3);
    expect(validation.totalEncounters).toBeGreaterThanOrEqual(10);
    expect(validation.totalMonsters).toBeGreaterThanOrEqual(20);
    expect(validation.totalProps).toBeGreaterThanOrEqual(15);
  });

  it('Floor 1 (The Ruined Watchtower) contains specified rooms, monsters, chest, trap, and stairs', () => {
    const floor1 = getCampaignFloor(SUNKEN_CRYPT_OF_KAELEN, 'kaelen-floor-1');
    expect(floor1).toBeDefined();
    if (!floor1) return;

    expect(floor1.name).toContain('The Ruined Watchtower');
    expect(floor1.partySpawnCells.length).toBeGreaterThanOrEqual(4);

    // Verify rooms
    const roomIds = floor1.rooms?.map((r) => r.id);
    expect(roomIds).toContain('f1_courtyard');
    expect(roomIds).toContain('f1_barracks');
    expect(roomIds).toContain('f1_armory');
    expect(roomIds).toContain('f1_trapped_hall');
    expect(roomIds).toContain('f1_warren');
    expect(roomIds).toContain('f1_descent');

    // Verify monsters across encounters
    const monsterIds = floor1.encounters.flatMap((e) => e.monsters.map((m) => m.monsterId));
    expect(monsterIds).toContain('bandit');
    expect(monsterIds).toContain('giant-rat');
    expect(monsterIds).toContain('kobold');
    expect(monsterIds).toContain('goblin-boss');
    expect(monsterIds).toContain('goblin');

    // Locked armory chest (DC 12)
    const armoryChest = floor1.props.find((p) => p.id === 'chest_f1_armory');
    expect(armoryChest).toBeDefined();
    expect(armoryChest?.kind).toBe('chest');
    expect(armoryChest?.state).toBe('locked');
    expect(armoryChest?.lockDc).toBe(12);
    expect(armoryChest?.lootTable?.items).toContain('potion-of-greater-healing');

    // Pressure plate poison dart trap (DC 13)
    const dartTrap = floor1.props.find((p) => p.id === 'trap_f1_dart');
    expect(dartTrap).toBeDefined();
    expect(dartTrap?.kind).toBe('trap');
    expect(dartTrap?.detectionDc).toBe(13);
    expect(dartTrap?.disarmDc).toBe(13);
    expect(dartTrap?.trapDamageFormula).toBe('1d10');
    expect(dartTrap?.trapDamageType).toBe('poison');
    expect(dartTrap?.trapSaveDc).toBe(13);
    expect(dartTrap?.trapSaveAbility).toBe('con');

    // Stairs down to Floor 2
    const stairsDown = floor1.props.find((p) => p.kind === 'stairs_down');
    expect(stairsDown).toBeDefined();
    expect(stairsDown?.targetFloorId).toBe('kaelen-floor-2');
  });

  it('Floor 2 (The Ossuary Halls) contains Safe Room shrine, secret door reliquary with +1 Longsword and Scroll of Fireball, and Wight boss', () => {
    const floor2 = getCampaignFloor(SUNKEN_CRYPT_OF_KAELEN, 'kaelen-floor-2');
    expect(floor2).toBeDefined();
    if (!floor2) return;

    expect(floor2.name).toContain('The Ossuary Halls');

    // Verify rooms
    const roomIds = floor2.rooms?.map((r) => r.id);
    expect(roomIds).toContain('f2_landing');
    expect(roomIds).toContain('f2_sentinels');
    expect(roomIds).toContain('f2_vault');
    expect(roomIds).toContain('f2_shrine');
    expect(roomIds).toContain('f2_feeding_pit');
    expect(roomIds).toContain('f2_secret_reliquary');
    expect(roomIds).toContain('f2_high_ossuary');

    // Verify Safe Room
    const shrineRoom = floor2.rooms?.find((r) => r.id === 'f2_shrine');
    expect(shrineRoom?.isSafeRoom).toBe(true);
    const shrineProp = floor2.props.find((p) => p.id === 'shrine_f2_bless');
    expect(shrineProp?.kind).toBe('shrine');

    // Verify Secret Door (DC 14 Perception)
    const secretDoor = floor2.props.find((p) => p.id === 'door_f2_secret');
    expect(secretDoor).toBeDefined();
    expect(secretDoor?.kind).toBe('secret_door');
    expect(secretDoor?.detectionDc).toBe(14);
    expect(secretDoor?.blocksMovement).toBe(true);

    // Verify Secret Reliquary chest with +1 Longsword and Scroll of Fireball
    const reliquaryChest = floor2.props.find((p) => p.id === 'chest_f2_reliquary');
    expect(reliquaryChest).toBeDefined();
    expect(reliquaryChest?.lootTable?.items).toContain('longsword-plus-1');
    expect(reliquaryChest?.lootTable?.items).toContain('scroll-of-fireball');

    // Verify Monsters: skeletons, zombies, ghouls, wight
    const monsterIds = floor2.encounters.flatMap((e) => e.monsters.map((m) => m.monsterId));
    expect(monsterIds).toContain('skeleton');
    expect(monsterIds).toContain('zombie');
    expect(monsterIds).toContain('ghoul');
    expect(monsterIds).toContain('wight');

    // Stairs up to Floor 1 and stairs down to Floor 3
    const stairsUp = floor2.props.find((p) => p.kind === 'stairs_up');
    expect(stairsUp?.targetFloorId).toBe('kaelen-floor-1');
    const stairsDown = floor2.props.find((p) => p.kind === 'stairs_down');
    expect(stairsDown?.targetFloorId).toBe('kaelen-floor-3');
  });

  it('Floor 3 (The Submerged Sanctum) contains shallow water, Gelatinous Cube corridor, Cultists, Young Black Dragon, and Dragon Hoard', () => {
    const floor3 = getCampaignFloor(SUNKEN_CRYPT_OF_KAELEN, 'kaelen-floor-3');
    expect(floor3).toBeDefined();
    if (!floor3) return;

    expect(floor3.name).toContain('The Submerged Sanctum');

    // Shallow water difficult terrain
    const waterCells = floor3.cells.filter((c) => c.terrain === 'water_shallow');
    expect(waterCells.length).toBeGreaterThanOrEqual(15);

    // Gelatinous Cube in narrow gallery
    const galleryEnc = floor3.encounters.find((e) => e.roomId === 'f3_gallery');
    expect(galleryEnc?.monsters.some((m) => m.monsterId === 'gelatinous-cube')).toBe(true);

    // Cultists & Cult Fanatics in ritual room
    const ritualEnc = floor3.encounters.find((e) => e.roomId === 'f3_ritual');
    const ritualMonsters = ritualEnc?.monsters.map((m) => m.monsterId);
    expect(ritualMonsters).toContain('cult-fanatic');
    expect(ritualMonsters).toContain('cultist');

    // Boss encounter: Young Black Dragon
    const sanctumEnc = floor3.encounters.find((e) => e.roomId === 'f3_sanctum');
    expect(sanctumEnc?.monsters.some((m) => m.monsterId === 'young-black-dragon')).toBe(true);

    // Dragon Hoard chest
    const dragonHoard = floor3.props.find((p) => p.id === 'chest_f3_dragon_hoard');
    expect(dragonHoard).toBeDefined();
    expect(dragonHoard?.lootTable?.items).toContain('ring-of-protection');
    expect(dragonHoard?.lootTable?.items).toContain('cloak-of-protection');
    expect(dragonHoard?.lootTable?.items).toContain('potion-of-greater-healing');
    expect(dragonHoard?.lootTable?.gp).toBe(600);
    expect(dragonHoard?.lootTable?.pp).toBe(25);

    // Stairs up to Floor 2
    const stairsUp = floor3.props.find((p) => p.kind === 'stairs_up');
    expect(stairsUp?.targetFloorId).toBe('kaelen-floor-2');
  });

  it('getSunkenCryptModule returns independent deep copy', () => {
    const clone1 = getSunkenCryptModule();
    const clone2 = getSunkenCryptModule();
    expect(clone1).not.toBe(clone2);
    expect(clone1.floors[0]).not.toBe(clone2.floors[0]);
    expect(clone1).toEqual(clone2);

    // Mutating clone does not affect canonical constant
    clone1.name = 'Mutated Campaign';
    expect(SUNKEN_CRYPT_OF_KAELEN.name).toBe('The Sunken Crypt of Kaelen');
  });

  it('validateCampaignModule catches invalid module configurations', () => {
    const invalidModule = getSunkenCryptModule();
    invalidModule.startingFloorId = 'non-existent-floor';
    const res = validateCampaignModule(invalidModule, defaultCompendium);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('does not match any floor ID'))).toBe(true);
  });
});
