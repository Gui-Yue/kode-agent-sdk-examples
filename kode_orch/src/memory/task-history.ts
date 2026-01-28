import type pg from 'pg';

export interface Task {
  id: string;
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  agentType: string;
  intent: string;
  context?: string;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

export class TaskHistory {
  constructor(private pool: pg.Pool) {}

  async save(task: Task): Promise<void> {
    await this.pool.query(
      `INSERT INTO task_history (id, agent_type, intent, status, context, result, error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(id) DO UPDATE SET
         status = $4, context = $5, result = $6, error = $7, updated_at = $9`,
      [
        task.id,
        task.agentType,
        task.intent,
        task.status,
        task.context ?? null,
        task.result ?? null,
        task.error ?? null,
        task.createdAt,
        task.updatedAt,
      ],
    );
  }

  async getRecent(limit: number): Promise<Task[]> {
    const result = await this.pool.query(
      'SELECT * FROM task_history ORDER BY updated_at DESC LIMIT $1',
      [limit],
    );
    return result.rows.map(rowToTask);
  }

  async getById(id: string): Promise<Task | undefined> {
    const result = await this.pool.query('SELECT * FROM task_history WHERE id = $1', [id]);
    return result.rows[0] ? rowToTask(result.rows[0]) : undefined;
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    status: row.status as Task['status'],
    agentType: row.agent_type as string,
    intent: row.intent as string,
    context: (row.context as string) ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    result: (row.result as string) ?? undefined,
    error: (row.error as string) ?? undefined,
  };
}
