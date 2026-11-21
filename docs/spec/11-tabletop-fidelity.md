# Specification Module 11: Tabletop Fidelity — Languages, Skills & Spells

> **Packages**: `@srd5/data`, `@srd5/engine`, `@srd5/client`
> **Backlog Epic**: Epic 12 (`SRD-1201 – SRD-1214`)
> **Parent Specs**: [03](file:///home/jwesterl/ai/srd5-game/docs/spec/03-combat-and-rules-engine.md) (reactions, conditions), [04](file:///home/jwesterl/ai/srd5-game/docs/spec/04-dungeon-and-ai.md) (exploration verbs, props), [10](file:///home/jwesterl/ai/srd5-game/docs/spec/10-realm-war-campaign.md) (approach dialogue, diplomacy)

---

## 1. Premise & Relevance Contract

Tabletop play works because a human DM improvises relevance for any language, skill, or spell. This game must *systematize* that, or the content is decoration. Module 11 states the rule and builds the verbs:

- **Relevance contract**: every language, skill, and spell offered in the builder (or cast by AI) must have **at least one implemented mechanical path** — a gate, check, bonus, or effect that changes an outcome. Pure display text is not enough.
- **Add over cut**: where a skill/spell lacks a home, the default is to *add the verb* (theft, recall, identification, diplomacy lever, out-of-combat cast) rather than remove the content. Removal (or explicit "unsupported" badging) is the last resort, decided per item in `§7`.
- **Fail-forward**: knowledge and social mechanics add bonuses or unlock *better* paths; they never hard-block progression. A failed History check means no bonus, not no quest.

Status established by the 2026-11-21 audit (data vs. mechanics):

- **Languages**: all 18 data-only. No gate, no comprehension check. `comprehend-languages` / `tongues` absent from `spells.json`; `draft-party.ts` references a nonexistent `comprehend-languages` id (dangling).
- **Skills**: 6 of 18 with zero call sites (Animal Handling, Intimidation, Medicine, Nature, Performance, Sleight of Hand — lockpicking uses `thieves_tools`, never the skill). `passiveInsight` computed, never read. Combat `hide`/`search` and stabilize are stubs/auto.
- **Spells**: combat core is real (attack/save/damage/heal/condition/hazard/summon/teleport all resolve). `detect-magic`, `knock`, `sanctuary` are marker-only; `sleep` ignores the HP pool; `shield` buff id mismatches (`shield_ac_buff` vs spell data); hazard-zone `onEnter` drops 8 of 13 step types; `DECLARE_CAST_SPELL` throws outside combat, so all utility/ritual/social use is unreachable.

---

## 2. Languages — From Display to Gate

### 2.1 Data additions (`@srd5/data`)

- Author `comprehend-languages` (L1 ritual) and `tongues` (L3) as executable overlays: comprehension buff with duration + concentration linkage (same attach path as `bless`), consumed by `§2.2` resolution.
- Remove or resolve the dangling `comprehend-languages` reference in draft-party generation (it must resolve in the compendium once the spell exists).
- Optional follow-up: `disguise-self`, `speak-with-animals` (referenced by mission approaches in Spec 10; currently dataset-absent).

### 2.2 Language-gated encounters

```ts
export interface LanguageGateSpec {
  requiredLanguage: string;        // e.g. 'orc'
  fallback: 'gesture' | 'hostile' | 'fetch_translator';
  // gesture: intent-only cues (attitude, Insight-readable), trade at penalty
  // hostile: encounter starts unfriendly; combat/stealth/bribe remain
  // fetch_translator: quest redirects to a translator NPC/hireling
}
```

- Resolution is **party-level**: if any conscious party member in the scene speaks the language (or is under `comprehend-languages`/`tongues`/Tongue-of-the-Sun-and-Moon), the gate opens.
- Monster/NPC `languages[]` (stored today, never read) become the counterparty. No shared language → dialogue tree replaced by intent cues + `Insight` read (attitude, fear, demand), never a soft-lock: gesture trade, bribe, stealth, or combat always remain.
- SRD language-dependent enchantments (`command`, `suggestion`, `charm-person`, `hideous-laughter`, `vicious-mockery`, `divine-word`) regain their shared-language precondition: target that cannot understand the caster is unaffected (before the save).

### 2.3 Reference quest: Orc tribe

The Local Orc Tribe chain (Spec 10 §6) becomes the reference implementation: no Orcish speaker → gesture/intent path with trade penalty and Intimidation/Persuasion alternatives; Orcish speaker (or magic) → full negotiation, History unlocks (§4.2), alliance → guerrilla warfare as today.

### 2.4 War languages — every nation gets a voice (phased)

Each of the 8 nation archetypes (Spec 10 §2) speaks a command tongue from the existing 18-language list — no new languages, no ninth faction:

| Nation | Tongue | Notes |
| :--- | :--- | :--- |
| Bloodtusk Horde | Orcish | Orders, war-chants; broken Common for threats |
| Iron Covenant | Dwarvish | Clan cant in mine/forge traffic |
| Emerald Circle | Elvish (+ Sylvan rites) | Court speech; rites unintelligible without Sylvan |
| Ashen Spire | Infernal (officers), Draconic (battle) | Orders naturally encrypted; battle-cast callouts |
| Dawn Crown / Silver Bastion | Common (+ liturgical Celestial) | Celestial seals on writs and shrine orders |
| Gilded League | Common (deliberately) | Merchants speak everything — itself a tell |
| Frostbound Clan | Giant | Saga-tongue among raiders; giant-kin auxiliaries |
| Sub-factions | Orcish (tribe), Druidic (circle) | Already granted via race/class |

Planar flavor (celestial / infernal / abyssal / draconic assets, cult auxiliaries, summoned casters) enters as **officers, intercepts, and loot** — never as new nations.

**Phase 1 (this epic — ships independently):**

- **Nation language profiles**: 8 data rows (`commandLanguage`, `liturgicalLanguage?`). Resolution reuses the `§2.2` party-level gate.
- **Dispatch intercepts**: patrols, couriers, and dead drops yield sealed orders (attack warnings, patrol routes, tribute schedules) as loot. Right tongue (or Comprehend/Tongues/translator) → read and act (ambush the ambush, evacuate the POI). Wrong tongue → sealed prop in inventory until translated.
- **Patrol interaction matrix**: evasion never gates on language. Bluff (Persuasion/Deception) requires a shared tongue, magic, or interpreter — without it, gesture caps at pass-with-Threat, never clean. Stealth/Survival evade, gold bribe (small tourist-price surcharge without patter), and combat work exactly as today.
- **Deal tiers**: direct parley in their tongue **+2** on the negotiation check and unlocks the top deal tier (best tribute, longest truce); via magic = baseline; via interpreter hireling = baseline + gold-per-parley cost; gestures/broken Common **−2**, top tier locked. Modifiers render in the existing odds rows before commit.
- **Interpreter hirelings**: one War Room row (gold cost, per-parley fee). Compromise/double-agent behavior is a data hook only (deferred).

**Explicitly deferred (hooks reserved, not implemented):** forged-dispatch misdirection missions, prisoner interrogation trees, code-talker coordination bonuses. The `LanguageGateSpec` and dispatch-loot shapes already admit them; each ships as its own ticket later.

---

## 3. Skills — Every Skill Gets a Verb

### 3.1 Sleight of Hand + tools (thief signature)

New exploration/realm verb keyed off the **skill**, with tools as bonus:

- **Pickpocket / plant / lift**: `DEX (Sleight of Hand)` vs. target DC; `thieves_tools` proficiency grants advantage (or +2) rather than gating. Distinct payloads: lift key/purse, plant evidence, snip component pouch.
- Failure branches: caught → attitude drop, patrol threat, or combat — never silent nothing.
- **Fast Hands**: Sleight attempts as a bonus action (thief combat-adjacent role).

`thieves_tools` keeps locks/traps; the skill owns social/exploration theft. No overlap.

### 3.2 Knowledge passives — always-on lenses, never blocks

Each tagged location/quest/NPC carries an optional recall spec:

```ts
export interface KnowledgeRecallSpec {
  skill: 'history' | 'religion' | 'arcana' | 'nature';
  dc: number;
  reward:
    | { kind: 'reveal_quest'; questId: string }          // History: artifact Z at X/Y
    | { kind: 'trap_bonus'; bonus: number; scope: string } // History: Red Wizard's pit traps → +2 detect here
    | { kind: 'ward_info'; target: string }              // Religion/Arcana: identify consecration/ward before trigger
    | { kind: 'lore_note'; text: string };
}
```

- **History**: unlocks quests (old battlefield, forgotten cache), grants dungeon-scoped bonuses (trap detection, ambush warning). Fail = no bonus.
- **Religion**: shrine outcomes, unhallowed-ground warnings, cleanse-cursed-mine ward identification (promote today's mission-alt to a real dungeon verb).
- **Arcana**: spell identification — pass to see a spell being cast (name/level) before deciding to counterspell; fail and you may still counterspell, but blind (slot committed without knowing the target's level). Precedent: BG3's counterspell reaction prompt shows the incoming spell; here the Arcana check (Xanathar's-derived homebrew) gates whether you see it at all. Ward/decipher uses as today.
- **Nature**: forage/identify split with Survival (Nature: what is it / is it safe; Survival: find enough of it).

### 3.3 Contested and missing rolls

- **Insight**: opposed vs. Deception in social reads (patrol bluff, tribe intent, envoy missions). `passiveInsight` becomes the floor, and every social prompt shows a "something feels off" cue when the party's passive beats the speaker's Deception.
- **Medicine**: stabilize becomes a real check (DC 10; a healer's kit grants advantage — deliberate simplification of the 2014 rule where a kit stabilizes without a check, noted here so it reads as intent, not bug); diagnose disease/poison branches.
- **Intimidation**: social third leg alongside Persuasion/Deception with distinct consequences (fear: compliance + attitude cost).
- **Animal Handling**: mounts/beasts/pack animals, sub-faction beast encounters.
- **Performance**: tavern/distraction/cover-identity verb (earn coin, distract guards, blend into crowds) — the alternative to cutting it.
- Combat `hide` graduates from stub to a real Stealth-vs-passive-Perception roll granting `hidden` (unseen attacker) per Spec 03 §4.3 item 7.

### 3.4 Standing skill passives — small, always-on, never overpowered

Every skill below grants a flat standing bonus in its domain. Rules: **proficiency-gated, not rank-scaled** (untrained = nothing, proficient = half bonus, expert = full); bonuses are small, typed, and same-type never stacks (take the highest); domain-locked, never global +X.

| Skill | Proficient | Expert |
| :--- | :--- | :--- |
| **Religion** | +1 HP whenever you *receive* magical healing or quaff a potion | +2, plus +1 vs. undead-channeled effects on consecrated ground; shrine blessings last one extra rest |
| **History** | One free recall per delve (hint card per `KnowledgeRecallSpec`) | Recall also reveals the boss's damage resistances pre-fight |
| **Nature** | +1 ration yield when foraging; advantage vs. natural poison/disease | Wilderness camps count one step safer for ambush rolls |
| **Animal Handling** | Beasts start one attitude step friendlier (buys the parley round) | Mounts/beasts grant off-road travel discount; guard-beasts +1 camp perception |
| **Medicine** | Administered Hit-Die healing +1 per die during rests; free poison/disease diagnosis | Stabilize DC 10 with healer's-kit advantage; diagnosis unlocks the correct cure path |
| **Intimidation** | Bloodied enemies check morale earlier against your side | Failed Deception bluffs fall back to Intimidation at +2 DC instead of instant combat |
| **Insight** | "Something feels off" cue whenever party passive beats a speaker's Deception | Opposed read reveals intent band (demand / fear / bluff) |
| **Performance** | Tavern rests earn coin + rumors on one roll (fail-forward) | Once per combat, distract as a Help-equivalent from 30 ft |

### 3.5 Content tagging — authored once, generated forever

Recall specs (`§3.2`) and passive dividends (`§3.4`) attach to content two ways:

- **Authored modules** (Kaelen, quest chains): hand-tagged per location/quest/NPC (`historyDc`, `religionDc`, `arcanaDc` + reward kind).
- **Procedural generator** (`DungeonGenerator`, realm POIs/delves): recall tags are emitted from the same seeded theme tables that already emit `detectionDc`, traps, and loot — e.g. undead-biome floors roll a Religion ward tag, wizard-lair themes roll History/Arcana tags. Deterministic from the seed, so **every new game ships with the data side already done**: no post-generation pass, no per-save migration.

---

## 4. Spells — Utility Reaches Parity With Combat

### 4.1 Out-of-combat casting

New command path (exploration/social) for non-hostile casts: `DECLARE_CAST_SPELL` outside combat resolves buffs, comprehension, detection, ritual tags — and **healing** (`cure-wounds` et al. out of combat is a must, not a nice-to-have) — without an initiative context. Rituals (10-minute tag) cost time/rations rather than slots where the fiction demands it. This unlocks `knock` (prop hook alongside tools/Athletics), `detect-magic` (sense active effects/wards within range — real sense, not a marker), and all touch/utility buffs.

### 4.2 Marker-spell enforcement (correctness fixes)

- `detect-magic`: real sense mechanic (reveals magical props/effects/concentrations in range).
- `knock`: engine prop hook (unlock + loud report — SRD: audible 300 ft, implemented as adjacent-room alert, the classic tradeoff).
- `sanctuary`: enforce ward (attackers must pass WIS save or redirect) — today only `charmed` is checked on attack.
- `sleep`: HP-pool resolution per SRD (roll pool, lowest-HP creatures fall unconscious first) instead of unconditional `unconscious`.
- `shield` buff id: reconcile `shield_ac_buff` (engine) with `shield-ac-bonus` (data) — verified live mismatch; directly-cast Shield plants an id nothing expires.
- Hazard-zone `onEnterOrStartTurn`: handle the dropped step types or explicitly mark unsupported (no silent drops).
- Shared-language preconditions on enchantments (§2.2).

### 4.3 Capstones: Wish and Time Stop (bounded, BG2-style)

- **Wish (L9)**: fixed menu of ~6 boons (restore party, grant resistance, supply cache, full rest, mass heal, one free resurrection), each an explicit effect bundle. Stress follows SRD 5.1 (as already encoded in `spells.json`): casting for anything other than duplicating a spell risks incapacitation and a 33% chance of never casting Wish again (Strength falls to 3 for 2d4 days on stress). No open-ended parsing.
- **Time Stop (L9)**: caster takes **1d4+1 consecutive solo turns** per SRD 5.1 (already encoded in the `time-stop-boon` adjudication data): others frozen (no reactions, no hazard ticks against them); ends early if the caster affects another creature. Implemented as initiative manipulation, then resume.

---

## 5. Diplomacy Template — Skills as Keys and Levers

Reference flow for tribe/envoy/truce missions (extends Spec 10 §5–6 approach dialogue):

1. **History unlocks** the engagement (treaty knowledge, insult to avoid, artifact leverage).
2. **Insight reads** the room (opposed vs. Deception; passive as floor).
3. **Persuasion / Deception / Intimidation resolve** with distinct outcomes: alliance + fair terms / trick + later fallout / compliance + attitude cost.
4. **Fail-forward**: failure degrades the deal (tribute, ambush on exit, militia penalty) — never a dead end.

---

## 6. Builder UX — No Silent Dead Picks

- Each language/skill/spell option shows its **mechanical status**: where it matters (quest tag, verb, gate) via the same tooltip pattern as the spell cards.
- Party-aware hints: "No party member speaks Orcish — Comprehend Languages recommended" when a queued quest gates on it.
- Campaign setup may surface the relevance matrix (which skills the current content actually exercises) so parties can cover the space deliberately.

---

## 7. Acceptance & Test Plan

- Integrity test: every builder-offered spell id resolves in the compendium (kills dangling refs permanently); every offered skill/language has ≥1 tagged consumer or an explicit `unsupported` badge with a tracking ticket.
- Headless tests: language gate open/closed/fallback; recall rewards; theft success/caught branches; counterspell identification pass/fail; knock alert tradeoff; sleep HP-pool ordering; Wish boons; Time Stop turn sequencing; diplomacy fail-forward outcomes.
- E2E (open — no UI chain-advancement surface yet): Orc-tribe chain played without Orcish (gesture path) and with Orcish/magic (full negotiation). Engine chain plays end-to-end headless (allied/blocked both paths); sub-faction quest advancement is currently engine-call-only (`completeSubFactionQuest`), displayed read-only in the War Room. Promote to E2E when a UI advancement path ships.
- Passives: prof/expert tiers verified per skill; generator recall tags bit-exact across seeds.
