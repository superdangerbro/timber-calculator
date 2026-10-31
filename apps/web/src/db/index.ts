import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DB = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: DB; sql: postgres.Sql } {
  // Neon's pooled endpoint (pgbouncer) does not support prepared statements.
  const sql = postgres(url, { max: 5, prepare: !/pooler|pgbouncer/.test(url), onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

const g = globalThis as unknown as { __timberDb?: { db: DB; sql: postgres.Sql } };

/** Lazily created process-wide connection (survives Next dev hot reloads). */
export function getDb(): DB {
  if (!g.__timberDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__timberDb = createDb(url);
  }
  return g.__timberDb.db;
}

export { schema };
