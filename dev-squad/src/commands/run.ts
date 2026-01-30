/**
 * Dev Squad - Main Entry
 *
 * 演示三个 Agent 在 Room 中协作：
 * - planner: 分析需求，输出设计文档
 * - coder: 根据设计文档实现代码
 * - tester: 根据设计文档验证实现，不通过则打回
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  Agent,
  AgentPool,
  Room,
  AgentTemplateRegistry,
  SandboxFactory,
  LocalSandbox,
  JSONStore,
  globalToolRegistry,
  builtin,
  type AgentDependencies,
} from '@shareai-lab/kode-sdk';

import { devSquadTemplates } from '../templates.js';
import { createProvider } from '../lib/provider.js';
import { ensureLocalDirs, getLocalDataDir, getLocalWorkspaceDir, type Config } from '../lib/config.js';

// ============== 配置 ==============

const BASE_WORKSPACE_DIR = getLocalWorkspaceDir();
const STORE_DIR = getLocalDataDir();

/** 创建带时间戳的工作目录 */
function createWorkspaceDir(): string {
  const timestamp = Date.now();
  const workDir = path.resolve(BASE_WORKSPACE_DIR, `workspace_${timestamp}`);
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

/** 清理工作目录和数据目录 */
function cleanDirectories(workspaceDir: string): void {
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true });
    console.log(`🗑️  已清理: ${workspaceDir}`);
  }
}

/** 确保目录存在 */
function ensureDirectories(): void {
  ensureLocalDirs();
}

// ============== 状态行 ==============

/** 状态行管理器 - 在终端底部显示 Agent 活动状态 */
class StatusLine {
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private currentStatus = '';
  private isActive = false;

  /** 开始显示状态 */
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

  /** 更新状态文本 */
  update(status: string): void {
    this.currentStatus = status;
    if (this.isActive) {
      this.render();
    }
  }

  /** 清除状态行（输出内容前调用） */
  clear(): void {
    if (this.isActive) {
      process.stdout.write('\r\x1b[K'); // 清除当前行
    }
  }

  /** 停止状态显示 */
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
    // 确保不超过终端宽度
    const maxWidth = process.stdout.columns || 80;
    const truncated = line.slice(0, maxWidth);
    process.stdout.write(truncated + '\x1b[K'); // \x1b[K 清除行尾
  }
}

const statusLine = new StatusLine();

// ============== 主程序 ==============

export interface RunOptions {
  debug?: boolean;
}

/** 判断是否为批准命令 */
function isApprovalCommand(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return false;

  const cleaned = normalized.replace(/[!！。．,.，;；:：?？]+$/g, '');
  if (!cleaned) return false;

  const prefixWords = ['approve', 'approved', '批准'];
  const strictWords = ['ok', '可以', '同意', '通过', 'yes', 'lgtm', '确认'];

  if (prefixWords.some((word) => cleaned.startsWith(word))) return true;
  return strictWords.some((word) => cleaned === word);
}

