import express, { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';

// Frontend di Prenota (recupera-prenotazioni/public, copiato in public/prenota con
// scripts/importa-prenota.sh) servito dal test-server su /prenota, con le stesse API di
// recupera-prenotazioni/src/server.js: login Supabase Auth, prenotazione e disdetta con le
// funzioni del team Prenota (public.book_available_slot, public.cancel_appointment_and_reallocate).
// Gli utenti registrati qui sono utenti reali: le loro prenotazioni risultano "loggate".
// Errori nel formato di Prenota: { error: 'messaggio' }.

export const prenotaRouter = Router();
prenotaRouter.use(express.static(new URL('../../public/prenota', import.meta.url).pathname));

const id = z.uuid();
const ref = z.string().trim().min(1).max(160);
const dateString = z.iso.datetime({ offset: true });
const slotSchema = z.object({
  specialtyId: ref, facilityId: ref, professionalId: ref.optional(), startAt: dateString, endAt: dateString,
}).refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: 'endAt deve essere successivo a startAt.' });
const waitlistSchema = z.object({
  specialtyId: ref, facilityIds: z.array(ref).max(30).optional(), professionalIds: z.array(ref).max(30).optional(),
  earliestDate: dateString.optional(), latestDate: dateString.optional(), priorityScore: z.number().int().min(0).max(100).optional(),
}).refine((v) => !v.earliestDate || !v.latestDate || new Date(v.latestDate) >= new Date(v.earliestDate), { message: 'Intervallo date non valido.' });

class ErrorePrenota extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Stessa traduzione degli errori SQL di recupera-prenotazioni/src/booking.js
function erroreSql(err) {
  if (/not found/i.test(err.message)) return new ErrorePrenota(404, err.message);
  if (/not available|already|forbidden|cannot cancel|not active/i.test(err.message)) return new ErrorePrenota(409, err.message);
  return err;
}

prenotaRouter.get('/client-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ supabaseUrl: config.supabaseUrl ?? '', supabaseAnonKey: config.supabaseAnonKey ?? '' });
});

prenotaRouter.get('/health', (req, res) => res.json({ status: 'ok' }));

