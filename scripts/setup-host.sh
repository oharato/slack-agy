#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Slack-AGY Bridge: Linux Host Initial Setup Script
# ==============================================================================

echo "=== [1/5] Creating developers group ==="
if ! getent group developers >/dev/null; then
  sudo groupadd developers
  echo "✓ Created group 'developers'"
else
  echo "✓ Group 'developers' already exists"
fi

echo "=== [2/5] Creating service user 'slack-agy' ==="
if ! id -u slack-agy >/dev/null 2>&1; then
  sudo useradd -r -s /bin/bash -d /opt/slack-agy -m -G developers slack-agy
  echo "✓ Created service user 'slack-agy'"
else
  echo "✓ User 'slack-agy' already exists"
fi

echo "=== [3/5] Adding current user ($USER) to 'developers' group ==="
sudo usermod -aG developers "$USER"
echo "✓ Added $USER to 'developers' group"

echo "=== [4/5] Setting up shared workspace directory ==="
SHARED_ROOT="/var/workspace/shared"
sudo mkdir -p "${SHARED_ROOT}/repos"
sudo mkdir -p "${SHARED_ROOT}/worktrees"
sudo chown -R root:developers "${SHARED_ROOT}"
sudo chmod -R 2775 "${SHARED_ROOT}"

# POSIX ACL setting (if setfacl is available)
if command -v setfacl >/dev/null 2>&1; then
  sudo setfacl -R -d -m g:developers:rwx "${SHARED_ROOT}" || true
  sudo setfacl -R -m g:developers:rwx "${SHARED_ROOT}" || true
  echo "✓ Configured POSIX ACLs for ${SHARED_ROOT}"
fi
echo "✓ Shared workspace ready at ${SHARED_ROOT}"

echo "=== [5/5] Configuring sudoers for privilege runner ==="
SUDOERS_FILE="/etc/sudoers.d/slack-agy-bridge"
TMP_SUDOERS=$(mktemp)

cat << 'EOF' > "${TMP_SUDOERS}"
# Slack-AGY Bridge privilege runner rule
# Allows service user 'slack-agy' to run commands as members of 'developers' group without password
slack-agy ALL=(%developers) NOPASSWD: ALL
EOF

if sudo visudo -cf "${TMP_SUDOERS}"; then
  sudo cp "${TMP_SUDOERS}" "${SUDOERS_FILE}"
  sudo chmod 0440 "${SUDOERS_FILE}"
  rm -f "${TMP_SUDOERS}"
  echo "✓ Sudoers rule installed at ${SUDOERS_FILE}"
else
  echo "❌ Sudoers syntax check failed"
  rm -f "${TMP_SUDOERS}"
  exit 1
fi

echo ""
echo "🎉 Linux host setup completed successfully!"
