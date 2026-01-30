import prompts from 'prompts';

import { cleanLocal, previewCleanLocal, printPreview } from '../lib/clean.js';

export async function runClean(options: { dryRun?: boolean } = {}): Promise<void> {
  const preview = previewCleanLocal();
  printPreview(preview);

  if (preview.items.length === 0) return;
  if (options.dryRun) return;

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: '确认删除? ',
    initial: false,
  });

  if (!confirm) return;

  cleanLocal();
  console.log('✅ 本地数据已清理');
}
