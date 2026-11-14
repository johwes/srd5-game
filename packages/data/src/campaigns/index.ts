import { defaultCompendium, type SrdCompendium } from '../compendium/compendium.js';
import {
  type CampaignModuleSpec,
  type DungeonFloorSpec,
  CampaignModuleSpecSchema,
} from '../schemas/dungeon.js';
import campaignKaelenJson from '../srd/campaign-kaelen.json' with { type: 'json' };

/**
 * Validated canonical instance of the 3-floor starter campaign: "The Sunken Crypt of Kaelen".
 */
export const SUNKEN_CRYPT_OF_KAELEN: CampaignModuleSpec =
  CampaignModuleSpecSchema.parse(campaignKaelenJson);

/**
 * Returns a fresh, deep-cloned copy of "The Sunken Crypt of Kaelen" campaign module specification.
 */
export function getSunkenCryptModule(): CampaignModuleSpec {
  return structuredClone(SUNKEN_CRYPT_OF_KAELEN);
}

/**
 * Retrieves a specific floor specification from a campaign module by floor ID.
 */
export function getCampaignFloor(
  module: CampaignModuleSpec,
  floorId: string,
): DungeonFloorSpec | undefined {
  return module.floors.find((f) => f.id === floorId);
}

export interface CampaignValidationResult {
  valid: boolean;
  errors: string[];
  floorCount: number;
  totalEncounters: number;
  totalMonsters: number;
  totalProps: number;
}

/**
 * Validates a campaign module for structural and referential integrity against the SRD compendium.
 */
export function validateCampaignModule(
  campaign: CampaignModuleSpec,
  compendium: SrdCompendium = defaultCompendium,
): CampaignValidationResult {
  const errors: string[] = [];

  // 1. Zod schema check
  const parseResult = CampaignModuleSpecSchema.safeParse(campaign);
  if (!parseResult.success) {
    errors.push(...parseResult.error.errors.map((e) => `Schema error at ${e.path.join('.')}: ${e.message}`));
    return {
      valid: false,
      errors,
      floorCount: 0,
      totalEncounters: 0,
      totalMonsters: 0,
      totalProps: 0,
    };
  }

  // 2. Starting floor check
  const floorIds = new Set<string>();
  for (const floor of campaign.floors) {
    if (floorIds.has(floor.id)) {
      errors.push(`Duplicate floor ID found: '${floor.id}'`);
    }
    floorIds.add(floor.id);
  }

  if (!floorIds.has(campaign.startingFloorId)) {
    errors.push(
      `Campaign startingFloorId '${campaign.startingFloorId}' does not match any floor ID in campaign.floors.`,
    );
  }

  let totalEncounters = 0;
  let totalMonsters = 0;
  let totalProps = 0;

  // 3. Inspect each floor
  for (const floor of campaign.floors) {
    const roomIds = new Set(floor.rooms?.map((r) => r.id) ?? []);

    // Verify dimensions & cells
    const cellMap = new Map<string, (typeof floor.cells)[number]>();
    for (const cell of floor.cells) {
      if (cell.x < 0 || cell.x >= floor.width || cell.y < 0 || cell.y >= floor.height) {
        errors.push(
          `Floor '${floor.id}' cell (${cell.x}, ${cell.y}) is outside floor bounds (${floor.width}x${floor.height}).`,
        );
      }
      const key = `${cell.x},${cell.y}`;
      if (cellMap.has(key)) {
        errors.push(`Floor '${floor.id}' contains duplicate cell at (${cell.x}, ${cell.y}).`);
      }
      cellMap.set(key, cell);

      if (cell.roomId && !roomIds.has(cell.roomId)) {
        errors.push(
          `Floor '${floor.id}' cell (${cell.x}, ${cell.y}) references undefined roomId '${cell.roomId}'.`,
        );
      }
    }

    if (floor.cells.length !== floor.width * floor.height) {
      errors.push(
        `Floor '${floor.id}' expected ${floor.width * floor.height} cells, but has ${floor.cells.length}.`,
      );
    }

    // Party spawn cells
    for (const spawn of floor.partySpawnCells) {
      const cell = cellMap.get(`${spawn.x},${spawn.y}`);
      if (!cell) {
        errors.push(`Floor '${floor.id}' party spawn cell (${spawn.x}, ${spawn.y}) does not exist on grid.`);
      } else if (cell.terrain === 'wall_solid' || cell.terrain === 'void' || cell.terrain === 'chasm') {
        errors.push(
          `Floor '${floor.id}' party spawn cell (${spawn.x}, ${spawn.y}) is on impassable terrain '${cell.terrain}'.`,
        );
      }
    }

    // Props
    for (const prop of floor.props) {
      totalProps++;
      const cell = cellMap.get(`${prop.x},${prop.y}`);
      if (!cell) {
        errors.push(`Floor '${floor.id}' prop '${prop.id}' at (${prop.x}, ${prop.y}) is outside grid.`);
      }

      // If prop is stairs with targetFloorId, verify target floor exists
      if (prop.targetFloorId && !floorIds.has(prop.targetFloorId)) {
        errors.push(
          `Floor '${floor.id}' prop '${prop.id}' points to unknown targetFloorId '${prop.targetFloorId}'.`,
        );
      }

      // If prop has loot, verify item IDs against compendium
      if (prop.lootTable?.items) {
        for (const itemId of prop.lootTable.items) {
          const magicItem = compendium.getMagicItem(itemId);
          const eqItem = compendium.getEquipment(itemId);
          if (!magicItem && !eqItem) {
            errors.push(
              `Floor '${floor.id}' prop '${prop.id}' lootTable references unknown item '${itemId}'.`,
            );
          }
        }
      }
    }

    // Encounters
    for (const enc of floor.encounters) {
      totalEncounters++;
      if (!roomIds.has(enc.roomId)) {
        errors.push(
          `Floor '${floor.id}' encounter '${enc.id}' references undefined roomId '${enc.roomId}'.`,
        );
      }

      for (const m of enc.monsters) {
        totalMonsters++;
        const cell = cellMap.get(`${m.spawnX},${m.spawnY}`);
        if (!cell) {
          errors.push(
            `Floor '${floor.id}' encounter '${enc.id}' monster '${m.monsterId}' at (${m.spawnX}, ${m.spawnY}) is outside grid.`,
          );
        }

        const monsterData = compendium.getMonster(m.monsterId);
        if (!monsterData) {
          errors.push(
            `Floor '${floor.id}' encounter '${enc.id}' references unknown monsterId '${m.monsterId}'.`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    floorCount: campaign.floors.length,
    totalEncounters,
    totalMonsters,
    totalProps,
  };
}
