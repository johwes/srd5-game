import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CampaignModuleSpec,
  type DungeonCellSpec,
  type DungeonFloorSpec,
  type TileTerrainType,
  CampaignModuleSpecSchema,
} from '../src/schemas/dungeon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildEmptyGrid(
  width: number,
  height: number,
  defaultTerrain: TileTerrainType = 'wall_solid',
): DungeonCellSpec[] {
  const cells: DungeonCellSpec[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({
        x,
        y,
        terrain: defaultTerrain,
        baseLight: 'dim',
        elevationFeet: 0,
      });
    }
  }
  return cells;
}

function setRoomRegion(
  cells: DungeonCellSpec[],
  width: number,
  roomId: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  terrain: TileTerrainType = 'floor_stone',
  baseLight: 'bright' | 'dim' | 'darkness' = 'dim',
) {
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * width + x;
      cells[idx] = {
        x,
        y,
        roomId,
        terrain,
        baseLight,
        elevationFeet: 0,
      };
    }
  }
}

function setCorridor(
  cells: DungeonCellSpec[],
  width: number,
  roomId: string,
  points: Array<{ x: number; y: number }>,
  terrain: TileTerrainType = 'floor_stone',
  baseLight: 'bright' | 'dim' | 'darkness' = 'dim',
) {
  for (const p of points) {
    const idx = p.y * width + p.x;
    cells[idx] = {
      x: p.x,
      y: p.y,
      roomId,
      terrain,
      baseLight,
      elevationFeet: 0,
    };
  }
}

