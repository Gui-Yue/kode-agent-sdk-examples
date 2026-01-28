import type pg from 'pg';

export class UserProfile {
  constructor(private pool: pg.Pool) {}

  async get(key: string): Promise<string | undefined> {
    const result = await this.pool.query('SELECT value FROM user_preferences WHERE key = $1', [key]);
    return result.rows[0]?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_preferences (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = $3`,
      [key, value, Date.now()],
    );
  }

  async getAll(): Promise<Record<string, string>> {
    const result = await this.pool.query('SELECT key, value FROM user_preferences');
    const prefs: Record<string, string> = {};
    for (const row of result.rows) {
      prefs[row.key] = row.value;
    }
    return prefs;
  }
}
