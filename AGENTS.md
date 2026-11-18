# Agent Onboarding & Development Workflow (`srd5-game`)

Welcome! This repository contains the specification, backlog, and source code for the **SRD 5.1 Tactical Turn-Based Dungeon Crawler** web application.

If you are starting a fresh session or resuming work, follow this exact workflow before writing or modifying code.

---

## 1. Mandatory Startup Checklist (Read First)

At the start of every session, inspect the project state in this order:

1. **Check Git Status & History**:
   - Run `git status`, `git pull --rebase origin main` (to sync latest changes), and `git log -n 5 --oneline` to see recent progress and verify whether there is any uncommitted work in progress.
   - **Do NOT run pre-flight test suites** before starting work. Assume the baseline codebase on `main` is clean and passing.
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
   - **Lean In-Session Verification (Per Ticket)**:
     To keep autonomous iterations fast without sacrificing regression safety, run scoped checks inside your session before committing:
     1. Run targeted unit/integration tests for the touched package(s):
        ```bash
        pnpm --filter @srd5/<touched-package> test
        ```
     2. Run the monorepo typecheck to ensure zero cross-package contract breaks:
        ```bash
        pnpm typecheck
        ```
     3. Build rules:
        - If `@srd5/client` was modified, verify the client build: `pnpm --filter @srd5/client run build`
        - If only `@srd5/data`, `@srd5/engine`, `@srd5/transport`, or `@srd5/server` were modified, run their respective fast build (e.g. `pnpm --filter @srd5/data run build`). Do NOT run the heavy Vite client production bundler on non-client tickets.
     4. **Do NOT run Playwright E2E (`pnpm test:e2e`)** on individual ticket iterations unless the ticket explicitly requires browser E2E test authoring/verification. Full E2E is executed as a dedicated post-batch gate.
4. **Mark Done in `BACKLOG.md`**:
   - Once all ticket tests and typechecks pass, update the ticket status in `BACKLOG.md` from `[~]` to `[x]` (and check off any matching items in the Epic Acceptance Criteria checklist).
5. **Commit to Git, Push to Remote & Stop (When Requested)**:
   - Commit each completed ticket to Git immediately so progress is preserved across sessions.
   - Use Conventional Commits referencing the ticket ID:
     ```text
     feat(root): implement SRD-101 monorepo scaffolding and legal notice
     feat(data): implement SRD-102 core enums and Effect DSL schemas
     feat(engine): implement SRD-108 seeded PRNG and 5e dice evaluator
     ```
   - Always include the updated `BACKLOG.md` in the commit so the git history and backlog status stay strictly in sync.
   - Push the commit(s) to the remote repository (`git push origin main` or current branch).
   - Verify with `git status` that the working tree is clean and up to date with origin, then exit/respond with a concise summary of the completed ticket.

---

## 4. Batch Completion & Full E2E Gate Protocol

When running an autonomous batch loop (e.g., Ralph loop), the loop concludes with a single dedicated verification session that executes the full monorepo gate:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

If any issues, regressions, or broken builds are uncovered during this gate:
1. Fix the issues directly in the codebase.
2. Verify all 4 checks pass cleanly.
3. Commit the fixes with `fix(gate): resolve post-batch integration and e2e regressions`.
4. Push to `origin main` and inspect `git log` to summarize the batch results.
