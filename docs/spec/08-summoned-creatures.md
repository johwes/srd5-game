# 08 — Summoned Creatures & Conjured Tokens Specification

## 1. Overview

Several SRD 5.1 spells conjure persistent battlefield entities — *Faithful Hound* (phantom watchdog), *Guardian of Faith* (spectral guardian), *Arcane Hand* (Large force hand), *Arcane Sword* (plane of force) — plus tokenizable bonus-action attackers (*Spiritual Weapon*, *Flaming Sphere*). Today these execute either as one-shot effects or as explicit "Manual / Adjudicated Resolution" fallback cards (`manual_adjudication`), so they leave no token, take no turns, and cannot be attacked, commanded, or dispelled on the board.

This spec defines **Summoned Creatures & Conjured Tokens**: engine-owned combatants spawned declaratively from the Effect DSL, with SRD-accurate statblocks, team allegiance, initiative turns (or trigger-based autonomy), concentration linkage, and full client rendering — reusing the disposition matrix ([06-game-modes-and-progression.md](file:///home/jwesterl/ai/srd5-game/docs/spec/06-game-modes-and-progression.md) Section 2.3), the seeded PRNG combat pipeline ([03-combat-and-rules-engine.md](file:///home/jwesterl/ai/srd5-game/docs/spec/03-combat-and-rules-engine.md)), and the Fog-of-War transport ([05-multiplayer-and-ui.md](file:///home/jwesterl/ai/srd5-game/docs/spec/05-multiplayer-and-ui.md) Section 2).

Out of scope: *Mage Hand* / *Floating Disk* (utility, stay adjudicated), *Instant Summons* / *Magnificent Mansion* (narrative, stay adjudicated). *Flaming Sphere* and *Spiritual Weapon* keep their current automation; token migration is a Tier 2 follow-up.

---

## 2. Summon Roster (SRD 5.1 mechanics)

| Spell | Token | Size | AC / HP | Duration | Conc. | Control |
| :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| *Faithful Hound* (L4) | Phantom watchdog | Medium | Unharmable (untargetable), — HP | 8 hours | No | **Autonomous**: barks when a Small+ creature comes within 30 ft (except password speaker); at the start of the caster's turn it bites one hostile within 5 ft (`+spellAttack`, `4d8` force). 100 ft leash (vanishes beyond), dismiss as action. Sees invisible/ethereal, ignores illusions. |
| *Guardian of Faith* (L4) | Spectral guardian | Large | Invulnerable (no AC/HP; vanishes after dealing 60 total damage) | 8 hours | No | **Aura trigger**: hostile entering/moving within 10 ft first time per turn → DEX save vs 20 radiant / half. Occupies space, hovers. |
| *Arcane Hand* (L5) | Force hand | Large | AC 20, HP = caster max HP, STR 26 (+8), DEX 10 (+0) | 1 min (10 rounds) | Yes | **Commanded**: own initiative turn, controlled by caster's player. Move 60 ft + one effect: *Clenched Fist* (`+spellAttack`, `4d6` force), *Forceful Hand* (STR contest push), *Grasping Hand* (grapple + `2d6+mod` crush), *Interposing Hand* (half cover). Doesn't fill space. |
| *Arcane Sword* (L7) | Force sword | Small | Invulnerable (no AC/HP given) | 1 min (10 rounds) | Yes | **Commanded**: own initiative turn, move 20 ft + melee spell attack (`3d10` force). |

> **Data-accuracy note (verify at implementation):** numeric statblocks above follow SRD 5.1 as recalled; the existing `arcane-sword` overlay uses `4d8` where SRD 5.1 specifies `3d10` — correct to `3d10` when authoring its token overlay (SRD-905).

---

## 3. Data Schema (`@srd5/data`)

### 3.1 `summon_creature` Effect Step

```ts
export type SummonControlMode = 'commanded' | 'autonomous';

export interface SummonStatblockSpec {
  size: CreatureSize;
  armorClass?: number;            // omit when invulnerable/untargetable
  hitPointsFormula?: string;      // e.g. "@casterMaxHp" (Arcane Hand); omit when unharmable
  untargetable?: boolean;         // Faithful Hound, Arcane Sword, Guardian
  speedFeet: number;
  abilities?: Partial<Record<AbilityId, number>>; // e.g. Hand STR 26
  actions?: ActivatedAbilitySpec[];               // commanded-mode attacks
  triggers?: Array<
    | { kind: 'start_of_caster_turn_attack'; rangeFeet: number }
    | { kind: 'hostile_enter_radius'; radiusFeet: number; perTurnLimit: 1 }
    | { kind: 'leash'; maxDistanceFeet: number }
  >;
  damageCap?: number;             // Guardian of Faith: despawn after 60 dealt
}

export type EffectStepSpec = ... | {
  step: 'summon_creature';
  summonId: string;               // e.g. 'faithful-hound-token'
  name: string;
  durationRounds: number;
  requiresConcentration: boolean;
  placement: 'unoccupied_within_range';
  statblock: SummonStatblockSpec;
  control: SummonControlMode;
};
```

- `SpellEffectStepOverride` gains `'summon_creature'` in its step enum.
- Validation (`validate.ts`): `hitPointsFormula` parsed by the formula checker (new `@casterMaxHp` variable); trigger radii are positive ints.
- Guardian-style damage-cap despawn is expressed as trigger metadata, not a new zone type.

### 3.2 Summon Statblock Overlays

Executable overlays for `faithful-hound`, `guardian-of-faith`, `arcane-hand`, `arcane-sword` replace their `manual_adjudication` cards with `summon_creature` pipelines (Guardian additionally keeps a `damageCap: 60`). Formula-syntax, cross-reference, and Product Identity checks apply unchanged.

---

## 4. Engine Lifecycle (`@srd5/engine`)

### 4.1 Spawn

- `executeSpellCast` evaluates `summon_creature` after targeting: validates an unoccupied in-range cell (originCell or first target cell), builds a `Combatant` via a `createSummonCombatant(statblock, caster, position)` factory (seeded HP roll for formula HP; `@casterMaxHp` resolves from caster), sets:
  - `teamId` = caster's `teamId` (disposition matrix makes it allied/hostile automatically — no new allegiance code),
  - `playerId` = caster's `playerId`,
  - `summonedByEntityId` = caster id, `isSummon = true`,
  - `concentratingOn`-style linkage when `requiresConcentration` (reuses the concentration-break → despawn path already used by hazard zones),
  - expiry = `currentRound + durationRounds`.
- Emits `SPELL_CAST` (existing) + new `SUMMON_SPAWNED { entityId, summonId, sourceName }`.
- Hours-long durations (hound/guardian, 8h ≈ 4800 rounds) persist across combats: the summon lives in `GameState.party`-adjacent storage? No — summons exist only inside `CombatState.combatants`. Cross-combat persistence (dungeon exploration with an 8-hour hound) is explicitly Tier 2; Tier 1 summons live for the encounter (or until dismissed/expired) and duration only matters for in-combat rounds.

### 4.2 Turns & Commands

- **Commanded** summons roll initiative at spawn (seeded PRNG) and take normal turns with a standard `TurnBudget`. The controlling player is resolved transitively: a player controls entity X if they control X's `summonedByEntityId` chain root. The active-combatant HUD, hotbar, and `isPlayerControlled` checks work unchanged once `playerId` is set.
- **Autonomous** summons (hound bite, guardian trigger) never take turns; they resolve via hooks:
  - Hound bite: at the start of the *caster's* turn, bite one hostile within 5 ft (attack roll, `4d8` force). Leash check (dismiss beyond 100 ft). Bark alert → `CombatLog` + floating text (no mechanical effect).
  - Guardian: hostile entering/moving within 10 ft (first time per creature per turn, tracked like `triggeredCreaturesThisTurn`) → DEX save vs 20 radiant / half; accumulate dealt damage; despawn at cap 60.
- Dismiss-as-action (hound): new standard-ish command `DISMISS_SUMMON { actorId: casterId, summonId }`, or reuse `drop_concentration`-style free action. Spec: dedicated command, action cost `action` (hound) — engine validates caster ownership.

### 4.3 Damage, Death & Expiry

- Harmable summons (Hand) use the standard damage pipeline (resistances none unless specified); at 0 HP they die → `CREATURE_DIED` + despawn (spell ends).
- Untargetable summons (Hound, Sword, Guardian): targeting filters (`resolveSpellTargets`, attack declaration, AI planner) skip combatants with `untargetable === true`; AOE rasterization excludes them from `aoeTargetIds`.
- Expiry: at turn-boundary processing, summons past `durationRounds` emit `SUMMON_EXPIRED { entityId, reason: 'duration' | 'concentration' | 'dismissed' | 'leash' }` and are removed from `combatants` (and initiative order).
- Determinism: all rolls (initiative, HP, attacks) thread `rngState`; identical seeds replay identically (verified by test).

### 4.4 AI Interaction

No planner changes: the AI already evaluates `areHostile()` over `teamId`s, so monsters attack harmable enemy summons and ignore untargetable ones. Autonomous triggers need no AI.

---

## 5. Transport & Server (`@srd5/transport`, `@srd5/server`)

- `PlayerViewCombatant` gains `isSummon?: boolean` and `summonedByEntityId?: string`; `toPlayerViewCombatant` projects both.
- Ownership: `room.ts` command authorization resolves control transitively (summon → caster → slot). `PlayerSlotAssignment`s need no change: a player commanding a summon must control its caster chain root.
- Fog-of-War: summons project like any allied combatant (visible to the controlling player's team; monsters see them per normal visibility). The hound's "invisible to all but caster" is modeled as `untargetable` + token translucency rather than fog-stripping (keeps AI/vision code untouched; documented concession).

---

## 6. Client (`@srd5/client`)

- **Token layer**: summoned tokens render with a violet summon ring (distinct from selection/turn auras) + `✦S` marker; untargetable summons render at 60% opacity. Reuses `CreatureTokenLayer` buff-pip row (no new layer).
- **HUD**: initiative ribbon includes summons automatically (initiative order); medallion shows an `✦ Summoned` chip with the source spell name; `SelectedEnemyCard` works unchanged; hotbar operates on the active summon when its turn is up (player-controlled check already handles `playerId`).
- **Targeting**: `resolveSpellTargets` / `validateTargetPick` exclude `untargetable` summons from enemy picks (allies may still target harmable summons with beneficial spells).
- **No new modals**: summon dismissal uses the existing action menu (standard action entry when a dismissible summon is selected… or caster sheet button — implementation detail, Tier 1: dedicated hotbar standard action appears while the caster is active and owns a dismissible summon).

---

## 7. Milestone Acceptance Criteria

- Headless tests: spawn each of the 4 summons via `executeSpellCast`; assert token fields (team, HP/AC, untargetable flags), initiative membership, and seeded determinism (double-execution equality).
- Hound: start-of-caster-turn bite resolves (`ATTACK_RESOLVED`, `4d8` force on hit); leash dismiss beyond 100 ft; dismiss command ends it.
- Guardian: hostile entering 10 ft triggers DEX save for 20/half radiant; despawn exactly when cumulative dealt damage reaches 60.
- Hand: AC 20 / HP = caster max; Clenched Fist attack resolves; concentration break despawns (`SUMMON_EXPIRED`).
- Sword: moves 20 ft and attacks for `3d10` force (with the `4d8` overlay correction).
- Ownership tests: non-owning player commands for a summon are rejected; fog views include allied summons and strip nothing extra.
- Client tests: summon ring renders on tokens; medallion chip shows; targeting excludes untargetable summons; no console errors at 1280×800.
