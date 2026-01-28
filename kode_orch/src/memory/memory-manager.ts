import { UserProfile } from './user-profile.js';
import { TaskHistory, type Task } from './task-history.js';
import { VectorStore, createVectorDocument, type VectorDocument } from './vector-store.js';
import { logger } from '../utils/logger.js';

const MEMORY_CONTEXT_LIMIT = 4000; // tokens (approximate: 1 token ≈ 4 chars)
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = MEMORY_CONTEXT_LIMIT * CHARS_PER_TOKEN;

export interface MemoryContext {
  preferences: Record<string, string>;
  recentTasks: Task[];
  semanticMemories: VectorDocument[];
}

export class MemoryManager {
  constructor(
    public readonly userProfile: UserProfile,
    private taskHistory: TaskHistory,
    private vectorStore: VectorStore | null,
  ) {}

  async recall(query: string): Promise<MemoryContext> {
    const [preferences, recentTasks] = await Promise.all([
      this.userProfile.getAll(),
      this.taskHistory.getRecent(5),
    ]);

    const semanticMemories = this.vectorStore
      ? await this.vectorStore.query(query, 5)
      : [];

    return { preferences, recentTasks, semanticMemories };
  }

  async memorize(content: string, type: VectorDocument['metadata']['type']): Promise<void> {
    if (!this.vectorStore) {
      logger.debug('memory-manager', 'Vector store not available, skipping memorize');
      return;
    }
    const doc = createVectorDocument(content, type);
    await this.vectorStore.add([doc]);
  }

  formatContext(memory: MemoryContext): string {
    let context = '';
    let remaining = MAX_CHARS;

    // Priority 1: User preferences (always include)
    const prefSection = formatPreferences(memory.preferences);
    context += prefSection;
    remaining -= prefSection.length;

    // Priority 2: Semantic memories (most relevant)
    if (remaining > 0 && memory.semanticMemories.length > 0) {
      const memSection = formatSemanticMemories(memory.semanticMemories);
      if (memSection.length <= remaining) {
        context += memSection;
        remaining -= memSection.length;
      } else {
        context += memSection.slice(0, remaining);
        remaining = 0;
      }
    }

    // Priority 3: Recent tasks (fill remaining space)
    if (remaining > 0 && memory.recentTasks.length > 0) {
      const taskSection = formatRecentTasks(memory.recentTasks);
      if (taskSection.length <= remaining) {
        context += taskSection;
      } else {
        context += taskSection.slice(0, remaining);
      }
    }

    return context;
  }
}

function formatPreferences(prefs: Record<string, string>): string {
  const entries = Object.entries(prefs);
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `- ${k}: ${v}`);
  return `\n[用户偏好]\n${lines.join('\n')}\n`;
}

function formatSemanticMemories(memories: VectorDocument[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `- ${m.content}`);
  return `\n[相关记忆]\n${lines.join('\n')}\n`;
}

function formatRecentTasks(tasks: Task[]): string {
  if (tasks.length === 0) return '';
  const lines = tasks.map(
    (t) => `- [${t.status}] ${t.intent}${t.result ? ` → ${t.result.slice(0, 100)}` : ''}`,
  );
  return `\n[近期任务]\n${lines.join('\n')}\n`;
}
