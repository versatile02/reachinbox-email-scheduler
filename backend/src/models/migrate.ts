import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, closeDatabasePool } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[PostgreSQL:Migration] Applying schema definitions...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query('COMMIT');
    console.log('[PostgreSQL:Migration] Schema applied successfully.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[PostgreSQL:Migration] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Execute migration directly when run from CLI
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  runMigrations()
    .then(async () => {
      await closeDatabasePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[PostgreSQL:Migration] Fatal error:', err.message);
      await closeDatabasePool();
      process.exit(1);
    });
}
