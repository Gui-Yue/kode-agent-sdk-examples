#!/usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'module';

import { runConfig, runConfigClean } from './commands/config.js';
import { runClean } from './commands/clean.js';
import { runMain } from './commands/run.js';
import { checkFirstRun, loadConfig } from './lib/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('memory-agent')
  .description('Memory Agent - 持久记忆助手')
  .version(pkg.version)
  .option('--resume', '恢复上次会话')
  .option('--reset', '清除数据并重新开始');

const configCommand = program
  .command('config')
  .description('交互式重新配置')
  .action(runConfig);

configCommand
  .command('clean')
  .description('清理全局配置')
  .action(runConfigClean);

program
  .command('clean')
  .description('清理当前目录的本地数据')
  .option('--dry-run', '预览')
  .action((options) => runClean({ dryRun: options.dryRun }));

program.action(async () => {
  try {
    if (checkFirstRun()) {
      console.log('🔧 首次运行，需要配置...\n');
      await runConfig({ interactive: true });
      console.log();
    }

    const config = loadConfig();
    const options = program.opts();
    await runMain(config, { resume: options.resume, reset: options.reset });
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
});

program.addHelpText(
  'after',
  `\n使用方式:
  memory-agent [选项] [子命令]

子命令:
  config          配置管理
  clean           清理数据
  help            显示帮助

选项:
  --resume        恢复上次会话
  --reset         清除数据并重新开始

配置:
  memory-agent config           交互式重新配置
  memory-agent config clean     清理全局配置

清理:
  memory-agent clean            清理当前目录的本地数据
  memory-agent clean --dry-run  预览将要删除的内容

数据存储:
  全局配置:  ~/.config/shareai-sdk-demos/memory-agent/
  本地数据:  ./.sdk-demo-memory-agent/  (当前目录下)
`
);

program.parseAsync().catch((err) => {
  console.error('❌ 命令执行失败:', err);
  process.exit(1);
});
