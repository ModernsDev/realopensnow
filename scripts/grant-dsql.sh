#!/usr/bin/env bash
set -euo pipefail
profile=${1:-travel}
aws() { command aws --profile "$profile" --region us-east-1 "$@"; }
account=$(aws sts get-caller-identity --query Account --output text)
[[ $account == 919989872186 ]] || { echo "Unexpected AWS account: $account" >&2; exit 1; }
stack() { aws cloudformation describe-stacks --stack-name realopensnow --query "$1" --output text; }
PGHOST=$(stack "Stacks[0].Outputs[?OutputKey=='ClusterEndpoint'].OutputValue | [0]")
role=$(stack "Stacks[0].Parameters[?ParameterKey=='HostRoleName'].ParameterValue | [0]")
[[ -n $role && $role != None && -n $PGHOST && $PGHOST != None ]] || { echo 'Missing host role or cluster endpoint' >&2; exit 1; }
arn="arn:aws:iam::$account:role/$role"
PGPASSWORD=$(aws dsql generate-db-connect-admin-auth-token --hostname "$PGHOST")
export PGHOST PGPASSWORD PGUSER=admin PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT=system
psql -X -w -v ON_ERROR_STOP=1 -v arn="$arn" <<'SQL'
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'snow_app') AS create_role \gset
\if :create_role
CREATE ROLE snow_app WITH LOGIN;
\endif
SELECT NOT EXISTS (SELECT 1 FROM sys.iam_pg_role_mappings WHERE arn = :'arn' AND pg_role_name = 'snow_app') AS grant_role \gset
\if :grant_role
AWS IAM GRANT snow_app TO :'arn';
\endif
GRANT USAGE ON SCHEMA snow TO snow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA snow TO snow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA snow TO snow_app;
SQL
