import { BROWSER_UA, resolveShortLink } from './net.js';
import { loadXCredentials } from './cookies.js';

const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result';

export interface TweetMedia {
  type: 'image' | 'video' | 'gif';
  url: string;
  alt: string;
}

/** X 长文（article）：推文正文只是一个指向它的链接，标题与预览来自 syndication */
export interface TweetArticle {
  id: string;
  title: string;
  previewText: string;
  coverUrl: string | null;
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
  article: TweetArticle | null;
  /** 抓取方式（用于诊断） */
  source: 'syndication' | 'oembed' | 'cookie';
}

export function articleUrl(id: string): string {
  return `https://x.com/i/article/${id}`;
}

/**
 * 清洗推文正文：媒体占位 t.co 链接直接移除（媒体单独渲染），
 * 其余 t.co 短链替换为 entities.urls 里的展开链接。
 * 传给 LLM 与缓存的正文不应再出现未展开的 t.co。
 */
export function cleanTweetText(
  text: string,
  urlEntities: Array<{ url?: string; expanded_url?: string }>,
  mediaEntities: Array<{ url?: string }>,
): string {
  let out = text;
  for (const m of mediaEntities) {
    if (m?.url) out = out.split(m.url).join('');
  }
  for (const u of urlEntities) {
    if (u?.url && u.expanded_url) out = out.split(u.url).join(u.expanded_url);
  }
  return out.trim();
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

export function mapSyndicationTweet(t: any, source: TweetData['source']): TweetData {
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
    // 正文清洗：移除媒体占位 t.co、展开其余 t.co 短链
    // （article 分享推文的正文因此变成指向文章页的真实链接）
    text: cleanTweetText(t.text ?? '', t.entities?.urls ?? [], t.entities?.media ?? []),
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
          text: cleanTweetText(
            t.quoted_tweet.text ?? '',
            t.quoted_tweet.entities?.urls ?? [],
            t.quoted_tweet.entities?.media ?? [],
          ),
          url: `https://x.com/${t.quoted_tweet.user?.screen_name ?? ''}/status/${t.quoted_tweet.id_str ?? ''}`,
        }
      : null,
    inReplyTo: t.in_reply_to_status_id_str
      ? { id: t.in_reply_to_status_id_str, handle: t.in_reply_to_screen_name ?? '' }
      : null,
    article: mapSyndicationArticle(t.article),
    source,
  };
}

/** syndication 的 article 节点 → 精简结构；字段缺失时返回 null（不臆造） */
function mapSyndicationArticle(a: any): TweetArticle | null {
  if (!a?.rest_id || !a?.title) return null;
  return {
    id: String(a.rest_id),
    title: String(a.title),
    previewText: String(a.preview_text ?? ''),
    coverUrl: a.cover_media?.media_info?.original_img_url ?? null,
  };
}

/* ── GraphQL（TweetResultByRestId / Bookmarks 共用的 result 形态）───────── */

/**
 * 受限可见性推文（被标记敏感内容等）会多包一层 TweetWithVisibilityResults，
 * 真正的推文挂在 `.tweet` 上；普通推文原样返回。
 */
export function unwrapTweetResult(raw: any): any {
  return raw?.tweet ?? raw;
}

/**
 * GraphQL 推文 result → TweetData。
 * 2026 起用户字段从 `user.legacy` 迁到 `user.core` + `user.avatar`，
 * X 长文在 `article.article_results.result`（仅当 features 开启 articles_preview）。
 */
export function mapGraphqlTweet(raw: any, source: TweetData['source']): TweetData {
  const result = unwrapTweetResult(raw);
  const legacy = result?.legacy;
  const user = result?.core?.user_results?.result;
  if (!legacy || !user) throw new Error('GraphQL 推文结构异常');
  const handle: string = user.core?.screen_name ?? user.legacy?.screen_name ?? '';
  const media: TweetMedia[] = (legacy.entities?.media ?? []).map((m: any) => ({
    type: m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'gif' : 'image',
    url: m.media_url_https ?? '',
    alt: m.ext_alt_text ?? '',
  }));
  const quotedResult = unwrapTweetResult(legacy.quoted_status_result?.result);
  return {
    id: legacy.id_str ?? result.rest_id ?? '',
    url: `https://x.com/${handle}/status/${legacy.id_str ?? result.rest_id ?? ''}`,
    author: {
      name: user.core?.name ?? user.legacy?.name ?? '',
      handle,
      avatar: user.avatar?.image_url ?? user.legacy?.profile_image_url_https ?? '',
    },
    text: cleanTweetText(legacy.full_text ?? '', legacy.entities?.urls ?? [], legacy.entities?.media ?? []),
    createdAt: legacy.created_at ?? '',
    lang: legacy.lang ?? '',
    metrics: {
      replies: legacy.reply_count ?? legacy.conversation_count ?? 0,
      reposts: legacy.retweet_count ?? 0,
      likes: legacy.favorite_count ?? 0,
    },
    media,
    quoted: quotedResult
      ? {
          author: quotedResult.core?.user_results?.result?.core?.name
            ?? quotedResult.core?.user_results?.result?.legacy?.name ?? '',
          handle: quotedResult.core?.user_results?.result?.core?.screen_name
            ?? quotedResult.core?.user_results?.result?.legacy?.screen_name ?? '',
          text: cleanTweetText(
            quotedResult.legacy?.full_text ?? '',
            quotedResult.legacy?.entities?.urls ?? [],
            quotedResult.legacy?.entities?.media ?? [],
          ),
          url: `https://x.com/${quotedResult.core?.user_results?.result?.core?.screen_name
            ?? quotedResult.core?.user_results?.result?.legacy?.screen_name ?? ''}/status/${quotedResult.legacy?.id_str ?? quotedResult.rest_id ?? ''}`,
        }
      : null,
    inReplyTo: legacy.in_reply_to_status_id_str
      ? { id: legacy.in_reply_to_status_id_str, handle: legacy.in_reply_to_screen_name ?? '' }
      : null,
    article: mapSyndicationArticle(result.article?.article_results?.result),
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
    article: null,
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

/** 第三层：登录 Cookie 兜底（x.cookie.json 或 .env 的 X_AUTH_TOKEN / X_CT0） */
async function fetchViaCookie(id: string): Promise<TweetData | null> {
  const cred = loadXCredentials();
  if (!cred) return null;
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
        cookie: cred.cookieHeader,
        'x-csrf-token': cred.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'user-agent': BROWSER_UA,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`Cookie 兜底接口返回 HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const result = unwrapTweetResult(body?.data?.tweetResult?.result);
  if (!result?.legacy) {
    throw new Error('Cookie 兜底接口返回结构异常（queryId 可能过期，可在 .env 配置 X_GQL_QUERY_ID）');
  }
  return mapGraphqlTweet(result, 'cookie');
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
  if (!parsed) {
    // t.co 解析后指向的不是推文（如 X 长文页），把目标告诉调用方便于降级
    if (url !== rawUrl.trim()) throw new Error(`t.co 指向的不是推文链接：${url}`);
    throw new Error('不是有效的推文链接（需 x.com / twitter.com 的 status 链接）');
  }

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
  if (t.article) {
    // X 长文：正文只有一个链接，标题与预览来自 syndication，全文需登录才能拿到
    lines.push('');
    lines.push(`**长文：${t.article.title}**`);
    lines.push('');
    if (t.article.previewText) lines.push(t.article.previewText);
    if (t.article.coverUrl) lines.push(`\n![${t.article.title}](${t.article.coverUrl})`);
    lines.push('');
    lines.push(`[阅读全文](${articleUrl(t.article.id)})`);
  }
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
