import {
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { type Combatant } from '../combat/types.js';
import { rollDie } from '../dice/prng.js';
import { type TacticalGrid, type GridPoint } from '../grid/model.js';
import {
  type GameCommand,
  type GameEvent,
  type GameState,
} from '../state/types.js';
import { triggerDungeonEncounter } from './encounters.js';
import { type EncounterSpawnGroup } from './schemas.js';
import { attuneMagicItem, unattuneMagicItem } from '../character/attunement.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { getMedicineHitDieBonusPerDieFor } from '../skills/skill-passives.js';

export interface ResolveRestOptions {
  compendium?: SrdCompendium;
  forceSafe?: boolean;
}

export interface ResolveRestResult {
  nextState: GameState;
  events: GameEvent[];
}

/**
 * Determines the Bard Song of Rest bonus die size for the party (SRD 5.1).
 * Bard Level 2–8: d6, Level 9–12: d8, Level 13–16: d10, Level 17–20: d12.
 * Returns null if no conscious living Bard with Song of Rest is in the party.
 */
export function getPartySongOfRestDie(party: Record<string, Combatant>): number | null {
  let highestBardLevel = 0;
  for (const c of Object.values(party)) {
    if (c.isDead || c.currentHp <= 0) continue;

    let bardLvl = 0;
    if (c.characterSheet?.classes) {
      const bardClass = c.characterSheet.classes.find((cl) => cl.classId === 'bard');
      if (bardClass) {
        bardLvl = bardClass.level;
      }
    }
    const hasSongFeature =
      c.characterSheet?.featureIds?.some((f) => f === 'song-of-rest' || f === 'song_of_rest') ||
      c.characterSheet?.traitIds?.some((t) => t === 'song-of-rest' || t === 'song_of_rest');

    if (hasSongFeature && bardLvl === 0) {
      bardLvl = c.characterSheet?.totalLevel ?? 2;
    }

    if (bardLvl >= 2 && bardLvl > highestBardLevel) {
      highestBardLevel = bardLvl;
    }
  }

  if (highestBardLevel < 2) return null;
  if (highestBardLevel >= 17) return 12;
  if (highestBardLevel >= 13) return 10;
  if (highestBardLevel >= 9) return 8;
  return 6;
}

/**
 * Spends hit dice for a single hero during a Short Rest (SRD 5.1).
 * For each die spent: roll 1d(dieSize) + CON mod (min 0 HP restored), capped at maxHp.
 */
export function spendHitDiceForHero(
  hero: Combatant,
  spendRequest: number | Record<number, number>,
  rngState: number,
): { hpRegained: number; diceSpent: number; nextRng: number } {
  let currentRng = rngState;
  let totalHpRegained = 0;
  let totalDiceSpent = 0;

  // Ensure hero has hit dice pools
  const pools = hero.characterSheet?.hitDicePools;
  if (!pools || pools.length === 0) {
    return { hpRegained: 0, diceSpent: 0, nextRng: currentRng };
  }

  const conMod =
    hero.characterSheet?.abilities?.con?.modifier ??
    (hero as unknown as { constitutionModifier?: number }).constitutionModifier ??
    0;

  // SRD-1213: Medicine standing passive (Spec 11 §3.4) — administered
  // Hit-Die healing +1 per die (proficient and expert alike).
  const medicineBonusPerDie = getMedicineHitDieBonusPerDieFor(hero);

  if (typeof spendRequest === 'number') {
    let countToSpend = Math.max(0, Math.floor(spendRequest));
    while (countToSpend > 0) {
      // Find a pool with available dice (prefer highest die size)
      const availablePool = [...pools]
        .sort((a, b) => b.dieSize - a.dieSize)
        .find((p) => p.available > 0);
      if (!availablePool) break;

      const { roll, nextState } = rollDie(currentRng, availablePool.dieSize);
      currentRng = nextState;

      const hpFromDie = Math.max(0, roll + conMod + medicineBonusPerDie);
      const heal = Math.min(hpFromDie, hero.maxHp - hero.currentHp);
      hero.currentHp += heal;
      totalHpRegained += heal;
      if (hero.characterSheet) {
        hero.characterSheet.currentHp = hero.currentHp;
      }

      availablePool.spent += 1;
      availablePool.available = availablePool.total - availablePool.spent;

      totalDiceSpent += 1;
      countToSpend -= 1;
    }
  } else if (typeof spendRequest === 'object' && spendRequest !== null) {
    for (const [dieSizeStr, reqCount] of Object.entries(spendRequest)) {
      const dieSize = parseInt(dieSizeStr, 10) as 6 | 8 | 10 | 12;
      const pool = pools.find((p) => p.dieSize === dieSize);
      if (!pool) continue;

      let count = Math.min(Math.max(0, Math.floor(reqCount)), pool.available);
      while (count > 0) {
        const { roll, nextState } = rollDie(currentRng, pool.dieSize);
        currentRng = nextState;

        const hpFromDie = Math.max(0, roll + conMod + medicineBonusPerDie);
        const heal = Math.min(hpFromDie, hero.maxHp - hero.currentHp);
        hero.currentHp += heal;
        totalHpRegained += heal;
        if (hero.characterSheet) {
          hero.characterSheet.currentHp = hero.currentHp;
        }

        pool.spent += 1;
        pool.available = pool.total - pool.spent;

        totalDiceSpent += 1;
        count -= 1;
      }
    }
  }

  // If hero was at 0 HP and is now above 0, clear unconscious & stabilization
  if (hero.currentHp > 0) {
    hero.isDead = false;
    hero.isStable = false;
    hero.conditions = hero.conditions.filter((c) => c !== 'unconscious');
    if (hero.characterSheet) {
      hero.characterSheet.deathSaves = { successes: 0, failures: 0 };
      hero.characterSheet.activeConditions = hero.characterSheet.activeConditions.filter(
        (c) => c.conditionId !== 'unconscious',
      );
    }
    hero.deathSaves = { successes: 0, failures: 0 };
  }

  return { hpRegained: totalHpRegained, diceSpent: totalDiceSpent, nextRng: currentRng };
}

/**
 * Resolves Arcane Recovery for a Wizard during a Short Rest (SRD 5.1).
 * Recovers spell slots with combined level <= ceil(WizardLevel / 2), none >= 6.
 * Once per day (tracked via resource 'arcane_recovery').
 */
export function applyArcaneRecoveryForHero(
  hero: Combatant,
  requestedSlotLevels: number[],
): number[] {
  const wizardClass = hero.characterSheet?.classes?.find((c) => c.classId === 'wizard');
  const hasFeature =
    hero.characterSheet?.featureIds?.includes('arcane-recovery') ||
    hero.characterSheet?.featureIds?.includes('arcane_recovery');

  if (!wizardClass && !hasFeature) return [];

  const wizardLevel = wizardClass?.level ?? hero.characterSheet?.totalLevel ?? 1;
  const maxSlotLevels = Math.ceil(wizardLevel / 2);

  // Check if already used today
  const resourcePool = hero.characterSheet?.resources?.arcane_recovery;
  if (resourcePool && resourcePool.available <= 0) {
    return [];
  }

  const recovered: number[] = [];
  let sumLevels = 0;

  for (const slotLvl of requestedSlotLevels) {
    if (slotLvl < 1 || slotLvl > 5) continue; // None of slot level >= 6
    if (sumLevels + slotLvl > maxSlotLevels) continue;

    // Check if slot pool has expended slots to recover
    const pool = hero.spellSlots?.[slotLvl];
    const sheetPool =
      hero.characterSheet?.spellcasting?.spellSlots?.[
        slotLvl as 1 | 2 | 3 | 4 | 5
      ];

    const canRecover = (pool && pool.expended > 0) || (sheetPool && sheetPool.expended > 0);
    if (canRecover) {
      if (pool && pool.expended > 0) {
        pool.expended -= 1;
        pool.available = Math.min(pool.max, pool.available + 1);
      }
      if (sheetPool && sheetPool.expended > 0) {
        sheetPool.expended -= 1;
        sheetPool.available = Math.min(sheetPool.max, sheetPool.available + 1);
      }
      recovered.push(slotLvl);
      sumLevels += slotLvl;
    }
  }

  if (recovered.length > 0 && resourcePool) {
    resourcePool.spent = 1;
    resourcePool.available = 0;
  }

  return recovered;
}

/**
 * Checks whether an Ambush occurs when attempting a Long Rest in an unsecured room (Spec 04 Section 4.2).
 * In an unsecured room, a 1d20 roll of 1–4 triggers a monster ambush.
 */
export function checkRestAmbush(
  state: GameState,
  options?: { forceSafe?: boolean; rngState?: number },
): { isAmbush: boolean; roll?: number; nextRng: number } {
  let rng = options?.rngState ?? state.rngState;

  if (options?.forceSafe) {
    return { isAmbush: false, nextRng: rng };
  }

  // Determine current room from lead explorer or first party member
  const leadId = state.marchingOrder?.leadExplorerId ?? Object.keys(state.party)[0];
  const lead = leadId ? state.party[leadId] : Object.values(state.party)[0];

  let isSafe = false;
  if (!state.dungeon) {
    // If not in a dungeon, assume safe unless forceSafe was explicitly false
    isSafe = options?.forceSafe !== false;
  } else if (lead) {
    const cellIdx = lead.position.y * state.grid.width + lead.position.x;
    const gridCell = state.grid.cells[cellIdx];
    const roomId = gridCell?.roomId;
    if (roomId && state.dungeon.rooms[roomId]?.isSafeRoom) {
      isSafe = true;
    }
  }

  if (isSafe) {
    return { isAmbush: false, nextRng: rng };
  }

  // Unsecured room: roll 1d20 ambush check
  const { roll, nextState } = rollDie(rng, 20);
  rng = nextState;

  if (roll <= 4) {
    return { isAmbush: true, roll, nextRng: rng };
  }

  return { isAmbush: false, roll, nextRng: rng };
}

function findWalkableCellsNear(grid: TacticalGrid, center: GridPoint, count: number): GridPoint[] {
  const result: GridPoint[] = [];
  const offsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
  ];

  for (const off of offsets) {
    const x = center.x + off.x;
    const y = center.y + off.y;
    if (x >= 0 && x < grid.width && y >= 0 && y < grid.height) {
      const cell = grid.cells[y * grid.width + x];
      if (cell && cell.terrain !== 'wall_solid' && cell.terrain !== 'void' && cell.terrain !== 'chasm') {
        result.push({ x, y });
        if (result.length >= count) break;
      }
    }
  }
  return result;
}

