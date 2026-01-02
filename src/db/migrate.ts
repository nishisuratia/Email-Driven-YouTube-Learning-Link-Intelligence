import { readFileSync } from 'fs';
import { join } from 'path';
import { query } from './connection';
import { logger } from '../utils/logger';

async function runMigrations() {
  try {
    logger.info('Running database migrations...');
    
    const migrationFile = join(__dirname, 'migrations', '001_initial_schema.sql');
    const sql = readFileSync(migrationFile, 'utf-8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.trim()) {
        await query(statement);
      }
    }
    
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigrations };

