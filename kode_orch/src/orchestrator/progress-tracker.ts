export interface ProgressInfo {
  taskId: string;
  percent: number;
  stage: string;
  message: string;
  startedAt: number;
  elapsed: number;
  estimatedRemaining?: number;
}

export class ProgressTracker {
  private tasks: Map<string, ProgressInfo> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private intervalMs: number,
    private onProgress: (info: ProgressInfo) => void,
  ) {}

  start(taskId: string, initialStage: string): void {
    const info: ProgressInfo = {
      taskId,
      percent: 0,
      stage: initialStage,
      message: `开始执行: ${initialStage}`,
      startedAt: Date.now(),
      elapsed: 0,
    };
    this.tasks.set(taskId, info);

    const timer = setInterval(() => {
      const current = this.tasks.get(taskId);
      if (current) {
        current.elapsed = Date.now() - current.startedAt;
        this.onProgress(current);
      }
    }, this.intervalMs);
    this.timers.set(taskId, timer);
  }

  update(taskId: string, percent: number, stage: string, message: string): void {
    const info = this.tasks.get(taskId);
    if (!info) return;
    info.percent = percent;
    info.stage = stage;
    info.message = message;
    info.elapsed = Date.now() - info.startedAt;
    this.onProgress(info);
  }

  finish(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) clearInterval(timer);
    this.timers.delete(taskId);
    this.tasks.delete(taskId);
  }

  getAll(): ProgressInfo[] {
    return [...this.tasks.values()];
  }
}
