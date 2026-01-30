# Research Squad - 自动调研小队

展示 KODE SDK 的 **AgentPool + sub-agent 委派 + Todo 追踪** 能力。

## 功能特点

- Leader Agent 拆解调研主题为子问题
- 使用 `task_run` 工具委派给 Researcher Agent
- Todo 列表实时追踪各子任务进度
- 最终汇总生成调研报告

## 典型使用场景

### 1. 技术选型调研

做技术决策前的信息收集：

- 框架对比（React vs Vue vs Svelte）
- 数据库选型（PostgreSQL vs MongoDB vs MySQL）
- 云服务商对比（AWS vs Azure vs GCP）
- 开源工具评估

```
🔬 主题: 对比 React 和 Vue 的状态管理方案
→ 拆解: Redux vs Pinia、学习曲线、生态系统、性能...
→ 各子任务并行调研 → 汇总对比报告
```

### 2. 行业/产品调研

快速了解某个领域或产品：

- 新兴技术趋势（AI Agent、Web3、边缘计算）
- 竞品分析
- 开源项目调研
- 市场动态追踪

### 3. 学习新技术

系统性地学习某项技术：

- 核心概念和原理
- 最佳实践和使用场景
- 常见问题和解决方案
- 社区资源和学习路径

### 4. 问题诊断

多角度分析复杂问题：

- 性能问题的可能原因
- 安全漏洞的影响范围
- 架构设计的优缺点

### 与手动调研的区别

| 手动调研 | Research Squad |
|---------|----------------|
| 单线程搜索 | 多子任务并行 |
| 容易跑偏 | Todo 追踪聚焦 |
| 信息零散 | 结构化报告 |
| 耗时长 | 自动化加速 |

## 快速开始

```bash
# 全局安装
npm install -g @shareai-lab/sdk-demo-research-squad

# 首次运行（自动进入交互式配置）
research-squad

# 重新配置
research-squad config
```

## 配置说明

- 全局配置：`~/.config/shareai-sdk-demos/research-squad/config.json`
- 本地数据：`./.sdk-demo-research-squad/`（与当前目录绑定）
- 兼容 `.env`：仍支持 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`

清理配置：

```bash
research-squad config clean
```

## 使用方式

输入调研主题，Leader 会自动拆解并委派任务：

```
🔬 请输入调研主题: 对比 React 和 Vue 的状态管理方案
```

### 命令

| 命令 | 说明 |
|------|------|
| `<调研主题>` | 开始新的调研任务 |
| `status` | 查看当前任务进度（Todo 列表） |
| `pool` | 查看 AgentPool 状态 |
| `exit` | 退出程序 |

### 示例

```
🔬 请输入调研主题: 分析微服务架构的优缺点

🎯 开始调研...

📝 更新任务列表...

📋 Todo 列表更新:
  ⏳ 调研微服务的核心概念和特点
  ⏳ 分析微服务架构的优点
  ⏳ 分析微服务架构的缺点
  ⏳ 总结适用场景和最佳实践

🔀 正在委派子任务...
🚀 子任务已启动: research-worker
✅ 子任务完成

📋 Todo 列表更新:
  ✅ 调研微服务的核心概念和特点
  🔄 分析微服务架构的优点
  ⏳ 分析微服务架构的缺点
  ⏳ 总结适用场景和最佳实践

... (继续执行)

## 📊 调研报告: 微服务架构分析

### 摘要
微服务是一种将应用拆分为小型独立服务的架构风格...

### 详细发现
#### 1. 核心概念
...
#### 2. 优点
...
#### 3. 缺点
...

### 结论与建议
...
```

## 架构设计

```
┌─────────────────────────────────────────┐
│              AgentPool                  │
├─────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    │
│  │   Leader    │    │  Researcher │    │
│  │  (调研组长)  │───▶│   (研究员)   │    │
│  └─────────────┘    └─────────────┘    │
│         │                  │            │
│         ▼                  ▼            │
│  ┌─────────────┐    ┌─────────────┐    │
│  │  Todo 追踪   │    │  子任务结果  │    │
│  └─────────────┘    └─────────────┘    │
└─────────────────────────────────────────┘
```

### Agent 职责

| Agent | 职责 |
|-------|------|
| **Leader** | 拆解问题、分配任务、汇总报告 |
| **Researcher** | 调研单个子问题、返回结构化结果 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | - |
| `OPENAI_API_KEY` | OpenAI API 密钥（可选） | - |
| `GEMINI_API_KEY` | Gemini API 密钥（可选） | - |
| `HTTPS_PROXY` | HTTPS 代理地址 | - |
| `HTTP_PROXY` | HTTP 代理地址 | - |
| `ALL_PROXY` | 通用代理地址 | - |

### 代理配置

在中国大陆使用时，如需访问 Google、GitHub 等被墙网站，可以配置代理：

```bash
# 方式1: 在 .env 文件中配置
HTTPS_PROXY=http://127.0.0.1:7890

# 方式2: 运行时指定
HTTPS_PROXY=http://127.0.0.1:7890 research-squad

# 方式3: 使用 socks5 代理
ALL_PROXY=socks5://127.0.0.1:1080 research-squad
```

配置代理后：
- 搜索工具可以使用 Google（默认使用 Bing，国内可直连）
- 可以访问 GitHub 等被墙网站的内容

## 数据存储

```
./.sdk-demo-research-squad/
├── data/
└── workspace/
    └── reports/
        └── [任务目录]/
```

## 核心代码

- `src/templates.ts` - Leader 和 Researcher 模板定义
- `src/tools.ts` - Web 搜索与任务委派工具
- `src/commands/run.ts` - AgentPool 创建和任务编排
- `src/cli.ts` - CLI 入口

## 卸载

```bash
research-squad clean
research-squad config clean
npm uninstall -g @shareai-lab/sdk-demo-research-squad
```
