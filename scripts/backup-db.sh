#!/usr/bin/env bash
# =============================================================================
# ClassroomOS database backup.
#
#   SUPABASE_DB_URL=postgresql://... scripts/backup-db.sh [--sanitize]
#                                                      [--db-url URL]
#                                                      [--out DIR]
#                                                      [--retention-days N]
#
# Writes backups/classroomos_backup_YYYYMMDD_HHMMSS.sql.gz (UTC time), then
# deletes archives in the same directory older than the retention period
# (30 days by default).
#
# What is in the archive, in restore order:
#   0. CREATE EXTENSION for the extensions the schema depends on,
#   1. auth.users and auth.identities rows (logins),
#   2. the public schema without constraints or triggers,
#   3. the public schema's data,
#   4. constraints, indexes, triggers and RLS policies,
#   5. the on_auth_user_created trigger on auth.users,
#   6. the RLS policies on storage.objects,
#   7. storage.buckets and storage.objects rows.
# Loading data before constraints and triggers means nothing recalculates
# during a restore. Storage files themselves live in object storage and are
# not included; back them up separately.
#
# --sanitize produces a copy safe for staging and test environments. Names,
# phone numbers, emails, dates of birth, photos, leave reasons, driver
# details and bank details are replaced with stable fakes derived from each
# row's id. Payslips and staff salaries are removed. Logins keep their role
# and school but lose their passwords and real emails. Storage objects are
# left out. Amounts, attendance and results are kept, so balances still add
# up. The source database is only read, never modified.
#
# Restore into a new, empty Supabase project:
#   gunzip -c backups/<file>.sql.gz | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1
#
# Use the direct connection string or the session pooler (port 5432), not
# the transaction pooler (6543), which pg_dump does not support. pg_dump and
# psql must be at least the server's major version. To use other binaries,
# set PG_DUMP and PSQL, e.g. PG_DUMP="docker exec -i my-db pg_dump".
# =============================================================================
set -euo pipefail
umask 077 # backups hold personal data: owner-only files

DB_URL="${SUPABASE_DB_URL:-}"
OUT_DIR="backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
SANITIZE=0
read -r -a PG_DUMP_CMD <<<"${PG_DUMP:-pg_dump}"
read -r -a PSQL_CMD <<<"${PSQL:-psql}"

die() {
  echo "backup-db: $*" >&2
  exit 1
}
log() { echo "backup-db: $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sanitize) SANITIZE=1 ;;
    --db-url) DB_URL="${2:?--db-url needs a value}"; shift ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift ;;
    --retention-days) RETENTION_DAYS="${2:?--retention-days needs a value}"; shift ;;
    -h | --help) sed -n '2,45p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done

[[ -n "$DB_URL" ]] || die "set SUPABASE_DB_URL or pass --db-url."
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "--retention-days must be a whole number."
"${PG_DUMP_CMD[@]}" --version >/dev/null 2>&1 || die "pg_dump not found (set PG_DUMP)."
"${PSQL_CMD[@]}" --version >/dev/null 2>&1 || die "psql not found (set PSQL)."

# Never echo the password.
SAFE_URL="$(sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#' <<<"$DB_URL")"

