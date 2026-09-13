import { config } from '../config.js';
import { BROWSER_UA, resolveShortLink } from './net.js';

const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result';

export interface TweetMedia {
  type: 'image' | 'video' | 'gif';
  url: string;
  alt: string;
}

export interface TweetData {
  id: string;
  url: string;
  author: { name: string; handle: string; avatar: string };
  text: string;
  createdAt: string;
  lang: string;
  metrics: { replies: number; reposts: number; likes: number };
  media: TweetMedia[];
  quoted: {
    author: string;
    handle: string;
    text: string;
    url: string;
  } | null;
  inReplyTo: { id: string; handle: string } | null;
  /** 抓取方式（用于诊断） */
  source: 'syndication' | 'oembed' | 'cookie';
}

/** syndication 接口的 token，按公开算法由推文 id 计算 */
export function tweetToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

const SYNDICATION_FEATURES = [
  'tfw_timeline_list:',
  'tfw_follower_count_sunset:true',
  'tfw_tweet_edit_backend:on',
  'tfw_refsrc_session:on',
  'tfw_fosnr_soft_interventions_enabled:on',
  'tfw_show_birdwatch_pivots_enabled:on',
  'tfw_show_business_verified_badge:on',
  'tfw_duplicate_scribes_to_settings:on',
  'tfw_use_profile_image_shape_enabled:on',
  'tfw_show_blue_verified_badge:on',
  'tfw_legacy_timeline_sunset:true',
  'tfw_show_gov_verified_badge:on',
  'tfw_show_business_affiliate_badge:on',
  'tfw_tweet_edit_frontend:on',
].join(';');

export function parseTweetUrl(raw: string): { id: string; handle: string | null } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(
    /^\/(?:i\/web\/)?(?:([A-Za-z0-9_]{1,20})\/)?status(?:es)?\/(\d{4,25})/,
  );
  if (!m) return null;
  return { handle: m[1] ?? null, id: m[2] };
}

