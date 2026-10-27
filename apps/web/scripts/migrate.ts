import './env';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../src/db';

export async function runMigrations(url: string) {
  const { db, sql } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '..', 'drizzle') });
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  runMigrations(url).then(() => console.log('Migrations applied')).catch((e) => { console.error(e); process.exit(1); });
}
