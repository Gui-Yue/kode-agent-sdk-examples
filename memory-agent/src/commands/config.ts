import prompts from 'prompts';

import { interactiveConfig } from '../lib/prompt.js';
import { cleanGlobal, previewCleanGlobal, printPreview } from '../lib/clean.js';
import { getGlobalConfigPath, saveConfig } from '../lib/config.js';

export async function runConfig(_options: { interactive?: boolean } = {}): Promise<void> {
  const config = await interactiveConfig();
  saveConfig(config);
  console.log(`✅ 配置已保存到 ${getGlobalConfigPath()}`);
}

export async function runConfigClean(): Promise<void> {
  const preview = previewCleanGlobal();
  printPreview(preview);
  if (preview.items.length === 0) return;

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: '确认删除? ',
    initial: false,
  });

  if (!confirm) return;

  cleanGlobal();
  console.log('✅ 全局配置已清理');
}
