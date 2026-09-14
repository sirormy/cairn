import { describe, expect, it } from 'vitest';
import {
  buildTweetMarkdown,
  cleanTweetText,
  mapSyndicationTweet,
  type TweetData,
} from './tweet.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const baseSyndication = {
  __typename: 'Tweet',
  id_str: '1900000000000000001',
  created_at: 'Fri Sep 12 10:00:00 +0000 2026',
  lang: 'en',
  conversation_count: 100,
  retweet_count: 200,
  favorite_count: 300,
  user: {
    name: 'Fixture Author',
    screen_name: 'fixtureauthor',
    profile_image_url_https: 'https://pbs.twimg.com/avatar.jpg',
  },
};

/** X 长文分享推文（用户实际遇到的形态） */
const articleSyndication = {
  ...baseSyndication,
  text: 'https://t.co/LalU5XENsk',
  entities: {
    urls: [
      {
        url: 'https://t.co/LalU5XENsk',
        expanded_url: 'https://x.com/i/article/1900000000000000002',
      },
    ],
  },
  article: {
    rest_id: '1900000000000000002',
    title: 'A synthetic long-form title for tests',
    preview_text: 'A synthetic preview paragraph for tests.',
    cover_media: {
      media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' },
    },
  },
};

describe('cleanTweetText', () => {
  it('展开普通 t.co 短链', () => {
    expect(
      cleanTweetText(
        '看看这个 https://t.co/abc123 很不错',
        [{ url: 'https://t.co/abc123', expanded_url: 'https://example.com/post' }],
        [],
      ),
    ).toBe('看看这个 https://example.com/post 很不错');
  });

  it('移除媒体占位链接', () => {
    expect(
      cleanTweetText('配图说明 https://t.co/pic1', [], [{ url: 'https://t.co/pic1' }]),
    ).toBe('配图说明');
  });

  it('对没有实体的文本原样返回', () => {
    expect(cleanTweetText('纯文本推文', [], [])).toBe('纯文本推文');
  });
});

describe('mapSyndicationTweet', () => {
  it('映射 X 长文：t.co 换成文章页链接，article 结构完整', () => {
    const t = mapSyndicationTweet(articleSyndication, 'syndication');
    expect(t.text).toBe('https://x.com/i/article/1900000000000000002');
    expect(t.article).toEqual({
      id: '1900000000000000002',
      title: 'A synthetic long-form title for tests',
      previewText: 'A synthetic preview paragraph for tests.',
      coverUrl: 'https://pbs.twimg.com/media/cover.jpg',
    });
  });

  it('普通推文：正文中的 t.co 展开，article 为 null', () => {
    const t = mapSyndicationTweet(
      {
        ...baseSyndication,
        text: 'new essay https://t.co/xyz789',
        entities: {
          urls: [{ url: 'https://t.co/xyz789', expanded_url: 'https://example.com/essay' }],
        },
      },
      'syndication',
    );
    expect(t.text).toBe('new essay https://example.com/essay');
    expect(t.article).toBeNull();
  });

  it('引用推文的正文同样清洗', () => {
    const t = mapSyndicationTweet(
      {
        ...baseSyndication,
        text: 'great thread',
        entities: { urls: [] },
        quoted_tweet: {
          id_str: '123',
          text: 'point one https://t.co/q1',
          user: { name: 'Q', screen_name: 'qauthor' },
          entities: { urls: [{ url: 'https://t.co/q1', expanded_url: 'https://example.com/q1' }] },
        },
      },
      'syndication',
    );
    expect(t.quoted?.text).toBe('point one https://example.com/q1');
  });

  it('article 节点缺字段时返回 null，不臆造', () => {
    const t = mapSyndicationTweet(
      { ...baseSyndication, text: 'hi', entities: { urls: [] }, article: { rest_id: '1' } },
      'syndication',
    );
    expect(t.article).toBeNull();
  });
});

describe('buildTweetMarkdown', () => {
  it('渲染长文块：标题、预览、阅读全文链接、封面', () => {
    const t = mapSyndicationTweet(articleSyndication, 'syndication');
    const md = buildTweetMarkdown(t as TweetData);
    expect(md).toContain('**长文：A synthetic long-form title for tests**');
    expect(md).toContain('A synthetic preview paragraph for tests.');
    expect(md).toContain('[阅读全文](https://x.com/i/article/1900000000000000002)');
    expect(md).toContain('![');
    expect(md).toContain('https://pbs.twimg.com/media/cover.jpg');
  });

  it('普通推文不输出长文块', () => {
    const t = mapSyndicationTweet(
      { ...baseSyndication, text: 'just a thought', entities: { urls: [] } },
      'syndication',
    );
    const md = buildTweetMarkdown(t as TweetData);
    expect(md).not.toContain('长文：');
    expect(md).toContain('just a thought');
  });
});
