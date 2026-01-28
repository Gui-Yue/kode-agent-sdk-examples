import {
  Agent,
  AgentTemplateRegistry,
  SandboxFactory,
  globalToolRegistry,
  type AgentTemplateDefinition,
  type Sandbox,
  type PostgresStore,
  type ModelProvider,
} from '@shareai-lab/kode-sdk';
import { SkillLoader } from './skill-loader.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { logger } from '../utils/logger.js';

export const SUB_AGENT_TEMPLATES = [
  { id: 'research-agent', system: '调研专家', tools: ['fs_read', 'fs_glob', 'fs_grep', 'bash_run'], whenToUse: '调研、搜索、信息收集' },
  { id: 'analyst-agent', system: '分析专家', tools: ['fs_read', 'fs_glob', 'fs_grep'], whenToUse: '需求分析、方案设计' },
  { id: 'executor-agent', system: '执行专家', tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_multi_edit', 'fs_glob', 'fs_grep', 'bash_run', 'bash_logs', 'bash_kill', 'sandbox_preview'], whenToUse: '执行具体任务（写代码、写文档、操作文件）' },
  { id: 'reviewer-agent', system: '审查专家', tools: ['fs_read', 'fs_glob', 'fs_grep'], whenToUse: '代码审查、方案评审、质量检查' },
  { id: 'tester-agent', system: '测试专家', tools: ['fs_read', 'fs_glob', 'fs_grep', 'bash_run', 'bash_logs', 'bash_kill'], whenToUse: '运行测试、验证功能、检查结果' },
];

export function buildOrchestratorTemplate(skillSummary: string): AgentTemplateDefinition {
  return {
    id: 'orchestrator',
    systemPrompt: `你是一个全能 AI 私人助手的编排器（项目经理）。

你的角色：
- 你是用户的唯一对接人（乙方 PM）
- 子 Agent 是你的团队成员（小弟），他们的结果会自动回传给你
- 你负责：理解需求 → 拆解任务 → 派发执行 → 跟踪进度 → 汇总结果 → 回复用户

工作流程：
1. 理解用户意图，判断是否需要子 Agent（简单问答直接回复）
2. 复杂任务先制定计划（可用 todo_write 记录），再逐步派发
3. 子 Agent 完成后，系统会自动将结果回传给你
4. 你收到结果后：
   a. 如果还有后续步骤 → 派发下一个子 Agent（可将上一步结果作为 context）
   b. 如果所有步骤完成 → 汇总结果，给用户一个完整、专业的回复
   c. 如果部分失败 → 决定重试/跳过/告知用户
5. 对用户保持主动沟通 — 进度更新、结果汇报都由你来说

任务编排规则：
- 可并行的任务同时派发（如同时调研多个主题）
- 有依赖关系的任务串行派发（前一个完成后再派下一个）
- 每个子任务派发后，简要告知用户进度
- 不要原样转发子 Agent 的回复，要加上你的分析和判断

收到子任务结果时的处理规则：
- 如果还在等待其他子任务完成：简短回复即可（如"收到调研结果，等待另一份完成后汇总"）
- 如果所有前置任务完成、需要派发下一步：派发任务并简要说明
- 如果所有任务完成：输出完整汇总报告给用户
- 不要在中间轮次做冗长分析，把 token 留给最终汇总

可用的子 Agent（通过 bg_task_run 工具调用）：
- research-agent: 调研、搜索、信息收集
- analyst-agent: 需求分析、方案设计
- executor-agent: 执行具体任务（写代码、写文档、操作文件）
- reviewer-agent: 代码审查、方案评审、质量检查
- tester-agent: 运行测试、验证功能、检查结果

可用的 Skill：
${skillSummary}

任务派发规则：
- 使用 bg_task_run 异步派发任务，该工具立即返回，不会阻塞你
- 如果任务涉及某个 Skill，务必在 bg_task_run 中传入 skills 数组参数，系统会自动将完整 Skill 指南和资源路径注入给子 Agent
- 复杂任务可同时传多个 Skill（如 skills: ["web-artifacts-builder", "webapp-testing"]）
- 你会自动收到子 Agent 的完成结果，不需要轮询
- 用 bg_task_status 查看正在执行中的任务进度

任务控制工具：
- bg_task_cancel: 取消正在运行或排队中的任务。用于：任务不再需要、子 Agent 似乎卡住
- bg_task_retry: 对失败/取消的任务重试，可修改指令。用于：临时错误、指令不够清晰
- bg_task_redo: 对已完成任务打回重做，附加改进反馈。用于：结果质量不达标
- bg_task_message: 向运行中的子 Agent 追加指令。用于：中途补充要求、方向修正
- bg_task_chat: 与已完成任务的子 Agent 继续对话。用于：用户有后续问题、想在之前工作基础上继续

子 Agent 生命周期：
- 子 Agent 完成后会保留 30 分钟供继续对话（通过 bg_task_chat）
- 每次对话会重置 30 分钟计时器
- 超时后 Agent 自动销毁，需用 bg_task_run 重新派发

任务优先级：
- bg_task_run 支持 priority 参数：high / normal / low
- 高优先级任务在并发槽位紧张时优先执行

资源限制：
- bg_task_run 支持 limits 参数：maxToolCalls（工具调用次数）、maxSteps（交互轮次）、idleTimeoutMs（空闲超时）
- 超限的任务会被自动中断并标记为失败
- 默认空闲超时 120 秒 — 子 Agent 连续 120 秒无任何输出将被中断

控制策略：
- 如果某个子任务长时间无进展（通过 bg_task_status 查看 lastActivityAgo），果断 cancel 并 retry
- 如果结果质量不达标，使用 redo 附加具体反馈，而非从零重新开始
- 使用 message 进行中途修正，避免不必要的 cancel

其他规则：
- 简单问答直接回复，不需要调用子 Agent（你兼任闲聊助手）
- 敏感操作（删除、发送邮件等）子 Agent 会自动请求用户确认
- 回复使用用户的语言`,
    tools: ['bg_task_run', 'bg_task_status', 'bg_task_cancel', 'bg_task_retry', 'bg_task_redo', 'bg_task_message', 'bg_task_chat', 'todo_read', 'todo_write'],
    model: undefined,
    runtime: {
      todo: { enabled: true },
    },
    permission: {
      mode: 'auto',
    },
  };
}

export interface CreateOrchestratorOptions {
  sdkStore: PostgresStore;
  provider: ModelProvider;
  sandbox: Sandbox;
  templateRegistry: AgentTemplateRegistry;
  skillLoader: SkillLoader;
  memoryManager: MemoryManager;
}

export async function createOrchestrator(opts: CreateOrchestratorOptions): Promise<Agent> {
  const { sdkStore, provider, sandbox, templateRegistry, skillLoader, memoryManager } = opts;

  // bg_task_run / bg_task_status tools are registered externally (in index.ts)
  // because they need the BgTaskRunner instance

  // Build template with skill summary
  const template = buildOrchestratorTemplate(skillLoader.getSummary());
  templateRegistry.register(template);

  // Create sandbox factory for deps
  const sandboxFactory = new SandboxFactory();

  // Create agent
  const deps = {
    store: sdkStore,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory,
  };

  const agent = await Agent.create(
    {
      templateId: 'orchestrator',
      model: provider,
      sandbox,
    },
    deps,
  );

  logger.info('main-agent', 'Orchestrator agent created');
  return agent;
}
