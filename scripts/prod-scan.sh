#!/usr/bin/env bash
#
# Read-only production scan: when were stock lines marked?
#
#   bash scripts/prod-scan.sh
#
# Exists so the Claude Code permission rule can be ONE exact command instead of a wildcard over
# `node scripts/*`. It takes no arguments and hardcodes `--scan`, so nothing it is granted can be
# turned into a write: `--apply` cannot be reached through it at all.
#
# The connection string comes from the Railway CLI at run time and is never printed. Anything that
# looks like a Postgres URL is stripped from the output as a second line of defence, in case a
# driver error quotes it back.
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE_URL="$(railway variables --service Postgres --json 2>/dev/null \
  | python -c 'import json,sys; print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
export DATABASE_URL

if [ -z "${DATABASE_URL}" ]; then
  echo "Could not read DATABASE_PUBLIC_URL from Railway. Is the CLI logged in and the project linked?" >&2
  exit 1
fi

echo "Connected to production (read-only; connection string not shown)."
node --env-file=.env scripts/unmark-stock.cjs --scan 2>&1 \
  | sed -E 's#postgres(ql)?://[^[:space:]]*#<redacted>#g'
