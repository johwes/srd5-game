#!/usr/bin/env bash
set -eo pipefail

# Usage:
#   ./scripts/ralph-loop.sh [batch_size] [agent]
#   ./scripts/ralph-loop.sh [--agent|-a <agy|opencode>] [batch_size]
# Examples:
#   ./scripts/ralph-loop.sh 10
#   ./scripts/ralph-loop.sh 10 opencode
#   ./scripts/ralph-loop.sh --agent opencode 5
#   ./scripts/ralph-loop.sh opencode

BATCH_SIZE="5"
AGENT="agy"
BATCH_SET=false

usage() {
  cat <<'EOF'
Usage: ./scripts/ralph-loop.sh [options] [batch_size] [agent]

Options:
  -a, --agent <agy|opencode>  Coding agent to use (default: agy)
  -h, --help                  Show this help message

Examples:
  ./scripts/ralph-loop.sh 10
  ./scripts/ralph-loop.sh 10 opencode
  ./scripts/ralph-loop.sh --agent opencode 5
  ./scripts/ralph-loop.sh opencode
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--agent)
      if [[ -z "${2:-}" ]]; then
        echo "Error: $1 requires an argument (agy or opencode)." >&2
        exit 1
      fi
      AGENT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    agy|opencode)
      AGENT="$1"
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]] && [[ "$BATCH_SET" == false ]]; then
        BATCH_SIZE="$1"
        BATCH_SET=true
        shift
      else
        echo "Error: Unknown argument '$1'. Supported agents: agy, opencode." >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

if [[ "$AGENT" != "agy" && "$AGENT" != "opencode" ]]; then
  echo "Error: Unsupported agent '$AGENT'. Supported agents: agy, opencode." >&2
  exit 1
fi

run_agent() {
  local prompt="$1"
  case "$AGENT" in
    agy)
      agy --dangerously-skip-permissions -p "$prompt"
      ;;
    opencode)
      opencode run --auto --model opencode-go/muse-spark-1.3-contributor "$prompt"
      ;;
  esac
}

ITERATION_PROMPT="Follow AGENTS.md: inspect git status, BACKLOG.md, and docs/spec/ to implement the next 1 unblocked backlog item.

DO NOT run pre-flight tests before writing code.
Implement the feature and write vitest unit/integration tests for acceptance criteria.
Before committing, verify within this session: run 'pnpm typecheck' and 'pnpm test' on modified packages. Fix any failures.
Once all tests and typechecks pass, mark [x] in BACKLOG.md, commit, push, and exit with a concise summary."

GATE_PROMPT="Follow Section 4 of AGENTS.md: run the full monorepo gate:
1. Run: pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
2. If any errors or regressions occur, diagnose and fix them directly in the codebase until all 4 commands pass cleanly.
3. If any fixes were made, commit with 'fix(gate): resolve post-batch integration and e2e regressions' and push to origin main.
4. Check 'git log -n 10 --oneline' and output a concise summary of the batch."

echo "========================================================"
echo " Starting Ralph Loop: $BATCH_SIZE iterations + Monorepo Gate (agent: $AGENT)"
echo "========================================================"

for i in $(seq 1 "$BATCH_SIZE"); do
  echo ""
  echo "=== [Ralph Loop] Starting iteration $i of $BATCH_SIZE (agent: $AGENT) ==="
  echo ""
  run_agent "$ITERATION_PROMPT" || {
      echo "=== [Ralph Loop] Iteration $i stopped or failed. Proceeding to gate. ==="
      break
    }
done

echo ""
echo "=== [Ralph Loop] Batch completed. Running Full Monorepo & E2E Gate (agent: $AGENT) ==="
echo ""

run_agent "$GATE_PROMPT"
