# KODE Agent SDK Examples

基于 KODE Agent SDK 开发的示例项目。

## 项目列表

### [kode_orch](./kode_orch/)

AI 智能助手编排系统。采用"编排器 + 子 Agent"架构，主 Agent 负责理解需求、拆解任务、派发执行，子 Agent 在后台异步执行具体任务。

**核心特性：**
- 多 Agent 协作（调研、分析、执行、审查、测试）
- 异步任务派发与全生命周期管理
- 优先级队列与资源限制
- Skill 扩展系统
- E2B 云沙箱 / 本地沙箱支持
- 实时 SSE 推送
- 敏感操作审批工作流

详见 [kode_orch/README.md](./kode_orch/README.md)
