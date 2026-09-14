import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function ipv4ToLong(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0) as number;
}

/** 判断 IP 是否为回环 / 内网 / 链路本地 / 保留地址 */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToLong(ip);
    const inCidr = (cidr: string): boolean => {
      const [base, bitsRaw] = cidr.split('/');
      const bits = Number(bitsRaw);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((n & mask) >>> 0) === ((ipv4ToLong(base) & mask) >>> 0);
    };
    return (
      inCidr('0.0.0.0/8') ||
      inCidr('10.0.0.0/8') ||
      inCidr('100.64.0.0/10') ||
      inCidr('127.0.0.0/8') ||
      inCidr('169.254.0.0/16') ||
      inCidr('172.16.0.0/12') ||
      inCidr('192.0.0.0/24') ||
      inCidr('192.168.0.0/16') ||
      inCidr('224.0.0.0/4')
      // 注意：刻意不拦 198.18.0.0/15（benchmark 网段）。Clash/Mihomo 等代理的
      // fake-ip 模式会把所有 DNS 应答替换成该网段，拦截它会导致代理机器上
      // 一切抓取失败；这是本机单人工具，真实 SSRF 向量（回环/RFC1918/
      // 链路本地/CGNAT/组播）仍在拦截列表里。
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    // ::ffff:x.x.x.x IPv4 映射地址
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd][0-9a-f]*:/.test(v)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]*:/.test(v)) return true; // fe80::/10 link-local
    if (v.startsWith('::')) return true;
    if (/^ff/.test(v)) return true; // 组播
    return false;
  }
  return true; // 无法识别的地址一律视为不安全
}

/**
 * 校验 URL 是否允许抓取：仅 http/https、禁止凭证、禁止本地/内网主机。
 * 抛出 Error 表示不允许。
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`无效的链接：${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`仅支持 http/https 链接，收到 ${u.protocol}`);
  }
  if (u.username || u.password) throw new Error('不允许包含登录凭证的链接');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    throw new Error(`禁止访问本地/内部域名：${host}`);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`禁止访问内网地址：${host}`);
  } else {
    let addrs: { address: string }[];
    try {
      addrs = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error(`域名无法解析：${host}`);
    }
    if (addrs.length === 0) throw new Error(`域名无法解析：${host}`);
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        throw new Error(`域名解析到内网地址，已禁止：${host} → ${a.address}`);
      }
    }
  }
  return u;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  contentType: string;
  text: string;
}

async function readBody(
  res: Response,
  url: URL,
  maxBytes: number,
): Promise<SafeFetchResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`响应体过大（超过 ${Math.round(maxBytes / 1024 / 1024)}MB）`);
        }
        chunks.push(value);
      }
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return {
    status: res.status,
    finalUrl: url.toString(),
    contentType: res.headers.get('content-type') ?? '',
    text,
  };
}

/**
 * 带安全校验的抓取：每跳重定向都会重新做 SSRF 校验；
 * 响应体大小与超时受限。
 */
export async function safeFetch(
  rawUrl: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
    accept?: string;
  } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  let url = await assertSafeUrl(rawUrl);

  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': BROWSER_UA,
        accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...opts.headers,
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return readBody(res, url, maxBytes);
      url = await assertSafeUrl(new URL(loc, url).toString());
      continue;
    }
    return readBody(res, url, maxBytes);
  }
  throw new Error('重定向次数过多');
}

/** 从短链中转页 HTML 解析 meta refresh 目标地址，失败返回 null */
export function parseMetaRefresh(html: string): string | null {
  const meta = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*>/i);
  const content = meta?.[0].match(/content=["']?([^"'>]+)["']?/i)?.[1] ?? '';
  const target = content.match(/URL=(\S+)/i)?.[1];
  return target ?? null;
}

/**
 * 解析 t.co 短链，返回最终 URL，失败返回 null。
 * t.co 已不再发 301（HEAD/GET 都返回 200），改为返回带
 * `<meta http-equiv="refresh">` 跳转的中转页，两种都要处理。
 */
export async function resolveShortLink(raw: string): Promise<string | null> {
  let url = raw;
  for (let i = 0; i < 4; i++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)t\.co$/.test(u.hostname)) return url;
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': BROWSER_UA },
    }).catch(() => null);
    if (!res) return null;
    const loc = res.headers.get('location');
    if (loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    const target = parseMetaRefresh(await res.text().catch(() => ''));
    if (target) {
      url = new URL(target, url).toString();
      continue;
    }
    return null;
  }
  return null;
}
