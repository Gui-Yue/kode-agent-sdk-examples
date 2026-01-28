import type { AgentTemplateDefinition } from '@shareai-lab/kode-sdk';

export const researchTemplate: AgentTemplateDefinition = {
  id: 'research-agent',
  systemPrompt: `你是调研专家，擅长搜索和收集信息。
根据任务描述，使用工具搜索、阅读、整理信息，返回结构化的调研报告。
不要描述你的调研过程、用了什么工具、搜索了哪些内容。
只输出最终报告。`,
  tools: ['fs_read', 'fs_glob', 'fs_grep', 'bash_run'],
  permission: {
    mode: 'auto',
    requireApprovalTools: ['bash_run'],
  },
};