// -------------------------------------------------------------
// Floor 1: The Ruined Watchtower (Levels 1 -> 2)
// -------------------------------------------------------------
function buildFloor1(): DungeonFloorSpec {
  const width = 18;
  const height = 16;
  const cells = buildEmptyGrid(width, height, 'wall_solid');

  // Room 1: Courtyard (x: 1..5, y: 1..5) - Open sky, bright light
  setRoomRegion(cells, width, 'f1_courtyard', 1, 1, 5, 5, 'floor_stone', 'bright');
  // Some rubble in corners
  cells[1 * width + 1].terrain = 'rubble';
  cells[1 * width + 5].terrain = 'rubble';

  // Doorway connection from Courtyard to Barracks: cell at (6, 3)
  setCorridor(cells, width, 'f1_courtyard', [{ x: 6, y: 3 }], 'floor_stone', 'bright');

  // Room 2: Ruined Barracks (x: 7..11, y: 1..6)
  setRoomRegion(cells, width, 'f1_barracks', 7, 1, 11, 6, 'floor_stone', 'dim');

  // Doorway connection from Barracks to Trapped Hallway: cell at (12, 4)
  setCorridor(cells, width, 'f1_barracks', [{ x: 12, y: 4 }], 'floor_stone', 'dim');

  // Doorway connection from Barracks to Armory: cell at (9, 7)
  setCorridor(cells, width, 'f1_barracks', [{ x: 9, y: 7 }], 'floor_stone', 'darkness');

  // Room 3: Collapsed Armory & Cellar (x: 6..10, y: 8..14)
  setRoomRegion(cells, width, 'f1_armory', 6, 8, 10, 14, 'floor_stone', 'darkness');

  // Room 4: Trapped Stone Corridor (x: 13..16, y: 2..6)
  setRoomRegion(cells, width, 'f1_trapped_hall', 13, 2, 16, 6, 'floor_stone', 'dim');

  // Corridor south from Trapped Hall to Warren (x: 14..15, y: 7)
  setCorridor(cells, width, 'f1_trapped_hall', [{ x: 14, y: 7 }, { x: 15, y: 7 }], 'floor_stone', 'dim');

  // Room 5: Kobold Warren (x: 12..16, y: 8..14)
  setRoomRegion(cells, width, 'f1_warren', 12, 8, 16, 14, 'floor_stone', 'dim');
  cells[8 * width + 16].terrain = 'rubble';
  cells[14 * width + 12].terrain = 'rubble';

  // Connecting corridor from Warren to Descent Chamber: (11, 12), (10, 12) through Armory and to (5, 12)
  setCorridor(cells, width, 'f1_warren', [{ x: 11, y: 12 }], 'floor_stone', 'dim');
  setCorridor(cells, width, 'f1_descent', [{ x: 5, y: 12 }], 'floor_stone', 'darkness');

  // Room 6: Crypt Descent Chamber (x: 1..4, y: 10..14)
  setRoomRegion(cells, width, 'f1_descent', 1, 10, 4, 14, 'floor_stone', 'darkness');

  return {
    id: 'kaelen-floor-1',
    name: 'Floor 1: The Ruined Watchtower',
    width,
    height,
    partySpawnCells: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
    cells,
    rooms: [
      {
        id: 'f1_courtyard',
        name: 'Ruined Watchtower Courtyard',
        description: 'Sunlight filters through collapsed rafters onto cracked flagstones overgrown with weeds.',
        isSafeRoom: false,
        lighting: 'bright',
        bounds: { x: 1, y: 1, width: 6, height: 5 },
      },
      {
        id: 'f1_barracks',
        name: 'Garrison Barracks',
        description: 'Rotting wooden cots and overturned weapon racks provide shelter to ruthless bandits.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 7, y: 1, width: 6, height: 7 },
      },
      {
        id: 'f1_armory',
        name: 'Collapsed Armory Cellar',
        description: 'A damp cellar reeking of vermin. Heavy iron chests sit beneath fallen stone arches.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 6, y: 8, width: 5, height: 7 },
      },
      {
        id: 'f1_trapped_hall',
        name: 'The Perilous Corridor',
        description: 'Narrow stone passage with suspicious perforations in the masonry at ankle height.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 13, y: 2, width: 4, height: 6 },
      },
      {
        id: 'f1_warren',
        name: 'The Kobold Warren',
        description: 'Crude scavenging nests, scorched earth, and makeshift barricades set by vigilant kobolds.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 11, y: 8, width: 6, height: 7 },
      },
      {
        id: 'f1_descent',
        name: 'The Crypt Descent Chamber',
        description: 'An ancient vaulted stone chamber leading downward into the subterranean ossuary of Kaelen.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 1, y: 10, width: 5, height: 5 },
      },
    ],
    props: [
      {
        id: 'door_f1_courtyard_barracks',
        x: 6,
        y: 3,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'door_f1_barracks_armory',
        x: 9,
        y: 7,
        kind: 'door',
        state: 'locked',
        lockDc: 12,
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'door_f1_barracks_hall',
        x: 12,
        y: 4,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'chest_f1_armory',
        x: 8,
        y: 13,
        kind: 'chest',
        state: 'locked',
        lockDc: 12,
        blocksMovement: true,
        blocksSight: false,
        lootTable: {
          gp: 35,
          sp: 80,
          items: ['potion-of-greater-healing'],
        },
      },
      {
        id: 'trap_f1_dart',
        x: 14,
        y: 4,
        kind: 'trap',
        state: 'closed',
        blocksMovement: false,
        blocksSight: false,
        detectionDc: 13,
        disarmDc: 13,
        trapDamageFormula: '1d10',
        trapDamageType: 'poison',
        trapSaveDc: 13,
        trapSaveAbility: 'con',
        trapHalfDamageOnSave: false,
      },
      {
        id: 'door_f1_warren_descent',
        x: 11,
        y: 12,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'stairs_f1_down',
        x: 1,
        y: 12,
        kind: 'stairs_down',
        state: 'open',
        blocksMovement: false,
        blocksSight: false,
        targetFloorId: 'kaelen-floor-2',
        targetSpawnPoint: { x: 2, y: 2 },
      },
    ],
    encounters: [
      {
        id: 'enc_f1_bandits',
        roomId: 'f1_barracks',
        triggered: false,
        monsters: [
          { monsterId: 'bandit', spawnX: 8, spawnY: 3 },
          { monsterId: 'bandit', spawnX: 9, spawnY: 5 },
        ],
      },
      {
        id: 'enc_f1_rats',
        roomId: 'f1_armory',
        triggered: false,
        monsters: [
          { monsterId: 'giant-rat', spawnX: 6, spawnY: 10 },
          { monsterId: 'giant-rat', spawnX: 7, spawnY: 12 },
          { monsterId: 'giant-rat', spawnX: 9, spawnY: 10 },
        ],
      },
      {
        id: 'enc_f1_kobolds',
        roomId: 'f1_warren',
        triggered: false,
        monsters: [
          { monsterId: 'kobold', spawnX: 13, spawnY: 10 },
          { monsterId: 'kobold', spawnX: 15, spawnY: 11 },
          { monsterId: 'kobold', spawnX: 14, spawnY: 13 },
        ],
      },
      {
        id: 'enc_f1_goblin_boss',
        roomId: 'f1_descent',
        triggered: false,
        monsters: [
          { monsterId: 'goblin-boss', spawnX: 3, spawnY: 12 },
          { monsterId: 'goblin', spawnX: 2, spawnY: 11 },
          { monsterId: 'goblin', spawnX: 2, spawnY: 13 },
        ],
      },
    ],
  };
}

