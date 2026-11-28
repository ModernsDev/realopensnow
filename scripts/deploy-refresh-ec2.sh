#!/usr/bin/env bash
set -euo pipefail
sha=$(git rev-parse --verify "${1:?merged git ref}^{commit}")
profile=${2:-travel}
git fetch -q origin main
git merge-base --is-ancestor "$sha" origin/main
aws() { command aws --profile "$profile" --region us-east-1 "$@"; }
[[ $(aws sts get-caller-identity --query Account --output text) == 919989872186 ]]
bucket=$(aws cloudformation describe-stacks --stack-name travel-serverless-app --query "Stacks[0].Parameters[?ParameterKey=='SessionsBucket'].ParameterValue | [0]" --output text)
instance=$(aws cloudformation describe-stacks --stack-name travel-ec2-runtime --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue | [0]" --output text)
object="s3://$bucket/runtime/releases/realopensnow/$sha.tar.gz"
git archive --format=tar.gz "$sha" package.json wrangler.jsonc src worker scripts/refresh-forecasts.mjs deploy/ec2 | aws s3 cp - "$object"
commands=$(python3 -c 'import json,sys; print(json.dumps({"commands": sys.argv[1:], "executionTimeout": ["1200"]}))' \
  "set -euo pipefail" \
  "release=/opt/realopensnow/$sha" \
  "mkdir -p \$release && aws s3 cp --region us-east-1 $object - | tar -xz -C \$release" \
  "docker pull -q node:24-slim" \
  "install -m 755 \$release/deploy/ec2/run /opt/realopensnow/run" \
  "install -m 644 \$release/deploy/ec2/realopensnow-refresh.service \$release/deploy/ec2/realopensnow-refresh.timer /etc/systemd/system/" \
  "ln -sfn \$release /opt/realopensnow/current.next && mv -T /opt/realopensnow/current.next /opt/realopensnow/current" \
  "systemctl daemon-reload && systemctl enable --now realopensnow-refresh.timer" \
  "systemctl start realopensnow-refresh.service" \
  "journalctl -u realopensnow-refresh.service -n 3 --no-pager -o cat" \
  "ls -dt /opt/realopensnow/*/ | grep -v current | tail -n +4 | xargs -r rm -rf")
id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript --parameters "$commands" --query Command.CommandId --output text)
printf 'SSM command %s\n' "$id"
until status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query Status --output text 2>/dev/null) && [[ $status != Pending && $status != InProgress && $status != Delayed ]]; do sleep 5; done
aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" --query '[StandardOutputContent,StandardErrorContent]' --output text
[[ $status == Success ]]
