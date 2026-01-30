/**
 * Memory Agent - 记忆管理工具
 *
 * 使用 defineTool 创建记忆管理工具：
 * - memory_save: 保存关键信息到持久存储
 * - memory_search: 按关键词搜索记忆
 * - memory_list: 列出所有记忆条目
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool, type ToolInstance, type EnhancedToolContext } from '@shareai-lab/kode-sdk';

// ============== 类型定义 ==============

export type MemoryType = 'preference' | 'fact' | 'todo' | 'context' | 'other';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface MemoryStore {
  entries: MemoryEntry[];
  version: number;
}

// ============== 记忆存储管理 ==============

const MEMORY_FILE = 'memories.json';
let memoryCache: MemoryStore | null = null;

async function getMemoryPath(ctx: EnhancedToolContext): Promise<string> {
  // 从 sandbox 工作目录获取路径，或使用默认路径
  const workDir = (ctx as any).sandbox?.workDir || process.cwd();
  return path.join(workDir, '.memory', MEMORY_FILE);
}

async function loadMemories(ctx: EnhancedToolContext): Promise<MemoryStore> {
  if (memoryCache) {
    return memoryCache;
  }

  const memoryPath = await getMemoryPath(ctx);

  try {
    const dir = path.dirname(memoryPath);
    await fs.mkdir(dir, { recursive: true });

    const data = await fs.readFile(memoryPath, 'utf-8');
    memoryCache = JSON.parse(data) as MemoryStore;
    return memoryCache;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      memoryCache = { entries: [], version: 1 };
      return memoryCache;
    }
    throw error;
  }
}

async function saveMemories(ctx: EnhancedToolContext, store: MemoryStore): Promise<void> {
  const memoryPath = await getMemoryPath(ctx);
  const dir = path.dirname(memoryPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(memoryPath, JSON.stringify(store, null, 2), 'utf-8');
  memoryCache = store;
}

function generateId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// ============== 记忆工具定义 ==============

/**
 * 保存记忆工具
 */
export const memorySaveTool: ToolInstance = defineTool({
  name: 'memory_save',
  description: `保存重要信息到持久记忆中。用于记住用户的偏好、重要事实、待办事项等。

适合保存的信息类型：
- preference: 用户偏好（如编程语言、框架、代码风格）
- fact: 重要事实（如项目名称、技术栈、团队成员）
- todo: 待办事项（如需要完成的任务）
- context: 上下文信息（如当前项目背景）
- other: 其他重要信息`,
  params: {
    type: {
      type: 'string',
      description: '记忆类型: preference | fact | todo | context | other',
      required: true,
      enum: ['preference', 'fact', 'todo', 'context', 'other'],
    },
    content: {
      type: 'string',
      description: '要保存的内容',
      required: true,
    },
    tags: {
      type: 'array',
      description: '标签列表，用于后续搜索',
      required: false,
      items: { type: 'string' },
    },
    source: {
      type: 'string',
      description: '信息来源说明',
      required: false,
    },
  },
  async exec(
    args: { type: MemoryType; content: string; tags?: string[]; source?: string },
    ctx: EnhancedToolContext
  ): Promise<{ success: boolean; id: string; message: string }> {
    const store = await loadMemories(ctx);

    const entry: MemoryEntry = {
      id: generateId(),
      type: args.type,
      content: args.content,
      tags: args.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: args.source,
    };

    store.entries.push(entry);
    store.version++;

    await saveMemories(ctx, store);

    // 触发自定义事件通知
    ctx.emit('memory_saved', { id: entry.id, type: entry.type });

    return {
      success: true,
      id: entry.id,
      message: `已保存 ${args.type} 类型的记忆: "${args.content.substring(0, 50)}${args.content.length > 50 ? '...' : ''}"`,
    };
  },
});

/**
 * 搜索记忆工具
 */
