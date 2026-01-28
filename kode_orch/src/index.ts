import { AgentTemplateRegistry, SandboxFactory, AnthropicProvider, OpenAIProvider, GeminiProvider, type ModelProvider, globalToolRegistry } from '@shareai-lab/kode-sdk';
import { loadConfig, type AppConfig } from './config.js';
import { initStore } from './memory/store.js';
import { UserProfile } from './memory/user-profile.js';
import { TaskHistory } from './memory/task-history.js';
import { VectorStore } from './memory/vector-store.js';
import { MemoryManager } from './memory/memory-manager.js';
import { CompactionHandler } from './memory/compaction-handler.js';
import { SkillLoader } from './orchestrator/skill-loader.js';
import { TaskManager } from './orchestrator/task-manager.js';
import { ApprovalManager } from './orchestrator/approval.js';
import { ProgressTracker } from './orchestrator/progress-tracker.js';
import { BgTaskRunner } from './orchestrator/bg-task-runner.js';
import { AppSandboxFactory } from './sandbox/factory.js';
import { registerAllTemplates } from './agents/templates.js';
import { createOrchestrator, SUB_AGENT_TEMPLATES } from './orchestrator/main-agent.js';
import { registerBgTaskTools } from './tools/bg-task-run.js';
import { registerSandboxPreviewTool } from './tools/sandbox-preview.js';
import { ChatLock } from './orchestrator/chat-lock.js';
import { InjectionQueue } from './orchestrator/injection-queue.js';
import { isSafeCommand } from './orchestrator/safe-commands.js';
import { SSEManager } from './server/sse.js';
import { startServer } from './server/http-server.js';
import { logger } from './utils/logger.js';

function createProvider(config: AppConfig): ModelProvider {
  const p = config.primaryProvider;
  switch (p) {
    case 'anthropic':
      return new AnthropicProvider(config.anthropic!.apiKey, config.anthropic!.modelId, config.anthropic!.baseUrl);
    case 'openai':
      return new OpenAIProvider(config.openai!.apiKey, config.openai!.modelId, config.openai!.baseUrl);
    case 'gemini':
      return new GeminiProvider(config.gemini!.apiKey, config.gemini!.modelId);
    default:
      throw new Error(`Unknown provider: ${p}`);
  }
}

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  logger.info('main', 'Config loaded', { provider: config.primaryProvider });

  // 2. Create Provider
  const provider = createProvider(config);

  // 3. Create Store (PostgreSQL: SDK store + shared pool)
  const { sdkStore, pool } = await initStore(config.postgres, config.fileStoreDir);

  // 4. Initialize business objects (all using shared pg pool)
  const userProfile = new UserProfile(pool);
  const taskHistory = new TaskHistory(pool);
  const taskManager = new TaskManager(taskHistory);

  // 5. Initialize vector store (optional, same pg pool)
  let vectorStore: VectorStore | null = null;
  if (config.vectorCollection) {
    vectorStore = new VectorStore(pool, { collection: config.vectorCollection });
    try {
      await vectorStore.init();
    } catch (err) {
      logger.warn('main', 'Vector store init failed, continuing without it', err);
      vectorStore = null;
    }
  }

  // 6. Initialize memory manager
  const memoryManager = new MemoryManager(userProfile, taskHistory, vectorStore);

  // 7. Register sub-agent templates
  const templateRegistry = new AgentTemplateRegistry();
  registerAllTemplates(templateRegistry);

  // 8. Load skill index
  const skillLoader = new SkillLoader();
  await skillLoader.loadIndex('./skills');

  // 9. Create sandbox factory
  const sandboxFactory = new AppSandboxFactory(config.sandbox);

  // 10. Create SSE manager
  const sseManager = new SSEManager();

  // 11. Create progress tracker
  const progressTracker = new ProgressTracker(config.progress.intervalMs, (info) => {
    sseManager.send({ type: 'progress', data: info });
  });

  // 12. Create approval manager (before BgTaskRunner since onPermission uses it)
  const approvalManager = new ApprovalManager();

  // 13. Register sandbox_preview tool + Create BgTaskRunner
  registerSandboxPreviewTool();

  const bgDeps = {
    store: sdkStore,
    templateRegistry,
    toolRegistry: globalToolRegistry,
    sandboxFactory: new SandboxFactory(),
  };
  const bgTaskRunner = new BgTaskRunner(bgDeps, provider, sandboxFactory, (task) => {
    sseManager.send({
      type: 'progress',
      data: {
        taskId: task.id,
        templateId: task.templateId,
        status: task.status,
        description: task.description,
        result: task.result,
        error: task.error,
        cancelReason: task.cancelReason,
        sandboxUrl: task.sandboxUrl,
        sandboxAlive: task.sandboxAlive,
        elapsed: Date.now() - task.startTime,
      },
    });
  }, (task, event) => {
    const call = event.call;

    // E2B 沙箱中运行 → 全自动审批（隔离环境，无风险）
    if (config.sandbox.kind === 'e2b') {
      logger.info('main', 'E2B sandbox: auto-approved', { taskId: task.id, tool: call.name });
      event.respond('allow', { note: 'auto-approved: e2b sandbox' });
      return;
    }

    // 本地沙箱 → 白名单过滤
    if (call.name === 'bash_run') {
      logger.info('main', 'Local sandbox: bash_run permission check', { taskId: task.id, inputPreview: JSON.stringify(call.inputPreview) });
      if (isSafeCommand(call.inputPreview)) {
        logger.info('main', 'Auto-approved safe command', { taskId: task.id, tool: call.name });
        event.respond('allow', { note: 'auto-approved: safe command' });
        return;
      }
    }

    // 其他情况 → 请求人工审批
    approvalManager.add({
      taskId: task.id,
      permissionId: call.id,
      toolName: call.name,
      inputPreview: call.inputPreview,
      description: `${task.description} → ${call.name}`,
      createdAt: Date.now(),
      respond: event.respond,
    });
    sseManager.send({
      type: 'approval_needed',
      data: {
        taskId: task.id,
        permissionId: call.id,
        toolName: call.name,
        inputPreview: call.inputPreview,
        description: task.description,
      },
    });
  }, config.bgTasks);
  registerBgTaskTools(bgTaskRunner, SUB_AGENT_TEMPLATES, skillLoader);

  // 14. Create ChatLock
  const chatLock = new ChatLock();

  // 15. Create orchestrator agent
  const sandbox = await sandboxFactory.create();
  const agent = await createOrchestrator({
    sdkStore,
    provider,
    sandbox,
    templateRegistry,
    skillLoader,
    memoryManager,
  });

  // 16. Create InjectionQueue and wire to BgTaskRunner
  const injectionQueue = new InjectionQueue(agent, sseManager, chatLock);
  bgTaskRunner.setInjectionQueue(injectionQueue);

  // 17. Register compaction handler
  const compactionHandler = new CompactionHandler(memoryManager, taskManager);
  agent.on('context_compression', async (event: any) => {
    if (event.phase === 'start') {
      await compactionHandler.onBeforeCompaction(event.compressedMessages ?? []);
    } else if (event.phase === 'end') {
      await compactionHandler.onAfterCompaction(event.summary ?? '');
    }
  });

  // 18. Start HTTP server
  startServer(config.port, config.authToken, {
    agent,
    sdkStore,
    sseManager,
    approvalManager,
    taskManager,
    progressTracker,
    memoryManager,
    bgTaskRunner,
    chatLock,
  });

  logger.info('main', 'Orchestrator started successfully');
}

main().catch((err) => {
  logger.error('main', 'Fatal error', err);
  process.exit(1);
});
