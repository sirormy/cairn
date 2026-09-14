import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Item, ItemType } from '@cairn/shared';
import type { AppDb } from '../db.js';
import type { ContentCache } from '../services/content-cache.js';
import { extractWebpage } from '../services/extract.js';
import { fetchTweet, buildTweetMarkdown } from '../services/tweet.js';
import { fetchGithubRepo, buildGithubMarkdown } from '../services/github.js';

export interface ToolContext {
  db: AppDb;
  cache: ContentCache;
  /** 所属对话（工具按对话构建，闭包持有） */
  conversationId: string;
  notifyItemSaved: (item: Item) => void;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…（内容过长已截断，共 ${s.length} 字符）`;
}

/* ── 工具参数 schema ───────────────────────────────────── */

const UrlParam = Type.Object({
  url: Type.String({ description: '要抓取的 http(s) 链接' }),
});

const TweetUrlParam = Type.Object({
  url: Type.String({ description: '推文链接（x.com / twitter.com / t.co）' }),
});

const GithubUrlParam = Type.Object({
  url: Type.String({ description: 'GitHub 仓库链接' }),
});

const SaveItemParam = Type.Object({
  type: Type.Union(
    [Type.Literal('tweet'), Type.Literal('article'), Type.Literal('website'), Type.Literal('github')],
    { description: '收录类型' },
  ),
  url: Type.String({ description: '必须与抓取工具返回的 url 完全一致' }),
  title: Type.String({ description: '简洁标题，优先原文标题' }),
  summary: Type.String({ description: '中文摘要，2-4 句' }),
  report: Type.Optional(Type.String({ description: '中文调研报告 markdown（github / website 必填）' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: '3-6 个标签' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '分类型元数据' })),
});

const SearchParam = Type.Object({
  query: Type.String({ description: '搜索关键词' }),
  type: Type.Optional(
    Type.Union(
      [Type.Literal('tweet'), Type.Literal('article'), Type.Literal('website'), Type.Literal('github')],
      { description: '限定类型' },
    ),
  ),
});

/**
 * 为一个对话构建全部工具。工具按对话闭包持有上下文，
 * notifyItemSaved 在调用时向当前订阅者分发。
 */
export function buildTools(ctx: ToolContext): AgentTool<any, any>[] {
  const fetchWebpageTool: AgentTool<typeof UrlParam, { url: string }> = {
    name: 'fetch_webpage',
    label: '抓取网页',
    description: '抓取网页并提取正文（markdown）。适用于文章、博客、产品官网等任何 http(s) 页面。',
    parameters: UrlParam,
    execute: async (_callId, params: Static<typeof UrlParam>) => {
      const page = await extractWebpage(params.url);
      const meta = {
        title: page.title,
        siteName: page.siteName,
        description: page.description,
        byline: page.byline,
        lang: page.lang,
        wordCount: page.wordCount,
        isArticle: page.isArticle,
      };
      ctx.cache.put({
        kind: 'webpage',
        url: page.finalUrl,
        markdown: page.markdown,
        meta,
        savedAt: Date.now(),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: page.finalUrl,
              ...meta,
              markdown: truncate(page.markdown, 48_000),
            }),
          },
        ],
        details: { url: page.finalUrl },
      };
    },
  };

  const fetchTweetTool: AgentTool<typeof TweetUrlParam, { url: string }> = {
    name: 'fetch_tweet',
    label: '抓取推文',
    description:
      '抓取一条 X/Twitter 推文的内容（作者、正文、媒体、互动数据），必要时自动处理 t.co 短链。X 长文（article）只能取到标题与预览，正文为指向全文的链接。',
    parameters: TweetUrlParam,
    execute: async (_callId, params: Static<typeof TweetUrlParam>) => {
      const tweet = await fetchTweet(params.url);
      const markdown = buildTweetMarkdown(tweet);
      ctx.cache.put({
        kind: 'tweet',
        url: tweet.url,
        markdown,
        meta: {
          author: tweet.author,
          handle: tweet.author.handle,
          postedAt: tweet.createdAt,
          metrics: tweet.metrics,
          lang: tweet.lang,
          inReplyTo: tweet.inReplyTo,
          source: tweet.source,
          article: tweet.article,
        },
        savedAt: Date.now(),
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url: tweet.url,
              author: tweet.author,
              postedAt: tweet.createdAt,
              metrics: tweet.metrics,
              article: tweet.article,
              markdown: truncate(markdown, 16_000),
            }),
          },
        ],
        details: { url: tweet.url },
      };
    },
  };

  const githubRepoTool: AgentTool<typeof GithubUrlParam, { url: string }> = {
    name: 'github_repo_info',
    label: '调研 GitHub 仓库',
    description:
      '获取 GitHub 仓库的元数据（stars、语言、topics、license、更新时间、最新 release）与 README，用于撰写调研报告。',
    parameters: GithubUrlParam,
    execute: async (_callId, params: Static<typeof GithubUrlParam>) => {
      const data = await fetchGithubRepo(params.url);
      ctx.cache.put({
        kind: 'github',
        url: data.url,
        markdown: buildGithubMarkdown(data),
        meta: {
          stars: data.stars,
          forks: data.forks,
          language: data.language,
          topics: data.topics,
          license: data.license,
          homepage: data.homepage,
          pushedAt: data.pushedAt,
          latestRelease: data.latestRelease,
        },
        savedAt: Date.now(),
      });
      const { readme, ...rest } = data;
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ...rest, readme: truncate(readme, 24_000) }) },
        ],
        details: { url: data.url },
      };
    },
  };

  const saveItemTool: AgentTool<typeof SaveItemParam, { itemId: string }> = {
    name: 'save_item',
    label: '收录条目',
    description:
      '将抓取到的内容收录到收藏库。原文会从服务端缓存自动写入，无需在参数中传递正文。同一 URL 重复收录会覆盖更新。',
    parameters: SaveItemParam,
    execute: async (_callId, params: Static<typeof SaveItemParam>) => {
      const cached = ctx.cache.take(params.url);

      const { item } = ctx.db.upsertItem({
        type: params.type as ItemType,
        url: params.url,
        title: params.title,
        summary: params.summary,
        report: params.report ?? null,
        tags: params.tags,
        metadata: params.metadata,
        conversationId: ctx.conversationId,
        contentText: cached?.markdown ?? null,
      });

      if (cached) {
        const contentPath = ctx.db.itemContentPath(item.id);
        mkdirSync(path.dirname(contentPath), { recursive: true });
        writeFileSync(contentPath, cached.markdown, 'utf8');
      }

      ctx.notifyItemSaved(item);
      const result: Record<string, unknown> = {
        saved: true,
        itemId: item.id,
        title: item.title,
        url: item.url,
      };
      if (!cached) result.note = '未找到该 URL 的原文缓存，正文为空；建议先调用对应抓取工具';
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { itemId: item.id },
      };
    },
  };

  const searchCollectionTool: AgentTool<typeof SearchParam, { count: number }> = {
    name: 'search_collection',
    label: '检索收藏',
    description: '在已收录的收藏库中全文检索（标题 / 摘要 / 报告 / 正文），支持按类型过滤。',
    parameters: SearchParam,
    execute: async (_callId, params: Static<typeof SearchParam>) => {
      const { items } = ctx.db.listItems({
        q: params.query,
        type: params.type as ItemType | undefined,
        limit: 20,
      });
      const text =
        items.length === 0
          ? '没有找到匹配的收录条目'
          : items
              .map(
                (i) =>
                  `[${i.type}] ${i.title} — ${i.url}${i.tags.length ? `（${i.tags.join(', ')}）` : ''}\n摘要：${i.summary}`,
              )
              .join('\n\n');
      return {
        content: [{ type: 'text', text }],
        details: { count: items.length },
      };
    },
  };

  return [fetchWebpageTool, fetchTweetTool, githubRepoTool, saveItemTool, searchCollectionTool];
}
