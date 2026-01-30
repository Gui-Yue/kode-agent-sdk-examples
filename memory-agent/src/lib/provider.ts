import {
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type ModelProvider,
} from '@shareai-lab/kode-sdk';

import type { Config } from './config.js';

const providerDefaults: Record<Config['provider'], { baseUrl?: string; modelId: string }> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    modelId: 'claude-sonnet-4-20250514',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
  },
  gemini: {
    modelId: 'gemini-2.0-flash',
  },
  custom: {
    modelId: 'gpt-4o',
  },
};

export function createProvider(config: Config): ModelProvider {
  if (!config.apiKey) {
    throw new Error('API Key 不能为空');
  }

  const defaults = providerDefaults[config.provider];
  const modelId = config.modelId || defaults.modelId;
  const baseUrl = config.baseUrl || defaults.baseUrl;

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, modelId, baseUrl);
    case 'openai':
      return new OpenAIProvider(config.apiKey, modelId, baseUrl);
    case 'gemini':
      return new GeminiProvider(config.apiKey, modelId);
    case 'custom':
      if (!baseUrl) {
        throw new Error('自定义提供商必须设置 Base URL');
      }
      return new OpenAIProvider(config.apiKey, modelId, baseUrl);
    default:
      throw new Error(`不支持的 provider: ${config.provider}`);
  }
}
