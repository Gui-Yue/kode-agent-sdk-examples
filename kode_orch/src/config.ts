import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

export interface PgConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  max?: number;
}

export interface AppConfig {
  port: number;
  authToken: string;

  anthropic?: { apiKey: string; baseUrl?: string; modelId: string };
  openai?: { apiKey: string; baseUrl?: string; modelId: string };
  gemini?: { apiKey: string; baseUrl?: string; modelId: string };

  primaryProvider: 'anthropic' | 'openai' | 'gemini';

  // PostgreSQL（SDK + 业务表 + 向量表共用）
  postgres: PgConfig;
  fileStoreDir: string;

  // 向量检索集合名（可选，不配置则跳过向量检索）
  vectorCollection?: string;

  sandbox: {
    kind: 'local' | 'e2b';
    workDir: string;
    e2b?: {
      apiKey: string;
      template?: string;
      timeoutMs?: number;
    };
  };

  progress: {
    intervalMs: number;
    enabled: boolean;
  };

  bgTasks: {
    maxConcurrent: number;
    defaultIdleTimeoutMs: number;
    defaultMaxToolCalls: number;
    defaultMaxSteps: number;
  };
}

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env: ${key}`);
}

function envOpt(key: string): string | undefined {
  const val = process.env[key];
  return val !== undefined && val !== '' ? val : undefined;
}

export function loadConfig(): AppConfig {
  const primary = env('PRIMARY_PROVIDER', 'anthropic') as AppConfig['primaryProvider'];

  const config: AppConfig = {
    port: parseInt(env('PORT', '3000'), 10),
    authToken: env('AUTH_TOKEN'),
    primaryProvider: primary,

    postgres: {
      host: env('PG_HOST', 'localhost'),
      port: parseInt(env('PG_PORT', '5433'), 10),
      database: env('PG_DATABASE', 'kode'),
      user: env('PG_USER', 'postgres'),
      password: env('PG_PASSWORD', 'postgres'),
    },
    fileStoreDir: env('FILE_STORE_DIR', './data/files'),

    vectorCollection: envOpt('VECTOR_COLLECTION'),

    sandbox: {
      kind: (env('SANDBOX_KIND', 'local') as 'local' | 'e2b'),
      workDir: env('SANDBOX_WORK_DIR', './workspace'),
    },

    progress: {
      enabled: env('PROGRESS_ENABLED', 'true') === 'true',
      intervalMs: parseInt(env('PROGRESS_INTERVAL_MS', '15000'), 10),
    },

    bgTasks: {
      maxConcurrent: parseInt(env('BG_MAX_CONCURRENT', '5'), 10),
      defaultIdleTimeoutMs: parseInt(env('BG_IDLE_TIMEOUT_MS', '120000'), 10),
      defaultMaxToolCalls: parseInt(env('BG_MAX_TOOL_CALLS', '200'), 10),
      defaultMaxSteps: parseInt(env('BG_MAX_STEPS', '50'), 10),
    },
  };

  // Providers
  const anthropicKey = envOpt('ANTHROPIC_API_KEY');
  if (anthropicKey) {
    config.anthropic = {
      apiKey: anthropicKey,
      baseUrl: envOpt('ANTHROPIC_BASE_URL'),
      modelId: env('ANTHROPIC_MODEL_ID', 'claude-sonnet-4-20250514'),
    };
  }

  const openaiKey = envOpt('OPENAI_API_KEY');
  if (openaiKey) {
    config.openai = {
      apiKey: openaiKey,
      baseUrl: envOpt('OPENAI_BASE_URL'),
      modelId: env('OPENAI_MODEL_ID', 'gpt-4o'),
    };
  }

  const geminiKey = envOpt('GEMINI_API_KEY');
  if (geminiKey) {
    config.gemini = {
      apiKey: geminiKey,
      baseUrl: envOpt('GEMINI_BASE_URL'),
      modelId: env('GEMINI_MODEL_ID', 'gemini-2.0-flash'),
    };
  }

  // E2B sandbox
  const e2bKey = envOpt('E2B_API_KEY');
  if (e2bKey) {
    config.sandbox.e2b = {
      apiKey: e2bKey,
      template: envOpt('E2B_TEMPLATE') || 'base',
      timeoutMs: parseInt(env('E2B_TIMEOUT_MS', '300000'), 10),
    };
    if (config.sandbox.kind === 'local') {
      config.sandbox.kind = 'e2b';
    }
  }

  // Validate primary provider exists
  if (!config[primary]) {
    throw new Error(`Primary provider "${primary}" is configured but no API key provided`);
  }

  return config;
}
