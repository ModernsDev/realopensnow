#!/usr/bin/env bash
set -euo pipefail
sha=$(git rev-parse --verify "${1:?merged git ref}^{commit}")
profile=${2:-travel}
slots=${3:-off}
fail() { echo "$*" >&2; exit 1; }
[[ $slots == on || $slots == off ]] || fail 'snapshot_slots must be on or off'
git fetch -q origin main
git merge-base --is-ancestor "$sha" origin/main || fail "$sha is not on origin/main"
repo=ghcr.io/modernsdev/realopensnow-api
token=$(curl -fsS 'https://ghcr.io/token?scope=repository:modernsdev/realopensnow-api:pull' | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
curl -fsS -o /dev/null -H "Authorization: Bearer $token" -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' "https://ghcr.io/v2/modernsdev/realopensnow-api/manifests/$sha"
unset token
aws() { command aws --profile "$profile" --region us-east-1 "$@"; }
account=$(aws sts get-caller-identity --query Account --output text)
[[ $account == 919989872186 ]] || fail "Unexpected AWS account: $account"
instance=$(aws cloudformation describe-stacks --stack-name travel-ec2-runtime --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue | [0]" --output text)
host=$(aws ec2 describe-instances --instance-ids "$instance" --query 'Reservations[0].Instances[0]' --output json)
group=$(python3 -c 'import json,sys; print(",".join(group["GroupId"] for group in json.load(sys.stdin)["SecurityGroups"]))' <<< "$host")
profile_arn=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["IamInstanceProfile"]["Arn"])' <<< "$host")
role=$(aws iam get-instance-profile --instance-profile-name "${profile_arn##*/}" --query 'InstanceProfile.Roles[0].RoleName' --output text)
stack=$(aws cloudformation describe-stacks --stack-name realopensnow --query 'Stacks[0]' --output json)
stack_value() { python3 -c 'import json,sys; kind,key=sys.argv[1:]; print(next(row[kind+"Value"] for row in json.load(sys.stdin)[kind+"s"] if row[kind+"Key"] == key))' "$@" <<< "$stack"; }
expected_group=$(stack_value Parameter HostSecurityGroupId)
expected_role=$(stack_value Parameter HostRoleName)
[[ $group == "$expected_group" && $role == "$expected_role" ]] || fail "Host $instance has $group / $role; stack expects $expected_group / $expected_role"
endpoint=$(stack_value Output ClusterEndpoint)
tunnel_image=cloudflare/cloudflared:2026.11.0@sha256:b94b96edf2c9c4360f8879c8580cfaa99077f19c849ec595ca2f711b27d4f344
remote_script() {
  echo '#!/bin/bash'
  echo 'set -euo pipefail'
  printf 'repo=%q\nsha=%q\nendpoint=%q\nslots=%q\ntunnel_image=%q\n' "$repo" "$sha" "$endpoint" "$slots" "$tunnel_image"
  cat <<'REMOTE'
exec 9>/run/snow-backend-deploy.lock
flock -x 9
hash=$(docker pull "$repo:$sha" | awk '$1 == "Digest:" {print $2}')
[[ $hash =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing pull digest for $repo:$sha" >&2; exit 1; }
digest="$repo@$hash"
docker pull -q "$tunnel_image"
install -d -m 755 /etc/realopensnow
env_file=$(mktemp /etc/realopensnow/backend.env.XXXXXX)
trap 'rm -f "$env_file"' EXIT
printf 'IMAGE=%s\nTUNNEL_IMAGE=%s\nDSQL_ENDPOINT=%s\nGIT_SHA=%s\nSNAPSHOT_SLOTS=%s\n' "$digest" "$tunnel_image" "$endpoint" "$sha" "$slots" > "$env_file"
mv -f "$env_file" /etc/realopensnow/backend.env
REMOTE
  local unit
  for unit in snow-api.service snow-tunnel.service snow-refresh.service snow-refresh.timer; do
    printf "base64 -d > /etc/systemd/system/%s <<'UNIT'\n" "$unit"
    git show "$sha:deploy/ec2/$unit" | base64 || return 1
    printf '\nUNIT\n'
  done
  cat <<'REMOTE'
systemctl daemon-reload
systemctl enable --now snow-api.service snow-tunnel.service snow-refresh.timer
systemctl restart snow-api.service
timeout 60 bash -euo pipefail -c '
  until observed=$(curl -fsS --max-time 3 http://127.0.0.1:8010/healthz | python3 -c "import json,sys; print(json.load(sys.stdin)[\"sha\"])") && [[ $observed == "$1" ]]; do sleep 1; done
' _ "$sha" || { echo "API did not report $sha within 60s" >&2; exit 1; }
docker image ls --digests --format '{{.Tag}} {{.Digest}}' "$repo" | while read -r tag hash; do
  [[ "$repo@$hash" != "$digest" ]] || continue
  if [[ $tag != '<none>' ]]; then ref="$repo:$tag"; else ref="$repo@$hash"; fi
  containers=$(docker ps -aq --filter "ancestor=$ref")
  if [[ -z $containers ]]; then docker image rm "$ref"; fi
done
echo "Running $digest"
REMOTE
}
commands=$(remote_script | python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()], "executionTimeout":["1200"]}))')
id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript --parameters "$commands" --query Command.CommandId --output text)
printf 'SSM command %s\n' "$id"
deadline=$((SECONDS + 1500))
while (( SECONDS < deadline )); do
  if status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query Status --output text 2>&1); then
    case "$status" in Pending|InProgress|Delayed) ;; *) break ;; esac
  elif [[ $status != *InvocationDoesNotExist* ]]; then fail "$status"; fi
  sleep 5
done
aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query '[StandardOutputContent,StandardErrorContent]' --output text
[[ $status == Success ]] || fail "SSM command $id: $status"
