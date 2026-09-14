import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ItemType } from '@cairn/shared';
import type { AppDb } from '../db.js';
import { loadXCredentials } from './cookies.js';
import { BROWSER_UA } from './net.js';
import { buildTweetMarkdown, mapGraphqlTweet, unwrapTweetResult, type TweetData } from './tweet.js';

/** x.com Web 端公开 Bearer（与 tweet.ts 一致） */
const X_BEARER =
  process.env.X_BEARER_TOKEN ??
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** Bookmarks 查询 id（X 不定期轮换，可用 .env 的 X_BOOKMARKS_QUERY_ID 覆盖） */
const BOOKMARKS_QUERY_ID = process.env.X_BOOKMARKS_QUERY_ID ?? 'iblrFnKr6PZUR-dWpfXG6g';

/** 开启 articles_preview 后书签时间线会内联 X 长文（article.article_results） */
const BOOKMARKS_FEATURES = JSON.stringify({
  articles_preview_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  graphql_timeline_v2_bookmark_timeline: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  verified_phone_label_enabled: false,
  longform_notetweets_consumption_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
});

const PAGE_SIZE = 20;
/** 安全上限：X 书签页码本身有限，这里兜底防失控 */
const MAX_ITEMS = 1000;

export interface BookmarksPage {
  tweets: TweetData[];
  /** 下一页游标；null 表示没有更多 */
  cursor: string | null;
}

/**
 * 解析 Bookmarks 响应（纯函数，便于测试）。
 * 时间线条目形如 entries[].content.itemContent.tweet_results.result，
 * 游标条目 content.cursorType === 'Bottom'。
 */
export function parseBookmarksPage(body: unknown): BookmarksPage {
  const instructions = (body as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [];
  let tweets: TweetData[] = [];
  let cursor: string | null = null;
  for (const ins of instructions) {
    if (ins?.type !== 'TimelineAddEntries') continue;
    for (const entry of ins.entries ?? []) {
      const content = entry?.content;
      if (content?.entryType === 'TimelineTimelineCursor' && content.cursorType === 'Bottom') {
        cursor = content.value ?? null;
      }
      const raw = content?.itemContent?.tweet_results?.result;
      const result = unwrapTweetResult(raw);
      // 书签时间线里可能有非推文条目（module 等），tweet_results 缺失即跳过
      if (result?.legacy) {
        try {
          tweets.push(mapGraphqlTweet(result, 'cookie'));
        } catch {
          /* 单条结构异常不拖垮整页 */
        }
      }
    }
  }
  // 末页通常只剩 Top 游标或空 entries → cursor 为 null，由调用方终止翻页
  return { tweets, cursor };
}

/** 抓一页书签 */
async function fetchBookmarksPage(cred: { cookieHeader: string; ct0: string }, cursor?: string): Promise<unknown> {
  const variables: Record<string, unknown> = {
    count: PAGE_SIZE,
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true,
    withV2Timeline: true,
  };
  if (cursor) variables.cursor = cursor;
  const res = await fetch(
    `https://x.com/i/api/graphql/${BOOKMARKS_QUERY_ID}/Bookmarks?features=${encodeURIComponent(BOOKMARKS_FEATURES)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${X_BEARER}`,
        cookie: cred.cookieHeader,
        'x-csrf-token': cred.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'user-agent': BROWSER_UA,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ variables, queryId: BOOKMARKS_QUERY_ID }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error('X 登录已失效，请重新导出 x.cookie.json（auth_token / ct0 过期）');
  }
  if (!res.ok) throw new Error(`Bookmarks 接口返回 HTTP ${res.status}`);
  return res.json();
}

/** 全量抓取书签（跟随游标翻页），最多 maxItems 条 */
export async function fetchBookmarks(maxItems = MAX_ITEMS): Promise<TweetData[]> {
  const cred = loadXCredentials();
  if (!cred) {
    throw new Error('未找到 X 登录凭证：请把导出的 cookie 文件放到仓库根目录 x.cookie.json，或在 .env 配置 X_AUTH_TOKEN / X_CT0');
  }
  const all: TweetData[] = [];
  let cursor: string | undefined;
  for (let page = 0; page * PAGE_SIZE < maxItems; page++) {
    const parsed = parseBookmarksPage(await fetchBookmarksPage(cred, cursor));
    all.push(...parsed.tweets.slice(0, maxItems - all.length));
    if (!parsed.cursor || all.length >= maxItems) break;
    cursor = parsed.cursor;
  }
  return all;
}

/* ── 导入 ─────────────────────────────────────────────── */

/** 由推文数据推导条目字段（不经过 LLM 的确定性导入） */
export function deriveItemFields(tweet: TweetData): {
  title: string;
  summary: string;
  tags: string[];
  metadata: Record<string, unknown>;
} {
  const firstLine = tweet.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const title = tweet.article
    ? tweet.article.title
    : firstLine.replace(/https?:\/\/\S+/, '').trim() || firstLine || `@${tweet.author.handle} 的推文`;
  const summary = tweet.article
    ? tweet.article.previewText
    : tweet.text;
  const tags = ['x-bookmark'];
  if (tweet.article) tags.push('x-article');
  return {
    title: title.slice(0, 120),
    summary: summary.slice(0, 200),
    tags,
    metadata: {
      author: `${tweet.author.name} (@${tweet.author.handle})`,
      postedAt: tweet.createdAt,
      metrics: tweet.metrics,
      lang: tweet.lang,
      article: tweet.article,
    },
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** 结构异常无法导入的条数 */
  failed: number;
  total: number;
}

/**
 * 把书签推文写入收藏库。已存在同 URL 条目时跳过（不覆盖用户手改过的
 * 标题/笔记），其余按确定性规则生成标题/摘要/标签。
 */
export function importBookmarks(db: AppDb, tweets: TweetData[]): ImportResult {
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, total: tweets.length };
  for (const tweet of tweets) {
    try {
      if (!tweet.url || !/^https:\/\/x\.com\/[^/]+\/status\/\d+/.test(tweet.url)) {
        result.failed++;
        continue;
      }
      if (db.findItemByUrl(tweet.url)) {
        result.skipped++;
        continue;
      }
      const fields = deriveItemFields(tweet);
      const { item } = db.upsertItem({
        type: 'tweet' as ItemType,
        url: tweet.url,
        title: fields.title,
        summary: fields.summary,
        report: null,
        tags: fields.tags,
        metadata: fields.metadata,
        conversationId: null,
        contentText: buildTweetMarkdown(tweet),
      });
      // 与 save_item 工具一致：原文落盘 data/items/<id>/content.md
      const contentPath = db.itemContentPath(item.id);
      mkdirSync(path.dirname(contentPath), { recursive: true });
      writeFileSync(contentPath, buildTweetMarkdown(tweet), 'utf8');
      result.imported++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
