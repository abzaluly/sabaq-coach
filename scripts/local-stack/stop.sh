#!/usr/bin/env bash
set -uo pipefail
STACK="$(cd "$(dirname "$0")/../.." && pwd)/.local-stack"
for f in "$STACK"/*.pid; do
  [[ -f "$f" ]] || continue
  kill "$(cat "$f")" 2>/dev/null && echo "stopped $(basename "$f" .pid)"
  rm -f "$f"
done
