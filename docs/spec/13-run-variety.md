# 13 — Run Variety (Endless Uniqueness) Specification

## 0. Design Identity (read first)

This game is **not** a roguelike wearing D&D clothes, and it is **not** BG3.
Its identity: **BG3's interaction language** (hotbar, tooltips, paperdoll
inventory, camp rhythm) + **real 5e rules feel** + **strictly SRD 5.1 content**
+ **a Civilization / Master of Magic strategic overland** + something of its
own. The hybrid *is* the feel: 5e party tactics feeding a 4X overland, with
veterans who persist between campaigns. Nothing else makes exactly that.

Consequences for this epic: variety levers must speak Civ/MoM (setup options,
lairs, guardians, goody huts, heroes), never Hades (no run-mutator drafts, no
unlock trees). The Kaelen campaign stays a fixed story module by design.

Non-negotiables carried over from every epic: seeded determinism (bit-exact
replay per seed + options), no `Math.random()` in `@srd5/engine`, SRD 5.1-only
content, offline build/test green.

## 1. Overview

The engine already supports endless replay on paper: seeded procedural floors,
depth scaling, CR-banded corpse loot (SRD-1307), run scoring, graveyard records,
daily seeds, and draft parties. Measured reality (Nov 2026) is thinner:

- 20 depth-1 seeds yield **39 distinct encounter compositions** — the shuffle works.
- But only **7 monsters** exist at depths 1–3 (shrinking to 3–4 deeper), biomes are
  **fixed bands** (1–3 always catacombs), rooms are a fixed count per depth, the
  shrine catalog has **3 entries**, and there are **no elites, no world options,
  no special rooms, and no persistence between runs** (graveyard records scores only).
- The 61-monster bundle is 90% unused by the generator.
- Estimated novelty budget: **10–20 delves** before déjà vu.

This spec closes that gap in four independently shippable phases: **breadth**
(use the whole roster), **shape** (world options + special rooms, Civ-style),
**memory** (veteran heroes, MoM-style), and a **verification gate** that measures
variety instead of asserting vibes.

## 2. Current-State Audit (measured, not estimated)

| Layer | Today | Source |
| :--- | :--- | :--- |
| Regular pool, depths 1–3 | 7 ids | `generator.ts` catacombs theme |
| Regular pool, depths 4–6 / 7–9 / 10–12 / 13+ | 7 / 4 / 4 / 4 ids | biome themes |
| Boss pool per biome | 8–9 ids (healthy) | biome themes |
| Bundle utilization | ~15 of 61 monsters in regular tables | `monsters.json` (61 total) |
| CR spread in bundle | 0.125 (6) → 17 (1); 27 monsters at CR ≤ 1 | `monsters.json` |
| Encounter size | 1–2 regulars, 1–2 boss-room | `generator.ts` encounter gen |
| Shrine catalog | 3 (`blood_god`, `arcane_weave`, `fountain_restoration`) | generator + `roguelite.ts` |
| Elites / world options / special rooms / veterans | none | — |
| Graveyard | score record only | `roguelite.ts` run record |

## 3. CR-Banded Biome Encounter Tables (`@srd5/data`, `@srd5/engine`)

Replace hand-picked per-biome id lists with **CR-band tables over the full
61-monster roster**, keeping curated boss tables untouched.

- Bands (from the measured bundle spread): depths 1–3 → CR 0–1 (**27** candidates);
  4–6 → CR 1–3 (21); 7–9 → CR 3–5 (13); 10–12 → CR 5–9 (13); 13+ → CR 8+ (8).
  Bands overlap at edges so depth transitions never cliff.
- Table entries carry weights (common/uncommon/rare within band) plus
  **exclusion tags** for misfits (e.g., aquatic-only, legendary actions that
  assume lairs — keep the table honest, no reflavoring).
- Selection stays dice-driven: `pickFromBand(rng, depth)` in the generator;
  boss rooms keep today's curated `bossMonsters` lists.
- Integrity: every table id must resolve in the compendium (extends the
  SRD-1212/SRD-1304 gates); a distribution test asserts every table monster is
  reachable within N seeds and no depth band is empty.
- Arena PvE waves and Realm delve spawns may draw from the same bands where
  their current pools overlap (free variety, no behavior change).

## 4. Elite Packs — Champion Stacks (`@srd5/engine`, `@srd5/client`)

MoM guardian stacks, not Diablo affix bingo: a deterministic champion template
applied post-spawn, before initiative.

- Spawn chance: **8% + 2% per depth, capped at 25%**, never on depth 1
  (first floor stays a fair onboarding fight). One champion per encounter max.
- Template: max HP ×1.5 (rounded), +2 to hit, +25% damage (rounded down),
  plus one trait rolled on the run/floor seed — **brutal** (+50% damage instead
  of +25%), **swift** (+10 ft speed, advantage on initiative), **warded**
  (+2 AC). Traits are existing mechanics recombined, never new rules.
