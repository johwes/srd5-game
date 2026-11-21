# 12 — Graphical Inventory (BG3-Style Equipment Experience) Specification

## 1. Overview

End state: a Baldur's Gate 3-style graphical inventory — an icon-grid backpack
beside a visual paperdoll — replacing the current text-list equipment surfaces,
with zero hand-drawn art. All graphics come from public-domain or permissively
licensed third-party icon sets (Section 2). Delivery is phased so every phase
is independently shippable (Section 10).

Non-negotiable invariants:

- **Offline-first.** Every icon ships in the bundle (npm font and/or vendored
  SVG). No runtime CDN fetches; `pnpm build` + `pnpm test` pass with no network.
- **SRD-only content.** New item *data* is SRD 5.1 only (never Product Identity).
  Third-party *art* is generic iconography, not game content — no SRD conflict.
- **Deterministic engine.** Consumable use, charges, and recharge resolve
  through seeded engine code (`@srd5/engine`), never UI-side `Math.random()`.
- **Transport boundary.** Equip/use/attune go through `GameCommand`s; the UI
  never mutates authoritative state directly.

## 2. Art Sourcing & Licensing

| Source | Contents | License | Use in this project |
|---|---|---|---|
| RPG Awesome (`rpg-awesome` npm) | 495 fantasy icons as a webfont (weapons, armor, shields, potions, staves, spell effects) | Font: SIL OFL 1.1 · CSS: MIT · "attribution appreciated but not required" | **Primary item-icon system.** `<i class="ra ra-sword">`, recolored via CSS for rarity tiers |
| game-icons.net | 4,000+ SVG icons (Weapon 174, Blade/Sword/Knife 126, potions, tools, armor…) + in-browser recolor Studio | CC BY 3.0 (a few contributors CC0) | **Gap filler.** Cherry-picked SVGs vendored into the repo for items RPG Awesome lacks |
| Kenney.nl (UI Pack RPG Expansion, Fantasy UI Borders) | Panel frames, buttons, 9-slice borders | CC0 — no attribution | **Panel chrome** for the BG3-style inventory frame (optional polish) |
| Dungeon Crawl Stone Soup tiles (~6,000) | Full-color 32px item/monster art | **Mixed / uncertain** (`TILES_UNDER_UNKNOWN_LICENSE.md`, unmaintained since 2020) | **Do not adopt wholesale.** Cherry-pick only with per-tile license proof (in practice: avoid) |

Attribution: add one line to the existing credits screen (which already
carries the SRD CC-BY-4.0 notice):
`Item icons: game-icons.net contributors (CC BY 3.0); RPG Awesome (OFL/MIT);
UI frames: Kenney.nl (CC0)`.
RPG Awesome's upstream was curated from game-icons CC-BY art, so crediting
game-icons covers the full chain under the strictest reading.

## 3. Icon Registry Architecture (`@srd5/client`)

A single client-side registry maps every canonical item id to an icon:

```ts
// packages/client/src/components/inventory/itemIcons.ts
export interface ItemIconRef {
  /** RPG Awesome class suffix, e.g. 'broadsword' -> `ra ra-broadsword`. */
  ra?: string;
  /** Vendored game-icons SVG path (under src/assets/icons/), e.g. 'potion.svg'. */
  svg?: string;
  /** Fallback category glyph when neither resolves. */
  fallback: 'weapon' | 'armor' | 'potion' | 'gear' | 'tool';
}
export function getItemIcon(itemId: string): ItemIconRef;
```

Rules:

- Registry **must cover 100%** of `equipment.json` + `magic-items.json` ids
  (exhaustiveness unit test against `defaultCompendium`).
- Unknown ids fall back to the category glyph and log once (never a broken
  `<img>` / tofu box in the UI).
- Long term the mapping may migrate into data as an optional `icon` field on
  the equipment/magic-item schemas; the client registry is the seam — callers
  use `getItemIcon`, never raw `ra-` classes.

## 4. Item Tooltips (`ItemTooltipCard`)

Mirror the SRD-1215 `SkillTooltipCard` pattern (`role="tooltip"`,
`aria-describedby`, `group-hover` reveal, `<prefix>-tooltip-<id>` testids):

- Header: item name + rarity badge + category/attunement line.
- Body: SRD description.
- "Game effect" box (emerald): human summary of `modifiers[]` /
  `activatedAbilities[]` (reuse the flat-bonus/effect summarizers where they
  exist; add an item-specific summarizer if needed).
- Footer: charges (`3/7, recharge 1d6+1 at dawn`), attunement state,
  cost/weight.

