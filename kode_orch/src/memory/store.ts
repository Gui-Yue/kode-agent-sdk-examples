import pg from 'pg';
import { PostgresStore } from '@shareai-lab/kode-sdk';
import type { PgConfig } from '../config.js';
import { logger } from '../utils/logger.js';

const EXTRA_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  context TEXT,
  result TEXT,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL
);
`;

export interface StoreInstances {
  sdkStore: PostgresStore;
  pool: pg.Pool;
}

export async function initStore(pgConfig: PgConfig, fileStoreDir: string): Promise<StoreInstances> {
  // SDK store for Agent internal state
  const sdkStore = new PostgresStore(pgConfig, fileStoreDir);

  // Shared pool for our extra tables (user_preferences, task_history, vector_documents)
  const pool = new pg.Pool({
    host: pgConfig.host,
    port: pgConfig.port ?? 5432,
    database: pgConfig.database,
    user: pgConfig.user,
    password: pgConfig.password,
    ssl: pgConfig.ssl,
    max: pgConfig.max ?? 10,
  });

  // Create extra tables
  const client = await pool.connect();
  try {
    await client.query(EXTRA_TABLES_SQL);
  } finally {
    client.release();
  }

  logger.info('store', `Initialized PostgreSQL at ${pgConfig.host}:${pgConfig.port ?? 5432}/${pgConfig.database}`);
  return { sdkStore, pool };
}
