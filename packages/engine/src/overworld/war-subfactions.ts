import {
  z,
} from 'zod';
import {
  type WarState,
  WarStateSchema,
  getWarNation,
} from './war.js';
import {
  type SubFactionProgress,
  type WarDiplomacyState,
  type WarSubfactionId,
  WAR_SUBFACTION_QUESTS,
  WarDiplomacyStateSchema,
  WarSubfactionIdSchema,
} from './war-threat.js';
import {
  RealmError,
} from './realm-error.js';

/**
 * SRD-1104 — Sub-faction patronage chains (Spec 10 Section 6).
 *
 * Local Orc Tribe (3 quests → ongoing guerrilla warfare drain) and Local
 * Druid Circle (2 quests → Arcana/Morale Power + permanent party blessing).
 * Pure and deterministic; inputs are never mutated.
 */

// ---------------------------------------------------------------------------
// Sub-faction patronage chains (Spec 10 Section 6)
// ---------------------------------------------------------------------------

export const ORC_GUERRILLA_DRAIN_ID = 'orc-guerrilla';
export const ORC_GUERRILLA_MILITARY_DRAIN = 3;
export const ORC_GUERRILLA_ECONOMY_DRAIN = 3;
export const DRUID_BLESSING_ARCANA = 5;
export const DRUID_BLESSING_MORALE = 5;
/** Off-road forest Survival/Stealth bonus while the Druid blessing holds. */
export const DRUID_BLESSING_TRAIL_BONUS = 2;

export const CompleteSubFactionQuestOptionsSchema = z.object({
  diplomacy: WarDiplomacyStateSchema,
  war: WarStateSchema,
  subfactionId: WarSubfactionIdSchema,
  questId: z.string().min(1),
  /** Rival nation the Orc guerrillas bleed (required to seal the alliance). */
  targetNationId: z.string().min(1).optional(),
  day: z.number().int().min(1).optional(),
});
export type CompleteSubFactionQuestOptions = z.input<typeof CompleteSubFactionQuestOptionsSchema>;

export interface CompletedSubFactionQuest {
  diplomacy: WarDiplomacyState;
  war: WarState;
  allied: boolean;
  headline: string;
}

/** Off-road Survival/Stealth bonus from the Druid blessing (`0` or `+2`). */
export function getDruidBlessingTrailBonus(diplomacy: WarDiplomacyState): number {
  return diplomacy.druidBlessingActive ? DRUID_BLESSING_TRAIL_BONUS : 0;
}

/**
 * Advances a sub-faction patronage chain. Quests must complete in order and
 * exactly once; sealing the final quest forges the alliance:
 * - Orc Tribe → ongoing `-3` Military/Economy drain on the target rival.
 * - Druid Circle → `+5` Arcana / `+5` Morale for the player's nation plus the
 *   permanent trail blessing flag.
 */
export function completeSubFactionQuest(rawOptions: CompleteSubFactionQuestOptions): CompletedSubFactionQuest {
  const options = CompleteSubFactionQuestOptionsSchema.parse(rawOptions);
  const diplomacy = WarDiplomacyStateSchema.parse(options.diplomacy);
  const war = WarStateSchema.parse(options.war);
  const day = options.day ?? war.currentDay;
  const chain = WAR_SUBFACTION_QUESTS[options.subfactionId];
  const questIndex = chain.indexOf(options.questId);
  if (questIndex === -1) {
    throw new RealmError(`Quest '${options.questId}' is not part of the ${options.subfactionId} chain`);
  }

  const nextDiplomacy = structuredClone(diplomacy);
  const progress: SubFactionProgress = nextDiplomacy.subfactions[options.subfactionId] ?? {
    id: options.subfactionId,
    completedQuestIds: [],
    allied: false,
  };
  if (progress.allied) throw new RealmError(`The ${options.subfactionId} alliance is already sealed`);
  const expected = chain[progress.completedQuestIds.length]!;
  if (options.questId !== expected) {
    throw new RealmError(`Expected ${options.subfactionId} quest '${expected}' next, not '${options.questId}'`);
  }
  progress.completedQuestIds = [...progress.completedQuestIds, options.questId];

  const nextWar: WarState = structuredClone(war);
  const isFinal = progress.completedQuestIds.length === chain.length;
  if (!isFinal) {
    nextDiplomacy.subfactions[options.subfactionId] = progress;
    return {
      diplomacy: nextDiplomacy,
      war: WarStateSchema.parse(nextWar),
      allied: false,
      headline: `${labelForSubfaction(options.subfactionId)} marks '${options.questId}' done (${progress.completedQuestIds.length}/${chain.length}).`,
    };
  }

  progress.allied = true;
  nextDiplomacy.subfactions[options.subfactionId] = progress;
  if (options.subfactionId === 'local_orc_tribe') {
    const targetId = options.targetNationId;
    if (!targetId) throw new RealmError('Sealing the Orc alliance requires a targetNationId');
    const target = getWarNation(nextWar, targetId);
    if (target.isPlayerNation) throw new RealmError('Orc guerrillas cannot target your own nation');
    nextWar.guerrillaDrains = [
      ...nextWar.guerrillaDrains,
      {
        id: ORC_GUERRILLA_DRAIN_ID,
        label: 'Orc guerrilla warfare',
        targetNationId: targetId,
        militaryDrain: ORC_GUERRILLA_MILITARY_DRAIN,
        economyDrain: ORC_GUERRILLA_ECONOMY_DRAIN,
      },
    ];
    nextWar.chronicle = [
      ...nextWar.chronicle,
      {
        day,
        kind: 'guerrilla_started',
        headline: `The Local Orc Tribe rides against ${target.name} — guerrilla warfare drains its war machine.`,
      },
    ];
    return {
      diplomacy: nextDiplomacy,
      war: WarStateSchema.parse(nextWar),
      allied: true,
      headline: `The Local Orc Tribe seals its blood-oath: ${target.name} bleeds -${ORC_GUERRILLA_MILITARY_DRAIN} Military / -${ORC_GUERRILLA_ECONOMY_DRAIN} Economy every war tick.`,
    };
  }

  const player = nextWar.nations[nextWar.playerNationId]!;
  player.power.arcana += DRUID_BLESSING_ARCANA;
  player.power.morale += DRUID_BLESSING_MORALE;
  nextDiplomacy.druidBlessingActive = true;
  nextWar.chronicle = [
    ...nextWar.chronicle,
    {
      day,
      kind: 'druid_blessing',
      headline: `The Local Druid Circle blesses ${player.name} (+${DRUID_BLESSING_ARCANA} Arcana, +${DRUID_BLESSING_MORALE} Morale, trail blessing).`,
    },
  ];
  return {
    diplomacy: nextDiplomacy,
    war: WarStateSchema.parse(nextWar),
    allied: true,
    headline: `The Local Druid Circle seals its covenant: +${DRUID_BLESSING_ARCANA} Arcana / +${DRUID_BLESSING_MORALE} Morale and a permanent trail blessing.`,
  };
}

function labelForSubfaction(id: WarSubfactionId): string {
  return id === 'local_orc_tribe' ? 'The Local Orc Tribe' : 'The Local Druid Circle';
}