export async function runMain(config: Config, options: RunOptions = {}): Promise<void> {
  console.log('🚀 Dev Squad - 三人开发小队\n');
  console.log('展示 Room + @mention 多 Agent 协作流程\n');

  // 确保基础目录存在
  ensureDirectories();

  // 创建本次运行的工作目录
  let workspaceDir = createWorkspaceDir();
  console.log(`📁 工作目录: ${workspaceDir}`);

  // 1. 创建 Provider
  const provider = createProvider(config);
  console.log(`✅ 使用模型: ${provider.model}`);

  // 2. 创建 Store
  const store = new JSONStore(STORE_DIR);
  console.log(`✅ 数据存储: ${STORE_DIR}`);

  // 3. 注册模板
  const templateRegistry = new AgentTemplateRegistry();
  devSquadTemplates.forEach((t) => templateRegistry.register(t));
  console.log(`✅ 已注册模板: ${devSquadTemplates.map((t) => t.id).join(', ')}`);

  // 4. 注册内置工具
  builtin.fs().forEach((tool) => globalToolRegistry.register(tool.name, () => tool));
  builtin.bash().forEach((tool) => globalToolRegistry.register(tool.name, () => tool));
  console.log('✅ 已注册内置工具: fs, bash');

  // 5. 创建 SandboxFactory
  const sandboxFactory = new SandboxFactory();
  sandboxFactory.register('local', (config) => new LocalSandbox({ workDir: config.workDir || workspaceDir }));

  // 6. 创建 AgentDependencies
  const deps: AgentDependencies = {
    store,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory,
  };

  // 7. 创建 AgentPool 和 Room
  const pool = new AgentPool({ dependencies: deps });
  const room = new Room(pool);

  // 8. 创建三个 Agent
  // 注意：Coder 和 Tester 在用户批准设计后才加入 Room
  // maxTokens 设置为 16384，以支持生成较大的代码文件
  const agentMetadata = { maxTokens: 16384 };

  const runId = Date.now().toString();
  const plannerAgentId = `planner-${runId}`;
  const coderAgentId = `coder-${runId}`;
  const testerAgentId = `tester-${runId}`;

  const plannerAgent = await pool.create(plannerAgentId, {
    templateId: 'dev-planner',
    model: provider,
    sandbox: { kind: 'local', workDir: workspaceDir },
    metadata: agentMetadata,
  });
  room.join('planner', plannerAgentId);
  console.log('✅ Planner Agent 已加入 Room (负责设计)');

  const coderAgent = await pool.create(coderAgentId, {
    templateId: 'dev-coder',
    model: provider,
    sandbox: { kind: 'local', workDir: workspaceDir },
    metadata: agentMetadata,
  });
  // Coder 暂不加入 Room，等待用户批准设计后再加入
  console.log('✅ Coder Agent 已创建 (等待设计批准后加入)');

  const testerAgent = await pool.create(testerAgentId, {
    templateId: 'dev-tester',
    model: provider,
    sandbox: { kind: 'local', workDir: workspaceDir },
    metadata: agentMetadata,
  });
  // Tester 暂不加入 Room，等待开发开始后再加入
  console.log('✅ Tester Agent 已创建 (等待开发开始后加入)');

  // 设计批准状态
  let designApproved = false;
  let agentsJoined = false;

  // 输入锁定状态（Agent 运行时不接受用户输入）
  let inputLocked = false;
  let isFirstInput = true;

  // 10. 创建命令行交互
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const renderPrompt = (): void => {
    const promptText = isFirstInput ? '📝 请输入功能需求: ' : '💬 你: ';
    rl.setPrompt(promptText);
    rl.prompt();
  };

  const lockInput = (): void => {
    if (inputLocked) return;
    inputLocked = true;
    rl.pause();
  };

  const unlockInput = (): void => {
    inputLocked = false;
    statusLine.stop();
    try {
      rl.resume();
    } catch {
      // ignore
    }
    renderPrompt();
  };

  const printLine = (text: string): void => {
    if (inputLocked) {
      console.log(text);
      return;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${text}\n`);
    renderPrompt();
  };

  const printInline = (text: string): void => {
    if (inputLocked) {
      process.stdout.write(text);
      return;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(text);
    renderPrompt();
  };

  // 9. 订阅 Agent 事件，打印输出
  // 用于累积 Agent 输出文本以便路由到 Room
  const agentTextAccumulator: Map<string, string> = new Map();
  const agentSpeechOpen: Map<string, boolean> = new Map();

  const debug = options.debug === true;

  const subscribeAgent = async (agent: Agent, name: string, emoji: string, roomName: string) => {
    const label = `[${emoji} ${name}] Say: `;
    // 订阅 progress, control 和 monitor 三个频道
    for await (const envelope of agent.subscribe(['progress', 'control', 'monitor'])) {
      const event = envelope.event;
      const eventType = event.type;

      if (eventType === 'text_chunk') {
        statusLine.stop();
        if (!agentSpeechOpen.get(name)) {
          agentSpeechOpen.set(name, true);
          printInline(label + event.delta);
        } else {
          printInline(event.delta);
        }
      } else if (eventType === 'text_chunk_end') {
        if (inputLocked) {
          console.log();
        } else {
          printLine('');
        }
        agentSpeechOpen.set(name, false);
        // 累积文本用于后续路由
        const currentText = agentTextAccumulator.get(name) || '';
        agentTextAccumulator.set(name, currentText + (event as any).text + '\n');
      } else if (eventType === 'tool:start') {
        statusLine.stop();
        const callId = (event as any).call?.id?.slice(-6) || '?';
        printLine(`🔧 [${emoji} ${name}] 调用工具: ${event.call.name} (${callId})`);
        statusLine.start(`[${emoji} ${name}] ${event.call.name}...`);
      } else if (eventType === 'tool:end') {
        statusLine.stop();
        const callId = (event as any).call?.id?.slice(-6) || '?';
        printLine(`✅ [${emoji} ${name}] 工具完成: ${event.call.name} (${callId})`);
      } else if (eventType === 'tool:error') {
        statusLine.stop();
        const callId = (event as any).call?.id?.slice(-6) || '?';
        printLine(`❌ [${emoji} ${name}] 工具错误: ${(event as any).call?.name} (${callId})`);
        printLine(`   错误信息: ${JSON.stringify((event as any).error)}`);
      } else if (eventType === 'permission_required') {
        statusLine.stop();
        const callId = (event as any).call?.id?.slice(-6) || '?';
        printLine(`⚠️ [${emoji} ${name}] 需要权限批准: ${(event as any).call?.name} (${callId})`);
        // 自动批准权限请求
        try {
          await (event as any).respond('allow', { note: 'auto-approved by dev-squad' });
          printLine(`✅ [${emoji} ${name}] 已自动批准: ${(event as any).call?.name} (${callId})`);
        } catch (err) {
          printLine(`❌ [${emoji} ${name}] 批准失败 (${callId}): ${String(err)}`);
        }
      } else if (eventType === 'permission_decided') {
        statusLine.stop();
        const decision = (event as any).decision;
        const callId = (event as any).callId?.slice(-6) || '?';
        printLine(`🔓 [${emoji} ${name}] 权限已决定 (${callId}): ${decision === 'allow' ? '批准' : '拒绝'}`);
      } else if (eventType === 'done') {
        statusLine.stop();
        printLine(`📝 [${emoji} ${name}] 回合结束`);
        printLine('─'.repeat(60));

        // 获取累积的文本并检查是否需要路由到其他 Agent
        const accumulatedText = agentTextAccumulator.get(name) || '';
        agentTextAccumulator.set(name, ''); // 清空累积

        // 检查是否有 @mention 需要路由
        const mentionPattern = /@(planner|coder|tester)\b/gi;
        const mentions = accumulatedText.match(mentionPattern);

        // 过滤掉自引用（不要路由给自己）
        const filteredMentions = mentions?.filter(
          (m) => m.toLowerCase() !== `@${roomName.toLowerCase()}`
        );

        if (filteredMentions && filteredMentions.length > 0) {
          printLine(`🔀 [${emoji} ${name}] 路由消息到: ${filteredMentions.join(', ')}`);
          // 通过 Room 路由消息
          try {
            await room.say(roomName, accumulatedText);
          } catch (err) {
            printLine(`❌ [${emoji} ${name}] 路由失败: ${String(err)}`);
          }
        } else {
          // 没有路由时解锁输入
          unlockInput();
        }
      } else if (eventType === 'error') {
        // Monitor channel error event
        statusLine.stop();
        const severity = (event as any).severity || 'error';
        const phase = (event as any).phase || 'unknown';
        const message = (event as any).message || 'Unknown error';
        printLine(`⚠️ [${emoji} ${name}] ${severity.toUpperCase()} (${phase}): ${message}`);
        if ((event as any).detail) {
          printLine(`   详情: ${JSON.stringify((event as any).detail)}`);
        }
      } else if (eventType === 'tool_executed') {
        // Monitor channel - tool executed (additional info)
        const call = (event as any).call;
        if (call?.isError) {
          printLine(`⚠️ [${emoji} ${name}] 工具执行异常: ${call.name} - ${call.error}`);
        }
      } else {
        // 捕获其他未知事件类型用于调试
        if (debug) {
          printLine(`📢 [${emoji} ${name}] 事件: ${eventType}`);
        }
      }
    }
  };

  // 后台订阅三个 Agent 的事件
  subscribeAgent(plannerAgent, 'Planner', '📋', 'planner').catch(console.error);
  subscribeAgent(coderAgent, 'Coder', '💻', 'coder').catch(console.error);
  subscribeAgent(testerAgent, 'Tester', '🧪', 'tester').catch(console.error);

  console.log('\n📋 使用说明:');
  console.log('  - 输入功能需求，Planner 会先分析需求');
  console.log('  - Planner 可能会提问澄清需求，请回答问题');
  console.log('  - Planner 完成设计后，审阅工作目录下的 design.md');
  console.log('  - 输入 "approve" 或 "批准" 批准设计，开始开发');
  console.log('  - 如需修改设计，直接输入修改意见');
  console.log('  - 验证失败时 Tester 会 @coder 要求修复');
  console.log('  - 输入 "reset" 清理并重新开始');
  console.log('  - 输入 "exit" 退出\n');

  console.log('💡 示例需求:');
  console.log('  - 写一个计算斐波那契数列的函数');
  console.log('  - 实现一个字符串反转函数');
  console.log('  - 写一个判断回文字符串的函数\n');

  const sendToRoom = async (message: string): Promise<void> => {
    lockInput();
    printLine('✅ 已发送，等待响应...');
    await room.say('user', message);
  };

  rl.on('line', async (input) => {
    const trimmed = input.trim();

    if (trimmed.toLowerCase() === 'exit') {
      console.log('👋 再见!');
      rl.close();
      process.exit(0);
    }

    if (trimmed.toLowerCase() === 'reset') {
      console.log('\n🔄 重置中...');
      cleanDirectories(workspaceDir);
      workspaceDir = createWorkspaceDir();
      isFirstInput = true;
      designApproved = false;
      console.log(`✅ 已重置，新工作目录: ${workspaceDir}\n`);
      renderPrompt();
      return;
    }

    if (!trimmed) {
      renderPrompt();
      return;
    }

    try {
      if (isFirstInput) {
        // 第一次输入，发送需求给 Planner
        console.log('\n🎯 开始开发流程...\n');
        console.log('─'.repeat(60));
        await sendToRoom(`@planner 请为以下需求编写设计文档：\n\n${trimmed}`);
        isFirstInput = false;
      } else if (isApprovalCommand(trimmed)) {
        if (!designApproved) {
          // 用户批准设计
          designApproved = true;
          console.log('\n✅ 设计已批准，开始开发...\n');
          console.log('─'.repeat(60));
        } else {
          console.log('\n✅ 当前已处于批准状态，继续开发中...\n');
          console.log('─'.repeat(60));
        }

        // 将 Coder 和 Tester 加入 Room（仅首次）
        if (!agentsJoined) {
          room.join('coder', coderAgentId);
          room.join('tester', testerAgentId);
          agentsJoined = true;
          console.log('✅ Coder 和 Tester 已加入 Room\n');
        }

        // 通知 Coder 开始开发
        await sendToRoom('@coder 设计已获批准，请查看 ./design.md 开始实现');
      } else if (!designApproved) {
        // 设计未批准阶段：用户回答问题或提供修改意见，发送给 Planner
        console.log();
        await sendToRoom(`@planner ${trimmed}`);
      } else {
        // 设计已批准阶段：用户反馈（如 bug 报告）应先发给 Planner 评估
        // 这样可以避免三个 Agent 同时响应造成混乱
        console.log('\n📋 用户反馈已转发给 Planner 评估，需重新批准后继续开发...\n');
        console.log('─'.repeat(60));
        designApproved = false;
        await sendToRoom(`@planner 用户反馈了以下问题，请评估是否需要更新设计文档：\n\n${trimmed}`);
      }
    } catch (err) {
      console.error('❌ 错误:', err);
      unlockInput();
    }
  });

  renderPrompt();
}

// CLI 入口负责调用 runMain
