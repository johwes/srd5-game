#!/usr/bin/env bash
set -eo pipefail

# Default to 5 iterations if not specified; can be invoked as:
# ./scripts/ralph-loop.sh 10
BATCH_SIZE="${1:-5}"

echo "========================================================"
echo " Starting Ralph Loop: $BATCH_SIZE iterations + Monorepo Gate"
echo "========================================================"

for i in $(seq 1 "$BATCH_SIZE"); do
  echo ""
  echo "=== [Ralph Loop] Starting iteration $i of $BATCH_SIZE ==="
  echo ""
  agy --dangerously-skip-permissions \
    -p "Follow AGENTS.md: inspect git status, BACKLOG.md, and docs/spec/ to implement the next 1 unblocked backlog item.

DO NOT run pre-flight tests before writing code.
Implement the feature and write vitest unit/integration tests for acceptance criteria.
Before committing, verify within this session: run 'pnpm typecheck' and 'pnpm test' on modified packages. Fix any failures.
Once all tests and typechecks pass, mark [x] in BACKLOG.md, commit, push, and exit with a concise summary." || {
      echo "=== [Ralph Loop] Iteration $i stopped or failed. Proceeding to gate. ==="
      break
    }
done

echo ""
echo "=== [Ralph Loop] Batch completed. Running Full Monorepo & E2E Gate ==="
echo ""

agy --dangerously-skip-permissions \
  -p "Follow Section 4 of AGENTS.md: run the full monorepo gate:
1. Run: pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
2. If any errors or regressions occur, diagnose and fix them directly in the codebase until all 4 commands pass cleanly.
3. If any fixes were made, commit with 'fix(gate): resolve post-batch integration and e2e regressions' and push to origin main.
4. Check 'git log -n 10 --oneline' and output a concise summary of the batch."