// Token Supabase verificato con l'API Auth (basta la chiave anon, niente service_role).
prenotaRouter.use('/api', async (req, res, next) => {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Token Supabase mancante.' });
  if (!config.supabaseUrl || !config.supabaseAnonKey) return res.status(503).json({ error: 'SUPABASE_URL o SUPABASE_ANON_KEY non configurati nel test-server.' });
  try {
    const risposta = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${match[1]}` },
    });
    if (!risposta.ok) return res.status(401).json({ error: 'Token Supabase non valido o scaduto.' });
    const utente = await risposta.json();
    req.user = { uid: utente.id, role: utente.app_metadata?.role || 'patient' };
    next();
  } catch {
    res.status(401).json({ error: 'Token Supabase non valido o scaduto.' });
  }
});

const ruolo = (...ruoli) => (req, res, next) => (ruoli.includes(req.user.role)
  ? next()
  : res.status(403).json({ error: 'Permessi insufficienti.' }));

// Prenota confronta prestazione e sede come testo esatto. Nel test-server si accettano anche testi
// approssimativi ("Cardiologia", "visita cardiologica", "Bari") e si salvano come nei record di test:
// branca della prestazione (specialty_id) e "Nome - Comune" della struttura (facility_id).
async function idPrestazione(testo) {
  const { rows } = await pool.query(
    `select branca from test_server.prestazioni
     where lower(branca) = lower($1) or descrizione ilike '%' || $1 || '%' or $1 ilike '%' || branca || '%'
     order by lower(branca) = lower($1) desc limit 1`,
    [testo],
  );
  return rows[0]?.branca ?? testo;
}
async function idStrutture(testi = []) {
  const ids = [];
  for (const testo of testi) {
    const { rows } = await pool.query(
      `select id from test_server.strutture where lower(id) = lower($1) or nome ilike '%' || $1 || '%' or comune ilike $1`,
      [testo],
    );
    ids.push(...(rows.length ? rows.map((r) => r.id) : [testo]));
  }
  return [...new Set(ids)];
}

const slotJson = (v) => ({ id: v.id, specialtyId: v.specialty_id, facilityId: v.facility_id, professionalId: v.professional_id, startAt: v.starts_at, endAt: v.ends_at });

prenotaRouter.get('/api/slots', ruolo('patient', 'operator', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `select id, specialty_id, facility_id, professional_id, starts_at, ends_at from public.slots
     where status = 'available' and starts_at >= now()
       and not exists (select 1 from public.slot_offers so where so.slot_id = slots.id and so.status = 'pending')
     order by starts_at limit 100`,
  );
  res.json({ items: rows.map(slotJson) });
});

prenotaRouter.post('/api/slots', ruolo('operator', 'admin'), async (req, res) => {
  const data = slotSchema.parse(req.body);
  if (new Date(data.startAt) <= new Date()) return res.status(400).json({ error: 'Lo slot deve essere futuro.' });
  const { rows } = await pool.query(
    `insert into public.slots (specialty_id, facility_id, professional_id, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, 'available') returning id`,
    [data.specialtyId, data.facilityId, data.professionalId ?? null, data.startAt, data.endAt],
  );
  res.status(201).json({ slotId: rows[0].id, status: 'available' });
});

prenotaRouter.post('/api/slots/:slotId/book', ruolo('patient', 'operator', 'admin'), async (req, res) => {
  const slotId = id.parse(req.params.slotId);
  const patientId = req.user.role === 'patient' ? req.user.uid : id.parse(req.body.patientId);
  try {
    const { rows } = await pool.query('select public.book_available_slot($1, $2) as esito', [slotId, patientId]);
    res.status(201).json(rows[0].esito);
  } catch (err) { throw erroreSql(err); }
});

prenotaRouter.post('/api/appointments/:appointmentId/cancel', ruolo('patient', 'operator', 'admin'), async (req, res) => {
  const appointmentId = id.parse(req.params.appointmentId);
  try {
    const { rows } = await pool.query('select public.cancel_appointment_and_reallocate($1, $2, $3) as esito',
      [appointmentId, req.user.uid, req.user.role]);
    res.json(rows[0].esito);
  } catch (err) { throw erroreSql(err); }
});

prenotaRouter.post('/api/waitlist', ruolo('patient', 'operator', 'admin'), async (req, res) => {
  const data = waitlistSchema.parse(req.body);
  if (req.user.role === 'patient' && data.priorityScore !== undefined) return res.status(403).json({ error: 'La priorità è assegnata da personale autorizzato.' });
  const patientId = req.user.role === 'patient' ? req.user.uid : id.parse(req.body.patientId);
  const { rows } = await pool.query(
    `insert into public.waiting_list (patient_id, specialty_id, facility_ids, professional_ids, earliest_at, latest_at, priority_score)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, status`,
    [patientId, await idPrestazione(data.specialtyId), await idStrutture(data.facilityIds), data.professionalIds ?? [],
      data.earliestDate ?? null, data.latestDate ?? null, data.priorityScore ?? 0],
  );
  res.status(201).json({ entryId: rows[0].id, status: rows[0].status });
});

prenotaRouter.delete('/api/waitlist/:entryId', ruolo('patient', 'operator', 'admin'), async (req, res) => {
  const entryId = id.parse(req.params.entryId);
  const { rows } = await pool.query(
    `update public.waiting_list set status = 'withdrawn', updated_at = now()
     where id = $1 and status = 'waiting' and ($2::uuid is null or patient_id = $2) returning id`,
    [entryId, req.user.role === 'patient' ? req.user.uid : null],
  );
  if (!rows.length) return res.status(404).json({ error: 'Richiesta non trovata o non più in attesa.' });
  res.json({ withdrawn: true });
});

prenotaRouter.get('/api/waitlist/me', ruolo('patient'), async (req, res) => {
  const { rows } = await pool.query(
    'select * from public.waiting_list where patient_id = $1 order by created_at desc limit 100', [req.user.uid]);
  res.json({ items: rows.map((v) => ({ id: v.id, specialtyId: v.specialty_id, facilityIds: v.facility_ids, professionalIds: v.professional_ids, earliestDate: v.earliest_at, latestDate: v.latest_at, priorityScore: v.priority_score, status: v.status, appointmentId: v.appointment_id, createdAt: v.created_at })) });
});

prenotaRouter.get('/api/appointments/me', ruolo('patient'), async (req, res) => {
  const { rows } = await pool.query(
    'select * from public.appointments where patient_id = $1 order by starts_at desc limit 100', [req.user.uid]);
  res.json({ items: rows.map((v) => ({ id: v.id, slotId: v.slot_id, specialtyId: v.specialty_id, facilityId: v.facility_id, professionalId: v.professional_id, startAt: v.starts_at, endAt: v.ends_at, status: v.status, source: v.source })) });
});

prenotaRouter.get('/api/notifications/me', ruolo('patient'), async (req, res) => {
  const { rows } = await pool.query(
    'select * from public.notifications where user_id = $1 order by created_at desc limit 100', [req.user.uid]);
  res.json({ items: rows.map((v) => ({ id: v.id, type: v.type, appointmentId: v.appointment_id, slotId: v.slot_id, status: v.status, createdAt: v.created_at })) });
});

// Catalogo per le liste dei moduli (stesso contratto di apps/prenota/src/server.js).
prenotaRouter.get('/api/catalog', ruolo('patient', 'operator', 'regional_admin', 'admin'), async (req, res) => {
  const { rows } = await pool.query('select public.prenota_catalogo() as catalogo');
  res.json(rows[0].catalogo);
});

// Proposte di anticipo (stesso contratto di apps/prenota/src/server.js).
prenotaRouter.get('/api/offers/me', ruolo('patient'), async (req, res) => {
  const { rows } = await pool.query('select public.patient_slot_offers($1) as items', [req.user.uid]);
  res.json({ items: rows[0].items });
});

const esitiProposta = {
  accepted: [200, null],
  rejected: [200, null],
  expired: [409, 'La proposta è scaduta: lo slot è passato al prossimo in attesa.'],
  already_answered: [409, 'Hai già risposto a questa proposta.'],
  slot_unavailable: [409, 'Lo slot non è più disponibile.'],
  appointment_inactive: [409, 'La prenotazione da anticipare non è più attiva.'],
};
for (const [azione, accetta] of [['accept', true], ['reject', false]]) {
  prenotaRouter.post(`/api/offers/:offerId/${azione}`, ruolo('patient'), async (req, res) => {
    const offerId = id.parse(req.params.offerId);
    let esito;
    try {
      ({ rows: [{ esito }] } = await pool.query('select public.respond_slot_offer($1, $2, $3) as esito', [offerId, req.user.uid, accetta]));
    } catch (err) { throw erroreSql(err); }
    const [status, messaggio] = esitiProposta[esito.status] ?? [500, 'Esito sconosciuto.'];
    if (messaggio) return res.status(status).json({ error: messaggio });
    res.json(esito);
  });
}

prenotaRouter.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.name === 'ZodError') return res.status(400).json({ error: 'Dati non validi.', details: err.issues });
  if (err instanceof ErrorePrenota) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Errore interno.' });
});
