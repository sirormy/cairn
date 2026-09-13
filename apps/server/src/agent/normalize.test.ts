import { describe, expect, it } from 'vitest';
import { deriveTitle, normalizeHistory } from './normalize.js';
import type { RawMessageRow } from './normalize.js';

function row(id: number, role: string, content: unknown): RawMessageRow {
  return { id, role, content: JSON.stringify(content), created_at: id * 1000 };
}

describe('normalizeHistory', () => {
  it('user / assistant 行转为视图模型，toolResult 合并进对应工具调用', () => {
    const rows: RawMessageRow[] = [
      row(1, 'user', { role: 'user', content: '收录这个', timestamp: 1000 }),
      row(2, 'assistant', {
        role: 'assistant',
        content: [
          { type: 'text', text: '好的，正在抓取' },
          { type: 'toolCall', id: 'call-1', name: 'fetch_webpage', arguments: { url: 'https://a.com' } },
        ],
        timestamp: 2000,
      }),
      row(3, 'toolResult', {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'fetch_webpage',
        content: [{ type: 'text', text: '{"title":"Example"}' }],
        details: { url: 'https://a.com' },
        isError: false,
        timestamp: 3000,
      }),
      row(4, 'toolResult', {
        role: 'toolResult',
        toolCallId: 'call-missing',
        toolName: 'ghost',
        content: [{ type: 'text', text: 'orphan' }],
        isError: true,
        timestamp: 3500,
      }),
    ];

    const messages = normalizeHistory(rows);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('收录这个');

    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.text).toBe('好的，正在抓取');
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0]).toMatchObject({
      id: 'call-1',
      name: 'fetch_webpage',
      status: 'ok',
      resultPreview: '{"title":"Example"}',
    });
    // 孤儿 toolResult（找不到对应 toolCall）被忽略，不产生新消息
  });

  it('save_item 的 itemId 回填到工具调用', () => {
    const rows: RawMessageRow[] = [
      row(1, 'assistant', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'save-1', name: 'save_item', arguments: {} }],
        timestamp: 1000,
      }),
      row(2, 'toolResult', {
        role: 'toolResult',
        toolCallId: 'save-1',
        toolName: 'save_item',
        content: [{ type: 'text', text: '{"saved":true}' }],
        details: { itemId: 'item-uuid' },
        isError: false,
        timestamp: 2000,
      }),
    ];
    const messages = normalizeHistory(rows);
    expect(messages[0].toolCalls[0].itemId).toBe('item-uuid');
  });

  it('错误结果标记 status=error，损坏行被跳过', () => {
    const rows: RawMessageRow[] = [
      { id: 1, role: 'assistant', content: '{not json', created_at: 1000 },
      row(2, 'assistant', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'e1', name: 'fetch_tweet', arguments: {} }],
        timestamp: 2000,
      }),
      row(3, 'toolResult', {
        role: 'toolResult',
        toolCallId: 'e1',
        toolName: 'fetch_tweet',
        content: [{ type: 'text', text: 'Error: 404' }],
        isError: true,
        timestamp: 3000,
      }),
    ];
    const messages = normalizeHistory(rows);
    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls[0].status).toBe('error');
  });
});

describe('deriveTitle', () => {
  it('截断长文本、清理空白', () => {
    expect(deriveTitle('  hello   world  ')).toBe('hello world');
    expect(deriveTitle('a'.repeat(50))).toHaveLength(31);
    expect(deriveTitle('a'.repeat(50)).endsWith('…')).toBe(true);
    expect(deriveTitle('')).toBe('新对话');
  });
});
