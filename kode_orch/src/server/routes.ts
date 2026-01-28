import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Agent, Store } from '@shareai-lab/kode-sdk';
import { SSEManager, type SSEEvent } from './sse.js';
import { parseCommand } from '../commands/parser.js';
import { ApprovalManager } from '../orchestrator/approval.js';
import { TaskManager } from '../orchestrator/task-manager.js';
import { ProgressTracker } from '../orchestrator/progress-tracker.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { BgTaskRunner } from '../orchestrator/bg-task-runner.js';
import type { ChatLock } from '../orchestrator/chat-lock.js';
import { logger } from '../utils/logger.js';

export interface RouteContext {
  agent: Agent;
  sdkStore: Store;
  sseManager: SSEManager;
  approvalManager: ApprovalManager;
  taskManager: TaskManager;
  progressTracker: ProgressTracker;
  memoryManager: MemoryManager;
  bgTaskRunner: BgTaskRunner;
  chatLock: ChatLock;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export async function handleChat(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const body = JSON.parse(await readBody(req));
  const message = body.message as string;
  if (!message) {
    jsonResponse(res, 400, { error: 'message is required' });
    return;
  }

  // Check if it's a slash command
  const cmd = parseCommand(message);
  if (cmd) {
    return handleCommandInternal(cmd.type, cmd.args, res, ctx);
  }

  // Set up SSE for this response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (event: SSEEvent) => {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    // Acquire ChatLock to prevent concurrent chatStream access
    await ctx.chatLock.acquire();

    // Recall memory context
    const memory = await ctx.memoryManager.recall(message);
    const memoryContext = ctx.memoryManager.formatContext(memory);

    // Inject memory into message
    const enrichedMessage = memoryContext
      ? `${message}\n\n[系统注入的上下文]\n${memoryContext}`
      : message;

    // Stream response (chatStream sends input + yields events + ends on completion)
    for await (const envelope of ctx.agent.chatStream(enrichedMessage)) {
      const event = envelope.event;
      const call = (event as any).call;
      switch (event.type) {
        case 'text_chunk':
          sendEvent({ type: 'text', data: { delta: (event as any).delta } });
          break;
        case 'think_chunk':
          sendEvent({ type: 'thinking', data: { delta: (event as any).delta } });
          break;
        case 'text_chunk_start':
          sendEvent({ type: 'phase', data: { phase: 'responding' } });
          break;
        case 'think_chunk_start':
          sendEvent({ type: 'phase', data: { phase: 'thinking' } });
          break;
        case 'tool:start':
          sendEvent({ type: 'tool_start', data: {
            name: call?.name,
            toolCallId: call?.id,
            input: call?.inputPreview,
            isSubAgent: call?.name === 'task_run',
            subAgentId: call?.name === 'task_run' ? extractSubAgentId(call?.inputPreview) : undefined,
          }});
          break;
        case 'tool:end':
          sendEvent({ type: 'tool_end', data: {
            name: call?.name,
            toolCallId: call?.id,
            result: call?.result,
            durationMs: call?.durationMs,
            isSubAgent: call?.name === 'task_run',
          }});
          break;
        case 'tool:error':
          sendEvent({ type: 'tool_error', data: {
            name: call?.name,
            toolCallId: call?.id,
            error: (event as any).error,
            isSubAgent: call?.name === 'task_run',
          }});
          break;
        case 'done':
          sendEvent({ type: 'done', data: { reason: (event as any).reason ?? 'completed' } });
          break;
      }
    }
  } catch (err) {
    logger.error('routes', 'Chat error', err);
    sendEvent({ type: 'error', data: { message: String(err) } });
  } finally {
    ctx.chatLock.release();
    if (!res.destroyed) res.end();
  }
}