## 5. Rarity Visual Language

One mapping, applied everywhere an item renders (loot rows, shop rows,
paperdoll slots, backpack cells, compendium):

| Rarity | Border / glow | Text |
|---|---|---|
| common / mundane | slate-700, none | slate-300 |
| uncommon | emerald-500/60, soft glow | emerald-300 |
| rare | sky-400/70, glow | sky-300 |
| very rare | purple-400/70, strong glow | purple-300 |
| legendary | amber-400, strong glow + ✨ | amber-300 |
| artifact | red-400 animated pulse | red-300 |

## 6. Consumables Engine Path (`@srd5/engine`)

Implement the declared-but-unhandled `USE_ITEM { actorId, itemInstanceId,
targetId? }` reducer case with seeded resolution:

- Potions / antitoxin / healer's-kit-style gear: apply `heal` /
  `apply_active_effect` overlays through the existing `ActivatedAbilitySpec`
  pipeline (action economy enforced by the caller).
- Acid / alchemist's fire: resolve the overlay `attack_roll → deal_damage`
  chain at the target.
- Scrolls: consume the scroll to cast the inscribed spell through
  `DECLARE_CAST_SPELL` internals (slot-free, DC from item/scroll level rule).
- Wands/staffs: execute the charge ability, decrement `chargesRemaining`,
  enforce `charges > 0`; recharge `rechargeFormula` at `dawn` (long rest) up
  to `max`.
- Emit `ITEM_CONSUMED` / `CHARGES_CHANGED` events for log + HUD updates.

## 7. Data Expansion (SRD 5.1 only)

- **Revive the 4 dead entries** with SRD-faithful mechanics:
  `flame-tongue` (bonus fire damage rider), `periapt-of-wound-closure`
  (stabilize / death-save behavior via `condition_immunity` or ability),
  `bag-of-holding` (container capacity note), `scroll-of-fireball`
  (consumable cast).
- **Exercise unused DSL targets** with SRD items: at least `spell_save_dc` /
  `spell_attack` (casting-focus style), `damage_mitigation`
  (resistance-granting item), and `hp_per_level` or `grant_resource`
  (extra-survivability / extra-slot item). Verify every addition against the
  SRD 5.1 PDF text — Product Identity items (e.g. named WotC artifacts) are
  out of scope, always.
- Keep `modifiers: []` + no-ability entries out: extend the SRD-1212
  relevance gate to reject magic items with empty modifiers *and* no
  activated abilities.

## 8. BG3 Grid UI (`@srd5/client`)

End-state layout (single `InventoryView`, reachable from dungeon HUD, pause
menu, and sheet equipment tab):

- **Left: visual paperdoll** — the 5 engine slots (armor, shield, main/off hand,
  ranged) rendered as large icon slots with rarity borders; click to
  inspect (tooltip card), click-then-click or drag to unequip; attunement
  pips on attuned items. Deliberately *not* BG3's wider slot spread (no
  helm/cloak/ring/boot slots in v1): rings, cloaks and other wondrous items
  keep working passively from inventory while attuned, per current engine
  behavior; extra body slots are future work, not this Epic.
- **Right: backpack grid** — icon cells with stack counts, rarity borders,
  type filters (All / Weapons / Armor / Potions / Scrolls / Tools), text
  search; click = tooltip + action bar (Equip / Use / Attune / Drop-info);
  drag onto paperdoll slots where feasible (HTML5 drag *or* click-to-equip
  must both work — touch/Steam Deck constraint).
- **Compare view**: hovering/equipping a candidate shows delta vs equipped
  (`+1 AC`, `-1 to-hit`) inline in the tooltip.
- Camp-supply / currency strip and encumbrance *display* (weight total;
  enforcement stays out of scope — see §12).
- Full keyboard + gamepad/Deck navigation parity: every grid action reachable
  by focus + Enter, mirroring existing HUD patterns.

## 9. Commands / Events

`USE_ITEM` already declared — implement per Section 6. No new commands for
phases 1–2 (equip/attune paths unchanged; UI only). The grid phase reuses
`EQUIP_LOADOUT` / `ATTUNE_ITEM` / `USE_ITEM`. Future trade/drop/give/identify
commands are explicitly phase-4 stretch (§10).

## 10. Phased Delivery Map

