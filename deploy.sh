#!/bin/bash
set -euo pipefail

SERVER_USER="${SERVER_USER:-root}"
SERVER_HOST="${SERVER_HOST:-kenlauguico.com}"
REMOTE_PATH="${REMOTE_PATH:-/agnda}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"
APP_PROCESS_NAME="${APP_PROCESS_NAME:-static-page-server-8081}"
APP_PORT="${APP_PORT:-8081}"
ENABLE_PM2_SERVE="${ENABLE_PM2_SERVE:-1}"
PRIMARY_URL="${PRIMARY_URL:-https://agnda.kenlauguico.com/}"
SECONDARY_URL="${SECONDARY_URL:-https://agnda.kenlaugui.co/}"

printf '\nStarting AGNDA deployment\n'
printf 'Target server: %s@%s\n' "$SERVER_USER" "$SERVER_HOST"
printf 'Remote path: %s\n\n' "$REMOTE_PATH"

printf '1) Installing dependencies and building...\n'
npm install
npm run build

printf '2) Writing deploy metadata...\n'
DEPLOY_VERSION="$(date +%Y%m%d%H%M%S)"
cat > dist/version.json <<META
{"version":"$DEPLOY_VERSION","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
META

printf '3) Ensuring remote path exists...\n'
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" "mkdir -p '$REMOTE_PATH'"

printf '4) Syncing dist/ to server...\n'
rsync -avz --delete -e "ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=no" \
  dist/ "$SERVER_USER@$SERVER_HOST:$REMOTE_PATH/"

if [[ "$ENABLE_PM2_SERVE" == "1" ]]; then
  printf '5) Ensuring PM2 static process %s serves %s on port %s...\n' "$APP_PROCESS_NAME" "$REMOTE_PATH" "$APP_PORT"
  ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_HOST" "\
    if pm2 describe '$APP_PROCESS_NAME' >/dev/null 2>&1; then \
      pm2 restart '$APP_PROCESS_NAME' --update-env; \
    else \
      pm2 serve '$REMOTE_PATH' '$APP_PORT' --name '$APP_PROCESS_NAME'; \
    fi"
fi

printf '\nDeployment complete.\n'
printf 'Primary URL:   %s\n' "$PRIMARY_URL"
printf 'Secondary URL: %s\n\n' "$SECONDARY_URL"
