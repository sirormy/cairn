import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, type AppDb } from '../db.js';
import {
  deriveItemFields,
  importBookmarks,
  parseBookmarksPage,
} from './x-bookmarks.js';
import type { TweetData } from './tweet.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

let db: AppDb;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bookmarks-'));
  db = createDb(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 按实测 Bookmarks GraphQL 响应构造的最小 fixture（2026 形态：user.core / article.article_results） */
function tweetEntry(overrides: Record<string, unknown> = {}) {
  const result = {
    __typename: 'Tweet',
    rest_id: '1900000000000000003',
    legacy: {
      id_str: '1900000000000000003',
      full_text: '一段合成的推文正文\nhttps://t.co/hZxqYsNTSi',
      created_at: 'Sun Sep 13 08:00:00 +0000 2026',
      lang: 'zh',
      reply_count: 10,
      retweet_count: 20,
      favorite_count: 30,
      entities: {
        urls: [{ url: 'https://t.co/hZxqYsNTSi', expanded_url: 'https://example.com/swarm' }],
        media: [],
      },
    },
    core: {
      user_results: {
        result: {
          __typename: 'User',
          core: { name: '测试作者', screen_name: 'testauthor', created_at: 'Thu Jan 01 00:00:00 +0000 2020' },
          avatar: { image_url: 'https://pbs.twimg.com/avatar.jpg' },
          rest_id: '1',
        },
      },
    },
    ...overrides,
  };
  return {
    entryId: `tweet-${result.rest_id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { itemType: 'TimelineTweet', tweet_results: { result } },
    },
  };
}

function articleEntry() {
  const entry = tweetEntry({
    rest_id: '1900000000000000004',
    legacy: {
      id_str: '1900000000000000004',
      full_text: 'https://t.co/xHT4RP4wry',
      created_at: 'Sun Sep 13 07:00:00 +0000 2026',
      lang: 'zxx',
      reply_count: 1,
      retweet_count: 2,
      favorite_count: 3,
      entities: {
        urls: [
          { url: 'https://t.co/xHT4RP4wry', expanded_url: 'https://x.com/i/article/1900000000000000005' },
        ],
        media: [],
      },
    },
    article: {
      article_results: {
        result: {
          rest_id: '1900000000000000005',
          title: '合成长文标题：仅用于测试',
          preview_text: '这是一段合成的长文预览，仅用于测试。',
          cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
        },
      },
    },
  });
  entry.entryId = 'tweet-1900000000000000004';
  return entry;
}

function bookmarksBody(entries: unknown[], cursor?: string) {
  const all = [
    ...entries,
    ...(cursor !== undefined
      ? [{ entryId: 'cursor-bottom', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: cursor } }]
      : []),
  ];
  return { data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: all }] } } } };
}

describe('parseBookmarksPage', () => {
  it('解析推文条目与 Bottom 游标，展开 t.co', () => {
    const page = parseBookmarksPage(bookmarksBody([tweetEntry(), articleEntry()], 'cursor-abc'));
    expect(page.tweets).toHaveLength(2);
    expect(page.cursor).toBe('cursor-abc');
    expect(page.tweets[0].text).toBe('一段合成的推文正文\nhttps://example.com/swarm');
    expect(page.tweets[0].source).toBe('cookie');
    expect(page.tweets[1].article?.title).toBe('合成长文标题：仅用于测试');
  });

  it('跳过非推文条目与结构异常条目，不拖垮整页', () => {
    const broken = {
      entryId: 'tweet-broken',
      content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: {} } },
    };
    const module = {
      entryId: 'module-1',
      content: { entryType: 'TimelineTimelineModule', items: [] },
    };
    const page = parseBookmarksPage(bookmarksBody([broken, module, tweetEntry()]));
    expect(page.tweets).toHaveLength(1);
  });

  it('无 Bottom 游标（末页）返回 cursor null', () => {
    const page = parseBookmarksPage(bookmarksBody([tweetEntry()]));
    expect(page.cursor).toBeNull();
    expect(page.tweets).toHaveLength(1);
  });

  it('解开 TweetWithVisibilityResults 包装层（受限可见性推文）', () => {
    const inner = tweetEntry().content.itemContent.tweet_results.result;
    const wrapped = {
      entryId: 'tweet-wrapped',
      content: {
        entryType: 'TimelineTimelineItem',
        itemContent: {
          itemType: 'TimelineTweet',
          tweet_results: {
            result: { __typename: 'TweetWithVisibilityResults', tweet: inner, limitedActionResults: {} },
          },
        },
      },
    };
    const page = parseBookmarksPage(bookmarksBody([wrapped]));
    expect(page.tweets).toHaveLength(1);
    expect(page.tweets[0].id).toBe('1900000000000000003');
    expect(page.tweets[0].author.handle).toBe('testauthor');
  });
});

describe('deriveItemFields', () => {
  it('文章推：标题取文章标题，摘要取预览，打 x-article 标签', () => {
    const page = parseBookmarksPage(bookmarksBody([articleEntry()]));
    const f = deriveItemFields(page.tweets[0]);
    expect(f.title).toBe('合成长文标题：仅用于测试');
    expect(f.summary).toContain('合成的长文预览');
    expect(f.tags).toContain('x-article');
    expect(f.tags).toContain('x-bookmark');
  });

  it('普通推：标题取首行并去掉链接，摘要取全文', () => {
    const page = parseBookmarksPage(bookmarksBody([tweetEntry()]));
    const f = deriveItemFields(page.tweets[0]);
    expect(f.title).toBe('一段合成的推文正文');
    expect(f.summary).toContain('https://example.com/swarm');
    expect((f.metadata as any).author).toBe('测试作者 (@testauthor)');
  });
});

describe('importBookmarks', () => {
  const mkTweet = (id: string): TweetData => ({
    id,
    url: `https://x.com/testauthor/status/${id}`,
    author: { name: '测试作者', handle: 'testauthor', avatar: '' },
    text: `推文内容 ${id}`,
    createdAt: 'Sun Sep 13 08:00:00 +0000 2026',
    lang: 'zh',
    metrics: { replies: 1, reposts: 2, likes: 3 },
    media: [],
    quoted: null,
    inReplyTo: null,
    article: null,
    source: 'cookie',
  });

  it('新推文入库并写原文文件，重复 URL 跳过不覆盖', () => {
    const first = importBookmarks(db, [mkTweet('1'), mkTweet('2')]);
    expect(first).toEqual({ imported: 2, skipped: 0, failed: 0, total: 2 });

    // 用户手改标题后再导入 → 跳过，标题保持手改值
    const item = db.listItems().items[0];
    db.updateItem(item.id, { title: '我改过的标题' });

    const second = importBookmarks(db, [mkTweet('1'), mkTweet('3')]);
    expect(second.imported).toBe(1);
    expect(second.skipped).toBe(1);
    expect(db.getItem(item.id)?.title).toBe('我改过的标题');

    // 原文文件落盘
    const contentPath = db.itemContentPath(db.listItems().items[0].id);
    expect(existsSync(contentPath)).toBe(true);
    expect(readFileSync(contentPath, 'utf8')).toContain('推文内容');
  });

  it('无效 URL 计入 failed，不抛异常', () => {
    const bad = { ...mkTweet('9'), url: 'not-a-url' };
    const result = importBookmarks(db, [bad, mkTweet('1')]);
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
  });
});
