import { logger } from "../logger/index.js";

export class UserMapper {
  private mappings: Map<string, string>;

  constructor(initialMappings: Record<string, string> = {}) {
    this.mappings = new Map(Object.entries(initialMappings));
  }

  /**
   * Slack User ID から OS ユーザー名を取得
   */
  public getOsUser(slackUserId: string): string | undefined {
    return this.mappings.get(slackUserId);
  }

  /**
   * Slack User ID がマッピングに登録されているか確認
   */
  public isAuthorized(slackUserId: string): boolean {
    return this.mappings.has(slackUserId);
  }

  /**
   * マッピングを追加/更新
   */
  public setMapping(slackUserId: string, osUser: string): void {
    this.mappings.set(slackUserId, osUser);
    logger.info("user_mapping_updated", { slackUserId, osUser });
  }

  /**
   * マッピングを削除
   */
  public removeMapping(slackUserId: string): boolean {
    const deleted = this.mappings.delete(slackUserId);
    if (deleted) {
      logger.info("user_mapping_removed", { slackUserId });
    }
    return deleted;
  }

  /**
   * 全マッピングを取得 (デバッグ/ステータス表示用)
   */
  public getAllMappings(): Record<string, string> {
    return Object.fromEntries(this.mappings.entries());
  }
}
