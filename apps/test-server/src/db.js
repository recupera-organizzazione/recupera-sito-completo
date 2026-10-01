import pg from 'pg';
import { config } from './config.js';

// Supabase richiede SSL. Con DATABASE_CA (certificato CA di Supabase: Dashboard > Database > SSL)
// il certificato del server viene verificato; senza, la connessione è cifrata ma non verificata.
// Su Vercel (funzioni serverless) usa la stringa del Transaction pooler (porta 6543) e un pool piccolo.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA.replace(/\\n/g, '\n') } : { rejectUnauthorized: false },
  max: process.env.VERCEL ? 2 : 5,
});
