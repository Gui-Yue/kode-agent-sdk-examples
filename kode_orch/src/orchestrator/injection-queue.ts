import type { Agent } from '@shareai-lab/kode-sdk';
import type { SSEManager } from '../server/sse.js';
import type { ChatLock } from './chat-lock.js';
import { logger } from '../utils/logger.js';

const MAX_RESULT_LENGTH = 4000;

interface InjectionItem {
  message: string;
  metadata: { taskId: string; type: 'task_result' | 'task_failed' | 'task_cancelled' | 'chat_result' | 'chat_failed' };
}

export class InjectionQueue {
  private queue: InjectionItem[] = [];
  private processing = false;

  constructor(
    private agent: Agent,
    private sseManager: SSEManager,
    private chatLock: ChatLock,
  ) {}

  enqueue(item: InjectionItem): void {
    this.queue.push(item);
    logger.info('injection-queue', 'Enqueued result', { taskId: item.metadata.taskId });
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.chatLock.acquire();
        await this.injectAndStream(item);
      } catch (err) {
        logger.error('injection-queue', 'Injection failed', err);
      } finally {
        this.chatLock.release();
      }
    }

    this.processing = false;
  }

  private async injectAndStream(item: InjectionItem): Promise<void> {
    this.sseManager.send({
      type: 'orchestrator_start',
      data: { taskId: item.metadata.taskId, reason: item.metadata.type },
    });

    let fullText = '';

    for await (const envelope of this.agent.chatStream(item.message)) {
      const event = envelope.event as any;
      switch (event.type) {
        case 'text_chunk':
          fullText += event.delta;
          this.sseManager.send({
            type: 'orchestrator_text',
            data: { delta: event.delta },
          });
          break;
        case 'tool:start':
          this.sseManager.send({
            type: 'tool_start',
            data: {
              name: event.call?.name,
              toolCallId: event.call?.id,
              input: event.call?.inputPreview,
              source: 'orchestrator_auto',
            },
          });
          break;
        case 'tool:end':
          this.sseManager.send({
            type: 'tool_end',
            data: {
              name: event.call?.name,
              toolCallId: event.call?.id,
              result: event.call?.result,
              durationMs: event.call?.durationMs,
              source: 'orchestrator_auto',
            },
          });
          break;
        case 'done':
          this.sseManager.send({
            type: 'orchestrator_done',
            data: { reason: 'completed', fullText },
          });
          break;
      }
    }
  }

  /**
   * Build the injection message from a completed/failed task.
   */
  static buildMessage(task: {
    id: string;
    templateId: string;
    description: string;
    status: string;
    result?: string;
    error?: string;
    cancelReason?: string;
  }): string {
    if (task.status === 'completed') {
      let result = task.result || '(无输出)';
      if (result.length > MAX_RESULT_LENGTH) {
        result = result.slice(0, MAX_RESULT_LENGTH) + '\n\n[内容已截断，完整结果可通过 bg_task_status 查看]';
      }
      return `[子任务完成] taskId=${task.id}, agent=${task.templateId}\n` +
        `描述: ${task.description}\n` +
        `交付物:\n${result}`;
    }
    if (task.status === 'cancelled') {
      return `[子任务已取消] taskId=${task.id}, agent=${task.templateId}\n` +
        `描述: ${task.description}\n` +
        `原因: ${task.cancelReason || '由编排器取消'}`;
    }
    return `[子任务失败] taskId=${task.id}, agent=${task.templateId}\n` +
      `描述: ${task.description}\n` +
      `错误: ${task.error || '未知错误'}`;
  }

  /**
   * Build the injection message for a chat (continued conversation) result.
   */
  static buildChatMessage(task: {
    id: string;
    templateId: string;
    description: string;
  }, response?: string, error?: string): string {
    if (error) {
      return `[子任务对话失败] taskId=${task.id}, agent=${task.templateId}\n` +
        `描述: ${task.description}\n` +
        `错误: ${error}`;
    }
    let result = response || '(无输出)';
    if (result.length > MAX_RESULT_LENGTH) {
      result = result.slice(0, MAX_RESULT_LENGTH) + '\n\n[内容已截断，完整结果可通过 bg_task_status 查看]';
    }
    return `[子任务对话回复] taskId=${task.id}, agent=${task.templateId}\n` +
      `描述: ${task.description}\n` +
      `回复:\n${result}`;
  }
}
