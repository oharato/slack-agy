#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Slack-AGY Bridge: One-Step All-In-One Automated Installer & Launcher
# ==============================================================================

SERVICE_NAME="slack-agy"
TARGET_DIR="/opt/slack-agy"
SHARED_ROOT="/var/workspace/shared"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SUDOERS_FILE="/etc/sudoers.d/slack-agy-bridge"

echo "================================================================="
echo " 🤖 Slack-AGY Bridge: Automated All-in-One Installer & Launcher"
echo "================================================================="
echo ""

# 0. 環境チェック
CURRENT_USER="${SUDO_USER:-$USER}"
echo "▶ [1/6] Environment Check..."
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is not installed."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ git is not installed."; exit 1; }
command -v agy >/dev/null 2>&1 || { echo "⚠️ agy CLI not found in PATH (ensure it is installed for users)."; }

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "⚠️ .env not found. Creating .env from .env.example..."
    cp .env.example .env
    echo "❗ Please edit .env with your SLACK_BOT_TOKEN / SLACK_APP_TOKEN before starting."
  else
    echo "❌ Neither .env nor .env.example found."; exit 1;
  fi
fi
echo "✓ Environment check passed."

# 1. グループ & サービスユーザー作成
echo ""
echo "▶ [2/6] Setting up Linux Users & Groups..."
if ! getent group developers >/dev/null; then
  sudo groupadd developers
  echo "✓ Created group 'developers'"
fi

if ! id -u slack-agy >/dev/null 2>&1; then
  sudo useradd -r -s /bin/bash -d "${TARGET_DIR}" -m -G developers slack-agy
  echo "✓ Created service user 'slack-agy'"
fi

sudo usermod -aG developers "${CURRENT_USER}"
echo "✓ Added '${CURRENT_USER}' to 'developers' group"

# 2. 共有ワークスペースディレクトリの作成
echo ""
echo "▶ [3/6] Configuring Shared Workspace (${SHARED_ROOT})..."
sudo mkdir -p "${SHARED_ROOT}/repos"
sudo mkdir -p "${SHARED_ROOT}/worktrees"
sudo chown -R root:developers "${SHARED_ROOT}"
sudo chmod -R 777 "${SHARED_ROOT}"
if command -v setfacl >/dev/null 2>&1; then
  sudo setfacl -R -d -m g:developers:rwx "${SHARED_ROOT}" 2>/dev/null || true
  sudo setfacl -R -m g:developers:rwx "${SHARED_ROOT}" 2>/dev/null || true
fi
echo "✓ Shared workspace ready at ${SHARED_ROOT}"

# 3. Sudoers 特権スイッチ設定
echo ""
echo "▶ [4/6] Configuring Sudoers Privilege Rules..."
TMP_SUDOERS=$(mktemp)
cat << 'EOF' > "${TMP_SUDOERS}"
# Slack-AGY Bridge privilege runner rule
# Allows service user 'slack-agy' to run commands as members of 'developers' group without password (root denied)
slack-agy ALL=(%developers) NOPASSWD: ALL
EOF

if sudo visudo -cf "${TMP_SUDOERS}" >/dev/null 2>&1; then
  sudo cp "${TMP_SUDOERS}" "${SUDOERS_FILE}"
  sudo chmod 0440 "${SUDOERS_FILE}"
  rm -f "${TMP_SUDOERS}"
  echo "✓ Sudoers rule installed at ${SUDOERS_FILE}"
else
  echo "❌ Sudoers syntax check failed."
  rm -f "${TMP_SUDOERS}"
  exit 1
fi

# 4. ビルド & /opt/slack-agy へのデプロイ
echo ""
echo "▶ [5/6] Building & Deploying to ${TARGET_DIR}..."
pnpm build

sudo mkdir -p "${TARGET_DIR}/logs"
sudo mkdir -p "${TARGET_DIR}/data"
sudo cp -r dist package.json pnpm-lock.yaml "${TARGET_DIR}/"
sudo cp .env "${TARGET_DIR}/.env"
sudo chmod 600 "${TARGET_DIR}/.env"

cd "${TARGET_DIR}"
sudo -u slack-agy -H pnpm install --prod --registry=https://npm.flatt.tech >/dev/null 2>&1 || sudo -u slack-agy -H pnpm install --prod
sudo chown -R slack-agy:developers "${TARGET_DIR}"
echo "✓ Deployed production build to ${TARGET_DIR}"

# 5. systemd サービス登録 & 起動
echo ""
echo "▶ [6/6] Installing & Starting systemd Service..."
NODE_BIN=$(which node)
AGY_BIN_DIR=$(dirname "$(which agy 2>/dev/null || echo '/usr/local/bin/agy')")
SYSTEM_PATH="/usr/local/bin:/usr/bin:/bin:${AGY_BIN_DIR}"

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

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"
echo "✓ systemd service '${SERVICE_NAME}' enabled and started."

echo ""
echo "================================================================="
echo " 🎉 Full Setup & Deployment Completed Successfully!"
echo "================================================================="
echo ""
echo "📊 Service Status:"
sudo systemctl --no-pager status "${SERVICE_NAME}" || true
echo ""
echo "📝 Useful Commands:"
echo "   • ログ監視:  journalctl -u ${SERVICE_NAME} -f"
echo "   • 再起動:    sudo systemctl restart ${SERVICE_NAME}"
echo "   • 停止:      sudo systemctl stop ${SERVICE_NAME}"
echo ""
