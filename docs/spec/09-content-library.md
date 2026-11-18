# 09 — Content Library Expansion & Remix Modes Specification

## 1. Scope Rule: What May Grow and What May Not

The dataset's licensing gates decide the expansion surface — not taste.
Authoritative backing (official SRD FAQ, dndbeyond.com/srd): the SRD ships a
single background and a single feat *on purpose* — "The goal of the SRD is to
allow users to create new content, not to replicate the text of the whole
game. We encourage players, DMs, and publishers to come up with their own
backgrounds and feats." Missing spells/monsters follow stated criteria (3E
SRD lineage, 5e equivalents, vital-to-function), e.g. *Delay Poison* is
absent because *Protection from Poison* covers it — so "complete coverage"
means matching the SRD PDFs, not the whole game.

| Dataset | Gate | Status | Expandable? |
| :--- | :--- | :--- | :--- |
| Races (9), Classes (12), Subclasses (12) | Closed allowlist | Complete | **No** |
| Backgrounds (`acolyte`), Feats (`grappler`) | Closed allowlist | Complete | **No** |
| Monsters (30 bundled) | Prohibited-PI blocklist only | Partial | **Yes** |
| Spells (139 bundled, L0–L9) | PI rename map | Partial | **Yes, after audit** |
| Magic items (26), Equipment (175) | Schema + cross-refs | Partial | **Yes, opportunistically** |

Consequences:
- **Verbatim SRD datasets stay frozen where allowlisted.** Races, classes,
  subclasses, backgrounds, and feats beyond the allowlists are not added as
  "SRD content". The single-example entries (one feat, one background, one
  subclass per class) are structural templates by design — they show creators
  the shape to build their own, not a catalog to complete. Build variety on
  the SRD side comes from multiclassing, ASI choices, equipment, magic items,
  party composition (1–4 heroes), and difficulty presets — all already shipped.
- **Never copy or closely paraphrase closed official content.** Non-SRD
  subclasses, feats, backgrounds, monsters, and spells from official books
  must not be reproduced or thinly reworded. Homebrew means original design
  on shared mechanics; the PI screen plus human review in every authoring
  ticket enforce this.
- **Original homebrew is allowed on a separate, labeled track** (Spec §7).
  Game mechanics are not protected expression; new feats, backgrounds,
  subclasses, monsters, and spells written in original words, using SRD
  mechanics, with no Product Identity, are compliant under CC-BY-4.0 (with the
  statutory attribution the repo already carries). Homebrew records carry
  `source: "homebrew"` provenance so purists can filter to SRD-only.
- **SRD 5.1 scope only — no 5.2 mixing.** Although both documents are
  CC-BY-4.0, SRD 5.2 (2024 rules) mechanics differ from this engine's 5.1 base
  (revised classes, weapon masteries, background feats). Pulling 5.2 content
  would fork the ruleset; stay on 5.1 + original homebrew.
- **Monster and spell roster growth is the highest replay-value work in the
  repo**: every generator (dungeon, Descent, Realm, arena pools), every biome
  table, and the tactical AI consume statblocks generically, so each new entry
  multiplies across all game modes with zero engine changes.
- Every addition must pass the existing gates unchanged: Zod schemas,
  cross-reference checks, Product Identity blocklist, and the bundled
  `srd-bundle-integrity` suite. The first step of any wave ticket is always an
  **audit**: inventory the bundled set against the SRD 5.1 text and propose the
  roster before authoring a single statblock.

---

## 2. Art Policy: Zero New Assets

Sprites are the hardest asset to create, so the art budget for all content
work is **zero new files**. The 3-tier asset pipeline already guarantees this:

- **Tier 0 — keyword reuse (preferred).** The `MONSTER_NAME_KEYWORD_MAP` and
  hero-class matching resolve most humanoids, beasts, undead, and NPCs to
  existing Kenney frames automatically. Audit-verified reusable families:
  goblinoids, orcs, skeletons/zombies/ghouls, spiders, bats, rats, wolves,
  slimes, dragons, demons, ghosts, cultists, ogres, hobgoblins, bugbears, plus
  guards/knights/mages/priests via `hero_*` frames.
- **Tier 1 — new atlas mappings, no new files.** The packed atlas contains
  identified-but-unmapped tiles, verified against `tilemap_packed.png`
  (col,row). New `KENNEY_SPRITE_FRAMES` entries + keyword hits only:
  - Knight / veteran / guard captain → `(0, 8)` (armored knight)
  - Armsman / thug → `(2, 8)` (brown-haired fighter)
  - Noble / priestess → `(3, 8)` (woman in purple)
  - Elder / evil mage → `(4, 8)` (staff elder)
  - Scout / hunter → `(4, 9)` (headband ranger)
- **Tier 2 — procedural fallback (explicitly listed).** Truly alien types with
  no Kenney likeness (aberrations, elementals, oozes beyond the slime tile,
  plants) ship on procedural monogram tokens. Each wave ticket must list which
  entries use Tier 2 — no silent fallbacks.
