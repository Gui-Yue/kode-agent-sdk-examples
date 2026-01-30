/**
 * Research Squad - 主程序
 *
 * 展示 AgentPool + sub-agent + Todo 追踪
 * Leader 拆解任务，派发给 Researcher 并行调研，最后汇总
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import {
  Agent,
  AgentPool,
  AgentTemplateRegistry,
  SandboxFactory,
  LocalSandbox,
  JSONStore,
  globalToolRegistry,
  builtin,
  type AgentDependencies,
  type TodoItem,
} from '@shareai-lab/kode-sdk';

import { researchSquadTemplates, leaderTemplate, researcherTemplate } from '../templates.js';
import { createCustomTaskRunTool, setSubAgentEventCallback, createWebSearchTool, setCurrentTaskDir, getCurrentTaskDir, createSetTaskNameTool, getCurrentTaskName, setCurrentTaskName } from '../tools.js';
import { createProvider } from '../lib/provider.js';
import { ensureLocalDirs, getLocalDataDir, getLocalWorkspaceDir, type Config } from '../lib/config.js';

// ============== 配置 ==============

const STORE_DIR = getLocalDataDir();
const WORKSPACE_DIR = getLocalWorkspaceDir();
const REPORTS_DIR = path.join(WORKSPACE_DIR, 'reports');

// ============== Todo 状态显示 ==============

function formatTodoStatus(todos: TodoItem[]): string {
  if (todos.length === 0) return '  (空)';

  const statusIcon: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
  };

  return todos
    .map((t) => `  ${statusIcon[t.status] || '❓'} ${t.title}`)
    .join('\n');
}

function sanitizeTaskTitle(title: string): string {
  // 替换所有特殊字符（包括中英文标点）为下划线
  return title
    .replace(/[\/\\:*?"<>|：；，。！？、（）【】「」『』《》""'']/g, '_')
    .replace(/_+/g, '_')  // 合并连续下划线
    .replace(/^_|_$/g, '') // 去掉首尾下划线
    .substring(0, 30);     // 限制长度为 30 字符
}

function getExpectedReportPath(taskDir: string, index: number, title: string): string {
  const safeTitle = sanitizeTaskTitle(title);
  return `${taskDir}/${String(index).padStart(2, '0')}_${safeTitle}.md`;
}

/**
 * 从用户输入中提取核心主题名称（保底用）
 * 优先提取英文专有名词，其次是中文关键词
 */
function extractKeyTopic(input: string): string {
  // 1. 先移除常见的无关词汇
  const cleaned = input
    .replace(/帮我|帮忙|请|调查|调研|分析|了解|一下|最近|关于/g, '')
    .trim();

  // 2. 优先提取英文单词（可能是产品名、技术名）
  const englishWords = cleaned.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g);
  if (englishWords && englishWords.length > 0) {
    // 取最长的英文单词作为核心主题
    const longest = englishWords.sort((a, b) => b.length - a.length)[0];
    return longest.length > 12 ? longest.substring(0, 12) : longest;
  }

  // 3. 提取中文关键词（排除常见动词）
  const chineseWords = cleaned.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chineseWords && chineseWords.length > 0) {
    // 过滤掉常见无意义词
    const filtered = chineseWords.filter(w =>
      !['什么', '怎么', '如何', '为什么', '哪些', '这个', '那个'].includes(w)
    );
    if (filtered.length > 0) {
      const topic = filtered[0].substring(0, 6);
      return topic.length <= 3 ? `${topic}调研` : topic;
    }
  }

  // 4. 实在提取不出来，用时间戳
  return '调研任务';
}

// ============== 状态行 ==============

class StatusLine {
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private currentStatus = '';
  private isActive = false;

  start(status: string): void {
    this.currentStatus = status;
    this.isActive = true;
    this.render();

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
        this.render();
      }, 80);
    }
  }

  update(status: string): void {
    this.currentStatus = status;
    if (this.isActive) {
      this.render();
    }
  }

  clear(): void {
    if (this.isActive) {
      process.stdout.write('\r\x1b[K');
    }
  }

  stop(): void {
    this.clear();
    this.isActive = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    const spinner = this.spinnerFrames[this.frameIndex];
    const line = `\r\x1b[36m${spinner}\x1b[0m ${this.currentStatus}`;
    const maxWidth = process.stdout.columns || 80;
    const truncated = line.slice(0, maxWidth);
    process.stdout.write(truncated + '\x1b[K');
  }
}

