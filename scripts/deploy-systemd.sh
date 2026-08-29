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
[ -f pnpm-workspace.yaml ] && sudo cp pnpm-workspace.yaml "${TARGET_DIR}/"
if [ -f .env ]; then
  sudo cp .env "${TARGET_DIR}/.env"
  sudo chmod 600 "${TARGET_DIR}/.env"
fi
sudo chown -R slack-agy:developers "${TARGET_DIR}"
sudo chmod 775 "${TARGET_DIR}"

echo "=== [3/5] Installing production dependencies in ${TARGET_DIR} ==="
sudo -u slack-agy -H bash -c "cd '${TARGET_DIR}' && pnpm install --prod"

echo "=== [4/5] Installing systemd service ==="
NODE_PATH=$(which node)
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
ExecStart=${NODE_PATH} ${TARGET_DIR}/dist/index.js
Restart=always
RestartSec=5s

# Limits & Logging
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

echo "=== [5/5] Reloading systemd and enabling service ==="
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
echo "✓ Service '${SERVICE_NAME}' enabled."
echo ""
echo "🚀 To start the service, run:"
echo "   sudo systemctl start ${SERVICE_NAME}"
echo "   sudo systemctl status ${SERVICE_NAME}"
