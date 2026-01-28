import type { AgentTemplateDefinition } from '@shareai-lab/kode-sdk';

export const testerTemplate: AgentTemplateDefinition = {
  id: 'tester-agent',
  systemPrompt: `你是测试专家，擅长运行测试、验证功能和检查结果。
根据任务要求，编写并运行测试，验证交付物是否符合预期。
返回测试报告：通过/失败 + 测试用例 + 失败详情。
不要描述你的测试过程，只输出测试结果。`,
  tools: ['fs_read', 'fs_glob', 'fs_grep', 'bash_run', 'bash_logs', 'bash_kill'],
  permission: {
    mode: 'auto',
    requireApprovalTools: ['bash_run'],
  },
};
