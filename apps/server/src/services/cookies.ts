import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';

export interface XCredentials {
  /** 完整 cookie 请求头（auth_token、ct0、twid 等） */
  cookieHeader: string;
  authToken: string;
  ct0: string;
}

/** X 站点 cookie 名（来自 cookie 文件时其余项透传，这几个是调用 API 的关键） */
const X_KEYS = new Set(['auth_token', 'ct0', 'twid', 'guest_id', 'kdt', 'personalization_id']);

/**
 * 解析 cookie 文件内容。支持两种导出格式：
 * - EditThisCookie 等扩展的 JSON 数组：[{name, value, domain, ...}]
 * - Netscape cookies.txt：每行 `domain \t flag \t path \t secure \t expiry \t name \t value`
 */
export function parseCookieFile(text: string): XCredentials {
  const pairs: Array<[string, string]> = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    const raw = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(raw)) throw new Error('cookie 文件是 JSON 但不是数组');
    for (const c of raw as Array<Record<string, unknown>>) {
      if (typeof c?.name === 'string' && typeof c?.value === 'string') {
        pairs.push([c.name, c.value]);
      }
    }
  } else {
    for (const rawLine of trimmed.split('\n')) {
      // Netscape 格式里 HttpOnly 行写作 `#HttpOnly_<domain>\t...`，
      // 得先剥掉前缀再判注释，否则 auth_token / ct0 会被整行丢掉
      const line = rawLine.replace(/^#HttpOnly_/, '');
      if (!line || line.startsWith('#')) continue;
      const cols = line.split('\t');
      if (cols.length >= 7) pairs.push([cols[5], cols[6]]);
    }
  }
  const map = new Map(pairs);
  for (const [k] of map) {
    if (!X_KEYS.has(k)) map.delete(k);
  }
  const authToken = map.get('auth_token');
  const ct0 = map.get('ct0');
  if (!authToken || !ct0) {
    throw new Error('cookie 文件缺少 auth_token 或 ct0（需在登录 x.com 的浏览器里导出完整 cookie）');
  }
  return {
    cookieHeader: [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    authToken,
    ct0,
  };
}

/**
 * 读取 X 登录 cookie：优先 x.cookie.json 文件，其次 .env 的 X_AUTH_TOKEN / X_CT0。
 * 两者都没有时返回 null（调用方决定如何降级）。
 */
export function loadXCredentials(): XCredentials | null {
  if (existsSync(config.xCookieFile)) {
    return parseCookieFile(readFileSync(config.xCookieFile, 'utf8'));
  }
  if (config.xAuthToken && config.xCt0) {
    return {
      cookieHeader: `auth_token=${config.xAuthToken}; ct0=${config.xCt0}`,
      authToken: config.xAuthToken,
      ct0: config.xCt0,
    };
  }
  return null;
}
