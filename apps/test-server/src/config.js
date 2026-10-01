import 'dotenv/config';

function richiesta(nome) {
  const valore = process.env[nome];
  if (!valore) {
    throw new Error(`Variabile d'ambiente mancante: ${nome} (vedi .env.example)`);
  }
  return valore;
}

export const config = {
  databaseUrl: richiesta('DATABASE_URL'),
  jwtSecret: richiesta('JWT_SECRET'),
  jwtScadenza: '8h',
  port: Number(process.env.PORT ?? 3001),
  // Per il frontend di Prenota su /prenota (login Supabase Auth): URL e chiave anon, pubblica.
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  // Login admin come la dashboard: username atteso + email dell'account Supabase Auth con ruolo admin.
  adminUser: process.env.ADMIN_USER || 'admin',
  adminEmail: process.env.ADMIN_EMAIL,
};
