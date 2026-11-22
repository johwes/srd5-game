# 14 — BG3-Style Character & Party Inventory

## 0. Intent & Identity

Epic 13 delivered the mechanics of a graphical inventory (icon grid, visual
paperdoll, rarity, tooltips, loot box, gold-only economy). This Epic delivers
the **flow**: a full-screen Character view and a Party inventory strip modeled
on the Baldur's Gate 3 reference shots in `../reference/bg3/` — same answers
at a glance, same muscle memory, none of Larian's art.

Reference shots (all in `../reference/bg3/`):

| Shot | What it teaches |
|---|---|
| `bg3-character-sheet-xorda.png` | 3-pane character view: stats rail · doll + equipment · backpack grid; gold + XP header |
| `bg3-character-skills.png` | Skills tab: ability groups, proficiency stars, per-skill bonuses |
| `bg3-character-attributes.png` | Attributes tab: HP/AC/initiative/speed/type/size/weight, carrying capacity, proficiencies |
| `bg3-character-sheet-astarion.png` | Conditions + Resistances panels; sparse backpack still reads well |
| `bg3-character-sheet-laezel.png` | Notable Features / approval-style rows; second weapon set visible under doll |
| `bg3-party-inventory.png` | Party strip: 4 hero cards side by side, per-hero gold, shared top tabs, weight bars |
| `bg3-hotbar.png` | In-world state for contrast: hotbar owns combat, the sheet owns management |

Identity note: Larian's UI is the **usability** reference only. All graphics
stay in our licensed pipeline (RPG Awesome + vendored game-icons + Kenney
chrome, Spec 12 §2). No 3D doll — our doll is the party token sprite enlarged
on a class-tinted backdrop with the Spec-12 icon slots around it.

## 1. Goals

1. One full-screen **Character view** (3-pane: stats rail · doll + equipment ·
   backpack) reachable from the dungeon HUD, the loot modal, and the roster —
   replacing the sheet drawer's dropdown loadout as the management surface.
   The drawer keeps its quick-inspect role.
2. One **Party strip** mode: all active heroes side by side (doll card +
   condensed grid each), per-hero gold, party gold total, shared search/
   filter, drag-or-click item moves between heroes.
3. Weapon cards under the doll (melee / ranged: icon, to-hit, damage range)
   driven by the existing derived attack profiles — the same data the
   hotbar and the drawer breakdown already show.
4. Weight **capacity bar** (STR × 15, display only — Spec 12 §12 keeps
   enforcement out) per hero, plus the existing currency strip in gold.
5. Interaction parity with the reference: click select → action bar,
   double-click equip/use, right-click context menu, drag doll ↔ grid and
   grid ↔ grid, hover compare tooltips, sort (name / type / value / weight),
   filter categories + text search.
6. Deck parity throughout: every mouse flow works by focus + Enter, no
   hover-only information (tooltips already portal past scroll containers).

## 2. Non-Goals

- 3D models, hand-drawn/AI art, or new art licensing (Spec 12 §2 stands).
- Extra body slots (helm/cloak/rings/boots): v1 mirrors the 5 engine slots
  (armor/shield/main/off/ranged). Extra slots stay passive-while-attuned per
  Spec 12 §8.
- Weight **enforcement**, crafting, socketing, durability (Spec 12 §12).
- New engine commands expected: equip (`EQUIP_LOADOUT`), move
  (`TRANSFER_ITEM`), use (`USE_ITEM`), attune, drop/split/sell all exist and
  stay authoritative. If a slice needs transport changes, it says so in the
  ticket.
- Hotbar redesign (shot `bg3-hotbar.png` is context only — SRD-607 owns it).

## 3. Layout Spec (`@srd5/client`)

### 3.1 Character view (default)

Full-screen modal (`role="dialog"`, `?` no route change), max-w-7xl:

- **Header**: portrait, name, race · class/level line, XP bar, party gold
  total; hero switcher (portrait tabs); Close (Esc).
- **Left rail** (tabs: Build / Skills / Attributes — mirroring shots
  `-xorda`, `-skills`, `-attributes`):
  - Build: class/subclass/level breakdown, HP/AC, proficiency bonus,
    conditions list, resistances row, notable features.
  - Skills: ability groups with scores, per-skill bonus, proficiency/expertise
    stars (reuse sheet-drawer data; presentation only).
  - Attributes: HP, AC, initiative, speed, darkvision, type/size/weight,
    carrying capacity, weapon/armor/tool proficiencies.
- **Center doll**: enlarged token sprite on class-tinted backdrop; equipment
  slots flanking (left: armor/shield; right: main/off-hand; below: ranged —
  or the Spec-12 5-slot row if space is tight); melee/ranged weapon cards
  with to-hit + damage; AC shield; weight capacity bar; Unequip on click.
