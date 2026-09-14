import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatSSE } from '@cairn/shared';
import { streamChat } from './api';

/** 构造一个分块 SSE Response：chunks 按给定切分，模拟网络分帧 */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(status === 200 ? stream : null, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamChat SSE 解析', () => {
  it('按事件顺序回调，跳过心跳注释行', async () => {
    const events: ChatSSE[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ': ping\n\n',
          'event: user_message\ndata: {"id":"u1","role":"user","text":"hi","toolCalls":[],"createdAt":"t"}\n\n',
          ': ping\n\n',
          'event: done\ndata: {"conversationId":"c1","title":"新标题"}\n\n',
        ]),
      ),
    );

    await streamChat('c1', 'hi', (e) => events.push(e), new AbortController().signal);

    expect(events.map((e) => e.event)).toEqual(['user_message', 'done']);
    expect(events[1].data).toEqual({ conversationId: 'c1', title: '新标题' });
  });

  it('事件帧跨网络分块到达时正确拼接', async () => {
    const events: ChatSSE[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: assistant_sta',
          'rt\ndata: {"id":"a1"}',
          '\n\nevent: delta\nda',
          'ta: {"id":"a1","text":"你好"}\n',
          '\n',
        ]),
      ),
    );

    await streamChat('c1', 'hi', (e) => events.push(e), new AbortController().signal);

    expect(events).toEqual([
      { event: 'assistant_start', data: { id: 'a1' } },
      { event: 'delta', data: { id: 'a1', text: '你好' } },
    ]);
  });

  it('无法解析的 JSON 帧被跳过而不是抛错', async () => {
    const events: ChatSSE[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: delta\ndata: {broken json\n\n',
          'event: done\ndata: {"conversationId":"c1"}\n\n',
        ]),
      ),
    );

    await streamChat('c1', 'hi', (e) => events.push(e), new AbortController().signal);
    expect(events.map((e) => e.event)).toEqual(['done']);
  });

  it('非 2xx 响应抛出服务端错误信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: '该对话正在处理中' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      streamChat('c1', 'hi', () => {}, new AbortController().signal),
    ).rejects.toThrow('该对话正在处理中');
  });

  it('非 2xx 且响应体不可解析时给出状态码信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway timeout', { status: 504 })),
    );

    await expect(
      streamChat('c1', 'hi', () => {}, new AbortController().signal),
    ).rejects.toThrow('504');
  });
});
