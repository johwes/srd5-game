# 09 — Content Library Expansion & Remix Modes Specification

## 1. Scope Rule: What May Grow and What May Not

The dataset's licensing gates decide the expansion surface — not taste:

| Dataset | Gate | Status | Expandable? |
| :--- | :--- | :--- | :--- |
| Races (9), Classes (12), Subclasses (12) | Closed allowlist | Complete | **No** |
| Backgrounds (`acolyte`), Feats (`grappler`) | Closed allowlist | Complete | **No** |
| Monsters (30 bundled) | Prohibited-PI blocklist only | Partial | **Yes** |
| Spells (139 bundled, L0–L9) | PI rename map | Partial | **Yes, after audit** |
| Magic items (26), Equipment (175) | Schema + cross-refs | Partial | **Yes, opportunistically** |

Consequences:
- **No new feats, backgrounds, subclasses, or races.** Ever, under SRD 5.1 scope.
  Build variety comes from multiclassing, ASI choices, equipment, magic items,
  party composition (1–4 heroes), and difficulty presets — all already shipped.
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

## 6. Explicit Non-Goals

- No new feats, backgrounds, subclasses, races, or player options of any kind
  (allowlist-closed; would breach SRD scope).
- No new binary art assets (see §2).
- No handcrafted campaign modules in this epic (Kaelen stays the tutorial;
  handcrafted arcs belong with quest content, not the library).
- No AI/LLM director dependency — see [ROADMAP.md](../../ROADMAP.md); this
  epic is what makes the library worth directing later.
