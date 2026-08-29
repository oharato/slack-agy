# 設定・セキュリティ・環境構築仕様 (Configuration & Setup Guide)

## 1. 環境変数設定 (`.env`)

### 1.1 設定項目一覧

| 環境変数名 | 必須 | デフォルト値 | 説明 |
| :--- | :---: | :--- | :--- |
| `SLACK_BOT_TOKEN` | **Yes** | - | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | **Yes** | - | Slack App-Level Token (`xapp-...`) ※Socket Mode 用 |
| `SLACK_SIGNING_SECRET` | No | - | Slack Signing Secret |
| `SLACK_USER_OS_MAPPINGS` | **Yes** | - | Slack User ID と OS ユーザーの対応表 (JSON形式: `{"U012345":"oharato","U098765":"alice"}`) |
| `ALLOWED_CHANNEL_IDS` | No | `""` (全許可) | 実行を許可する Channel ID のカンマ区切りリスト |
| `SHARED_WORKSPACE_ROOT` | No | `/var/workspace/shared` | 共有ワークスペースのルートディレクトリ |
| `DEFAULT_REPO` | No | `""` | 未指定時に使用するデフォルトリポジトリ名 |
| `DEFAULT_BASE_BRANCH` | No | `main` | Worktree 作成時のベースブランチ |
| `MAX_CONCURRENT_TASKS` | No | `2` | 同時に実行可能なタスク数の上限 |
| `TASK_TIMEOUT_MS` | No | `600000` (10分) | 1タスクあたりのタイムアウト時間（ミリ秒） |
| `DATA_DIR` | No | `./data` | セッション情報等の保存先ローカルディレクトリ |
| `LOG_DIR` | No | `./logs` | 構造化ログ（`app.jsonl`, `audit.jsonl`）の保存先ディレクトリ |
| `LOG_LEVEL` | No | `info` | ログ出力レベル (`debug` / `info` / `warn` / `error`) |
| `LOG_STDOUT` | No | `true` | 標準出力（stdout）への JSONL 出力有効化 (`true` / `false`) |
| `LOG_AUDIT_ENABLED` | No | `true` | セキュリティ監査ログ（`audit.jsonl`）の記録有効化 (`true` / `false`) |

---

## 2. 環境変数設定例 (`.env.example`)

```dotenv
# ==============================================================================
# Slack Authentication
# ==============================================================================
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-level-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here

# ==============================================================================
# Multi-User Mapping (Slack User ID ⇄ Linux OS User)
# ==============================================================================
# JSON 形式で Slack ユーザーとマシン上の OS ユーザーを紐付け
SLACK_USER_OS_MAPPINGS={"U0123456789":"oharato","U0987654321":"alice","U0555555555":"bob"}

# 実行を許可するチャンネル制限 (空欄の場合は制限なし)
ALLOWED_CHANNEL_IDS=C0123456789

# ==============================================================================
# Shared Workspace & Git Worktree Settings
# ==============================================================================
SHARED_WORKSPACE_ROOT=/var/workspace/shared
DEFAULT_REPO=my-backend-repo
DEFAULT_BASE_BRANCH=main

# 最大同時実行タスク数
MAX_CONCURRENT_TASKS=2

# タスクタイムアウト (ミリ秒: 600000 = 10分)
TASK_TIMEOUT_MS=600000

# Slack 進捗更新デバウンス間隔 (ミリ秒: レート制限対策)
PROGRESS_THROTTLE_MS=800

# 放置 Worktree の保持期間 (時間: 168 = 7日間)
WORKTREE_TTL_HOURS=168

# ==============================================================================
# Structured Logging (JSONL)
# ==============================================================================
LOG_DIR=./logs
LOG_LEVEL=info
LOG_STDOUT=true
LOG_AUDIT_ENABLED=true
LOG_MAX_DAYS=14
```

---

## 3. Linux ホスト環境構築 & デプロイ手順

### 🌟 全自動 1 ステップセットアップ（推奨）

以下のコマンドを実行するだけで、ホスト設定（ユーザー・グループ・共有ディレクトリ・sudoers・ACL）・本番ビルド・systemd サービス登録と起動が**すべて全自動**で行われます：

```bash
# 全自動セットアップ & systemd 常駐起動
pnpm run setup:all
```

---

### 3.1 手動セットアップ手順（詳細・参考用）

個別の手順を手動で実行したい場合や、既存環境にカスタマイズ適用したい場合は以下を参照してください：

#### 開発者グループ・サービス実行ユーザー・共有ディレクトリの作成

```bash
# 1. 開発者共通グループの作成
sudo groupadd developers

# 2. アプリ常駐専用のサービスユーザー (slack-agy) を作成
sudo useradd -r -s /bin/bash -d /opt/slack-agy -m -G developers slack-agy

# 3. 各開発者ユーザーを developers グループに追加
sudo usermod -aG developers oharato
sudo usermod -aG developers alice
sudo usermod -aG developers bob

# 4. 共有ディレクトリの作成 (/var/workspace/shared)
sudo mkdir -p /var/workspace/shared/repos
sudo mkdir -p /var/workspace/shared/worktrees

# 5. グループ所有権および Setgid (SGID) の付与
# (配下に作成された新規ファイル/フォルダが自動的に developers グループを継承)
sudo chown -R root:developers /var/workspace/shared
sudo chmod -R 2775 /var/workspace/shared

# 6. POSIX ACL によるデフォルト書き込み権限の付与
sudo apt-get install -y acl # 必要に応じて
sudo setfacl -R -d -m g:developers:rwx /var/workspace/shared
sudo setfacl -R -m g:developers:rwx /var/workspace/shared
```

