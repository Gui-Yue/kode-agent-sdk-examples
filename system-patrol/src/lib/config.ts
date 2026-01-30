import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config as loadEnv } from 'dotenv';

export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'custom';

export interface Config {
  provider: ProviderKind;
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

const PARENT_DIR = 'shareai-sdk-demos';
// TODO: Copy this file into each demo and customize DEMO_NAME.
const DEMO_NAME = 'system-patrol';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readConfigFile(filePath: string): Partial<Config> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

function configFromEnv(): Partial<Config> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      modelId: process.env.ANTHROPIC_MODEL_ID,
    };
  }

  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      modelId: process.env.OPENAI_MODEL_ID,
    };
  }

  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      modelId: process.env.GEMINI_MODEL_ID,
    };
  }

  return {};
}

export function getGlobalConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), PARENT_DIR, DEMO_NAME);
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, PARENT_DIR, DEMO_NAME);
}

export function getLocalConfigDir(): string {
  return path.join(process.cwd(), `.sdk-demo-${DEMO_NAME}`);
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), 'config.json');
}

export function getLocalConfigPath(): string {
  return path.join(getLocalConfigDir(), 'config.json');
}

export function getLocalDataDir(): string {
  return path.join(getLocalConfigDir(), 'data');
}

export function getLocalWorkspaceDir(): string {
  return path.join(getLocalConfigDir(), 'workspace');
}

export function ensureLocalDirs(): void {
  ensureDir(getLocalConfigDir());
  ensureDir(getLocalDataDir());
  ensureDir(getLocalWorkspaceDir());
}

export function saveConfig(config: Config): void {
  ensureDir(getGlobalConfigDir());
  fs.writeFileSync(getGlobalConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function checkFirstRun(): boolean {
  loadEnv({ override: false });
  const envConfig = configFromEnv();
  if (envConfig.provider && envConfig.apiKey) return false;

  return !fs.existsSync(getGlobalConfigPath()) && !fs.existsSync(getLocalConfigPath());
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadEnv({ override: false });

  const globalConfig = readConfigFile(getGlobalConfigPath());
  const localConfig = readConfigFile(getLocalConfigPath());
  const envConfig = configFromEnv();

  const merged = {
    ...globalConfig,
    ...localConfig,
    ...envConfig,
    ...overrides,
  } as Partial<Config>;

  if (!merged.provider || !merged.apiKey) {
    throw new Error(`未找到可用配置，请先运行 "${DEMO_NAME} config" 或设置环境变量`);
  }

  return merged as Config;
}