/**
 * Executes a Short Rest (1 In-Game Hour) across party members (Spec 04 Section 4.1).
 * 1. Spends Hit Dice (1d(die) + CON mod per die) to heal.
 * 2. Applies Song of Rest if a Bard (L2+) is in the party.
 * 3. Recharges all features and spell slots with recovery === 'short_rest' (Pact Magic, Second Wind, Ki, etc.).
 * 4. Resolves Arcane Recovery if requested for a Wizard.
 */
export function resolveShortRest(
  state: GameState,
  command: Extract<GameCommand, { type: 'START_REST' }>,
  _options?: ResolveRestOptions,
): ResolveRestResult {
  if (state.mode !== 'exploration') {
    return {
      nextState: state,
      events: [
        {
          type: 'REST_INTERRUPTED',
          restType: 'short',
          reason: 'combat',
        },
      ],
    };
  }

  let nextState: GameState = structuredClone(state);
  let currentRng = nextState.rngState;
  const events: GameEvent[] = [];

  const hpRecovered: Record<string, number> = {};
  const hitDiceSpent: Record<string, number> = {};
  const songOfRestHp: Record<string, number> = {};
  const slotsRecovered: Record<string, number[]> = {};

  const songDie = getPartySongOfRestDie(nextState.party);

  for (const [heroId, hero] of Object.entries(nextState.party)) {
    if (hero.isDead) continue;

    // 1. Spend Hit Dice if requested
    const spendReq = command.hitDiceToSpend?.[heroId];
    let diceSpentCount = 0;
    let heroHpRegained = 0;

    if (spendReq !== undefined) {
      const spendRes = spendHitDiceForHero(hero, spendReq, currentRng);
      currentRng = spendRes.nextRng;
      heroHpRegained += spendRes.hpRegained;
      diceSpentCount = spendRes.diceSpent;
      if (diceSpentCount > 0) {
        hitDiceSpent[heroId] = diceSpentCount;
      }
    }

    // 2. Song of Rest: any ally who regains HP via Hit Dice gains extra die roll
    if (heroHpRegained > 0 && songDie !== null) {
      const { roll: songRoll, nextState: songRng } = rollDie(currentRng, songDie);
      currentRng = songRng;
      const songHeal = Math.min(songRoll, hero.maxHp - hero.currentHp);
      hero.currentHp += songHeal;
      if (hero.characterSheet) {
        hero.characterSheet.currentHp = hero.currentHp;
      }
      heroHpRegained += songHeal;
      songOfRestHp[heroId] = songHeal;
    }

    hpRecovered[heroId] = heroHpRegained;

    // 3. Short Rest Feature Recharge
    // Pact Magic slots
    if (hero.pactMagic) {
      hero.pactMagic.expendedSlots = 0;
      hero.pactMagic.availableSlots = hero.pactMagic.maxSlots;
    }
    if (hero.characterSheet?.spellcasting?.pactMagic) {
      hero.characterSheet.spellcasting.pactMagic.expendedSlots = 0;
      hero.characterSheet.spellcasting.pactMagic.availableSlots =
        hero.characterSheet.spellcasting.pactMagic.maxSlots;
    }

    // Short rest resource pools
    if (hero.characterSheet?.resources) {
      for (const pool of Object.values(hero.characterSheet.resources)) {
        if (pool.recovery === 'short_rest') {
          pool.spent = 0;
          pool.available = pool.max;
        }
      }
    }

    // 4. Arcane Recovery
    const arcaneReq = command.arcaneRecovery?.[heroId];
    if (arcaneReq && arcaneReq.length > 0) {
      const rec = applyArcaneRecoveryForHero(hero, arcaneReq);
      if (rec.length > 0) {
        slotsRecovered[heroId] = rec;
      }
    }

    // 5. Attunement updates during Short Rest (SRD 5.1 & SRD-505)
    if (command.attunements?.[heroId] && hero.buildState) {
      let b = hero.buildState;
      const comp = _options?.compendium ?? defaultCompendium;
      for (const un of command.attunements[heroId]!.unattune ?? []) {
        b = unattuneMagicItem(b, un);
      }
      for (const at of command.attunements[heroId]!.attune ?? []) {
        b = attuneMagicItem(b, at, comp);
      }
      hero.buildState = b;
      hero.characterSheet = computeDerivedCharacter(b, comp);
      hero.armorClass = hero.characterSheet.armorClass.totalAc;
      events.push({
        type: 'ATTUNEMENT_CHANGED',
        characterId: heroId,
        attunedItemInstanceIds: b.attunedItemInstanceIds,
      });
    }
  }

  nextState.rngState = currentRng;

  events.push({
    type: 'REST_COMPLETED',
    restType: 'short',
    hpRecovered,
    hitDiceSpent: Object.keys(hitDiceSpent).length > 0 ? hitDiceSpent : undefined,
    songOfRestHp: Object.keys(songOfRestHp).length > 0 ? songOfRestHp : undefined,
    slotsRecovered: Object.keys(slotsRecovered).length > 0 ? slotsRecovered : undefined,
  });

  return { nextState, events };
}

