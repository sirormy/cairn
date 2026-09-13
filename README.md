# 收集箱 Agent

内容收录与调研管理系统：把链接（推文 / 文章 / 官网 / GitHub 仓库）发给 Agent，它自动抓取原文、缓存到本地、生成摘要，并为 GitHub / 官网类内容产出中文调研报告。所有收录内容支持全文检索、标签分类与笔记。

## 功能

- **对话式收录**：在对话里粘贴链接即可收录，Agent 通过工具链（`fetch_webpage` / `fetch_tweet` / `github_repo_info` / `save_item` / `search_collection`）自动完成抓取、保存与总结
- **四种内容类型**：推文（syndication → oembed → cookie GraphQL 三层降级）、文章/官网（Readability + Turndown 提取）、GitHub 仓库（元数据 + README + 最新 release）
- **调研报告**：GitHub / 官网类条目由 LLM 撰写结构化中文报告，详情页渲染
- **收录管理**：类型筛选、标签聚合、全文检索（FTS5 trigram，覆盖标题/摘要/报告/笔记/正文）、笔记与标签编辑
- **安全抓取**：SSRF 加固（逐跳地址校验、私有网段拦截、体积/时长上限），短链解析

## 架构

```
apps/
  server/   Node + Hono + pi-agent-core：Agent 循环、工具、SSE 流式接口、SQLite
  web/      React 19 + Vite + Tailwind：对话页、收录列表、条目详情
packages/
  shared/   前后端共享类型
data/       运行时数据（gitignore）：SQLite、原文缓存、条目正文
scripts/
  mock-llm.mjs  本地 mock LLM，无真实 API key 时演示完整收录链路
```

## 快速开始

要求：Node ≥ 22，pnpm。

```bash
pnpm install
cp .env.example .env   # 填入 LLM 配置（任意 OpenAI 兼容端点）
pnpm dev               # web: http://localhost:5173，API: http://localhost:8787
```

`.env` 关键配置（见 `.env.example` 注释）：

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 任意 OpenAI 兼容端点（火山方舟、OpenRouter、DeepSeek 等），必填 |
| `GITHUB_TOKEN` | 可选，GitHub API 限额 60/h → 5000/h |
| `X_AUTH_TOKEN` / `X_CT0` | 可选，推文抓取的 cookie 兜底层 |

未配置 LLM 时服务可启动，聊天接口返回 503 并提示缺哪些变量。

### 无 API key 演示

```bash
node scripts/mock-llm.mjs        # 启动本地 mock LLM（:8790）
# .env 指向 mock：
#   LLM_BASE_URL=http://localhost:8790/v1  LLM_API_KEY=mock  LLM_MODEL=mock-1
pnpm dev                          # 在页面里粘贴任意链接即可走完整收录链路
```

## 测试与构建

```bash
pnpm test         # vitest：服务端（db / net / normalize / url-parse）+ 前端（SSE 解析 / 事件状态机）
pnpm typecheck
pnpm build        # typecheck + web 构建 + server 构建
```

## 注意

- 服务默认监听所有网卡（`API_PORT`，默认 8787），**没有鉴权与限流**——目前定位是本机单人使用的本地工具，请勿直接暴露到公网。
- 抓取的网页内容会进入 LLM 上下文，注意 prompt injection 风险；`save_item` 保存的标题/摘要/报告由 LLM 生成。
