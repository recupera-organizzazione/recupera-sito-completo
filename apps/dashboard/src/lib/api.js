// Client API per ReCUPera dashboard — Parte 2 data-layer completo
// Copre tutto il contratto AGENTS.md §5.1 (/api/v1, JSON).
// Base URL: VITE_API_BASE, altrimenti <base Vite>api/v1 = /dashboard/api/v1 nel sito completo
// (gateway → backend, oppure proxy Vite in dev, cfr. vite.config.js)
// Contratto errori backend: { error: { code, message } } o { error: string }

const API_BASE = (import.meta.env.VITE_API_BASE || `${import.meta.env.BASE_URL}api/v1`).replace(/\/$/, '');

// Sessione admin (Supabase Auth): access_token breve + refresh_token in
// sessionStorage (scadono con la scheda; mai in repo).
// Le credenziali non transitano mai qui: solo POST /auth/login le verifica.
const TOKEN_KEY = 'recupera_token';
const REFRESH_KEY = 'recupera_refresh_token';

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage non disponibile: sessione solo in memoria di pagina */
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* niente da pulire */
  }
}

function getRefreshToken() {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function setSession({ token, refresh_token }) {
  setToken(token);
  try {
    if (refresh_token) sessionStorage.setItem(REFRESH_KEY, refresh_token);
  } catch {
    /* storage non disponibile */
  }
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request(path, options = {}) {
  const doFetch = (token) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  let res = await doFetch(getToken());
  // 401 con refresh disponibile (e non su rotte /auth): un solo rinnovo + retry.
  if (res.status === 401 && !path.startsWith('/auth/') && getRefreshToken()) {
    if (await refreshSession()) {
      res = await doFetch(getToken());
    }
  }
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const message =
      body?.error?.message || body?.error || body?.message || `Errore HTTP ${res.status}`;
    const code = body?.error?.code || res.status;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message), {
      cause: { code, status: res.status, body },
    });
  }
  return body;
}

export function getHealth() {
  return request('/health');
}

// Auth admin singolo: login salva la sessione, logout la revoca lato client.
// getMe verifica la sessione all'avvio (gate in App.jsx).
export async function login(username, password) {
  const body = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const data = body?.data ?? body;
  if (!data?.token) throw new Error('Risposta di accesso non valida.');
  setSession(data);
  return { username: data.username };
}

// Rinnovo silenzioso: access_token Supabase breve, refresh automatico al primo 401.
async function refreshSession() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) throw new Error(`refresh ${res.status}`);
    const data = (await res.json().catch(() => null))?.data;
    if (!data?.token) throw new Error('refresh senza token');
    setSession(data);
    return true;
  } catch {
    clearToken();
    return false;
  }
}

export function logout() {
  clearToken();
}

export function getMe() {
  return request('/auth/me').then((body) => body?.data ?? body);
}

export function getAsl() {
  return request('/asl');
}

export function getPrestazioni(q) {
  return request(`/prestazioni${buildQuery({ q })}`);
}

export function getKpi(settimana) {
  return request(`/dashboard/kpi${buildQuery({ settimana })}`);
}

export function getSettimane() {
  return request('/settimane');
}

export function getSerie({ asl = '', prestazione = '' } = {}) {
  // Un punto per settimana del dataset regionale sincronizzata, mai punti inventati.
  return request(`/dashboard/serie${buildQuery({ asl, prestazione })}`);
}

export function getCancellazioni({ da = '', a = '' } = {}) {
  // Disdette giornaliere dal gestionale (default backend: ultimi 30 giorni)
  return request(`/dashboard/cancellazioni${buildQuery({ da, a })}`);
}

export function getHotspot(settimana) {
  return request(`/territorio/hotspot${buildQuery({ settimana })}`);
}

export function getRiassegnazioni(limit = 10) {
  return request(`/riassegnazioni${buildQuery({ limit })}`);
}

export function postProiezione({ da_asl, a_asl, ore }) {
  // Validazione client allineata a backend/zod + slider App.jsx (ore 2..20, da_asl != a_asl)
  if (!da_asl || !a_asl || ore == null) {
    return Promise.reject(new Error('Parametri mancanti: da_asl, a_asl e ore sono obbligatori'));
  }
  if (da_asl === a_asl) {
    return Promise.reject(new Error('da_asl e a_asl devono essere diversi'));
  }
  const oreNum = Number(ore);
  if (!Number.isFinite(oreNum) || oreNum < 2 || oreNum > 20) {
    return Promise.reject(new Error('ore deve essere tra 2 e 20'));
  }
  return request('/simulatori/proiezione', {
    method: 'POST',
    body: JSON.stringify({ da_asl, a_asl, ore: oreNum }),
  });
}

export function getExportUrl({ settimana = '', asl = '' } = {}) {
  // GET /export.csv riusa gli stessi filtri delle GET JSON + Content-Disposition: attachment
  return `${API_BASE}/export.csv${buildQuery({ settimana, asl })}`;
}

export async function postAdminImport(file) {
  // POST /admin/import multipart — solo admin (Bearer richiesto dal backend)
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/admin/import`, {
    method: 'POST',
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || body?.error || `Errore HTTP ${res.status}`);
  }
  return res.json();
}

export const apiConfig = { API_BASE };
