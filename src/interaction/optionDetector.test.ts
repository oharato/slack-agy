import { describe, expect, it } from "vitest";
import { OptionDetector } from "./optionDetector.js";

describe("OptionDetector", () => {
  it("detects numbered options correctly (1. 2. 3.)", () => {
    const text = `
以下の方針が考えられます。どれを実行しますか？
1. Docker Compose 設定を追加する
2. Kubernetes マニフェストを作成する
3. ローカル実行用 Makefile を用意する
`;
    const detected = OptionDetector.detect(text);
    expect(detected).not.toBeNull();
    expect(detected?.type).toBe("numbered");
    expect(detected?.options).toHaveLength(3);
    expect(detected?.options[0].emoji).toBe("one");
    expect(detected?.options[0].label).toBe("Docker Compose 設定を追加する");
    expect(detected?.options[1].emoji).toBe("two");
    expect(detected?.options[2].emoji).toBe("three");
  });

  it("detects numbered options with markdown bold", () => {
    const text = `
選択してください：
• 1. **PostgreSQL**: リレーショナルデータベース
• 2. **MongoDB**: ドキュメント指向DB
`;
    const detected = OptionDetector.detect(text);
    expect(detected).not.toBeNull();
    expect(detected?.options).toHaveLength(2);
    expect(detected?.options[0].label).toBe("PostgreSQL: リレーショナルデータベース");
    expect(detected?.options[1].label).toBe("MongoDB: ドキュメント指向DB");
  });

  it("detects emoji numbered options (1️⃣ 2️⃣)", () => {
    const text = `
方針を選択してください:
1️⃣ クライアント側でバリデーションを行う
2️⃣ サーバー側でのみバリデーションを行う
`;
    const detected = OptionDetector.detect(text);
    expect(detected).not.toBeNull();
    expect(detected?.options).toHaveLength(2);
    expect(detected?.options[0].label).toBe("クライアント側でバリデーションを行う");
  });

  it("detects lettered options (A. B. C.)", () => {
    const text = `
以下の実装案があります：
A) キャッシュを Redis に保存
B) インメモリ LRU キャッシュを使用
C) DB に直接クエリ
`;
    const detected = OptionDetector.detect(text);
    expect(detected).not.toBeNull();
    expect(detected?.type).toBe("letter");
    expect(detected?.options).toHaveLength(3);
    expect(detected?.options[0].label).toBe("A) キャッシュを Redis に保存");
  });

  it("detects approval / confirmation requests", () => {
    const text = `
以下のファイルを変更してコミットします。よろしいですか？
- ✅ 変更をコミットしてプッシュする
- ❌ 変更を取り消して中断する
`;
    const detected = OptionDetector.detect(text);
    expect(detected).not.toBeNull();
    expect(detected?.type).toBe("approval");
    expect(detected?.options).toHaveLength(2);
    expect(detected?.options[0].emoji).toBe("white_check_mark");
    expect(detected?.options[0].isApproval).toBe(true);
    expect(detected?.options[1].emoji).toBe("x");
    expect(detected?.options[1].isApproval).toBe(false);
  });

  it("returns null when no valid options are present", () => {
    const text = "ファイルの修正が完了しました。テストも全て通過しています。";
    const detected = OptionDetector.detect(text);
    expect(detected).toBeNull();
  });
});