/**
 * Applies the per-combatant Long Rest restoration (Spec 04 Section 4.2 steps
 * 2.1–2.5): full HP/status reset, spell & Pact Magic slot restoration, all
 * resource pools reset, partial Hit Dice recovery, and one exhaustion level
 * removed. Mutates only the supplied combatant — callers must clone state
 * first. Shared by dungeon rests (SRD-504) and overworld camping (SRD-802).
 */
export function restoreCombatantAfterLongRest(hero: Combatant): {
  hpRecovered: number;
  hitDiceRecovered: number;
} {
  // 2.1 Full HP & Status Reset
  const diff = hero.maxHp - hero.currentHp;
  hero.currentHp = hero.maxHp;
  hero.tempHp = 0;
  hero.deathSaves = { successes: 0, failures: 0 };
  hero.isDead = false;
  hero.isStable = false;
  hero.reactionAvailable = true;
  hero.conditions = hero.conditions.filter((c) => c !== 'unconscious');

  if (hero.characterSheet) {
    hero.characterSheet.currentHp = hero.maxHp;
    hero.characterSheet.tempHp = 0;
    hero.characterSheet.deathSaves = { successes: 0, failures: 0 };
    hero.characterSheet.activeConditions = hero.characterSheet.activeConditions.filter(
      (c) => c.conditionId !== 'unconscious',
    );
  }

  // 2.2 Spell Slots Reset (Standard + Pact Magic)
  if (hero.spellSlots) {
    for (const pool of Object.values(hero.spellSlots)) {
      pool.expended = 0;
      pool.available = pool.max;
    }
  }
  if (hero.pactMagic) {
    hero.pactMagic.expendedSlots = 0;
    hero.pactMagic.availableSlots = hero.pactMagic.maxSlots;
  }
  if (hero.characterSheet?.spellcasting) {
    if (hero.characterSheet.spellcasting.spellSlots) {
      for (const pool of Object.values(hero.characterSheet.spellcasting.spellSlots)) {
        pool.expended = 0;
        pool.available = pool.max;
      }
    }
    if (hero.characterSheet.spellcasting.pactMagic) {
      hero.characterSheet.spellcasting.pactMagic.expendedSlots = 0;
      hero.characterSheet.spellcasting.pactMagic.availableSlots =
        hero.characterSheet.spellcasting.pactMagic.maxSlots;
    }
  }

  // 2.3 Resources Reset (short_rest, long_rest, dawn)
  if (hero.characterSheet?.resources) {
    for (const pool of Object.values(hero.characterSheet.resources)) {
      pool.spent = 0;
      pool.available = pool.max;
    }
  }

  // 2.4 Hit Dice Recovery: max(1, floor(totalLevel / 2))
  const totalLevel = hero.characterSheet?.totalLevel ?? 1;
  const maxRecoverable = Math.max(1, Math.floor(totalLevel / 2));
  let remainingToRecover = maxRecoverable;

  if (hero.characterSheet?.hitDicePools) {
    // Sort pools descending by die size (recover higher die sizes first)
    const sortedPools = [...hero.characterSheet.hitDicePools].sort(
      (a, b) => b.dieSize - a.dieSize,
    );
    for (const pool of sortedPools) {
      if (pool.spent > 0 && remainingToRecover > 0) {
        const recoverCount = Math.min(pool.spent, remainingToRecover);
        pool.spent -= recoverCount;
        pool.available = pool.total - pool.spent;
        remainingToRecover -= recoverCount;
      }
    }
  }
  const recoveredTotal = maxRecoverable - remainingToRecover;

  // 2.5 Exhaustion Reduction
  if (hero.exhaustionLevel && hero.exhaustionLevel > 0) {
    hero.exhaustionLevel -= 1;
  }
  if (hero.characterSheet?.exhaustionLevel && hero.characterSheet.exhaustionLevel > 0) {
    hero.characterSheet.exhaustionLevel = (hero.characterSheet.exhaustionLevel - 1) as 0 | 1 | 2 | 3 | 4 | 5;
  }

  return { hpRecovered: diff, hitDiceRecovered: recoveredTotal };
}

