# Slack-AGY Bridge (Agent Bridge)

Slack から Google Antigravity CLI (`agy`) および OpenAI Codex CLI (`codex`) を呼び出し、Linux ホスト上で安全かつ自律的な調査・開発タスクを実行するためのマルチユーザー対応 AI エージェントブリッジシステムです。

---

## 🚀 クイックスタート（全自動 1 ステップセットアップ）

設定ファイル（`.env`）を用意してワンコマンドを実行するだけで、ホスト設定・権限・ビルド・systemd常駐化がすべて完了します：

```bash
# 1. 設定ファイルの準備
cp .env.example .env
# .env を編集して SLACK_BOT_TOKEN / SLACK_APP_TOKEN / SLACK_USER_OS_MAPPINGS を入力
# 必要に応じて DEFAULT_AGENT=agy または DEFAULT_AGENT=codex を指定

# 2. 全自動セットアップ & systemd 常駐起動
pnpm run setup:all
```

> **💡 `pnpm run setup:all` が自動実行する内容**:
> 1. `developers` グループおよび `slack-agy` サービスユーザーの作成
> 2. 共有ディレクトリ `/var/workspace/shared`（repos/worktrees）の作成・ACL権限付与
> 3. Sudoers 特権スイッチ設定（root昇格禁止ルール）の安全な配置
> 4. TypeScript 本番ビルド & `/opt/slack-agy` への成果物配置
> 5. systemd サービス（`slack-agy.service`）の自動登録・即時起動

---

## 📚 ドキュメント構成

| ドキュメント | 主な内容 |
| :--- | :--- |
| **[1. システム全体構成](./docs/system_architecture.md)** | 全体アーキテクチャ図、コンポーネント構成、OSユーザーマッピング、Git Worktree 統合、共有ワークスペース、シーケンス図 |
| **[2. 機能要件・Slack仕様](./docs/functional_specification.md)** | メンション/DMトリガー、エージェント切替（`!agent`, `agent:`）、コマンド体系（`!help`, `!repo`, `!pr`, `!status`, `!clean`, `!reset`, `!cancel`）、スタンプ承認（✅/❌, 1️⃣/2️⃣）、4,000文字対策、セキュリティガードレール |
| **[3. 技術設計・実装詳細](./docs/technical_design.md)** | Node 24 LTS & TS 7、Agent Adapter 抽象化（AGY / Codex CLI）、SQLite セッションストア & Durable Job Queue、特権スイッチ（sudo）、BaseRepo Mutex、Worktree GC、Rate Limit 対策（800ms デバウンス）、JSONL 構造化ログ |
| **[4. 設定・セキュリティ・環境構築](./docs/configuration_guide.md)** | 環境変数一覧（`DEFAULT_AGENT` 含む）、専用サービスユーザー (`slack-agy`)、厳格な sudoers 設定（root 昇格防止）、Worktree シークレット保護、systemd 自動起動 |
| **[5. Slack App 設定ガイド](./docs/slack_app_setup.md)** | Slack App Manifest (YAML/JSON)、Socket Mode、OAuth Scopes (`files:write`, `reactions:write` 等)、Event Subscriptions |
| **[6. プラットフォーム・エージェント抽象化設計](./docs/platform_agent_abstraction_design.md)** | Slack/AGY 依存を分離し、Codex CLI を含む任意のチャットツール・AIエージェントを差し替えるための設計と移行計画 |

---

## 🎯 アーキテクチャの主要な特徴と強み

1. **マルチエージェント対応 (Antigravity `agy` & OpenAI Codex `codex`)**:
   - スレッド開始時またはプロンプト内でエージェントを自由に選択（`!agent codex`, `agent:codex`）。
   - エージェントごとのストリーミング出力（JSONL / stream-json）を共通 `AgentEvent` に正規化し、進捗や結果を統一的にレンダリング。
2. **マルチユーザー & OS ユーザー認証連携 (Slack User ⇄ Linux OS User)**:
   - Slack の各ユーザーをホストマシンの Linux ユーザーアカウントと 1:1 で紐付け。
   - `agy`, `codex`, `gh` (GitHub CLI), `git` は各ユーザー自身のホームディレクトリ・認証情報（`~/.config/gh`, `~/.codex`, `~/.gemini/antigravity-cli`, SSH 秘密鍵等）を用いて実行され、他人の情報への不正アクセスを完全防止。
3. **SQLite 永続化セッション & 耐障害性ジョブキュー (Durable Job Queue)**:
   - Node 24 組み込み `node:sqlite`（WAL モード）による高速・安全なセッション永続化。
   - 再起動時も安全な状態遷移（未完了ジョブの安全な中断と履歴保持）。
4. **Git Worktree & 排他ロック (`RepoMutex`) による完全な並行開発**:
   - 複数ユーザーが同じリポジトリに対して同時に指示を出しても衝突しないよう、スレッドごとに **Git Worktree** を動的に作成。
   - 同一ベースリポジトリへの同時アクセス競合（`.git/index.lock`）をインメモリ Mutex で排他制御。
5. **インタラクティブ承認・スタンプ連携 (Interactive Reaction Approvals)**:
   - 危険コマンドやデプロイの承認、実装方針の質問（`ask_question`）時に、スレッド内にスタンプ（✅/❌ や 1️⃣/2️⃣/3️⃣）を自動付与。
   - ユーザー本人のスタンプ押下をトリガーにプロセスが自動再開（5分タイムアウト保護付き）。
6. **Slack Block Kit Markdown ブロックによる表（Table）& リッチフォーマット表示**:
   - Slack 公式の `markdown` ブロックを採用し、Markdown の **表（Table）** やシンタックスハイライト付きコードブロック、タスクリスト、見出しをネイティブに美しくレンダリング。
   - 10,000文字までの直接リッチ描画と、巨大ログ時の自動スニペットファイル添付（`files.uploadV2`）に対応。
7. **Slack API レート制限対策 (ProgressThrottler)**:
   - 高速なエージェントストリーミング出力を **800ms 間隔でバッファリング更新** し、Slack API の Rate Limit（HTTP 429）を回避。
8. **堅牢なセキュリティ & 監査ログ (JSONL Audit Trail)**:
   - 専用サービスユーザー `slack-agy` でデーモン常駐し、sudoers で root への昇格を禁止（`ALL=(%developers)`）。
   - すべての操作証跡を `logs/audit.jsonl`、システム稼働状態を `logs/app.jsonl` に O(1) ストリーム追記。
9. **放置 Worktree の自動ガベージコレクション (`WorktreeCleaner`)**:
   - タスク完了後に放置された Worktree を TTL（デフォルト: 7日間）に基づいて定期的に自動削除し、ディスク容量を保護。
10. **ポート開放不要の Socket Mode & systemd 常駐**:
    - ファイアウォール内やローカルマシンでも安全に常駐稼働。OS 起動時の自動起動とクラッシュ時自動復旧に対応。
11. **高速・最新の開発ツールチェーン**:
    - **Node.js 24 LTS**, **pnpm 11**, **TypeScript 7.x**, **Vitest 4.x**, **Oxlint 1.x**, **Oxfmt 0.x**（7日間のサプライチェーンクールダウンを遵守）。

