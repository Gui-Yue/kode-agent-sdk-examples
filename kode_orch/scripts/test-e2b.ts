/**
 * E2B Sandbox 诊断脚本
 * 运行: npx tsx scripts/test-e2b.ts
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import { E2BSandbox } from '@shareai-lab/kode-sdk';

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  const template = process.env.E2B_TEMPLATE || 'base';

  console.log('=== E2B Sandbox 诊断 ===\n');
  console.log('配置:');
  console.log(`  API Key: ${apiKey ? apiKey.slice(0, 10) + '...' : '(未设置)'}`);
  console.log(`  Template: ${template}`);
  console.log();

  if (!apiKey) {
    console.error('❌ E2B_API_KEY 未设置');
    process.exit(1);
  }

  console.log('1. 创建沙箱...');
  const startTime = Date.now();

  try {
    const sandbox = new E2BSandbox({
      apiKey,
      template,
      timeoutMs: 60_000,
    });

    console.log('2. 初始化沙箱...');
    await sandbox.init();
    console.log(`   ✓ 沙箱创建成功 (${Date.now() - startTime}ms)`);

    console.log('\n3. 检查沙箱类型和方法...');
    console.log(`   kind: ${sandbox.kind}`);
    console.log(`   可用方法: ${Object.getOwnPropertyNames(Object.getPrototypeOf(sandbox)).filter(m => typeof (sandbox as any)[m] === 'function').join(', ')}`);

    console.log('\n4. 测试命令执行 (exec)...');
    const result = await sandbox.exec('echo "Hello from E2B!" && pwd && uname -a');
    console.log(`   ✓ 命令执行成功`);
    console.log(`   退出码: ${result.exitCode}`);
    console.log(`   输出:\n${result.stdout}`);
    if (result.stderr) console.log(`   错误:\n${result.stderr}`);

    console.log('\n5. 测试 HTTP 服务预览 URL...');
    if (typeof (sandbox as any).getHostUrl === 'function') {
      const url = (sandbox as any).getHostUrl(8080);
      console.log(`   ✓ 预览 URL: ${url}`);
    } else {
      console.log(`   ⚠ getHostUrl 方法不存在`);
    }

    console.log('\n6. 销毁沙箱...');
    await sandbox.dispose();
    console.log('   ✓ 沙箱已销毁');

    console.log('\n=== 诊断完成：E2B 工作正常 ===');
  } catch (err) {
    console.error('\n❌ E2B 错误:');
    console.error(err);
    process.exit(1);
  }
}

main();
