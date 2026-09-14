import type {
  ChatSSE,
  ConversationDetail,
  ConversationSummary,
  Item,
  ItemDetail,
  ItemListResult,
  ItemType,
} from '@cairn/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

export interface ItemQuery {
  type?: ItemType;
  q?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  listConversations: () => request<ConversationSummary[]>('/api/conversations'),

  createConversation: () =>
    request<ConversationSummary>('/api/conversations', { method: 'POST' }),

  getConversation: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),

  renameConversation: (id: string, title: string) =>
    request<ConversationSummary>(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),

  listItems: (query: ItemQuery = {}) => {
    const params = new URLSearchParams();
    if (query.type) params.set('type', query.type);
    if (query.q) params.set('q', query.q);
    if (query.tag) params.set('tag', query.tag);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
    const qs = params.toString();
    return request<ItemListResult>(`/api/items${qs ? `?${qs}` : ''}`);
  },

  listTags: () => request<{ tag: string; count: number }[]>('/api/items/tags'),

  importXBookmarks: (limit?: number) =>
    request<{ imported: number; skipped: number; failed: number; total: number }>(
      '/api/items/import/x-bookmarks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limit ? { limit } : {}),
      },
    ),

  getItem: (id: string) => request<ItemDetail>(`/api/items/${id}`),

  updateItem: (id: string, patch: { title?: string; notes?: string; tags?: string[] }) =>
    request<Item>(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
};

/** 侧边栏等处通知对话列表刷新 */
export function notifyConversationsChanged(): void {
  window.dispatchEvent(new Event('app:conversations-changed'));
}

/**
 * 发送对话消息并解析 SSE 流。
 * 服务端事件格式：`event: <name>\ndata: <json>\n\n`，心跳为 `: ping` 注释行。
 */
export async function streamChat(
  conversationId: string,
  text: string,
  onEvent: (event: ChatSSE) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = (chunk: string) => {
    buffer += chunk;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName: string | null = null;
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (eventName && data) {
        try {
          onEvent({ event: eventName, data: JSON.parse(data) } as ChatSSE);
        } catch {
          /* 跳过无法解析的帧 */
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());
}
