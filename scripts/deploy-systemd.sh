#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Slack-AGY Bridge: systemd Service Deployment Script
# ==============================================================================

SERVICE_NAME="slack-agy"
TARGET_DIR="/opt/slack-agy"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "=== [1/5] Building project ==="
pnpm install
pnpm build

echo "=== [2/5] Deploying files to ${TARGET_DIR} ==="
sudo mkdir -p "${TARGET_DIR}/logs"
sudo mkdir -p "${TARGET_DIR}/data"
sudo cp -r dist package.json pnpm-lock.yaml "${TARGET_DIR}/"
[ -f .npmrc ] && sudo cp .npmrc "${TARGET_DIR}/"
[ -f .mise.toml ] && sudo cp .mise.toml "${TARGET_DIR}/"
[ -f pnpm-workspace.yaml ] && sudo cp pnpm-workspace.yaml "${TARGET_DIR}/"
[ -d node_modules ] && sudo cp -r node_modules "${TARGET_DIR}/"
if [ -f .env ]; then
  sudo cp .env "${TARGET_DIR}/.env"
  sudo chmod 600 "${TARGET_DIR}/.env"
fi
sudo chown -R slack-agy:developers "${TARGET_DIR}"
sudo chmod -R 775 "${TARGET_DIR}"

# サービスユーザーが node/pnpm を実行できるよう、ホームディレクトリの探索権限(x)を付与
sudo setfacl -m u:slack-agy:rx "${HOME}" 2>/dev/null || sudo chmod a+x "${HOME}" 2>/dev/null || true

NODE_BIN=$(which node)
NODE_DIR=$(dirname "${NODE_BIN}")
PNPM_BIN=$(which pnpm)
AGY_BIN_DIR=$(dirname "$(which agy 2>/dev/null || echo '/usr/local/bin/agy')")
MISE_SHIMS="${HOME}/.local/share/mise/shims:${HOME}/.local/bin"
SYSTEM_PATH="${NODE_DIR}:${MISE_SHIMS}:${AGY_BIN_DIR}:/usr/local/bin:/usr/bin:/bin"

echo "=== [3/5] Installed production dependencies in ${TARGET_DIR} ==="

echo "=== [4/5] Installing systemd service ==="
cat << EOF | sudo tee "${SERVICE_FILE}" > /dev/null
[Unit]
Description=Slack-AGY Bridge Service (Multi-user AI Agent Bridge)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=slack-agy
Group=developers
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=${TARGET_DIR}/.env
ExecStart=${NODE_BIN} ${TARGET_DIR}/dist/index.js
Restart=always
RestartSec=5s

# Limits & Logging
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

Environment=NODE_ENV=production
Environment=PATH=${SYSTEM_PATH}

[Install]
WantedBy=multi-user.target
EOF

echo "=== [5/5] Reloading systemd and restarting service ==="
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
echo "✓ Service '${SERVICE_NAME}' updated and restarted."
echo ""
echo "🚀 Service is running! Status:"
sudo systemctl --no-pager status "${SERVICE_NAME}" || true
