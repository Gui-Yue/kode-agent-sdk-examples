/**
 * 受限的文件系统工具
 *
 * 机制上强制限制：
 * - 读取：任意路径（支持绝对路径）
 * - 写入：只能在 workspace 目录内
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { tool, type ToolInstance } from '@shareai-lab/kode-sdk';

/**
 * 创建受限的 fs 工具集
 * @param workspaceDir 写操作限制的目录（绝对路径）
 */
export function createRestrictedFsTools(workspaceDir: string): ToolInstance[] {
  const absoluteWorkspace = path.resolve(workspaceDir);

  // 检查路径是否在 workspace 内
  const isInWorkspace = (filePath: string): boolean => {
    const absolutePath = path.resolve(filePath);
    return absolutePath.startsWith(absoluteWorkspace + path.sep) || absolutePath === absoluteWorkspace;
  };

  // fs_read - 可读取任意路径
  const fsRead = tool({
    name: 'fs_read',
    description: '读取文件内容。支持绝对路径，可读取系统任意位置的文件。',
    parameters: z.object({
      path: z.string().describe('文件路径（推荐使用绝对路径）'),
      encoding: z.string().optional().default('utf-8').describe('编码格式，默认 utf-8'),
    }),
    execute: async (params) => {
      const filePath = params.path;
      const encoding = (params.encoding || 'utf-8') as BufferEncoding;

      try {
        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
          return { success: false, error: `文件不存在: ${absolutePath}` };
        }
        const content = fs.readFileSync(absolutePath, encoding);
        return { success: true, content, path: absolutePath };
      } catch (err) {
        return { success: false, error: `读取失败: ${(err as Error).message}` };
      }
    },
    metadata: {
      version: '1.0',
      readonly: true,
    },
  });

  // fs_write - 只能写入 workspace 目录
  const fsWrite = tool({
    name: 'fs_write',
    description: `写入文件内容。**安全限制：只能写入 workspace 目录 (${absoluteWorkspace}) 内的文件**。`,
    parameters: z.object({
      path: z.string().describe(`文件路径（必须在 ${absoluteWorkspace} 内）`),
      content: z.string().describe('要写入的内容'),
      encoding: z.string().optional().default('utf-8').describe('编码格式，默认 utf-8'),
    }),
    execute: async (params) => {
      const filePath = params.path;
      const content = params.content;
      const encoding = (params.encoding || 'utf-8') as BufferEncoding;

      const absolutePath = path.resolve(filePath);

      // 强制检查：只能写入 workspace 目录
      if (!isInWorkspace(absolutePath)) {
        return {
          success: false,
          error: `安全限制：只能写入 workspace 目录 (${absoluteWorkspace})。目标路径 ${absolutePath} 不在允许范围内。`,
        };
      }

      try {
        // 确保父目录存在
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absolutePath, content, encoding);
        return { success: true, path: absolutePath, bytesWritten: Buffer.byteLength(content, encoding) };
      } catch (err) {
        return { success: false, error: `写入失败: ${(err as Error).message}` };
      }
    },
    metadata: {
      version: '1.0',
      readonly: false,
    },
  });

  // fs_glob - 可搜索任意路径
  const fsGlob = tool({
    name: 'fs_glob',
    description: '使用 glob 模式搜索文件。支持绝对路径。',
    parameters: z.object({
      pattern: z.string().describe('Glob 模式，如 "**/*.ts"'),
      cwd: z.string().optional().describe('搜索的基础目录（推荐使用绝对路径）'),
    }),
    execute: async (params) => {
      const pattern = params.pattern;
      const cwd = params.cwd || process.cwd();

      try {
        const { glob } = await import('glob');
        const files = await glob(pattern, { cwd: path.resolve(cwd), absolute: true });
        return { success: true, files, count: files.length };
      } catch (err) {
        return { success: false, error: `搜索失败: ${(err as Error).message}` };
      }
    },
    metadata: {
      version: '1.0',
      readonly: true,
    },
  });

  // fs_grep - 可搜索任意路径
  const fsGrep = tool({
    name: 'fs_grep',
    description: '在文件中搜索文本模式。支持绝对路径。',
    parameters: z.object({
      pattern: z.string().describe('搜索的正则表达式'),
      path: z.string().describe('要搜索的文件或目录路径'),
      recursive: z.boolean().optional().default(false).describe('是否递归搜索目录'),
    }),
    execute: async (params) => {
      const pattern = params.pattern;
      const searchPath = params.path;
      const recursive = params.recursive ?? false;

      try {
        const absolutePath = path.resolve(searchPath);
        const regex = new RegExp(pattern, 'g');
        const results: Array<{ file: string; line: number; content: string }> = [];

        const searchFile = (filePath: string) => {
          if (!fs.existsSync(filePath)) return;
          const stat = fs.statSync(filePath);

          if (stat.isFile()) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                if (regex.test(line)) {
                  results.push({ file: filePath, line: idx + 1, content: line.trim() });
                }
                regex.lastIndex = 0; // 重置 regex 状态
              });
            } catch {
              // 忽略无法读取的文件（如二进制文件）
            }
          } else if (stat.isDirectory() && recursive) {
            const entries = fs.readdirSync(filePath);
            for (const entry of entries) {
              if (!entry.startsWith('.') && entry !== 'node_modules') {
                searchFile(path.join(filePath, entry));
              }
            }
          }
        };

        searchFile(absolutePath);
        return { success: true, matches: results, count: results.length };
      } catch (err) {
        return { success: false, error: `搜索失败: ${(err as Error).message}` };
      }
    },
    metadata: {
      version: '1.0',
      readonly: true,
    },
  });

  return [fsRead, fsWrite, fsGlob, fsGrep];
}
