import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

import {
  getGlobalConfigDir,
  getLocalConfigDir,
  getLocalConfigPath,
  getLocalDataDir,
  getLocalWorkspaceDir,
} from './config.js';

export interface PreviewItem {
  path: string;
  size: number;
  kind: 'file' | 'dir';
}

export interface CleanPreview {
  items: PreviewItem[];
  totalSize: number;
}

function getPathSize(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.size;
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath);
    return entries.reduce((sum, entry) => sum + getPathSize(path.join(targetPath, entry)), 0);
  }
  return 0;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function toDisplayPath(targetPath: string): string {
  const rel = path.relative(process.cwd(), targetPath);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function previewCleanLocal(): CleanPreview {
  const items: PreviewItem[] = [];
  const localConfigPath = getLocalConfigPath();
  const localDataDir = getLocalDataDir();
  const localWorkspaceDir = getLocalWorkspaceDir();

  if (fs.existsSync(localConfigPath)) {
    items.push({ path: localConfigPath, size: getPathSize(localConfigPath), kind: 'file' });
  }
  if (fs.existsSync(localDataDir)) {
    items.push({ path: localDataDir, size: getPathSize(localDataDir), kind: 'dir' });
  }
  if (fs.existsSync(localWorkspaceDir)) {
    items.push({ path: localWorkspaceDir, size: getPathSize(localWorkspaceDir), kind: 'dir' });
  }

  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  return { items, totalSize };
}

export function previewCleanGlobal(): CleanPreview {
  const items: PreviewItem[] = [];
  const globalDir = getGlobalConfigDir();
  if (fs.existsSync(globalDir)) {
    items.push({ path: globalDir, size: getPathSize(globalDir), kind: 'dir' });
  }
  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  return { items, totalSize };
}

export function printPreview(preview: CleanPreview): void {
  if (preview.items.length === 0) {
    console.log(pc.yellow('未发现可清理的数据。'));
    return;
  }

  console.log(pc.bold('将要删除的文件：'));
  for (const item of preview.items) {
    const icon = item.kind === 'dir' ? '📁' : '📄';
    console.log(`  ${icon} ${toDisplayPath(item.path)} (${formatSize(item.size)})`);
  }
  console.log(`\n总计: ${formatSize(preview.totalSize)}`);
}

export function cleanLocal(): void {
  const localDir = getLocalConfigDir();
  if (fs.existsSync(localDir)) {
    fs.rmSync(localDir, { recursive: true, force: true });
  }
}

export function cleanGlobal(): void {
  const globalDir = getGlobalConfigDir();
  if (fs.existsSync(globalDir)) {
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
}
