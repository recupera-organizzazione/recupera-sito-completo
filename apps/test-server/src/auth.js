import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { ApiError } from './errors.js';

// Admin condivisi con la dashboard, stesso comportamento di recupera-dashboard/backend/src/auth.js:
// l'UI invia {username, password}; username deve coincidere con ADMIN_USER, la password è
// verificata da Supabase Auth (GoTrue) su ADMIN_EMAIL e l'utente deve avere
// app_metadata.role === 'admin' (scrivibile solo via Admin API con service_role).
// Ritorna l'utente Supabase, oppure null se credenziali o ruolo non validi.
export async function verificaAdmin(username, password) {
  if (!config.adminEmail || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new ApiError(503, 'login_non_configurato', 'Login non configurato: servono ADMIN_EMAIL, SUPABASE_URL e SUPABASE_ANON_KEY nel .env');
  }
  if (username !== config.adminUser) return null;
  const risposta = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.adminEmail, password }),
  });
  if (!risposta.ok) return null;
  const { user } = await risposta.json();
  return user?.app_metadata?.role === 'admin' ? user : null;
}

export function firmaToken(admin) {
  return jwt.sign({ sub: admin.id, username: admin.username, ruolo: 'admin' }, config.jwtSecret, {
    expiresIn: config.jwtScadenza,
  });
}

// Middleware: richiede header "Authorization: Bearer <token>" di un admin.
export function soloAdmin(req, res, next) {
  const [schema, token] = (req.get('authorization') ?? '').split(' ');
  if (schema !== 'Bearer' || !token) {
    throw new ApiError(401, 'non_autenticato', 'Login richiesto');
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.admin = { id: payload.sub, username: payload.username };
  } catch {
    throw new ApiError(401, 'token_non_valido', 'Token non valido o scaduto');
  }
  next();
}
