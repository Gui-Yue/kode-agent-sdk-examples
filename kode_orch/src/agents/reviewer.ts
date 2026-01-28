import type { AgentTemplateDefinition } from '@shareai-lab/kode-sdk';

export const reviewerTemplate: AgentTemplateDefinition = {
  id: 'reviewer-agent',
  systemPrompt: `你是审查专家，擅长代码审查、方案评审和质量检查。
审查交付物的正确性、完整性和质量，提出具体的改进建议。
返回结构化的审查报告：通过/不通过 + 问题清单 + 改进建议。
不要描述你的审查过程，只输出审查结论。`,
  tools: ['fs_read', 'fs_glob', 'fs_grep'],
};
