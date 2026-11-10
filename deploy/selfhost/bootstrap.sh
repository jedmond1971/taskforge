#!/bin/bash
# One-time (and safe to re-run) setup of a fresh Debian VM for self-hosted JedForge.
#   sudo -u jamie bash bootstrap.sh [/path/to/jedforge-handoff.env]
# Needs Docker + compose plugin already installed. Never prints a secret value.
set -euo pipefail

ROOT=/opt/jedforge
HANDOFF=${1:-}
sudo mkdir -p "$ROOT"/{data/postgres,data/garage,backups}
sudo chown -R "$USER":"$USER" "$ROOT"

# BRANCH lets a rehearsal run from an unmerged branch; the default (main) is what production uses.
[ -d "$ROOT/repo/.git" ] || git clone -q --branch "${BRANCH:-main}" https://github.com/jedmond1971/taskforge.git "$ROOT/repo"

ENV=$ROOT/.env
[ -f "$ENV" ] || { cp "$ROOT/repo/deploy/selfhost/.env.example" "$ENV"; chmod 600 "$ENV"; }

# set_kv KEY VALUE -- replace the line, keeping the file's other content (value never echoed)
set_kv() { local k=$1 v=$2; grep -q "^$k=" "$ENV" && sed -i "s|^$k=.*|$k=$(printf '%s' "$v" | sed 's/[&|\\]/\\&/g')|" "$ENV" || echo "$k=$v" >> "$ENV"; }
get_kv() { grep "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
rand() { openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-40; }

# Generate each secret once; a re-run must not rotate the database password out from under data.
[ -n "$(get_kv POSTGRES_PASSWORD)" ] || set_kv POSTGRES_PASSWORD "$(rand)"
[ -n "$(get_kv S3_ACCESS_KEY)" ] || set_kv S3_ACCESS_KEY "GK$(openssl rand -hex 12)"
[ -n "$(get_kv S3_SECRET_KEY)" ] || set_kv S3_SECRET_KEY "$(openssl rand -hex 32)"

# Garage config: generated once (rpc_secret must not change under existing data).
if [ ! -f "$ROOT/garage.toml" ]; then
  sed "s|__RPC_SECRET__|$(openssl rand -hex 32)|" "$ROOT/repo/deploy/selfhost/garage.toml" > "$ROOT/garage.toml"
  chmod 600 "$ROOT/garage.toml"
fi
mkdir -p "$ROOT"/data/garage/{meta,data}
[ -n "$(get_kv AUTH_SECRET)" ] || set_kv AUTH_SECRET "$(openssl rand -base64 32)"
[ -n "$(get_kv V1_API_KEY)" ] || set_kv V1_API_KEY "$(openssl rand -base64 32)"

# Values supplied by the handoff file (only keys that already exist in .env.example are imported).
if [ -n "$HANDOFF" ] && [ -f "$HANDOFF" ]; then
  while IFS='=' read -r k v; do
    k=${k%$'\r'}; v=${v%$'\r'}
    case "$k" in
      CLOUDFLARE_TUNNEL_TOKEN|RESEND_API_KEY|ALERT_EMAIL_TO|V1_API_KEY|AUTH_SECRET|APP_ORIGIN|S3_PUBLIC_ENDPOINT)
        [ -n "$v" ] && set_kv "$k" "$v" ;;
    esac
  done < <(grep -E '^[A-Z0-9_]+=' "$HANDOFF")
fi

sudo cp "$ROOT"/repo/deploy/selfhost/systemd/jedforge-*.{service,timer} /etc/systemd/system/
sudo chmod +x "$ROOT"/repo/deploy/selfhost/*.sh
sudo apt-get install -y -qq jq rsync >/dev/null
sudo systemctl daemon-reload
# Backups run from day one. The deploy and cleanup timers only make sense once this box is the
# live instance (deploy resets the checkout to origin/main; cleanup acts on the real bucket), so
# they wait for GO_LIVE=1, which the cutover step sets.
sudo systemctl enable --now jedforge-backup.timer >/dev/null
if [ "${GO_LIVE:-0}" = 1 ]; then
  for t in deploy cleanup; do sudo systemctl enable --now "jedforge-$t.timer" >/dev/null; done
fi

echo "bootstrap done. Missing values in $ENV:"
grep -E '^[A-Z0-9_]+=$' "$ENV" | cut -d= -f1 | sed 's/^/  /' || true
