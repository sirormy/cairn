import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSSE, Item } from '@app/shared';
import { applyChatEvent } from './chat-events';

const fakeItem = (id: string) => ({ id }) as unknown as Item;

const userMsg = (text: string): ChatMessage => ({
  id: `u-${text}`,
  role: 'user',
  text,
  toolCalls: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

const ev = <T extends ChatSSE['event']>(
  event: T,
  data: Extract<ChatSSE, { event: T }>['data'],
): ChatSSE => ({ event, data } as ChatSSE);

describe('applyChatEvent', () => {
  it('user_message 追加用户消息', () => {
    const next = applyChatEvent([], ev('user_message', userMsg('你好')));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ role: 'user', text: '你好' });
  });

  it('assistant_start 追加空 assistant 消息，delta 只写入对应 id', () => {
    let msgs = applyChatEvent([userMsg('hi')], ev('assistant_start', { id: 'a1' }));
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({ id: 'a1', role: 'assistant', text: '', toolCalls: [] });

    msgs = applyChatEvent(msgs, ev('delta', { id: 'a1', text: '你' }));
    msgs = applyChatEvent(msgs, ev('delta', { id: 'a1', text: '好' }));
    // 未知 id 的 delta 不影响任何消息
    msgs = applyChatEvent(msgs, ev('delta', { id: 'other', text: 'X' }));
    expect(msgs[1].text).toBe('你好');
    expect(msgs[0].text).toBe('hi');
  });

  it('tool_start 只挂到最后一条 assistant 消息，重复 callId 忽略', () => {
    let msgs = applyChatEvent([], ev('assistant_start', { id: 'a1' }));
    msgs = applyChatEvent(msgs, ev('tool_start', { callId: 'c1', name: 'fetch_webpage', args: { url: 'https://example.com' } }));
    msgs = applyChatEvent(msgs, ev('tool_start', { callId: 'c1', name: 'fetch_webpage', args: {} }));
    expect(msgs[0].toolCalls).toHaveLength(1);
    expect(msgs[0].toolCalls[0]).toMatchObject({ id: 'c1', name: 'fetch_webpage', status: 'running' });

    // tool_start 不会写到更早的 assistant 消息，也不会写到 user 消息
    const withUser = [userMsg('hi'), ...msgs];
    const next = applyChatEvent(withUser, ev('tool_start', { callId: 'c2', name: 'save_item', args: {} }));
    expect(next[0].toolCalls).toHaveLength(0);
    expect(next[1].toolCalls.map((t) => t.id)).toEqual(['c1', 'c2']);
  });

  it('tool_end 更新状态 / 预览 / itemId，保留未知 callId 原状', () => {
    let msgs = applyChatEvent([], ev('assistant_start', { id: 'a1' }));
    msgs = applyChatEvent(msgs, ev('tool_start', { callId: 'c1', name: 'save_item', args: {} }));
    msgs = applyChatEvent(
      msgs,
      ev('tool_end', {
        callId: 'c1',
        ok: true,
        preview: '已收录',
        item: fakeItem('item-9'),
      }),
    );
    expect(msgs[0].toolCalls[0]).toMatchObject({ status: 'ok', resultPreview: '已收录', itemId: 'item-9' });

    const failed = applyChatEvent(msgs, ev('tool_end', { callId: 'unknown', ok: false }));
    expect(failed[0].toolCalls[0].status).toBe('ok');
  });

  it('assistant_end 整体替换消息', () => {
    let msgs = applyChatEvent([], ev('assistant_start', { id: 'a1' }));
    msgs = applyChatEvent(msgs, ev('delta', { id: 'a1', text: '部分' }));
    const finalMsg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      text: '完整回复',
      toolCalls: [],
      createdAt: '2026-01-01T00:00:01.000Z',
    };
    msgs = applyChatEvent(msgs, ev('assistant_end', finalMsg));
    expect(msgs[0]).toEqual(finalMsg);
  });

  it('item_saved / done / error 不改变消息列表', () => {
    const msgs = [userMsg('hi')];
    expect(applyChatEvent(msgs, ev('item_saved', fakeItem('x')))).toEqual(msgs);
    expect(applyChatEvent(msgs, ev('done', { conversationId: 'c', title: '标题' }))).toEqual(msgs);
    expect(applyChatEvent(msgs, ev('error', { message: '出错' }))).toEqual(msgs);
  });

  it('完整收录序列：user → assistant → 工具两连 → 最终回复', () => {
    let msgs: ChatMessage[] = [];
    msgs = applyChatEvent(msgs, ev('user_message', userMsg('https://example.com 收录一下')));
    msgs = applyChatEvent(msgs, ev('assistant_start', { id: 'a1' }));
    msgs = applyChatEvent(msgs, ev('tool_start', { callId: 'c1', name: 'fetch_webpage', args: { url: 'https://example.com' } }));
    msgs = applyChatEvent(msgs, ev('tool_end', { callId: 'c1', ok: true, preview: '抓取完成' }));
    msgs = applyChatEvent(msgs, ev('tool_start', { callId: 'c2', name: 'save_item', args: {} }));
    msgs = applyChatEvent(
      msgs,
      ev('tool_end', { callId: 'c2', ok: true, preview: '已收录', item: fakeItem('i1') }),
    );
    msgs = applyChatEvent(msgs, ev('delta', { id: 'a1', text: '已收录完成' }));
    msgs = applyChatEvent(msgs, ev('done', { conversationId: 'c1', title: '新标题' }));

    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe('https://example.com 收录一下');
    expect(msgs[1].toolCalls.map((t) => t.status)).toEqual(['ok', 'ok']);
    expect(msgs[1].toolCalls[1].itemId).toBe('i1');
    expect(msgs[1].text).toBe('已收录完成');
  });
});
