export type InteractionType = "approval" | "question";

export interface InteractionOption {
  emoji: string; // e.g. 'white_check_mark', 'x', 'one', 'two', 'three'
  displayEmoji: string; // e.g. '✅', '❌', '1️⃣', '2️⃣', '3️⃣'
  label: string; // e.g. '許可して続行', '拒否して中止', 'Redis (セッションストア)'
  value: string; // e.g. 'approve', 'deny', 'option_1'
  isApproval?: boolean;
}

export interface PendingInteraction {
  id: string;
  type: InteractionType;
  channelId: string;
  threadTs: string;
  messageTs: string;
  allowedSlackUserId: string;
  osUser: string;
  title: string;
  description?: string;
  options: InteractionOption[];
  createdAt: number;
  timeoutMs: number;
  resolve: (result: InteractionResult) => void;
  reject: (error: Error) => void;
  timerId: NodeJS.Timeout;
}

export interface InteractionResult {
  interactionId: string;
  selectedOption: InteractionOption;
  selectedByUserId: string;
  respondedAt: string;
  timedOut: boolean;
}

export interface RequestApprovalParams {
  channelId: string;
  threadTs: string;
  allowedSlackUserId: string;
  osUser: string;
  title: string;
  description?: string;
  timeoutMs?: number;
}

export interface RequestQuestionParams {
  channelId: string;
  threadTs: string;
  allowedSlackUserId: string;
  osUser: string;
  question: string;
  options: string[];
  timeoutMs?: number;
}

export interface RegisterMessageChoicesParams {
  channelId: string;
  threadTs: string;
  messageTs: string;
  allowedSlackUserId: string;
  osUser: string;
  agentId?: string;
  title?: string;
  options: InteractionOption[];
  onSelect?: (selectedOption: InteractionOption, slackUserId: string) => Promise<void> | void;
}

export interface RegisteredMessageChoice {
  channelId: string;
  threadTs: string;
  messageTs: string;
  allowedSlackUserId: string;
  osUser: string;
  agentId?: string;
  title?: string;
  options: InteractionOption[];
  createdAt: number;
  onSelect?: (selectedOption: InteractionOption, slackUserId: string) => Promise<void> | void;
}

export const NUMBER_EMOJIS: Array<{ emoji: string; displayEmoji: string }> = [
  { emoji: "one", displayEmoji: "1️⃣" },
  { emoji: "two", displayEmoji: "2️⃣" },
  { emoji: "three", displayEmoji: "3️⃣" },
  { emoji: "four", displayEmoji: "4️⃣" },
  { emoji: "five", displayEmoji: "5️⃣" },
  { emoji: "six", displayEmoji: "6️⃣" },
  { emoji: "seven", displayEmoji: "7️⃣" },
  { emoji: "eight", displayEmoji: "8️⃣" },
  { emoji: "nine", displayEmoji: "9️⃣" },
  { emoji: "keycap_ten", displayEmoji: "🔟" },
];

