import type { ChatMessage, ToolCallView } from '@app/shared';

/**
 * 将 DB 中的 AgentMessage 原始 JSON 行规整为前端视图模型：
 * - user → ChatMessage
 * - assistant → ChatMessage（含 toolCalls）
 * - toolResult → 合并进此前对应 toolCall 的状态与结果预览
 */

interface TextPart {
  type: 'text';
  text: string;
}

interface ToolCallPart {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface PersistedUser {
  role: 'user';
  content: string | TextPart[];
  timestamp: number;
}

interface PersistedAssistant {
  role: 'assistant';
  content: (TextPart | ToolCallPart | { type: string })[];
  timestamp: number;
}

interface PersistedToolResult {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: TextPart[];
  details?: { itemId?: string } & Record<string, unknown>;
  isError: boolean;
  timestamp: number;
}

export interface RawMessageRow {
  id: number;
  role: string;
  content: string;
  created_at: number;
}

function userText(content: PersistedUser['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextPart => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function userRowToChatMessage(row: RawMessageRow): ChatMessage {
  const msg = JSON.parse(row.content) as PersistedUser;
  return {
    id: String(row.id),
    role: 'user',
    text: userText(msg.content),
    toolCalls: [],
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function assistantRowToChatMessage(row: RawMessageRow): ChatMessage {
  const msg = JSON.parse(row.content) as PersistedAssistant;
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const text = blocks
    .filter((b): b is TextPart => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls: ToolCallView[] = blocks
    .filter((b): b is ToolCallPart => b.type === 'toolCall')
    .map((b) => ({ id: b.id, name: b.name, args: b.arguments ?? {}, status: 'running' }));
  return {
    id: String(row.id),
    role: 'assistant',
    text,
    toolCalls,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function normalizeHistory(rows: RawMessageRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of rows) {
    try {
      if (row.role === 'user') {
        out.push(userRowToChatMessage(row));
      } else if (row.role === 'assistant') {
        out.push(assistantRowToChatMessage(row));
      } else if (row.role === 'toolResult') {
        const msg = JSON.parse(row.content) as PersistedToolResult;
        const preview =
          (Array.isArray(msg.content)
            ? msg.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as TextPart).text)
                .join('')
            : ''
          ).slice(0, 200) || undefined;
        const itemId = msg.details?.itemId;
        for (let i = out.length - 1; i >= 0; i--) {
          const tc = out[i].toolCalls.find((t) => t.id === msg.toolCallId);
          if (tc) {
            tc.status = msg.isError ? 'error' : 'ok';
            tc.resultPreview = preview;
            if (itemId) tc.itemId = itemId;
            break;
          }
        }
      }
    } catch {
      /* 损坏行跳过，不影响其余历史 */
    }
  }
  return out;
}

/** 由首条用户消息生成对话标题 */
export function deriveTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || '新对话';
}