/**
 * Executes a Long Rest (8 In-Game Hours) across party members (Spec 04 Section 4.2).
 * 1. Checks for Safe Room or rolls 1d20 Ambush Check (1–4 triggers ambush combat).
 * 2. On success:
 *    - Full HP & Resource reset.
 *    - All spell slots and Pact Magic slots restored.
 *    - Regains spent Hit Dice up to max(1, floor(totalLevel / 2)).
 *    - Reduces exhaustion level by 1.
 *    - Updates prepared spells if requested.
 */
export function resolveLongRest(
  state: GameState,
  command: Extract<GameCommand, { type: 'START_REST' }>,
  options?: ResolveRestOptions,
): ResolveRestResult {
  if (state.mode !== 'exploration') {
    return {
      nextState: state,
      events: [
        {
          type: 'REST_INTERRUPTED',
          restType: 'long',
          reason: 'combat',
        },
      ],
    };
  }

  let nextState: GameState = structuredClone(state);
  const events: GameEvent[] = [];

  // 1. Ambush Check in Unsecured Rooms
  const ambush = checkRestAmbush(nextState, {
    forceSafe: command.forceSafe ?? options?.forceSafe,
    rngState: nextState.rngState,
  });
  nextState.rngState = ambush.nextRng;

  if (ambush.isAmbush) {
    // Long rest interrupted by ambush!
    let ambushEncounterId: string | undefined;

    if (nextState.dungeon) {
      const untriggered = nextState.dungeon.encounters.find((e) => !e.triggered);
      if (untriggered) {
        ambushEncounterId = untriggered.id;
      } else {
        // Spawn dynamic wandering monster patrol encounter
        const leadId = nextState.marchingOrder?.leadExplorerId ?? Object.keys(nextState.party)[0];
        const lead = leadId ? nextState.party[leadId] : Object.values(nextState.party)[0];
        const leadPos = lead?.position ?? { x: 2, y: 2 };
        const spawnCells = findWalkableCellsNear(nextState.grid, leadPos, 2);

        const patrolId = `enc_wandering_patrol_${Date.now()}`;
        const patrol: EncounterSpawnGroup = {
          id: patrolId,
          roomId: lead?.roomId ?? 'dungeon',
          triggered: false,
          monsters: [
            {
              monsterId: 'goblin',
              spawnX: spawnCells[0]?.x ?? leadPos.x + 1,
              spawnY: spawnCells[0]?.y ?? leadPos.y,
            },
            {
              monsterId: 'goblin',
              spawnX: spawnCells[1]?.x ?? leadPos.x - 1,
              spawnY: spawnCells[1]?.y ?? leadPos.y,
            },
          ],
          surpriseCondition: {
            monstersStealthedDc: 12,
          },
        };
        nextState.dungeon.encounters.push(patrol);
        ambushEncounterId = patrolId;
      }

      events.push({
        type: 'REST_INTERRUPTED',
        restType: 'long',
        reason: 'ambush',
        ambushRoll: ambush.roll,
        encounterId: ambushEncounterId,
      });

      // Trigger the ambush encounter transition
      const encounterRes = triggerDungeonEncounter(nextState, ambushEncounterId, {
        monsterAmbushStealthDc: 12,
        rngState: nextState.rngState,
        compendium: options?.compendium,
      });
      nextState = encounterRes.nextState;
      events.push(...encounterRes.events);

      return { nextState, events };
    }

    // Not in dungeon mode: interrupt rest
    events.push({
      type: 'REST_INTERRUPTED',
      restType: 'long',
      reason: 'ambush',
      ambushRoll: ambush.roll,
    });
    nextState.mode = 'combat';
    return { nextState, events };
  }

  // 2. Safe Long Rest Execution
  const hpRecovered: Record<string, number> = {};
  const hitDiceRecovered: Record<string, number> = {};

  for (const [heroId, hero] of Object.entries(nextState.party)) {
    // 2.1–2.5 Shared per-combatant Long Rest restoration (also used when camping).
    const restored = restoreCombatantAfterLongRest(hero);
    hpRecovered[heroId] = restored.hpRecovered;
    hitDiceRecovered[heroId] = restored.hitDiceRecovered;

    // 2.6 Spell Preparation Update
    if (command.preparedSpellUpdates?.[heroId] && hero.characterSheet?.spellcasting) {
      hero.characterSheet.spellcasting.preparedOrKnownSpellIds = [
        ...command.preparedSpellUpdates[heroId],
      ];
    }

    // 2.7 Attunement updates during Long Rest (SRD 5.1 & SRD-505)
    if (command.attunements?.[heroId] && hero.buildState) {
      let b = hero.buildState;
      const comp = options?.compendium ?? defaultCompendium;
      for (const un of command.attunements[heroId]!.unattune ?? []) {
        b = unattuneMagicItem(b, un);
      }
      for (const at of command.attunements[heroId]!.attune ?? []) {
        b = attuneMagicItem(b, at, comp);
      }
      hero.buildState = b;
      hero.characterSheet = computeDerivedCharacter(b, comp);
      hero.armorClass = hero.characterSheet.armorClass.totalAc;
      events.push({
        type: 'ATTUNEMENT_CHANGED',
        characterId: heroId,
        attunedItemInstanceIds: b.attunedItemInstanceIds,
      });
    }
  }

  events.push({
    type: 'REST_COMPLETED',
    restType: 'long',
    hpRecovered,
    hitDiceRecovered,
  });

  return { nextState, events };
}

/**
 * Authoritative Rest resolver for GameCommand 'START_REST'.
 */
export function resolveRest(
  state: GameState,
  command: Extract<GameCommand, { type: 'START_REST' }>,
  options?: ResolveRestOptions,
): ResolveRestResult {
  if (command.restType === 'short') {
    return resolveShortRest(state, command, options);
  }
  return resolveLongRest(state, command, options);
}
