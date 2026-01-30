/**
 * Memory Agent - 主程序
 *
 * 展示持久化 (SqliteStore) + resume + 自定义记忆工具
 * 演示跨会话记忆保持和崩溃恢复能力
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  LocalSandbox,
  SqliteStore,
  globalToolRegistry,
  type AgentDependencies,
} from '@shareai-lab/kode-sdk';

import { memoryTemplate } from '../template.js';
import { memoryTools, resetMemoryCache } from '../tools.js';
import { createProvider } from '../lib/provider.js';
import { ensureLocalDirs, getLocalDataDir, getLocalWorkspaceDir, type Config } from '../lib/config.js';

// ============== 配置 ==============

const WORKSPACE_DIR = getLocalWorkspaceDir();
const DATA_DIR = getLocalDataDir();
const DB_PATH = path.join(DATA_DIR, 'memory-agent.db');
const FILE_STORE_DIR = path.join(DATA_DIR, 'files');
const AGENT_ID = 'memory-agent-001';

// ============== 主程序 ==============

export interface RunOptions {
  resume?: boolean;
  reset?: boolean;
}

export async function runMain(config: Config, options: RunOptions = {}): Promise<void> {
  console.log('🧠 Memory Agent - 持久记忆助手\n');
  console.log('展示 SqliteStore 持久化 + resume 恢复 + 自定义记忆工具\n');

  const shouldResume = options.resume === true;
  const shouldReset = options.reset === true;

  ensureLocalDirs();

  if (shouldReset) {
    console.log('🔄 重置模式: 清除所有数据...');
    try {
      if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
      if (fs.existsSync(`${DB_PATH}-wal`)) fs.unlinkSync(`${DB_PATH}-wal`);
      if (fs.existsSync(`${DB_PATH}-shm`)) fs.unlinkSync(`${DB_PATH}-shm`);
      fs.rmSync(FILE_STORE_DIR, { recursive: true, force: true });
      fs.rmSync(path.join(WORKSPACE_DIR, '.memory'), { recursive: true, force: true });
      console.log('✅ 数据已清除\n');
    } catch (err) {
      // 忽略不存在的文件
    }
    resetMemoryCache();
  }

  // 1. 创建 Provider
  const provider = createProvider(config);
  console.log(`✅ 使用模型: ${provider.model}`);

  // 2. 创建 SqliteStore（持久化存储）
  // 确保目录存在
  const dbDir = path.dirname(DB_PATH);
  if (dbDir && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  if (!fs.existsSync(FILE_STORE_DIR)) {
    fs.mkdirSync(FILE_STORE_DIR, { recursive: true });
  }

  const store = new SqliteStore(DB_PATH, FILE_STORE_DIR);
  console.log(`✅ SqliteStore: ${DB_PATH}`);

  // 3. 注册模板
  const templateRegistry = new AgentTemplateRegistry();
  templateRegistry.register(memoryTemplate);
  console.log('✅ 已注册记忆 Agent 模板');

  // 4. 注册记忆工具
  memoryTools.forEach((tool) => {
    globalToolRegistry.register(tool.name, () => tool);
  });
  console.log(`✅ 已注册记忆工具: ${memoryTools.map((t) => t.name).join(', ')}`);

  // 5. 创建 SandboxFactory
  const sandboxFactory = new SandboxFactory();
  sandboxFactory.register('local', (config) => new LocalSandbox({ workDir: config.workDir || WORKSPACE_DIR }));

  // 6. 创建 AgentDependencies
  const deps: AgentDependencies = {
    store,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory,
  };

  // 7. 创建或恢复 Agent
  let memoryAgent: Agent;
  const agentExists = await store.exists(AGENT_ID);
  const agentMetadata = { maxTokens: 16384 }; // 增大 maxTokens 以支持生成较大的响应

  if (shouldResume && agentExists) {
    console.log('\n🔄 恢复模式: 从上次中断处继续...');
    try {
      memoryAgent = await Agent.resume(
        AGENT_ID,
        {
          templateId: 'memory-agent',
          model: provider,
          sandbox: { kind: 'local', workDir: WORKSPACE_DIR },
          metadata: agentMetadata,
        },
        deps,
        { autoRun: false, strategy: 'crash' }
      );
      console.log('✅ Agent 已恢复，所有记忆和对话历史保持完整\n');
    } catch (err) {
      console.log(`⚠️ 恢复失败，创建新 Agent: ${err}`);
      memoryAgent = await Agent.create(
        {
          agentId: AGENT_ID,
          templateId: 'memory-agent',
          model: provider,
          sandbox: { kind: 'local', workDir: WORKSPACE_DIR },
          metadata: agentMetadata,
        },
        deps
      );
    }
  } else if (agentExists && !shouldReset) {
    console.log('\n📂 发现已存在的 Agent 数据');
    console.log('  - 使用 --resume 恢复上次会话');
    console.log('  - 使用 --reset 清除数据重新开始\n');

    // 默认恢复
    try {
      memoryAgent = await Agent.resume(
        AGENT_ID,
        {
          templateId: 'memory-agent',
          model: provider,
          sandbox: { kind: 'local', workDir: WORKSPACE_DIR },
          metadata: agentMetadata,
        },
        deps,
        { autoRun: false, strategy: 'crash' }
      );
      console.log('✅ Agent 已自动恢复\n');
    } catch (err) {
      console.log(`⚠️ 恢复失败，创建新 Agent`);
      memoryAgent = await Agent.create(
        {
          agentId: AGENT_ID,
          templateId: 'memory-agent',
          model: provider,
          sandbox: { kind: 'local', workDir: WORKSPACE_DIR },
          metadata: agentMetadata,
        },
        deps
      );
    }
  } else {
    memoryAgent = await Agent.create(
      {
        agentId: AGENT_ID,
        templateId: 'memory-agent',
        model: provider,
        sandbox: { kind: 'local', workDir: WORKSPACE_DIR },
        metadata: agentMetadata,
      },
      deps
    );
    console.log('✅ Memory Agent 已创建（新会话）\n');
  }

  // 8. 监听 Monitor Channel 中的记忆事件
  memoryAgent.on('tool_custom_event', (event: any) => {
    if (event.eventType === 'memory_saved') {
      console.log(`\n💾 [记忆已保存] ID: ${event.data?.id}, 类型: ${event.data?.type}`);
    }
  });

  // 等待 Agent 完成的状态
  let waitingForAgent = false;
  let pendingPrompt: (() => void) | null = null;

  // 9. 订阅 Progress Channel 打印输出
  (async () => {
    for await (const envelope of memoryAgent.subscribe(['progress'])) {
      const event = envelope.event;

      if (event.type === 'text_chunk') {
        process.stdout.write(event.delta);
      } else if (event.type === 'text_chunk_end') {
        console.log();
      } else if (event.type === 'tool:start') {
        console.log(`\n🔧 调用工具: ${event.call.name}`);
      } else if (event.type === 'tool:end') {
        console.log(`✅ 工具完成: ${event.call.name}`);
      } else if (event.type === 'done') {
        console.log('\n📝 回合结束\n');
        // Agent 完成后再显示 prompt
        if (waitingForAgent && pendingPrompt) {
          waitingForAgent = false;
          const callback = pendingPrompt;
          pendingPrompt = null;
          setTimeout(callback, 100);
        }
      }
    }
  })().catch(console.error);

  // 10. 命令行交互
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('📋 使用说明:');
  console.log('  - 与 Agent 对话，它会记住你提到的重要信息');
  console.log('  - 输入 "memories" 查看所有已保存的记忆');
  console.log('  - 输入 "interrupt" 模拟中断（Ctrl+C 也可以）');
  console.log('  - 重启程序时使用 --resume 恢复会话');
  console.log('  - 输入 "exit" 退出\n');

  // 如果是新会话，发送欢迎消息
  if (!shouldResume || !agentExists) {
    console.log('🎯 提示: 试着告诉 Agent 你的技术栈偏好、项目信息等，然后中断程序再恢复，看看它是否记得！\n');
  }

  const prompt = (): void => {
    rl.question('💬 你: ', async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === 'exit') {
        console.log('💾 保存状态...');
        await store.close();
        console.log('👋 再见! 使用 --resume 可以恢复会话');
        rl.close();
        process.exit(0);
      }

      if (!trimmed) {
        prompt();
        return;
      }

      // 特殊命令
      if (trimmed.toLowerCase() === 'memories') {
        try {
          await memoryAgent.send('请列出所有已保存的记忆');
        } catch (err) {
          console.error('❌ 错误:', err);
        }
        waitingForAgent = true;
        pendingPrompt = prompt;
        return;
      }

      if (trimmed.toLowerCase() === 'interrupt') {
        console.log('\n⚡ 模拟中断...');
        console.log('💾 状态已自动保存到 SqliteStore');
        console.log('🔄 重新运行程序并使用 --resume 参数来恢复\n');
        await store.close();
        process.exit(0);
      }

      // 发送消息给 Agent
      try {
        await memoryAgent.send(trimmed);
      } catch (err) {
        console.error('❌ 错误:', err);
      }

      waitingForAgent = true;
      pendingPrompt = prompt;
    });
  };

  // 处理 Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\n⚡ 收到中断信号...');
    console.log('💾 状态已自动保存');
    console.log('🔄 使用 --resume 参数重启以恢复会话\n');
    await store.close();
    process.exit(0);
  });

  prompt();
}

// CLI 入口负责调用 runMain
