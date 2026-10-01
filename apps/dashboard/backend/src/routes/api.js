import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import { hasServiceRole, supabase } from '../db/supabaseClient.js';
import { adminIdentity, isAdminUser, loginThrottle, publicUsername, requireAdmin } from '../auth.js';
import {
  getCancellazioni,
  getHotspot,
  getKpi,
  getRiassegnazioni,
  getSerie,
  listAsl,
  listPrestazioni,
  listSettimane,
  parseUploadedCsv,
  simulate,
  upsertRows,
} from '../db/store.js';

const router = express.Router();
// Memory storage: nessun file residuo su disco (funziona anche nei container).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Error shape di contratto: { error: { code, message } } (AGENTS.md §5.1)
const err = (res, status, code, message) => res.status(status).json({ error: { code, message } });

const settimanaQuery = (req) => (typeof req.query.settimana === 'string' && req.query.settimana ? req.query.settimana : undefined);
// asl entra in un filtro PostgREST: solo id 1601xx o sigla di 2 lettere.
const aslQuery = (req) => (typeof req.query.asl === 'string' && /^(\d{6}|[A-Za-z]{2})$/.test(req.query.asl) ? req.query.asl : undefined);

router.get('/health', async (_req, res) => {
  try {
    const settimane = await listSettimane();
    res.json({ data: { status: 'ok', supabase: true, service_role: hasServiceRole, settimana_corrente: settimane[0]?.settimana ?? null, settimane: settimane.length, ultima_sync: settimane[0]?.sincronizzato_at ?? null } });
  } catch (e) { err(res, 503, 'supabase_error', e.message); }
});

// Settimane del dataset regionale sincronizzate (dalla più recente).
router.get('/settimane', async (_req, res) => {
  try {
    res.json({ data: await listSettimane() });
  } catch (e) { err(res, 500, 'settimane_error', e.message); }
});

// ── Auth admin singolo (Supabase Auth) ─────────────────────────────────────
// POST /auth/login {username, password} → { token, refresh_token, username, expires_in }.
// username deve coincidere con ADMIN_USER; la password è verificata da Supabase
// su ADMIN_EMAIL. Stesso messaggio per utente errato o password errata (no enumerazione).
const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

router.post('/auth/login', loginThrottle, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, 'validation_error', 'Nome utente e password sono obbligatori.');
  const { username, password } = parsed.data;
  const invalid = () => err(res, 401, 'invalid_credentials', 'Credenziali non valide. Riprova.');
  const { username: expectedUsername, email } = adminIdentity();
  if (!email) return err(res, 503, 'auth_unavailable', 'Login non configurato: manca ADMIN_EMAIL in backend/.env.');
  if (username !== expectedUsername) return invalid();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session) return invalid();
    if (!isAdminUser(data.session.user)) return invalid();
    res.json({
      data: {
        token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        username: publicUsername(data.session.user, expectedUsername),
        expires_in: data.session.expires_in ?? 3600,
      },
    });
  } catch (e) { err(res, 503, 'auth_error', `Login non riuscito: ${e.message}`); }
});

// POST /auth/refresh {refresh_token} → nuova coppia di token (ruolo riverificato).
router.post('/auth/refresh', async (req, res) => {
  const parsed = z.object({ refresh_token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return err(res, 400, 'validation_error', 'refresh_token obbligatorio.');
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: parsed.data.refresh_token });
    if (error || !data?.session) {
      return err(res, 401, 'invalid_session', 'Sessione scaduta: effettua di nuovo l’accesso.');
    }
    if (!isAdminUser(data.session.user)) {
      return err(res, 403, 'forbidden', 'Accesso riservato agli amministratori.');
    }
    res.json({
      data: {
        token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        username: publicUsername(data.session.user, adminIdentity().username),
        expires_in: data.session.expires_in ?? 3600,
      },
    });
  } catch (e) { err(res, 503, 'auth_error', `Refresh non riuscito: ${e.message}`); }
});

// GET /auth/me — verifica sessione (usata dal frontend all'avvio).
router.get('/auth/me', requireAdmin, (req, res) => {
  res.json({ data: { username: req.admin.username } });
});

// ── Letture pubbliche ──────────────────────────────────────────────────────
router.get('/asl', async (_req, res) => {
  try {
    const { rows } = await listAsl();
    res.json({ data: rows });
  } catch (e) { err(res, 500, 'asl_error', e.message); }
});

router.get('/prestazioni', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const { rows } = await listPrestazioni(q || undefined);
    res.json({ data: rows });
  } catch (e) { err(res, 500, 'prestazioni_error', e.message); }
});

router.get('/territorio/hotspot', async (req, res) => {
  try {
    const { rows, fonte, settimana } = await getHotspot(settimanaQuery(req));
    res.json({ data: rows, settimana, fonte });
  } catch (e) { err(res, 500, 'hotspot_error', e.message); }
});

router.get('/dashboard/kpi', async (req, res) => {
  try {
    res.json({ data: await getKpi(settimanaQuery(req)) });
  } catch (e) { err(res, 500, 'kpi_error', e.message); }
});