- **Right backpack**: the Spec-12 `InventoryView` grid (rarity borders,
  counts, attunement pips) + sort control + category filters + search +
  per-hero gold. Reuse `InventoryView` where possible; do not fork the grid.

### 3.2 Party strip (toggle from the header)

Horizontal hero cards (one per active party member, max 4): doll card
(portrait, HP, AC, per-hero gold) + condensed backpack grid + weight bar.
Shared search/filter applies to all cards. Item moves between heroes via
`TRANSFER_ITEM` (drag card-to-card or click → "Send to <hero>"). Party gold
total in the header (sum of hero purses — display only).

### 3.3 Loot modal relationship

The corpse/chest loot box (Spec 12 §11.2, gold pile included) stays the
acquisition surface. After Take/Claim All, a "Inspect in Character view"
affordance jumps to the recipient's Character view. No merge of the two
surfaces in v1.

## 4. Interaction Spec

| Flow | Primary | Deck/keyboard fallback |
|---|---|---|
| Select item | Click cell | Focus + Enter |
| Equip / use | Double-click cell; Equip→slot buttons | Enter opens action bar, buttons |
| Context actions | Right-click menu (Equip, Use, Send to hero, Split, Drop, Sell-info/Identify) | Action bar buttons (same handlers) |
| Move within grid / doll ↔ grid | HTML5 drag (already in `InventoryView`) | Click-then-click equip |
| Move hero → hero | Drag card-to-card or Send-to menu | Send-to menu |
| Inspect | Hover tooltip (portaled, unclipped) | Focus tooltip |
| Sort | Newest / Name / Type / Value / Weight control | Same control (native select) |
| Unequip | Click equipped slot | Same (button) |

Rules: no hover-only info; every grid/slot is a real `<button>` with a
`data-testid`; optimistic UI is forbidden — equip/move/use re-render from
engine state after dispatch.

## 5. Visual Language

- Slots/cells: Spec-12 rarity borders + `ItemIcon` glyphs; empty slots show
  the slot name ghosted (current paperdoll pattern).
- Weapon cards: icon + name + to-hit badge + damage line (derived profiles).
- Weight bar: `carried / STR×15 lb`, amber past 80%, red past 100%
  (display only).
- Gold: coin SVG pile icon + `N gp` (gold-only economy); per-hero in cards,
  party total in headers.
- Fonts/chrome: existing Tailwind theme; Kenney frames only if free.

## 6. Engine / Transport Notes

No new commands planned. Slices reuse: `EQUIP_LOADOUT` (with dedup),
`TRANSFER_ITEM`, `USE_ITEM`, `ATTUNE_ITEM`, `DROP_ITEM`,
`SPLIT_ITEM_STACK`, `SELL_ITEM`. Validation stays engine-side
(`validateEquipLoadout` incl. worn-proficiency + thrown-ranged fit).
`calculateGoldFromLoot` / purse math already gold-only.

## 7. Phased Delivery (→ Epic 15)

| Phase | Tickets | Content |
|---|---|---|
| 1 — Character shell | SRD-1501 | 3-pane view, hero switching, gold header, Esc |
| 2 — Party strip | SRD-1502 | 4-hero cards, per-hero + total gold, hero-to-hero moves |
| 3 — Doll depth | SRD-1503 | Weapon cards, weight capacity bar, Unequip |
| 4 — Flow parity | SRD-1504 | Double-click, right-click menu, sort control |
| 5 — Stats rail | SRD-1505 | Conditions/resistances/attributes/skills tabs |
| 6 — Gate | SRD-1506 | E2E + visual validation at 1280×800, zero console errors |

Each phase ships independently on `main` with its own tests; the sheet
drawer keeps working until SRD-1501 lands, then the drawer Equipment tab
links out to the Character view (drawer stays for quick inspect).

## 8. Acceptance Criteria (summary; ticket detail in BACKLOG)

- Character view opens from HUD/roster/loot, switches heroes, shows stats,
  doll, grid, gold; closes on Esc.
- Party strip shows all active heroes with correct per-hero and total gold;
  moving an item updates both heroes' grids from engine state.
- Weapon cards match derived to-hit/damage; weight bar matches STR×15.
- All flows operable by mouse, keyboard, and touch at 1280×800; tooltips
  fully visible; zero console errors.
- Offline build/test green; no new art licenses; no new engine commands
  unless a ticket says so.

## 9. Open Questions (resolve in tickets, not here)

- Does the Character view replace the loot modal's inventory tab, or stay
  separate? ( leaning: separate — §3.3.)
- Second weapon set (Lae'zel shot)? Engine has one set of slots: out of
  scope unless a ticket proves otherwise.
- Camp-supply / consumable quick-use row in the sheet? Nice-to-have; propose
  only if free inside SRD-1504.
