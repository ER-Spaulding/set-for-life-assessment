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
STORAGE_SQL="$REPO/scripts/supabase-local-storage.sql"
SEED_DIR="$REPO/supabase/seed"

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

# Apply one SQL file with ON_ERROR_STOP, echoing a labelled OK/FAIL line.
# Returns 0 on success, 1 on failure (with the first lines of the error shown).
apply_sql() {
  local label="$1" file="$2"
  local out
  printf "%s %-58s " "$label" "$(basename "$file")"
  out=$(psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -v ON_ERROR_STOP=1 -q -d "$DB" -f "$file" 2>&1)
  if [ $? -eq 0 ]; then
    echo "OK"
    return 0
  fi
  echo "FAIL"
  echo "$out" | head -20 | sed 's/^/      /'
  return 1
}

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

# Supabase provisions the `storage` schema in every project. The snapshot
# documents migration (...00013) inserts its private bucket ONLY when that
# schema exists — so on a plain Postgres without this stub the branch silently
# skips and the bucket is never created (the exact defect that shipped to the
# live environment). The stub makes the chain EXERCISE the bucket branch.
if [ -f "$STORAGE_SQL" ]; then
  if apply_sql "STUB " "$STORAGE_SQL"; then
    : # storage schema stub applied
  else
    echo "RESULT: storage schema stub could not be applied — migration ...00013 would skip its bucket INSERT"
    exit 3
  fi
else
  echo "RESULT: $STORAGE_SQL missing — the bucket branch will NOT be exercised"
  exit 3
fi

FAIL=0
for f in $FILES; do
  if ! apply_sql "APPLY" "$f"; then
    FAIL=1
    break
  fi
  # The initial schema creates the app tables. Seed the pinned assessment
  # version AFTER it exists, so the migrations whose self-verification DO-blocks
  # read `assessment_versions` (e.g. ...00012) find a row — on a zero-state DB
  # this table is empty and those blocks abort with a null session_id, which is
  # the reproducibility gap the seed (supabase/seed/*.sql) exists to close.
  if [ "$(basename "$f")" = "20260930000001_initial_schema.sql" ] && [ -d "$SEED_DIR" ]; then
    for s in "$SEED_DIR"/*.sql; do
      [ -e "$s" ] || continue
      if ! apply_sql "SEED " "$s"; then
        FAIL=1
        break
      fi
    done
    [ $FAIL -eq 1 ] && break
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
  echo "--- storage: private PDF bucket ---"
  BUCKET_PUBLIC=$(psql_ "$DB" -c "select public from storage.buckets where id = 'snapshot-documents';")
  if [ -z "$BUCKET_PUBLIC" ]; then
    echo "  FAIL: snapshot-documents bucket NOT created — migration ...00013 skipped its INSERT"
    FAIL=1
  elif [ "$BUCKET_PUBLIC" != "f" ]; then
    echo "  FAIL: snapshot-documents bucket is PUBLIC ($BUCKET_PUBLIC) — it must be private"
    FAIL=1
  else
    echo "  snapshot-documents: private (public=f) — present"
  fi
fi

if [ "$KEEP" -eq 1 ] && [ $FAIL -eq 0 ]; then
  echo ""
  echo "DATABASE KEPT: $DB"
  echo "  psql -h $PGHOST_LOCAL -p $PGPORT_LOCAL -d $DB"
  echo "  drop when done:  dropdb $DB"
fi

echo "RESULT: $([ $FAIL -eq 0 ] && echo ALL MIGRATIONS APPLIED CLEANLY || echo MIGRATION FAILURE)"
exit $FAIL
