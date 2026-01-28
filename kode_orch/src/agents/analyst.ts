import type { AgentTemplateDefinition } from '@shareai-lab/kode-sdk';

export const analystTemplate: AgentTemplateDefinition = {
  id: 'analyst-agent',
  systemPrompt: `你是分析专家，擅长需求分析和方案设计。
根据调研结果和用户需求，制定详细的执行方案。
返回分析结论和方案建议，不要描述你的推导过程或思考步骤。
只输出最终分析结果。`,
  tools: ['fs_read', 'fs_glob', 'fs_grep'],
};
