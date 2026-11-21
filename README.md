# SRD 5.1 Tactical Turn-Based Dungeon Crawler

A browser-based, turn-based tactical CRPG dungeon crawler built on the **System Reference Document 5.1 (5e SRD)** under Creative Commons Attribution 4.0 International (CC-BY-4.0).

Featuring a pure deterministic rules engine, modern Baldur's Gate 3-inspired tactical interface, Steam Deck handheld ergonomics (1280×800), and a clean modular monorepo architecture.

---

## Table of Contents

- [About the Game](#about-the-game)
  - [Key Features](#key-features)
  - [Game Modes](#game-modes)
- [Monorepo Architecture](#monorepo-architecture)
- [Prerequisites](#prerequisites)
- [Quick Start: Launching the Game](#quick-start-launching-the-game)
- [Testing & Quality Assurance](#testing--quality-assurance)
  - [1. Typecheck](#1-typecheck)
  - [2. Unit & Integration Tests](#2-unit--integration-tests)
  - [3. Playwright End-to-End (E2E) Tests](#3-playwright-end-to-end-e2e-tests)
  - [4. Headless Soak & Invariant Playtest Bot](#4-headless-soak--invariant-playtest-bot)
  - [5. Automated Visual Playtest Bot](#5-automated-visual-playtest-bot)
  - [6. Full Verification Gate](#6-full-verification-gate)
- [Building for Production](#building-for-production)
- [Specifications & Documentation](#specifications--documentation)
- [Legal & Licensing Compliance](#legal--licensing-compliance)

---

## About the Game

The **SRD 5.1 Tactical Turn-Based Dungeon Crawler** brings authentic tabletop 5th Edition rules into a fast, fluid web application. Manage a party of 1 to 4 heroes as you explore subterranean crypts, trigger traps, manage inventory and spell slots, and battle SRD monsters on a 5-foot tactical square grid.

### Key Features

- **Faithful SRD 5.1 Implementation**:
  - Full Character Builder covering all 9 SRD races, 12 classes (Levels 1–20), ability generation (Standard Array, Point Buy, 4d6 drop lowest), and backgrounds.
  - Complete 10-stage derived stat calculation pipeline (Proficiency bonus, Armor Class, Spell Save DC, Saving Throws, Passive Perception).
  - 5e Action Economy: Action, Bonus Action, Reaction interrupts (*Shield*, *Opportunity Attack*, *Counterspell*), Movement, and Free Object Interactions.
  - Comprehensive spellcasting rules: Spell slots, cantrip scaling, concentration checks, somatic/verbal requirements, and saving throws.
  - Tactical grid mechanics: 5-ft grid, A* pathfinding, Bresenham Line-of-Sight, Corner-to-Corner Cover (Half, Three-Quarters, Full), Lighting & Fog of War.
  - 5e Conditions & Statuses: Prone, Stunned, Blinded, Paralyzed, Poisoned, Restrained, and Death Saving Throws.
- **Baldur's Gate 3-Inspired Tactical UI**:
  - Full-bleed edge-to-edge canvas viewport rendering with PixiJS v8.
  - Centered bottom docked Action Hotbar with character portrait, live HP/AC stats, action economy pips, tabbed action slots (Attacks, Spells, Features, Items), and dedicated End Turn button.
  - Top-centered circular Initiative Ribbon with real-time turn highlighting and round tracking.
  - Steam Deck handheld-first layout designed for 1280×800 (16:10) screens without clipping or overflow.
- **Configurable Difficulty & Rulesets**:
  - Difficulty presets: **Explorer**, **Standard**, and **Tactician**.
  - Custom rule toggles including **Friendly Fire** (protect allies from AOE spells like *Fireball* or *Burning Hands*), death save strictness, and AI aggression.
- **100% Deterministic & Replayable**:
  - Headless rules engine uses a seeded PRNG (`rngState`) with zero `Math.random()` calls, making all combat encounters, dice rolls, and tests fully reproducible.

### Game Modes

1. **Crypt of Kaelen (Story Campaign)**:
   - A multi-room narrative dungeon crawl. Navigate corridors, disarm trapped chests, breach locked doors, manage short/long rests, and defeat the dungeon boss.
2. **The Deep Descent (Roguelite)**:
   - Procedurally generated subterranean gauntlet. Battle through escalating dungeon depths, ration supplies, visit ancient floor shrines, and climb the permadeath score ladder.
3. **The Arena (Skirmish & Testing)**:
   - Instant tactical skirmish mode. Customize hero party rosters, pick enemy monster waves (e.g. Goblins, Wolves, Bugbears), and test tactical builds.
4. **The Realm (Multi-Nation War Campaign)**:
   - Procedurally generated overworld sandbox where 3–4 rival nations wage a dynamic territory war. Choose a banner, run Special-Ops missions with tactical Approaches, engage classed-squad war battles, negotiate truces or hire sub-factions, and manage enemy territory patrols & threat escalation.

---

## Monorepo Architecture

The project is structured as a `pnpm` workspace across four core packages:

| Package | Path | Responsibility |
| :--- | :--- | :--- |
| **`@srd5/data`** | `packages/data` | Normalized SRD 5.1 JSON datasets, Zod validation schemas, ChoiceSpec, and declarative Effect DSL. Zero browser dependencies. |
| **`@srd5/engine`** | `packages/engine` | Pure, deterministic rules engine: dice evaluator, character builder, 5e combat lifecycle, action economy, grid math, LoS/cover, and monster AI. |
| **`@srd5/transport`** | `packages/transport` | Command/Event message bus and Fog-of-War state projection (`PlayerViewState`). Provides local in-memory execution and multiplayer-ready interfaces. |
| **`@srd5/client`** | `packages/client` | React 19 presentation layer and PixiJS v8 2D canvas viewport. BG3-inspired HUD, character builder wizard, dungeon viewport, and campaign launcher. |

---

## Prerequisites

Before running the project, ensure you have the following installed:

- **Node.js**: `v20.x` or later (LTS recommended)
- **pnpm**: `v9.x` or later (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Chromium / Chrome**: Required for Playwright end-to-end tests

---

## Quick Start: Launching the Game

1. **Clone the repository**:
   ```bash
   git clone https://github.com/johwes/srd5-game.git
   cd srd5-game
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Start the local development server**:
   ```bash
   pnpm dev
   ```
   *(Or alternatively: `pnpm --filter @srd5/client run dev`)*

4. **Open in browser**:
   Navigate to [http://localhost:5173](http://localhost:5173) to play.

---

## Testing & Quality Assurance

The codebase includes an extensive multi-tier verification suite covering static typing, unit tests, integration suites, browser E2E tests, and automated playtesting.

### 1. Typecheck

Run static TypeScript verification across all workspace packages:

```bash
pnpm typecheck
```

### 2. Unit & Integration Tests

Run the full `vitest` suite across all packages (data schemas, engine rules, character derivation, combat mechanics, and client components):

```bash
pnpm test
```

To run tests for an individual package:

```bash
# Data schemas & SRD bundle integrity tests
pnpm --filter @srd5/data test

# Rules engine, combat lifecycle, AI, and math tests
pnpm --filter @srd5/engine test

# Transport & Fog-of-War projection tests
pnpm --filter @srd5/transport test

# Client component & state machine tests
pnpm --filter @srd5/client test

# Multiplayer server tests
pnpm --filter @srd5/server test
```

### 3. Playwright End-to-End (E2E) Tests

Headless browser tests that launch the client at native Steam Deck resolution (1280×800) and verify the complete user flow: Title Menu &rarr; Campaign Setup Wizard &rarr; Party Assembly &rarr; Dungeon Delve &rarr; Arena Skirmish &rarr; Roguelite mode &rarr; The Realm War Campaign:

```bash
# Run the full Playwright E2E suite
pnpm test:e2e

# Run just the Realm War & Combat UI invariant playtest spec
pnpm exec playwright test packages/client/e2e/realm-war-playtest.spec.ts
```

To run Playwright interactively with the visual UI runner:

```bash
pnpm exec playwright test --ui
```

### 4. Headless Soak & Invariant Playtest Bot

A fast, deterministic headless playtest bot (`scripts/soak-playtest.ts`) that runs multi-seed campaigns through the authoritative engine without a browser. On every run it:

- Deals **randomized 4-hero parties across all 12 SRD 5.1 classes** and SRD races (including darkvision & non-darkvision mixes).
- Drives **accelerated XP and multi-level-up progression (Level 1 &rarr; Level 5)** through `validateLevelUp` and `applyLevelUp` / `applyBetweenCombatLevelUp` (exercising subclasses, ASIs, Extra Attack, and higher-level spells).
- Proactively activates **class & racial features** (`USE_CLASS_FEATURE`), casts **diverse spells** (`DECLARE_CAST_SPELL`), and executes **melee/ranged weapon attacks** (`DECLARE_ATTACK`).
- Enforces **gameplay invariants** on every turn: darkness/darkvision Fog-of-War visibility (`projectPlayerView`), concentration buff cleanup, cube AOE anchor geometry, finite HP, valid active turn ownership, and Realm War diplomacy/patrol/threat decay rules.

```bash
# Default 3-seed soak run (~30s, covers all 12 SRD classes)
pnpm playtest:soak

# Larger multi-seed stress run (pass any seed count, e.g. 20)
pnpm playtest:soak 20
```

### 5. Automated Visual Playtest Bot

An automated bot (`scripts/playtest.ts`) that launches a headless browser, interacts with all major views, casts spells, executes melee attacks, triggers movement, and captures high-resolution screenshots to `artifacts/playtest/`:

```bash
pnpm run playtest
```

### 6. Full Verification Gate

To run the complete pre-release verification pipeline (typecheck, all unit/integration tests, production build, and Playwright E2E):

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

---

## Building for Production

Compile all packages and generate the optimized production client bundle:

```bash
pnpm build
```

The compiled static assets will be output to `packages/client/dist/`.

---

## Specifications & Documentation

The project's architectural decisions, rules formulas, and backlog are thoroughly documented:

- **[SPEC.md](file:///home/jwesterl/ai/srd5-game/SPEC.md)**: Master specification and architecture index.
- **[BACKLOG.md](file:///home/jwesterl/ai/srd5-game/BACKLOG.md)**: Granular engineering backlog across all epics.
- **`docs/spec/`**: Modular technical specifications:
  - `01-srd-data-schema.md` — Zod schemas & Effect DSL.
  - `02-character-builder.md` — Character builder & 10-stage stat pipeline.
  - `03-combat-and-rules-engine.md` — Deterministic combat, action economy, and grid geometry.
  - `04-dungeon-and-ai.md` — Dungeon state, props, rests, and tactical AI.
  - `05-multiplayer-and-ui.md` — Fog-of-war projection, transport, and PixiJS viewport.
  - `06-game-modes-and-progression.md` — Arena, Deep Descent, and Overworld specs.
  - `07-main-menu-and-campaign-launcher.md` — Front-end shell & Steam Deck layout.
  - `10-realm-war-campaign.md` — Multi-Nation War Campaign, War Power simulation, Special-Ops missions, classed squads, and diplomacy.

---

## Legal & Licensing Compliance

### SRD 5.1 Attribution Notice
This work includes material taken from the **System Reference Document 5.1 ("SRD 5.1")** by Wizards of the Coast LLC and available at [https://dnd.wizards.com/resources/systems-reference-document](https://dnd.wizards.com/resources/systems-reference-document). The SRD 5.1 is licensed under the **Creative Commons Attribution 4.0 International License** available at [https://creativecommons.org/licenses/by/4.0/legalcode](https://creativecommons.org/licenses/by/4.0/legalcode).

### Open Game Asset Attribution
- **Kenney.nl Assets** (Tiny Dungeon & 1-Bit Roguelike): Licensed under [CC0 1.0 Universal (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/).
- **game-icons.net Icons**: Licensed under [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/) by authors listed in `packages/data/LEGAL.md`.
- **DawnLike Tiles**: Licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) by DragonDePlatino & DawnBringer.