> [!TIP]
> **ローカル開発環境 (`pnpm dev`) やパーミッションエラー (`EACCES`) 発生時の簡易設定**:
> `developers` グループの追加直後はログアウト/再ログインするまでグループが有効にならない場合があります。
> ローカルで即座に動作確認したい場合やテスト環境では、以下のコマンドで共有ディレクトリに全書き込み権限を付与できます：
> ```bash
> sudo chmod -R 777 /var/workspace/shared
> ```

---

### 3.2 Sudoers 設定 (特権スイッチの許可 & root 昇格防止)

サービス実行ユーザー `slack-agy` が、Slack からの指示に応じて各開発者ユーザー（`alice`, `bob`, `oharato` 等）として `agy`, `gh`, `git` などのコマンドを実行できるよう許可します。
セキュリティ上、**root への昇格を禁止し、`developers` グループの一般ユーザーへの切り替えのみ** に制限します。

`/etc/sudoers.d/slack-agy-bridge` を作成（`sudo visudo -f /etc/sudoers.d/slack-agy-bridge`）：

```sudoers
# slack-agy サービスユーザーが、developers グループに属する一般開発者としてのみ
# パスワードなしでコマンドを実行できるように制限 (root へのスイッチは拒否)
slack-agy ALL=(%developers) NOPASSWD: ALL
```

> [!TIP]
> さらに厳格にコマンドを制限したい場合は、以下のように対象バイナリのみに限定することも可能です：
> ```sudoers
> slack-agy ALL=(%developers) NOPASSWD: /usr/local/bin/agy, /usr/bin/gh, /usr/bin/git, /usr/bin/node
> ```

---

### 3.3 各開発者ユーザーの初期認証確認

各 OS ユーザー（`alice`, `bob`, `oharato` 等）でログインし、以下の認証が完了していることを確認します：

1. **Antigravity CLI 認証**:
   ```bash
   agy
   ```
2. **GitHub CLI (`gh`) 認証**:
   ```bash
   gh auth login
   gh auth status
   ```
3. **Git 設定**:
   ```bash
   git config --global user.name "Alice Developer"
   git config --global user.email "alice@example.com"
   ```

---

### 3.4 Worktree 内のシークレット保護 & 定期クリーンアップ

1. **共有 Worktree 内のシークレット漏洩防止**:
   - `/var/workspace/shared/worktrees` はグループ共有されるため、個人用トークンや `.env.local` などの機密ファイルは `.gitignore` に必ず記載し、リポジトリにコミットされないようにしてください。
2. **放置 Worktree の定期ガベージコレクション (cron 設定例)**:
   ```bash
   # 毎日深夜 3 時に 7 日以上放置された Worktree を自動削除
   0 3 * * * slack-agy node /opt/slack-agy/dist/workspace/worktreeCleaner.js >> /opt/slack-agy/logs/gc.log 2>&1
   ```


---

## 4. systemd による常駐化 & 自動起動設定 (`slack-agy.service`)

Linux の標準サービス管理機構 **systemd** を利用して、OS 起動時の自動起動・プロセス異常終了時の自動再起動・ログの一元管理を設定します。

### 4.1 アプリケーションの配置とビルド

```bash
# 1. /opt/slack-agy へソースコードを配置 (または git clone)
sudo cp -r . /opt/slack-agy
sudo chown -R slack-agy:developers /opt/slack-agy

# 2. 依存関係のインストールと TypeScript ビルド
cd /opt/slack-agy
sudo -u slack-agy -H pnpm install
sudo -u slack-agy -H pnpm build

# 3. 本番用環境変数ファイル (.env) の作成
sudo cp .env.example /opt/slack-agy/.env
sudo chown slack-agy:developers /opt/slack-agy/.env
sudo chmod 600 /opt/slack-agy/.env
sudo nano /opt/slack-agy/.env # Slack Token や User Mappings を設定
```

---

### 4.2 systemd ユニットファイルの作成

`/etc/systemd/system/slack-agy.service` を作成：

```ini
[Unit]
Description=Slack-AGY Bridge Service (Multi-user AI Agent Bridge)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=slack-agy
Group=developers
WorkingDirectory=/opt/slack-agy
EnvironmentFile=/opt/slack-agy/.env
ExecStart=/usr/bin/node /opt/slack-agy/dist/index.js
Restart=always
RestartSec=5s

# セキュリティ & リソース制限
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=slack-agy

# 環境設定
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

---

### 4.3 サービスの有効化 & 起動コマンド

```bash
# 1. systemd デーモンのリロード
sudo systemctl daemon-reload

# 2. サービスの自動起動有効化 (OS起動時に自動起動)
sudo systemctl enable slack-agy

# 3. サービスの即時起動
sudo systemctl start slack-agy

# 4. 稼働ステータスの確認
sudo systemctl status slack-agy
```

---

### 4.4 ログ確認 & 運用コマンド

```bash
# リアルタイムログ監視 (journald)
journalctl -u slack-agy -f

# JSONL アプリケーションログの確認
tail -f /opt/slack-agy/logs/app.jsonl | jq

# サービスの停止 / 再起動
sudo systemctl restart slack-agy
sudo systemctl stop slack-agy
```

