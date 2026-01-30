/**
 * System Patrol Agent - 主程序
 *
 * 使用 Scheduler 定时触发系统巡检，展示主动式 Agent 服务
 */

import * as readline from 'readline';
import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  LocalSandbox,
  JSONStore,
  globalToolRegistry,
  type AgentDependencies,
} from '@shareai-lab/kode-sdk';

import { patrolTemplate } from '../template.js';
import { patrolTools } from '../checks.js';
import { createProvider } from '../lib/provider.js';
import { ensureLocalDirs, getLocalDataDir, getLocalWorkspaceDir, type Config } from '../lib/config.js';

// ============== 配置 ==============

interface PatrolConfig {
  /** 是否启用自动巡检 */
  autoPatrolEnabled: boolean;
  /** 自动巡检间隔（分钟） */
  patrolIntervalMinutes: number;
  /** 要检查的 Git 仓库路径列表 */
  gitRepoPaths: string[];
  /** 要扫描的日志文件路径列表 */
  logFilePaths: string[];
  /** 磁盘使用率告警阈值 */
  diskThreshold: number;
  /** CPU 使用率告警阈值 */
  cpuThreshold: number;
  /** 内存使用率告警阈值 */
  memThreshold: number;
}

const defaultConfig: PatrolConfig = {
  autoPatrolEnabled: false, // 默认关闭自动巡检
  patrolIntervalMinutes: 5, // 如果启用，默认 5 分钟一次
  gitRepoPaths: ['.'], // 默认检查当前目录
  logFilePaths: [], // 默认不检查日志
  diskThreshold: 80,
  cpuThreshold: 80,
  memThreshold: 80,
};

const STORE_DIR = getLocalDataDir();
const WORKSPACE_DIR = getLocalWorkspaceDir();

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ============== 主程序 ==============

