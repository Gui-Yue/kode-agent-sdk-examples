/**
 * Research Squad - 自定义工具
 *
 * 自定义 task_run 工具，支持转发子 Agent 输出
 * 网络搜索工具，支持联网调研（支持代理）
 */

import { tool, Agent, type ToolContext, type AgentConfig } from '@shareai-lab/kode-sdk';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';

// 获取代理配置
function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxyUrl) {
    return new HttpsProxyAgent(proxyUrl);
  }
  return undefined;
}

export interface AgentTemplate {
  id: string;
  whenToUse?: string;
  tools?: string[];
}

// 当前任务的工作目录（由 main.ts 设置）
let currentTaskDir: string | null = null;
// 当前任务名称（由 agent 设置）
let currentTaskName: string | null = null;

export function setCurrentTaskDir(dir: string | null): void {
  currentTaskDir = dir;
}

export function getCurrentTaskDir(): string | null {
  return currentTaskDir;
}

export function setCurrentTaskName(name: string | null): void {
  currentTaskName = name;
}

export function getCurrentTaskName(): string | null {
  return currentTaskName;
}

/**
 * 创建设置任务名称的工具
 * 让 Agent 归纳一个简短的主题名作为目录名
 */
export function createSetTaskNameTool(reportsDir: string) {
  return tool({
    name: 'set_task_name',
    description: `Set a short, descriptive name for the current research task.
This name will be used as the folder name to store all research results.

Guidelines:
- Use 2-5 Chinese characters or English words
- Be concise but descriptive (e.g., "Moltbot调研", "React状态管理", "微服务架构")
- Avoid generic names like "调研" or "分析"
- Must be called BEFORE any task_run calls`,
    parameters: z.object({
      name: z.string().min(2).max(20).describe('Short task name (2-20 chars, e.g., "Moltbot调研")'),
    }),
    async execute(args) {
      const { name } = args;
      // 清理名称，只保留中文、英文、数字
      const cleanName = name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').substring(0, 20) || 'research';
      setCurrentTaskName(cleanName);

      // 生成目录名：时间戳_任务名
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:T]/g, '').substring(0, 14);
      const taskDirName = `${timestamp}_${cleanName}`;
      const taskDir = `${reportsDir}/${taskDirName}`;

      // 创建目录
      const fs = await import('fs');
      if (!fs.existsSync(taskDir)) {
        fs.mkdirSync(taskDir, { recursive: true });
      }

      setCurrentTaskDir(taskDir);

      return { success: true, taskName: cleanName, taskDir };
    },
    metadata: {
      readonly: false,
      version: '1.0',
    },
  });
}

export interface SubAgentEventCallback {
  onTextChunk?: (agentId: string, delta: string) => void;
  onToolStart?: (agentId: string, toolName: string) => void;
  onToolEnd?: (agentId: string, toolName: string) => void;
  onDone?: (agentId: string) => void;
}

// 全局回调，由 main.ts 设置
let globalEventCallback: SubAgentEventCallback | null = null;

export function setSubAgentEventCallback(callback: SubAgentEventCallback | null): void {
  globalEventCallback = callback;
}

/**
 * 创建自定义 task_run 工具
 * 支持转发子 Agent 的输出到终端，并保存结果到任务目录
 */
