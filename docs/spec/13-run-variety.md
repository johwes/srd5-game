# 13 — Run Variety (Endless Uniqueness) Specification

## 1. Overview

The engine already supports endless replay on paper: seeded procedural floors,
depth scaling, CR-banded corpse loot (SRD-1307), run scoring, graveyard records,
daily seeds, and draft parties. Measured reality (Nov 2026) is thinner:

- 20 depth-1 seeds yield **39 distinct encounter compositions** — the shuffle works.
- But only **7 monsters** exist at depths 1–3 (shrinking to 3–4 deeper), biomes are
  **fixed bands** (1–3 always catacombs), rooms are a fixed count per depth, the
  shrine catalog has **3 entries**, and there are **no elites, no run modifiers,
  no special rooms, and no meta-progression** (graveyard records scores only).
- The 61-monster bundle is 90% unused by the generator.
- Estimated novelty budget: **10–20 delves** before déjà vu.

This spec closes that gap in four independently shippable phases: **breadth**
(use the whole roster), **run shape** (mutators + special rooms), **meta**
(unlocks that change future runs), and a **verification gate** that measures
variety instead of asserting vibes. The Kaelen campaign stays a fixed story
module by design — this epic targets Deep Descent / Endless Delve (and shares
tables with Arena waves and Realm delves where free).

Non-negotiables carried over from every epic: seeded determinism (bit-exact
replay per seed), no `Math.random()` in `@srd5/engine`, SRD 5.1-only content,
offline build/test green.

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
| Elites / mutators / special rooms / meta unlocks | none | — |
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

## 4. Elite Packs (`@srd5/engine`, `@srd5/client`)

A deterministic elite template applied post-spawn, before initiative:

- Spawn chance: **8% + 2% per depth, capped at 25%**, never on depth 1
  (first floor stays a fair onboarding fight).
- Template: max HP ×1.5 (rounded), +2 to hit, +25% damage (rounded down),
  plus one affix rolled on the run/floor seed — **brutal** (+50% damage instead
  of +25%), **swift** (+10 ft speed, advantage on initiative), **warded**
  (+2 AC). One elite per encounter max.
- Presentation: skull badge on the token + tooltip line
  (`Elite · brutal — +50% damage`), combat-log headline on spawn.
- Rewards hook into the existing SRD-1307 elite hoard path (origin-tagged),
  so elites are worth hunting, not avoiding.
- Tests: template math headless, spawn-rate bounds over seeds, badge render
  client test, E2E smoke (elite visible + killable at 1280×800).

## 5. Seeded Run Mutators (`@srd5/engine`, `@srd5/client`)

Drawn once at run start from the **run seed** (replay-stable), stored on
`runState.mutators`, shown in the run HUD banner and the final run record:

- Draw: 0 mutators 15% / 1 mutator 60% / 2 mutators 25%.
- Launch catalog (6, all implemented with existing systems):
  1. **Dim Torches** — bright/dim radii halved (lighting system).
  2. **Thin Rations** — ration consumption ×2 (supply tension).
  3. **Blood Moon** — everyone crits on 19–20 (attack pipeline).
  4. **Bountiful Crypt** — +1 loot roll per corpse, +1 monster per encounter.
  5. **Sealed Doors** — all doors start locked, DC +2 (prop system).
  6. **Restless Dead** — undead encounters +1 monster, short rests risk ambush +25%.
- Rules: mutators never stack the same entry twice; mutators are announced
  pre-launch (no gotchas); daily seed rolls its own mutators visibly.
- Tests: draw distribution over seeds, each mutator's mechanical effect
  headless, HUD banner client test.

## 6. Special Rooms & Delve Events (`@srd5/engine`, `@srd5/client`)

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

## 7. Descent Meta-Progression (`@srd5/engine`, `@srd5/client`)

Graveyard bests unlock future runs (bounded — flavor and options, never
trivialization), persisted in the existing delve IndexedDB store:

- **Depth ≥ 5 best** → starting-boon draft: pick 1 of 3 seeded boons at run
  launch (extra healing potion, antitoxin + torch-equivalent light edge,
  50 gp purse). Boons are launch-only inventory/currency grants.
- **Score thresholds** → new draft-party templates (2–3 curated thematic
  quartets reusing existing pregen/draft machinery).
- UI: unlock row on the Endless Delve launch tile (locked/unlocked with
  requirement text), toast on first unlock, all offline.
- Tests: threshold logic headless, persistence round-trip, launch UI states.

## 8. Commands / Events

No new player commands except mutator/boon **selection at launch** (run-setup
payload, not mid-run verbs — the in-run game stays pure). New events:

- `ELITE_SPAWNED { entityId, affix }` (combat log + badge).
- `MUTATORS_DRAWN { mutatorIds }` (run record + HUD).
- `VAULT_OPENED / SHRINE_CURSED / NEST_CLEARED` (reuse `LOOT_ACQUIRED` and
  prop events where possible; prefer existing events over new ones).
- `BOON_UNLOCKED { boonId }` / `TEMPLATE_UNLOCKED { templateId }` (graveyard).

## 9. Phased Delivery Map

Phase 1 = breadth (SRD-1401 elites tables… see BACKLOG): 1401 tables,
1402 elites. Phase 2 = run shape: 1403 mutators, 1404 special rooms.
Phase 3 = meta: 1405 unlocks. Phase 4 = proof: 1406 variety gate.
Every ticket ships independently behind the same offline green gate.

## 10. Non-Goals

- No procedural campaign: Kaelen stays fixed (story mode is a feature).
- No new monsters: 61 is plenty once bands use all of it.
- No cross-run power creep: boons are launch conveniences, capped and flat.
- No economy redesign, no LLM director (still parked), no new art assets.