export function isTweetUrl(raw: string): boolean {
  return parseTweetUrl(raw) !== null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapSyndicationTweet(t: any, source: TweetData['source']): TweetData {
  const handle: string = t.user?.screen_name ?? '';
  const media: TweetMedia[] = (t.mediaDetails ?? []).map((m: any) => ({
    type: m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : 'image',
    url: m.media_url_https ?? '',
    alt: m.ext_alt_text ?? '',
  }));
  return {
    id: t.id_str,
    url: `https://x.com/${handle}/status/${t.id_str}`,
    author: {
      name: t.user?.name ?? '',
      handle,
      avatar: t.user?.profile_image_url_https ?? '',
    },
    text: t.text ?? '',
    createdAt: t.created_at ?? '',
    lang: t.lang ?? '',
    metrics: {
      replies: t.conversation_count ?? 0,
      reposts: t.retweet_count ?? 0,
      likes: t.favorite_count ?? 0,
    },
    media,
    quoted: t.quoted_tweet
      ? {
          author: t.quoted_tweet.user?.name ?? '',
          handle: t.quoted_tweet.user?.screen_name ?? '',
          text: t.quoted_tweet.text ?? '',
          url: `https://x.com/${t.quoted_tweet.user?.screen_name ?? ''}/status/${t.quoted_tweet.id_str ?? ''}`,
        }
      : null,
    inReplyTo: t.in_reply_to_status_id_str
      ? { id: t.in_reply_to_status_id_str, handle: t.in_reply_to_screen_name ?? '' }
      : null,
    source,
  };
}

/** 第一层：免登录 syndication 接口 */
async function fetchViaSyndication(id: string): Promise<TweetData | null> {
  const url = `${SYNDICATION_URL}?id=${encodeURIComponent(id)}&lang=en&features=${encodeURIComponent(SYNDICATION_FEATURES)}&token=${tweetToken(id)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('推文不存在或已被删除');
  if (!res.ok) throw new Error(`syndication 接口返回 HTTP ${res.status}`);
  const data = (await res.json()) as any;
  if (data.__typename === 'TweetTombstone') throw new Error('推文已被作者设为仅限关注者可见');
  if (!data || Object.keys(data).length === 0) throw new Error('syndication 接口返回空数据');
  return mapSyndicationTweet(data, 'syndication');
}

/** 第二层：免登录 oembed 接口（信息较少但稳定） */
async function fetchViaOembed(url: string): Promise<TweetData | null> {
  const res = await fetch(
    `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=true`,
    { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`oembed 接口返回 HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const text = String(data.html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .trim();
  const handle = String(data.author_url ?? '').split('/').filter(Boolean).pop() ?? '';
  const id = url.match(/(\d{4,25})/)?.[1] ?? '';
  // oembed 文本末尾带 "— author date" 落款，尝试去掉
  const cleaned = text.replace(/\s*—\s*\S+\s+\S+\s*$/, '').trim();
  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    author: { name: data.author_name ?? '', handle, avatar: '' },
    text: cleaned,
    createdAt: '',
    lang: '',
    metrics: { replies: 0, reposts: 0, likes: 0 },
    media: [],
    quoted: null,
    inReplyTo: null,
    source: 'oembed',
  };
}

/** x.com Web 端公开 Bearer（可用 X_BEARER_TOKEN 覆盖） */
const X_BEARER =
  process.env.X_BEARER_TOKEN ??
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const GQL_QUERY_ID = process.env.X_GQL_QUERY_ID ?? 'xOhkmRac04YFZmOzUJReAw';
const GQL_FEATURES = process.env.X_GQL_FEATURES ?? JSON.stringify({
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_timeline_v2_batched_schedule: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: false,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  creator_subscriptions_card_preview_style: false,
  responsive_web_grok_ancestor_quote_attachment: false,
  communities_web_enable_tweet_community_results_fetch: false,
});

/** 第三层：登录 Cookie 兜底（需 .env 配置 X_AUTH_TOKEN 与 X_CT0） */
async function fetchViaCookie(id: string): Promise<TweetData | null> {
  if (!config.xAuthToken || !config.xCt0) return null;
  const variables = encodeURIComponent(
    JSON.stringify({
      tweetId: id,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    }),
  );
  const res = await fetch(
    `https://x.com/i/api/graphql/${GQL_QUERY_ID}/TweetResultByRestId?variables=${variables}&features=${encodeURIComponent(GQL_FEATURES)}`,
    {
      headers: {
        authorization: `Bearer ${X_BEARER}`,
        cookie: `auth_token=${config.xAuthToken}; ct0=${config.xCt0}`,
        'x-csrf-token': config.xCt0,
        'user-agent': BROWSER_UA,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`Cookie 兜底接口返回 HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const result = body?.data?.tweetResult?.result;
  const legacy = result?.legacy;
  const user = result?.core?.user_results?.result?.legacy;
  if (!legacy || !user) throw new Error('Cookie 兜底接口返回结构异常（queryId 可能过期，可在 .env 配置 X_GQL_QUERY_ID）');
  const handle: string = user.screen_name ?? '';
  const media: TweetMedia[] = (legacy.entities?.media ?? []).map((m: any) => ({
    type: m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : 'image',
    url: m.media_url_https ?? '',
    alt: m.ext_alt_text ?? '',
  }));
  return {
    id: legacy.id_str ?? id,
    url: `https://x.com/${handle}/status/${legacy.id_str ?? id}`,
    author: { name: user.name ?? '', handle, avatar: user.profile_image_url_https ?? '' },
    text: legacy.full_text ?? '',
    createdAt: legacy.created_at ?? '',
    lang: legacy.lang ?? '',
    metrics: {
      replies: legacy.reply_count ?? legacy.conversation_count ?? 0,
      reposts: legacy.retweet_count ?? 0,
      likes: legacy.favorite_count ?? 0,
    },
    media,
    quoted: null,
    inReplyTo: legacy.in_reply_to_status_id_str
      ? { id: legacy.in_reply_to_status_id_str, handle: legacy.in_reply_to_screen_name ?? '' }
      : null,
    source: 'cookie',
  };
}

/**
 * 分层抓取推文：syndication → oembed → 登录 Cookie 兜底。
 */
export async function fetchTweet(rawUrl: string): Promise<TweetData> {
  let url = rawUrl.trim();
  if (/(^|\.)t\.co$/.test(new URL(url).hostname)) {
    const resolved = await resolveShortLink(url);
    if (!resolved) throw new Error('无法解析 t.co 短链');
    url = resolved;
  }
  const parsed = parseTweetUrl(url);
  if (!parsed) throw new Error('不是有效的推文链接（需 x.com / twitter.com 的 status 链接）');

  const attempts: Array<() => Promise<TweetData | null>> = [
    () => fetchViaSyndication(parsed.id),
    () => fetchViaOembed(url),
    () => fetchViaCookie(parsed.id),
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const tweet = await attempt();
      if (tweet) return tweet;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(
    `推文抓取失败（已尝试 syndication / oembed / Cookie 兜底）：${errors.join('；')}`,
  );
}

export function buildTweetMarkdown(t: TweetData): string {
  const lines: string[] = [];
  lines.push(`**${t.author.name}** @${t.author.handle}`);
  if (t.createdAt) lines.push(`发布于 ${t.createdAt}`);
  lines.push('');
  lines.push(t.text);
  if (t.quoted) {
    lines.push('');
    lines.push(`> 引用 @${t.quoted.handle}：${t.quoted.text}`);
    lines.push(`> ${t.quoted.url}`);
  }
  if (t.media.length) {
    lines.push('');
    for (const m of t.media) {
      if (m.type === 'image') lines.push(`![${m.alt || '推文图片'}](${m.url})`);
      else lines.push(`[视频/GIF](${m.url})`);
    }
  }
  lines.push('');
  lines.push(`💬 ${t.metrics.replies} · 🔁 ${t.metrics.reposts} · ❤️ ${t.metrics.likes}`);
  lines.push('');
  lines.push(`原文：${t.url}`);
  return lines.join('\n');
}
