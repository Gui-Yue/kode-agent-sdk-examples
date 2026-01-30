import { Agent, type AgentDependencies, type AgentConfig, type ModelProvider, type Sandbox, type CompleteResult } from '@shareai-lab/kode-sdk';
import type { AppSandboxFactory } from '../sandbox/factory.js';
import type { InjectionQueue } from './injection-queue.js';
import { setSandboxForAgent, removeSandboxForAgent } from '../tools/sandbox-preview.js';
import { generateId } from '../utils/id.js';
import { logger } from '../utils/logger.js';

export type TaskPriority = 'high' | 'normal' | 'low';

export interface ResourceLimits {
  maxToolCalls?: number;
  maxSteps?: number;
  idleTimeoutMs?: number;
}

export interface ResourceUsage {
  toolCalls: number;
  steps: number;
  totalTokens: number;
}

export interface BgTask {
  id: string;
  templateId: string;
  description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  result?: string;
  error?: string;
  sandboxUrl?: string;
  sandboxAlive?: boolean;
  agentAlive?: boolean; // 子 Agent 实例是否还存活（可继续对话）

  priority: TaskPriority;
  prompt: string;
  skills: string[];
  retryCount: number;
  redoHistory: string[];
  resourceLimits: ResourceLimits;
  resourceUsage: ResourceUsage;
  lastActivityTime: number;
  cancelReason?: string;
}

export interface BgTaskConfig {
  maxConcurrent: number;
  defaultIdleTimeoutMs: number;
  defaultMaxToolCalls: number;
  defaultMaxSteps: number;
}

interface QueuedTask {
  task: BgTask;
  prompt: string;
}

