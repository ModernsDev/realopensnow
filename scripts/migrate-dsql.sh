#!/usr/bin/env bash
set -euo pipefail
profile=${1:-travel}
cd "$(dirname "$0")/.."
export LC_ALL=C
files=(backend/migrations/*.sql)
[[ -f ${files[0]} ]] || { echo 'No backend/migrations/*.sql files found' >&2; exit 1; }
aws() { command aws --profile "$profile" --region us-east-1 "$@"; }
account=$(aws sts get-caller-identity --query Account --output text)
[[ $account == 919989872186 ]] || { echo "Unexpected AWS account: $account" >&2; exit 1; }
PGHOST=$(aws cloudformation describe-stacks --stack-name realopensnow --query "Stacks[0].Outputs[?OutputKey=='ClusterEndpoint'].OutputValue | [0]" --output text)
[[ -n $PGHOST && $PGHOST != None ]] || { echo 'Missing cluster endpoint' >&2; exit 1; }
export PGHOST PGUSER=admin PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT=system
db() {
  local token
  token=$(aws dsql generate-db-connect-admin-auth-token --hostname "$PGHOST") || return 1
  PGPASSWORD=$token psql -X -w -qAt -v ON_ERROR_STOP=1 "$@"
}
db -c 'CREATE SCHEMA IF NOT EXISTS snow'
db -c 'CREATE TABLE IF NOT EXISTS snow.schema_migrations (name TEXT PRIMARY KEY)'
for file in "${files[@]}"; do
  name=${file##*/}
  applied=$(db -v name="$name" <<< "SELECT 1 FROM snow.schema_migrations WHERE name = :'name'")
  [[ $applied != 1 ]] || continue
  printf 'Applying %s\n' "$name"
  job=$(db --single-transaction -f "$file")
  if awk '{sql=sql " " toupper($0)} END {exit !(sql ~ /CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+ASYNC([[:space:]]|$)/)}' "$file"; then
    [[ -n $job ]] || { echo "$name returned no async job ID" >&2; exit 1; }
    done=$(db -v job="$job" <<< "CALL sys.wait_for_job(:'job')") || { echo "$name: waiting for job $job failed; migration unrecorded" >&2; exit 1; }
    [[ $done == t ]] || { echo "$name: job $job did not complete (wait_for_job=$done); migration unrecorded" >&2; exit 1; }
  fi
  db -v name="$name" <<< "INSERT INTO snow.schema_migrations (name) VALUES (:'name')"
done
