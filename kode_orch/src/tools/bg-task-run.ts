import { tool } from '@shareai-lab/kode-sdk';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { BgTaskRunner } from '../orchestrator/bg-task-runner.js';
import type { TaskPriority, ResourceLimits } from '../orchestrator/bg-task-runner.js';
import type { SkillLoader } from '../orchestrator/skill-loader.js';
import { logger } from '../utils/logger.js';

export interface SubAgentTemplate {
  id: string;
  system: string;
  tools: string[];
  whenToUse: string;
}

export function registerBgTaskTools(
  runner: BgTaskRunner,
  templates: SubAgentTemplate[],
  skillLoader: SkillLoader,
): void {
  const templateList = templates
    .map((tpl) => `- agentTemplateId: ${tpl.id}\n  用途: ${tpl.whenToUse}`)
    .join('\n');

  const skillList = skillLoader
    .getAll()
    .map((s) => `- ${s.category}/${s.name}`)
    .join('\n');

  // ===== bg_task_run =====
  tool({
    name: 'bg_task_run',
    description: `异步派发子 Agent 执行任务（立即返回，后台执行）。

使用方法：
- 提供 description（简短描述）、prompt（详细指令）、agentTemplateId（子 Agent 类型）
- 如果任务涉及某个 Skill，务必传 skills 数组，系统会自动加载完整 Skill 指南和资源路径给子 Agent
- 复杂任务可同时传多个 Skill（如同时需要 web 开发和测试能力）
- 支持 priority 参数控制优先级（high/normal/low）
- 支持 limits 参数控制资源限制（maxToolCalls/maxSteps/idleTimeoutMs）
- 工具立即返回 taskId，子 Agent 在后台执行
- 完成后系统自动通知

可用子 Agent：
${templateList}

可用 Skill（传 skillName 时使用 name 部分）：
${skillList}`,
    parameters: z.object({
      description: z.string().describe('任务简短描述（3-5字）'),
      prompt: z.string().describe('给子 Agent 的详细指令'),
      agentTemplateId: z.string().describe('子 Agent 模板 ID'),
      skillName: z.string().optional().describe('[已弃用，请用 skills] 单个 Skill 名称'),
      skills: z.union([z.array(z.string()), z.string()]).optional().describe('要使用的 Skill 名称列表（数组）或单个名称（字符串）'),
      context: z.string().optional().describe('额外上下文'),
      priority: z.enum(['high', 'normal', 'low']).optional().describe('任务优先级，默认 normal'),
      limits: z.object({
        maxToolCalls: z.number().optional().describe('工具调用次数上限'),
        maxSteps: z.number().optional().describe('模型交互轮次上限'),
        idleTimeoutMs: z.number().optional().describe('空闲超时毫秒数'),
      }).optional().describe('资源限制'),
    }),
    async execute(args) {
      const { description, prompt, agentTemplateId, skillName, skills, context, priority, limits } = args;
      const tpl = templates.find((t) => t.id === agentTemplateId);
      if (!tpl) {
        return {
          ok: false,
          error: `未找到模板 '${agentTemplateId}'，可用：${templates.map((t) => t.id).join(', ')}`,
        };
      }

      // Merge skills list (normalize string to array, handle JSON-stringified arrays)
      const skillNames: string[] = [];
      let rawSkills: string[] | undefined;
      if (typeof skills === 'string') {
        // LLM might pass '["a","b"]' as a string — try JSON parse first
        try {
          const parsed = JSON.parse(skills);
          rawSkills = Array.isArray(parsed) ? parsed : [skills];
        } catch {
          rawSkills = [skills];
        }
      } else {
        rawSkills = skills;
      }
      if (rawSkills && rawSkills.length > 0) {
        skillNames.push(...rawSkills);
      } else if (skillName) {
        skillNames.push(skillName);
      }

      // Load all requested skills
      const skillSections: string[] = [];
      for (const name of skillNames) {
        try {
          const skillContent = await skillLoader.loadFull(name);
          const skillMeta = skillLoader.getSkillMeta(name);
          const skillDirAbsPath = skillMeta ? resolve(skillMeta.dirPath) : '';
          const resolvedName = skillMeta?.name ?? name;
          skillSections.push([
            `# Skill 指南: ${resolvedName}`,
            skillContent,
            skillDirAbsPath
              ? `\n## Skill 资源目录\n该 Skill 的配套脚本和资源文件位于: ${skillDirAbsPath}\n你可以用 fs_read 读取其中的文件，或用 bash_run 执行其中的脚本。`
              : '',
          ].join('\n'));
          logger.info('bg-task-run', `Loaded skill '${name}' -> '${resolvedName}' for task`, {
            agentTemplateId,
            skillDir: skillDirAbsPath,
          });
        } catch (err) {
          logger.warn('bg-task-run', `Failed to load skill '${name}'`, err);
          skillSections.push(`# 注意\n指定的 Skill '${name}' 加载失败，请依靠你自己的知识完成该部分。`);
        }
      }

      const fullPrompt = [
        `# Task: ${description}`,
        prompt,
        skillSections.length > 0 ? skillSections.join('\n\n---\n\n') : undefined,
        context ? `\n# Additional Context\n${context}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');

      // 调试：打印完整 prompt 长度和前 500 字符
      logger.info('bg-task-run', `Full prompt length: ${fullPrompt.length}`, {
        preview: fullPrompt.slice(0, 500),
      });

      const taskId = runner.start(agentTemplateId, fullPrompt, description, {
        priority: priority as TaskPriority | undefined,
        limits: limits as ResourceLimits | undefined,
        skills: skillNames.length > 0 ? skillNames : undefined,
      });
      return {
        taskId,
        status: 'dispatched',
        agentTemplateId,
        priority: priority ?? 'normal',
        skills: skillNames.length > 0 ? skillNames : undefined,
        message: `任务已派发给 ${agentTemplateId}${skillNames.length > 0 ? `（使用 Skill: ${skillNames.join(', ')}）` : ''}，ID: ${taskId}`,
      };
    },
    metadata: { readonly: false, version: '1.0' },
  });

  // ===== bg_task_status =====
  tool({
    name: 'bg_task_status',
    description: '查询后台任务状态。不传 taskId 则返回所有任务。返回包含优先级、资源使用、最后活跃时间等详细信息。',
    parameters: z.object({
      taskId: z.string().optional().describe('要查询的任务 ID，不传则返回全部'),
    }),
    async execute(args) {
      const formatTask = (t: any) => ({
        id: t.id,
        templateId: t.templateId,
        description: t.description,
        status: t.status,
        priority: t.priority,
        elapsed: Date.now() - t.startTime,
        retryCount: t.retryCount,
        resourceUsage: t.resourceUsage,
        resourceLimits: t.resourceLimits,
        lastActivityTime: t.lastActivityTime,
        lastActivityAgo: Date.now() - t.lastActivityTime,
        result: t.result,
        error: t.error,
        cancelReason: t.cancelReason,
        sandboxUrl: t.sandboxUrl,
        sandboxAlive: t.sandboxAlive,
        agentAlive: t.agentAlive, // 子 Agent 是否还存活（可继续对话）
      });

      if (args.taskId) {
        const task = runner.getTask(args.taskId);
        if (!task) return { ok: false, error: `任务 ${args.taskId} 不存在` };
        return formatTask(task);
      }
      return runner.getAllTasks().map(formatTask);
    },
    metadata: { readonly: true, version: '1.0' },
  });

  // ===== bg_task_cancel =====
  tool({
    name: 'bg_task_cancel',
    description: '取消正在运行或排队中的任务。用于：任务不再需要、子 Agent 似乎卡住、需求变更。',
    parameters: z.object({
      taskId: z.string().describe('要取消的任务 ID'),
      reason: z.string().optional().describe('取消原因'),
    }),
    async execute(args) {
      const ok = await runner.cancel(args.taskId, args.reason);
      if (!ok) {
        const task = runner.getTask(args.taskId);
        if (!task) return { ok: false, error: `任务 ${args.taskId} 不存在` };
        return { ok: false, error: `任务状态为 ${task.status}，无法取消` };
      }
      return { ok: true, taskId: args.taskId, status: 'cancelled', reason: args.reason };
    },
    metadata: { readonly: false, version: '1.0' },
  });

  // ===== bg_task_retry =====
  tool({
    name: 'bg_task_retry',
    description: '重试失败或已取消的任务。复用原始参数，可选修改指令。返回新任务 ID。',
    parameters: z.object({
      taskId: z.string().describe('要重试的任务 ID（必须是 failed 或 cancelled 状态）'),
      modifiedPrompt: z.string().optional().describe('修改后的指令（不传则复用原始指令）'),
    }),
    async execute(args) {
      const task = runner.getTask(args.taskId);
      if (!task) return { ok: false, error: `任务 ${args.taskId} 不存在` };
      if (task.status !== 'failed' && task.status !== 'cancelled') {
        return { ok: false, error: `只能重试 failed/cancelled 任务，当前状态: ${task.status}` };
      }

      const newPrompt = args.modifiedPrompt ?? task.prompt;
      const newDescription = `${task.description} (retry #${task.retryCount + 1})`;
      const newTaskId = runner.start(task.templateId, newPrompt, newDescription, {
        priority: task.priority,
        limits: task.resourceLimits,
        skills: task.skills,
        retryCount: task.retryCount + 1,
        redoHistory: task.redoHistory,
      });

      return {
        ok: true,
        originalTaskId: args.taskId,
        newTaskId,
        retryCount: task.retryCount + 1,
        message: `任务已重试，新 ID: ${newTaskId}`,
      };
    },
    metadata: { readonly: false, version: '1.0' },
  });

  // ===== bg_task_redo =====
  tool({
    name: 'bg_task_redo',
    description: '打回已完成任务的结果，附加反馈重新执行。用于结果质量不达标时。返回新任务 ID。',
    parameters: z.object({
      taskId: z.string().describe('要打回的任务 ID（必须是 completed 状态）'),
      feedback: z.string().describe('具体反馈：为什么结果不满意、需要如何改进'),
    }),
    async execute(args) {
      const task = runner.getTask(args.taskId);
      if (!task) return { ok: false, error: `任务 ${args.taskId} 不存在` };
      if (task.status !== 'completed') {
        return { ok: false, error: `只能打回 completed 任务，当前状态: ${task.status}` };
      }

      const previousResult = task.result?.slice(0, 2000) ?? '(无结果)';
      const redoPrompt = [
        task.prompt,
        '',
        '# 上一次结果被打回',
        `反馈: ${args.feedback}`,
        `上次输出:`,
        previousResult,
        '',
        '请根据反馈重做，确保改进上述问题。',
      ].join('\n');

      const newRedoHistory = [...task.redoHistory, args.feedback];
      const newDescription = `${task.description} (redo #${newRedoHistory.length})`;
      const newTaskId = runner.start(task.templateId, redoPrompt, newDescription, {
        priority: task.priority,
        limits: task.resourceLimits,
        skills: task.skills,
        retryCount: task.retryCount,
        redoHistory: newRedoHistory,
      });

      return {
        ok: true,
        originalTaskId: args.taskId,
        newTaskId,
        redoCount: newRedoHistory.length,
        message: `任务已打回重做，新 ID: ${newTaskId}`,
      };
    },
    metadata: { readonly: false, version: '1.0' },
  });

  // ===== bg_task_message =====
  tool({
    name: 'bg_task_message',
    description: '向运行中的子 Agent 追加指令。用于中途补充要求、方向修正，无需取消重来。',
    parameters: z.object({
      taskId: z.string().describe('运行中的任务 ID'),
      instruction: z.string().describe('要追加的指令'),
    }),
    async execute(args) {
      const ok = await runner.sendMessage(args.taskId, args.instruction);
      if (!ok) {
        const task = runner.getTask(args.taskId);
        if (!task) return { ok: false, error: `任务 ${args.taskId} 不存在` };
        return { ok: false, error: `任务状态为 ${task.status}，无法发送消息（仅 running 状态可发送）` };
      }
      return { ok: true, taskId: args.taskId, message: '指令已发送给子 Agent' };
    },
    metadata: { readonly: false, version: '1.0' },
  });

  // ===== bg_task_chat =====
  tool({
    name: 'bg_task_chat',
    description: `与已完成任务的子 Agent 继续对话（异步模式）。

使用场景：
- 任务完成后，用户有后续问题想问子 Agent
- 用户想让子 Agent 在之前工作的基础上继续做些调整
- 需要保留之前对话的上下文继续交流

特点：
- 子 Agent 保留完整的对话历史和上下文
- 如果有沙箱环境，文件和服务都还在
- 子 Agent 完成后会保留 30 分钟供继续对话
- 每次对话会重置 30 分钟计时器
- 异步执行：消息发送后立即返回，子 Agent 回复后系统自动通知你

与其他工具的区别：
- bg_task_message: 只能对 running 状态的任务追加指令（任务还在执行中）
- bg_task_redo: 打回重做整个任务（丢弃之前的对话）
- bg_task_chat: 与已完成的子 Agent 继续对话（保留对话历史）

注意：子 Agent 完成后 30 分钟内可继续对话，超时后需用 bg_task_run 重新派发。`,
    parameters: z.object({
      taskId: z.string().describe('已完成任务的 ID（必须是 completed 状态且 agentAlive=true）'),
      message: z.string().describe('要发送给子 Agent 的消息'),
    }),
    async execute(args) {
      const result = runner.chatAsync(args.taskId, args.message);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      return {
        ok: true,
        taskId: args.taskId,
        status: 'dispatched',
        message: '消息已发送给子 Agent，完成后系统会自动通知你',
      };
    },
    metadata: { readonly: false, version: '1.0' },
  });
}
