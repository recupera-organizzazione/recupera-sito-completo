require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { supabase } = require('./supabase');
const { authenticate, requireRole, errorHandler } = require('./middleware');
const { bookAvailableSlot, cancelAppointment, joinWaitingList, raise } = require('./booking');

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await buildQuery().range(from, from + 499);
    raise(error);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const cspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
cspDirectives.connectSrc = ["'self'", new URL(process.env.SUPABASE_URL).origin];
// In locale si usa http: Safari applica upgrade-insecure-requests anche a localhost e
// chiederebbe CSS e JS in https (pagina senza stile). Resta attiva solo in produzione.
if (process.env.NODE_ENV !== 'production') cspDirectives['upgrade-insecure-requests'] = null;
app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Design system condiviso del sito completo (cartella design/ nella radice del monorepo).
app.use('/design', express.static(path.join(__dirname, '..', '..', '..', 'design')));
const origins = (process.env.CLIENT_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : false }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

const id = z.string().uuid();
const ref = z.string().trim().min(1).max(160);
const dateString = z.string().datetime({ offset: true });
const publicSlotsFrom = '2028-01-01T00:00:00.000Z';
const slotSearchSchema = z.object({ specialtyId: ref.optional(), facilityId: ref.optional(), from: dateString.optional(), to: dateString.optional() });
const slotSchema = z.object({
  specialtyId: ref, facilityId: ref, professionalId: ref.optional(), startAt: dateString, endAt: dateString
}).refine(v => new Date(v.endAt) > new Date(v.startAt), { message: 'endAt deve essere successivo a startAt.' });
const waitlistSchema = z.object({
  specialtyId: ref, facilityIds: z.array(ref).max(30).optional(), professionalIds: z.array(ref).max(30).optional(),
  earliestDate: dateString.optional(), latestDate: dateString.optional(), priorityScore: z.number().int().min(0).max(100).optional()
}).refine(v => !v.earliestDate || !v.latestDate || new Date(v.latestDate) >= new Date(v.earliestDate), { message: 'Intervallo date non valido.' });

app.get('/client-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || ''
  });
});

app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase.from('slots').select('id', { count: 'exact', head: true }).limit(1);
    if (error) return res.status(503).json({ status: 'unavailable' });
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});
app.use('/api', authenticate);

app.get('/api/slots', requireRole('patient', 'operator', 'admin'), async (req, res, next) => {
  try {
    const parsed = slotSearchSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Filtri di ricerca non validi.' });
    const filters = parsed.data;
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) return res.status(400).json({ error: 'Intervallo date non valido.' });
    const startAt = filters.from && new Date(filters.from) > new Date(publicSlotsFrom) ? filters.from : publicSlotsFrom;
    let query = supabase.from('slots').select('id,specialty_id,facility_id,professional_id,starts_at,ends_at')
      .eq('status', 'available').gte('starts_at', startAt);
    if (filters.specialtyId) query = query.eq('specialty_id', filters.specialtyId);
    if (filters.facilityId) query = query.eq('facility_id', filters.facilityId);
    if (filters.to) query = query.lte('starts_at', filters.to);
    const { data: found, error } = await query.order('starts_at').limit(100);
    raise(error);
    // Gli slot con una proposta di anticipo in sospeso sono riservati a chi l'ha ricevuta.
    const { data: offered, error: offerError } = found.length
      ? await supabase.from('slot_offers').select('slot_id').eq('status', 'pending').in('slot_id', found.map(v => v.id))
      : { data: [], error: null };
    raise(offerError);
    const reserved = new Set(offered.map(v => v.slot_id));
    const data = found.filter(v => !reserved.has(v.id));
    res.json({ items: data.map(v => ({ id: v.id, specialtyId: v.specialty_id, facilityId: v.facility_id, professionalId: v.professional_id, startAt: v.starts_at, endAt: v.ends_at })) });
  } catch (err) { next(err); }
});

