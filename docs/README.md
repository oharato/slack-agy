# Slack-AGY Bridge 設計仕様書

Slack から Google Antigravity CLI (`agy`) を呼び出し、ローカルホスト上で自律的な調査・開発タスクを実行するためのマルチユーザー対応ブリッジシステムの統合設計仕様書です。

---

## 📚 ドキュメント構成

| ドキュメント | 主な内容 |
| :--- | :--- |
| **[1. システム全体構成 (system_architecture.md)](file:///home/oharato/workspace/slack-agy/docs/system_architecture.md)** | 全体アーキテクチャ図、コンポーネント構成、OSユーザーマッピング、Git Worktree 統合、共有ワークスペース、シーケンス図 |
| **[2. 機能要件・Slack仕様 (functional_specification.md)](file:///home/oharato/workspace/slack-agy/docs/functional_specification.md)** | メンション/DMトリガー、コマンド体系（`!help`, `!repo`, `!pr`, `!status`, `!clean`）、スタンプ承認（✅/❌, 1️⃣/2️⃣）、4,000文字対策、セキュリティガードレール |
| **[3. 技術設計・実装詳細 (technical_design.md)](file:///home/oharato/workspace/slack-agy/docs/technical_design.md)** | Node 24 LTS & TS 7、特権スイッチ（sudo）、BaseRepo Mutex、Worktree GC、Rate Limit 対策（800ms デバウンス）、JSONL 構造化ログ |
| **[4. 設定・セキュリティ・環境構築 (configuration_guide.md)](file:///home/oharato/workspace/slack-agy/docs/configuration_guide.md)** | 環境変数一覧、専用サービスユーザー (`slack-agy`)、厳格な sudoers 設定（root 昇格防止）、Worktree シークレット保護、systemd 自動起動 |
| **[5. Slack App 設定ガイド (slack_app_setup.md)](file:///home/oharato/workspace/slack-agy/docs/slack_app_setup.md)** | Slack App Manifest (YAML/JSON)、Socket Mode、OAuth Scopes (`files:write`, `reactions:write` 等)、Event Subscriptions |

---

## 🎯 アーキテクチャの主要な特徴と強み

1. **マルチユーザー & OS ユーザー認証連携 (Slack User ⇄ Linux OS User)**:
   - Slack の各ユーザーをホストマシンの Linux ユーザーアカウントと 1:1 で紐付け。
   - `agy` や `gh` (GitHub CLI)、`git` は各ユーザー自身のホームディレクトリ・認証情報（`~/.config/gh`, `~/.gemini/antigravity-cli`, SSH 秘密鍵等）を用いて実行され、他人の情報への不正アクセスを完全防止。
2. **Git Worktree & 排他ロック (`RepoMutex`) による完全な並行開発**:
   - 複数ユーザーが同じリポジトリに対して同時に指示を出しても衝突しないよう、スレッドごとに **Git Worktree** を動的に作成。
   - 同一ベースリポジトリへの同時アクセス競合（`.git/index.lock`）をインメモリ Mutex で排他制御。
3. **インタラクティブ承認・スタンプ連携 (Interactive Reaction Approvals)**:
   - 危険コマンドやデプロイの承認、実装方針の質問（`ask_question`）時に、スレッド内にスタンプ（✅/❌ や 1️⃣/2️⃣/3️⃣）を自動付与。
   - ユーザー本人のスタンプ押下をトリガーにプロセスが自動再開（5分タイムアウト保護付き）。
4. **Slack API レート制限対策 & 4,000文字フォールバック**:
   - 高速な AGY ストリーミング出力を **800ms 間隔でバッファリング更新** し、Slack API の Rate Limit（HTTP 429）を回避。
   - 4,000 文字（Slack 上限）を超える長文や差分（diff）は、自動的に **スニペットファイル (`files.uploadV2`)** として添付。
5. **堅牢なセキュリティ & 監査ログ (JSONL Audit Trail)**:
   - 専用サービスユーザー `slack-agy` でデーモン常駐し、sudoers で root への昇格を禁止（`ALL=(%developers)`）。
   - すべての操作証跡を `logs/audit.jsonl`、システム稼働状態を `logs/app.jsonl` に O(1) ストリーム追記。
6. **放置 Worktree の自動ガベージコレクション (`WorktreeCleaner`)**:
   - タスク完了後に放置された Worktree を TTL（デフォルト: 7日間）に基づいて定期的に自動削除し、ディスク容量を保護。
7. **ポート開放不要の Socket Mode & systemd 常駐**:
   - ファイアウォール内やローカルマシンでも安全に常駐稼働。OS 起動時の自動起動とクラッシュ時自動復旧に対応。
8. **高速・最新の開発ツールチェーン**:
   - **Node.js 24 LTS**, **TypeScript 7.x**, **Vitest 4.x**, **Oxlint 1.x**, **Oxfmt 0.x**（7日間のサプライチェーンクールダウンを遵守）。
