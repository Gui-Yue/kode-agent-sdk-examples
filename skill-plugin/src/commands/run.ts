/**
 * Skill Plugin Demo - 主程序
 *
 * 展示 SkillsManager + SKILL.md 技能包 + 动态技能加载
 *
 * 技能是 Markdown 格式的指令包，通过 SkillsManager 扫描和加载，
 * 技能内容会被注入到 Agent 的 systemPrompt 中。
 */

import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  LocalSandbox,
  JSONStore,
  SkillsManager,
  globalToolRegistry,
  builtin,
  type AgentDependencies,
} from '@shareai-lab/kode-sdk';

import { skillAgentTemplate } from '../template.js';
import { createRestrictedFsTools } from '../restricted-tools.js';
import { createProvider } from '../lib/provider.js';
import { ensureLocalDirs, getLocalDataDir, getLocalWorkspaceDir, type Config } from '../lib/config.js';

// ============== 配置 ==============

const STORE_DIR = getLocalDataDir();
const WORKSPACE_DIR = getLocalWorkspaceDir(); // Agent 写操作的隔离目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');
const CWD_SKILLS_DIR = path.resolve(process.cwd(), 'skills');
const ENV_SKILLS_DIR = process.env.SKILLS_DIR ? path.resolve(process.env.SKILLS_DIR) : null;

interface SkillMeta {
  name: string;
  description?: string;
  path?: string;
}

// ============== 主程序 ==============