export function createCustomTaskRunTool(templates: AgentTemplate[], baseDir?: string) {
  if (!templates || templates.length === 0) {
    throw new Error('Cannot create task_run tool: no agent templates provided');
  }

  const availableTemplatesStr = templates
    .map((tpl) => `- ${tpl.id}: ${tpl.whenToUse || 'General purpose'}`)
    .join('\n');

  return tool({
    name: 'task_run',
    description: `Run a sub-agent to complete a specific research task.

Available agent templates:
${availableTemplatesStr}

The sub-agent will:
1. Execute the research task
2. Save the result to a markdown file in the task directory
3. Return the result summary`,
    parameters: z.object({
      taskIndex: z.coerce.number().describe('Task index number (1, 2, 3...)'),
      taskTitle: z.string().describe('Short title for the task (will be used as filename)'),
      prompt: z.string().describe('Detailed instructions for the sub-agent'),
      agentTemplateId: z.string().describe('Agent template ID to use'),
    }),
    async execute(args, ctx: ToolContext) {
      const { taskIndex, taskTitle, prompt, agentTemplateId } = args;

      const template = templates.find((tpl) => tpl.id === agentTemplateId);
      if (!template) {
        throw new Error(`Template '${agentTemplateId}' not found. Available: ${templates.map(t => t.id).join(', ')}`);
      }

      const taskDir = getCurrentTaskDir();
      if (!taskDir) {
        throw new Error('Task directory not set. Please start a new research task first.');
      }

      // 构建文件名：序号_标题.md
      const safeTitle = taskTitle
        .replace(/[\/\\:*?"<>|：；，。！？、（）【】「」『』《》""'']/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 30);
      const outputFile = `${taskDir}/${String(taskIndex).padStart(2, '0')}_${safeTitle}.md`;
      const sandboxRoot = baseDir ? path.resolve(baseDir) : process.cwd();
      const resolvedOutput = path.resolve(outputFile);

      // 验证路径在 sandbox 内
      const relToSandbox = path.relative(sandboxRoot, resolvedOutput);
      if (!relToSandbox || relToSandbox.startsWith('..') || path.isAbsolute(relToSandbox)) {
        throw new Error(`Output path is outside sandbox: ${outputFile}`);
      }

      // 构建详细 prompt，包含保存指令（使用绝对路径避免路径问题）
      const absoluteOutputPath = resolvedOutput;
      const detailedPrompt = `# 调研任务: ${taskTitle}

${prompt}

## 重要：保存调研结果

完成调研后，你必须使用 fs_write 工具将结果保存到文件：
- 文件路径: ${absoluteOutputPath}
- 格式: Markdown
- 内容: 完整的调研报告

请确保报告包含：
1. 核心发现（1-3句话总结）
2. 详细内容（背景、关键信息、分析）
3. 信息来源（URL列表）
4. 结论和置信度`;

      // 获取父 Agent 的配置
      const parentAgent = ctx.agent;
      if (!parentAgent) {
        throw new Error('No parent agent context');
      }

      // 创建子 Agent 配置（使用与 baseDir 相同的 workDir）
      const subAgentConfig: AgentConfig = {
        templateId: template.id,
        model: (parentAgent as any).model,
        sandbox: { kind: 'local', workDir: sandboxRoot },
        tools: template.tools,
        metadata: {
          maxTokens: 16384,
          parentAgentId: (parentAgent as any).agentId,
        },
      };

      // 创建子 Agent
      const subAgent = await Agent.create(subAgentConfig, (parentAgent as any).deps);
      const subAgentId = `researcher-${Date.now().toString(36)}`;

      // 用于收集子 Agent 的完整输出
      let fullText = '';

      // 启动事件订阅（在后台运行）
      const subscriptionDone = new Promise<void>((resolve) => {
        if (!globalEventCallback) {
          resolve();
          return;
        }

        (async () => {
          try {
            for await (const envelope of subAgent.subscribe(['progress'])) {
              const event = envelope.event;
              const eventType = event.type;

              if (eventType === 'text_chunk') {
                const delta = (event as any).delta || '';
                fullText += delta;
                globalEventCallback?.onTextChunk?.(subAgentId, delta);
              } else if (eventType === 'tool:start') {
                globalEventCallback?.onToolStart?.(subAgentId, (event as any).call?.name);
              } else if (eventType === 'tool:end') {
                globalEventCallback?.onToolEnd?.(subAgentId, (event as any).call?.name);
              } else if (eventType === 'done') {
                globalEventCallback?.onDone?.(subAgentId);
                resolve();
                break;
              }
            }
          } catch {
            resolve();
          }
        })();
      });

      // 后台执行子 Agent（订阅已在后台运行），立即返回
      const backgroundRun = (async () => {
        try {
          await subAgent.complete(detailedPrompt);

          // 等待订阅处理完最后的事件
          await Promise.race([
            subscriptionDone,
            new Promise(r => setTimeout(r, 500)), // 最多等 500ms
          ]);

          // 校验输出文件是否写入（静默处理）
          if (!fs.existsSync(outputFile)) {
            throw new Error(`Output file not found: ${outputFile}`);
          }

          const finalTodos = typeof (parentAgent as any).getTodos === 'function'
            ? (parentAgent as any).getTodos()
            : null;
          if (Array.isArray(finalTodos)) {
            const idx = taskIndex - 1;
            if (idx >= 0 && idx < finalTodos.length) {
              const updated = finalTodos.map((t: any, i: number) => (
                i === idx ? { ...t, status: 'completed' } : t
              ));
              if (typeof (parentAgent as any).setTodos === 'function') {
                await (parentAgent as any).setTodos(updated);
              }
            }
          }
        } catch {
          // 静默处理错误，轮询机制会检测文件是否生成
        } finally {
          // 清理 sandbox
          try {
            await (subAgent as any).sandbox?.dispose?.();
          } catch {
            // ignore
          }
        }
      })();

      backgroundRun.catch(() => null);

      return {
        status: 'running',
        taskIndex,
        taskTitle,
        outputFile,
        started: true,
        text: fullText,
      };
    },
    metadata: {
      readonly: false,
      version: '1.0',
    },
  });
}

/**
 * 创建网络搜索工具
 * 使用 Bing 或 Google 进行搜索（支持代理）
 */
export function createWebSearchTool() {
  return tool({
    name: 'web_search',
    description: `Search the web for information.

IMPORTANT: You MUST provide a "query" parameter with your search terms.

Example usage:
  web_search({ query: "moltbot AI assistant" })
  web_search({ query: "开源AI Agent 2024" })

Use this tool to find:
- Latest news and updates about products, technologies, or topics
- Official websites and documentation
- User reviews and discussions
- Technical articles and tutorials

Returns a list of search results with titles, URLs, and descriptions.`,
    parameters: z.object({
      query: z.string().describe('The search query string (REQUIRED)'),
      maxResults: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
      engine: z.enum(['bing', 'google']).optional().default('bing').describe('Search engine to use (default: bing)'),
    }),
    async execute(args) {
      const anyArgs = args as any;
      // 更宽容地提取 query 参数
      let rawQuery: string | undefined;
      if (typeof anyArgs === 'string') {
        rawQuery = anyArgs;
      } else if (anyArgs && typeof anyArgs === 'object') {
        // 尝试各种可能的参数名
        rawQuery = anyArgs.query ?? anyArgs.q ?? anyArgs.keyword ?? anyArgs.text ??
                   anyArgs.input ?? anyArgs.search ?? anyArgs.searchQuery ??
                   anyArgs.search_query ?? anyArgs.keywords;
        // 如果还是没找到，检查是否有 arguments 属性
        if (!rawQuery && anyArgs.arguments && typeof anyArgs.arguments === 'object') {
          const innerArgs = anyArgs.arguments;
          rawQuery = innerArgs.query ?? innerArgs.q ?? innerArgs.keyword ?? innerArgs.text;
        }
      }

      const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
      const maxResults = typeof anyArgs?.maxResults === 'number' ? anyArgs.maxResults : 10;
      const engine = typeof anyArgs?.engine === 'string' ? anyArgs.engine : 'bing';

      if (!query || query.length < 2) {
        return {
          success: false,
          message: `query 参数必填！正确格式: web_search({ query: "你的搜索词" })`,
          results: [],
        };
      }

      const proxyAgent = getProxyAgent();

      try {
        let url: string;
        let parseResults: (html: string) => Array<{ rank: number; title: string; url: string; description: string }>;

        if (engine === 'google' && proxyAgent) {
          // 有代理时可以用 Google
          url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}`;
          parseResults = (html: string) => {
            const $ = cheerio.load(html);
            const results: Array<{ rank: number; title: string; url: string; description: string }> = [];
            $('div.g').each((index, element) => {
              if (index >= maxResults) return false;
              const $item = $(element);
              const $title = $item.find('h3');
              const $link = $item.find('a');
              const title = $title.text().trim();
              const href = $link.attr('href') || '';
              const description = $item.find('.VwiC3b').text().trim() || '';
              if (title && href && href.startsWith('http')) {
                results.push({ rank: index + 1, title, url: href, description: description.substring(0, 300) });
              }
            });
            return results;
          };
        } else {
          // 默认用 Bing（国内可访问）
          url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
          parseResults = (html: string) => {
            const $ = cheerio.load(html);
            const results: Array<{ rank: number; title: string; url: string; description: string }> = [];
            $('li.b_algo').each((index, element) => {
              if (index >= maxResults) return false;
              const $item = $(element);
              const $title = $item.find('h2 a');
              const title = $title.text().trim();
              const href = $title.attr('href') || '';
              const description = $item.find('.b_caption p').text().trim() ||
                                 $item.find('.b_algoSlug').text().trim() || '';
              if (title && href) {
                results.push({ rank: index + 1, title, url: href, description: description.substring(0, 300) });
              }
            });
            return results;
          };
        }

        const fetchOptions: any = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        };

        // 如果有代理，添加 agent
        if (proxyAgent) {
          fetchOptions.agent = proxyAgent;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const html = await response.text();
        const results = parseResults(html);

        if (results.length === 0) {
          return {
            success: false,
            message: `No results found for "${query}". The search may have been blocked or the query returned no matches.`,
            results: [],
          };
        }

        return {
          success: true,
          query,
          totalResults: results.length,
          results,
        };
      } catch (error) {
        return {
          success: false,
          message: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          results: [],
        };
      }
    },
    metadata: {
      readonly: true,
      version: '1.0',
    },
  });
}