query() { "${PSQL_CMD[@]}" "$DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# Every section is read from one exported snapshot, so the archive is
# consistent even while the school is using the system: a login created
# between two sections cannot leave a profile pointing at a missing user. The
# session holding the snapshot stays open until the archive is written.
coproc SNAPSHOT_SESSION { "${PSQL_CMD[@]}" "$DB_URL" -X -q -v ON_ERROR_STOP=1 -At; }
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${SNAPSHOT_SESSION[1]}"
read -r -t 30 SNAPSHOT <&"${SNAPSHOT_SESSION[0]}" || die "could not connect to $SAFE_URL."
[[ "$SNAPSHOT" =~ ^[0-9A-F-]+$ ]] || die "could not export a snapshot (got: $SNAPSHOT)."
release_snapshot() {
  { echo "COMMIT;" >&"${SNAPSHOT_SESSION[1]}"; } 2>/dev/null || true
  { exec {SNAPSHOT_SESSION[1]}>&-; } 2>/dev/null || true
  wait "${SNAPSHOT_SESSION_PID:-}" 2>/dev/null || true
}

dump() { "${PG_DUMP_CMD[@]}" --dbname="$DB_URL" --snapshot="$SNAPSHOT" --no-owner --quote-all-identifiers "$@"; }

# Runs a \copy query inside the same snapshot.
snapshot_copy() {
  query -c "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" -c "SET TRANSACTION SNAPSHOT '$SNAPSHOT'" \
    -c "\\copy ($1) to stdout" -c "COMMIT"
}

# -----------------------------------------------------------------------------
# Sanitizing. Each entry is "schema.table|column=expression;column=expression".
# Expressions run on the source row and must satisfy the table's CHECK
# constraints (phone numbers stay ten digits, names two characters or more).
# -----------------------------------------------------------------------------
TAG="left(md5(id::text), 6)"
PHONE="'9' || lpad((abs(hashtext(id::text)) % 1000000000)::text, 9, '0')"
SANITIZED_TABLES=(
  "public.students|full_name='Student ' || $TAG;parent_name='Parent ' || $TAG;parent_phone=$PHONE;date_of_birth=make_date(extract(year from date_of_birth)::int, 1, 1);avatar_url=null;blood_group=null;fee_concession_note=null"
  "public.profiles|full_name='User ' || $TAG;phone=null;email='user-' || $TAG || '@staging.invalid';avatar_url=null"
  "public.admission_leads|applicant_name='Applicant ' || $TAG;parent_name='Parent ' || $TAG;phone=$PHONE;email=null;message=null"
  "public.staff|full_name='Staff ' || $TAG;email=null;phone=null;base_salary=0;bank_name=null;bank_account_last4=null"
  "public.leave_requests|reason='Reason withheld';review_note=null"
  "public.transport_routes|driver_name='Driver ' || $TAG;driver_phone=$PHONE"
  "public.fee_payments|razorpay_signature=null;receipt_url=null"
)
# Salary slips are left out entirely.
DROPPED_TABLES=("public.payslips")

# Emits one table's rows as a COPY block, with the given columns replaced.
copy_block() {
  local table="$1" masks="$2" values="" pair column expression
  IFS=';' read -r -a pairs <<<"$masks"
  for pair in "${pairs[@]}"; do
    [[ -z "$pair" ]] && continue
    column="${pair%%=*}"
    expression="${pair#*=}"
    values+="${values:+, }('${column}', \$mask\$${expression}\$mask\$)"
  done
  local schema="${table%%.*}" name="${table#*.}"
  local lists
  lists="$(query <<SQL
select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
       || '|' ||
       string_agg(coalesce(m.expression, quote_ident(c.column_name)), ', ' order by c.ordinal_position)
  from information_schema.columns c
  left join (values ${values:-(null::text, null::text)}) as m(column_name, expression)
    on m.column_name = c.column_name
 where c.table_schema = '${schema}' and c.table_name = '${name}' and c.is_generated = 'NEVER';
SQL
)"
  [[ -n "${lists%%|*}" ]] || die "table ${table} not found."
  echo "COPY ${schema}.\"${name}\" (${lists%%|*}) FROM stdin;"
  snapshot_copy "select ${lists#*|} from ${table}"
  echo '\.'
  echo
}

# Logins for a sanitized copy: role and school kept, no password, fake email.
sanitized_users() {
  cat <<'SQL'
-- Sanitized logins: no passwords. Set one with scripts/create-user.mjs or the
-- Supabase dashboard before signing in.
SQL
  echo "COPY auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at) FROM stdin;"
  snapshot_copy "select instance_id, id, aud, role, 'user-' || left(md5(id::text), 6) || '@staging.invalid', raw_app_meta_data, jsonb_build_object('full_name', 'User ' || left(md5(id::text), 6)), email_confirmed_at, created_at, updated_at from auth.users"
  echo '\.'
  echo
}

# -----------------------------------------------------------------------------
# Write the archive
# -----------------------------------------------------------------------------
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
SUFFIX=""
[[ "$SANITIZE" == 1 ]] && SUFFIX="_sanitized"
FILE="$OUT_DIR/classroomos_backup_${STAMP}${SUFFIX}.sql.gz"
PARTIAL="$OUT_DIR/.classroomos_backup_${STAMP}${SUFFIX}.partial"
trap 'rm -f "$PARTIAL"; release_snapshot' EXIT

log "backing up $SAFE_URL$([[ "$SANITIZE" == 1 ]] && echo ' (sanitized)')"

