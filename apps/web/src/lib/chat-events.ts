import type { ChatMessage, ChatSSE } from '@app/shared';

/**
 * 把一条 Chat SSE 事件应用到消息列表（纯函数，便于单测）。
 * busy / title / error 等页面级状态仍由组件处理。
 */
export function applyChatEvent(prev: ChatMessage[], e: ChatSSE): ChatMessage[] {
  switch (e.event) {
    case 'user_message':
      return [...prev, e.data];
    case 'assistant_start':
      return [
        ...prev,
        {
          id: e.data.id,
          role: 'assistant',
          text: '',
          toolCalls: [],
          createdAt: new Date().toISOString(),
        },
      ];
    case 'delta':
      return prev.map((m) => (m.id === e.data.id ? { ...m, text: m.text + e.data.text } : m));
    case 'tool_start':
      return prev.map((m, i) => {
        if (i !== prev.length - 1 || m.role !== 'assistant') return m;
        if (m.toolCalls.some((t) => t.id === e.data.callId)) return m;
        return {
          ...m,
          toolCalls: [
            ...m.toolCalls,
            {
              id: e.data.callId,
              name: e.data.name,
              args: (e.data.args ?? {}) as Record<string, unknown>,
              status: 'running' as const,
            },
          ],
        };
      });
    case 'tool_end':
      return prev.map((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === e.data.callId
            ? {
                ...t,
                status: (e.data.ok ? 'ok' : 'error') as 'ok' | 'error',
                resultPreview: e.data.preview ?? t.resultPreview,
                itemId: e.data.item?.id ?? t.itemId,
              }
            : t,
        ),
      }));
    case 'assistant_end':
      return prev.map((m) => (m.id === e.data.id ? e.data : m));
    case 'item_saved':
    case 'done':
    case 'error':
      return prev;
  }
}
