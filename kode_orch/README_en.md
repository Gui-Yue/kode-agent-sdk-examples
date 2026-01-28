# KODE Orchestrator

AI Assistant Orchestration System based on KODE SDK.

## Overview

KODE Orchestrator is a multi-agent collaboration framework using an "Orchestrator + Sub-Agent" architecture. The main agent (orchestrator) understands user requirements, breaks down tasks, dispatches execution, tracks progress, and summarizes results. Sub-agents execute specific tasks asynchronously in the background.

## Key Features

- **Multi-Agent Collaboration**: 5 specialized sub-agents (Research, Analyst, Executor, Reviewer, Tester)
- **Async Task Dispatch**: Returns immediately after dispatch, sub-agents run in background
- **Full Task Lifecycle Management**: Dispatch, query, cancel, retry, redo, mid-task instructions, continued conversation
- **Priority Queue**: Support for high/normal/low priority levels
- **Resource Limits**: Configurable tool call limits, interaction rounds, idle timeout
- **Skill System**: Extensible skill packages auto-injected to sub-agents
- **Sandbox Environment**: E2B cloud sandbox or local sandbox support
- **Real-time Updates**: Task status and agent output via SSE
- **Approval Workflow**: User confirmation required for sensitive operations

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with required settings

# Build
pnpm build

# Start
pnpm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 3000 |
| `AUTH_TOKEN` | API authentication token | - |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `ANTHROPIC_API_KEY` | Claude API Key | - |
| `E2B_API_KEY` | E2B sandbox API Key (optional) | - |
| `SANDBOX_TYPE` | Sandbox type (e2b/local) | local |

## Architecture

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
│  - Understand requirements, break down tasks        │
│  - Dispatch sub-agents, summarize results           │
└─────────────────────┬───────────────────────────────┘
                      │ bg_task_run / bg_task_chat
┌─────────────────────▼───────────────────────────────┐
│              BgTaskRunner (Task Scheduler)          │
│  - Priority queue, concurrency control              │
│  - Resource limits, result injection                │
└───┬─────────┬─────────┬─────────┬─────────┬────────┘
    │         │         │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│Research│ │Analyst│ │Executor│ │Reviewer│ │Tester │
│ Agent │ │ Agent │ │ Agent │ │ Agent │ │ Agent │
└───────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

## Sub-Agent Tools

| Tool | Description |
|------|-------------|
| `bg_task_run` | Async dispatch sub-agent for task execution |
| `bg_task_status` | Query task status |
| `bg_task_cancel` | Cancel a task |
| `bg_task_retry` | Retry a failed task |
| `bg_task_redo` | Redo a completed task with feedback |
| `bg_task_message` | Send additional instructions to running sub-agent |
| `bg_task_chat` | Continue conversation with completed sub-agent |

## License

MIT