- Presentation: skull badge on the token + tooltip line
  (`Champion · brutal — +50% damage`), combat-log headline on spawn.
- Rewards hook into the existing SRD-1307 elite hoard path (origin-tagged),
  so champions are worth hunting, not avoiding.
- Tests: template math headless, spawn-rate bounds over seeds, badge render
  client test, E2E smoke (champion visible + killable at 1280×800).

## 5. World-Generation Options — the Civ Setup Screen (`@srd5/engine`, `@srd5/client`)

No mutator draft. At Realm/Descent setup, a Civ-style options row (seeded,
replay-stable, stored on the session, shown in the HUD banner + run record +
graveyard so scores compare like-for-like):

- **World scope** — map/floor scale: standard (today's sizes) or grand (+50%
  rooms/tiles, +1 encounter per floor budget).
- **Wildness** — encounter density: calm (0.75×) / standard / wild (1.5×).
- **War intensity** (Realm) — rival nations 2 / 3–4 / 5 with aggression tick
  scaling to match.
- **Scarcity** — loot rolls and ration consumption: abundant / standard / scarce.
- **Seed** — manual entry + daily seed, rolled visibly.
- Rules: options are chosen pre-launch, never mid-run (no gotchas); defaults
  reproduce today's generation exactly (replay-safe baseline).
- Tests: each option's mechanical effect headless, setup UI states, HUD banner
  client test.

## 6. Special Rooms & Delve Events — Lairs and Goody Huts (`@srd5/engine`, `@srd5/client`)

At most **one special room per floor** (seeded pick, never on depth 1):

- **Treasure vault** — locked room (DC 15–20 by depth) holding a hoard chest
  with a magic-item bias; trapped 50% (reuse trap + chest pipelines).
- **Cursed shrine** — 4th `shrineType`: pay 10 HP or 50 gp for a seeded boon
  drawn from the blood/arcane tables (cost shown before commit, decline free).
- **Nest** — high-density pack room (3–5 of one band monster, bonus XP via
  the existing award path); telegraphed by sound text on Listen (ties to
  SRD-511: nests are listenable).
- Presentation reuses the prop pipeline: canvas glyphs, interaction card,
  fog-of-war behavior identical to existing props. No new art.
- Tests: ≤1 per floor invariant, vault/chest/shrine/nest generation headless,
  card flows client-tested, E2E smoke (open a vault).

## 7. Veteran Roster — Heroes Remembered (`@srd5/engine`, `@srd5/client`)

MoM heroes meet the campfire: living heroes at a run's conclusion (Descent
`endRogueliteRun`, Realm dominance victory) with total level ≥ 3 may **retire**
into a persistent veteran roster instead of vanishing into the graveyard.

- Storage: full `CharacterBuildState` snapshots in the existing delve IndexedDB
  store (same offline persistence as saves); cap 8 veterans, FIFO with a
  confirm-to-release row.
- Recruitment: veterans appear in the campfire assembly (SRD-603 vault/seat
  machinery) with a gp hire cost scaling by level; they deploy as ordinary
  party members — no scaling power beyond what leveling already gives.
- Rules: level-capped at entry (no epic veterans), costs keep level-1 starts
  competitive, all offline and deterministic (snapshots are data).
- Events: `VETERAN_RETIRED { heroId, level }` / `VETERAN_RECRUITED { heroId }`.
- Tests: threshold + cap logic headless, persistence round-trip, assembly UI
  states (locked/available/hired).

## 8. Commands / Events

No new mid-run player commands — the in-run game stays pure. Setup/retirement
flow only, plus:

- `ELITE_SPAWNED { entityId, trait }` (combat log + badge).
- Setup options ride the existing run/session payloads (HUD + record + graveyard).
- `VAULT_OPENED / SHRINE_CURSED / NEST_CLEARED` (reuse `LOOT_ACQUIRED` and
  prop events where possible; prefer existing events over new ones).
- `VETERAN_RETIRED { heroId, level }` / `VETERAN_RECRUITED { heroId }`.

## 9. Phased Delivery Map

Phase 1 = breadth (SRD-1401 tables, 1402 champions). Phase 2 = shape (1403
world options, 1404 special rooms). Phase 3 = memory (1405 veterans).
Phase 4 = proof (1406 variety gate). Every ticket ships independently behind
the same offline green gate.

## 10. Non-Goals

- No procedural campaign: Kaelen stays fixed (story mode is a feature).
- No new monsters: 61 is plenty once bands use all of it.
- No run mutators, no unlock trees: wrong genre (see §0).
- No cross-run power creep: veterans are level-capped conveniences with hire costs.
- No economy redesign, no LLM director (still parked), no new art assets.
