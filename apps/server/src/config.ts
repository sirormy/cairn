import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ 与 dist/ 均位于 apps/server 下，仓库根为其上三级
export const repoRoot = path.resolve(here, '..', '..', '..');

loadDotenv({ path: path.join(repoRoot, '.env') });

export interface AppConfig {
  port: number;
  /** 监听地址，默认仅本机；设为 0.0.0.0 才会暴露到局域网 */
  host: string;
  dataDir: string;
  webDist: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmModelName: string;
  githubToken: string;
  xAuthToken: string;
  xCt0: string;
  /** X 登录 cookie 文件（书签导入 / 推文 cookie 兜底层共用），默认 <repoRoot>/x.cookie.json */
  xCookieFile: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // 用 API_PORT 而非 PORT：部署工具常向进程注入 PORT 指向 web 端口，会覆盖 .env
    port: Number(env.API_PORT ?? 8787) || 8787,
    // 默认只绑本机：接口无鉴权，暴露到局域网等于把收藏库和 X 登录态交出去
    host: (env.HOST ?? '').trim() || '127.0.0.1',
    dataDir: path.join(repoRoot, 'data'),
    webDist: path.join(repoRoot, 'apps', 'web', 'dist'),
    llmBaseUrl: (env.LLM_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    llmApiKey: (env.LLM_API_KEY ?? '').trim(),
    llmModel: (env.LLM_MODEL ?? '').trim(),
    llmModelName: (env.LLM_MODEL_NAME ?? '').trim(),
    githubToken: (env.GITHUB_TOKEN ?? '').trim(),
    xAuthToken: (env.X_AUTH_TOKEN ?? '').trim(),
    xCt0: (env.X_CT0 ?? '').trim(),
    xCookieFile: (env.X_COOKIE_FILE ?? '').trim() || path.join(repoRoot, 'x.cookie.json'),
  };
}

export const config = loadConfig();
