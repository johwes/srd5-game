import { describe, expect, it } from 'vitest';
import {
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import {
  createInitialGameState,
  reduceGame,
} from '../state/index.js';
import { createTacticalGrid } from '../grid/index.js';
import { createMonsterCombatant } from '../combat/combatant.js';
import { transitionCombatToExploration } from '../dungeon/encounters.js';
import { applyBetweenCombatLevelUp } from '../dungeon/level-up-flow.js';
import { computeDerivedCharacter } from '../character/derived.js';
import type { Combatant } from '../combat/types.js';

describe('SRD-505: Encounter XP Awards and Between-Combat Level-Up Flow', () => {
  const compendium = defaultCompendium;

  function createExplorationEncounterState(): {
    state: ReturnType<typeof createInitialGameState>;
    heroFighter: Combatant;
    heroWizard: Combatant;
  } {
    const fighterBuild = getPregenCharacter('pregen-fighter')!;
    const wizardBuild = getPregenCharacter('pregen-wizard')!;

    const fighterSheet = computeDerivedCharacter(fighterBuild, compendium);
    const wizardSheet = computeDerivedCharacter(wizardBuild, compendium);

    const heroFighter: Combatant = {
      id: 'fighter-1',
      name: 'Fighter',
      side: 'party',
      teamId: 'party',
      size: 'medium',
      position: { x: 1, y: 1 },
      speedFeet: 30,
      currentHp: fighterSheet.maxHp,
      maxHp: fighterSheet.maxHp,
      tempHp: 0,
      armorClass: fighterSheet.armorClass.totalAc,
      dexterityScore: 14,
      dexterityModifier: 2,
      strengthScore: 16,
      strengthModifier: 3,
      initiativeBonus: 2,
      initiativeRollMode: 'normal',
      passivePerception: 10,
      stealthModifier: 2,
      isSurprised: false,
      isDodging: false,
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
      isDead: false,
      isStable: false,
      attacksPerAction: 1,
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
      buildState: fighterBuild,
      characterSheet: fighterSheet,
    };

    const heroWizard: Combatant = {
      id: 'wizard-1',
      name: 'Wizard',
      side: 'party',
      teamId: 'party',
      size: 'medium',
      position: { x: 1, y: 2 },
      speedFeet: 30,
      currentHp: wizardSheet.maxHp,
      maxHp: wizardSheet.maxHp,
      tempHp: 0,
      armorClass: wizardSheet.armorClass.totalAc,
      dexterityScore: 14,
      dexterityModifier: 2,
      strengthScore: 10,
      strengthModifier: 0,
      initiativeBonus: 2,
      initiativeRollMode: 'normal',
      passivePerception: 11,
      stealthModifier: 2,
      isSurprised: false,
      isDodging: false,
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
      isDead: false,
      isStable: false,
      attacksPerAction: 1,
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
      buildState: wizardBuild,
      characterSheet: wizardSheet,
    };

    const grid = createTacticalGrid(8, 8, 'floor_stone', 'bright');
    const state = createInitialGameState({
      grid,
      party: [heroFighter, heroWizard],
    });

    return { state, heroFighter, heroWizard };
  }

  describe('Encounter Victory and XP Awards', () => {
    it('divides defeated monster XP equally among conscious surviving party members', () => {
      const { state, heroFighter, heroWizard } = createExplorationEncounterState();

      // Spawn 2 Goblins (CR 1/4 = 50 XP each => 100 XP total)
      const goblinData = compendium.requireMonster('goblin');
      const goblin1 = createMonsterCombatant(goblinData, 'goblin-1', { x: 4, y: 4 });
      const goblin2 = createMonsterCombatant(goblinData, 'goblin-2', { x: 4, y: 5 });

      // Mark both goblins as dead/defeated
      goblin1.isDead = true;
      goblin1.currentHp = 0;
      goblin2.isDead = true;
      goblin2.currentHp = 0;

      const combatState = {
        ...state,
        mode: 'combat' as const,
        monsters: {
          'goblin-1': goblin1,
          'goblin-2': goblin2,
        },
        party: {
          'fighter-1': heroFighter,
          'wizard-1': heroWizard,
        },
      };

      const result = transitionCombatToExploration(combatState);

      expect(result.nextState.mode).toBe('exploration');

      // 100 XP / 2 surviving heroes = 50 XP each
      const victoryEvent = result.events.find((e) => e.type === 'ENCOUNTER_VICTORY');
      expect(victoryEvent).toBeDefined();
      if (victoryEvent && victoryEvent.type === 'ENCOUNTER_VICTORY') {
        expect(victoryEvent.totalXp).toBe(100);
        expect(victoryEvent.xpAwarded).toBe(50);
        expect(victoryEvent.survivingHeroIds).toEqual(['fighter-1', 'wizard-1']);
      }

      // Verify heroes received 50 XP in their buildState and characterSheet
      const nextFighter = result.nextState.party['fighter-1']!;
      const nextWizard = result.nextState.party['wizard-1']!;

      expect(nextFighter.buildState?.runtime.xp).toBe(50);
      expect(nextFighter.characterSheet?.xp).toBe(50);
      expect(nextWizard.buildState?.runtime.xp).toBe(50);
    });

    it('emits LEVEL_UP_UNLOCKED and sets levelUpAvailable when XP crosses level 2 threshold (300 XP)', () => {
      const { state, heroFighter } = createExplorationEncounterState();

      // Prepare fighter with 250 XP
      const fighterWith250Xp: Combatant = {
        ...heroFighter,
        buildState: {
          ...heroFighter.buildState!,
          runtime: {
            ...heroFighter.buildState!.runtime,
            xp: 250,
          },
        },
        characterSheet: {
          ...heroFighter.characterSheet!,
          xp: 250,
        },
      };

      // Spawn an Ogre (CR 2 = 450 XP)
      const ogreData = compendium.requireMonster('ogre');
      const ogre = createMonsterCombatant(ogreData, 'ogre-1', { x: 5, y: 5 });
      ogre.isDead = true;
      ogre.currentHp = 0;

      const combatState = {
        ...state,
        mode: 'combat' as const,
        monsters: { 'ogre-1': ogre },
        party: { 'fighter-1': fighterWith250Xp },
      };

      const result = transitionCombatToExploration(combatState);

      // Fighter had 250 + 450 = 700 XP, which qualifies for Level 2 (300 XP threshold)
      const nextFighter = result.nextState.party['fighter-1']!;
      expect(nextFighter.buildState?.runtime.xp).toBe(700);
      expect(nextFighter.levelUpAvailable).toBe(true);

      const levelUpEvent = result.events.find((e) => e.type === 'LEVEL_UP_UNLOCKED');
      expect(levelUpEvent).toBeDefined();
      if (levelUpEvent && levelUpEvent.type === 'LEVEL_UP_UNLOCKED') {
        expect(levelUpEvent.characterId).toBe('fighter-1');
        expect(levelUpEvent.currentLevel).toBe(1);
        expect(levelUpEvent.eligibleLevel).toBe(2);
      }
    });
  });

  describe('Between-Combat Level-Up Flow', () => {
    it('advances a Level 1 Fighter to Level 2 in exploration mode', () => {
      const { state, heroFighter } = createExplorationEncounterState();

      // Give fighter 350 XP (eligible for Level 2)
      const eligibleFighter: Combatant = {
        ...heroFighter,
        buildState: {
          ...heroFighter.buildState!,
          runtime: {
            ...heroFighter.buildState!.runtime,
            xp: 350,
          },
        },
        characterSheet: {
          ...heroFighter.characterSheet!,
          xp: 350,
        },
      };

      const explorationState = {
        ...state,
        mode: 'exploration' as const,
        party: { 'fighter-1': eligibleFighter },
      };

      const initialMaxHp = eligibleFighter.maxHp;

      const result = applyBetweenCombatLevelUp(
        explorationState,
        'fighter-1',
        {
          classId: 'fighter',
          hpMethod: 'fixed', // Fighter d10 fixed HP = 6 + CON mod (2) = 8
        },
        compendium,
      );

      expect(result.summary.newTotalLevel).toBe(2);
      expect(result.summary.newClassLevel).toBe(2);
      expect(result.summary.hpGained).toBe(8);

      const levelEvent = result.events.find((e) => e.type === 'LEVEL_UP_APPLIED');
      expect(levelEvent).toBeDefined();

      const advancedFighter = result.nextState.party['fighter-1']!;
      expect(advancedFighter.characterSheet?.totalLevel).toBe(2);
      expect(advancedFighter.maxHp).toBe(initialMaxHp + 8);
      expect(advancedFighter.currentHp).toBe(initialMaxHp + 8);

      // Level 2 Fighter unlocks Action Surge
      expect(
        advancedFighter.characterSheet?.featureIds?.includes('action-surge') ||
          advancedFighter.characterSheet?.featureIds?.includes('action_surge'),
      ).toBe(true);
    });

    it('rejects level-up while in active tactical combat mode', () => {
      const { state, heroFighter } = createExplorationEncounterState();

      const inCombatState = {
        ...state,
        mode: 'combat' as const,
        party: { 'fighter-1': heroFighter },
      };

      expect(() =>
        applyBetweenCombatLevelUp(
          inCombatState,
          'fighter-1',
          { hpMethod: 'fixed' },
          compendium,
        ),
      ).toThrow(/Cannot level up a character during active tactical combat/);
    });

    it('handles LEVEL_UP_CHARACTER command via reduceGame()', () => {
      const { state, heroFighter } = createExplorationEncounterState();

      const eligibleFighter: Combatant = {
        ...heroFighter,
        buildState: {
          ...heroFighter.buildState!,
          runtime: {
            ...heroFighter.buildState!.runtime,
            xp: 500,
          },
        },
      };

      const explorationState = {
        ...state,
        mode: 'exploration' as const,
        party: { 'fighter-1': eligibleFighter },
      };

      const { nextState, events } = reduceGame(explorationState, {
        type: 'LEVEL_UP_CHARACTER',
        characterId: 'fighter-1',
        levelUpRequest: {
          classId: 'fighter',
          hpMethod: 'fixed',
        },
      });

      expect(events.some((e) => e.type === 'LEVEL_UP_APPLIED')).toBe(true);
      expect(nextState.party['fighter-1']?.characterSheet?.totalLevel).toBe(2);
    });
  });
});
