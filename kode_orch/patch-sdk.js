#!/usr/bin/env node
/**
 * patch-sdk.js
 * 修复 SDK 的 Agent.create() 中 E2B 沙箱未初始化的问题
 * 将 sandboxFactory.create() 替换为 await sandboxFactory.createAsync()
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const agentFile = path.join(__dirname, 'node_modules/@shareai-lab/kode-sdk/dist/core/agent.js');

if (!fs.existsSync(agentFile)) {
  console.log('[patch-sdk] agent.js not found, skipping');
  process.exit(0);
}

let code = fs.readFileSync(agentFile, 'utf-8');
let patched = false;

// Patch 1: Agent.create() 中的 sandbox 创建
const old1 = 'deps.sandboxFactory.create(sandboxConfig || { kind: \'local\', workDir: process.cwd() })';
const new1 = 'await deps.sandboxFactory.createAsync(sandboxConfig || { kind: \'local\', workDir: process.cwd() })';
if (code.includes(old1)) {
  code = code.replace(old1, new1);
  patched = true;
}

// Patch 2: Agent.resume() 中的 sandbox 创建
const old2 = 'deps.sandboxFactory.create(metadata.sandboxConfig || { kind: \'local\', workDir: process.cwd() })';
const new2 = 'await deps.sandboxFactory.createAsync(metadata.sandboxConfig || { kind: \'local\', workDir: process.cwd() })';
if (code.includes(old2)) {
  code = code.replace(old2, new2);
  patched = true;
}

if (patched) {
  fs.writeFileSync(agentFile, code);
  console.log('[patch-sdk] ✓ Patched agent.js: sandboxFactory.create → createAsync');
} else {
  console.log('[patch-sdk] agent.js already patched or structure changed');
}
