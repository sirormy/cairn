import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { safeFetch } from './net.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.remove(['script', 'style', 'noscript', 'iframe']);

export interface WebpageContent {
  url: string;
  finalUrl: string;
  title: string;
  siteName: string;
  description: string;
  byline: string;
  lang: string;
  wordCount: number;
  markdown: string;
  /** 是否成功提取到文章正文（否则只是普通页面信息） */
  isArticle: boolean;
}

export function extractFromHtml(html: string, url: string): WebpageContent {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? '';
  const htmlTitle = doc.querySelector('title')?.textContent?.trim() ?? '';
  const lang = doc.documentElement.getAttribute('lang') ?? '';

  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(doc).parse();
  } catch {
    /* HTML 异常时走兜底 */
  }

  if (article?.content) {
    const markdown = turndown.turndown(article.content).trim();
    const text = (article.textContent ?? '').replace(/\s+/g, ' ');
    return {
      url,
      finalUrl: url,
      title: article.title || htmlTitle,
      siteName: article.siteName || meta('meta[property="og:site_name"]'),
      description: article.excerpt || meta('meta[name="description"]') || meta('meta[property="og:description"]'),
      byline: article.byline ?? '',
      lang: article.lang || lang,
      wordCount: text.length,
      markdown,
      isArticle: text.length > 280,
    };
  }

  // 非文章页面（产品/官网等）：提取 meta 信息与主体文本摘要
  const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    url,
    finalUrl: url,
    title: meta('meta[property="og:title"]') || htmlTitle,
    siteName: meta('meta[property="og:site_name"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    byline: '',
    lang,
    wordCount: bodyText.length,
    markdown: bodyText.slice(0, 20_000),
    isArticle: false,
  };
}

export async function extractWebpage(rawUrl: string): Promise<WebpageContent> {
  const res = await safeFetch(rawUrl);
  if (res.status >= 400) throw new Error(`网页抓取失败（HTTP ${res.status}）`);
  const content = extractFromHtml(res.text, res.finalUrl);
  return { ...content, url: rawUrl, finalUrl: res.finalUrl };
}
