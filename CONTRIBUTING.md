# 贡献指南

感谢你愿意为 Cairn 出力。这个项目定位是**本机单人使用**的轻量工具，所以改动偏好简单直接、少依赖、可读优先。

## 开发环境

要求 Node ≥ 22 与 pnpm。

```bash
pnpm install
cp .env.example .env   # 填入任意 OpenAI 兼容端的 LLM 配置
pnpm dev               # web: http://localhost:5173，API: http://127.0.0.1:8787
```

没有 API key 也能跑通整条收录链路：先 `node scripts/mock-llm.mjs`，再把 `.env` 的 `LLM_BASE_URL` 指向 `http://localhost:8790/v1`。

## 提交前请跑

```bash
pnpm typecheck
pnpm test
```

CI 会在 PR 上跑同样的命令，外加 `pnpm build`。

## 代码约定

- **测试跟着逻辑走。** 纯函数（解析、归一化、转换）优先抽出来单测，网络请求与数据库留在薄壳里。服务端测试放同目录 `*.test.ts`。
- **注释写「为什么」。** 代码里已有一批解释 X/GraphQL 字段变迁、SSRF 例外、meta refresh 中转页的注释，这类「反直觉的事实来源」是重点保留对象。
- **不要引入新的运行时依赖**，除非标准库或现有依赖确实做不到。前端样式用 Tailwind，图标用 `lucide-react`。
- **抓取相关的代码保持 SSRF 防护**：新增出站请求请走 `services/net.ts` 的 `safeFetch`，不要直接 `fetch` 用户提供的 URL。

## 提 PR

1. 一个 PR 做一件事，描述里说清「为什么」而不只是「改了什么」。
2. 有行为变更请补测试；修 bug 请说明复现路径。
3. 涉及 UI 的改动，建议附一张改动前后的截图。

## 报告问题

用 issue 模板提交。涉及抓取失败的，请附上**链接类型**（推文 / 文章 / GitHub）和报错文案；不要把 cookie、token、API key 贴进 issue。
