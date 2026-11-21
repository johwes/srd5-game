# Specification Module 10: The Realm — Multi-Nation War & Special-Ops Campaign

> **Packages**: `@srd5/engine`, `@srd5/client`
> **Backlog Epic**: Epic 11 (`SRD-1101` – `SRD-1106`)
> **Parent Spec**: [06-game-modes-and-progression.md](file:///home/jwesterl/ai/srd5-game/docs/spec/06-game-modes-and-progression.md) (§4 The Realm)

---

## 1. Strategic Premise & Campaign Win/Loss Loop

**The Realm** frames the player's 1–4 hero party as an **elite special-operations company** serving one nation in a **Master of Magic / Civilization-style multi-nation war**.

- **Multi-Party War**: At campaign creation, **3–4 warring nations** are rolled deterministically from a balanced pool of 8 ruler archetypes (**3 Good, 3 Neutral, 2 Evil**), guaranteeing ideological variety (at least 1 Good and 1 Evil/rival nation per world).
- **War Power Dominance**: Each nation maintains a **War Power Score** (`0..dominanceTarget`, default `dominanceTarget = 100`) composed of four visible strategic pillars:
  - `military`: troops, commanders, fortresses, and active mercenaries.
  - `economy`: intact mines, supply depots, bridges, and trade routes.
  - `arcana`: recovered war artifacts, shrines, and battle mages.
  - `morale`: domestic security, spy intelligence, and battlefield victories.
- **Victory & Defeat**:
  - **Victory**: The player's nation reaches `dominanceTarget` (`100`) War Power **or** all rival nations collapse to `0` War Power.
  - **Defeat**: The player's nation's War Power collapses to `0`.
- **Bidirectional Special-Ops Leverage**: Operations either **boost your nation's War Power** (e.g., capturing a neutral mine, cleansing a cursed domestic mine, defending an attacked POI, recovering a war artifact, winning Druid Circle support) **and/or drain an enemy nation's War Power** (e.g., poisoning a city/garrison water supply, destroying a bridge, assassinating a general, sabotaging a mine, inciting Orc guerrilla warfare).

**Scope boundary (party-scale, no management sim).** The war is backdrop that generates adventures, never a second game about administering it: the player commands 1–4 heroes whose verbs stay heroic (the mission catalog above), never builds cities, raises armies, or manages supply lines. War Power, Threat, patrols, and the simulation tick are world-simulation the party *exploits*, not resources the player *administers*. Known tension, flagged not fixed: hiring a mercenary company currently buys +Military War Power directly (gold → strategic points). A future pass should resolve this into party-scale terms (swords beside you in battle, or cut it) — new war-economy features must not deepen the points-purchase pattern.

---

## 2. Randomized Nation Archetypes (3 Good · 3 Neutral · 2 Evil)

All names, rulers, and lore are original and contain zero non-SRD Product Identity:

| Archetype ID | Nation Name | Ruler | Alignment | Strategic Flavor & Patron Perk |
| :--- | :--- | :--- | :---: | :--- |
| `dawn-crown` | The Dawn Crown | Queen Evelyn | `good` | Benevolent monarch defending her realm's cities and farmlands. **Royal Provisioning** (inn/temple discount + Morale bonus). |
| `emerald-circle` | The Emerald Circle | Archdruid Sylvanus | `good` | Noble wardens of the ancient forests and sacred groves. **Wilderness Guides** (reduced off-road forest/swamp travel cost). |
| `silver-bastion` | The Silver Bastion | Lord Commander Cedric | `good` | Chivalric order of paladins & frontier rangers shielding border towns. **Shieldwall Oath** (allied militia join POI defense battles). |
| `gilded-league` | The Gilded League | Magister Vance | `neutral` | Pragmatic merchant-princes funding mercenary companies. **Mercenary Coffers** (15% shop & mercenary hire discount). |
| `iron-covenant` | The Iron Covenant | High Thane Torin | `neutral` | Proud dwarven fortress-builders and deep-earth miners. **Deep Forges** (+25% Economy Power from intact mines). |
| `frostbound-clan` | The Frostbound Clan | Jarl Astrid | `neutral` | Fierce northern clan valuing martial honor and coastal raiding. **Raider's Swiftness** (faster forced marches & ambush bonuses). |
| `ashen-spire` | The Ashen Spire | Archmage Malakor | `evil` | Conquering archmage & necromancer seeking arcane supremacy. **Arcane Tithe** (bonus Arcana Power & spell scrolls). |
| `bloodtusk-horde` | The Bloodtusk Horde | Warlord Grak | `evil` | Warring orc tribe offering plunder, tribute, and raw might. **Spoils of War** (+25% mission gold rewards). |

---

## 3. Living Strategic POIs & War Simulation Tick

Rather than complex full-map territory painting, dynamic war state centers on **Strategic POIs** placed on `OverworldMap`:

- **New POI Kinds** (`OVERWORLD_POI_KINDS`): `'fortress'`, `'mine'`, `'bridge'`, `'supply_depot'`, `'prison_keep'`, `'subfaction_camp'`.
- **Dynamic POI Metadata**:
  - `strategicStatus?: 'intact' | 'sabotaged' | 'destroyed' | 'cursed' | 'contested' | 'under_attack'`
  - `statusChangedDay?: number`
  - `recoveryDay?: number` (e.g., when an enemy finishes rebuilding a destroyed bridge)
  - `attackDeadlineDay?: number` (countdown for incoming **Protect POI** defenses)
  - `powerValue?: number` (War Power generated per war tick when `'intact'`)
- **Deterministic War Tick (`advanceWarSimulation`)**:
  Runs automatically every `warTickIntervalDays` (default: every **3 in-game days**) using Mulberry32 seeded PRNG:
  1. **Resource Income**: Intact strategic POIs contribute War Power; `'sabotaged'`, `'destroyed'`, and `'cursed'` POIs contribute `0`.
  2. **Bridge Rebuilds**: Destroyed enemy bridges are repaired once `currentDay >= poi.recoveryDay`, restoring enemy logistics and logging a War Chronicle headline.
  3. **Neutral Mine Contests**: Unclaimed or party-captured neutral mines may be contested by rival nations (`strategicStatus: 'contested'`), opening capture/defense missions.
  4. **Enemy Sabotage & Necromantic Curses**: Rival nations (especially arcane/evil factions) may sabotage an allied mine—e.g., casting a **necromantic curse** that flips the mine to `'cursed'`, raises undead inside, and spawns a domestic **Cleanse Cursed Mine** mission.
  5. **Incoming Attack Warnings (`protect_poi`)**: Rival nations not under a Truce may launch an assault on an allied POI (`strategicStatus: 'under_attack'`, `attackDeadlineDay`), creating a timed **Protect POI** multi-wave defense mission.
  6. **Guerrilla Warfare & Truce Expiry**: Active sub-faction guerrilla campaigns drain the target enemy nation each tick; expired Truces revert to active war.
  7. **Threat Level Decay**: Decays enemy territory Threat every day (see §7).

---

## 4. Class-Based Enemy Squads (Dynamic CR) & Upgraded Tactical AI

Enemy garrisons, warbands, patrol interceptors, and wave attackers include **real SRD 5.1 classed NPCs** (`fighter`, `wizard`, `cleric`, `rogue`) built via `computeDerivedCharacter()` + `createCharacterCombatant(..., { side: 'monster' })`, scaled dynamically to the party's average level (`dynamic CR`), alongside nation-flavored SRD monsters (Orcs, Undead, Beasts, Knights).

### 4.1 Class-Kit Tactical AI (`@srd5/engine/src/ai/planner.ts`)
`planAiTurn` evaluates `actor.characterSheet` so classed enemies actively use their 5e class features and spells:
- **Warrior (`fighter`)**: Uses *Second Wind* (bonus action) when below 50% HP and *Action Surge* when engaged in melee.
- **Mage (`wizard`)**: Casts AOE spells (*Fireball*, *Burning Hands*) when 2+ party members cluster; otherwise *Magic Missile* / *Fire Bolt* from cover.
- **Cleric (`cleric`)**: Prioritizes *Healing Word* / *Cure Wounds* on injured allies below 60% HP, *Bless* early, or *Guiding Bolt* / *Sacred Flame*.
- **Thief (`rogue`)**: Uses *Cunning Action* (bonus-action Disengage / Dash) to kite out of melee and targets heroes adjacent to an ally for *Sneak Attack*.

### 4.2 Multi-Wave Dynamic-CR Defense (`protect_poi`)
**Protect POI** missions spawn `2–3` waves scaled to party level (`WaveReinforcementSpec[]`), with reinforcements arriving at map edges on subsequent rounds (or once the prior wave falls). Combat victory requires defeating all waves; letting the deadline lapse allows the enemy to sabotage or capture the POI.

---

## 5. Special-Ops Mission Catalog & POI-Specific Approach Dialogue

Arriving at a mission POI opens an interactive **Approach Dialogue** offering **3–4 context-aware options** tied to the **POI type & mission kind** (with deterministic seeded variety; **Frontal Assault** is always available):

| Mission Kind | Side | Target POI | Context-Aware Approaches (Examples) |
| :--- | :--- | :--- | :--- |
| `assassinate_general` | Offensive | `fortress` | Scale Walls (**Athletics** + Rope Assist -> 1 hero climbs & secures rope for party, Surprise & reduced garrison), Arcane Entry (*Misty Step / Dimension Door / Disguise Self / Invisibility*), Trick Gate Guards (**Persuasion / Deception**), Frontal Assault |
| `destroy_bridge` | Offensive | `bridge` | Impersonate Guard Rotation (**Deception / Persuasion** -> guards leave, **bloodless sabotage**!), Sapper Stealth (**Stealth / Thieves' Tools**), Frontal Assault *(no teleport option)* |
| `poison_water_supply` | Offensive | `town` / `supply_depot` | Disguised Supply Cart (**Deception** or *Disguise Self* -> bloodless!), Cistern Infiltration (**Athletics / Stealth** -> Surprise), Direct Raid |
| `sabotage_enemy_mine` | Offensive | `mine` (enemy) | Sneak & Collapse Supports (**Stealth / Investigation** -> bloodless or escape skirmish), Arcane Demolition (*Shatter / Fireball*), Frontal Assault |
| `rescue_spy` | Offensive | `prison_keep` | Forge Transfer Orders (**Deception / Persuasion** or *Charm Person*), Lockpick Jailbreak (**Thieves' Tools / Stealth**), Teleport/Climb In (*Misty Step* / **Athletics**), Storm the Keep |
| `protect_poi` | Domestic | Allied POI (`under_attack`) | Fortify Barricades (**Athletics**), Rally Militia (**Persuasion** -> allied guards join battle), Set Ambush Traps (**Survival** -> Wave 1 Surprised), Hold the Line |
| `cleanse_cursed_mine` | Domestic | Allied `mine` (`cursed`) | Ritual Ward (**Arcana / Religion** -> weakens undead & grants Surprise), Stealth Recon (**Stealth**), Direct Assault *(undead roster)* |
| `capture_neutral_mine` | Neutral | `mine` (neutral/contested) | Scout & Ambush (**Survival / Stealth** -> Surprise), Rally Miners (**Persuasion** -> allied militia), Frontal Assault |
| `recover_war_artifact` | Expedition | `ancient_shrine` / `dungeon_entrance` | Decipher Wards (**Arcana / History**), Outrace Rival Agents (**Survival / Perception**), Direct Delve |

Every Approach option reads real 5e `DerivedCharacterSheet` skill bonuses, tool proficiencies, and spell slots (deducting any expended slot before combat) and resolves deterministically via `rollD20`.

---

## 6. Diplomacy, Mercenaries & Sub-Faction Proxy Warfare

- **Temporary Truces**: Via the War Room / Diplomacy tab (or envoy mission), the party can negotiate a **Temporary Truce** (`12–18` days) with a rival nation using a **Persuasion** challenge + optional gold/tribute. While active, that nation halts attacks on your POIs and its patrols do not engage your party.
- **Hire Mercenaries & Thieves' Guild**: Spend gold (+ optional CHA check for discount/reliability) to hire a **Mercenary Company** (+Military Power or allied garrison reinforcement) or a **Thieves' Guild Cell** (executes remote sabotage against a chosen enemy supply depot or mine).
- **Sub-Faction Patronage Chains**:
  - **Local Orc Tribe** (`local_orc_tribe`): Complete a **3-quest chain** to secure an alliance; once allied, the tribe wages ongoing **Guerrilla Warfare** against a designated enemy nation (`-3` Enemy Military/Economy Power every war tick).
  - **Local Druid Circle** (`local_druid_circle`): Complete a **2-quest chain** to earn their blessing (`+10` Ally Arcana/Morale Power + permanent party forest-stealth / healing bonus).

---

## 7. Enemy Territory Patrols, Threat / Heat & Natural Decay

Traveling inside a hostile nation's territory (`tile.factionControlId` owned by a nation at war with the player's nation, not under a Truce) tracks a per-nation **Threat Level (`0..100`)**:

- **Tiers**: `unnoticed` (`0–24`), `suspicious` (`25–54`), `hunted` (`55–79`), `most_wanted` (`80–100`).
- **Road vs. Off-Road Risk**: Traveling on enemy roads (`roadThrough === true`) is faster but carries a substantially higher patrol encounter rate; traveling **off-road** (forests, hills, mountains) leverages the party's highest **Survival / Stealth** bonus to reduce patrol checks.
- **Patrol Encounter Dialogue**:
  - **Bluff as Traveling Band** (**Persuasion / Deception** or *Disguise Self*) -> pass with `+0` Threat.
  - **Slip Off the Road** (**Stealth / Survival**) -> evade with `+0` Threat.
  - **Bribe Patrol Captain** (Gold) -> pass with `+5` Threat.
  - **Engage / Kill Patrol** -> tactical combat; killing an enemy patrol raises Threat in that nation by **`+20`** (e.g., killing 5 patrols reaches `100` *Most Wanted*).
- **Pursuit at High Threat**: Once Threat reaches `>= 55` (*Hunted*), `pursuitActive` turns on and classed **Hunter-Killer Pursuit Squads** (Warrior/Mage/Cleric/Thief) actively intercept the party while in that nation's lands.
- **Natural Threat Decay Over Time**:
  - **Outside that nation's territory**: Threat naturally cools down by **`-6` per in-game day** (`-18` per 3-day war tick), so exiting hostile territory after killing multiple patrols lets heat dissipate steadily until the party is no longer hunted.
  - **Inside that nation's territory without combat** (off-road stealth / bluffing): Threat cools down slowly at **`-2` per in-game day**.
  - **Pursuit Stand-Down**: When Threat drops below `55`, `pursuitActive` automatically clears and Hunter-Killer squads stand down (recorded in the War Chronicle).
