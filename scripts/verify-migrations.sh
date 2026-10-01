#!/usr/bin/env bash
#
# Verify the migration chain against a throwaway database.
#
# WHY THIS EXISTS IN THE REPO.
#
# Every migration header in `supabase/migrations/` carries a claim of the form
# "verified by execution against a real Postgres". Those verifications were real
# but ad-hoc, run against a database in whatever state it happened to be in —
# and the scripts lived in /tmp, which gets cleared. That is how S-17 happened:
#
#   `snapshots_append_only()` unconditionally refused DELETE. Erasure was
#   verified against a database containing ZERO snapshot rows, so the cascade
#   never had a snapshot to delete and the path appeared to work. The moment
#   Snapshot persistence shipped, every COMPLETED participant became permanently
#   un-erasable.
#
# The suite was green throughout. The verification was not wrong; its INPUT was.
# This script is the missing reproducibility: anyone can re-run the chain from
# zero and get the same answer.
#
# USAGE
#   scripts/verify-migrations.sh                 # apply the chain from zero
#   scripts/verify-migrations.sh --keep          # ...and leave the DB for probing
#   scripts/verify-migrations.sh --db my_sfl     # use a specific database name
#
# With --keep, the scratch database is left in place so a scenario can be
# executed against the resulting schema. This is how S-17's fix was verified:
# seed a completed participant holding a snapshot, attempt the erasure, and
# check BOTH that the refusals still hold and that the authorized path works.
#
# NOTE ON POSTGRES VERSION: the live Supabase project is Postgres 17; Homebrew
# installs 16. Schema-level behaviour matches, but anything version-sensitive
# should be confirmed against the live project before relying on it.

set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGDIR="$REPO/supabase/migrations"
ROLES_SQL="$REPO/scripts/supabase-local-roles.sql"

KEEP=0
DB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --db)   DB="${2:-}"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
[ -z "$DB" ] && DB="sfl_migtest_$$"

PGHOST_LOCAL="${SFL_PGHOST:-127.0.0.1}"
PGPORT_LOCAL="${SFL_PGPORT:-5432}"
psql_() { psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -d "$1" -qtA "${@:2}"; }

cleanup() {
  if [ "$KEEP" -eq 0 ]; then dropdb -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" --if-exists "$DB" >/dev/null 2>&1; fi
}
trap cleanup EXIT

echo "=== SFL MIGRATION VERIFY ==="
echo "repo: $REPO"
echo "db:   $DB"

if [ ! -d "$MIGDIR" ] || [ -z "$(ls -A "$MIGDIR" 2>/dev/null)" ]; then
  echo "RESULT: NO MIGRATIONS FOUND in $MIGDIR"; exit 2
fi
FILES=$(ls -1 "$MIGDIR"/*.sql 2>/dev/null | sort)
echo "files: $(echo "$FILES" | wc -l | tr -d ' ')"

echo "--- rebuilding from zero ---"
dropdb -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" --if-exists "$DB" >/dev/null 2>&1
createdb -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" "$DB" || { echo "RESULT: could not create $DB"; exit 3; }

# The RLS migration references anon/authenticated/service_role and auth.uid().
# Postgres roles are CLUSTER-wide, so these survive between runs; the bootstrap
# is idempotent so it is safe either way.
if [ -f "$ROLES_SQL" ]; then
  psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROLES_SQL" >/dev/null 2>&1 \
    && echo "  supabase-local roles OK" || echo "  WARNING: role bootstrap failed"
else
  echo "  WARNING: $ROLES_SQL missing — RLS policies may not be created"
fi

FAIL=0
for f in $FILES; do
  printf "APPLY %-58s " "$(basename "$f")"
  OUT=$(psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1)
  if [ $? -eq 0 ]; then
    echo "OK"
  else
    echo "FAIL"
    echo "$OUT" | head -20 | sed 's/^/      /'
    FAIL=1
    break
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "--- tables: $(psql_ "$DB" -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';") ---"
  echo "--- policies: $(psql_ "$DB" -c "select count(*) from pg_policies where schemaname='public';") ---"
  echo "--- immutability triggers ---"
  psql_ "$DB" -c "
    select '  ' || c.relname || ' :: ' || t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname='public' and (t.tgtype & 8) = 8
    order by c.relname;"
fi

if [ "$KEEP" -eq 1 ] && [ $FAIL -eq 0 ]; then
  echo ""
  echo "DATABASE KEPT: $DB"
  echo "  psql -h $PGHOST_LOCAL -p $PGPORT_LOCAL -d $DB"
  echo "  drop when done:  dropdb $DB"
fi

echo "RESULT: $([ $FAIL -eq 0 ] && echo ALL MIGRATIONS APPLIED CLEANLY || echo MIGRATION FAILURE)"
exit $FAIL
