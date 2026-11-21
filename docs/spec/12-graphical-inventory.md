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

- **Left: visual paperdoll** — 5 engine slots (armor, shield, main/off hand,
  ranged) rendered as large icon slots with rarity borders; click to
  inspect (tooltip card), click-then-click or drag to unequip; attunement
  pips on attuned items.
- **Right: backpack grid** — icon cells with stack counts, rarity borders,
  type filters (All / Weapons / Armor / Potions / Scrolls / Tools), text
  search; click = tooltip + action bar (Equip / Use / Attune / Drop-info);
  drag onto paperdoll slots where feasible (HTML5 drag *or* click-to-equip
  must both work — touch/Steam Deck constraint).
- **Compare view**: hovering/equipping a candidate shows delta vs equipped
  (`+1 AC`, `-1 to-hit`) inline in the tooltip.
- Camp-supply / currency strip and encumbrance *display* (weight total;
  enforcement stays out of scope — see Section 11).
- Full keyboard + gamepad/Deck navigation parity: every grid action reachable
  by focus + Enter, mirroring existing HUD patterns.

## 9. Commands / Events

`USE_ITEM` already declared — implement per Section 6. No new commands for
phases 1–2 (equip/attune paths unchanged; UI only). The grid phase reuses
`EQUIP_LOADOUT` / `ATTUNE_ITEM` / `USE_ITEM`. Future trade/drop/give/identify
commands are explicitly phase-4 stretch (Section 11).

## 10. Phased Delivery Map

| Phase | Backlog | Content |
|---|---|---|
| 1 — Icon + rarity layer | SRD-1301, SRD-1302 | Registry, fonts/SVG vendoring, credit line, rarity CSS, tooltips, compendium modifier display |
| 2 — Items that work | SRD-1303, SRD-1304 | `USE_ITEM`, charges/recharge, revive dead entries, unused-DSL items |
| 3 — BG3 grid | SRD-1305 | `InventoryView` grid + paperdoll, compare, filters, E2E |
| 4 — Stretch | SRD-1306 | Trade/drop/give, identification, dungeon sell-back, encumbrance/enforcement |

## 11. Non-Goals

- Hand-drawn or AI-generated art (license risk + style drift).
- DCSS tile adoption without per-tile license proof.
- Weight/encumbrance *enforcement*, item durability, crafting, socketing.
- Player-to-player trading UI (transport supports it later; out of scope).