function handleCommandInternal(
  type: string,
  args: string[],
  res: ServerResponse,
  ctx: RouteContext,
): void {
  switch (type) {
    case 'confirm': {
      const permissionId = args[0];
      if (!permissionId) { jsonResponse(res, 400, { error: 'permissionId required' }); return; }
      ctx.approvalManager.decide(permissionId, 'allow').then((ok) => {
        if (!ok) { jsonResponse(res, 404, { error: 'no pending approval' }); return; }
        jsonResponse(res, 200, { status: 'confirmed', permissionId });
      }).catch(() => {
        jsonResponse(res, 500, { error: 'decide failed' });
      });
      break;
    }
    case 'cancel': {
      const permissionId = args[0];
      if (!permissionId) { jsonResponse(res, 400, { error: 'permissionId required' }); return; }
      ctx.approvalManager.decide(permissionId, 'deny').then((ok) => {
        jsonResponse(res, 200, { status: ok ? 'denied' : 'not_found', permissionId });
      }).catch(() => {
        jsonResponse(res, 500, { error: 'decide failed' });
      });
      break;
    }
    case 'status': {
      const active = ctx.taskManager.getActiveTasks();
      const progress = ctx.progressTracker.getAll();
      const pending = ctx.approvalManager.getPending();
      jsonResponse(res, 200, { activeTasks: active, progress, pendingApprovals: pending });
      break;
    }
    case 'history': {
      const limit = parseInt(args[0] || '10', 10);
      // TaskHistory accessed via TaskManager is indirect; use memoryManager for now
      jsonResponse(res, 200, { message: 'history endpoint', limit });
      break;
    }
    case 'help':
      jsonResponse(res, 200, {
        commands: [
          '/confirm <taskId> - 确认敏感操作',
          '/cancel <taskId> - 取消任务',
          '/status - 查看当前任务状态',
          '/history [n] - 查看最近 n 条历史',
          '/help - 显示帮助',
        ],
      });
      break;
    default:
      jsonResponse(res, 400, { error: `Unknown command: ${type}` });
  }
}

export async function handleCommand(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  const body = JSON.parse(await readBody(req));
  const command = body.command as string;
  if (!command) { jsonResponse(res, 400, { error: 'command required' }); return; }
  const parsed = parseCommand(command);
  if (!parsed) { jsonResponse(res, 400, { error: 'invalid command' }); return; }
  handleCommandInternal(parsed.type, parsed.args, res, ctx);
}

export function handleStatus(_req: IncomingMessage, res: ServerResponse, ctx: RouteContext): void {
  const active = ctx.taskManager.getActiveTasks();
  const progress = ctx.progressTracker.getAll();
  const pending = ctx.approvalManager.getPending();
  jsonResponse(res, 200, { activeTasks: active, progress, pendingApprovals: pending });
}

export async function handleHistory(_req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  try {
    const messages = await ctx.sdkStore.loadMessages(ctx.agent.agentId);
    // 只返回 user 和 assistant 的文本消息
    const history = messages
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .map((m: any) => {
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
        }
        return { role: m.role, content: text };
      })
      .filter((m: any) => m.content);
    jsonResponse(res, 200, { history });
  } catch (err) {
    logger.error('routes', 'Failed to load history', err);
    jsonResponse(res, 500, { error: 'Failed to load history' });
  }
}

export async function handleApproval(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { permissionId, decision, note } = body;
    if (!permissionId || !decision || (decision !== 'allow' && decision !== 'deny')) {
      jsonResponse(res, 400, { error: 'permissionId and decision (allow|deny) required' });
      return;
    }
    const ok = await ctx.approvalManager.decide(permissionId, decision, note);
    jsonResponse(res, ok ? 200 : 404, ok ? { status: 'decided', decision } : { error: 'approval not found' });
  } catch (err) {
    logger.error('routes', 'Approval error', err);
    jsonResponse(res, 500, { error: 'Internal error' });
  }
}

export async function handleSandboxDispose(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req));
    const { taskId } = body;
    if (!taskId) { jsonResponse(res, 400, { error: 'taskId required' }); return; }
    const ok = await ctx.bgTaskRunner.disposeSandbox(taskId);
    jsonResponse(res, ok ? 200 : 404, ok ? { status: 'disposed' } : { error: 'no active sandbox' });
  } catch (err) {
    logger.error('routes', 'Sandbox dispose error', err);
    jsonResponse(res, 500, { error: 'Internal error' });
  }
}

export async function handleBgTasksList(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  try {
    const tasks = ctx.bgTaskRunner.getAllTasks().map((t) => ({
      taskId: t.id,
      templateId: t.templateId,
      description: t.description,
      status: t.status,
      priority: t.priority,
      startTime: t.startTime,
      elapsed: Date.now() - t.startTime,
      result: t.result,
      error: t.error,
      cancelReason: t.cancelReason,
      sandboxUrl: t.sandboxUrl,
      sandboxAlive: t.sandboxAlive,
      agentAlive: t.agentAlive,
      resourceUsage: t.resourceUsage,
    }));
    jsonResponse(res, 200, { tasks });
  } catch (err) {
    logger.error('routes', 'BgTasks list error', err);
    jsonResponse(res, 500, { error: 'Internal error' });
  }
}

function extractSubAgentId(inputPreview: unknown): string | undefined {
  if (!inputPreview || typeof inputPreview !== 'object') return undefined;
  const preview = inputPreview as Record<string, unknown>;
  return (preview.templateId ?? preview.agentId ?? preview.agent) as string | undefined;
}
