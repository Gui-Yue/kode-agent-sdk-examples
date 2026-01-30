# KODE Agent SDK Examples

基于 KODE Agent SDK 开发的示例项目，展示 SDK 的各种核心能力。

## 项目列表

### [kode_orch](./kode_orch/)

**AI 智能助手编排系统** - 采用"编排器 + 子 Agent"架构，主 Agent 负责理解需求、拆解任务、派发执行，子 Agent 在后台异步执行具体任务。

核心特性：
- 多 Agent 协作（调研、分析、执行、审查、测试）
- 异步任务派发与全生命周期管理
- 优先级队列与资源限制
- Skill 扩展系统
- E2B 云沙箱 / 本地沙箱支持

---

### [research-squad](./research-squad/)

**自动调研小队** - 展示 AgentPool + sub-agent 委派 + Todo 追踪能力。

核心特性：
- Leader Agent 拆解调研主题为子问题
- 使用 `task_run` 工具委派给 Researcher Agent 并行调研
- Todo 列表实时追踪各子任务进度
- 最终汇总生成可视化调研报告（Mermaid 图表 + 对比表格）

典型场景：技术选型调研、行业分析、产品竞品调研

---

### [dev-squad](./dev-squad/)

**三人开发小队** - 展示 Room + @mention 多 Agent 协作能力。

核心特性：
- 三个 Agent 协作：Planner 设计、Coder 实现、Tester 验证
- 通过 `@mention` 机制自动流转任务
- 设计阶段需要用户审批
- 验证不通过自动打回修复，形成完整迭代闭环

典型场景：算法函数开发、工具函数库开发、快速原型验证

---

### [memory-agent](./memory-agent/)

**持久记忆助手** - 展示 SqliteStore 持久化 + resume 恢复 + 自定义记忆工具能力。

核心特性：
- 跨会话记住用户的偏好、事实、待办等信息
- 使用 SqliteStore 持久化存储
- 支持进程中断后恢复（resume）
- 4 个自定义记忆管理工具

典型场景：个人编程助手、项目开发助手、学习笔记助手

---

### [skill-plugin](./skill-plugin/)

**可插拔技能系统** - 展示 SkillsManager + SKILL.md 技能包能力。

核心特性：
- 技能是 Markdown 格式的指令包（SKILL.md）
- 使用 SkillsManager 自动扫描和加载技能
- 运行时动态激活技能，注入到对话上下文
- 完全可插拔，用户可自定义技能

典型场景：团队规范沉淀、运维操作手册、代码生成模板

---

### [system-patrol](./system-patrol/)

**系统巡检助手** - 展示 Scheduler + 自定义工具的主动式服务能力。

核心特性：
- 定时自动执行系统巡检（磁盘、进程、Git、日志）
- 4 个自定义巡检工具，使用 `defineTool` 创建
- 生成 Markdown 格式的结构化巡检报告
- 支持用户追问报告细节

典型场景：开发环境健康检查、服务器日常巡检

---

## 快速开始

### 方式一：npx 直接运行（推荐）

发布到 npm 后，可以直接使用 npx 运行，无需克隆仓库：

```bash
# 自动调研小队
npx @shareai-lab/sdk-demo-research-squad

# 三人开发小队
npx @shareai-lab/sdk-demo-dev-squad

# 持久记忆助手
npx @shareai-lab/sdk-demo-memory-agent

# 可插拔技能系统
npx @shareai-lab/sdk-demo-skill-agent

# 系统巡检助手
npx @shareai-lab/sdk-demo-system-patrol
```

首次运行会交互式引导配置 API Key 和模型。

### 方式二：全局安装

```bash
npm install -g @shareai-lab/sdk-demo-research-squad

# 然后直接运行
research-squad
```

### 方式三：克隆仓库本地运行

```bash
git clone https://github.com/anthropics/kode-agent-sdk-examples.git
cd kode-agent-sdk-examples/research-squad

# 安装依赖
npm install

# 运行
npm run start
```

## 配置

所有示例都支持两种配置方式：

### 交互式配置（推荐）

```bash
research-squad config
```

首次运行时也会自动引导配置。

### 环境变量

```bash
export ANTHROPIC_API_KEY=sk-xxx
export MODEL_ID=claude-sonnet-4-20250514
```

或创建 `.env` 文件（参考各项目的 `.env.example`）。

## SDK 能力矩阵

| 示例项目 | AgentPool | Room | Todo | Store | Scheduler | Skill | 自定义工具 |
|---------|-----------|------|------|-------|-----------|-------|-----------|
| kode_orch | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| research-squad | ✅ | - | ✅ | - | - | - | ✅ |
| dev-squad | - | ✅ | - | - | - | - | - |
| memory-agent | - | - | - | ✅ | - | - | ✅ |
| skill-plugin | - | - | - | - | - | ✅ | ✅ |
| system-patrol | - | - | - | - | ✅ | - | ✅ |
