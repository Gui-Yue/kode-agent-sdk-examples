export interface IntentResult {
  category: 'research' | 'analysis' | 'execution' | 'review' | 'testing' | 'chat' | 'multi_step';
  confidence: number;
  agentType: string;
  reasoning: string;
}

export function buildIntentPrompt(userMessage: string, skillSummary: string): string {
  return `分析以下用户消息的意图，判断应该路由到哪个子 Agent。

可用的子 Agent：
- research-agent: 调研、搜索、信息收集
- analyst-agent: 需求分析、方案设计
- executor-agent: 执行具体任务（写代码、写文档、操作文件）
- reviewer-agent: 代码审查、方案评审、质量检查
- tester-agent: 运行测试、验证功能、检查结果

可用的 Skill：
${skillSummary}

用户消息：${userMessage}

如果是简单问答，回复 "none"（由 Orchestrator 直接回复）。
如果是复杂任务需要多步执行，主 Agent 自行规划，不需要路由。
请直接回复应该使用哪个 agent（仅回复 agent id，或 "none"）。`;
}
