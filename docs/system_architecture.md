# システム全体構成 (System Architecture)

## 1. 概要

Slack-AGY Bridge は、Slack 上の複数ユーザーからの指示をトリガーとして、ローカルマシン上の Google Antigravity CLI (`agy`) や GitHub CLI (`gh`) を実行するマルチユーザー対応ブリッジシステムです。

本システムは以下の要件を満たすよう設計されています：
- **Node.js 24 LTS & TypeScript 7** による堅牢な基盤
- **Slack ユーザー ⇄ Linux OS ユーザーの紐付け**: 各ユーザーの認証情報（AGY 設定、GitHub Token、SSH 鍵）でプロセスを実行
- **Git Worktree の活用**: 共有リポジトリからスレッドごとに独立した作業ツリーを動的に作成し、複数人の並行作業でも競合しない開発環境を提供
- **全ユーザー共有ワークスペース**: 適切なグループ権限・ACL 設計により、共通のベースリポジトリと作業ディレクトリを運用
- **Socket Mode (WebSocket)**: ポート開放不要で安全に稼働

---

## 2. システム構成図

```mermaid
flowchart TB
    subgraph SlackCloud["Slack Cloud"]
        UserA["Slack User A (@alice)"]
        UserB["Slack User B (@bob)"]
        SocketServer["Slack Socket Mode Server (WebSocket)"]
        UserA -->|Mention / DM| SocketServer
        UserB -->|Mention / DM| SocketServer
    end

    subgraph LocalMachine["Local Machine (Linux / Node.js 24 LTS)"]
        subgraph BridgeProcess["Slack-AGY Bridge Process (TypeScript 7)"]
            BoltApp["@slack/bolt (Socket Mode)"]
            UserMapper["User Mapping Manager<br/>(Slack User ID ⇄ Linux OS User)"]
            SessionMgr["Session & Worktree Manager<br/>(thread_ts ⇄ Worktree & conversation_id)"]
            TaskQueue["Concurrent Task Queue<br/>(Thread Mutex & Resource Limiter)"]
            PrivilegeRunner["Privilege Runner<br/>(sudo -u [os_user] -H)"]
            StreamParser["NDJSON Stream Parser"]
            InteractionMgr["Interaction Manager<br/>(Reactions ⇄ Approval / Question)"]
            SlackNotifier["Slack Notifier & Formatter"]
            StructuredLogger["Structured Logger (JSONL)<br/>(app.jsonl & audit.jsonl)"]

            BoltApp --> UserMapper
            UserMapper --> SessionMgr
            SessionMgr --> TaskQueue
            TaskQueue --> PrivilegeRunner
            PrivilegeRunner --> StreamParser
            StreamParser --> SlackNotifier
            StreamParser --> InteractionMgr
            InteractionMgr --> SlackNotifier
            StreamParser -.-> StructuredLogger
        end

        subgraph OSUsers["Linux OS User Contexts & Credentials"]
            UserCtxA["OS User: alice<br/>HOME: /home/alice<br/>~/.config/gh (Alice Token)<br/>~/.gemini/antigravity-cli"]
            UserCtxB["OS User: bob<br/>HOME: /home/bob<br/>~/.config/gh (Bob Token)<br/>~/.gemini/antigravity-cli"]
        end

        subgraph SharedWorkspace["Shared Workspace Root (/var/workspace/shared)"]
            subgraph ReposDir["Base Repositories (/var/workspace/shared/repos/)"]
                BaseRepo["backend-service.git (Bare or Main Clone)"]
            end
            subgraph WorktreesDir["Active Worktrees (/var/workspace/shared/worktrees/)"]
                WorktreeA["worktree_thread_123/<br/>(Branch: feat/alice-fix)"]
                WorktreeB["worktree_thread_456/<br/>(Branch: feat/bob-feature)"]
            end
        end

        PrivilegeRunner -->|Exec as alice| UserCtxA
        PrivilegeRunner -->|Exec as bob| UserCtxB
        UserCtxA -->|Runs agy & gh inside| WorktreeA
        UserCtxB -->|Runs agy & gh inside| WorktreeB
        WorktreeA -.->|Git Worktree Ref| BaseRepo
        WorktreeB -.->|Git Worktree Ref| BaseRepo
    end

    SocketServer <-->|Secure WSS Connection| BoltApp
    SlackNotifier -->|WSS Updates| SocketServer
```

---

