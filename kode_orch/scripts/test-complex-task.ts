/**
 * 复杂任务测试 - 模拟真实的贪吃蛇任务
 * 运行: npx tsx scripts/test-complex-task.ts
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  globalToolRegistry,
  E2BSandbox,
  AnthropicProvider,
} from '@shareai-lab/kode-sdk';
import { readFile } from 'fs/promises';
import { initStore } from '../src/memory/store.js';
import { loadConfig } from '../src/config.js';
import { registerAllTemplates } from '../src/agents/templates.js';
import { registerSandboxPreviewTool } from '../src/tools/sandbox-preview.js';

async function main() {
  console.log('=== 复杂任务测试 ===\n');

  const config = loadConfig();
  const { sdkStore } = await initStore(config.postgres, config.fileStoreDir);

  const templateRegistry = new AgentTemplateRegistry();
  registerAllTemplates(templateRegistry);
  registerSandboxPreviewTool();

  const provider = new AnthropicProvider(
    config.anthropic!.apiKey,
    config.anthropic!.modelId,
    config.anthropic!.baseUrl
  );

  const sandbox = new E2BSandbox({
    apiKey: config.sandbox.e2b!.apiKey,
    template: config.sandbox.e2b!.template || 'base',
    timeoutMs: 300_000,
  });
  await sandbox.init();
  console.log('✓ 环境准备完成\n');

  const deps = {
    store: sdkStore,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory: new SandboxFactory(),
  };

  const agent = await Agent.create({
    templateId: 'executor-agent',
    agentId: 'test-complex-001',
    model: provider,
    sandbox,
  }, deps);

  // 监控
  let toolCalls = 0;
  let steps = 0;
  let tokens = 0;
  const toolNames: string[] = [];

  agent.on('tool_executed', (evt: any) => {
    toolCalls++;
    toolNames.push(evt.call?.name ?? 'unknown');
    console.log(`  [tool] ${evt.call?.name}`);
  });

  agent.on('step_complete', () => {
    steps++;
  });

  agent.on('token_usage', (evt: any) => {
    tokens += evt.totalTokens ?? 0;
  });

  agent.on('permission_required', (evt: any) => {
    console.log(`  [permission] ${evt.call?.name} - AUTO ALLOWING`);
    evt.respond('allow', { note: 'test auto-approve' });
  });

  // 构造类似真实的复杂 prompt
  const skillContent = await readFile('./skills/coding/anthropics-skills-web-artifacts-builder/SKILL.md', 'utf-8');
  const skillDir = '/home/gxw/kode_ai_lab/kode_project/kode_orch/skills/coding/anthropics-skills-web-artifacts-builder';

  const prompt = `# 任务上下文
- taskId: test-complex-001
- 如需调用 sandbox_preview 工具，请使用上述 taskId 作为 agentId 参数

# Task: 创建简单贪吃蛇游戏

请创建一个最简单的贪吃蛇游戏：
- 使用纯 HTML + JavaScript（单文件 index.html）
- 不要使用任何框架或构建工具
- 基本功能：方向键控制蛇移动，吃到食物变长
- 写完后启动 HTTP 服务并获取预览 URL

重要：请直接开始写代码，不要过度规划。

# Skill 指南: anthropics-skills-web-artifacts-builder
${skillContent}

## Skill 资源目录
该 Skill 的配套脚本和资源文件位于: ${skillDir}
你可以用 fs_read 读取其中的文件，或用 bash_run 执行其中的脚本。`;

  console.log(`Prompt 长度: ${prompt.length} 字符`);
  console.log('\n执行任务中...\n');

  const startTime = Date.now();

  // 设置超时
  const timeoutId = setTimeout(() => {
    console.log('\n⏰ 60秒检查点:');
    console.log(`  工具调用: ${toolCalls}`);
    console.log(`  Token: ${tokens}`);
    console.log(`  调用的工具: ${toolNames.join(', ') || '无'}`);
  }, 60000);

  try {
    const result = await agent.complete(prompt);
    clearTimeout(timeoutId);

    const elapsed = Date.now() - startTime;

    console.log('\n=== 执行结果 ===');
    console.log(`状态: ${result.status}`);
    console.log(`耗时: ${Math.round(elapsed / 1000)}秒`);
    console.log(`工具调用: ${toolCalls}`);
    console.log(`Token: ${tokens}`);
    console.log(`调用的工具: ${toolNames.join(', ') || '无'}`);
    console.log('\n回复内容（前500字）:');
    console.log(result.text?.slice(0, 500) ?? '(无)');
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('\n❌ 执行失败:', err);
  }

  await sandbox.dispose();
  console.log('\n✓ 清理完成');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