| Phase | Backlog | Content |
|---|---|---|
| 1 — Icon + rarity layer | SRD-1301, SRD-1302 | Registry, fonts/SVG vendoring, credit line, rarity CSS, tooltips, compendium modifier display |
| 2 — Items that work | SRD-1303, SRD-1304, SRD-1307 | `USE_ITEM`, charges/recharge, revive dead entries, unused-DSL items, CR-scaled monster drops + skill-influenced loot |
| 3 — BG3 grid | SRD-1305 | `InventoryView` grid + paperdoll, compare, filters, E2E |
| 4 — Stretch | SRD-1306 | Trade/drop/give, identification, dungeon sell-back, encumbrance/enforcement |

## 11. CR-Scaled Monster Loot Drops & Skill-Influenced Rewards

Status quo (gap): monsters drop nothing on death. Loot enters play only via
props/chests (`claimPropLoot`), war-battle awards (`awardLootToCharacter`),
and shops — even though every monster already carries `challengeRating` and
CR-banded treasure tables (`MAGIC_ITEM_TABLE_A..I`, `rollIndividualTreasure`,
`rollTreasureHoard`) exist. This section closes that gap and ties loot into
the Epic 12 skill-reward work (recall `trap_bonus` rewards, standing skill
passives, diplomacy deal tiers).

### 11.1 CR-scaled drops

- On encounter clear (all hostiles defeated), roll per-slain-monster
  individual treasure via `rollIndividualTreasure(cr, seed)` using DMG-style
  CR bands (0–4 / 5–10 / 11–16 / 17+); elites/bosses additionally roll on
  `rollTreasureHoard` at a CR-derived tier.
- Deterministic: seeds thread from the combat/encounter seed (never UI-side
  randomness). Each drop list attaches to the slain monster's corpse record
  (see §11.2) — never into an anonymous pool — with per-monster provenance in
  the Combat Log.
- No double-dip: the war-battle award path stays authoritative for war
  missions; drops carry an origin tag so both paths never stack on the same
  kill.

### 11.2 Looting corpses: movement, occupancy & clicks

Corpses are lootable terrain, not creatures (5e/BG3 rules):

- **Occupancy**: add `isDead?: boolean` to `GridCreature`; dead creatures are
  non-blocking for traversal *and* for end-of-move in `canEndMoveAt` /
  `findPath`, in combat and exploration alike. A hero may stand on, end a
  turn on, and path through corpse cells at normal cost. (Status quo this
  fixes: `GridCreature` has no dead flag, so fallen bodies block like walls.)
- **Click priority**: living tokens render above corpses (already true) and
  keep click priority — clicking a stacked cell selects/moves the hero.
  Clicking the corpse token itself (which stops swallowing the event only
  when it holds unclaimed loot) opens the per-corpse loot card. Fully-looted
  corpses stay inert and unclickable, as today.
- **Loot action**: reuse the prop-claim pipeline — corpses behave as
  `INTERACT_PROP` targets of a `corpse` kind claimed via the existing
  `claimPropLoot` flow, opening a per-corpse card with Take / Take All +
  recipient select, stacking, and events. No new commands.
- **Range (v1)**: any conscious party member may search any revealed corpse
  on the floor — party-level abstraction, consistent with the existing
  party-wide passive-perception checks in `EXPLORE_MOVE`. A proximity rule
  (adjacent looter, auto-walk-into-range) is an explicit follow-up, not v1.
- **Sweep**: corpses persist across encounters as battlefield remains, so
  leaving the floor (or a "loot all nearby" action) auto-collects unclaimed
  drops into the party — loot is never silently lost on forgotten bodies.

### 11.3 Skill-influenced loot

Loot-time skill hooks, resolved deterministically and attributed in the UI so
players see the skill matter (extends the SRD-1211 badging philosophy):

- **Investigation** (search the fallen / the room): meet a DC → bonus
  hoard-table roll or concealed-cache reveal. Stacks with recall
  `trap_bonus` reveals, never replaces them.
- **Survival / Nature** (harvest): beasts/monstrosities yield harvest goods.
  Stacks with the standing Nature forage bonus (SRD-1213).
- **Diplomacy deal tiers** (SRD-1209/1214) may scale negotiated mission
  rewards; the Religion potion synergy (SRD-1213) already rewards potion use.
- Attribution lines in the loot UI (e.g. `Keen Eye (Investigation): +1 hoard
  roll`). Same-type bonuses never stack; expertise counts double per the
  standing-passive convention where applicable.

## 12. Non-Goals

- Hand-drawn or AI-generated art (license risk + style drift).
- DCSS tile adoption without per-tile license proof.
- Weight/encumbrance *enforcement*, item durability, crafting, socketing.
- Player-to-player trading UI beyond the SRD-1306 stretch basics (give/drop).
- Extra paperdoll body slots (helm/cloak/rings/boots) — v1 mirrors the 5 engine slots.
