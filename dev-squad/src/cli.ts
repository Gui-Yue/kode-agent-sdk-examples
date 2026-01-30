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
  .name('dev-squad')
  .description('AI 开发小队 - KODE SDK 示例')
  .version(pkg.version)
  .option('--debug', '输出事件调试信息');

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
    await runMain(config, { debug: options.debug });
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
});

program.addHelpText(
  'after',
  `\n使用场景:
  - 快速实现算法函数（排序、搜索、数据处理等）
  - 开发工具函数库
  - 原型验证和学习

使用方式:
  dev-squad [选项] [子命令]

子命令:
  config          配置管理
  clean           清理数据
  help            显示帮助

配置:
  dev-squad config           交互式重新配置
  dev-squad config clean     清理全局配置

清理:
  dev-squad clean            清理当前目录的本地数据
  dev-squad clean --dry-run  预览将要删除的内容

示例:
  dev-squad                   启动开发小队
  dev-squad config            配置 API Key

数据存储:
  全局配置:  ~/.config/shareai-sdk-demos/dev-squad/
  本地数据:  ./.sdk-demo-dev-squad/  (当前目录下)

  注意: 本地数据存储在运行命令时的当前目录。
        在不同目录运行会产生独立的本地数据。
        这样设计是为了实现项目间的数据隔离。

卸载:
  1. dev-squad clean            # 清理本地数据
  2. dev-squad config clean     # 清理全局配置
  3. npm uninstall -g @shareai-lab/sdk-demo-dev-squad
`
);

program.parseAsync().catch((err) => {
  console.error('❌ 命令执行失败:', err);
  process.exit(1);
});