// -------------------------------------------------------------
// Floor 2: The Ossuary Halls (Levels 2 -> 3)
// -------------------------------------------------------------
function buildFloor2(): DungeonFloorSpec {
  const width = 18;
  const height = 16;
  const cells = buildEmptyGrid(width, height, 'wall_solid');

  // Room 1: Upper Landing (x: 1..5, y: 1..5)
  setRoomRegion(cells, width, 'f2_landing', 1, 1, 5, 5, 'floor_stone', 'dim');
  // Doorway east to Sentinels
  setCorridor(cells, width, 'f2_landing', [{ x: 6, y: 3 }], 'floor_stone', 'dim');

  // Room 2: Tomb of the Sentinels (x: 7..11, y: 1..5)
  setRoomRegion(cells, width, 'f2_sentinels', 7, 1, 11, 5, 'floor_stone', 'darkness');

  // Corridor south into Plague Vault: cell at (9, 6)
  setCorridor(cells, width, 'f2_sentinels', [{ x: 9, y: 6 }], 'floor_stone', 'darkness');

  // Room 3: The Plague Vault (x: 7..11, y: 7..10)
  setRoomRegion(cells, width, 'f2_vault', 7, 7, 11, 10, 'floor_stone', 'darkness');

  // Doorway west to Sanctified Shrine: cell at (6, 8)
  setCorridor(cells, width, 'f2_vault', [{ x: 6, y: 8 }], 'floor_stone', 'bright');

  // Doorway east to Feeding Pit: cell at (12, 8)
  setCorridor(cells, width, 'f2_vault', [{ x: 12, y: 8 }], 'floor_stone', 'darkness');

  // Room 4: Sanctified Shrine (Safe Room!) (x: 1..5, y: 7..11)
  setRoomRegion(cells, width, 'f2_shrine', 1, 7, 5, 11, 'floor_stone', 'bright');

  // Room 5: The Feeding Pit (x: 13..16, y: 7..11)
  setRoomRegion(cells, width, 'f2_feeding_pit', 13, 7, 16, 11, 'floor_stone', 'darkness');
  cells[7 * width + 16].terrain = 'rubble';

  // Secret Door cell north of Feeding Pit into Secret Reliquary: cell at (14, 6)
  setCorridor(cells, width, 'f2_feeding_pit', [{ x: 14, y: 6 }], 'floor_stone', 'dim');

  // Room 6: Secret Reliquary of Kaelen (x: 13..16, y: 1..5)
  setRoomRegion(cells, width, 'f2_secret_reliquary', 13, 1, 16, 5, 'floor_stone', 'dim');

  // Doorway south from Feeding Pit to High Ossuary: cell at (14, 12)
  setCorridor(cells, width, 'f2_feeding_pit', [{ x: 14, y: 12 }], 'floor_stone', 'darkness');

  // Room 7: High Ossuary & Crypt of the Wight (x: 4..15, y: 12..14)
  setRoomRegion(cells, width, 'f2_high_ossuary', 4, 12, 15, 14, 'floor_stone', 'darkness');

  return {
    id: 'kaelen-floor-2',
    name: 'Floor 2: The Ossuary Halls',
    width,
    height,
    partySpawnCells: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
    cells,
    rooms: [
      {
        id: 'f2_landing',
        name: 'Upper Landing & Crypt Antechamber',
        description: 'Chilly drafts rise from subterranean depths. Dusty stone steps lead up to the watchtower ruins.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 1, y: 1, width: 6, height: 5 },
      },
      {
        id: 'f2_sentinels',
        name: 'Tomb of the Sentinels',
        description: 'Rows of stone sarcophagi line the walls. Skeletal guardians clutch rusted shortswords.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 7, y: 1, width: 5, height: 6 },
      },
      {
        id: 'f2_vault',
        name: 'The Plague Vault',
        description: 'The stench of ancient rot hangs thick in the air. Shambling dead lurk in the shadows.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 6, y: 7, width: 7, height: 4 },
      },
      {
        id: 'f2_shrine',
        name: 'The Sanctified Shrine',
        description: 'A consecrated sanctuary bathed in divine radiance. Undead cannot cross the consecrated threshold.',
        isSafeRoom: true,
        lighting: 'bright',
        bounds: { x: 1, y: 7, width: 5, height: 5 },
      },
      {
        id: 'f2_feeding_pit',
        name: 'The Ghoul Feeding Pit',
        description: 'Gnawed bones litter the floor around a dark depression. Feral eyes watch from the gloom.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 13, y: 7, width: 4, height: 6 },
      },
      {
        id: 'f2_secret_reliquary',
        name: 'Secret Reliquary of Kaelen',
        description: 'A dustless hidden chamber containing the revered weapons and scrolls of the founding knights.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 13, y: 1, width: 4, height: 5 },
      },
      {
        id: 'f2_high_ossuary',
        name: 'High Ossuary of the Wight',
        description: 'Pillars carved from ossified bone support a soaring vaulted ceiling where an ancient dread lord holds court.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 4, y: 12, width: 12, height: 3 },
      },
    ],
    props: [
      {
        id: 'stairs_f2_up',
        x: 1,
        y: 2,
        kind: 'stairs_up',
        state: 'open',
        blocksMovement: false,
        blocksSight: false,
        targetFloorId: 'kaelen-floor-1',
        targetSpawnPoint: { x: 1, y: 12 },
      },
      {
        id: 'door_f2_landing_sentinels',
        x: 6,
        y: 3,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'door_f2_vault_shrine',
        x: 6,
        y: 8,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'shrine_f2_bless',
        x: 3,
        y: 9,
        kind: 'shrine',
        state: 'closed',
        blocksMovement: true,
        blocksSight: false,
      },
      {
        id: 'door_f2_vault_feeding',
        x: 12,
        y: 8,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'door_f2_secret',
        x: 14,
        y: 6,
        kind: 'secret_door',
        state: 'closed',
        detectionDc: 14,
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'chest_f2_reliquary',
        x: 14,
        y: 2,
        kind: 'chest',
        state: 'closed',
        blocksMovement: true,
        blocksSight: false,
        lootTable: {
          gp: 100,
          sp: 200,
          items: ['longsword-plus-1', 'scroll-of-fireball'],
        },
      },
      {
        id: 'door_f2_feeding_ossuary',
        x: 14,
        y: 12,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'stairs_f2_down',
        x: 4,
        y: 13,
        kind: 'stairs_down',
        state: 'open',
        blocksMovement: false,
        blocksSight: false,
        targetFloorId: 'kaelen-floor-3',
        targetSpawnPoint: { x: 2, y: 2 },
      },
    ],
    encounters: [
      {
        id: 'enc_f2_skeletons',
        roomId: 'f2_sentinels',
        triggered: false,
        monsters: [
          { monsterId: 'skeleton', spawnX: 8, spawnY: 2 },
          { monsterId: 'skeleton', spawnX: 9, spawnY: 4 },
          { monsterId: 'skeleton', spawnX: 10, spawnY: 3 },
        ],
      },
      {
        id: 'enc_f2_zombies',
        roomId: 'f2_vault',
        triggered: false,
        monsters: [
          { monsterId: 'zombie', spawnX: 8, spawnY: 8 },
          { monsterId: 'zombie', spawnX: 9, spawnY: 9 },
          { monsterId: 'zombie', spawnX: 10, spawnY: 8 },
        ],
      },
      {
        id: 'enc_f2_ghouls',
        roomId: 'f2_feeding_pit',
        triggered: false,
        monsters: [
          { monsterId: 'ghoul', spawnX: 14, spawnY: 9 },
          { monsterId: 'ghoul', spawnX: 15, spawnY: 8 },
        ],
      },
      {
        id: 'enc_f2_wight',
        roomId: 'f2_high_ossuary',
        triggered: false,
        monsters: [
          { monsterId: 'wight', spawnX: 9, spawnY: 13 },
          { monsterId: 'skeleton', spawnX: 7, spawnY: 13 },
          { monsterId: 'skeleton', spawnX: 12, spawnY: 13 },
        ],
      },
    ],
  };
}

