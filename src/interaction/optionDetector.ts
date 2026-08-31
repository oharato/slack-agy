import { InteractionOption, NUMBER_EMOJIS } from "./types.js";

export interface DetectedChoice {
  type: "numbered" | "approval" | "letter";
  title?: string;
  options: InteractionOption[];
}

export class OptionDetector {
  /**
   * AIエージェントのテキストから選択肢リストを自動検出
   */
  public static detect(text: string): DetectedChoice | null {
    if (!text || typeof text !== "string") return null;

    // 1. 承認系 (Yes/No, 許可/拒否) の検出
    const approvalChoice = this.detectApproval(text);
    if (approvalChoice) return approvalChoice;

    // 2. 番号付き選択肢 (1. 2. 3. や 1️⃣ 2️⃣ 3️⃣ や [1] [2] や 1) 2)) の検出
    const numberedChoice = this.detectNumbered(text);
    if (numberedChoice) return numberedChoice;

    // 3. アルファベット付き選択肢 (A. B. C. や A) B) C. や [A] [B] [C]) の検出
    const letterChoice = this.detectLetter(text);
    if (letterChoice) return letterChoice;

    return null;
  }

  /**
   * 承認・確認 (Yes/No, 続行/中止) の検出
   */
  private static detectApproval(text: string): DetectedChoice | null {
    const lines = text.split("\n").map((l) => l.trim());

    // 承認系のキーワードを含んでいるか確認
    const hasApprovalContext =
      /(よろしいですか|よろしいでしょうか|続行しますか|実行しますか|進めてもいいですか|確認してください|承認|確認要求)/i.test(
        text,
      );

    // 明示的な ✅ ❌ や Yes/No の箇条書きがあるか
    const checkOptionRegex = /^(?:[•*-]\s*)?(?:✅|:white_check_mark:)\s*(.+)$/i;
    const xOptionRegex = /^(?:[•*-]\s*)?(?:❌|:x:)\s*(.+)$/i;

    let approveLabel: string | undefined;
    let denyLabel: string | undefined;

    for (const line of lines) {
      const checkMatch = line.match(checkOptionRegex);
      if (checkMatch) {
        approveLabel = checkMatch[1].replace(/^\*\*|\*\*$/g, "").trim();
      }
      const xMatch = line.match(xOptionRegex);
      if (xMatch) {
        denyLabel = xMatch[1].replace(/^\*\*|\*\*$/g, "").trim();
      }
    }

    if (approveLabel && denyLabel) {
      return {
        type: "approval",
        options: [
          {
            emoji: "white_check_mark",
            displayEmoji: "✅",
            label: approveLabel,
            value: approveLabel,
            isApproval: true,
          },
          {
            emoji: "x",
            displayEmoji: "❌",
            label: denyLabel,
            value: denyLabel,
            isApproval: false,
          },
        ],
      };
    }

    if (
      hasApprovalContext &&
      !/(?:1[.)]|1️⃣|\[1\])/.test(text) &&
      /(続行|中止|許可|拒否|実行|キャンセル)/.test(text)
    ) {
      // 暗黙の Yes/No 確認
      return {
        type: "approval",
        options: [
          {
            emoji: "white_check_mark",
            displayEmoji: "✅",
            label: "許可して続行",
            value: "許可して続行",
            isApproval: true,
          },
          {
            emoji: "x",
            displayEmoji: "❌",
            label: "拒否して中止",
            value: "拒否して中止",
            isApproval: false,
          },
        ],
      };
    }

    return null;
  }

  /**
   * 番号付き選択肢 (1. 2. 3... / 1️⃣ 2️⃣... / [1] [2]... / 1) 2)...) の検出
   */
  private static detectNumbered(text: string): DetectedChoice | null {
    const lines = text.split("\n");

    // 選択肢行のパターン
    // 1. xxx / 1) xxx / [1] xxx / (1) xxx / 1️⃣ xxx / • 1. xxx
    const numberedLineRegex =
      /^(?:[•*-]\s*)?(?:(\d{1,2})[.)]|\[(\d{1,2})\]|\((\d{1,2})\)|([1-9]|10)️⃣|:(\w+):)\s*(.+)$/;

    const emojiToNumMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      keycap_ten: 10,
    };

    const detected: Array<{ num: number; label: string }> = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(numberedLineRegex);
      if (!match) continue;

      let num: number | undefined;
      if (match[1]) num = parseInt(match[1], 10);
      else if (match[2]) num = parseInt(match[2], 10);
      else if (match[3]) num = parseInt(match[3], 10);
      else if (match[4]) num = parseInt(match[4], 10);
      else if (match[5] && emojiToNumMap[match[5]]) num = emojiToNumMap[match[5]];

      if (num && num >= 1 && num <= 10) {
        // ラベルから余分な Markdown 装飾 (** など) を除去
        let label = match[6].trim();
        // **太字** のみの場合は太字を剥がす
        label = label.replace(/^\*\*([^*]+)\*\*[:\s-]*(.*)$/, (_m, g1, g2) => {
          return g2 ? `${g1}: ${g2}` : g1;
        });

        // 連続しているか（1から始まるか、または直前の番号+1か）
        const expectedNext = detected.length + 1;
        if (num === expectedNext) {
          detected.push({ num, label });
        } else if (detected.length === 0 && num === 1) {
          detected.push({ num, label });
        }
      }
    }

    // 選択肢が2つ以上連続して見つかった場合のみ有効と判定
    if (detected.length >= 2 && detected.length <= 10) {
      const options: InteractionOption[] = detected.map((item, idx) => {
        const emojiInfo = NUMBER_EMOJIS[idx] || {
          emoji: "one",
          displayEmoji: "1️⃣",
        };
        return {
          emoji: emojiInfo.emoji,
          displayEmoji: emojiInfo.displayEmoji,
          label: item.label,
          value: `${item.num}. ${item.label}`,
        };
      });

      return {
        type: "numbered",
        options,
      };
    }

    return null;
  }

  /**
   * アルファベット付き選択肢 (A. B. C... / A) B)... / [A] [B]...) の検出
   */
  private static detectLetter(text: string): DetectedChoice | null {
    const lines = text.split("\n");
    const letterLineRegex = /^(?:[•*-]\s*)?(?:([A-Ja-j])[.)]|\[([A-Ja-j])\]|\(([A-Ja-j])\))\s*(.+)$/;


    const detected: Array<{ letter: string; label: string }> = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(letterLineRegex);
      if (!match) continue;

      const letter = (match[1] || match[2] || match[3] || "").toUpperCase();
      if (!letter) continue;

      const expectedCode = "A".charCodeAt(0) + detected.length;
      if (letter.charCodeAt(0) === expectedCode) {
        let label = match[4].trim();
        label = label.replace(/^\*\*([^*]+)\*\*[:\s-]*(.*)$/, (_m, g1, g2) => {
          return g2 ? `${g1}: ${g2}` : g1;
        });
        detected.push({ letter, label });
      }
    }

    if (detected.length >= 2 && detected.length <= 10) {
      const options: InteractionOption[] = detected.map((item, idx) => {
        const emojiInfo = NUMBER_EMOJIS[idx] || {
          emoji: "one",
          displayEmoji: "1️⃣",
        };
        return {
          emoji: emojiInfo.emoji,
          displayEmoji: emojiInfo.displayEmoji,
          label: `${item.letter}) ${item.label}`,
          value: `${item.letter}. ${item.label}`,
        };
      });

      return {
        type: "letter",
        options,
      };
    }

    return null;
  }
}