app.post('/api/slots', requireRole('operator', 'admin'), async (req, res, next) => {
  try {
    const data = slotSchema.parse(req.body);
    if (new Date(data.startAt) <= new Date()) return res.status(400).json({ error: 'Lo slot deve essere futuro.' });
    const row = {
      specialty_id: data.specialtyId, facility_id: data.facilityId, professional_id: data.professionalId || null,
      starts_at: data.startAt, ends_at: data.endAt, status: 'available'
    };
    const { data: inserted, error } = await supabase.from('slots').insert(row).select('id').single();
    raise(error);
    const { data: createdSlot, error: lookupError } = await supabase.from('slots').select('status,appointment_id').eq('id', inserted.id).single();
    raise(lookupError);
    res.status(201).json({ slotId: inserted.id, status: createdSlot.status, appointmentId: createdSlot.appointment_id, allocatedFromWaitlist: Boolean(createdSlot.appointment_id) });
  } catch (err) { next(err); }
});

app.post('/api/slots/:slotId/book', requireRole('patient', 'operator', 'admin'), async (req, res, next) => {
  try {
    const slotId = id.parse(req.params.slotId);
    const patientId = req.user.role === 'patient' ? req.user.uid : id.parse(req.body.patientId);
    res.status(201).json(await bookAvailableSlot(slotId, patientId));
  } catch (err) { next(err); }
});

app.post('/api/appointments/:appointmentId/cancel', requireRole('patient', 'operator', 'admin'), async (req, res, next) => {
  try { res.json(await cancelAppointment(id.parse(req.params.appointmentId), req.user)); }
  catch (err) { next(err); }
});

app.post('/api/waitlist', requireRole('patient', 'operator', 'admin'), async (req, res, next) => {
  try {
    const data = waitlistSchema.parse(req.body);
    if (req.user.role === 'patient' && data.priorityScore !== undefined) return res.status(403).json({ error: 'La priorità è assegnata da personale autorizzato.' });
    const patientId = req.user.role === 'patient' ? req.user.uid : id.parse(req.body.patientId);
    res.status(201).json(await joinWaitingList(data, patientId));
  } catch (err) { next(err); }
});

app.delete('/api/waitlist/:entryId', requireRole('patient', 'operator', 'admin'), async (req, res, next) => {
  try {
    const entryId = id.parse(req.params.entryId);
    let query = supabase.from('waiting_list').update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('id', entryId).eq('status', 'waiting');
    if (req.user.role === 'patient') query = query.eq('patient_id', req.user.uid);
    const { data, error } = await query.select('id').maybeSingle();
    raise(error);
    if (!data) return res.status(404).json({ error: 'Richiesta non trovata o non più in attesa.' });
    res.json({ withdrawn: true });
  } catch (err) { next(err); }
});

app.get('/api/waitlist/me', requireRole('patient'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('waiting_list').select('*').eq('patient_id', req.user.uid).order('created_at', { ascending: false }).limit(100);
    raise(error);
    res.json({ items: data.map(v => ({ id: v.id, specialtyId: v.specialty_id, facilityIds: v.facility_ids, professionalIds: v.professional_ids, earliestDate: v.earliest_at, latestDate: v.latest_at, priorityScore: v.priority_score, status: v.status, appointmentId: v.appointment_id, createdAt: v.created_at })) });
  } catch (err) { next(err); }
});

app.get('/api/appointments/me', requireRole('patient'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('appointments').select('*').eq('patient_id', req.user.uid).order('starts_at', { ascending: false }).limit(100);
    raise(error);
    res.json({ items: data.map(v => ({ id: v.id, slotId: v.slot_id, specialtyId: v.specialty_id, facilityId: v.facility_id, professionalId: v.professional_id, startAt: v.starts_at, endAt: v.ends_at, status: v.status, source: v.source })) });
  } catch (err) { next(err); }
});

app.get('/api/notifications/me', requireRole('patient'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', req.user.uid).order('created_at', { ascending: false }).limit(100);
    raise(error);
    res.json({ items: data.map(v => ({ id: v.id, type: v.type, appointmentId: v.appointment_id, slotId: v.slot_id, status: v.status, createdAt: v.created_at })) });
  } catch (err) { next(err); }
});

// Catalogo per le liste dei moduli: visite (branche) e sedi con ASL, dagli stessi id dei record.
app.get('/api/catalog', requireRole('patient', 'operator', 'regional_admin', 'admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('prenota_catalogo');
    raise(error);
    res.json(data);
  } catch (err) { next(err); }
});

// Proposte di anticipo: slot liberati da una disdetta proposti al paziente (vedi
// supabase/migrations/20261001230000_proposte_anticipo.sql). Il paziente accetta o rifiuta.
app.get('/api/offers/me', requireRole('patient'), async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('patient_slot_offers', { p_patient_id: req.user.uid });
    raise(error);
    res.json({ items: data || [] });
  } catch (err) { next(err); }
});

