import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ 与 dist/ 均位于 apps/server 下，仓库根为其上三级
export const repoRoot = path.resolve(here, '..', '..', '..');

loadDotenv({ path: path.join(repoRoot, '.env') });

export interface AppConfig {
  port: number;
  dataDir: string;
  webDist: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmModelName: string;
  githubToken: string;
  xAuthToken: string;
  xCt0: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // 用 API_PORT 而非 PORT：部署工具常向进程注入 PORT 指向 web 端口，会覆盖 .env
    port: Number(env.API_PORT ?? 8787) || 8787,
    dataDir: path.join(repoRoot, 'data'),
    webDist: path.join(repoRoot, 'apps', 'web', 'dist'),
    llmBaseUrl: (env.LLM_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    llmApiKey: (env.LLM_API_KEY ?? '').trim(),
    llmModel: (env.LLM_MODEL ?? '').trim(),
    llmModelName: (env.LLM_MODEL_NAME ?? '').trim(),
    githubToken: (env.GITHUB_TOKEN ?? '').trim(),
    xAuthToken: (env.X_AUTH_TOKEN ?? '').trim(),
    xCt0: (env.X_CT0 ?? '').trim(),
  };
}

export const config = loadConfig();
