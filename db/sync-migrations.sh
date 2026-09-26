#!/usr/bin/env bash
# Mirror db/*.sql (source of truth) into supabase/migrations/ so `supabase db reset` works locally.
# Usage: db/sync-migrations.sh          copy
#        db/sync-migrations.sh --check  exit 1 if the mirror is stale
set -euo pipefail
cd "$(dirname "$0")/.."

pairs=(
  "db/schema.sql:supabase/migrations/20260926000001_schema.sql"
  "db/policies.sql:supabase/migrations/20260926000002_policies.sql"
  "db/functions.sql:supabase/migrations/20260926000003_functions.sql"
)

mkdir -p supabase/migrations
status=0
for pair in "${pairs[@]}"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  [[ -f "$src" ]] || continue
  if [[ "${1:-}" == "--check" ]]; then
    if ! cmp -s "$src" "$dst"; then
      echo "stale: $dst (run db/sync-migrations.sh)" >&2
      status=1
    fi
  else
    cp "$src" "$dst"
    echo "synced $src -> $dst"
  fi
done
exit $status
