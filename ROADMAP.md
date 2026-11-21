# Roadmap — Parked & Epic-Scale Ideas

This file tracks ideas that are **deliberately not in the backlog yet**: concepts
that need a design first, depend on unfinished tabletop fundamentals, or would
fork the architecture (network, cost, determinism). When an item below graduates,
it becomes one or more `SRD-***` tickets in [BACKLOG.md](./BACKLOG.md) with a
corresponding spec section — never implemented straight from here.

Rule of thumb: finish the tabletop loop first (targeting, props, quests,
furniture, Realm journeys). A brilliant director cannot save a shaky table.

---

## 1. AI Dungeon Master (LLM Director) — CONCEPT, NOT SCHEDULED

**The idea.** An LLM acts as Dungeon Master: narrates, voices NPCs, spawns
encounters, places loot/props, generates quests, and adjudicates the gaps the
rules engine explicitly punts on (`manual_adjudication` cards). Think co-op
tabletop night where the computer runs the module.

**Why this codebase is unusually ready for it:**
- The engine is authoritative and deterministic, and *everything* crosses one
  serializable seam: `GameCommand` in, `GameEvent[]` out. An LLM director can
  read the event stream as "what just happened" and issue commands as "what
  happens next" without touching rules code.
- Fog-of-War `PlayerViewState` is exactly the right context window: by default
  the director sees only what the party could know (no leaked traps), with the
  option to grant it full state for dramatic irony.
- The transport already supports a server-authoritative room. A director could
  join as just another seat — a DM slot whose `controlledCharacterIds` are the
  monsters and neutral entities — requiring almost no new plumbing.
- SRD-809 quest chains and the adjudication-card pattern already define the
  "engine can't do this, ask the table" escape hatch. An LLM is the natural
  filler for that slot.

**The command surface it would need** (new `GameCommand` verbs, server-side
authorized, all audited in the event log):
- `SPAWN_MONSTER` / `SPAWN_PROP` / `GRANT_ITEM` — scaled to party CR budget.
- `GRANT_QUEST` / `ADVANCE_QUEST_STAGE` — from templates plus LLM-written briefs.
- `TRIGGER_EVENT` — ambushes, weather shifts, rumors, timed faction moves.
- `NARRATE` — log-only flavor (area descriptions, NPC dialogue) with portraits.
- Explicitly *not* included v1: hidden DC fudging or silent state edits. If the
  DM fudges, it must be a visible, logged override — players should never wonder
  whether the dice were real.

**Why not now (honest version):**
1. **Offline-first is load-bearing.** The repo builds, tests, and runs with zero
   network. An LLM director means API keys, per-session cost, latency budgets,
   and streaming UI — an architectural fork, not a feature.
2. **Determinism vs. creativity.** Seeded replay is a core guarantee. Every LLM
   generation would have to be persisted into the event log to keep replays
   bit-exact. Solvable, but it must be designed in from day one.
3. **Cost and pacing.** Unbounded narration calls cost real money and stall turns.
   Needs strict budgets plus a local template fallback for flavor text.
4. **The table comes first.** Manual targeting, prop interaction, chains, and
   furniture (SRD-410, SRD-510–512) are the foundation an AI DM would stand on.
5. **Multiplayer trust.** Whoever runs the model holds the dungeon keys; the
   ownership model needs a DM seat with elevated *but audited* rights.

**Recommended sequencing when the time comes:**
1. Tabletop loop complete (in progress).
2. **Human DM mode first.** Ship the DM command surface with a hot-seat human
   DM (one player runs monsters/story). This validates the entire command API,
   delivers real co-op value, and carries zero AI risk.
3. **Then** put an LLM behind the same verbs, starting read-only
   (narration + hints), then spawning, then full directing — each behind a
   settings toggle with cost caps and an event-log audit trail.

---

## 2. Live Map Editor / DM Placement Mode — PARKED

Placing furniture, doors, traps, and encounters *during play* (drag-onto-grid
editing) as opposed to authoring them in module JSON or generator tables
(SRD-512 covers the data-authored path). Blocked on: a runtime prop-placement
command set, grid validation in the editor (connectivity, reachability), and a
save format for edited floors. Natural companion to §1 step 2 (human DM tools).

## 3. Faction AI Turns + Realm Win Conditions — PARKED

From the Realm review: factions as actors (recruit, raid caravans, retake
lairs) and 2–3 win conditions (unite the realm, destroy the Ashen Throne,
arcane ascension). Blocked on: Realm loop feeling right as a *party* RPG first
(SRD-807–809). Must never turn the game into a civilization manager — factions
act *around* the party, never as the player's pieces.

## 4. Walkable Settlement Interiors — PARKED

One reusable small tactical map (tavern square, temple court) with shopkeeper
tokens, as an alternative to the SRD-808 hub menus. Blocked on: hub proving
insufficient, plus a generic "town square" generator. Explicitly *not*
per-city geometry.

## 5. Steam Workshop / Module Sharing — PARKED

Modules are already pure JSON + seeded generation, so player-made dungeons are
a packaging + validation problem, not an engine problem. Blocked on: campaign
format stabilization, a module manifest + validator CLI, and Steam workshop
integration (post-Early-Access).
