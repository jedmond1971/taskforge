#!/bin/bash
# Nightly: compressed pg_dump + an S3-level mirror of the bucket (via rclone, so a restore is just
# the reverse sync). Files that were deleted or overwritten since the last run are kept for 14 days
# under files-changed/<date>/. These sit on the same VM disk; the off-VM copy is the Proxmox vzdump
# of the whole VM (see .context-docs/self-hosting.md). Exits non-zero on any failure so systemd
# marks the unit failed.
set -euo pipefail
# shellcheck disable=SC1091
set -a; . /opt/jedforge/.env; set +a
BACKUP_ROOT=/opt/jedforge/backups
DAY=$(date +%F)
mkdir -p "$BACKUP_ROOT/db" "$BACKUP_ROOT/files/current" "$BACKUP_ROOT/files-changed"

docker exec jedforge-db-1 pg_dump -U taskforge -d taskforge --no-owner --clean --if-exists \
  | gzip -9 > "$BACKUP_ROOT/db/taskforge-$DAY.sql.gz.tmp"
# A truncated dump must never replace a good one.
gzip -t "$BACKUP_ROOT/db/taskforge-$DAY.sql.gz.tmp"
mv "$BACKUP_ROOT/db/taskforge-$DAY.sql.gz.tmp" "$BACKUP_ROOT/db/taskforge-$DAY.sql.gz"

docker run --rm --network jedforge_default \
  -v "$BACKUP_ROOT/files:/backup" \
  -e RCLONE_CONFIG_GARAGE_TYPE=s3 -e RCLONE_CONFIG_GARAGE_PROVIDER=Other \
  -e RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
  -e RCLONE_CONFIG_GARAGE_ENDPOINT=http://garage:3900 -e RCLONE_CONFIG_GARAGE_REGION=garage \
  rclone/rclone:latest sync "GARAGE:${S3_BUCKET:-jedforge}" /backup/current \
  --backup-dir "/backup/changed-$DAY" --quiet
[ -d "$BACKUP_ROOT/files/changed-$DAY" ] && mv "$BACKUP_ROOT/files/changed-$DAY" "$BACKUP_ROOT/files-changed/$DAY"

find "$BACKUP_ROOT/db" -name 'taskforge-*.sql.gz' -mtime +14 -delete
find "$BACKUP_ROOT/files-changed" -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
echo "backup ok: $DAY ($(du -h "$BACKUP_ROOT/db/taskforge-$DAY.sql.gz" | cut -f1) db)"
