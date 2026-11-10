#!/bin/bash
# Pull-based deploy, run by jedforge-deploy.timer every few minutes. Replaces Railway's
# auto-deploy-on-merge. The repo is public, so no credentials are needed on this host.
#
# Deploys origin/main only once EVERY check run on that commit has succeeded (the branch is
# protected, so main only moves via a PR whose checks passed; this is a second gate against a
# red push-run). On a failed health check it rolls back to the previous image.
set -euo pipefail
REPO_DIR=/opt/jedforge/repo
OWNER_REPO=jedmond1971/taskforge
COMPOSE=(docker compose --env-file /opt/jedforge/.env -f "$REPO_DIR/deploy/selfhost/docker-compose.yml")

cd "$REPO_DIR"
git fetch -q origin main
SHA=$(git rev-parse origin/main)
DEPLOYED=$(cat /opt/jedforge/.deployed-sha 2>/dev/null || true)
[ "$SHA" = "$DEPLOYED" ] && exit 0

checks=$(curl -fsS "https://api.github.com/repos/$OWNER_REPO/commits/$SHA/check-runs?per_page=100")
total=$(jq '.total_count' <<<"$checks")
bad=$(jq '[.check_runs[] | select(.status != "completed" or (.conclusion != "success" and .conclusion != "skipped"))] | length' <<<"$checks")
if [ "$total" -eq 0 ] || [ "$bad" -ne 0 ]; then
  echo "deploy: $SHA not ready (checks: $total, not green: $bad); will retry"
  exit 0
fi

echo "deploy: building $SHA"
docker tag jedforge-app:latest jedforge-app:prev 2>/dev/null || true
git reset -q --hard "$SHA"
"${COMPOSE[@]}" build app
"${COMPOSE[@]}" up -d

for _ in $(seq 1 40); do
  state=$(docker inspect -f '{{.State.Health.Status}}' jedforge-app-1 2>/dev/null || echo none)
  [ "$state" = healthy ] && { echo "$SHA" > /opt/jedforge/.deployed-sha; echo "deploy: $SHA live"; exit 0; }
  sleep 5
done

echo "deploy: $SHA failed its health check, rolling back" >&2
if docker image inspect jedforge-app:prev >/dev/null 2>&1; then
  docker tag jedforge-app:prev jedforge-app:latest
  "${COMPOSE[@]}" up -d --no-build app
fi
exit 1
