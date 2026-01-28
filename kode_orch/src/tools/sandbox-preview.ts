import { tool } from '@shareai-lab/kode-sdk';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Register sandbox_preview tool.
 * Sub-agents call this to get a public URL for a service running in their sandbox.
 * The tool resolves getHostUrl on the E2B sandbox instance.
 *
 * Because each sub-agent gets its own sandbox (passed via BgTaskRunner),
 * we need a way to associate the sandbox with the running agent.
 * We use a shared Map keyed by agentId (= taskId).
 */

import type { Sandbox } from '@shareai-lab/kode-sdk';

// Shared registry: agentId -> sandbox instance (set by BgTaskRunner before agent.complete())
const sandboxRegistry = new Map<string, Sandbox>();

export function setSandboxForAgent(agentId: string, sandbox: Sandbox): void {
  sandboxRegistry.set(agentId, sandbox);
}

export function removeSandboxForAgent(agentId: string): void {
  sandboxRegistry.delete(agentId);
}

export function registerSandboxPreviewTool(): void {
  tool({
    name: 'sandbox_preview',
    description: `获取沙箱中运行的服务的公开预览 URL。

使用场景：
- 当你在沙箱中启动了一个 HTTP 服务（如 python -m http.server 8080）
- 或创建了需要用户在浏览器中查看的内容
- 调用此工具获取公开 URL，然后在回复中用 [sandbox-preview](url) 格式返回

注意：
- 只有 E2B 沙箱支持此功能
- 你必须先启动服务，再调用此工具
- 获取 URL 后，务必在最终回复中包含 [sandbox-preview](url) 标记，这样系统才能保留沙箱供用户访问`,
    parameters: z.object({
      port: z.number().describe('沙箱中运行的服务端口号'),
      agentId: z.string().describe('当前 Agent 的 ID（即 taskId）'),
    }),
    async execute(args) {
      const { port, agentId } = args;
      const sandbox = sandboxRegistry.get(agentId);
      if (!sandbox) {
        return { ok: false, error: '未找到关联的沙箱实例' };
      }

      // E2BSandbox has getHostUrl, LocalSandbox does not
      const e2bSandbox = sandbox as any;
      if (typeof e2bSandbox.getHostUrl !== 'function') {
        if (sandbox.kind === 'local') {
          return {
            ok: true,
            url: `http://localhost:${port}`,
            note: '本地沙箱，URL 仅在本机可用',
          };
        }
        return { ok: false, error: '当前沙箱类型不支持预览 URL' };
      }

      try {
        const url = e2bSandbox.getHostUrl(port);
        logger.info('sandbox-preview', `Generated preview URL`, { agentId, port, url });
        return {
          ok: true,
          url,
          instruction: '请在回复的最后包含 [sandbox-preview](url) 标记，系统会自动保留沙箱供用户访问。',
        };
      } catch (err) {
        return { ok: false, error: `获取预览 URL 失败: ${err}` };
      }
    },
    metadata: { readonly: true, version: '1.0' },
  });
}
