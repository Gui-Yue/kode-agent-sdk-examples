# KODE Orchestrator

基于 KODE SDK 的 AI 智能助手编排系统。

## 简介

KODE Orchestrator 是一个多 Agent 协作框架，采用"编排器 + 子 Agent"架构。主 Agent（编排器）负责理解用户需求、拆解任务、派发执行、跟踪进度并汇总结果，子 Agent 在后台异步执行具体任务。

## 核心特性

- **多 Agent 协作**：支持 5 种专业子 Agent（调研、分析、执行、审查、测试）
- **异步任务派发**：任务派发后立即返回，子 Agent 在后台执行
- **任务全生命周期管理**：派发、查询、取消、重试、打回重做、中途追加指令、继续对话
- **优先级队列**：支持 high/normal/low 三级优先级
- **资源限制**：可配置工具调用次数、交互轮次、空闲超时
- **Skill 系统**：可扩展的技能包，自动注入给子 Agent
- **沙箱环境**：支持 E2B 云沙箱或本地沙箱
- **实时更新**：通过 SSE 推送任务状态和 Agent 输出
- **审批工作流**：敏感操作需用户确认

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填写必要配置

# 编译
pnpm build

# 启动
pnpm start
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | HTTP 服务端口 | 3000 |
| `AUTH_TOKEN` | API 认证 Token | - |
| `DATABASE_URL` | PostgreSQL 连接串 | - |
| `ANTHROPIC_API_KEY` | Claude API Key | - |
| `E2B_API_KEY` | E2B 沙箱 API Key（可选） | - |
| `SANDBOX_TYPE` | 沙箱类型 (e2b/local) | local |

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    Web UI                           │
└─────────────────────┬───────────────────────────────┘
                      │ HTTP/SSE
┌─────────────────────▼───────────────────────────────┐
│                 HTTP Server                         │
│  /api/chat  /api/events  /api/approval  /api/...   │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              Orchestrator (Main Agent)              │
│  - 理解需求、拆解任务、派发子 Agent                   │
│  - 汇总结果、回复用户                                │
└─────────────────────┬───────────────────────────────┘
                      │ bg_task_run / bg_task_chat
┌─────────────────────▼───────────────────────────────┐
│              BgTaskRunner (任务调度器)               │
│  - 优先级队列、并发控制、空闲超时                     │
│  - 资源限制、结果注入                                │
└───┬─────────┬─────────┬─────────┬─────────┬────────┘
    │         │         │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Research│ │Analyst│ │Executor│ │Reviewer│ │Tester │
│ Agent │ │ Agent │ │ Agent │ │ Agent │ │ Agent │
└───────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

## 子 Agent 工具

| 工具 | 说明 |
|------|------|
| `bg_task_run` | 异步派发子 Agent 执行任务 |
| `bg_task_status` | 查询任务状态 |
| `bg_task_cancel` | 取消任务 |
| `bg_task_retry` | 重试失败任务 |
| `bg_task_redo` | 打回已完成任务重做 |
| `bg_task_message` | 向运行中的子 Agent 追加指令 |
| `bg_task_chat` | 与已完成的子 Agent 继续对话 |

## License

MIT