const offerOutcomes = {
  accepted: [200, null],
  rejected: [200, null],
  expired: [409, 'La proposta è scaduta: lo slot è passato al prossimo in attesa.'],
  already_answered: [409, 'Hai già risposto a questa proposta.'],
  slot_unavailable: [409, 'Lo slot non è più disponibile.'],
  appointment_inactive: [409, 'La prenotazione da anticipare non è più attiva.']
};
for (const [action, accept] of [['accept', true], ['reject', false]]) {
  app.post(`/api/offers/:offerId/${action}`, requireRole('patient'), async (req, res, next) => {
    try {
      const { data, error } = await supabase.rpc('respond_slot_offer', {
        p_offer_id: id.parse(req.params.offerId), p_patient_id: req.user.uid, p_accept: accept
      });
      raise(error);
      const [status, message] = offerOutcomes[data.status] || [500, 'Esito sconosciuto.'];
      if (message) return res.status(status).json({ error: message });
      res.json(data);
    } catch (err) { next(err); }
  });
}

app.get('/api/analytics/summary', requireRole('regional_admin', 'admin'), async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return res.status(400).json({ error: 'Intervallo date non valido.' });
    const [cancellations, createdAppointments, waiting, availableSlots] = await Promise.all([
      fetchAll(() => supabase.from('cancellation_events').select('specialty_id,facility_id,reallocated').gte('cancelled_at', from.toISOString()).lte('cancelled_at', to.toISOString())),
      fetchAll(() => supabase.from('appointments').select('specialty_id,facility_id').gte('created_at', from.toISOString()).lte('created_at', to.toISOString())),
      fetchAll(() => supabase.from('waiting_list').select('specialty_id,facility_ids').eq('status', 'waiting').lte('created_at', to.toISOString())),
      fetchAll(() => supabase.from('slots').select('specialty_id,facility_id').eq('status', 'available').gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString()))
    ]);
    const groups = {};
    const group = (specialtyId, facilityId) => {
      const key = `${specialtyId || 'n/d'}|${facilityId || 'n/d'}`;
      return groups[key] ||= { specialtyId: specialtyId || null, facilityId: facilityId || null, cancellations: 0, reallocations: 0, bookings: 0, waiting: 0, availableSlots: 0 };
    };
    cancellations.forEach(v => { const g = group(v.specialty_id, v.facility_id); g.cancellations++; if (v.reallocated) g.reallocations++; });
    createdAppointments.forEach(v => group(v.specialty_id, v.facility_id).bookings++);
    waiting.forEach(v => group(v.specialty_id, v.facility_ids?.[0]).waiting++);
    availableSlots.forEach(v => group(v.specialty_id, v.facility_id).availableSlots++);
    res.json({ period: { from: from.toISOString(), to: to.toISOString() }, groups: Object.values(groups) });
  } catch (err) { next(err); }
});

app.post('/api/analytics/simulate', requireRole('regional_admin', 'admin'), async (req, res, next) => {
  try {
    const schema = z.object({ scenarios: z.array(z.object({ specialtyId: ref, facilityId: ref, additionalSlots: z.number().int().min(-10000).max(10000) })).min(1).max(200) });
    const { scenarios } = schema.parse(req.body);
    const data = await fetchAll(() => supabase.from('waiting_list').select('specialty_id,facility_ids').eq('status', 'waiting'));
    const counts = {};
    data.forEach(v => (v.facility_ids?.length ? v.facility_ids : ['any']).forEach(facilityId => {
      const key = `${v.specialty_id}|${facilityId}`; counts[key] = (counts[key] || 0) + 1;
    }));
    res.json({ methodology: 'Stima statica: ogni slot aggiuntivo assorbe una persona in lista; non considera durata, priorità clinica, vincoli professionali o sovrapposizioni.', results: scenarios.map(s => {
      const before = counts[`${s.specialtyId}|${s.facilityId}`] || counts[`${s.specialtyId}|any`] || 0;
      return { ...s, estimatedWaitingBefore: before, estimatedWaitingAfter: Math.max(0, before - s.additionalSlots), estimatedUnfilledCapacity: Math.max(0, s.additionalSlots - before) };
    }) });
  } catch (err) { next(err); }
});

app.use(errorHandler);
const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`ReCupera API in ascolto sulla porta ${port}`));
module.exports = app;
