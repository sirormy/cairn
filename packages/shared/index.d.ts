/**
 * Cairn —— 前后端共享类型（仅类型，无运行时代码）
 */

export type ItemType = 'tweet' | 'article' | 'website' | 'github';

/* ── 对话 ──────────────────────────────────────────────── */

export interface ToolCallView {
  /** toolCall id，用于与 toolResult 关联 */
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  /** 结果预览（截断） */
  resultPreview?: string;
  /** save_item 成功后回填的收录条目 id */
  itemId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: ToolCallView[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

/* ── 收录条目 ───────────────────────────────────────────── */

export interface Item {
  id: string;
  type: ItemType;
  url: string;
  title: string;
  /** 中文摘要（2-4 句） */
  summary: string;
  /** github/website 的中文调研报告（markdown） */
  report: string | null;
  /** 用户笔记 */
  notes: string | null;
  tags: string[];
  /** 分类型元数据：作者 / stars / 语言 等 */
  metadata: Record<string, unknown>;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemDetail extends Item {
  /** 缓存的原文 markdown（推文/文章）或 README（github） */
  content: string | null;
}

export interface ItemListResult {
  items: Item[];
  total: number;
}

/* ── Chat SSE 流事件 ────────────────────────────────────── */

export type ChatSSE =
  | { event: 'user_message'; data: ChatMessage }
  | { event: 'assistant_start'; data: { id: string } }
  | { event: 'delta'; data: { id: string; text: string } }
  | { event: 'tool_start'; data: { callId: string; name: string; args: unknown } }
  | { event: 'tool_end'; data: { callId: string; ok: boolean; preview?: string; item?: Item } }
  | { event: 'assistant_end'; data: ChatMessage }
  | { event: 'item_saved'; data: Item }
  | { event: 'done'; data: { conversationId: string; title?: string } }
  | { event: 'error'; data: { message: string } };

/* ── 通用 ──────────────────────────────────────────────── */

export interface ApiError {
  error: string;
}
