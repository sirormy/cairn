# Cairn

**把链接堆成你的知识路标。**

[![CI](https://github.com/sirormy/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/sirormy/cairn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

中文 · [English](README.en.md)

---

Cairn（石堆）是徒步者在荒野里垒起的路标——每经过一次就添一块石头，久而久之堆成一条能认出来的路。

这个项目做的是同一件事：你在网上看到一条推文、一篇文章、一个 GitHub 项目或产品官网，把它丢进对话框，Agent 会抓下原文、缓存到本地、生成摘要；GitHub 仓库和官网类内容还会顺手写一份中文调研报告。所有内容存在你自己的 SQLite 里，全文可检索、可打标签、可记笔记。

数据不出本机——除了你自己配置的 LLM 端点，其余请求都只服务于你给的那些链接。具体来说，抓一条内容可能先后访问：短链跳转后的真实目标站点、`cdn.syndication.twimg.com` 与 `publish.twitter.com`（推文兜底抓取）、`x.com/i/api`（仅在配了 cookie 时，用于取完整推文与书签）、`api.github.com`（GitHub 仓库元数据）。除此之外不会向任何第三方上报你的收藏内容。

## 功能

**对话式收录。** 不用切页面、不用选类型，粘贴链接即可。Agent 通过 `fetch_webpage` / `fetch_tweet` / `github_repo_info` / `save_item` / `search_collection` 五个工具完成判断、抓取、保存与总结，整个过程以工具调用卡片的形式实时显示在对话里。

**四种内容类型各有抓取策略。** 推文走 syndication → oembed → 登录 Cookie 三层降级，正文自动展开 t.co 短链，X 长文取到标题与预览；文章与官网用 Readability + Turndown 提取正文；GitHub 仓库抓元数据、README 与最新 release。

**X 书签一键导入。** 登录 x.com 后把 cookie 导出成根目录的 `x.cookie.json`（已在 `.gitignore` 里），在收录列表页点一下「从 X 书签导入」，整库书签批量收录——包括 X 长文的标题、预览与封面。已存在的链接自动跳过，不会覆盖你手改过的标题和笔记。

**调研报告。** GitHub / 官网类条目由 LLM 撰写结构化中文报告，在详情页渲染，并一起进全文索引。

**收录管理。** 类型筛选、标签聚合、笔记与标签编辑；全文检索用 SQLite FTS5 的 trigram 分词器，覆盖标题、摘要、报告、笔记与正文，中文和代码片段都能搜。

**安全抓取。** 出站请求逐跳校验解析地址，拦截回环、私有网段、链路本地与 CGNAT 段，限制响应体积与时长；短链会先解析到真实目标再校验。

## 快速开始

要求 Node ≥ 22 与 pnpm。

```bash
pnpm install
cp .env.example .env   # 填入下面任意一种 LLM 端点
pnpm dev               # web: http://localhost:5173，API: http://127.0.0.1:8787
```

打开 http://localhost:5173，在对话框里粘贴任意链接即可。

### 配置

`.env` 的完整说明见 `.env.example`，常用的几项：

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 必填。任意 OpenAI 兼容端点，如火山方舟、OpenRouter、DeepSeek |
| `LLM_MODEL_NAME` | 可选，模型显示名 |
| `GITHUB_TOKEN` | 可选，把 GitHub API 限额从 60/h 提到 5000/h |
| `X_AUTH_TOKEN` / `X_CT0` | 可选，推文抓取的 cookie 兜底层 |
| `X_COOKIE_FILE` | 可选，X cookie 文件路径，默认根目录 `x.cookie.json` |
| `X_BOOKMARKS_QUERY_ID` | 可选，书签接口的 GraphQL queryId，X 轮换后从 twscrape 等项目取新值 |
| `X_GQL_QUERY_ID` / `X_GQL_FEATURES` | 可选，单推详情接口的参数，一般不用动 |
| `API_PORT` / `HOST` | 可选，默认 `8787` 与 `127.0.0.1` |

未配置 LLM 时服务仍可启动，聊天接口返回 503 并告诉你缺哪个变量。

### 不花 API key 试跑

仓库自带一个本地 mock LLM，可以在没有任何 key 的情况下走通完整收录链路：

```bash
node scripts/mock-llm.mjs
```

然后把 `.env` 指向它：

```bash
LLM_BASE_URL=http://localhost:8790/v1
LLM_API_KEY=mock
LLM_MODEL=mock-1
```

再跑 `pnpm dev`，粘贴任意链接就能看到抓取、保存、展示的完整流程。

## 架构

```
apps/
  server/   Node + Hono + pi-agent-core：Agent 循环、工具、SSE 流式接口、SQLite
  web/      React 19 + Vite + Tailwind：对话页、收录列表、条目详情
packages/
  shared/   前后端共享类型
data/       运行时数据（gitignore）：SQLite、原文缓存、条目正文
scripts/
  mock-llm.mjs  本地 mock LLM
```

对话走 SSE 流式接口，前端把事件归约成消息状态机；抓取到的页面同时写入内容缓存与 `data/items/<id>/content.md`，条目正文进 FTS 索引。

## 测试与构建

```bash
pnpm test         # vitest：服务端（db / net / normalize / url-parse / 抓取解析）+ 前端（SSE 解析 / 事件状态机）
pnpm typecheck
pnpm build        # typecheck + web 构建 + server 构建
```

## 注意

- 服务默认只监听 `127.0.0.1`，且**没有鉴权与限流**。要暴露到局域网得显式设 `HOST=0.0.0.0`——那等于把收藏库和 X 登录态一起交出去，请勿直接放到公网。
- 抓取的网页内容会进入 LLM 上下文，存在 prompt injection 风险；`save_item` 保存的标题、摘要与报告由 LLM 生成，重要结论请自行核对。
- `x.cookie.json` 等同于账号访问权限，只放在本机、别提交、别外发。仓库已默认 gitignore。
- **X 相关功能请自行评估合规性。** 推文兜底抓取走的是 X 的公开 syndication 接口，书签导入走的是 X Web 端内部 GraphQL 接口并复用你自己的登录态——读取的是**你自己账号的书签**。这类未公开接口没有稳定性与合法性承诺，X 的条款也不一定允许自动化访问，账号风险（限流、风控、封禁）由使用者自负。若你对此有顾虑，不要配置 cookie，此时推文抓取会自动降级到公开接口，书签导入功能则不可用。

## 贡献

欢迎提 issue 与 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前请确保 `pnpm typecheck && pnpm test && pnpm build` 全绿。

## License

[MIT](LICENSE)
