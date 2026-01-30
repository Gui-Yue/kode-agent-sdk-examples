# System Patrol Agent - 系统巡检助手

展示 KODE SDK 的 **Scheduler + 自定义工具** 主动式服务能力。

## 功能特点

- 定时自动执行系统巡检（磁盘、进程、Git、日志）
- 4 个自定义巡检工具，使用 `defineTool` 创建
- 生成 Markdown 格式的结构化巡检报告
- 支持用户追问报告细节

## 典型使用场景

### 1. 开发环境健康检查

保持开发机器的良好状态：

- 磁盘空间监控（避免编译失败、日志堆积）
- 高资源进程检测（定位卡顿原因）
- 代码仓库状态检查（未提交变更提醒）

```
💬 你: patrol
→ 检查磁盘、进程、Git 状态
→ 生成报告：磁盘使用 70%、有 3 个未提交文件
```

### 2. 服务器日常巡检

运维人员的辅助工具：

- 定时自动生成巡检报告
- 日志错误扫描和告警
- 服务进程状态监控
- 资源使用趋势观察

### 3. CI/CD 环境监控

构建环境的健康监测：

- 构建服务器资源使用
- 临时文件清理提醒
- 构建产物占用空间
- 依赖缓存状态

### 4. 问题诊断辅助

快速定位系统问题：

- 追问报告细节（"哪个进程内存最高？"）
- 对比历史状态变化
- 获取处理建议

### 与传统监控的区别

| 传统监控脚本 | System Patrol |
|------------|---------------|
| 固定格式输出 | 自然语言交互 |
| 只展示数据 | 可追问细节 |
| 单独运行 | 可集成到工作流 |
| 配置复杂 | 开箱即用 |

## 快速开始

```bash
# 全局安装
npm install -g @shareai-lab/sdk-demo-system-patrol

# 首次运行（自动进入交互式配置）
system-patrol

# 重新配置
system-patrol config
```

## 配置说明

- 全局配置：`~/.config/shareai-sdk-demos/system-patrol/config.json`
- 本地数据：`./.sdk-demo-system-patrol/`（与当前目录绑定）
- 兼容 `.env`：仍支持 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`

清理配置：

```bash
system-patrol config clean
```

## 使用方式

启动后 Agent 会立即执行初始巡检，之后按配置的间隔自动执行。

### 命令

| 命令 | 说明 |
|------|------|
| `patrol` | 立即执行一次巡检 |
| 任意问题 | 追问巡检报告细节 |
| `exit` | 退出程序 |

### 示例

```
💬 输入命令或问题: patrol

🔄 手动触发巡检...

🔧 调用工具: check_disk
✅ 工具完成: check_disk
🔧 调用工具: check_processes
✅ 工具完成: check_processes
🔧 调用工具: check_git
✅ 工具完成: check_git

### 📊 系统巡检报告

**巡检时间**: 2024-01-15 10:30:00
**整体状态**: ✅ 正常

#### 💾 磁盘状态
| 分区 | 使用率 | 可用空间 |
|------|--------|----------|
| /    | 45%    | 120GB    |

#### 🔄 进程状态
- 无高资源占用进程

#### 📁 Git 仓库状态
- 当前分支: main
- 未提交变更: 0

💬 输入命令或问题: 哪个进程内存占用最高？
```

## 自定义巡检工具

| 工具 | 功能 | 参数 |
|------|------|------|
| `check_disk` | 磁盘使用率检查 | `threshold`: 告警阈值 |
| `check_processes` | 高资源进程检查 | `topN`, `cpuThreshold`, `memThreshold` |
| `check_git` | Git 仓库状态 | `repoPath`: 仓库路径 |
| `check_logs` | 日志错误扫描 | `logPath`, `maxLines`, `maxResults` |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | - |
| `OPENAI_API_KEY` | OpenAI API 密钥 | - |
| `GEMINI_API_KEY` | Gemini API 密钥 | - |
| `AUTO_PATROL` | 是否启用自动巡检 | `false` |
| `PATROL_INTERVAL_MINUTES` | 自动巡检间隔（分钟） | `5` |
| `GIT_REPOS` | Git 仓库路径（逗号分隔） | `.` |
| `LOG_FILES` | 日志文件路径（逗号分隔） | - |
| `DISK_THRESHOLD` | 磁盘告警阈值(%) | `80` |
| `CPU_THRESHOLD` | CPU 告警阈值(%) | `80` |
| `MEM_THRESHOLD` | 内存告警阈值(%) | `80` |

## 数据存储

```
./.sdk-demo-system-patrol/
├── data/
└── workspace/
```

## 核心代码

- `src/checks.ts` - 4 个自定义巡检工具（使用 `defineTool`）
- `src/template.ts` - 巡检 Agent 模板
- `src/commands/run.ts` - Scheduler 配置和主程序
- `src/cli.ts` - CLI 入口

## 卸载

```bash
system-patrol clean
system-patrol config clean
npm uninstall -g @shareai-lab/sdk-demo-system-patrol
```
