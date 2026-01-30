import prompts from 'prompts';

import type { Config, ProviderKind } from './config.js';

interface PromptValues {
  provider?: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}

const providerDefaults: Record<ProviderKind, { baseUrl?: string; modelId?: string }> = {
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

export async function interactiveConfig(): Promise<Config> {
  const response = (await prompts(
    [
      {
        type: 'select',
        name: 'provider',
        message: '选择 AI 提供商',
        choices: [
          { title: 'Anthropic (推荐)', value: 'anthropic' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Google Gemini', value: 'gemini' },
          { title: '自定义 OpenAI 兼容', value: 'custom' },
        ],
      },
      {
        type: 'password',
        name: 'apiKey',
        message: '输入 API Key',
        validate: (value: string) => (value ? true : 'API Key 不能为空'),
      },
      {
        type: (_prev: string, values: PromptValues) =>
          (values && values.provider === 'gemini' ? null : 'text'),
        name: 'baseUrl',
        message: '输入 Base URL (可选，直接回车使用默认)',
        initial: (_prev: string, values: PromptValues) =>
          (values && providerDefaults[values.provider as ProviderKind]?.baseUrl) || '',
        validate: (value: string, values?: PromptValues) => {
          if (values && values.provider === 'custom' && !value) {
            return '自定义提供商必须填写 Base URL';
          }
          return true;
        },
      },
      {
        type: 'text',
        name: 'modelId',
        message: '输入模型 ID (可选，直接回车使用默认)',
        initial: (_prev: string, values: PromptValues) =>
          (values && providerDefaults[values.provider as ProviderKind]?.modelId) || '',
      },
    ],
    {
      onCancel: () => {
        throw new Error('已取消配置');
      },
    }
  )) as PromptValues;

  const provider = response.provider as ProviderKind;
  const defaults = providerDefaults[provider] || {};

  return {
    provider,
    apiKey: response.apiKey || '',
    baseUrl: response.baseUrl || defaults.baseUrl,
    modelId: response.modelId || defaults.modelId,
  };
}