const SANDBOX_KEEP_ALIVE_MS = 30 * 60 * 1000;
const AGENT_KEEP_ALIVE_MS = 30 * 60 * 1000; // 子 Agent 完成后保留 30 分钟供继续对话
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export class BgTaskRunner {
  private tasks = new Map<string, BgTask>();
  private agents = new Map<string, Agent>();
  private sandboxes = new Map<string, Sandbox>();
  private disposeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private agentDisposeTimers = new Map<string, ReturnType<typeof setTimeout>>(); // Agent 实例超时销毁
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingMessages = new Map<string, string>();
  private pendingQueue: QueuedTask[] = [];
  private injectionQueue?: InjectionQueue;

  private readonly maxConcurrent: number;
  private readonly defaultIdleTimeoutMs: number;
  private readonly defaultMaxToolCalls: number;
  private readonly defaultMaxSteps: number;

  constructor(
    private deps: AgentDependencies,
    private provider: ModelProvider,
    private sandboxFactory: AppSandboxFactory,
    private onUpdate: (task: BgTask) => void,
    private onPermission?: (task: BgTask, event: any) => void,
    taskConfig?: BgTaskConfig,
  ) {
    this.maxConcurrent = taskConfig?.maxConcurrent ?? 5;
    this.defaultIdleTimeoutMs = taskConfig?.defaultIdleTimeoutMs ?? 120_000;
    this.defaultMaxToolCalls = taskConfig?.defaultMaxToolCalls ?? 200;
    this.defaultMaxSteps = taskConfig?.defaultMaxSteps ?? 50;
  }

  setInjectionQueue(queue: InjectionQueue): void {
    this.injectionQueue = queue;
  }

  start(
    templateId: string,
    prompt: string,
    description: string,
    opts?: { priority?: TaskPriority; limits?: ResourceLimits; skills?: string[]; retryCount?: number; redoHistory?: string[] },
  ): string {
    const id = generateId();
    const task: BgTask = {
      id,
      templateId,
      description,
      status: 'queued',
      startTime: Date.now(),
      priority: opts?.priority ?? 'normal',
      prompt,
      skills: opts?.skills ?? [],
      retryCount: opts?.retryCount ?? 0,
      redoHistory: opts?.redoHistory ?? [],
      resourceLimits: {
        maxToolCalls: opts?.limits?.maxToolCalls ?? this.defaultMaxToolCalls,
        maxSteps: opts?.limits?.maxSteps ?? this.defaultMaxSteps,
        idleTimeoutMs: opts?.limits?.idleTimeoutMs,
      },
      resourceUsage: { toolCalls: 0, steps: 0, totalTokens: 0 },
      lastActivityTime: Date.now(),
    };
    this.tasks.set(id, task);
    this.onUpdate(task);
    this.pendingQueue.push({ task, prompt });
    this.pendingQueue.sort((a, b) => PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority]);
    this.drainQueue();
    return id;
  }

  private drainQueue(): void {
    while (this.runningCount() < this.maxConcurrent && this.pendingQueue.length > 0) {
      const next = this.pendingQueue.shift()!;
      next.task.status = 'running';
      next.task.startTime = Date.now();
      next.task.lastActivityTime = Date.now();
      this.onUpdate(next.task);
      this.runInBackground(next.task, next.task.templateId, next.prompt);
    }
  }

  private runningCount(): number {
    let count = 0;
    for (const t of this.tasks.values()) {
      if (t.status === 'running') count++;
    }
    return count;
  }

  private async runInBackground(task: BgTask, templateId: string, prompt: string): Promise<void> {
    const sandbox = await this.sandboxFactory.create();
    await this.runWithSandbox(task, templateId, prompt, sandbox);
  }

  private async runWithSandbox(task: BgTask, templateId: string, prompt: string, sandbox: Sandbox): Promise<void> {
    let subAgent: Agent | undefined;
    const unsubs: Array<() => void> = [];

    // Prepend taskId context so sub-agent knows its own ID for sandbox_preview
    const promptWithContext = `# 任务上下文\n- taskId: ${task.id}\n- 如需调用 sandbox_preview 工具，请使用上述 taskId 作为 agentId 参数\n\n${prompt}`;

    try {
      logger.info('bg-task', `Starting sub-agent ${templateId}`, { taskId: task.id, priority: task.priority });

      setSandboxForAgent(task.id, sandbox);

      const config: AgentConfig = {
        templateId,
        agentId: task.id,
        model: this.provider,
        sandbox,
        metadata: { maxTokens: 16384 }, // 增大 maxTokens 以支持生成较大的代码文件
      };
      subAgent = await Agent.create(config, this.deps);
      this.agents.set(task.id, subAgent);

      // Permission listener (add to unsubs so it gets cleaned up after task completes)
      if (this.onPermission) {
        unsubs.push(subAgent.on('permission_required', (event: any) => {
          logger.info('bg-task', `Permission required for tool`, { taskId: task.id, tool: event.call?.name });
          this.onPermission!(task, event);
        }));
      }

      // Idle timeout + resource tracking
      const resetIdleTimer = () => {
        task.lastActivityTime = Date.now();
        const existing = this.idleTimers.get(task.id);
        if (existing) clearTimeout(existing);
        const timeout = task.resourceLimits.idleTimeoutMs ?? this.defaultIdleTimeoutMs;
        this.idleTimers.set(task.id, setTimeout(() => {
          this.handleIdleTimeout(task.id);
        }, timeout));
      };

      unsubs.push(subAgent.on('tool_executed', (evt: any) => {
        task.resourceUsage.toolCalls++;
        logger.info('bg-task', `Tool executed`, { taskId: task.id, tool: evt.call?.name, count: task.resourceUsage.toolCalls });
        resetIdleTimer();
        if (task.resourceLimits.maxToolCalls && task.resourceUsage.toolCalls >= task.resourceLimits.maxToolCalls) {
          this.handleResourceLimit(task.id, 'maxToolCalls');
        }
      }));

      unsubs.push(subAgent.on('step_complete', () => {
        task.resourceUsage.steps++;
        logger.info('bg-task', `Step complete`, { taskId: task.id, steps: task.resourceUsage.steps });
        resetIdleTimer();
        if (task.resourceLimits.maxSteps && task.resourceUsage.steps >= task.resourceLimits.maxSteps) {
          this.handleResourceLimit(task.id, 'maxSteps');
        }
      }));

      unsubs.push(subAgent.on('token_usage', (evt: any) => {
        task.resourceUsage.totalTokens += evt.totalTokens ?? 0;
        logger.info('bg-task', `Token usage`, { taskId: task.id, added: evt.totalTokens, total: task.resourceUsage.totalTokens });
        resetIdleTimer(); // 思考消耗 token 也算活动，重置 idle timer
      }));

      logger.info('bg-task', `Monitor events registered, starting complete()`, { taskId: task.id });
      resetIdleTimer();

      // Pause-loop execution
      let result: CompleteResult;
      let currentInput: string = promptWithContext;
      while (true) {
        result = await subAgent.complete(currentInput);
        if (result.status === 'ok') break;
        // status === 'paused'
        if (task.status === 'cancelled' || task.status === 'failed') break;
        if (this.pendingMessages.has(task.id)) {
          currentInput = this.pendingMessages.get(task.id)!;
          this.pendingMessages.delete(task.id);
          continue;
        }
        break; // timeout or resource limit
      }

      // Clear idle timer
      const idleTimer = this.idleTimers.get(task.id);
      if (idleTimer) { clearTimeout(idleTimer); this.idleTimers.delete(task.id); }

      // Only set completed if not already cancelled/failed
      if (task.status !== 'cancelled' && task.status !== 'failed') {
        task.status = 'completed';
        task.result = result!.text;

        // Check result text for [sandbox-preview](url) format
        // Only show sandbox preview if agent explicitly called sandbox_preview tool
        const urlMatch = result!.text?.match(/\[sandbox-preview\]\((https?:\/\/[^\s)]+)\)/);
        if (urlMatch && !urlMatch[1].includes('localhost')) {
          task.sandboxUrl = urlMatch[1];
        }
      }

      logger.info('bg-task', `Sub-agent finished`, { taskId: task.id, templateId, status: task.status });
    } catch (err) {
      if (task.status !== 'cancelled' && task.status !== 'failed') {
        task.status = 'failed';
        task.error = String(err);
      }
      logger.error('bg-task', `Sub-agent error`, { taskId: task.id, error: task.error ?? String(err) });
    } finally {
      // Unsubscribe all monitors
      for (const unsub of unsubs) { try { unsub(); } catch { /* ignore */ } }

      // Clear idle timer
      const idleTimer = this.idleTimers.get(task.id);
      if (idleTimer) { clearTimeout(idleTimer); this.idleTimers.delete(task.id); }

      // Keep agent alive for continued conversation (only for completed tasks)
      if (task.status === 'completed' && subAgent) {
        task.agentAlive = true;
        // Don't delete agent, set a timer to clean up later
        const agentTimer = setTimeout(() => { this.disposeAgent(task.id); }, AGENT_KEEP_ALIVE_MS);
        this.agentDisposeTimers.set(task.id, agentTimer);
        logger.info('bg-task', `Agent kept alive for continued conversation`, { taskId: task.id });
      } else {
        // Failed/cancelled tasks: clean up immediately
        this.agents.delete(task.id);
        task.agentAlive = false;
      }
      this.pendingMessages.delete(task.id);

      // Clean up sandbox registry (but keep sandbox reference in sandboxes map if needed)
      removeSandboxForAgent(task.id);

      // Sandbox lifecycle
      if (task.sandboxUrl && sandbox) {
        task.sandboxAlive = true;
        this.sandboxes.set(task.id, sandbox);
        const timer = setTimeout(() => { this.disposeSandbox(task.id); }, SANDBOX_KEEP_ALIVE_MS);
        this.disposeTimers.set(task.id, timer);
        logger.info('bg-task', `Sandbox kept alive for preview`, { taskId: task.id, url: task.sandboxUrl });
      } else if (sandbox) {
        try {
          await sandbox.dispose?.();
          logger.info('bg-task', `Sandbox disposed (task ${task.status})`, { taskId: task.id });
        } catch (err) {
          logger.warn('bg-task', `Sandbox dispose failed`, { taskId: task.id, error: String(err) });
        }
      }

      this.onUpdate(task);

      // Inject result into Orchestrator
      if (this.injectionQueue) {
        const { InjectionQueue } = await import('./injection-queue.js');
        this.injectionQueue.enqueue({
          message: InjectionQueue.buildMessage(task),
          metadata: {
            taskId: task.id,
            type: task.status === 'completed' ? 'task_result'
              : task.status === 'cancelled' ? 'task_cancelled'
              : 'task_failed',
          },
        });
      }

      // Drain queue (start next queued task)
      this.drainQueue();
    }
  }

  private handleIdleTimeout(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    const timeoutMs = task.resourceLimits.idleTimeoutMs ?? this.defaultIdleTimeoutMs;
    const timeoutSec = Math.round(timeoutMs / 1000);
    task.status = 'failed';
    task.error = `空闲超时：${timeoutSec}s 无任何输出`;

    // Notify frontend immediately
    this.onUpdate(task);

    const agent = this.agents.get(taskId);
    if (agent) {
      agent.interrupt({ note: `Idle timeout: no activity for ${timeoutSec}s` }).catch(() => {});
    }

    logger.warn('bg-task', `Idle timeout for task ${taskId}`, { timeoutSec });
  }

  private handleResourceLimit(taskId: string, limitType: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.status = 'failed';
    task.error = `资源超限：${limitType} (${limitType === 'maxToolCalls' ? task.resourceUsage.toolCalls : task.resourceUsage.steps}/${limitType === 'maxToolCalls' ? task.resourceLimits.maxToolCalls : task.resourceLimits.maxSteps})`;

    // Notify frontend immediately
    this.onUpdate(task);

    const agent = this.agents.get(taskId);
    if (agent) {
      agent.interrupt({ note: `Resource limit exceeded: ${limitType}` }).catch(() => {});
    }

    logger.warn('bg-task', `Resource limit ${limitType} for task ${taskId}`);
  }

  async cancel(taskId: string, reason?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'queued') {
      this.pendingQueue = this.pendingQueue.filter(q => q.task.id !== taskId);
      task.status = 'cancelled';
      task.cancelReason = reason;
      this.onUpdate(task);

      // Inject cancellation notice
      if (this.injectionQueue) {
        const { InjectionQueue } = await import('./injection-queue.js');
        this.injectionQueue.enqueue({
          message: InjectionQueue.buildMessage(task),
          metadata: { taskId: task.id, type: 'task_cancelled' },
        });
      }
      return true;
    }

    if (task.status !== 'running') return false;

    task.status = 'cancelled';
    task.cancelReason = reason;
    // Notify frontend immediately (don't wait for runInBackground to finish)
    this.onUpdate(task);

    const agent = this.agents.get(taskId);
    if (agent) {
      await agent.interrupt({ note: reason ?? 'Task cancelled by orchestrator' });
    }
    // runInBackground pause-loop will detect cancelled status and break
    return true;
  }

  async sendMessage(taskId: string, instruction: string): Promise<boolean> {
    const agent = this.agents.get(taskId);
    const task = this.tasks.get(taskId);
    if (!agent || !task || task.status !== 'running') return false;
    this.pendingMessages.set(taskId, instruction);
    await agent.interrupt({ note: instruction });
    return true;
  }

  async disposeSandbox(taskId: string): Promise<boolean> {
    const sandbox = this.sandboxes.get(taskId);
    if (!sandbox) return false;

    try { await sandbox.dispose?.(); } catch { /* ignore */ }
    this.sandboxes.delete(taskId);

    const timer = this.disposeTimers.get(taskId);
    if (timer) { clearTimeout(timer); this.disposeTimers.delete(taskId); }

    const task = this.tasks.get(taskId);
    if (task) {
      task.sandboxAlive = false;
      this.onUpdate(task);
    }

    logger.info('bg-task', `Sandbox disposed`, { taskId });
    return true;
  }

  /**
   * Dispose an agent instance (called by timer or manually).
   */
  disposeAgent(taskId: string): void {
    const agent = this.agents.get(taskId);
    if (!agent) return;

    this.agents.delete(taskId);

    const timer = this.agentDisposeTimers.get(taskId);
    if (timer) { clearTimeout(timer); this.agentDisposeTimers.delete(taskId); }

    const task = this.tasks.get(taskId);
    if (task) {
      task.agentAlive = false;
      this.onUpdate(task);
    }

    logger.info('bg-task', `Agent disposed`, { taskId });
  }

  /**
   * Continue conversation with a completed task's agent (async mode).
   * Returns immediately, result is sent via injection queue.
   */
  chatAsync(taskId: string, message: string): { ok: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { ok: false, error: `任务 ${taskId} 不存在` };
    }

    if (!task.agentAlive) {
      return { ok: false, error: `子 Agent 已销毁，无法继续对话` };
    }

    const agent = this.agents.get(taskId);
    if (!agent) {
      task.agentAlive = false;
      this.onUpdate(task);
      return { ok: false, error: `子 Agent 实例不存在` };
    }

    // Start chat in background (don't await)
    this.runChatInBackground(task, agent, message);

    return { ok: true };
  }

  private async runChatInBackground(task: BgTask, agent: Agent, message: string): Promise<void> {
    const taskId = task.id;

    // Mark task as running during chat
    const previousStatus = task.status;
    task.status = 'running';
    task.lastActivityTime = Date.now();
    this.onUpdate(task);

    // Reset the agent dispose timer (extend the keep-alive)
    const existingTimer = this.agentDisposeTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Re-register sandbox if still alive
    const sandbox = this.sandboxes.get(taskId);
    if (sandbox) {
      setSandboxForAgent(taskId, sandbox);
    }

    // Register listeners for this chat session
    const unsubs: Array<() => void> = [];

    if (this.onPermission) {
      unsubs.push(agent.on('permission_required', (event: any) => {
        logger.info('bg-task', `Permission required for tool (chat)`, { taskId, tool: event.call?.name });
        this.onPermission!(task, event);
      }));
    }

    unsubs.push(agent.on('token_usage', (evt: any) => {
      task.resourceUsage.totalTokens += evt.totalTokens ?? 0;
      logger.info('bg-task', `Token usage (chat)`, { taskId, added: evt.totalTokens, total: task.resourceUsage.totalTokens });
      task.lastActivityTime = Date.now();
    }));

    unsubs.push(agent.on('tool_executed', (evt: any) => {
      task.resourceUsage.toolCalls++;
      logger.info('bg-task', `Tool executed (chat)`, { taskId, tool: evt.call?.name, count: task.resourceUsage.toolCalls });
      task.lastActivityTime = Date.now();
    }));

    try {
      logger.info('bg-task', `Continuing conversation with agent (async)`, { taskId, messageLength: message.length, messagePreview: message.slice(0, 200) });

      const result = await agent.complete(message);

      // Update task result with latest response
      task.status = 'completed';
      task.result = result.text;
      task.lastActivityTime = Date.now();
      this.onUpdate(task);

      // Reset agent dispose timer
      const newTimer = setTimeout(() => { this.disposeAgent(taskId); }, AGENT_KEEP_ALIVE_MS);
      this.agentDisposeTimers.set(taskId, newTimer);

      logger.info('bg-task', `Agent chat completed (async)`, { taskId });

      // Inject result into Orchestrator via injection queue
      if (this.injectionQueue) {
        const { InjectionQueue } = await import('./injection-queue.js');
        this.injectionQueue.enqueue({
          message: InjectionQueue.buildChatMessage(task, result.text),
          metadata: {
            taskId: task.id,
            type: 'chat_result',
          },
        });
      }
    } catch (err) {
      // Restore previous status on error
      task.status = previousStatus;
      task.error = String(err);
      this.onUpdate(task);
      logger.error('bg-task', `Agent chat failed (async)`, { taskId, error: String(err) });

      // Inject error into Orchestrator
      if (this.injectionQueue) {
        const { InjectionQueue } = await import('./injection-queue.js');
        this.injectionQueue.enqueue({
          message: InjectionQueue.buildChatMessage(task, undefined, String(err)),
          metadata: {
            taskId: task.id,
            type: 'chat_failed',
          },
        });
      }
    } finally {
      // Unsubscribe all listeners
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }

      // Clean up sandbox registry after completion
      if (sandbox) {
        removeSandboxForAgent(taskId);
      }
    }
  }

  /**
   * Continue conversation with a completed task's agent.
   * Returns the agent's response.
   */
  async chat(taskId: string, message: string): Promise<{ ok: boolean; response?: string; error?: string }> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { ok: false, error: `任务 ${taskId} 不存在` };
    }

    if (!task.agentAlive) {
      return { ok: false, error: `子 Agent 已销毁，无法继续对话` };
    }

    const agent = this.agents.get(taskId);
    if (!agent) {
      task.agentAlive = false;
      this.onUpdate(task);
      return { ok: false, error: `子 Agent 实例不存在` };
    }

    // Mark task as running during chat
    const previousStatus = task.status;
    task.status = 'running';
    task.lastActivityTime = Date.now();
    this.onUpdate(task);

    // Reset the agent dispose timer (extend the keep-alive)
    const existingTimer = this.agentDisposeTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Re-register sandbox if still alive
    const sandbox = this.sandboxes.get(taskId);
    if (sandbox) {
      setSandboxForAgent(taskId, sandbox);
    }

    // Register listeners for this chat session
    const unsubs: Array<() => void> = [];

    if (this.onPermission) {
      unsubs.push(agent.on('permission_required', (event: any) => {
        logger.info('bg-task', `Permission required for tool (chat)`, { taskId, tool: event.call?.name });
        this.onPermission!(task, event);
      }));
    }

    unsubs.push(agent.on('token_usage', (evt: any) => {
      task.resourceUsage.totalTokens += evt.totalTokens ?? 0;
      logger.info('bg-task', `Token usage (chat)`, { taskId, added: evt.totalTokens, total: task.resourceUsage.totalTokens });
      task.lastActivityTime = Date.now();
    }));

    unsubs.push(agent.on('tool_executed', (evt: any) => {
      task.resourceUsage.toolCalls++;
      logger.info('bg-task', `Tool executed (chat)`, { taskId, tool: evt.call?.name, count: task.resourceUsage.toolCalls });
      task.lastActivityTime = Date.now();
    }));

    try {
      logger.info('bg-task', `Continuing conversation with agent`, { taskId, messageLength: message.length, messagePreview: message.slice(0, 200) });

      const result = await agent.complete(message);

      // Update task result with latest response
      task.status = 'completed';
      task.result = result.text;
      task.lastActivityTime = Date.now();
      this.onUpdate(task);

      // Reset agent dispose timer
      const newTimer = setTimeout(() => { this.disposeAgent(taskId); }, AGENT_KEEP_ALIVE_MS);
      this.agentDisposeTimers.set(taskId, newTimer);

      // Clean up sandbox registry after completion
      if (sandbox) {
        removeSandboxForAgent(taskId);
      }

      logger.info('bg-task', `Agent chat completed`, { taskId });

      return { ok: true, response: result.text };
    } catch (err) {
      // Restore previous status on error
      task.status = previousStatus;
      this.onUpdate(task);
      logger.error('bg-task', `Agent chat failed`, { taskId, error: String(err) });
      return { ok: false, error: String(err) };
    } finally {
      // Unsubscribe all listeners
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    }
  }

  getTask(id: string): BgTask | undefined {
    return this.tasks.get(id);
  }

  getActiveTasks(): BgTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'running');
  }

  getAllTasks(): BgTask[] {
    return [...this.tasks.values()];
  }

  getQueuedTasks(): BgTask[] {
    return [...this.tasks.values()].filter((t) => t.status === 'queued');
  }
}
