#!/usr/bin/env bash
set -euo pipefail
sha=$(git rev-parse --verify "${1:?merged git ref}^{commit}")
profile=${2:-travel}
git fetch -q origin main
git merge-base --is-ancestor "$sha" origin/main
image=ghcr.io/modernsdev/realopensnow-refresh:$sha
token=$(curl -fsS "https://ghcr.io/token?scope=repository:modernsdev/realopensnow-refresh:pull" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
curl -fsS -o /dev/null -H "Authorization: Bearer $token" -H "Accept: application/vnd.oci.image.index.v1+json" -H "Accept: application/vnd.oci.image.manifest.v1+json" "https://ghcr.io/v2/modernsdev/realopensnow-refresh/manifests/$sha"
aws() { command aws --profile "$profile" --region us-east-1 "$@"; }
[[ $(aws sts get-caller-identity --query Account --output text) == 919989872186 ]]
instance=$(aws cloudformation describe-stacks --stack-name travel-ec2-runtime --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue | [0]" --output text)
unit() { git show "$sha:deploy/ec2/$1" | base64 | tr -d '\n'; }
commands=$(python3 -c 'import json,sys; print(json.dumps({"commands": sys.argv[1:], "executionTimeout": ["1200"]}))' \
  "set -euo pipefail" \
  "docker pull -q $image" \
  "digest=\$(docker inspect --format '{{index .RepoDigests 0}}' $image)" \
  "install -d -m 755 /etc/realopensnow && printf 'IMAGE=%s\n' \"\$digest\" > /etc/realopensnow/image.env" \
  "echo $(unit realopensnow-refresh.service) | base64 -d > /etc/systemd/system/realopensnow-refresh.service" \
  "echo $(unit realopensnow-refresh.timer) | base64 -d > /etc/systemd/system/realopensnow-refresh.timer" \
  "systemctl daemon-reload && systemctl enable --now realopensnow-refresh.timer" \
  "systemctl start realopensnow-refresh.service" \
  "journalctl -u realopensnow-refresh.service -n 3 --no-pager -o cat" \
  "docker images --no-trunc --format '{{.Repository}}@{{.Digest}} {{.ID}}' ghcr.io/modernsdev/realopensnow-refresh | awk -v keep=\"\$digest\" '\$1 != keep {print \$2}' | sort -u | xargs -r docker rmi" \
  "echo running \$digest")
id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript --parameters "$commands" --query Command.CommandId --output text)
printf 'SSM command %s\n' "$id"
until status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query Status --output text 2>/dev/null) && [[ $status != Pending && $status != InProgress && $status != Delayed ]]; do sleep 5; done
aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query '[StandardOutputContent,StandardErrorContent]' --output text
[[ $status == Success ]]
