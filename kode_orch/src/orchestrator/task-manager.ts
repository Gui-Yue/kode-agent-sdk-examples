import { TaskHistory, type Task } from '../memory/task-history.js';
import { generateId } from '../utils/id.js';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  constructor(private taskHistory: TaskHistory) {}

  createTask(agentType: string, intent: string): Task {
    const now = Date.now();
    const task: Task = {
      id: generateId(),
      status: 'pending',
      agentType,
      intent,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.taskHistory.save(task);
    return task;
  }

  updateStatus(taskId: string, status: Task['status'], data?: Partial<Task>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    task.updatedAt = Date.now();
    if (data) Object.assign(task, data);
    this.taskHistory.save(task);
  }

  updateContext(taskId: string, context: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.context = context;
    task.updatedAt = Date.now();
    this.taskHistory.save(task);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(): Task[] {
    return [...this.tasks.values()].filter(
      (t) => t.status === 'pending' || t.status === 'running' || t.status === 'waiting_approval',
    );
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') return false;
    this.updateStatus(taskId, 'cancelled');
    return true;
  }
}