// Serie storica: un punto per settimana del dataset sincronizzata. Mai inventare punti (AGENTS.md §3).
router.get('/dashboard/serie', async (req, res) => {
  try {
    const prestazione = typeof req.query.prestazione === 'string' && req.query.prestazione ? req.query.prestazione : undefined;
    res.json({ data: await getSerie({ asl: aslQuery(req), prestazione }) });
  } catch (e) { err(res, 500, 'serie_error', e.message); }
});

// GET /dashboard/cancellazioni?da=&a=&specialty_id=&facility_id=
// Statistiche reali dal gestionale (appointments/cancellation_events).
// Default: ultimi 30 giorni. Senza Supabase: { disponibile: false }.
// Data ISO reale (il solo pattern \d{4}-\d{2}-\d{2} lascerebbe passare 2026-13-99,
// che Postgres rigetterebbe con 500 invece di 400).
const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const isoDate = z.string().refine(isRealDate, 'formato atteso yyyy-mm-dd (data calendario reale)');
const cancellazioniQuery = z.object({
  da: isoDate.optional(),
  a: isoDate.optional(),
  specialty_id: z.string().min(1).optional(),
  facility_id: z.string().min(1).optional(),
})
  .refine((v) => !v.da || !v.a || v.da <= v.a, { message: 'da deve essere <= a' })
  .refine((v) => {
    if (!v.da || !v.a) return true;
    return (new Date(`${v.a}T00:00:00Z`) - new Date(`${v.da}T00:00:00Z`)) / 864e5 <= 366;
  }, { message: 'intervallo massimo 366 giorni' });

router.get('/dashboard/cancellazioni', async (req, res) => {
  const parsed = cancellazioniQuery.safeParse(req.query);
  if (!parsed.success) {
    return err(res, 400, 'validation_error', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  try {
    res.json({ data: await getCancellazioni(parsed.data) });
  } catch (e) { err(res, 500, 'cancellazioni_error', e.message); }
});

// Riassegnazioni: ultime disdette del gestionale e se lo slot è stato riassegnato.
router.get('/riassegnazioni', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    res.json({ data: await getRiassegnazioni(limit) });
  } catch (e) { err(res, 500, 'riassegnazioni_error', e.message); }
});

// POST /simulatori/proiezione — valida da_asl != a_asl, ore 2..20 (come slider UI).
const proiezioneSchema = z.object({
  da_asl: z.string().min(2),
  a_asl: z.string().min(2),
  ore: z.coerce.number().int().min(2).max(20),
}).refine((v) => v.da_asl.trim().toUpperCase() !== v.a_asl.trim().toUpperCase(), {
  message: 'da_asl e a_asl devono essere diversi',
  path: ['a_asl'],
});

router.post('/simulatori/proiezione', async (req, res) => {
  const parsed = proiezioneSchema.safeParse(req.body);
  if (!parsed.success) {
    return err(res, 400, 'validation_error', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  try {
    res.json({ data: await simulate(parsed.data) });
  } catch (e) { err(res, e.status || 500, 'simulazione_error', e.message); }
});

// GET /export.csv — riusa gli stessi filtri delle GET JSON.
router.get('/export.csv', async (req, res) => {
  try {
    const asl = typeof req.query.asl === 'string' ? req.query.asl : undefined;
    const { rows, settimana } = await getHotspot(settimanaQuery(req));
    const filtered = asl
      ? rows.filter((r) => r.asl_id === asl || r.sigla.toLowerCase() === asl.toLowerCase())
      : rows;
    const csv = stringify(filtered.map((r) => ({
      asl_id: r.asl_id,
      sigla: r.sigla,
      settimana,
      prenotazioni: r.prenotazioni,
      da_garantire: r.da_garantire,
      fuori_tmax_tot: r.fuori_tmax_tot,
      fuori_tmax_pct: Number(r.fuori_tmax_pct.toFixed(4)),
      attesa_stimata_gg: r.attesa_stimata_gg,
    })), { header: true, delimiter: ',' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export_${settimana}.csv"`);
    res.send(csv);
  } catch (e) { err(res, 500, 'export_error', e.message); }
});

// POST /admin/import (multipart name=file) — SOLO admin autenticato.
// Upsert idempotente via service_role; senza service_role: dry-run di validazione.
// Di norma non serve: i dati arrivano dalla sync automatica con dati.puglia.it.
router.post('/admin/import', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return err(res, 400, 'validation_error', 'campo file mancante (multipart name=file)');
  try {
    const rows = parseUploadedCsv(req.file.buffer);
    const asls = new Set(rows.map((r) => r.asl_id).filter(Boolean));
    const prest = new Set(rows.map((r) => r.descrizione).filter(Boolean));
    if (!hasServiceRole) {
      return res.json({ data: { dry_run: true, righe: rows.length, asl_distinte: asls.size, prestazioni_distinte: prest.size, nota: 'service_role non configurata: nessuna scrittura, solo validazione' } });
    }
    res.json({ data: { dry_run: false, ...(await upsertRows(rows)) } });
  } catch (e) { err(res, 500, 'import_error', e.message); }
});

export default router;