export const memorySearchTool: ToolInstance = defineTool({
  name: 'memory_search',
  description: '搜索已保存的记忆。支持按关键词、标签、类型进行筛选。',
  params: {
    query: {
      type: 'string',
      description: '搜索关键词（在内容中搜索）',
      required: false,
    },
    tags: {
      type: 'array',
      description: '按标签筛选（匹配任一标签）',
      required: false,
      items: { type: 'string' },
    },
    type: {
      type: 'string',
      description: '按类型筛选: preference | fact | todo | context | other',
      required: false,
      enum: ['preference', 'fact', 'todo', 'context', 'other'],
    },
    limit: {
      type: 'number',
      description: '返回结果数量限制，默认 10',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(
    args: { query?: string; tags?: string[]; type?: MemoryType; limit?: number },
    ctx: EnhancedToolContext
  ): Promise<{ found: number; entries: MemoryEntry[] }> {
    const store = await loadMemories(ctx);
    const limit = args.limit ?? 10;

    let results = store.entries;

    // 按类型筛选
    if (args.type) {
      results = results.filter((e) => e.type === args.type);
    }

    // 按标签筛选
    if (args.tags && args.tags.length > 0) {
      results = results.filter((e) => args.tags!.some((tag) => e.tags.includes(tag)));
    }

    // 按关键词搜索
    if (args.query) {
      const queryLower = args.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.content.toLowerCase().includes(queryLower) ||
          e.tags.some((t) => t.toLowerCase().includes(queryLower))
      );
    }

    // 按更新时间排序（最新的在前）
    results.sort((a, b) => b.updatedAt - a.updatedAt);

    // 限制数量
    results = results.slice(0, limit);

    return {
      found: results.length,
      entries: results,
    };
  },
});

/**
 * 列出所有记忆工具
 */
export const memoryListTool: ToolInstance = defineTool({
  name: 'memory_list',
  description: '列出所有已保存的记忆，按类型分组显示摘要。',
  params: {
    includeContent: {
      type: 'boolean',
      description: '是否包含完整内容，默认只显示摘要',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(
    args: { includeContent?: boolean },
    ctx: EnhancedToolContext
  ): Promise<{
    total: number;
    byType: Record<MemoryType, number>;
    entries: Array<{
      id: string;
      type: MemoryType;
      summary: string;
      tags: string[];
      createdAt: string;
    }>;
  }> {
    const store = await loadMemories(ctx);

    const byType: Record<MemoryType, number> = {
      preference: 0,
      fact: 0,
      todo: 0,
      context: 0,
      other: 0,
    };

    const entries = store.entries.map((e) => {
      byType[e.type]++;
      return {
        id: e.id,
        type: e.type,
        summary: args.includeContent ? e.content : e.content.substring(0, 100) + (e.content.length > 100 ? '...' : ''),
        tags: e.tags,
        createdAt: new Date(e.createdAt).toISOString(),
      };
    });

    // 按创建时间排序（最新的在前）
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      total: store.entries.length,
      byType,
      entries,
    };
  },
});

/**
 * 删除记忆工具
 */
export const memoryDeleteTool: ToolInstance = defineTool({
  name: 'memory_delete',
  description: '删除指定的记忆条目。',
  params: {
    id: {
      type: 'string',
      description: '要删除的记忆 ID',
      required: true,
    },
  },
  async exec(args: { id: string }, ctx: EnhancedToolContext): Promise<{ success: boolean; message: string }> {
    const store = await loadMemories(ctx);

    const index = store.entries.findIndex((e) => e.id === args.id);
    if (index === -1) {
      return {
        success: false,
        message: `未找到记忆: ${args.id}`,
      };
    }

    const deleted = store.entries.splice(index, 1)[0];
    store.version++;
    await saveMemories(ctx, store);

    return {
      success: true,
      message: `已删除记忆: "${deleted.content.substring(0, 50)}..."`,
    };
  },
});

/** 所有记忆工具 */
export const memoryTools = [memorySaveTool, memorySearchTool, memoryListTool, memoryDeleteTool];

/** 重置缓存（用于测试） */
export function resetMemoryCache(): void {
  memoryCache = null;
}
