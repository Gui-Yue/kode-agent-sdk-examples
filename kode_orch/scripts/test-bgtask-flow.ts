/**
 * 完全模拟 BgTaskRunner 流程的测试
 * 运行: npx tsx scripts/test-bgtask-flow.ts
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  globalToolRegistry,
  type AgentConfig,
  type CompleteResult,
} from '@shareai-lab/kode-sdk';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { initStore } from '../src/memory/store.js';
import { loadConfig } from '../src/config.js';
import { registerAllTemplates } from '../src/agents/templates.js';
import { registerSandboxPreviewTool } from '../src/tools/sandbox-preview.js';
import { AppSandboxFactory } from '../src/sandbox/factory.js';

async function main() {
  console.log('=== 模拟 BgTaskRunner 流程测试 ===\n');

  // 1. 加载配置（和真实应用一样）
  const config = loadConfig();
  console.log(`沙箱类型: ${config.sandbox.kind}`);
  console.log(`E2B API Key: ${config.sandbox.e2b?.apiKey ? '已配置' : '未配置'}`);

  // 2. 初始化 Store
  const { sdkStore } = await initStore(config.postgres, config.fileStoreDir);

  // 3. 注册模板（和真实应用一样）
  const templateRegistry = new AgentTemplateRegistry();
  registerAllTemplates(templateRegistry);
  registerSandboxPreviewTool();

  // 4. 创建 AppSandboxFactory（和真实应用一样）
  const sandboxFactory = new AppSandboxFactory(config.sandbox);

  // 5. 创建 deps（和 BgTaskRunner 一样）
  const deps = {
    store: sdkStore,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory: new SandboxFactory(),
  };

  // 6. 模拟 Orchestrator 发送的任务
  const taskId = 'test-bgtask-001';
  const templateId = 'executor-agent';
  const description = '创建简单贪吃蛇游戏';

  // 加载 Skill
  const skillContent = await readFile('./skills/coding/anthropics-skills-web-artifacts-builder/SKILL.md', 'utf-8');
  const skillDir = resolve('./skills/coding/anthropics-skills-web-artifacts-builder');

  // 构造 prompt（和 bg-task-run.ts 一样）
  const userPrompt = `请创建一个简单的贪吃蛇游戏：
- 使用纯 HTML + JavaScript（单文件 index.html）
- 基本功能：方向键控制，吃食物变长
- 写完后启动 HTTP 服务获取预览 URL`;

  const fullPrompt = [
    `# Task: ${description}`,
    userPrompt,
    `# Skill 指南: anthropics-skills-web-artifacts-builder\n${skillContent}\n\n## Skill 资源目录\n该 Skill 的配套脚本和资源文件位于: ${skillDir}`,
  ].join('\n\n');

  // 添加任务上下文（和 BgTaskRunner.runInBackground 一样）
  const promptWithContext = `# 任务上下文
- taskId: ${taskId}
- 如需调用 sandbox_preview 工具，请使用上述 taskId 作为 agentId 参数

${fullPrompt}`;

  console.log(`\nPrompt 总长度: ${promptWithContext.length} 字符`);
  console.log(`Prompt 前 300 字符:\n${promptWithContext.slice(0, 300)}...\n`);

  // 7. 创建沙箱（和 BgTaskRunner 一样）
  console.log('创建沙箱...');
  const sandbox = await sandboxFactory.create();
  console.log(`沙箱类型: ${sandbox.kind}`);

  // 8. 创建 Agent（和 BgTaskRunner 一样）
  console.log('创建 Agent...');
  const agentConfig: AgentConfig = {
    templateId,
    agentId: taskId,
    model: undefined as any, // 需要 provider
    sandbox,
  };

  // 需要创建 provider
  const { AnthropicProvider } = await import('@shareai-lab/kode-sdk');
  const provider = new AnthropicProvider(
    config.anthropic!.apiKey,
    config.anthropic!.modelId,
    config.anthropic!.baseUrl
  );
  agentConfig.model = provider;

  const agent = await Agent.create(agentConfig, deps);

  // 9. 注册监听器（和 BgTaskRunner 一样）
  let toolCalls = 0;
  let steps = 0;
  let tokens = 0;

  agent.on('permission_required', (event: any) => {
    console.log(`[permission_required] ${event.call?.name}`);
    // 模拟 E2B 自动审批
    if (config.sandbox.kind === 'e2b') {
      console.log('  -> E2B sandbox: auto-approved');
      event.respond('allow', { note: 'auto-approved: e2b sandbox' });
    } else {
      console.log('  -> Local sandbox: auto-approved for test');
      event.respond('allow', { note: 'test auto-approve' });
    }
  });

  agent.on('tool_executed', (evt: any) => {
    toolCalls++;
    console.log(`[tool_executed] ${evt.call?.name} (count: ${toolCalls})`);
  });

  agent.on('step_complete', () => {
    steps++;
    console.log(`[step_complete] step ${steps}`);
  });

  agent.on('token_usage', (evt: any) => {
    tokens += evt.totalTokens ?? 0;
    console.log(`[token_usage] +${evt.totalTokens ?? 0} (total: ${tokens})`);
  });

  // 10. 执行（和 BgTaskRunner 一样的 pause-loop）
  console.log('\n开始执行 complete()...\n');
  const startTime = Date.now();

  let result: CompleteResult;
  let currentInput: string = promptWithContext;

  // 设置 30 秒检查点
  const checkInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n[${elapsed}s 检查点] toolCalls=${toolCalls}, steps=${steps}, tokens=${tokens}`);
  }, 30000);

  // 设置 120 秒超时
  const timeout = setTimeout(() => {
    console.log('\n⏰ 120秒超时！');
    agent.interrupt({ note: 'Test timeout' }).catch(() => {});
  }, 120000);

  try {
    while (true) {
      result = await agent.complete(currentInput);
      console.log(`\ncomplete() 返回: status=${result.status}`);
      if (result.status === 'ok') break;
      // status === 'paused'
      break;
    }
  } finally {
    clearInterval(checkInterval);
    clearTimeout(timeout);
  }

  const elapsed = Date.now() - startTime;

  console.log('\n=== 执行结果 ===');
  console.log(`状态: ${result!.status}`);
  console.log(`耗时: ${Math.round(elapsed / 1000)}秒`);
  console.log(`工具调用: ${toolCalls}`);
  console.log(`步数: ${steps}`);
  console.log(`Token: ${tokens}`);
  console.log('\n回复内容（前 500 字）:');
  console.log(result!.text?.slice(0, 500) ?? '(无)');

  // 清理
  await sandbox.dispose();
  console.log('\n✓ 沙箱已清理');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
