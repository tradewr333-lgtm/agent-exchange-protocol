import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(currentDir, 'schema.sql');

if (!process.env.DATABASE_URL) {
  console.log('AXP database migration skipped: DATABASE_URL is not set.');
  process.exit(0);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
});

try {
  const schema = readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('AXP database schema applied.');
} finally {
  await pool.end();
}

function shouldUseSsl() {
  if (process.env.PGSSLMODE === 'disable') {
    return false;
  }

  return !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '');
}