- **Acceptance rule per wave:** every new monster resolves to Tier 0/1, or is
  named in the ticket's Tier 2 list with a reason. The asset-pipeline test
  suite must stay green with zero new binary assets.

---

## 3. Monster Authoring Checklist (per statblock)

Each monster ships as a unit, to the SRD-310 executable-effect bar:

1. **Statblock JSON**: AC, HP dice, speed, abilities, saves, skills, senses
   (incl. darkvision where SRD-granted), damage resistances/immunities,
   condition immunities, CR-correct proficiency math.
2. **Effect DSL overlays**: every trait and attack executable where the DSL
   allows (Pack Tactics, Nimble Escape–style reactions, breath weapons with
   recharge, multiattack sequences); `manual_adjudication` only where the
   engine genuinely cannot express the mechanic, with a stated reason.
3. **AI archetype tag**: one of `brute | skirmisher | artillery | controller |
   support` so the SRD-401 planner uses it correctly on spawn.
4. **Biome/table wiring**: entry(s) in the procedural encounter tables
   (dungeon biomes by depth tier, Realm wandering tables, arena monster pools).
5. **Headless test**: spawn → attack/save pipeline → damage math, verified
   deterministically like every SRD-310 Tier A entry.
6. **Sprite mapping**: Tier 0 keyword or Tier 1 frame from §2, or Tier 2
   listing with reason.

---

## 4. Spell Gap-Fill Process

1. Audit bundled 139 against SRD 5.1 coverage by level (L0–L9 curve already
   healthy at low levels; gaps concentrate at high levels).
2. Author missing spells with executable Effect DSL to the SRD-306 bar
   (slots, scaling, bonus-action rule, concentration, saves vs attack rolls).
3. Same per-spell headless tests and no-new-assets rule (schools already have
   game-icons.net icons).

---

## 5. Remix Modes (Zero New Content)

New ways to play the existing library, each a small client+engine ticket:
- **Daily Descent**: one shared seed per day, one attempt, leaderboard-style
  run scoring against your own graveyard history.
- **Draft Party**: random-rolled heroes (seeded `4d6kh3` + random class) for
  roguelite runs — replays the builder's randomness as a game mode.
- **Boss Rush**: consecutive CR-escalating boss encounters with breathers,
  reusing arena wave plumbing and the delve scorer.
- (Later) **NG+ depth scaling**: endless tiers past 13+ with score multipliers.

---

## 7. Original Homebrew Track (SRD-Compatible Creation)

Verbatim SRD datasets stay frozen at their allowlists (§1). Separately,
**original** feats, backgrounds, subclasses, monsters, spells, and magic items
may be authored against SRD mechanics: mechanics are not protected expression,
so new content written in original words, with zero Product Identity, is
compliant under the repo's existing CC-BY-4.0 attribution.

Rules for the homebrew track:
- **Provenance is mandatory.** Every homebrew record carries
  `source: "homebrew"` (vs `"srd-5.1"`), set at authoring time. The compendium
  exposes the filter so purists and automated checks can select SRD-only sets;
  the integrity suite asserts every record has a valid source.
- **Product Identity screening is a gate, not a guideline.** New text is
  checked against the existing blocklists (PI monsters, proper names,
  setting references) plus a human review flag in the authoring ticket. No
  beholders, mind flayers, named spells (`Bigby's`, `Mordenkainen's`, …),
  settings, or copied PHB wording — mechanics only, original expression.
  Closed official content must never be copied **or closely paraphrased**;
  when in doubt, redesign the mechanic rather than reword it.
- **Same quality bar as SRD content.** Homebrew statblocks follow the §3
  checklist (executable overlays, AI archetype, headless tests); homebrew
  spells follow §4; homebrew feats/backgrounds ship with formulae tooltips and
  builder integration tests like any other option.
- **No 5.2 mechanics.** Homebrew builds on the 5.1 base only.

---

## 8. Explicit Non-Goals

- No new *verbatim-SRD* feats, backgrounds, subclasses, or races beyond the
  allowlists (see §7 for the homebrew path instead).
- No SRD 5.2 material of any kind (rules coherence; see §1). This is a
  conscious refusal, not an oversight: SRD 5.2 adds 15 feats, 3 backgrounds,
  20 spells, and 17 monsters under the same CC-BY-4.0 license (per the
  official SRD FAQ), and mixing versions is explicitly permitted — but 5.2
  mechanics belong to the 5.5e ruleset and would fork this engine's 5.1 base.
- No new binary art assets (see §2).
- No handcrafted campaign modules in this epic (Kaelen stays the tutorial;
  handcrafted arcs belong with quest content, not the library).
- No AI/LLM director dependency — see [ROADMAP.md](../../ROADMAP.md); this
  epic is what makes the library worth directing later.