// ============== 主程序 ==============

export async function runMain(config: Config): Promise<void> {
  console.log('🔬 Research Squad - 自动调研小队\n');
  console.log('展示 AgentPool + sub-agent 委派 + Todo 追踪\n');

  ensureLocalDirs();

  // 1. 创建 Provider
  const provider = createProvider(config);
  console.log(`✅ 使用模型: ${provider.model}`);

  // 显示代理配置
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxyUrl) {
    console.log(`✅ 代理配置: ${proxyUrl}`);
  } else {
    console.log('⚠️  未配置代理（可通过 HTTPS_PROXY 环境变量配置）');
  }

  // 2. 创建 Store
  const store = new JSONStore(STORE_DIR);
  console.log(`✅ 数据存储: ${STORE_DIR}`);

  // 3. 注册模板
  const templateRegistry = new AgentTemplateRegistry();
  researchSquadTemplates.forEach((t) => templateRegistry.register(t));
  console.log('✅ 已注册调研模板: leader, researcher');

  // 4. 注册工具
  // 注意：Todo 工具不需要手动注册！
  // Agent 会在初始化时根据模板的 runtime.todo.enabled 自动注册
  // 如果手动注册会导致上下文丢失，todo 功能失效

  // FS 工具（用于保存报告）
  builtin.fs().forEach((tool) => globalToolRegistry.register(tool.name, () => tool));

  // Web 搜索工具（用于联网调研）
  const webSearchTool = createWebSearchTool();
  globalToolRegistry.register(webSearchTool.name, () => webSearchTool);

  // 确保 reports 目录存在
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // 设置任务名称工具（让 Agent 归纳简短主题名）
  const setTaskNameTool = createSetTaskNameTool(REPORTS_DIR);
  globalToolRegistry.register(setTaskNameTool.name, () => setTaskNameTool);

  // 自定义 Task Run 工具（支持转发子 Agent 输出）
  const taskRunTool = createCustomTaskRunTool(
    [{ id: researcherTemplate.id, whenToUse: researcherTemplate.desc || '研究员', tools: ['web_search', 'fs_write'] }],
    WORKSPACE_DIR
  );
  globalToolRegistry.register(taskRunTool.name, () => taskRunTool);

  console.log('✅ 已注册工具: fs, web_search, set_task_name, task_run');
  console.log(`✅ 报告目录: ${REPORTS_DIR}`);

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

  // 7. 创建 AgentPool
  const pool = new AgentPool({ dependencies: deps, maxAgents: 10 });
  console.log('✅ AgentPool 已创建 (最大 10 个 Agent)');

  // 8. 创建 Leader Agent（每次运行使用新 ID，避免继承历史状态）
  const leaderAgentId = `leader-${Date.now().toString(36)}`;
  const leaderAgent = await pool.create(leaderAgentId, {
    templateId: 'research-leader',
    model: provider,
    sandbox: { kind: 'local', workDir: '.' },
    metadata: { maxTokens: 16384 }, // 增大 maxTokens 以支持生成较大的响应
  });
  console.log('✅ Research Leader 已创建\n');

  const statusLine = new StatusLine();
  let leaderBusy = false;
  let leaderToolActive = false;
  const activeSubAgents = new Set<string>();

  const formatActiveAgents = (): string => {
    if (activeSubAgents.size === 0) return '';
    const names = Array.from(activeSubAgents);
    const joined = names.join(', ');
    const maxLen = 50;
    if (joined.length <= maxLen) return joined;
    return joined.slice(0, maxLen - 1) + '…';
  };

  const refreshStatus = (): void => {
    if (leaderToolActive) {
      statusLine.stop();
      return;
    }
    const parts: string[] = [];
    if (leaderBusy) parts.push('Leader 处理中');
    if (activeSubAgents.size > 0) parts.push(`子任务进行中: ${formatActiveAgents()}`);
    if (parts.length === 0) {
      statusLine.stop();
      return;
    }
    if (statusLine) {
      statusLine.start(parts.join(' · '));
    }
  };

  const runLeader = async (prompt: string): Promise<void> => {
    leaderBusy = true;
    refreshStatus();
    try {
      await leaderAgent.complete(prompt);
    } catch (err) {
      console.error(`\n❌ Leader Agent 执行出错:`, err);
      throw err;
    } finally {
      leaderBusy = false;
      refreshStatus();
    }
  };

  // 9. 监听 Todo 变化
  leaderAgent.on('todo_changed', (event: any) => {
    statusLine.stop();
    console.log('\n📋 Todo 列表更新:');
    // 事件结构: { previous: [...], current: [...] }
    const todos = event.current || event.todos || event.data?.todos || [];
    console.log(formatTodoStatus(todos));
    console.log();
    refreshStatus();
  });

  // 10. 设置子 Agent 事件回调（只记录状态，不转发输出）
  setSubAgentEventCallback({
    onTextChunk: (agentId) => {
      activeSubAgents.add(agentId);
      refreshStatus();
    },
    onToolStart: (agentId) => {
      activeSubAgents.add(agentId);
      refreshStatus();
    },
    onToolEnd: () => {
      refreshStatus();
    },
    onDone: (agentId) => {
      activeSubAgents.delete(agentId);
      refreshStatus();
    },
  });

  // 自动恢复计数器
  let autoResumeCount = 0;
  const MAX_AUTO_RESUME = 10;

  // 11. 订阅 Progress Channel 打印输出（只负责显示，不控制流程）
  (async () => {
    for await (const envelope of leaderAgent.subscribe(['progress'])) {
      const event = envelope.event;

      if (event.type === 'text_chunk') {
        statusLine.stop();
        process.stdout.write(event.delta);
      } else if (event.type === 'text_chunk_end') {
        console.log();
        refreshStatus();
      } else if (event.type === 'tool:start') {
        leaderToolActive = true;
        statusLine.stop();
        if (event.call.name === 'task_run') {
          const args = (event.call as any).args || (event.call as any).arguments || {};
          const label = args.taskIndex ? ` #${args.taskIndex}` : '';
          console.log(`\n🔀 正在委派子任务${label}...\n`);
        } else if (event.call.name === 'todo_write') {
          console.log(`\n📝 更新任务列表...`);
        } else {
          console.log(`\n🔧 调用工具: ${event.call.name}`);
        }
        refreshStatus();
      } else if (event.type === 'tool:end') {
        leaderToolActive = false;
        statusLine.stop();
        if (event.call.name === 'task_run') {
          const args = (event.call as any).args || (event.call as any).arguments || {};
          const label = args.taskIndex ? ` #${args.taskIndex}` : '';
          console.log(`\n✅ 子任务${label} 已启动（后台执行）`);
        }
        refreshStatus();
      }
    }
  })().catch(console.error);

  // 12. 命令行交互
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('📋 使用说明:');
  console.log('  - 输入调研主题，Leader 会拆解任务并委派给 Researcher');
  console.log('  - 输入 "status" 查看当前任务进度');
  console.log('  - 输入 "pool" 查看 AgentPool 状态');
  console.log('  - 输入 "continue" 继续未完成的调研任务');
  console.log('  - 输入 "exit" 退出\n');

  console.log('💡 示例主题:');
  console.log('  - "对比 React 和 Vue 的状态管理方案"');
  console.log('  - "分析微服务架构的优缺点"');
  console.log('  - "调研 2024 年 AI 编程工具的发展趋势"\n');

  const autoDrive = async (): Promise<boolean> => {
    while (autoResumeCount < MAX_AUTO_RESUME) {
      let todos = leaderAgent.getTodos();
      const taskDir = getCurrentTaskDir();

      if (taskDir && todos.length > 0) {
        let changed = false;
        const normalizedTodos = todos.map((t, i) => {
          const expected = getExpectedReportPath(taskDir, i + 1, t.title);
          const exists = fs.existsSync(expected);
          if (exists && t.status !== 'completed') {
            changed = true;
            return { ...t, status: 'completed' } as TodoItem;
          }
          if (!exists && t.status === 'completed') {
            changed = true;
            return { ...t, status: 'pending' } as TodoItem;
          }
          return t;
        });
        if (changed) {
          await leaderAgent.setTodos(normalizedTodos);
          todos = normalizedTodos;
        }
      }

      if (todos.length > 0) {
        console.log('\n📋 当前任务进度:');
        console.log(formatTodoStatus(todos));
      }

      const pendingTodos = todos.filter((t) => t.status === 'pending');
      const inProgressTodos = todos.filter((t) => t.status === 'in_progress');
      const allCompleted = todos.length > 0 && todos.every((t) => t.status === 'completed');

      if (pendingTodos.length > 0) {
        // 还有待处理任务，继续委派
        autoResumeCount++;

        if (!taskDir) {
          // 异常情况：任务目录未创建（系统应该已经创建）
          console.error(`\n❌ 异常：任务目录未创建，无法继续委派任务。`);
          console.log('请重新输入调研主题。\n');
          break;
        } else {
          // 有任务目录，直接并行委派子任务（避免模型误调用）
          console.log(`\n🔄 检测到 ${pendingTodos.length} 个待处理任务，开始并行委派 (${autoResumeCount}/${MAX_AUTO_RESUME})...\n`);
          const pendingIndexSet = new Set<number>();
          todos.forEach((t, idx) => {
            if (t.status === 'pending') pendingIndexSet.add(idx);
          });

          // 注意：不要批量将 pending 改为 in_progress，SDK 只允许一个 todo 是 in_progress
          // 子任务并行执行，完成后 task_run 工具会将对应 todo 标记为 completed

          // 收集期望生成的文件路径
          const expectedFiles: string[] = [];
          const dispatches: Promise<unknown>[] = [];
          todos.forEach((todo, index) => {
            if (!pendingIndexSet.has(index)) return;
            const taskIndex = index + 1;
            console.log(`🔀 正在委派子任务 #${taskIndex}...`);
            expectedFiles.push(getExpectedReportPath(taskDir, taskIndex, todo.title));
            const prompt = `请围绕以下主题进行调研并形成报告：

${todo.title}

要求：
1. 优先使用 web_search 查找最新信息
2. 至少列出 5 个可信来源（URL）
3. 给出核心结论与可信度判断
4. 条理清晰，使用小标题组织内容`;
            dispatches.push(
              taskRunTool.exec(
                {
                  taskIndex,
                  taskTitle: todo.title,
                  agentTemplateId: 'research-worker',
                  prompt,
                },
                {
                  agentId: leaderAgentId,
                  agent: leaderAgent as any,
                  sandbox: new LocalSandbox({ workDir: WORKSPACE_DIR }),
                }
              )
            );
            console.log(`✅ 子任务 #${taskIndex} 已启动（后台执行）`);
          });
          await Promise.all(dispatches);

          // 等待所有报告文件生成（最多等待 5 分钟）
          console.log(`\n⏳ 等待 ${expectedFiles.length} 个子任务完成...`);
          const maxWaitTime = 5 * 60 * 1000; // 5 minutes
          const pollInterval = 3000; // 3 seconds
          const startTime = Date.now();

          while (Date.now() - startTime < maxWaitTime) {
            const allFilesExist = expectedFiles.every((f) => fs.existsSync(f));
            if (allFilesExist) {
              console.log(`\n✅ 所有子任务报告已生成！`);
              break;
            }
            const existingCount = expectedFiles.filter((f) => fs.existsSync(f)).length;
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`\r⏳ 已完成 ${existingCount}/${expectedFiles.length} 个报告 (${elapsed}s)...`);
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
          console.log(); // 换行
        }
      } else if (inProgressTodos.length > 0) {
        console.log(`\n⏳ ${inProgressTodos.length} 个子任务正在执行，等待完成...\n`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      } else if (allCompleted && taskDir) {
        const missingFiles = todos
          .map((t, i) => getExpectedReportPath(taskDir, i + 1, t.title))
          .filter((p) => !fs.existsSync(p));
        if (missingFiles.length > 0) {
          autoResumeCount++;
          console.log(`\n⚠️ 检测到 ${missingFiles.length} 个报告文件缺失，先补齐再汇总...\n`);
          await runLeader(`你标记了所有任务已完成，但系统检测到以下报告文件缺失：
${missingFiles.map((f) => `- ${f}`).join('\n')}

请重新委派缺失的子任务（使用 task_run），确保每个任务都有对应的报告文件。完成后再继续。`);
          continue;
        }
        // 所有子任务完成，生成汇总报告
        autoResumeCount++;
        console.log(`\n📊 所有子任务已完成，开始生成汇总报告...\n`);
        await runLeader(`所有调研子任务已完成！请生成最终汇总报告：

任务目录: ${taskDir}

## 步骤
1. 使用 fs_glob 查找 ${taskDir}/*.md 下所有调研文件
2. 使用 fs_read 逐个读取每份调研报告的内容
3. 汇总分析所有调研结果
4. 生成高可视化的最终报告（必须包含 Mermaid 图表和对比表格）
5. 使用 fs_write 保存到: ${taskDir}/最终报告.md

⚠️ 你必须先读取子任务的文件内容，不要凭记忆写报告！`);

        // 汇总完成，退出循环
        console.log(`\n✅ 调研完成！结果已保存到: ${taskDir}`);
        break;
      } else {
        // 没有待处理任务，也没有已完成任务，退出
        break;
      }
    }

    const finalTodos = leaderAgent.getTodos();
    const hasPending = finalTodos.some((t) => t.status !== 'completed');
    if (hasPending) {
      console.log('\n⚠️ 任务未完成，输入 "continue" 可继续自动调研。');
      return false;
    }
    return true;
  };

  const prompt = (): void => {
    statusLine.stop();
    rl.question('🔬 请输入调研主题: ', async (input) => {
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

      // 特殊命令
      if (trimmed.toLowerCase() === 'status') {
        statusLine.stop();
        const todos = leaderAgent.getTodos();
        console.log('\n📋 当前任务进度:');
        console.log(formatTodoStatus(todos));
        console.log();
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'pool') {
        statusLine.stop();
        const agents = pool.list();
        console.log(`\n🏊 AgentPool 状态: ${agents.length} 个 Agent`);
        for (const agentId of agents) {
          const status = await pool.status(agentId);
          console.log(`  - ${agentId}: ${status?.state || 'unknown'}`);
        }
        console.log();
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'continue') {
        if (!getCurrentTaskDir() || leaderAgent.getTodos().length === 0) {
          statusLine.stop();
          console.log('\n⚠️ 没有可继续的调研任务，请先输入一个调研主题。\n');
          prompt();
          return;
        }
        try {
          autoResumeCount = 0;
          const completed = await autoDrive();
          if (completed) {
            setCurrentTaskDir(null);
            setCurrentTaskName(null);
            autoResumeCount = 0;
          }
          prompt();
        } catch (err) {
          console.error('❌ 错误:', err);
          prompt();
        }
        return;
      }

      // 发送调研任务
      try {
        // 重置任务状态
        setCurrentTaskDir(null);
        setCurrentTaskName(null);
        autoResumeCount = 0;

        // 清空上一次残留的 todo 列表
        await leaderAgent.setTodos([]);

        // 系统设置任务名称（使用智能提取）
        const taskName = extractKeyTopic(trimmed);
        console.log(`\n🧭 系统设置任务名称: ${taskName}`);
        await setTaskNameTool.exec(
          { name: taskName },
          {
            agentId: leaderAgentId,
            agent: leaderAgent as any,
            sandbox: new LocalSandbox({ workDir: WORKSPACE_DIR }),
          }
        );

        console.log('\n🎯 开始调研...\n');

        // === 第一轮：预研 + 规划 ===
        await runLeader(`请对以下主题进行调研：

${trimmed}

## 本轮任务（必须按顺序全部完成！）

### 第1步：任务名称已由系统设置
系统已设置任务名称并创建任务目录，请勿调用 set_task_name。

### 第2步：预研（最关键！）
使用 web_search 工具搜索 2-3 次，了解这个主题到底是什么。
你必须先搜索才能知道怎么拆解子问题，不能凭空猜测！

### 第3步：基于预研结果创建任务列表
根据搜索到的真实信息，将主题拆解为 3-5 个具体的子问题。
使用 todo_write 创建任务列表。

⚠️ 严格按 1→2→3 顺序执行！必须先预研了解主题，再拆解任务。
⚠️ 本轮只做以上三步，后续委派由系统自动触发。`);

        console.log('\n📝 第一轮结束');

        // === 多轮自动驱动：委派子任务 + 汇总报告 ===
        const completed = await autoDrive();
        if (completed) {
          // 清理状态
          setCurrentTaskDir(null);
          setCurrentTaskName(null);
          autoResumeCount = 0;
        }
        prompt();
      } catch (err) {
        console.error('❌ 错误:', err);
        setCurrentTaskDir(null);
        setCurrentTaskName(null);
        prompt();
      }
    });
  };

  prompt();
}

// CLI 入口负责调用 runMain
