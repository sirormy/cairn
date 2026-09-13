import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface CachedContent {
  kind: 'webpage' | 'tweet' | 'github';
  url: string;
  /** 原文 markdown（网页正文 / 推文渲染 / README 等） */
  markdown: string;
  meta: Record<string, unknown>;
  savedAt: number;
}

export interface ContentCache {
  put(content: CachedContent): void;
  /** 按 URL 取缓存（内存优先，其次磁盘） */
  take(url: string): CachedContent | null;
}

export function createContentCache(dir: string): ContentCache {
  const memory = new Map<string, CachedContent>();
  mkdirSync(dir, { recursive: true });
  const fileOf = (url: string) =>
    path.join(dir, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);

  return {
    put(content) {
      memory.set(content.url, content);
      try {
        writeFileSync(fileOf(content.url), JSON.stringify(content), 'utf8');
      } catch {
        /* 磁盘缓存失败不阻塞 */
      }
    },
    take(url) {
      const m = memory.get(url);
      if (m) return m;
      try {
        const raw = readFileSync(fileOf(url), 'utf8');
        const parsed = JSON.parse(raw) as CachedContent;
        memory.set(url, parsed);
        return parsed;
      } catch {
        return null;
      }
    },
  };
}