## 3. シーケンス図 (マルチユーザー & Git Worktree 連携フロー)

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Slack User (Alice)
    participant Slack as Slack (Socket Mode)
    participant Bridge as Bridge Server (Node.js 24)
    participant UserMap as User Mapping Manager
    participant WT as Worktree Manager
    participant Session as Session Store
    participant AGY as agy CLI (as OS user 'alice')

    Alice->>Slack: @agy repo:backend-service 認証APIの型エラーを直して
    Slack->>Bridge: app_mention イベント受信 (WSS)

    Bridge->>UserMap: Slack User ID (U_ALICE) から OS ユーザーを取得
    alt マッピングなし
        Bridge-->>Slack: ⚠️ OS ユーザーが紐付けられていません
    end
    UserMap-->>Bridge: OS User = 'alice'

    Bridge->>Slack: ⏳ 受付中 & スレッド作成

    Bridge->>WT: スレッド用 Worktree の準備 (BaseRepo: backend-service)
    alt Worktree 未作成
        WT->>WT: git worktree add /var/workspace/shared/worktrees/wt_thread_123 -b feat/alice-thread-123
        WT-->>Bridge: 作業ディレクトリ = /var/workspace/shared/worktrees/wt_thread_123
    else 既存 Worktree あり
        WT-->>Bridge: 既存パス返却
    end

    Bridge->>Session: スレッドに紐づく conversation_id を確認

    Bridge->>AGY: sudo -u alice -H -- agy -p "..." --output-format stream-json --dangerously-skip-permissions (in Worktree)

    loop NDJSON ストリーミング出力
        AGY-->>Bridge: {"event":"step_update", "tool_name":"run_command", "CommandLine":"gh issue view 42"}
        Bridge->>Slack: 進捗更新 (⚙️ `run_command`: gh issue view 42 実行中...)
    end

    AGY-->>Bridge: {"event":"result", "status":"SUCCESS", "response":"修正を完了しコミットしました。"}
    Bridge->>Slack: ✅ 完了通知 & 結果メッセージ投稿
    Bridge->>Session: conversation_id, worktree_path, branch 名を保存
```

---

## 4. 主要コンポーネントの責務

### 4.1 User Mapping Manager (`src/handlers/userMapper.ts`)
- Slack のユーザー ID (`Uxxxxxxxxxx`) と Linux 上のローカルユーザー名（例: `alice`, `bob`, `oharato`）の対応関係を管理。
- 未登録ユーザーからの呼び出しを拒否するセキュリティゲートウェイとして機能。

### 4.2 Worktree & Workspace Manager (`src/workspace/worktreeManager.ts`)
- 共有ワークスペース（`/var/workspace/shared` 等）内のベースリポジトリを管理。
- Slack スレッド開始時に `git worktree add` を実行し、スレッド専用のブランチと独立作業ディレクトリを作成。
- スレッド終了時（`!reset` や `!done`）に `git worktree remove` によるクリーンアップを実施。
- リポジトリの新規 clone（`git clone` / `gh repo clone`）を OS ユーザー権限で代行。

### 4.3 Privilege Runner (`src/runner/privilegeRunner.ts`)
- `sudo -u <os_user> -H -- ...` を利用して、指定した OS ユーザーとして `agy` や `gh`、`git` プロセスを起動。
- 対象ユーザーの `$HOME`、`PATH`、`USER`、`XDG_CONFIG_HOME` などの環境変数を安全にロード。
- `~/.config/gh/`（GitHub CLI 認証トークン）や `~/.gemini/antigravity-cli/`（AGY 設定・認証）がそのまま適用される。

### 4.4 Session Manager (`src/session/sessionStore.ts`)
- Slack スレッド ID (`channel_id:thread_ts`) に対し、以下の情報を一元管理・永続化：
  - OS ユーザー名
  - AGY `conversation_id`
  - 対象リポジトリ & ブランチ名
  - 作成された Git Worktree パス
  - 最終アクティブ日時

### 4.5 Structured Logger (`src/logger/logger.ts` & `src/logger/auditLogger.ts`)
- **JSONL (NDJSON) 形式による構造化ログ**: 全アプリケーションログ (`logs/app.jsonl`) およびセキュリティ監査ログ (`logs/audit.jsonl`) を 1 行 1 JSON 形式でストリーム追記。
- **リクエストトレーサビリティ**: `traceId` や Slack コンテキスト（`userId`, `channelId`, `threadTs`）、OS ユーザー名を各ログエントリに自動バインド。
- **AGY NDJSON 出力との統一**: AGY の実行イベントと Bridge のライフサイクルイベントを一貫したフォーマットで蓄積し、DuckDB や `jq` での高速クエリ・監視を実現。

### 4.6 Interaction Manager (`src/interaction/interactionManager.ts`)
- **スタンプ（絵文字リアクション）連携**: AGY がユーザーに実行確認や質問（`ask_question`）を求めた際、スレッドに確認メッセージを投稿して選択肢スタンプ（✅/❌ や 1️⃣/2️⃣/3️⃣）を自動付与。
- **権限者検証 & Promise 待機制御**: 該当スレッドの担当 Slack ユーザー本人がスタンプを押すまで非同期に待機し、押下されたスタンプに応じて AGY サブプロセスに入力を渡して自動再開。
- **5分タイムアウト保護**: 応答がない場合の自動キャンセル処理および二重実行防止。

### 4.7 Progress Throttler & Message Chunker (`src/formatter/`)
- **ProgressThrottler**: 高頻度な AGY ストリーミング出力を 800ms〜1秒間隔でバッファリング更新し、Slack API の Rate Limit（429 Too Many Requests）を回避。
- **MessageChunker**: 4,000 文字制限を超える長文レスポンスや diff を自動検知し、`files.uploadV2` を介してスニペットファイルとして添付。

### 4.8 Repo Mutex & Worktree Cleaner (`src/workspace/`)
- **RepoMutex**: 同一 BaseRepo に対する並行 `git worktree add` / `git fetch` 実行時の `.git/index.lock` 競合を防止するインメモリ排他ロック。
- **WorktreeCleaner**: 放置された Worktree（TTL: 7日間）を自動検出・削除し、共有ディスクの枯渇を防止するガベージコレクション。



