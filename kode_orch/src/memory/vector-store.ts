import type pg from 'pg';
import { generateId } from '../utils/id.js';
import { logger } from '../utils/logger.js';

export interface VectorConfig {
  collection: string;
}

export interface VectorDocument {
  id: string;
  content: string;
  metadata: {
    type: 'conversation_summary' | 'user_knowledge' | 'task_result';
    timestamp: number;
    tags?: string[];
  };
}

const INIT_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS vector_documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  type TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  tags TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vector_docs_collection ON vector_documents(collection);
CREATE INDEX IF NOT EXISTS idx_vector_docs_type ON vector_documents(type);
`;

export class VectorStore {
  private collection: string;

  constructor(private pool: pg.Pool, config: VectorConfig) {
    this.collection = config.collection;
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(INIT_SQL);
      logger.info('vector-store', `Connected to PostgreSQL pgvector, collection: ${this.collection}`);
    } finally {
      client.release();
    }
  }

  async add(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    const client = await this.pool.connect();
    try {
      for (const doc of docs) {
        await client.query(
          `INSERT INTO vector_documents (id, collection, content, type, timestamp, tags)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET content = $3, type = $4, timestamp = $5, tags = $6`,
          [doc.id, this.collection, doc.content, doc.metadata.type, doc.metadata.timestamp, doc.metadata.tags?.join(',') ?? ''],
        );
      }
    } finally {
      client.release();
    }
  }

  async query(text: string, topK = 5): Promise<VectorDocument[]> {
    // Without embedding, fall back to text similarity search (ts_rank)
    const result = await this.pool.query(
      `SELECT id, content, type, timestamp, tags
       FROM vector_documents
       WHERE collection = $1
       ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $2)) DESC
       LIMIT $3`,
      [this.collection, text, topK],
    );
    return result.rows.map(rowToDocument);
  }

  async queryWithFilter(
    text: string,
    filter: Record<string, unknown>,
    topK = 5,
  ): Promise<VectorDocument[]> {
    const conditions = ['collection = $1'];
    const params: unknown[] = [this.collection];
    let idx = 2;

    if (filter.type) {
      conditions.push(`type = $${idx}`);
      params.push(filter.type);
      idx++;
    }

    params.push(text, topK);
    const result = await this.pool.query(
      `SELECT id, content, type, timestamp, tags
       FROM vector_documents
       WHERE ${conditions.join(' AND ')}
       ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $${idx})) DESC
       LIMIT $${idx + 1}`,
      params,
    );
    return result.rows.map(rowToDocument);
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await this.pool.query(`DELETE FROM vector_documents WHERE id IN (${placeholders})`, ids);
  }
}

function rowToDocument(row: Record<string, unknown>): VectorDocument {
  return {
    id: row.id as string,
    content: row.content as string,
    metadata: {
      type: row.type as VectorDocument['metadata']['type'],
      timestamp: Number(row.timestamp),
      tags: row.tags ? String(row.tags).split(',').filter(Boolean) : undefined,
    },
  };
}

export function createVectorDocument(
  content: string,
  type: VectorDocument['metadata']['type'],
  tags?: string[],
): VectorDocument {
  return {
    id: generateId(),
    content,
    metadata: { type, timestamp: Date.now(), tags },
  };
}
