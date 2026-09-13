#!/usr/bin/env node
/**
 * 本地 mock LLM —— OpenAI Chat Completions 兼容的流式端点。
 * 用于在未配置真实 API key 时演示 / E2E 验证完整收录链路：
 *
 *   1. 用户消息含 URL → 回 tool_call: fetch_webpage
 *   2. 收到 fetch_webpage 结果 → 回 tool_call: save_item（url 取自工具结果）
 *   3. 收到 save_item 结果 → 回最终中文确认文本
 *   4. 普通消息 → 流式闲聊回复
 *
 * 启动：node scripts/mock-llm.mjs [port=8790]
 * .env: LLM_BASE_URL=http://localhost:8790/v1  LLM_API_KEY=mock  LLM_MODEL=mock-1
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8790);

function chunk(delta, finishReason = null) {
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-1',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** 提取消息文本：content 可能是 string，也可能是 [{type:'text',text}] 块数组 */
function messageText(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => p?.text ?? '').join('');
  return '';
}

/** 从消息历史里提取状态 */
function decide(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = messageText(lastUser ?? {});
  const urlMatch = userText.match(/https?:\/\/\S+/);
  const toolResults = messages.filter((m) => m.role === 'tool');
  const assistantToolCalls = messages
    .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
    .flatMap((m) => m.tool_calls.map((c) => c.function?.name));
  const called = (name) => assistantToolCalls.includes(name);

  if (urlMatch && !called('fetch_webpage')) {
    return {
      kind: 'tool',
      name: 'fetch_webpage',
      args: { url: urlMatch[0] },
    };
  }

  if (called('fetch_webpage') && !called('save_item')) {
    // 从 fetch_webpage 的工具结果中解析实际 url（跟随重定向后的 finalUrl）
    const fetchResult = toolResults.find((m) => {
      const idx = messages.indexOf(m);
      return idx > -1 && messages[idx - 1]?.tool_calls?.[0]?.function?.name === 'fetch_webpage';
    });
    let url = urlMatch?.[0] ?? 'https://example.com/';
    let title = 'Example Domain';
    if (fetchResult) {
      try {
        const parsed = JSON.parse(fetchResult.content);
        if (typeof parsed.url === 'string') url = parsed.url;
        if (typeof parsed.title === 'string' && parsed.title) title = parsed.title;
      } catch {
        /* 用默认值 */
      }
    }
    return {
      kind: 'tool',
      name: 'save_item',
      args: {
        type: 'article',
        url,
        title,
        summary: '这是 mock 摘要：演示收录流程的示例页面，验证了抓取、缓存与收录的完整链路。',
        tags: ['demo', 'example'],
        metadata: { wordCount: 0, isArticle: true },
      },
    };
  }

  if (called('save_item')) {
    return {
      kind: 'text',
      text:
        '已收录完成 ✅\n\n' +
        '- **类型**：article\n' +
        '- **标题**：Example Domain\n\n' +
        '原文已缓存到本地，可在 [收录列表](/items) 中查看详情。\n\n' +
        '（当前为 mock 模型回复，用于演示完整流程）',
    };
  }

  return {
    kind: 'text',
    text: `收到：${userText.slice(0, 120) || '（空）'}\n\n我是 mock 模型（未配置真实 LLM）。粘贴一个链接试试完整收录流程，例如 https://example.com`,
  };
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let messages = [];
    try {
      messages = JSON.parse(body).messages ?? [];
    } catch {
      /* 空 */
    }
    const plan = decide(messages);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    sse(res, JSON.parse(chunk({ role: 'assistant' })));

    if (plan.kind === 'tool') {
      sse(
        res,
        JSON.parse(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: `call_${plan.name}_${Date.now()}`,
                type: 'function',
                function: { name: plan.name, arguments: JSON.stringify(plan.args) },
              },
            ],
          }),
        ),
      );
      sse(res, JSON.parse(chunk({}, 'tool_calls')));
    } else {
      // 文本按小块流式输出，验证前端 delta 渲染
      const pieces = plan.text.match(/[\s\S]{1,12}/g) ?? [];
      for (const piece of pieces) {
        sse(res, JSON.parse(chunk({ content: piece })));
      }
      sse(res, JSON.parse(chunk({}, 'stop')));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(port, () => {
  console.log(`mock LLM 已启动: http://localhost:${port}/v1/chat/completions`);
});
