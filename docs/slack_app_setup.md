# Slack App セットアップ手順 (Slack App Setup Guide)

Slack-AGY Bridge を利用するために必要な Slack App の作成および設定手順です。
**Socket Mode** を利用するため、公開URLやngrok等の設定は不要です。

---

## 1. Slack App の新規作成 (Manifest を利用した 1-Click セットアップ推奨)

### 方法 A: App Manifest を利用（推奨・最速）

1. [Slack API: Applications](https://api.slack.com/apps) にアクセスします。
2. **「Create New App」** > **「From an app manifest」** を選択します。
3. ワークスペースを選択し、以下の YAML を貼り付けて **「Next」** > **「Create」** をクリックします：

```yaml
display_information:
  name: AGY Assistant
  description: Multi-user Google Antigravity CLI Bridge
  background_color: "#1a1a24"
features:
  bot_user:
    display_name: AGY
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - channels:history
      - groups:history
      - im:history
      - im:write
      - mpim:history
      - reactions:read
      - reactions:write
      - files:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
      - message.channels
      - message.groups
      - reaction_added
  socket_mode_enabled: true
```

---

### 方法 B: 手動で作成する場合

1. [Slack API: Applications](https://api.slack.com/apps) にアクセスします。
2. **「Create New App」** > **「From scratch」** を選択します。
3. **App Name** に `AGY Assistant` と入力し、インストール先ワークスペースを選択して **「Create App」** をクリックします。

---

## 2. Socket Mode の有効化 & App-Level Token の生成

1. 左側メニューの **「Socket Mode」** をクリックします。
2. **「Enable Socket Mode」** のトグルを **ON** にします。
3. ポップアップが表示されたら、以下を設定してトークンを生成します：
   - **Token Name**: `socket-token`（任意）
   - **Scope**: `connections:write`（自動選択）
4. 生成された **App-Level Token (`xapp-...`)** をコピーし、`.env` の `SLACK_APP_TOKEN` に設定します。

---

## 3. Bot Token Scopes の確認

手動作成の場合は、左側メニュー **「OAuth & Permissions」** > **「Bot Token Scopes」** に以下が追加されていることを確認します：

| スコープ名 | 用途 |
| :--- | :--- |
| `app_mentions:read` | チャンネル内での `@agy` メンション受信 |
| `chat:write` | スレッド・チャンネルへのメッセージ返信・進捗更新 |
| `channels:history` | パブリックチャンネル内のスレッド文脈取得 |
| `groups:history` | プライベートチャンネル内のスレッド文脈取得 |
| `im:history` | DM（ダイレクトメッセージ）履歴取得 |
| `im:write` | DM へのメッセージ送信 |
| `mpim:history` | グループDM履歴取得 |
| `reactions:read` | リアクション確認（承認・質問選択の検知） |
| `reactions:write` | 実行中・完了時のリアクション（⏳, ⚙️, ✅, ❌）および選択肢スタンプ付与 |
| `files:write` | 4,000文字超過時のコード差分・ログスニペットの自動アップロード |

---

## 4. Event Subscriptions (イベント購読) の確認

左側メニュー **「Event Subscriptions」** で以下が登録されていることを確認します：
- `app_mention`: メンションの受信
- `message.im`: DM メッセージの受信
- `reaction_added`: スタンプ（絵文字リアクション）押下イベントの受信（ユーザー承認・質問回答用）

---

## 5. ワークスペースへのインストール & Bot Token 取得

1. 左側メニューの **「Install App」** をクリックします。
2. **「Install to Workspace」** をクリックし、権限を許可します。
3. 表示された **Bot User OAuth Token (`xoxb-...`)** をコピーし、`.env` の `SLACK_BOT_TOKEN` に設定します。
4. （任意）左側メニューの **「Basic Information」** > **「App Credentials」** から **Signing Secret** をコピーし、`SLACK_SIGNING_SECRET` に設定します。

---

## 6. Slack チャンネルへの Bot 招待

1. `agy` を利用したい Slack チャンネルを開きます。
2. チャンネル内で `/invite @AGY`（作成したBot名）を実行して Bot をチャンネルに招待します。
3. メンバーの Slack User ID（プロフィール画面の「その他」>「メンバーIDをコピー」: `UXXXXXXXXXX`）を `.env` の `SLACK_USER_OS_MAPPINGS` にマッピング登録します。
