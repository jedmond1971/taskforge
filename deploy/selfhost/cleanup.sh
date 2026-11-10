#!/bin/bash
# Replaces .github/workflows/cleanup-orphaned-attachments.yml on the self-hosted box: calls the
# same endpoint locally, so the V1_API_KEY never needs to live in a GitHub secret. Prints the
# HTTP status and numeric fields only (same discipline as the workflow's log).
set -uo pipefail
# shellcheck disable=SC1091
set -a; . /opt/jedforge/.env; set +a
body=$(mktemp); trap 'rm -f "$body"' EXIT
status=$(curl -s -o "$body" -w '%{http_code}' --max-time 90 -X POST \
  -H "X-Internal-Api-Key: ${V1_API_KEY}" "http://127.0.0.1:3000/api/internal/cleanup-orphaned-attachments${1:+?dryRun=1}") || status=000
echo "HTTP status: $status"
jq -r 'def n(f): (f | numbers) // "-";
  "scanned=\(n(.scanned)) candidates=\(n(.candidates)) wouldDelete=\(n(.wouldDelete)) deleted=\(n(.orphansDeleted)) stopReason=\((.stopReason | strings | select(test("^[a-z_]{1,40}$"))) // "none")"' \
  "$body" 2>/dev/null | tr -cd 'A-Za-z0-9_= \n-' || true
# 409 = the endpoint refused to delete and alerted the owner; 000 = no response.
[ "$status" = 200 ]
