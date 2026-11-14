import {
  type SrdCompendium,
  type CharacterBuildState,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  type LevelUpRequest,
  type LevelUpSummary,
  applyLevelUp,
  validateLevelUp,
  XP_THRESHOLDS_BY_LEVEL,
} from '../character/level-up.js';
import { computeDerivedCharacter } from '../character/derived.js';
import { type GameEvent, type GameState } from '../state/types.js';

export interface ApplyBetweenCombatLevelUpResult {
  nextState: GameState;
  events: GameEvent[];
  summary: LevelUpSummary;
}

/**
 * Executes a between-combat Level-Up for a party hero in Exploration mode (SRD-505).
 * 1. Verifies the game is in 'exploration' mode (cannot level up in active combat).
 * 2. Validates and applies class progression, subclass unlocks, ASI/feat, and spell selections.
 * 3. Re-derives the full 10-stage character sheet and updates combatant stats (max HP, current HP, AC).
 * 4. Emits a LEVEL_UP_APPLIED event.
 */
export function applyBetweenCombatLevelUp(
  state: GameState,
  characterId: string,
  request: LevelUpRequest,
  compendium: SrdCompendium = defaultCompendium,
): ApplyBetweenCombatLevelUpResult {
  if (state.mode === 'combat') {
    throw new Error('Cannot level up a character during active tactical combat. Must be in exploration mode.');
  }

  const hero = state.party[characterId];
  if (!hero) {
    throw new Error(`Character ${characterId} not found in party.`);
  }

  // Retrieve or reconstruct backing CharacterBuildState
  let buildState: CharacterBuildState | undefined = hero.buildState;
  if (!buildState) {
    const pregen = getPregenCharacter(characterId) ?? getPregenCharacter(`pregen-${characterId}`);
    if (pregen) {
      buildState = {
        ...pregen,
        runtime: {
          ...pregen.runtime,
          currentHp: hero.currentHp,
          xp: hero.characterSheet?.xp ?? pregen.runtime.xp,
        },
      };
    }
  }

  if (!buildState) {
    throw new Error(`Character ${characterId} does not have a backing CharacterBuildState.`);
  }

  // Validate level-up request
  const validation = validateLevelUp(buildState, request, compendium);
  if (!validation.valid) {
    const errMsgs = validation.errors.join(', ');
    throw new Error(`Level-up validation failed: ${errMsgs}`);
  }

  // Apply level-up
  const execResult = applyLevelUp(buildState, request, compendium);
  const summary = execResult.summary;
  const nextBuildState = execResult.state;
  const nextSheet = computeDerivedCharacter(nextBuildState, compendium);

  // Update hero in party
  const hpIncrease = summary.hpGained;
  const updatedCurrentHp = Math.min(nextSheet.maxHp, hero.currentHp + hpIncrease);
  const nextLevelThreshold = XP_THRESHOLDS_BY_LEVEL[nextSheet.totalLevel + 1];
  const isLevelUpAvailable =
    nextLevelThreshold !== undefined && nextBuildState.runtime.xp >= nextLevelThreshold;

  const updatedHero = {
    ...hero,
    buildState: nextBuildState,
    characterSheet: nextSheet,
    maxHp: nextSheet.maxHp,
    currentHp: updatedCurrentHp,
    armorClass: nextSheet.armorClass.totalAc,
    attacksPerAction: nextSheet.attacksPerAction,
    speedFeet: nextSheet.speedFeet,
    levelUpAvailable: isLevelUpAvailable,
    hitDicePools: nextSheet.hitDicePools,
  };

  const nextParty = {
    ...state.party,
    [characterId]: updatedHero,
  };

  const nextState: GameState = {
    ...state,
    party: nextParty,
  };

  const events: GameEvent[] = [
    {
      type: 'LEVEL_UP_APPLIED',
      characterId,
      newLevel: summary.newTotalLevel,
      hpIncrease,
      summary,
    },
  ];

  return {
    nextState,
    events,
    summary,
  };
}
