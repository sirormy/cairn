import { config } from '../config.js';

export interface GithubRepoData {
  owner: string;
  repo: string;
  url: string;
  description: string;
  homepage: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  license: string | null;
  createdAt: string | null;
  pushedAt: string | null;
  defaultBranch: string;
  latestRelease: { tag: string; name: string | null; publishedAt: string | null } | null;
  readme: string;
}

const RESERVED_SEGMENTS = new Set([
  'about',
  'collections',
  'enterprise',
  'explore',
  'features',
  'feedback',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  's',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'topics',
  'trending',
]);

export function parseGithubRepo(raw: string): { owner: string; repo: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|$)/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (RESERVED_SEGMENTS.has(owner.toLowerCase()) || RESERVED_SEGMENTS.has(repo.toLowerCase())) {
    return null;
  }
  return { owner, repo };
}

function ghHeaders(accept: string): Record<string, string> {
  const h: Record<string, string> = {
    accept,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'cairn',
  };
  if (config.githubToken) h.authorization = `Bearer ${config.githubToken}`;
  return h;
}

async function ghJson<T>(apiPath: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    headers: ghHeaders('application/vnd.github+json'),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${apiPath} 返回 HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function fetchGithubRepo(rawUrl: string): Promise<GithubRepoData> {
  const parsed = parseGithubRepo(rawUrl);
  if (!parsed) throw new Error('不是有效的 GitHub 仓库链接');

  const { owner, repo } = parsed;
  const info = await ghJson<any>(`/repos/${owner}/${repo}`);
  if (!info) throw new Error(`仓库不存在或无权访问：${owner}/${repo}`);

  let readme = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: ghHeaders('application/vnd.github.raw+json'),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) readme = (await res.text()).slice(0, 120_000);
  } catch {
    /* README 拉取失败不阻塞 */
  }

  let latestRelease: GithubRepoData['latestRelease'] = null;
  try {
    const release = await ghJson<any>(`/repos/${owner}/${repo}/releases/latest`);
    if (release) {
      latestRelease = {
        tag: release.tag_name ?? '',
        name: release.name ?? null,
        publishedAt: release.published_at ?? null,
      };
    }
  } catch {
    /* release 拉取失败不阻塞 */
  }

  return {
    owner,
    repo,
    url: info.html_url ?? `https://github.com/${owner}/${repo}`,
    description: info.description ?? '',
    homepage: info.homepage || null,
    stars: info.stargazers_count ?? 0,
    forks: info.forks_count ?? 0,
    watchers: info.subscribers_count ?? 0,
    openIssues: info.open_issues_count ?? 0,
    language: info.language ?? null,
    topics: Array.isArray(info.topics) ? info.topics : [],
    license: info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : null,
    createdAt: info.created_at ?? null,
    pushedAt: info.pushed_at ?? null,
    defaultBranch: info.default_branch ?? 'main',
    latestRelease,
    readme,
  };
}

export function buildGithubMarkdown(d: GithubRepoData): string {
  const lines: string[] = [];
  lines.push(`# ${d.owner}/${d.repo}`);
  lines.push('');
  if (d.description) {
    lines.push(`> ${d.description}`);
    lines.push('');
  }
  lines.push(
    [
      `⭐ ${d.stars.toLocaleString()} Stars`,
      `⑂ ${d.forks.toLocaleString()} Forks`,
      `👁 ${d.watchers.toLocaleString()} Watchers`,
      d.language ? `🔧 ${d.language}` : '',
      d.license ? `📜 ${d.license}` : '',
      `🐛 ${d.openIssues.toLocaleString()} Open Issues`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  if (d.topics.length) lines.push(`Topics：${d.topics.map((t) => `#${t}`).join(' ')}`);
  if (d.homepage) lines.push(`主页：${d.homepage}`);
  if (d.createdAt) lines.push(`创建于：${d.createdAt.slice(0, 10)}`);
  if (d.pushedAt) lines.push(`最近推送：${d.pushedAt.slice(0, 10)}`);
  if (d.latestRelease) {
    lines.push(
      `最新发布：${d.latestRelease.tag}${d.latestRelease.publishedAt ? `（${d.latestRelease.publishedAt.slice(0, 10)}）` : ''}`,
    );
  }
  lines.push('');
  if (d.readme) {
    lines.push('## README');
    lines.push('');
    lines.push(d.readme);
  }
  return lines.join('\n');
}
