#!/usr/bin/env bash
#
# Read-only production reports.
#
#   bash scripts/prod-scan.sh                              # health of the sale -> channel chain
#   REPORT=unmatched-listings bash scripts/prod-scan.sh    # SKUs on channels with no product here
#
# Exists so the Claude Code permission rule can be ONE exact command instead of a wildcard over
# `node scripts/*`. No arguments are passed through to node. REPORT selects from a FIXED list and
# anything else is refused rather than executed, so the grant cannot be widened by setting a
# variable — an allowlist here, not a string substituted into a command.
#
# The connection string comes from the Railway CLI at run time and is never printed. Anything that
# looks like a Postgres URL is stripped from the output as a second line of defence, in case a
# driver error quotes it back.
set -euo pipefail

cd "$(dirname "$0")/.."

REPORT="${REPORT:-prod-health}"

# The allowlist, written once. It was two lists — a case pattern and a message — and they drifted:
# the message still named nine reports when fifteen more had been added, so anyone who mistyped one
# was handed a list that was mostly wrong. Still a fixed literal list, so the permission grant
# cannot be widened by setting a variable; only the duplication is gone.
REPORTS="
prod-health unmatched-listings amazon-uk-vat channel-duplicates zero-vat-orders vat-scope-impact
nonvat-country-rates migration-state vat-flag-drift onbuy-vat-signal sku-listing-trace
sku-phantom-origin listing-row-collisions push-coverage sku-alias-check alias-listing-coverage
vat-order-review marketplace-vat-overstated country-rate-check regime-vat-impact
collected-tax-repair-preview jct-classification-check vat-flag-state when-did-vat-change channel-vat-review ebay-flag-gap sku-listing-attempts ebay-nonuk-collected stale-tax-regime export-vat-origin vat2026-review regular-seller-vat gst-rate-check wrongly-flagged step3-preview-gst aus-residue step3-candidates order-forensics us-tax-shape step3-plan sku-stock-trace unknown-sku-shape unknown-sku-safety
"

case " $(echo $REPORTS) " in
  *" $REPORT "*) ;;
  *) echo "Unknown report: $REPORT" >&2
     echo "Allowed: $(echo $REPORTS)" >&2
     exit 1 ;;
esac

DATABASE_URL="$(railway variables --service Postgres --json 2>/dev/null \
  | python -c 'import json,sys; print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')"
export DATABASE_URL

if [ -z "${DATABASE_URL}" ]; then
  echo "Could not read DATABASE_PUBLIC_URL from Railway. Is the CLI logged in and the project linked?" >&2
  exit 1
fi

# A check that re-implements the rule it is checking is not a check, it is a second opinion from the
# same author. `step3-preview-gst` did exactly that and got Switzerland backwards: it decided `none`
# plus a collected flag meant the tax stayed ours, so it predicted the repair would clear nothing,
# when the real rule falls through to the flag and clears all of it.
#
# So the rule modules are compiled here, fresh on every run, and reports `require` them. Rebuilt
# each time rather than committed, so a stale copy cannot quietly disagree with the source.
RULE_MODULES="
integrations/mappings/tax-collection
sales-transactions/vat-scope
sales-transactions/channel-tax-repair-plan
channel-listings/sku-match
channel-listings/listing-status
channel-listings/channel-key
"

mkdir -p scripts/.compiled
for MODULE in $RULE_MODULES; do
  if ! npx esbuild "apps/api/src/${MODULE}.ts" --bundle --platform=node --format=cjs \
       --outfile="scripts/.compiled/$(basename "${MODULE}").cjs" --log-level=warning; then
    echo "Could not compile ${MODULE}; reports that require it will fail." >&2
  fi
done

echo "Connected to production (read-only; connection string not shown)."
node --env-file=.env "scripts/${REPORT}.cjs" 2>&1 \
  | sed -E 's#postgres(ql)?://[^[:space:]]*#<redacted>#g'
