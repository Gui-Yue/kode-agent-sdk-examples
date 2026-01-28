/**
 * 子 Agent 诊断脚本
 * 测试 executor-agent 能否正常执行工具
 * 运行: npx tsx scripts/test-subagent.ts
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
import { initStore } from '../src/memory/store.js';
import { loadConfig } from '../src/config.js';
import { registerAllTemplates } from '../src/agents/templates.js';
import { registerSandboxPreviewTool } from '../src/tools/sandbox-preview.js';

async function main() {
  console.log('=== 子 Agent 诊断 ===\n');

  // 1. Load config
  const config = loadConfig();
  console.log('1. 配置加载完成');
  console.log(`   Provider: ${config.primaryProvider}`);
  console.log(`   Model: ${config.anthropic?.modelId}`);

  // 2. Create store
  const { sdkStore } = await initStore(config.postgres, config.fileStoreDir);
  console.log('2. Store 初始化完成');

  // 3. Register templates
  const templateRegistry = new AgentTemplateRegistry();
  registerAllTemplates(templateRegistry);
  registerSandboxPreviewTool();
  console.log('3. 模板注册完成');

  // List registered templates
  const templates = ['executor-agent', 'research-agent', 'analyst-agent', 'reviewer-agent', 'tester-agent'];
  for (const tid of templates) {
    const tpl = templateRegistry.get(tid);
    console.log(`   - ${tid}: ${tpl ? '✓' : '✗'} ${tpl?.tools?.length ?? 0} tools`);
  }

  // 4. Create provider
  const provider = new AnthropicProvider(
    config.anthropic!.apiKey,
    config.anthropic!.modelId,
    config.anthropic!.baseUrl
  );
  console.log('4. Provider 创建完成');

  // 5. Create sandbox
  console.log('5. 创建 E2B 沙箱...');
  const sandbox = new E2BSandbox({
    apiKey: config.sandbox.e2b!.apiKey,
    template: config.sandbox.e2b!.template || 'base',
    timeoutMs: 60_000,
  });
  await sandbox.init();
  console.log('   ✓ 沙箱创建成功');

  // 6. Create agent
  console.log('6. 创建 executor-agent...');
  const deps = {
    store: sdkStore,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory: new SandboxFactory(),
  };

  const agent = await Agent.create({
    templateId: 'executor-agent',
    agentId: 'test-agent-001',
    model: provider,
    sandbox,
  }, deps);
  console.log('   ✓ Agent 创建成功');

  // 7. Set up monitors
  let toolCalls = 0;
  let steps = 0;
  let tokens = 0;

  agent.on('tool_executed', (evt: any) => {
    toolCalls++;
    console.log(`   [tool_executed] ${evt.call?.name ?? 'unknown'}`);
  });

  agent.on('step_complete', () => {
    steps++;
    console.log(`   [step_complete] step ${steps}`);
  });

  agent.on('token_usage', (evt: any) => {
    tokens += evt.totalTokens ?? 0;
    console.log(`   [token_usage] +${evt.totalTokens ?? 0} (total: ${tokens})`);
  });

  agent.on('permission_required', (evt: any) => {
    console.log(`   [permission_required] ${evt.call?.name} - AUTO ALLOWING`);
    evt.respond('allow', { note: 'test auto-approve' });
  });

  // 8. Run simple task
  console.log('\n7. 执行简单任务: "写一个 hello.txt 文件"...');
  const startTime = Date.now();

  try {
    const result = await agent.complete('请在当前目录创建一个 hello.txt 文件，内容是 "Hello from E2B!"，然后用 bash 命令 cat 读取并显示内容。');
    const elapsed = Date.now() - startTime;

    console.log('\n=== 执行结果 ===');
    console.log(`状态: ${result.status}`);
    console.log(`耗时: ${elapsed}ms`);
    console.log(`工具调用: ${toolCalls}`);
    console.log(`步数: ${steps}`);
    console.log(`Token: ${tokens}`);
    console.log('\n回复内容:');
    console.log(result.text?.slice(0, 500) ?? '(无)');
  } catch (err) {
    console.error('\n❌ 执行失败:', err);
  }

  // 9. Cleanup
  console.log('\n8. 清理沙箱...');
  await sandbox.dispose();
  console.log('   ✓ 完成');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
