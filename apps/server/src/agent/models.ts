import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { AppConfig } from '../config.js';

export interface LlmSetup {
  models: MutableModels;
  model: Model<'openai-completions'>;
}

/**
 * 构建自定义 OpenAI 兼容 provider（火山方舟 / OpenRouter / DeepSeek / Ollama 等）。
 * 未配置时返回 null 与错误说明。
 */
export function buildLlm(cfg: AppConfig): { setup: LlmSetup | null; error: string | null } {
  const missing: string[] = [];
  if (!cfg.llmBaseUrl) missing.push('LLM_BASE_URL');
  if (!cfg.llmApiKey) missing.push('LLM_API_KEY');
  if (!cfg.llmModel) missing.push('LLM_MODEL');
  if (missing.length > 0) {
    return {
      setup: null,
      error: `LLM 未配置（缺少 ${missing.join('、')}），请在仓库根目录 .env 中填写后重启服务`,
    };
  }

  const model: Model<'openai-completions'> = {
    id: cfg.llmModel,
    name: cfg.llmModelName || cfg.llmModel,
    api: 'openai-completions',
    provider: 'custom-openai',
    baseUrl: cfg.llmBaseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };

  const provider = createProvider({
    id: 'custom-openai',
    name: '自定义 OpenAI 兼容端点',
    baseUrl: cfg.llmBaseUrl,
    auth: { apiKey: envApiKeyAuth('LLM API Key', ['LLM_API_KEY']) },
    models: [model],
    api: openAICompletionsApi(),
  });

  const models = createModels();
  models.setProvider(provider);
  return { setup: { models, model }, error: null };
}
