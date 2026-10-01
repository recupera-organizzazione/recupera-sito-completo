import { supabase } from './db/supabaseClient.js';

// Autenticazione admin singolo interamente su Supabase Auth (GoTrue).
// Niente password in public.admin_users (tabella conservata solo perché
// condivisa con recupera-test-server; la dashboard non la legge più).
// - login: l'UI invia {username, password}; username deve coincidere con
//   ADMIN_USER, la password è verificata da Supabase su ADMIN_EMAIL.
// - ruolo: app_metadata.role === 'admin' (scrivibile solo via Admin API con
//   service_role, mai dall'utente) — senza, 403 anche con token valido.
// - sessione: access_token + refresh_token emessi da Supabase (scadenza
//   configurata nel progetto, default 1h); refresh via POST /auth/refresh.

export function adminIdentity() {
  return {
    username: process.env.ADMIN_USER || 'admin',
    email: process.env.ADMIN_EMAIL || '',
  };
}

async function getUserFromToken(token) {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

export function isAdminUser(user) {
  return user?.app_metadata?.role === 'admin';
}

export function publicUsername(user, fallback) {
  return user?.user_metadata?.username || fallback || null;
}

// Middleware: protegge le rotte admin (es. POST /admin/import).
// 401 token mancante/scaduto/non valido, 403 token valido ma non admin.
// Shape { error: { code, message } } di contratto.
export async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Accesso riservato: effettua l’accesso come amministratore.' } });
    }
    const user = await getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Sessione scaduta o non valida: effettua di nuovo l’accesso.' } });
    }
    if (!isAdminUser(user)) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'Accesso riservato agli amministratori.' } });
    }
    req.admin = { id: user.id, username: publicUsername(user, adminIdentity().username) };
    next();
  } catch (e) {
    return res.status(503).json({ error: { code: 'auth_error', message: `Verifica sessione non riuscita: ${e.message}` } });
  }
}

// Throttle login anti brute-force: 10 tentativi / 5 min per IP (in-memory).
const attempts = new Map();
export function loginThrottle(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'sconosciuto';
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 5 * 60 * 1000;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  if (entry.count > 10) {
    return res.status(429).json({ error: { code: 'rate_limited', message: 'Troppi tentativi di accesso — riprova tra qualche minuto.' } });
  }
  next();
}
