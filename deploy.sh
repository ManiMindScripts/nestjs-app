#!/usr/bin/env bash
#
# Deploy the NestJS app to a single EC2 host running Docker + Compose.
#
# Flow (idempotent):
#   1. Build the image, tag it with the short git SHA, push to Amazon ECR.
#   2. SSH to the EC2 host.
#   3. Pull the exact SHA-tagged image.
#   4. Generate the host's git-ignored .env.production from AWS SSM Parameter
#      Store (only non-secret settings come from the committed template).
#   5. Start the app with the prod Compose stack. Migrations + seed run inside
#      the container via docker-entrypoint.sh (ordered before the server
#      starts), so no traffic ever hits a stale schema.
#
# Never commit or bake secrets: everything sensitive arrives at runtime from
# SSM and lives only in the git-ignored .env.production on the host.
#
# Usage (from the repo root, on a machine with AWS CLI + docker):
#   ./deploy.sh                     # full deploy (build, push, pull, start)
#   ./deploy.sh --revert            # roll back the LAST migration (emergency)
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration - review before each deploy.
# ---------------------------------------------------------------------------
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_ACCOUNT_ID="${ECR_ACCOUNT_ID:?Set ECR_ACCOUNT_ID (12-digit AWS account)}"
ECR_REPOSITORY="${ECR_REPOSITORY:-prod-app}"
APP_HOST="${APP_HOST:?Set APP_HOST to the deploy host, e.g. ubuntu@ec2-...}"
APP_SSH_KEY="${APP_SSH_KEY:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/prod-app}"
SSM_PATH="${SSM_PATH:-/prod-app}"
ENV_TEMPLATE="${ENV_TEMPLATE:-.env.production.example}"

ECR_IMAGE="${ECR_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}"
SHORT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo latest)"
TAGGED_IMAGE="${ECR_IMAGE}:${SHORT_SHA}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "${APP_SSH_KEY}" ] && SSH_OPTS+=(-i "${APP_SSH_KEY}")

ssh_run() { ssh "${SSH_OPTS[@]}" "${APP_HOST}" "$@"; }
scp_to()  { scp ${APP_SSH_KEY:+-i "${APP_SSH_KEY}"} "$1" "${APP_HOST}:${REMOTE_DIR}/"; }

# ---------------------------------------------------------------------------
# Build + push to ECR.
# ---------------------------------------------------------------------------
echo "==> Building and pushing ${TAGGED_IMAGE}"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_IMAGE}" >/dev/null

docker build -t "${TAGGED_IMAGE}" .
docker tag "${TAGGED_IMAGE}" "${ECR_IMAGE}:latest"
docker push "${TAGGED_IMAGE}"
docker push "${ECR_IMAGE}:latest"

# ---------------------------------------------------------------------------
# Remote setup: ensure paths + copy the prod compose file and env template.
# ---------------------------------------------------------------------------
ssh_run "mkdir -p ${REMOTE_DIR}"
scp_to docker-compose.prod.yml
[ -f "${ENV_TEMPLATE}" ] && scp_to "${ENV_TEMPLATE}"

# ---------------------------------------------------------------------------
# Remote host script: build .env.production from SSM, then start the app.
# Local values are interpolated before upload; awk field refs are escaped.
# ---------------------------------------------------------------------------
ssh_run 'bash -s' <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}

cp .env.production.example .env.production
if aws ssm get-parameters-by-path --region ${AWS_REGION} \
    --path ${SSM_PATH} --recursive --with-decryption \
    --query 'Parameters[*].[Name,Value]' --output text > .ssm.out 2>/dev/null; then
  awk -F'\t' '{ sub("^${SSM_PATH}/", "", \$1); print \$1 "=" \$2 }' .ssm.out >> .env.production
  rm -f .ssm.out
fi
chmod 600 .env.production
REMOTE

# ---------------------------------------------------------------------------
# Emergency rollback of the last migration.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--revert" ]; then
  ssh_run 'bash -s' <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh app -c \
  "./node_modules/.bin/typeorm migration:revert -d dist/database/data-source.js"
REMOTE
  exit 0
fi

# ---------------------------------------------------------------------------
# Start the app (migrations + seed handled inside the container entrypoint).
# ---------------------------------------------------------------------------
ssh_run 'bash -s' <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}
APP_IMAGE=${TAGGED_IMAGE} \
docker compose -f docker-compose.prod.yml up -d --pull always
docker image prune -f >/dev/null 2>&1 || true
REMOTE

echo
echo "Deployed ${TAGGED_IMAGE} to ${APP_HOST}"
echo "Health : curl -s https://<ALB-DNS>/api/health/ping"
echo "Swagger: https://<ALB-DNS>/api/docs"
echo
echo "Rollback a bad deploy: re-run this script pinned to the previous SHA:"
echo "  git checkout <prev-sha> && ./deploy.sh"
echo "Or, if already built (previous SHA tag):"
echo "  ssh ${APP_HOST} 'APP_IMAGE=${ECR_IMAGE}:<prev-sha> docker compose -f ${REMOTE_DIR}/docker-compose.prod.yml up -d'"
echo "Schema revert of the LAST migration (emergency only):"
echo "  ./deploy.sh --revert"
