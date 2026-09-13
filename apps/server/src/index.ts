import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { config } from './config.js';
import { createDb } from './db.js';
import { createContentCache } from './services/content-cache.js';
import { buildLlm } from './agent/models.js';
import { createAgentManager, type AgentManager } from './agent/manager.js';
import { createConversationRoutes } from './routes/conversations.js';
import { createItemRoutes } from './routes/items.js';

const db = createDb(config.dataDir);
const cache = createContentCache(path.join(config.dataDir, 'cache'));
const llm = buildLlm(config);

/** LLM 未配置时的空实现：chat 路由会先以 503 拦截，不会真正调用 */
const stubManager: AgentManager = {
  getOrCreate: () => {
    throw new Error('LLM 未配置');
  },
  drop: () => {},
  isStreaming: () => false,
  abort: () => {},
  onItemSaved: () => () => {},
};

const manager: AgentManager = llm.setup
  ? createAgentManager({ db, llm: llm.setup, cache })
  : stubManager;

const app = new Hono();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    llm: llm.error ? { configured: false, error: llm.error } : { configured: true },
  }),
);
app.route('/api/conversations', createConversationRoutes({ db, manager, llmError: llm.error }));
app.route('/api/items', createItemRoutes({ db }));

// 生产模式：托管 web 构建产物（存在时），带 SPA 回退
if (existsSync(config.webDist)) {
  const relRoot = path.relative(process.cwd(), config.webDist);
  app.use('*', serveStatic({ root: relRoot }));
  const indexHtml = readFileSync(path.join(config.webDist, 'index.html'), 'utf8');
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(indexHtml);
  });
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`收集箱 Agent 服务已启动: http://localhost:${info.port}`);
  if (llm.error) {
    console.warn(`⚠ LLM 未配置：${llm.error}`);
  }
});
