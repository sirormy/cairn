import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Item } from '@cairn/shared';
import type { AgentMessageRow, AppDb } from '../db.js';
import type { ContentCache } from '../services/content-cache.js';
import type { LlmSetup } from './models.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { buildTools } from './tools.js';

export interface AgentManager {
  /** 取该对话的 Agent（不存在则从 DB 水合创建） */
  getOrCreate(conversationId: string): Agent;
  /** 丢弃对话（删除对话时调用）：终止运行并清理内存态 */
  drop(conversationId: string): void;
  isStreaming(conversationId: string): boolean;
  abort(conversationId: string): void;
  /** 订阅该对话的收录事件（SSE 转发用），返回取消函数 */
  onItemSaved(conversationId: string, cb: (item: Item) => void): () => void;
}

/**
 * 每个对话一个 Agent 实例（内存 Map 缓存）。
 * - 消息持久化由 Agent 上的常驻订阅完成（message_end 统一落库 user/assistant/toolResult），
 *   客户端断开不影响落库，重启后可从 DB 恢复上下文。
 * - 工具按对话构建，闭包持有 conversationId，收录事件经 onItemSaved 分发给当前订阅者。
 */
export function createAgentManager(deps: {
  db: AppDb;
  llm: LlmSetup;
  cache: ContentCache;
}): AgentManager {
  const { db, llm, cache } = deps;
  const agents = new Map<string, Agent>();
  const unsubscribers = new Map<string, () => void>();
  const itemListeners = new Map<string, Set<(item: Item) => void>>();

  function notifyItemSaved(conversationId: string, item: Item): void {
    const set = itemListeners.get(conversationId);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(item);
      } catch {
        /* 单个监听器异常不影响收录流程 */
      }
    }
  }

  /** 将 DB 行还原为 Agent 可用的消息序列（损坏行跳过） */
  function hydrateMessages(rows: AgentMessageRow[]): AgentMessage[] {
    const out: AgentMessage[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.content) as Record<string, unknown>;
        if (
          typeof parsed.role === 'string' &&
          (parsed.role === 'user' || parsed.role === 'assistant' || parsed.role === 'toolResult')
        ) {
          out.push(parsed as unknown as AgentMessage);
        }
      } catch {
        /* 跳过无法解析的行 */
      }
    }
    return out;
  }

  function getOrCreate(conversationId: string): Agent {
    const cached = agents.get(conversationId);
    if (cached) return cached;

    const tools = buildTools({
      db,
      cache,
      conversationId,
      notifyItemSaved: (item) => notifyItemSaved(conversationId, item),
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: llm.model,
        thinkingLevel: 'off',
        tools,
        messages: hydrateMessages(db.getAgentMessages(conversationId)),
      },
      streamFn: llm.models.streamSimple.bind(llm.models),
    });

    // 常驻订阅：所有完成的消息统一落库（prompt 的 user 消息同样走 message_end）
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === 'message_end') {
        const message = event.message as { role: string };
        if (message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult') {
          db.appendMessage(conversationId, message.role, event.message);
        }
      }
    });

    agents.set(conversationId, agent);
    unsubscribers.set(conversationId, unsubscribe);
    return agent;
  }

  function drop(conversationId: string): void {
    const agent = agents.get(conversationId);
    if (agent) {
      agent.abort();
      unsubscribers.get(conversationId)?.();
    }
    agents.delete(conversationId);
    unsubscribers.delete(conversationId);
    itemListeners.delete(conversationId);
  }

  return {
    getOrCreate,
    drop,
    isStreaming(conversationId) {
      return agents.get(conversationId)?.state.isStreaming ?? false;
    },
    abort(conversationId) {
      agents.get(conversationId)?.abort();
    },
    onItemSaved(conversationId, cb) {
      let set = itemListeners.get(conversationId);
      if (!set) {
        set = new Set();
        itemListeners.set(conversationId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0) itemListeners.delete(conversationId);
      };
    },
  };
}
