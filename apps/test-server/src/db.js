import pg from 'pg';
import { config } from './config.js';

// Supabase richiede SSL; il certificato del pooler non è nella CA di sistema.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
});
