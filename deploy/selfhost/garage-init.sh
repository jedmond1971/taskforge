#!/bin/bash
# Idempotent Garage bootstrap, safe to re-run: single-node layout, bucket, the app's access key
# (restricted to that one bucket) and the CORS rules browsers need for presigned PUT/GET.
# Runs on the host because the Garage image has no shell. Never prints a secret.
set -euo pipefail
# shellcheck disable=SC1091
set -a; . /opt/jedforge/.env; set +a
G=(docker exec jedforge-garage-1 /garage)
BUCKET=${S3_BUCKET:-jedforge}

for _ in $(seq 1 30); do "${G[@]}" status >/dev/null 2>&1 && break; sleep 2; done
"${G[@]}" status >/dev/null

version=$("${G[@]}" layout show 2>/dev/null | sed -n 's/.*[Cc]urrent cluster layout version: \([0-9]*\).*/\1/p' | head -1)
if [ "${version:-0}" = 0 ]; then
  node_id=$("${G[@]}" status | awk '/^[0-9a-f]{16}/ {print $1; exit}')
  "${G[@]}" layout assign -z dc1 -c 1T "$node_id"
  "${G[@]}" layout apply --version 1
fi

"${G[@]}" bucket info "$BUCKET" >/dev/null 2>&1 || "${G[@]}" bucket create "$BUCKET"
"${G[@]}" key info "$S3_ACCESS_KEY" >/dev/null 2>&1 \
  || "${G[@]}" key import --yes -n jedforge-app "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
"${G[@]}" bucket allow --read --write --owner "$BUCKET" --key "$S3_ACCESS_KEY" >/dev/null

# Browsers upload with a presigned PUT straight to the public files hostname, from the app's origin.
cors=$(mktemp); trap 'rm -f "$cors"' EXIT
cat > "$cors" <<JSON
{"CORSRules":[{"AllowedOrigins":["$APP_ORIGIN"],"AllowedMethods":["GET","PUT","HEAD"],
"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}
JSON
docker run --rm --network jedforge_default -v "$cors:/cors.json:ro" \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" -e AWS_DEFAULT_REGION=garage \
  amazon/aws-cli --endpoint-url http://garage:3900 s3api put-bucket-cors \
  --bucket "$BUCKET" --cors-configuration file:///cors.json
echo "garage-init: bucket $BUCKET, app key and CORS ready"
