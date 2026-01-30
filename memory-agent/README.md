# Memory Agent - 持久记忆助手

展示 KODE SDK 的 **SqliteStore 持久化 + resume 恢复 + 自定义记忆工具** 能力。

## 功能特点

- 跨会话记住用户的偏好、事实、待办等信息
- 使用 SqliteStore 持久化存储
- 支持进程中断后恢复（resume）
- 4 个自定义记忆管理工具

## 典型使用场景

### 1. 个人编程助手

记住用户的开发习惯，提供个性化帮助：

- 技术栈偏好（TypeScript + React、Python + FastAPI 等）
- 代码风格（缩进、命名规范、注释习惯）
- 常用的库和框架选择
- 调试和测试偏好

```
💬 你: 我喜欢用 Tailwind CSS，不喜欢写内联样式
💬 你: 帮我写一个按钮组件
# Agent 会自动使用 Tailwind 而非内联样式
```

### 2. 项目开发助手

长期跟踪项目进展，保持上下文连贯：

- 项目架构和目录结构
- 已做的技术决策和原因
- 待办事项和开发进度
- 已知问题和解决方案

```
💬 你: 我们决定用 PostgreSQL 而不是 MongoDB，因为需要事务支持
# 下次讨论数据库相关问题时，Agent 会基于这个决策给建议
```

### 3. 长期客服/支持 Agent

为每个用户提供连续的服务体验：

- 客户的历史问题和解决方案
- 客户偏好和特殊需求
- 跨多次对话保持上下文
- 个性化的沟通风格

### 4. 知识管理助手

作为个人知识库的入口：

- 用户告诉它的事实和信息
- 学习笔记和文章摘要
- 会议记录和行动项
- 灵感和想法收集

### 与普通 Agent 的区别

| 普通 Agent | Memory Agent |
|-----------|--------------|
| 会话结束记忆丢失 | 永久保存关键信息 |
| 每次从零开始 | 了解用户背景和偏好 |
| 需要反复说明偏好 | 自动应用历史偏好 |
| 崩溃后丢失进度 | 可从断点恢复 |

## 快速开始

```bash
# 全局安装
npm install -g @shareai-lab/sdk-demo-memory-agent

# 首次运行（自动进入交互式配置）
memory-agent

# 重新配置
memory-agent config
```

## 配置说明

- 全局配置：`~/.config/shareai-sdk-demos/memory-agent/config.json`
- 本地数据：`./.sdk-demo-memory-agent/`（与当前目录绑定）
- 兼容 `.env`：仍支持 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`

清理配置：

```bash
memory-agent config clean
```

## 使用方式

### 基本对话

与 Agent 对话，它会自动识别并记住重要信息：

```
💬 你: 我主要用 TypeScript 和 React 开发前端

🔧 调用工具: memory_save
✅ 工具完成: memory_save

好的，我已经记住了您的技术栈偏好：TypeScript + React 前端开发。
```

### 命令

| 命令 | 说明 |
|------|------|
| `memories` | 列出所有已保存的记忆 |
| `interrupt` | 模拟中断（测试 resume） |
| `exit` | 正常退出 |
| `Ctrl+C` | 中断退出 |

### 启动参数

```bash
memory-agent           # 新会话（或自动恢复已有会话）
memory-agent --resume  # 强制恢复上次会话
memory-agent --reset   # 清除所有数据，重新开始
```

### 测试 Resume 功能

```bash
# 1. 第一次运行，告诉 Agent 一些信息
memory-agent
💬 你: 我的项目叫 TaskFlow，是一个任务管理工具
💬 你: interrupt
⚡ 模拟中断...

# 2. 恢复会话，验证记忆
memory-agent --resume
💬 你: 我之前告诉你什么了？

# Agent 应该能回忆起 TaskFlow 项目信息
```

## 记忆工具

| 工具 | 功能 |
|------|------|
| `memory_save` | 保存新记忆（支持类型：preference/fact/todo/context/other） |
| `memory_search` | 按关键词/标签/类型搜索记忆 |
| `memory_list` | 列出所有记忆，按类型分组 |
| `memory_delete` | 删除指定记忆 |

### 记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `preference` | 用户偏好 | 喜欢用 TypeScript |
| `fact` | 重要事实 | 项目名叫 TaskFlow |
| `todo` | 待办事项 | 需要完成登录功能 |
| `context` | 上下文信息 | 正在重构认证模块 |
| `other` | 其他 | - |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | - |
| `OPENAI_API_KEY` | OpenAI API 密钥 | - |
| `GEMINI_API_KEY` | Gemini API 密钥 | - |

## 数据存储

```
./.sdk-demo-memory-agent/
├── data/
│   ├── memory-agent.db      # SQLite 数据库（Agent 状态）
│   └── files/               # 事件流等文件数据
└── workspace/
    └── .memory/
        └── memories.json    # 记忆数据（自定义工具使用）
```

## 核心代码

- `src/tools.ts` - 4 个记忆管理工具（使用 `defineTool`）
- `src/template.ts` - 记忆 Agent 模板
- `src/commands/run.ts` - SqliteStore + resume 逻辑
- `src/cli.ts` - CLI 入口

## 卸载

```bash
memory-agent clean
memory-agent config clean
npm uninstall -g @shareai-lab/sdk-demo-memory-agent
```
