import { MemoryManager } from './memory-manager.js';
import { logger } from '../utils/logger.js';

export interface TaskManagerLike {
  updateContext(taskId: string, context: string): void;
  getActiveTasks(): Array<{ id: string }>;
}

export interface Message {
  role: string;
  content: string;
}

interface ExtractionResult {
  preferences: Array<{ key: string; value: string }>;
  summary: string;
  taskContexts: Array<{ taskId: string; context: string }>;
}

export class CompactionHandler {
  constructor(
    private memoryManager: MemoryManager,
    private taskManager: TaskManagerLike,
  ) {}

  async onBeforeCompaction(messages: Message[]): Promise<void> {
    logger.info('compaction', `Extracting key info from ${messages.length} messages before compaction`);
    try {
      const extraction = await this.extractKeyInfo(messages);

      // 1. User preferences → SQLite
      for (const pref of extraction.preferences) {
        await this.memoryManager.userProfile.set(pref.key, pref.value);
      }

      // 2. Conversation summary → Vector store (optional)
      if (extraction.summary) {
        await this.memoryManager.memorize(extraction.summary, 'conversation_summary');
      }

      // 3. Active task context → TaskManager
      for (const taskCtx of extraction.taskContexts) {
        this.taskManager.updateContext(taskCtx.taskId, taskCtx.context);
      }

      logger.info('compaction', 'Pre-compaction extraction complete', {
        preferences: extraction.preferences.length,
        hasSummary: !!extraction.summary,
        taskContexts: extraction.taskContexts.length,
      });
    } catch (err) {
      logger.error('compaction', 'Failed to extract before compaction, skipping', err);
    }
  }

  async onAfterCompaction(summary: string): Promise<void> {
    logger.info('compaction', 'Storing post-compaction summary');
    try {
      await this.memoryManager.memorize(summary, 'conversation_summary');
    } catch (err) {
      logger.error('compaction', 'Failed to store compaction summary', err);
    }
  }

  private async extractKeyInfo(messages: Message[]): Promise<ExtractionResult> {
    // Simple heuristic extraction (no LLM call for MVP simplicity)
    // In production, this would use an LLM to extract structured info
    const preferences: ExtractionResult['preferences'] = [];
    const taskContexts: ExtractionResult['taskContexts'] = [];

    // Build a summary from user messages
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    const summary = userMessages.length > 500
      ? userMessages.slice(0, 500) + '...'
      : userMessages;

    // Extract simple preference patterns like "我喜欢..." or "请用..."
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const langMatch = msg.content.match(/请?用(中文|英文|日文)(?:回复|回答)/);
      if (langMatch) {
        preferences.push({ key: 'language', value: langMatch[1] });
      }
    }

    // Collect context for active tasks
    const activeTasks = this.taskManager.getActiveTasks();
    if (activeTasks.length > 0 && messages.length > 0) {
      const recentContext = messages.slice(-5).map((m) => `${m.role}: ${m.content}`).join('\n');
      for (const task of activeTasks) {
        taskContexts.push({ taskId: task.id, context: recentContext });
      }
    }

    return { preferences, summary, taskContexts };
  }
}
