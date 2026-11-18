import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GameEvent } from '@srd5/engine';
import { CombatLog } from '../components/combat/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Regression test: every GameEvent/CombatEvent variant must render a
 * human-readable log line. Unhandled types used to fall through to
 * `JSON.stringify(event)` (e.g. ENTITY_MOVED rendered as raw JSON).
 */
describe('CombatLog event coverage (no raw JSON)', () => {
  // The exact event shape from the bug report.
  const reportedMove: GameEvent = {
    type: 'ENTITY_MOVED',
    entityId: 'pregen-wizard',
    path: [
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 3, y: 3 },
    ],
    mode: 'walk',
  };

  const allEvents: GameEvent[] = [
    reportedMove,
    { type: 'COMBAT_STARTED', encounterId: 'enc-1', initiativeOrder: [{ entityId: 'pregen-wizard', initiative: 14 }] },
    { type: 'ROUND_STARTED', round: 2 },
    { type: 'TURN_STARTED', entityId: 'pregen-wizard', round: 2 },
    { type: 'TURN_ENDED', entityId: 'pregen-wizard', round: 2 },
    { type: 'SURPRISE_DETERMINED', surprisedEntityIds: ['goblin-1'] },
    { type: 'SURPRISE_ENDED', entityId: 'goblin-1' },
    {
      type: 'DICE_ROLLED', actorId: 'pregen-wizard', rollPurpose: 'initiative', notation: '1d20+2',
      rolls: [12], kept: [12], modifier: 2, total: 14, mode: 'normal',
    },
    {
      type: 'DEATH_SAVE_ROLLED', entityId: 'pregen-fighter', roll: 14, outcome: 'success',
      deathSaves: { successes: 1, failures: 0 }, currentHp: 0,
    },
    { type: 'CONDITION_ADDED', targetId: 'goblin-1', conditionId: 'prone' },
    { type: 'CONDITION_REMOVED', targetId: 'goblin-1', conditionId: 'prone' },
    { type: 'ACTION_USED', actorId: 'pregen-fighter', actionName: 'action_surge', cost: 'free' },
    { type: 'ACTION_USED', actorId: 'pregen-rogue', actionName: 'dash', cost: 'bonus_action' },
    {
      type: 'ATTACK_RESOLVED', attackerId: 'pregen-fighter', targetId: 'goblin-1',
      weaponOrSpellName: 'Longsword', attackType: 'melee_weapon', roll: 14,
      totalToHit: 19, targetAc: 15, outcome: 'hit',
      damage: { total: 9, damageType: 'slashing', diceFormula: '1d8 + 3' },
    },
    {
      type: 'GRAPPLE_RESOLVED', attackerId: 'pregen-fighter', targetId: 'goblin-1', success: true,
      attackerAthleticsTotal: 16, targetContestTotal: 9, targetSkillUsed: 'athletics',
    },
    {
      type: 'SHOVE_RESOLVED', attackerId: 'pregen-fighter', targetId: 'goblin-1', success: false,
      shoveType: 'knock_prone', attackerAthleticsTotal: 8, targetContestTotal: 15, targetSkillUsed: 'acrobatics',
    },
    {
      type: 'DAMAGE_APPLIED', targetId: 'goblin-1', rawAmount: 9, finalAmount: 9,
      damageType: 'slashing', tempHpAbsorbed: 0, hpRemaining: 3,
    },
    { type: 'TEMP_HP_APPLIED', targetId: 'pregen-fighter', amount: 5, tempHpBefore: 0, tempHpAfter: 5 },
    { type: 'CREATURE_DIED', entityId: 'goblin-1', reason: 'zero_hp' },
    {
      type: 'SPELL_CAST', actorId: 'pregen-wizard', spellId: 'magic-missile', spellName: 'Magic Missile',
      spellLevel: 1, castAtLevel: 1, actionCost: 'action', slotExpended: 1, targetEntityIds: ['goblin-1'],
    },
    {
      type: 'SAVING_THROW_RESOLVED', entityId: 'goblin-1', ability: 'dex', dc: 13,
      roll: 7, total: 9, outcome: 'failure', sourceSpellOrAbilityName: 'Fireball',
    },
    { type: 'HEAL_APPLIED', targetId: 'pregen-fighter', amount: 6, hpBefore: 10, hpAfter: 16, sourceName: 'Second Wind' },
    { type: 'CONCENTRATION_STARTED', entityId: 'pregen-wizard', spellId: 'bless', spellName: 'Bless', targetEntityIds: [] },
    { type: 'CONCENTRATION_ENDED', entityId: 'pregen-wizard', spellId: 'bless', reason: 'damaged' },
    {
      type: 'HAZARD_ZONE_CREATED', instanceId: 'hz-1', zoneId: 'web', casterId: 'pregen-wizard',
      sourceName: 'Web', shape: 'cube', origin: { x: 5, y: 5 }, sizeFeet: 20,
      cells: [{ x: 5, y: 5 }], durationRounds: 10, difficultTerrain: true,
    },
    { type: 'HAZARD_ZONE_REMOVED', instanceId: 'hz-1', zoneId: 'web', casterId: 'pregen-wizard', reason: 'expired' },
    { type: 'HAZARD_ZONE_TRIGGERED', instanceId: 'hz-1', zoneId: 'web', entityId: 'goblin-1', trigger: 'enter' },
    { type: 'EXHAUSTION_CHANGED', entityId: 'pregen-fighter', oldLevel: 0, newLevel: 1 },
    {
      type: 'REACTION_PROMPTED',
      prompt: {
        promptId: 'prompt-1', reactorEntityId: 'pregen-fighter', triggerType: 'movement_reach_exit',
        triggerDescription: 'Goblin moves out of reach', availableReactions: [],
      },
    },
    { type: 'REACTION_RESOLVED', promptId: 'prompt-1', reactorEntityId: 'pregen-fighter', actionTaken: 'passed' },
    { type: 'ENCOUNTER_VICTORY', outcome: 'party_victory', round: 3 },
    { type: 'ENCOUNTER_VICTORY', encounterId: 'enc-1', outcome: 'party_victory', round: 3, xpAwarded: 200, totalXp: 200, survivingHeroIds: ['pregen-wizard'] },
    {
      type: 'SUMMON_SPAWNED', entityId: 'arcane-hand-x', summonId: 'arcane-hand', casterId: 'pregen-wizard',
      sourceName: 'Arcane Hand', control: 'commanded', untargetable: false, position: { x: 5, y: 5 }, expiryRound: 11,
    },
    { type: 'SUMMON_EXPIRED', entityId: 'arcane-hand-x', summonId: 'arcane-hand', reason: 'dismissed' },
    { type: 'SUMMON_TRIGGERED', entityId: 'hound-x', summonId: 'faithful-hound', trigger: 'bite', targetEntityId: 'goblin-1' },
    {
      type: 'MANUAL_ADJUDICATION_REQUIRED', actorId: 'pregen-wizard', sourceName: 'Wish',
      adjudicationId: 'adj-wish', title: 'Wish — State Your Desire', guidance: 'Describe the desired effect.',
    },
    { type: 'PROP_STATE_CHANGED', propId: 'door-courtyard', prevState: 'closed', nextState: 'open', actorId: 'pregen-fighter' },
    { type: 'SECRET_DISCOVERED', propId: 'sdoor-1', finderId: 'pregen-rogue', kind: 'secret_door' },
    { type: 'TRAP_TRIGGERED', propId: 'trap-1', targetId: 'pregen-fighter', damage: 7, damageType: 'piercing', saveMade: true, saveSuccess: false },
    {
      type: 'CHECK_RESOLVED', actorId: 'pregen-rogue', checkType: 'perception', dc: 15,
      roll: 17, modifier: 3, total: 20, success: true,
    },
    { type: 'LOOT_ACQUIRED', actorId: 'pregen-fighter', propId: 'chest-armory', loot: { gp: 50 } },
    { type: 'ROOM_DISCOVERED', roomId: 'barracks', roomName: 'Barracks' },
    { type: 'ROOM_ENTERED', actorId: 'pregen-fighter', roomId: 'barracks', prevRoomId: 'courtyard' },
    { type: 'MARCHING_ORDER_CHANGED', order: ['a', 'b'], formation: 'single_file', leadExplorerId: 'pregen-fighter' },
    { type: 'MOVEMENT_HALTED', actorId: 'pregen-fighter', reason: 'trap_detected', at: { x: 5, y: 5 } },
    { type: 'PARTY_STEALTH_CHANGED', inStealth: true },
    { type: 'ENCOUNTER_TRIGGERED', encounterId: 'enc-2', roomId: 'barracks', monsterIds: ['goblin-1', 'goblin-2'], isSurprisedParty: false, isSurprisedMonsters: true },
    { type: 'ROOM_CLEARED', roomId: 'barracks', roomName: 'Barracks' },
    { type: 'REST_COMPLETED', restType: 'short', hpRecovered: { 'pregen-fighter': 8 } },
    { type: 'REST_INTERRUPTED', restType: 'long', reason: 'ambush' },
    { type: 'PREPARED_SPELLS_UPDATED', characterId: 'pregen-cleric', preparedSpellIds: ['cure-wounds'] },
    { type: 'MODE_CHANGED', fromMode: 'exploration', toMode: 'combat' },
    { type: 'LEVEL_UP_UNLOCKED', characterId: 'pregen-fighter', currentLevel: 1, eligibleLevel: 2 },
    { type: 'LEVEL_UP_APPLIED', characterId: 'pregen-fighter', newLevel: 2, hpIncrease: 7 },
    { type: 'ATTUNEMENT_CHANGED', characterId: 'pregen-fighter', attunedItemInstanceIds: ['sword-1'] },
    { type: 'INVENTORY_UPDATED', characterId: 'pregen-fighter', inventory: [] },
    { type: 'SHRINE_ACTIVATED', shrineId: 'shrine-1', shrineType: 'healing', actorId: 'pregen-cleric', effectDescription: 'Restored all HP.' },
    { type: 'ROGUELITE_STARVATION', actorId: 'pregen-fighter', rationsConsumed: 0, rationsShort: 2, exhaustionLevel: 1 },
  ];

  it('renders a human-readable line for every event type', () => {
    render(<CombatLog events={allEvents} />);

    const entries = screen.getAllByTestId('combat-log-entry');
    expect(entries.length).toBe(allEvents.length);

    for (const entry of entries) {
      expect(entry.textContent).not.toContain('{"type"');
    }
  });

  it('formats the reported movement event as distance, not JSON', () => {
    render(<CombatLog events={[reportedMove]} />);

    const entries = screen.getAllByTestId('combat-log-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('moves');
    expect(entries[0]!.textContent).toContain('10 ft on foot');
  });

  it('formats signature combat and exploration events readably', () => {
    render(
      <CombatLog
        events={[
          { type: 'ACTION_USED', actorId: 'pregen-fighter', actionName: 'action_surge', cost: 'free' },
          { type: 'HEAL_APPLIED', targetId: 'pregen-fighter', amount: 6, hpBefore: 10, hpAfter: 16 },
          { type: 'PROP_STATE_CHANGED', propId: 'door-courtyard', prevState: 'closed', nextState: 'open' },
          { type: 'TRAP_TRIGGERED', propId: 'trap-1', targetId: 'pregen-fighter', damage: 7, damageType: 'piercing' },
          { type: 'REST_COMPLETED', restType: 'short', hpRecovered: {} },
          { type: 'LEVEL_UP_APPLIED', characterId: 'pregen-fighter', newLevel: 2, hpIncrease: 7 },
        ]}
      />,
    );

    const text = screen.getByTestId('combat-log').textContent ?? '';
    expect(text).toContain('Action Surge');
    expect(text).toContain('+6 HP');
    expect(text).toContain('door courtyard');
    expect(text).toContain('Trap triggered');
    expect(text).toContain('Short rest completed');
    expect(text).toContain('reaches level 2');
    expect(text).not.toContain('{"type"');
  });
});