export async function runMain(config: Config): Promise<void> {
  console.log('🔌 Skill Agent - 可插拔技能系统\n');
  console.log('展示 SkillsManager + SKILL.md 技能包 + 动态技能加载\n');

  ensureLocalDirs();

  // 1. 创建 Provider
  const provider = createProvider(config);
  console.log(`✅ 使用模型: ${provider.model}`);

  // 2. 创建 Store
  const store = new JSONStore(STORE_DIR);
  console.log(`✅ 数据存储: ${STORE_DIR}`);

  // 3. 创建 SkillsManager 并扫描技能（合并当前目录 + 环境变量 + 内置 skills）
  const skillsDirs = [CWD_SKILLS_DIR, ENV_SKILLS_DIR, DEFAULT_SKILLS_DIR].filter(
    (dir): dir is string => Boolean(dir)
  );
  const uniqueDirs = Array.from(new Set(skillsDirs)).filter((dir) => fs.existsSync(dir));
  const managers = uniqueDirs.map((dir) => ({ dir, manager: new SkillsManager(dir) }));

  const mergedSkills = new Map<string, SkillMeta>();
  for (const { manager } of managers) {
    const skills = (await manager.scan()) as SkillMeta[];
    for (const skill of skills) {
      if (!mergedSkills.has(skill.name)) {
        mergedSkills.set(skill.name, skill);
      }
    }
  }

  if (uniqueDirs.length > 0) {
    console.log(`✅ 技能目录: ${uniqueDirs.join(', ')}`);
  } else {
    console.log('⚠️ 未找到技能目录（默认 skills 目录不存在）');
  }
  console.log(`📦 发现 ${mergedSkills.size} 个技能:\n`);
  for (const skill of mergedSkills.values()) {
    console.log(`   - ${skill.name}: ${skill.description || ''}`.trim());
  }
  console.log();

  // 4. 注册模板
  const templateRegistry = new AgentTemplateRegistry();
  templateRegistry.register(skillAgentTemplate);
  console.log('✅ 已注册技能 Agent 模板');

  // 5. 创建工作目录（写操作隔离目录）
  const workspaceDir = path.resolve(WORKSPACE_DIR);
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  console.log(`✅ 工作目录: ${workspaceDir}`);

  // 6. 注册受限的 fs 工具（读取任意路径，写入只能在 workspace）
  const restrictedFsTools = createRestrictedFsTools(workspaceDir);
  restrictedFsTools.forEach((tool) => globalToolRegistry.register(tool.name, () => tool));
  // 注册 bash 工具
  builtin.bash().forEach((tool) => globalToolRegistry.register(tool.name, () => tool));
  console.log('✅ 已注册工具:');
  console.log(`   - fs_read: 可读取任意路径`);
  console.log(`   - fs_write: 只能写入 ${workspaceDir}`);
  console.log(`   - fs_glob, fs_grep: 可搜索任意路径`);
  console.log(`   - bash_run: shell 命令`);

  // 7. 创建 SandboxFactory
  const sandboxFactory = new SandboxFactory();
  sandboxFactory.register('local', () => new LocalSandbox({ workDir: workspaceDir }));

  // 8. 创建 AgentDependencies
  const primarySkillsManager = managers[0]?.manager || new SkillsManager(DEFAULT_SKILLS_DIR);
  const deps: AgentDependencies = {
    store,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory,
    skillsManager: primarySkillsManager, // 传入主要 SkillsManager
  };

  // 9. 跟踪已激活的技能
  const activeSkills: Set<string> = new Set();

  // 10. 创建 Agent
  let currentAgent = await Agent.create(
    {
      agentId: 'skill-agent-001',
      templateId: 'skill-agent',
      model: provider,
      sandbox: { kind: 'local', workDir: workspaceDir },
      metadata: { maxTokens: 16384 }, // 增大 maxTokens 以支持生成较大的响应
    },
    deps
  );
  console.log('✅ Skill Agent 已创建\n');

  // 等待 Agent 完成的状态
  let waitingForAgent = false;
  let pendingPrompt: (() => void) | null = null;

  // 11. 订阅 Progress Channel 打印输出
  const startSubscription = (agent: Agent) => {
    (async () => {
      for await (const envelope of agent.subscribe(['progress'])) {
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
    })().catch(() => {});
  };

  startSubscription(currentAgent);

  // 12. 命令行交互
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('📋 使用说明:');
  console.log('  - 输入 "skills" 查看所有可用技能');
  console.log('  - 输入 "use <skill-name>" 激活技能（技能内容注入到对话）');
  console.log('  - 输入 "active" 查看已激活的技能');
  console.log('  - 直接输入问题与 Agent 对话');
  console.log('  - 输入 "exit" 退出\n');
  console.log('  - 技能目录合并顺序：./skills → $SKILLS_DIR → 内置 skills\n');

  console.log('💡 示例:');
  console.log('  use using-git-worktrees');
  console.log('  use code-review');
  console.log('  帮我创建一个新的 worktree 来开发 feature/auth 功能\n');

  const prompt = (): void => {
    rl.question('💬 你: ', async (input) => {
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

      // 命令：列出所有技能
      if (trimmed.toLowerCase() === 'skills') {
        console.log('\n📦 可用技能:\n');
        for (const skill of mergedSkills.values()) {
          const active = activeSkills.has(skill.name) ? ' ✅' : '';
          console.log(`  - ${skill.name}${active}`);
          console.log(`    ${skill.description}\n`);
        }
        prompt();
        return;
      }

      // 命令：查看已激活技能
      if (trimmed.toLowerCase() === 'active') {
        if (activeSkills.size === 0) {
          console.log('\n📋 没有已激活的技能\n');
        } else {
          console.log('\n📋 已激活的技能:');
          for (const name of activeSkills) {
            console.log(`  ✅ ${name}`);
          }
          console.log();
        }
        prompt();
        return;
      }

      // 命令：激活技能
      if (trimmed.toLowerCase().startsWith('use ')) {
        const skillName = trimmed.substring(4).trim();

        // 加载技能内容
        let skillContent: any = null;
        for (const { manager } of managers) {
          skillContent = await manager.loadSkillContent(skillName);
          if (skillContent) break;
        }
        if (!skillContent) {
          console.log(`\n❌ 未找到技能: ${skillName}`);
          console.log('使用 "skills" 查看所有可用技能\n');
          prompt();
          return;
        }

        activeSkills.add(skillName);
        console.log(`\n✅ 已激活技能: ${skillName}`);
        console.log(`📄 技能路径: ${skillContent.metadata.path}\n`);

        // 将技能内容发送给 Agent（作为上下文注入）
        const skillMessage = `[系统] 用户激活了技能: ${skillName}

以下是该技能的完整内容，请在后续对话中遵循这些指南：

---
${skillContent.content}
---

请确认你已经了解这个技能，并准备好使用它来帮助用户。`;

        try {
          await currentAgent.send(skillMessage);
        } catch (err) {
          console.error('❌ 发送技能内容失败:', err);
        }

        waitingForAgent = true;
        pendingPrompt = prompt;
        return;
      }

      // 普通对话
      try {
        await currentAgent.send(trimmed);
      } catch (err) {
        console.error('❌ 错误:', err);
      }

      waitingForAgent = true;
      pendingPrompt = prompt;
    });
  };

  prompt();
}

// CLI 入口负责调用 runMain