// -------------------------------------------------------------
// Floor 3: The Submerged Sanctum (Levels 3 -> 4)
// -------------------------------------------------------------
function buildFloor3(): DungeonFloorSpec {
  const width = 18;
  const height = 16;
  const cells = buildEmptyGrid(width, height, 'wall_solid');

  // Room 1: Flooded Entry Landing (x: 1..5, y: 1..5)
  setRoomRegion(cells, width, 'f3_entry', 1, 1, 5, 5, 'floor_stone', 'dim');

  // Opening east into Flooded Gallery: cell at (6, 3)
  setCorridor(cells, width, 'f3_entry', [{ x: 6, y: 3 }], 'floor_stone', 'dim');

  // Room 2: Flooded Gallery (Narrow corridor with Gelatinous Cube) (x: 7..11, y: 2..5)
  setRoomRegion(cells, width, 'f3_gallery', 7, 2, 11, 5, 'floor_stone', 'darkness');
  // Shallow water in the center corridor (difficult terrain)
  for (let x = 7; x <= 11; x++) {
    cells[3 * width + x].terrain = 'water_shallow';
    cells[4 * width + x].terrain = 'water_shallow';
  }

  // Doorway east to Ritual Chamber: cell at (12, 3)
  setCorridor(cells, width, 'f3_gallery', [{ x: 12, y: 3 }], 'floor_stone', 'dim');

  // Room 3: Abyssal Ritual Chamber (x: 13..16, y: 1..8)
  setRoomRegion(cells, width, 'f3_ritual', 13, 1, 16, 8, 'floor_stone', 'dim');
  // Water pools in ritual chamber
  cells[2 * width + 14].terrain = 'water_shallow';
  cells[2 * width + 15].terrain = 'water_shallow';
  cells[6 * width + 14].terrain = 'water_shallow';
  cells[6 * width + 15].terrain = 'water_shallow';

  // Heavy locked double door at (14, 9) leading south into Dragon's Lair
  setCorridor(cells, width, 'f3_ritual', [{ x: 14, y: 9 }], 'floor_stone', 'darkness');

  // Room 4: The Dragon's Sunken Lair (x: 1..16, y: 10..14)
  setRoomRegion(cells, width, 'f3_sanctum', 1, 10, 16, 14, 'floor_stone', 'darkness');
  // Submerged shallow pools throughout the central lair
  for (let y = 11; y <= 13; y++) {
    for (let x = 5; x <= 12; x++) {
      cells[y * width + x].terrain = 'water_shallow';
    }
  }

  return {
    id: 'kaelen-floor-3',
    name: 'Floor 3: The Submerged Sanctum',
    width,
    height,
    partySpawnCells: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
    cells,
    rooms: [
      {
        id: 'f3_entry',
        name: 'Submerged Landing',
        description: 'Black water laps gently against ancient mossy stairs leading up into the ossuary.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 1, y: 1, width: 6, height: 5 },
      },
      {
        id: 'f3_gallery',
        name: 'The Flooded Gallery',
        description: 'A waist-deep flooded corridor where a translucent predator dissolves debris in the sluggish current.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 7, y: 2, width: 6, height: 4 },
      },
      {
        id: 'f3_ritual',
        name: 'The Abyssal Ritual Chamber',
        description: 'Green braziers flicker over stone altars as fanatic cultists chant unholy invocations.',
        isSafeRoom: false,
        lighting: 'dim',
        bounds: { x: 13, y: 1, width: 4, height: 9 },
      },
      {
        id: 'f3_sanctum',
        name: "The Dragon's Sunken Lair",
        description: 'A cavernous flooded temple sunken beneath the earth, lair of the dreaded Young Black Dragon.',
        isSafeRoom: false,
        lighting: 'darkness',
        bounds: { x: 1, y: 10, width: 16, height: 5 },
      },
    ],
    props: [
      {
        id: 'stairs_f3_up',
        x: 1,
        y: 2,
        kind: 'stairs_up',
        state: 'open',
        blocksMovement: false,
        blocksSight: false,
        targetFloorId: 'kaelen-floor-2',
        targetSpawnPoint: { x: 4, y: 13 },
      },
      {
        id: 'door_f3_gallery_ritual',
        x: 12,
        y: 3,
        kind: 'door',
        state: 'closed',
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'door_f3_boss_chamber',
        x: 14,
        y: 9,
        kind: 'door',
        state: 'locked',
        lockDc: 14,
        blocksMovement: true,
        blocksSight: true,
      },
      {
        id: 'chest_f3_dragon_hoard',
        x: 3,
        y: 12,
        kind: 'chest',
        state: 'closed',
        blocksMovement: true,
        blocksSight: false,
        lootTable: {
          pp: 25,
          gp: 600,
          sp: 500,
          items: [
            'ring-of-protection',
            'cloak-of-protection',
            'potion-of-greater-healing',
          ],
        },
      },
    ],
    encounters: [
      {
        id: 'enc_f3_cube',
        roomId: 'f3_gallery',
        triggered: false,
        monsters: [
          { monsterId: 'gelatinous-cube', spawnX: 8, spawnY: 3 },
        ],
      },
      {
        id: 'enc_f3_cultists',
        roomId: 'f3_ritual',
        triggered: false,
        monsters: [
          { monsterId: 'cult-fanatic', spawnX: 15, spawnY: 4 },
          { monsterId: 'cultist', spawnX: 14, spawnY: 3 },
          { monsterId: 'cultist', spawnX: 14, spawnY: 5 },
          { monsterId: 'cultist', spawnX: 15, spawnY: 6 },
        ],
      },
      {
        id: 'enc_f3_boss',
        roomId: 'f3_sanctum',
        triggered: false,
        monsters: [
          { monsterId: 'young-black-dragon', spawnX: 9, spawnY: 12 },
        ],
      },
    ],
  };
}

export function generateCampaignModule(): CampaignModuleSpec {
  const module: CampaignModuleSpec = {
    id: 'sunken-crypt-of-kaelen',
    name: 'The Sunken Crypt of Kaelen',
    description:
      'A curated 3-floor SRD 5.1 dungeon campaign module taking an adventurer party from Level 1 to Level 4. Explore the ruined watchtower, navigate the bone-lined ossuary, and descend into the flooded abyssal sanctum.',
    author: 'SRD 5.1 Tactical Game Team',
    version: '1.0.0',
    levelRange: { min: 1, max: 4 },
    startingFloorId: 'kaelen-floor-1',
    floors: [buildFloor1(), buildFloor2(), buildFloor3()],
  };

  // Validate with Zod
  return CampaignModuleSpecSchema.parse(module);
}

// Generate and write file
const campaign = generateCampaignModule();
const outputPath = path.resolve(__dirname, '../src/srd/campaign-kaelen.json');
fs.writeFileSync(outputPath, JSON.stringify(campaign, null, 2), 'utf-8');
console.log(`Successfully generated campaign to ${outputPath}`);
