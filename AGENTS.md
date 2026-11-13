# Agent Onboarding & Development Workflow (`srd5-game`)

Welcome! This repository contains the specification, backlog, and source code for the **SRD 5.1 Tactical Turn-Based Dungeon Crawler** web application.

If you are starting a fresh session or resuming work, follow this exact workflow before writing or modifying code.

---

## 1. Mandatory Startup Checklist (Read First)

At the start of every session, inspect the project state in this order:

1. **Check Git Status & History**:
   - Run `git status` and `git log -n 5 --oneline` to see recent progress and verify whether there is any uncommitted work in progress.
2. **Check the Backlog ([BACKLOG.md](file:///home/jwesterl/ai/srd5-game/BACKLOG.md))**:
   - Inspect `BACKLOG.md` to see which tickets are marked `[x]` (Done), `[~]` (In Progress), and `[ ]` (Todo).
   - Identify the next unblocked ticket(s) based on the `Depends On` column and Epic dependency graph.
3. **Read the Master Specification ([SPEC.md](file:///home/jwesterl/ai/srd5-game/SPEC.md)) & Relevant Spec Modules (`docs/spec/`)**:
   - Before implementing any ticket, read the corresponding specification document in `docs/spec/` so your types, formulas, and architecture match the design contracts:
     - `docs/spec/01-srd-data-schema.md` — SRD 5.1 Zod schemas, canonical IDs, ChoiceSpec, and Declarative Effect/Modifier DSL (`@srd5/data`).
     - `docs/spec/02-character-builder.md` — CharacterBuildState, Point Buy/Standard Array/4d6kh3, Choice validation, and 10-stage Derived Character Stat Pipeline (`@srd5/engine`, `@srd5/client`).
     - `docs/spec/03-combat-and-rules-engine.md` — Seeded PRNG/Dice evaluator, 5-ft grid, A* pathfinding, Corner-to-Corner LoS & Cover, AOE rasterization, Action Economy, Reactions, Concentration, Conditions, and Death Saves (`@srd5/engine`).
     - `docs/spec/04-dungeon-and-ai.md` — Dungeon exploration, interactive props (doors/locks/traps), Short & Long Rests, Tactical Monster AI archetypes, and the starter adventure module (`@srd5/engine`, `@srd5/data`).
     - `docs/spec/05-multiplayer-and-ui.md` — Command/Event transport (`@srd5/transport`), Fog-of-War `PlayerViewState`, PixiJS v8 7-layer tactical viewport, and React HUD (`@srd5/client`, `@srd5/server`).

---

## 2. Core Architectural Invariants

1. **Pure, Deterministic Engine (`@srd5/engine`)**:
   - Never call `Math.random()` in `@srd5/engine`. Always thread the seeded PRNG state (`rngState`) through dice rolls so combat and tests are 100% deterministic and replayable.
   - Never import browser DOM, React, or PixiJS inside `@srd5/data` or `@srd5/engine`.
2. **Command / Event Boundary (`@srd5/transport`)**:
   - The UI (`@srd5/client`) must never mutate authoritative game state directly. All gameplay actions must be dispatched as serializable `GameCommand` objects through the `GameTransport` interface, returning `GameEvent[]` and a projected `PlayerViewState`.
3. **SRD 5.1 Licensing & Content Guardrails (CC-BY-4.0)**:
   - Include the statutory Creative Commons Attribution 4.0 notice from `SPEC.md` Section 3.1.
   - Only include content from the official SRD 5.1 (never include non-SRD Product Identity monsters, spells, or subclasses).
4. **Offline-Ready Bundled Dataset**:
   - Normalized SRD 5.1 JSON files live in `packages/data/src/srd/*.json` and must build and pass tests completely offline without external network calls.

---

## 3. Ticket Execution & Git Commit Protocol

When asked to implement a specific ticket or the "next $N$ backlog item(s)" (e.g., *"implement 1 backlog item and exit"*):

1. **Select the Next Unblocked Ticket**:
   - Find the first `[ ]` (Todo) ticket in `BACKLOG.md` whose `Depends On` tickets are all marked `[x]` (Done).
   - If a `[~]` (In Progress) ticket already exists from an interrupted session, resume and finish that ticket first.
2. **Mark In Progress**:
   - Update the ticket status in `BACKLOG.md` from `[ ]` to `[~]`.
3. **Implement & Test**:
   - Read the linked specification file in `docs/spec/` for that ticket's Epic.
   - Write the implementation and corresponding `vitest` unit/integration tests covering the ticket's acceptance criteria in `BACKLOG.md`.
   - Run verification commands from the repository root:
     ```bash
     pnpm typecheck
     pnpm test
     pnpm build
     ```
   - *(Environment Note: If `pnpm install` needs network access to fetch npm packages during `SRD-101`, run only the package installation step with `BypassSandbox: true`, then run all subsequent builds and tests inside the standard sandbox).*
4. **Mark Done in `BACKLOG.md`**:
   - Once all tests, typechecks, and acceptance criteria pass, update the ticket status in `BACKLOG.md` from `[~]` to `[x]` (and check off any matching items in the Epic Acceptance Criteria checklist).
5. **Commit to Git & Stop (When Requested)**:
   - Commit each completed ticket to Git immediately so progress is preserved across sessions.
   - Use Conventional Commits referencing the ticket ID:
     ```text
     feat(root): implement SRD-101 monorepo scaffolding and legal notice
     feat(data): implement SRD-102 core enums and Effect DSL schemas
     feat(engine): implement SRD-108 seeded PRNG and 5e dice evaluator
     ```
   - Always include the updated `BACKLOG.md` in the commit so the git history and backlog status stay strictly in sync.
   - Verify with `git status` that the working tree is clean, then exit/respond with a concise summary of the completed ticket.
