import { LocalSandbox, E2BSandbox, type Sandbox } from '@shareai-lab/kode-sdk';
import type { AppConfig } from '../config.js';
import { logger } from '../utils/logger.js';

export class AppSandboxFactory {
  constructor(private config: AppConfig['sandbox']) {}

  async create(): Promise<Sandbox> {
    if (this.config.kind === 'e2b' && this.config.e2b?.apiKey) {
      return this.createE2B();
    }
    return this.createLocal();
  }

  private createLocal(): Sandbox {
    logger.info('sandbox', `Creating LocalSandbox at ${this.config.workDir}`);
    return new LocalSandbox({
      workDir: this.config.workDir,
      enforceBoundary: true,
    });
  }

  private async createE2B(): Promise<Sandbox> {
    const e2bConfig = this.config.e2b!;
    logger.info('sandbox', `Creating E2BSandbox (template: ${e2bConfig.template || 'base'})`);
    try {
      const sandbox = new E2BSandbox({
        apiKey: e2bConfig.apiKey,
        template: e2bConfig.template || 'base',
        timeoutMs: e2bConfig.timeoutMs || 5 * 60 * 1000,
      });
      await sandbox.init();
      logger.info('sandbox', `E2BSandbox created successfully`);
      return sandbox;
    } catch (err) {
      logger.error('sandbox', `E2BSandbox creation failed`, err);
      throw err;
    }
  }

  async dispose(sandbox: Sandbox): Promise<void> {
    if ('dispose' in sandbox && typeof sandbox.dispose === 'function') {
      await sandbox.dispose();
    }
  }
}