EXCLUDES=()
for table in "${DROPPED_TABLES[@]}"; do EXCLUDES+=(--exclude-table-data="$table"); done
if [[ "$SANITIZE" == 1 ]]; then
  for entry in "${SANITIZED_TABLES[@]}"; do EXCLUDES+=(--exclude-table-data="${entry%%|*}"); done
fi

{
  echo "-- ClassroomOS backup, $(date -u '+%Y-%m-%d %H:%M:%S') UTC$([[ "$SANITIZE" == 1 ]] && echo ', sanitized')"
  echo "-- Restore into a new, empty Supabase project; see scripts/backup-db.sh."
  echo "SET session_replication_role = replica; -- no triggers while rows load"
  echo

  # Extensions are not part of the public schema's dump, but its indexes and
  # functions depend on them (pg_trgm, pgcrypto). Ones the platform already
  # installed are left as they are.
  echo "-- 0. Extensions"
  query <<'SQL'
select format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname)
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
 where e.extname <> 'plpgsql'
 order by e.extname;
SQL
  echo

  echo "-- 1. Logins"
  if [[ "$SANITIZE" == 1 ]]; then
    sanitized_users
  else
    dump --data-only --table=auth.users --table=auth.identities
  fi

  echo "-- 2. Public schema, before data"
  # Every Supabase project already has the public schema, owned by the platform.
  dump --schema=public --section=pre-data | sed -E '/^(CREATE SCHEMA|COMMENT ON SCHEMA) "public"/d'

  echo "-- 3. Data"
  if [[ "$SANITIZE" == 1 ]]; then
    dump --schema=public --data-only "${EXCLUDES[@]}"
    for entry in "${SANITIZED_TABLES[@]}"; do copy_block "${entry%%|*}" "${entry#*|}"; done
  else
    # Payslips stay in a full backup; only a sanitized copy drops them.
    dump --schema=public --data-only
  fi

  echo "SET session_replication_role = origin;"
  echo
  echo "-- 4. Constraints, indexes, triggers and policies"
  # Default privileges are the platform's to set, and already are.
  dump --schema=public --section=post-data | sed -E '/^ALTER DEFAULT PRIVILEGES /d'

  echo "-- 5. Trigger on auth.users"
  # An empty search_path makes the definitions schema-qualified, as the
  # restore runs with one.
  query <<'SQL'
set search_path = '';
select format('DROP TRIGGER IF EXISTS %I ON auth.users;', tgname) || E'\n' || pg_get_triggerdef(oid) || ';'
  from pg_trigger
 where tgrelid = 'auth.users'::regclass and not tgisinternal;
SQL
  echo

  # The app's storage policies live in the storage schema, outside the public
  # dump; without them a restored project would have no file access rules.
  echo "-- 6. Storage access policies"
  query <<'SQL'
set search_path = '';
select format('DROP POLICY IF EXISTS %I ON storage.objects;', policyname) || E'\n' ||
       format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s;',
              policyname, permissive, cmd,
              (select string_agg(quote_ident(role), ', ') from unnest(roles) as role),
              coalesce(' USING (' || qual || ')', ''),
              coalesce(' WITH CHECK (' || with_check || ')', ''))
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
SQL
  echo

  echo "-- 7. Storage buckets$([[ "$SANITIZE" == 1 ]] && echo '' || echo ' and object metadata')"
  if [[ "$SANITIZE" == 1 ]]; then
    dump --data-only --table=storage.buckets
  else
    dump --data-only --table=storage.buckets --table=storage.objects
  fi
} | gzip -9 >"$PARTIAL"

gzip -t "$PARTIAL" || die "the archive failed its integrity check."
mv "$PARTIAL" "$FILE"
trap - EXIT
release_snapshot
log "wrote $FILE ($(du -h "$FILE" | cut -f1))"

# -----------------------------------------------------------------------------
# Retention
# -----------------------------------------------------------------------------
removed=0
while IFS= read -r old; do
  rm -f -- "$old"
  log "removed $old (older than $RETENTION_DAYS days)"
  removed=$((removed + 1))
done < <(find "$OUT_DIR" -maxdepth 1 -type f -name 'classroomos_backup_*.sql.gz' -mtime +"$RETENTION_DAYS")
log "retention: $removed old archive(s) removed."

echo "$FILE"
