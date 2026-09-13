import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';
import type {
  ChatMessage,
  ChatSSE,
  ConversationDetail,
  ConversationSummary,
} from '@app/shared';
import type { AppDb } from '../db.js';
import type { AgentManager } from '../agent/manager.js';
import { deriveTitle, normalizeHistory } from '../agent/normalize.js';

interface RouteDeps {
  db: AppDb;
  manager: AgentManager;
  /** LLM 未配置时的错误说明（已配置为 null） */
  llmError: string | null;
}

/** assistant 消息内容块 → 前端视图模型 */
function assistantToChatMessage(id: string, message: unknown): ChatMessage {
  const msg = message as {
    content?: { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[];
    timestamp?: number;
  };
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const toolCalls = blocks
    .filter((b) => b.type === 'toolCall')
    .map((b) => ({
      id: b.id ?? '',
      name: b.name ?? '',
      args: b.arguments ?? {},
      status: 'running' as const,
    }));
  return {
    id,
    role: 'assistant',
    text,
    toolCalls,
    createdAt: new Date(msg.timestamp ?? Date.now()).toISOString(),
  };
}

export function createConversationRoutes({ db, manager, llmError }: RouteDeps): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const conv = db.createConversation();
    return c.json(conv satisfies ConversationSummary, 201);
  });

  app.get('/', (c) => {
    return c.json(db.listConversations());
  });

  app.get('/:id', (c) => {
    const conv = db.getConversation(c.req.param('id'));
    if (!conv) return c.json({ error: '对话不存在' }, 404);
    const detail: ConversationDetail = {
      ...conv,
      messages: normalizeHistory(db.getAgentMessages(conv.id)),
    };
    return c.json(detail);
  });

  app.patch('/:id', async (c) => {
    const body = await c.req.json<{ title?: string }>().catch(() => null);
    const title = body?.title?.trim();
    if (!title) return c.json({ error: 'title 不能为空' }, 400);
    const conv = db.renameConversation(c.req.param('id'), title.slice(0, 100));
    if (!conv) return c.json({ error: '对话不存在' }, 404);
    return c.json(conv);
  });

  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    if (!db.getConversation(id)) return c.json({ error: '对话不存在' }, 404);
    manager.drop(id);
    db.deleteConversation(id);
    return c.json({ ok: true });
  });

  /* ── Chat SSE ─────────────────────────────────────────── */

  app.post('/:id/chat', async (c) => {
    const conversationId = c.req.param('id');
    if (!db.getConversation(conversationId)) {
      return c.json({ error: '对话不存在' }, 404);
    }
    if (llmError) {
      return c.json({ error: llmError }, 503);
    }
    if (manager.isStreaming(conversationId)) {
      return c.json({ error: '该对话正在处理中' }, 409);
    }

    const body = await c.req.json<{ text?: string }>().catch(() => null);
    const text = body?.text?.trim();
    if (!text) return c.json({ error: 'text 不能为空' }, 400);

    // 首条消息生成标题（此时 prompt 尚未落库，conversationHasMessages 检查的是历史消息）
    if (!db.conversationHasMessages(conversationId)) {
      db.renameConversation(conversationId, deriveTitle(text));
    }
    db.touchConversation(conversationId);

    const agent: Agent = manager.getOrCreate(conversationId);
    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;
    let unsubscribeAgent: () => void = () => {};
    let unsubscribeItems: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let currentAssistantId: string | null = null;
    const onAbort = () => manager.abort(conversationId);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (payload: ChatSSE) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`),
            );
          } catch {
            /* 客户端已断开 */
          }
        };

        const finish = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          signal.removeEventListener('abort', onAbort);
          unsubscribeAgent();
          unsubscribeItems();
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        };

        // done 携带当前标题：首条消息派生标题后前端页头据此刷新
        const sendDone = () => {
          send({
            event: 'done',
            data: { conversationId, title: db.getConversation(conversationId)?.title },
          });
        };

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            /* 忽略 */
          }
        }, 15_000);

        signal.addEventListener('abort', onAbort);

        send({
          event: 'user_message',
          data: {
            id: randomUUID(),
            role: 'user',
            text,
            toolCalls: [],
            createdAt: new Date().toISOString(),
          },
        });

        unsubscribeItems = manager.onItemSaved(conversationId, (item) => {
          send({ event: 'item_saved', data: item });
        });

        unsubscribeAgent = agent.subscribe((event: AgentEvent) => {
          switch (event.type) {
            case 'message_start': {
              const role = (event.message as { role: string }).role;
              if (role === 'assistant') {
                currentAssistantId = randomUUID();
                send({ event: 'assistant_start', data: { id: currentAssistantId } });
              }
              break;
            }
            case 'message_update': {
              const { assistantMessageEvent } = event;
              if (assistantMessageEvent.type === 'text_delta' && currentAssistantId) {
                send({
                  event: 'delta',
                  data: { id: currentAssistantId, text: assistantMessageEvent.delta },
                });
              }
              break;
            }
            case 'message_end': {
              const role = (event.message as { role: string }).role;
              if (role === 'assistant' && currentAssistantId) {
                send({
                  event: 'assistant_end',
                  data: assistantToChatMessage(currentAssistantId, event.message),
                });
                currentAssistantId = null;
              }
              break;
            }
            case 'tool_execution_start': {
              send({
                event: 'tool_start',
                data: { callId: event.toolCallId, name: event.toolName, args: event.args },
              });
              break;
            }
            case 'tool_execution_end': {
              const result = event.result as
                | {
                    content?: { type: string; text?: string }[];
                    details?: { itemId?: string };
                  }
                | undefined;
              const preview =
                result?.content
                  ?.filter((b) => b.type === 'text')
                  .map((b) => b.text ?? '')
                  .join('')
                  .slice(0, 200) || undefined;
              const itemId = result?.details?.itemId;
              const item = itemId ? db.getItem(itemId) : null;
              send({
                event: 'tool_end',
                data: {
                  callId: event.toolCallId,
                  ok: !event.isError,
                  preview,
                  ...(item ? { item } : {}),
                },
              });
              break;
            }
            case 'agent_end': {
              const errorMessage = agent.state.errorMessage;
              if (errorMessage) send({ event: 'error', data: { message: errorMessage } });
              sendDone();
              finish();
              break;
            }
          }
        });

        // 订阅完成后再启动 prompt，避免漏事件
        agent.prompt(text).catch((err: unknown) => {
          send({
            event: 'error',
            data: { message: err instanceof Error ? err.message : 'Agent 运行异常' },
          });
          sendDone();
          finish();
        });
      },
      cancel() {
        // 客户端断开：终止 agent；已产生的消息仍会由 manager 的常驻订阅落库
        if (heartbeat) clearInterval(heartbeat);
        closed = true;
        signal.removeEventListener('abort', onAbort);
        unsubscribeAgent();
        unsubscribeItems();
        manager.abort(conversationId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });

  return app;
}