export async function runMain(providerConfig: Config): Promise<void> {
  console.log('🔍 System Patrol Agent - 系统巡检助手\n');

  ensureLocalDirs();

  // 添加 SIGINT 处理，确保 Ctrl+C 能正常退出
  let autoPatrolTimer: NodeJS.Timeout | null = null; // 前向声明

  process.on('SIGINT', () => {
    console.log('\n\n👋 收到退出信号，正在退出...');
    if (autoPatrolTimer) {
      clearInterval(autoPatrolTimer);
    }
    process.exit(0);
  });

  // 解析配置
  const patrolConfig: PatrolConfig = {
    ...defaultConfig,
    autoPatrolEnabled: process.env.AUTO_PATROL === 'true',
    patrolIntervalMinutes: parseInt(process.env.PATROL_INTERVAL_MINUTES || '5', 10),
    gitRepoPaths: process.env.GIT_REPOS?.split(',').map((s: string) => s.trim()) || defaultConfig.gitRepoPaths,
    logFilePaths: process.env.LOG_FILES?.split(',').map((s: string) => s.trim()) || defaultConfig.logFilePaths,
    diskThreshold: parseInt(process.env.DISK_THRESHOLD || '80', 10),
    cpuThreshold: parseInt(process.env.CPU_THRESHOLD || '80', 10),
    memThreshold: parseInt(process.env.MEM_THRESHOLD || '80', 10),
  };

  console.log('📋 巡检配置:');
  console.log(`  - Git 仓库: ${patrolConfig.gitRepoPaths.join(', ')}`);
  console.log(`  - 日志文件: ${patrolConfig.logFilePaths.length > 0 ? patrolConfig.logFilePaths.join(', ') : '(无)'}`);
  console.log(`  - 磁盘阈值: ${patrolConfig.diskThreshold}%`);
  console.log(`  - 自动巡检: ${patrolConfig.autoPatrolEnabled ? `启用 (每 ${patrolConfig.patrolIntervalMinutes} 分钟)` : '关闭'}\n`);

  // 1. 创建 Provider
  const provider = createProvider(providerConfig);
  console.log(`✅ 使用模型: ${provider.model}`);

  // 2. 创建 Store
  const store = new JSONStore(STORE_DIR);
  console.log(`✅ 数据存储: ${STORE_DIR}`);

  // 3. 注册模板
  const templateRegistry = new AgentTemplateRegistry();
  templateRegistry.register(patrolTemplate);
  console.log('✅ 已注册巡检模板');

  // 4. 注册巡检工具
  patrolTools.forEach((tool) => {
    globalToolRegistry.register(tool.name, () => tool);
  });
  console.log(`✅ 已注册巡检工具: ${patrolTools.map((t) => t.name).join(', ')}`);

  // 5. 创建 SandboxFactory
  const sandboxFactory = new SandboxFactory();
  sandboxFactory.register('local', () => new LocalSandbox({ workDir: WORKSPACE_DIR }));

  // 6. 创建 AgentDependencies
  const deps: AgentDependencies = {
    store,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory,
  };

  // 7. 创建巡检 Agent
  const patrolAgent = await Agent.create(
    {
      agentId: 'patrol-001',
      templateId: 'system-patrol',
      model: provider,
      sandbox: { kind: 'local', workDir: '.' },
      metadata: { maxTokens: 16384 }, // 增大 maxTokens 以支持生成较大的响应
    },
    deps
  );
  console.log('✅ 巡检 Agent 已创建');

  // 8. 设置自动巡检（仅在启用时）
  let patrolCount = 0;

  if (patrolConfig.autoPatrolEnabled) {
    // 使用 setInterval 实现基于时间的定时巡检
    const intervalMs = patrolConfig.patrolIntervalMinutes * 60 * 1000;

    autoPatrolTimer = setInterval(async () => {
      patrolCount++;
      console.log(`\n🔄 [第 ${patrolCount} 次自动巡检触发]\n`);

      // 构建巡检指令
      const nowStr = formatTimestamp(new Date());
      const gitReposStr = patrolConfig.gitRepoPaths.map((p: string) => `"${p}"`).join(', ');
      const logFilesStr =
        patrolConfig.logFilePaths.length > 0
          ? patrolConfig.logFilePaths.map((p: string) => `"${p}"`).join(', ')
          : '无需检查';

      const patrolPrompt = `请执行系统巡检：
当前时间: ${nowStr}
- 检查磁盘使用率（阈值: ${patrolConfig.diskThreshold}%）
- 检查高资源占用进程（CPU阈值: ${patrolConfig.cpuThreshold}%，内存阈值: ${patrolConfig.memThreshold}%）
- 检查 Git 仓库状态: ${gitReposStr}
- 扫描日志文件: ${logFilesStr}

生成巡检报告。`;

      // 发送巡检指令
      patrolAgent.send(patrolPrompt).catch(console.error);
    }, intervalMs);

    console.log(`✅ 自动巡检已启用: 每 ${patrolConfig.patrolIntervalMinutes} 分钟执行一次\n`);
  } else {
    console.log('ℹ️  自动巡检已关闭（设置 AUTO_PATROL=true 可启用）\n');
  }

  // 等待 Agent 完成的状态
  let waitingForAgent = false;
  let pendingPrompt: (() => void) | null = null;

  // 9. 订阅 Agent 事件，打印输出
  (async () => {
    for await (const envelope of patrolAgent.subscribe(['progress', 'monitor'])) {
      const event = envelope.event;

      if (event.type === 'text_chunk') {
        process.stdout.write(event.delta);
      } else if (event.type === 'text_chunk_end') {
        console.log(); // 换行
      } else if (event.type === 'tool:start') {
        console.log(`\n🔧 调用工具: ${event.call.name}`);
      } else if (event.type === 'tool:end') {
        console.log(`✅ 工具完成: ${event.call.name}`);
      } else if (event.type === 'done') {
        console.log('\n📝 巡检回合结束\n');
        console.log('─'.repeat(50));
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
  console.log('  - 输入 "patrol" 立即执行一次巡检');
  console.log('  - 输入问题追问巡检报告中的细节');
  console.log('  - 输入 "exit" 退出\n');

  // 先执行一次初始巡检
  console.log('🚀 执行初始巡检...\n');
  const initialPrompt = `请执行完整的系统巡检，包括磁盘、进程、Git仓库状态。
当前时间: ${formatTimestamp(new Date())}
生成详细的巡检报告。`;
  patrolAgent.send(initialPrompt).catch(console.error);

  const prompt = (): void => {
    rl.question('\n💬 输入命令或问题: ', async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === 'exit') {
        console.log('👋 再见!');
        rl.close();
        process.exit(0);
      }

      if (!trimmed) {
        prompt();
        return;
      }

      try {
        if (trimmed.toLowerCase() === 'patrol') {
          console.log('\n🔄 手动触发巡检...\n');
          await patrolAgent.send(`请执行完整的系统巡检，生成巡检报告。
当前时间: ${formatTimestamp(new Date())}`);
        } else {
          // 追问或其他问题
          await patrolAgent.send(trimmed);
        }
      } catch (err) {
        console.error('❌ 错误:', err);
      }

      waitingForAgent = true;
      pendingPrompt = prompt;
    });
  };

  // 等待初始巡检的 done 事件后再显示提示
  waitingForAgent = true;
  pendingPrompt = prompt;
}

// CLI 入口负责调用 runMain
