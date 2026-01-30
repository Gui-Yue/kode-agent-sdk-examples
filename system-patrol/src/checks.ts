/**
 * System Patrol Agent - 巡检工具集
 *
 * 使用 defineTool 创建一组系统巡检工具：
 * - check_disk: 磁盘使用率检查
 * - check_processes: 高资源占用进程检查
 * - check_git: Git 仓库状态检查
 * - check_logs: 日志错误扫描
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { defineTool, type ToolInstance } from '@shareai-lab/kode-sdk';

const execAsync = promisify(exec);

// ============== 类型定义 ==============

interface DiskInfo {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usagePercent: number;
  mountPoint: string;
}

interface ProcessInfo {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  command: string;
}

interface GitStatus {
  branch: string;
  hasUncommitted: boolean;
  uncommittedCount: number;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
}

interface LogEntry {
  level: 'ERROR' | 'WARN';
  timestamp: string;
  message: string;
  file: string;
  line: number;
}

// ============== 巡检工具定义 ==============

/**
 * 磁盘使用率检查工具
 */
export const checkDiskTool: ToolInstance = defineTool({
  name: 'check_disk',
  description: '检查磁盘使用率，返回各分区的使用情况。超过阈值（默认80%）的分区会被标记为警告。',
  params: {
    threshold: {
      type: 'number',
      description: '告警阈值百分比，默认 80',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(args: { threshold?: number }): Promise<{
    status: 'ok' | 'warning' | 'error';
    disks: DiskInfo[];
    warnings: string[];
  }> {
    const threshold = args.threshold ?? 80;

    try {
      const { stdout } = await execAsync('df -h --output=source,size,used,avail,pcent,target 2>/dev/null || df -h');
      const lines = stdout.trim().split('\n').slice(1); // 跳过表头

      const disks: DiskInfo[] = [];
      const warnings: string[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const usageStr = parts[4].replace('%', '');
          const usagePercent = parseInt(usageStr, 10);

          const disk: DiskInfo = {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usagePercent,
            mountPoint: parts[5],
          };

          // 过滤掉临时文件系统
          if (!disk.filesystem.startsWith('tmpfs') && !disk.filesystem.startsWith('devtmpfs')) {
            disks.push(disk);

            if (usagePercent >= threshold) {
              warnings.push(`⚠️ ${disk.mountPoint} 使用率 ${usagePercent}% 超过阈值 ${threshold}%`);
            }
          }
        }
      }

      return {
        status: warnings.length > 0 ? 'warning' : 'ok',
        disks,
        warnings,
      };
    } catch (error) {
      return {
        status: 'error',
        disks: [],
        warnings: [`执行 df 命令失败: ${error}`],
      };
    }
  },
});

/**
 * 高资源占用进程检查工具
 */
export const checkProcessesTool: ToolInstance = defineTool({
  name: 'check_processes',
  description: '检查系统中资源占用最高的进程，返回 CPU 和内存使用率 TOP N 的进程列表。',
  params: {
    topN: {
      type: 'number',
      description: '返回前 N 个进程，默认 10',
      required: false,
    },
    cpuThreshold: {
      type: 'number',
      description: 'CPU 使用率告警阈值百分比，默认 80',
      required: false,
    },
    memThreshold: {
      type: 'number',
      description: '内存使用率告警阈值百分比，默认 80',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(args: { topN?: number; cpuThreshold?: number; memThreshold?: number }): Promise<{
    status: 'ok' | 'warning' | 'error';
    processes: ProcessInfo[];
    warnings: string[];
  }> {
    const topN = args.topN ?? 10;
    const cpuThreshold = args.cpuThreshold ?? 80;
    const memThreshold = args.memThreshold ?? 80;

    try {
      // 按内存排序获取进程
      const { stdout } = await execAsync(
        `ps aux --sort=-%mem 2>/dev/null | head -n ${topN + 1} || ps aux | head -n ${topN + 1}`
      );
      const lines = stdout.trim().split('\n').slice(1); // 跳过表头

      const processes: ProcessInfo[] = [];
      const warnings: string[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          const proc: ProcessInfo = {
            user: parts[0],
            pid: parseInt(parts[1], 10),
            cpuPercent: parseFloat(parts[2]),
            memPercent: parseFloat(parts[3]),
            command: parts.slice(10).join(' ').substring(0, 50),
          };

          processes.push(proc);

          if (proc.cpuPercent >= cpuThreshold) {
            warnings.push(`⚠️ PID ${proc.pid} CPU 使用率 ${proc.cpuPercent}% 超过阈值`);
          }
          if (proc.memPercent >= memThreshold) {
            warnings.push(`⚠️ PID ${proc.pid} 内存使用率 ${proc.memPercent}% 超过阈值`);
          }
        }
      }

      return {
        status: warnings.length > 0 ? 'warning' : 'ok',
        processes,
        warnings,
      };
    } catch (error) {
      return {
        status: 'error',
        processes: [],
        warnings: [`执行 ps 命令失败: ${error}`],
      };
    }
  },
});

/**
 * Git 仓库状态检查工具
 */
export const checkGitTool: ToolInstance = defineTool({
  name: 'check_git',
  description: '检查指定目录的 Git 仓库状态，包括未提交的变更和最近的提交记录。',
  params: {
    repoPath: {
      type: 'string',
      description: 'Git 仓库路径，默认为当前目录',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(args: { repoPath?: string }): Promise<{
    status: 'ok' | 'warning' | 'error';
    gitStatus: GitStatus | null;
    warnings: string[];
  }> {
    const repoPath = args.repoPath ?? '.';

    try {
      // 检查是否是 Git 仓库
      try {
        await execAsync(`git -C "${repoPath}" rev-parse --git-dir`);
      } catch {
        return {
          status: 'warning',
          gitStatus: null,
          warnings: [`${repoPath} 不是一个 Git 仓库`],
        };
      }

      // 获取当前分支
      const { stdout: branchOut } = await execAsync(`git -C "${repoPath}" branch --show-current`);
      const branch = branchOut.trim() || 'HEAD detached';

      // 获取未提交变更数量
      const { stdout: statusOut } = await execAsync(`git -C "${repoPath}" status --porcelain`);
      const uncommittedCount = statusOut.trim() ? statusOut.trim().split('\n').length : 0;

      // 获取最近一次提交
      let lastCommit: GitStatus['lastCommit'] = null;
      try {
        const { stdout: logOut } = await execAsync(
          `git -C "${repoPath}" log -1 --format="%H|%s|%an|%ai"`
        );
        if (logOut.trim()) {
          const [hash, message, author, date] = logOut.trim().split('|');
          lastCommit = { hash: hash.substring(0, 7), message, author, date };
        }
      } catch {
        // 空仓库没有提交记录
      }

      const warnings: string[] = [];
      if (uncommittedCount > 0) {
        warnings.push(`⚠️ ${repoPath} 有 ${uncommittedCount} 个未提交的变更`);
      }

      return {
        status: warnings.length > 0 ? 'warning' : 'ok',
        gitStatus: {
          branch,
          hasUncommitted: uncommittedCount > 0,
          uncommittedCount,
          lastCommit,
        },
        warnings,
      };
    } catch (error) {
      return {
        status: 'error',
        gitStatus: null,
        warnings: [`检查 Git 仓库失败: ${error}`],
      };
    }
  },
});

/**
 * 日志错误扫描工具
 */
export const checkLogsTool: ToolInstance = defineTool({
  name: 'check_logs',
  description: '扫描指定日志文件，提取最近的 ERROR 和 WARN 级别日志条目。',
  params: {
    logPath: {
      type: 'string',
      description: '日志文件路径',
      required: true,
    },
    maxLines: {
      type: 'number',
      description: '扫描的最大行数，默认 1000',
      required: false,
    },
    maxResults: {
      type: 'number',
      description: '返回的最大结果数，默认 20',
      required: false,
    },
  },
  attributes: { readonly: true, noEffect: true },
  async exec(args: { logPath: string; maxLines?: number; maxResults?: number }): Promise<{
    status: 'ok' | 'warning' | 'error';
    entries: LogEntry[];
    summary: { errors: number; warnings: number };
    warnings: string[];
  }> {
    const { logPath } = args;
    const maxLines = args.maxLines ?? 1000;
    const maxResults = args.maxResults ?? 20;

    try {
      // 检查文件是否存在
      await fs.access(logPath);

      // 读取文件最后 N 行
      const { stdout } = await execAsync(`tail -n ${maxLines} "${logPath}"`);
      const lines = stdout.split('\n');

      const entries: LogEntry[] = [];
      let errorCount = 0;
      let warnCount = 0;

      // 简单的日志解析（支持常见格式）
      const errorPattern = /\b(ERROR|FATAL|CRITICAL)\b/i;
      const warnPattern = /\b(WARN|WARNING)\b/i;
      const timestampPattern = /\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}/;

      for (let i = 0; i < lines.length && entries.length < maxResults; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const isError = errorPattern.test(line);
        const isWarn = warnPattern.test(line);

        if (isError || isWarn) {
          const level = isError ? 'ERROR' : 'WARN';
          const timestampMatch = line.match(timestampPattern);
          const timestamp = timestampMatch ? timestampMatch[0] : 'unknown';

          entries.push({
            level: level as 'ERROR' | 'WARN',
            timestamp,
            message: line.substring(0, 200),
            file: path.basename(logPath),
            line: i + 1,
          });

          if (isError) errorCount++;
          else warnCount++;
        }
      }

      const statusWarnings: string[] = [];
      if (errorCount > 0) {
        statusWarnings.push(`⚠️ 发现 ${errorCount} 条 ERROR 日志`);
      }
      if (warnCount > 5) {
        statusWarnings.push(`⚠️ 发现 ${warnCount} 条 WARN 日志`);
      }

      return {
        status: errorCount > 0 ? 'warning' : 'ok',
        entries,
        summary: { errors: errorCount, warnings: warnCount },
        warnings: statusWarnings,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return {
          status: 'warning',
          entries: [],
          summary: { errors: 0, warnings: 0 },
          warnings: [`日志文件不存在: ${logPath}`],
        };
      }
      return {
        status: 'error',
        entries: [],
        summary: { errors: 0, warnings: 0 },
        warnings: [`读取日志失败: ${error}`],
      };
    }
  },
});

/** 所有巡检工具 */
export const patrolTools = [checkDiskTool, checkProcessesTool, checkGitTool, checkLogsTool];
