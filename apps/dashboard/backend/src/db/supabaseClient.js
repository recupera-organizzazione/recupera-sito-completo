import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Server-only. SERVICE_ROLE mai esposta al frontend (solo ANON via VITE_*).
// Supabase è l'unica fonte dati: senza URL e chiave il backend non parte.
// Con la sola ANON funzionano le letture pubbliche; auth, disdette e import
// richiedono SUPABASE_SERVICE_ROLE_KEY (GoTrue Admin API + tabelle senza policy anon).
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in backend/.env (vedi .env.example).');
}
if (!supabaseServiceKey) {
  console.warn('AVVISO: SUPABASE_SERVICE_ROLE_KEY assente — solo letture pubbliche, login e disdette non disponibili.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const hasServiceRole = Boolean(supabaseServiceKey);
