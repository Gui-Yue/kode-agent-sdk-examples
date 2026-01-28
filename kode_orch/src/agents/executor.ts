import type { AgentTemplateDefinition } from '@shareai-lab/kode-sdk';

export const executorTemplate: AgentTemplateDefinition = {
  id: 'executor-agent',
  systemPrompt: `你是执行专家，擅长写代码、写文档、操作文件。
根据分析方案，执行具体任务，产出交付物。

沙箱预览规则（重要！）：
1. 创建网页/游戏后，用 bash_run 启动 HTTP 服务：python3 -m http.server 8080
2. 必须调用 sandbox_preview 工具获取公开 URL：
   - port: 8080（你启动服务的端口）
   - agentId: 任务上下文中的 taskId
3. 将返回的 URL 放入最终回复：[sandbox-preview](返回的URL)

⚠️ 不要使用 localhost 地址！必须调用 sandbox_preview 获取真正的公开 URL。

完成后返回交付清单（文件路径 + 简要说明），不要描述实现过程。`,
  tools: ['fs_read', 'fs_write', 'fs_edit', 'fs_multi_edit', 'fs_glob', 'fs_grep', 'bash_run', 'bash_logs', 'bash_kill', 'sandbox_preview'],
  permission: {
    mode: 'auto',
    requireApprovalTools: ['bash_run'],
  },
};
