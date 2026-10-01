import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { supabase } from './supabaseClient.js';

// Unica fonte dati: Supabase. Il dataset "Monitoraggio tempi di attesa" arriva in
// rilevazione_settimanale dalla sync con dati.puglia.it (dataset_fonte = settimane
// sincronizzate); prenotazioni e disdette dal gestionale (tabelle del team Prenota,
// popolate dal test-server). Nessun CSV locale letto a runtime.
//
// *_TMAX del dataset = prenotazioni ENTRO il tempo massimo (legenda ufficiale):
// "fuori_tmax" nelle viste = totale della classe - entro TMAX (migrazione 00003).

const toInt = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === '') return 0; // celle vuote → 0/NULL, mai crashare
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};

// Decodifica robusta per i CSV caricati a mano: UTF-8 stretto, altrimenti win1252.
export function decodeCsvBuffer(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return iconv.decode(buf, 'win1252');
  }
}

const normSettimana = (s) => String(s).trim().toUpperCase();

// Settimane del dataset presenti in Supabase, dalla più recente.
export async function listSettimane() {
  const { data, error } = await supabase.from('dataset_fonte')
    .select('settimana, anno, inizio, righe, sincronizzato_at')
    .order('inizio', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data;
}

export async function settimanaCorrente() {
  const settimane = await listSettimane();
  if (settimane.length === 0) throw new Error('nessuna settimana del dataset in Supabase (dataset_fonte vuota)');
  return settimane[0].settimana;
}

export async function listAsl() {
  const { data, error } = await supabase.from('asl').select('*').order('sigla');
  if (error) throw error;
  return { rows: data, fonte: 'supabase' };
}

export async function listPrestazioni(q) {
  let query = supabase.from('prestazione').select('id, id_prestazione, descrizione, codice').order('descrizione').limit(200);
  if (q) query = query.ilike('descrizione', `%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  return { rows: data, fonte: 'supabase' };
}

// Hotspot per ASL di una settimana (default: la più recente sincronizzata).
export async function getHotspot(settimana) {
  const s = settimana ? normSettimana(settimana) : await settimanaCorrente();
  const { data, error } = await supabase.from('kpi_territorio').select('*')
    .eq('settimana', s).order('fuori_tmax_pct', { ascending: false });
  if (error) throw error;
  return { rows: data, fonte: 'supabase', settimana: s };
}

export async function getKpi(settimana) {
  const { rows, fonte, settimana: s } = await getHotspot(settimana);
  const somma = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
  const conClasse = somma('totale_b_tot') + somma('totale_d_tot') + somma('totale_p_tot');
  const fuoriTmax = somma('fuori_tmax_tot');
  const zone = rows.filter((r) => r.fuori_tmax_pct > 0.5);
  const canc = await getCancellazioni({});
  return {
    settimana: s,
    fonte,
    prenotazioni: somma('prenotazioni'),
    da_garantire: somma('da_garantire'),
    fuori_tmax_tot: fuoriTmax,
    fuori_tmax_pct: conClasse ? fuoriTmax / conClasse : 0,
    zone_sotto_pressione: zone.map((r) => r.sigla),
    nota: 'fuori_tmax = prenotazioni B/D/P con appuntamento oltre il tempo massimo della classe; zone sotto pressione = ASL con oltre il 50% fuori tempo massimo',
    cancellazioni: {
      disponibile: true,
      periodo: canc.periodo,
      totale_prenotazioni: canc.totale_prenotazioni,
      totale_cancellate: canc.totale_cancellate,
      tasso_cancellazione_pct: canc.tasso_cancellazione_pct,
      slot_recuperati_riallocati: canc.slot_recuperati_riallocati,
    },
  };
}

// Cancellazioni dal gestionale prenotazioni (tabelle appointments /
// cancellation_events, via vista statistiche_cancellazioni).
// Gli zeri vengono riportati come tali, mai stimati.
export async function getCancellazioni({ da, a, specialty_id, facility_id } = {}) {
  const oggiISO = new Date().toISOString().slice(0, 10);
  const aISO = a || oggiISO;
  const shiftDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const daISO = da || shiftDays(aISO, -29);
  const periodo = { da: daISO, a: aISO };
  let q = supabase.from('statistiche_cancellazioni').select('*')
    .gte('giorno', daISO).lte('giorno', aISO).limit(5000);
  if (specialty_id) q = q.eq('specialty_id', specialty_id);
  if (facility_id) q = q.eq('facility_id', facility_id);
  const { data, error } = await q;
  if (error) throw error;

  // Prenotazioni per giorno di creazione (vista); disdette e riassegnazioni per giorno di
  // DISDETTA da cancellation_events (la vista le conta nel giorno di creazione della prenotazione).
  let ev = supabase.from('cancellation_events').select('cancelled_at, reallocated')
    .gte('cancelled_at', daISO).lt('cancelled_at', shiftDays(aISO, 1)).limit(5000);
  if (specialty_id) ev = ev.eq('specialty_id', specialty_id);
  if (facility_id) ev = ev.eq('facility_id', facility_id);
  const { data: eventi, error: evErr } = await ev;
  if (evErr) throw evErr;

  // Aggrega per giorno (somma su specialty/facility) e riempi i buchi con 0.
  const byDay = new Map();
  const giorno = (g) => byDay.get(g) || byDay.set(g, { giorno: g, prenotazioni: 0, cancellate: 0, da_riassegnazione: 0 }).get(g);
  for (const r of data || []) giorno(r.giorno).prenotazioni += r.prenotazioni;
  for (const e of eventi) {
    const g = giorno(e.cancelled_at.slice(0, 10));
    g.cancellate += 1;
    if (e.reallocated) g.da_riassegnazione += 1;
  }
  const serie = [];
  for (let g = daISO; g <= aISO; g = shiftDays(g, 1)) {
    serie.push(byDay.get(g) || { giorno: g, prenotazioni: 0, cancellate: 0, da_riassegnazione: 0 });
  }
  const totalePrenotazioni = serie.reduce((s, r) => s + r.prenotazioni, 0);
  const totaleCancellate = eventi.length;
  const recuperati = eventi.filter((e) => e.reallocated).length;

  return {
    disponibile: true,
    fonte: 'supabase',
    periodo,
    filtri: { specialty_id: specialty_id || null, facility_id: facility_id || null },
    totale_prenotazioni: totalePrenotazioni,
    totale_cancellate: totaleCancellate,
    tasso_cancellazione_pct: totalePrenotazioni ? totaleCancellate / totalePrenotazioni : 0,
    slot_recuperati_riallocati: recuperati,
    serie,
    nota: totaleCancellate === 0
      ? 'nessuna cancellazione registrata nel periodo (dati reali dal gestionale, non stima)'
      : 'dati reali dal gestionale prenotazioni (appointments/cancellation_events)',
  };
}

// Serie per settimana del dataset (una per risorsa sincronizzata), dalla più vecchia.
// asl: id 1601xx o sigla, già validato dalla route (entra in un filtro PostgREST).
export async function getSerie({ asl, prestazione } = {}) {
  const settimane = await listSettimane();
  const inizio = new Map(settimane.map((s) => [s.settimana, s.inizio]));
  let rows;
  if (prestazione) {
    const q = supabase.from('rilevazione_settimanale')
      .select('settimana, asl_id, prenotazioni, b_tot, b_fuori_tmax, d_tot, d_fuori_tmax, p_tot, p_fuori_tmax, prestazione!inner(descrizione), asl!inner(sigla)')
      .ilike('prestazione.descrizione', `%${prestazione}%`).limit(5000);
    const { data, error } = await q;
    if (error) throw error;
    const oltre = (tot, entro) => Math.max((tot || 0) - (entro || 0), 0);
    const perAsl = asl ? data.filter((r) => r.asl_id === asl || r.asl.sigla === asl.toUpperCase()) : data;
    rows = perAsl.map((r) => ({
      settimana: r.settimana,
      prenotazioni: r.prenotazioni || 0,
      fuori_tmax_tot: oltre(r.b_tot, r.b_fuori_tmax) + oltre(r.d_tot, r.d_fuori_tmax) + oltre(r.p_tot, r.p_fuori_tmax),
      con_classe: (r.b_tot || 0) + (r.d_tot || 0) + (r.p_tot || 0),
    }));
  } else {
    let q = supabase.from('kpi_territorio').select('settimana, asl_id, sigla, prenotazioni, fuori_tmax_tot, totale_b_tot, totale_d_tot, totale_p_tot');
    if (asl) q = q.or(`asl_id.eq.${asl},sigla.eq.${asl.toUpperCase()}`);
    const { data, error } = await q;
    if (error) throw error;
    rows = data.map((r) => ({
      settimana: r.settimana,
      prenotazioni: r.prenotazioni,
      fuori_tmax_tot: r.fuori_tmax_tot,
      con_classe: Number(r.totale_b_tot) + Number(r.totale_d_tot) + Number(r.totale_p_tot),
    }));
  }
  const perSettimana = new Map();
  for (const r of rows) {
    const p = perSettimana.get(r.settimana) || { settimana: r.settimana, inizio: inizio.get(r.settimana) ?? null, prenotazioni: 0, fuori_tmax_tot: 0, con_classe: 0 };
    p.prenotazioni += r.prenotazioni;
    p.fuori_tmax_tot += r.fuori_tmax_tot;
    p.con_classe += r.con_classe;
    perSettimana.set(r.settimana, p);
  }
  const punti = [...perSettimana.values()]
    .sort((a, b) => String(a.inizio).localeCompare(String(b.inizio)))
    .map(({ con_classe, ...p }) => ({ ...p, fuori_tmax_pct: con_classe ? p.fuori_tmax_tot / con_classe : 0 }));
  return {
    punti,
    nota: punti.length < 2
      ? 'dati insufficienti: una sola settimana sincronizzata dal dataset regionale'
      : `${punti.length} settimane di monitoraggio (dataset Regione Puglia)`,
    fonte: 'supabase',
  };
}

// Ultime disdette registrate dal gestionale (cancellation_events) e se lo slot è stato riassegnato.
export async function getRiassegnazioni(limit = 10) {
  const { data, error } = await supabase.from('cancellation_events')
    .select('appointment_id, specialty_id, facility_id, starts_at, cancelled_at, reallocated')
    .order('cancelled_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return {
    rows: data.map((e) => ({
      id: e.appointment_id,
      // Nel gestionale specialty_id è la branca ("cardiologia") e facility_id la sede ("Ospedale ... - Comune").
      prestazione: e.specialty_id,
      struttura: e.facility_id,
      slot_inizio: e.starts_at,
      disdetta_il: e.cancelled_at,
      stato: e.reallocated ? 'riassegnato' : 'slot_libero',
    })),
    nota: 'disdette reali dal gestionale (cancellation_events); riassegnato = slot dato a un paziente in lista d\'attesa',
    fonte: 'supabase',
  };
}

// Simulatore: euristica demo — riduzione = ore * 0.85 (ex formula app.js), applicata
// all'attesa stimata della ASL destinazione. Documentata, non dato reale.
export async function simulate({ da_asl, a_asl, ore }) {
  const { rows, settimana } = await getHotspot();
  const trova = (v) => {
    const s = String(v).trim().toUpperCase();
    return rows.find((r) => r.asl_id === s || r.sigla === s) || null;
  };
  const da = trova(da_asl);
  const a = trova(a_asl);
  if (!da || !a) throw Object.assign(new Error('ASL sconosciuta (usare id 1601xx o sigla BR/TA/BT/BA/FG/LE)'), { status: 400 });
  const partenza = a.attesa_stimata_gg;
  const riduzione = Math.round(ore * 0.85);
  return {
    settimana,
    da_asl: { id: da.asl_id, sigla: da.sigla, nome: da.nome },
    a_asl: { id: a.asl_id, sigla: a.sigla, nome: a.nome },
    ore,
    attesa_stimata_partenza_gg: partenza,
    riduzione_stimata_gg: riduzione,
    nuova_attesa_stimata_gg: Math.max(1, partenza - riduzione),
    nota: 'euristica demo: nuova_attesa = max(1, attesa_stimata - round(ore*0.85)); attesa_stimata = 7+40*quota fuori tempo massimo',
  };
}

// Parse CSV caricato via multipart (latin1 → normalizzato). Riusato da /admin/import e dallo script CLI.
export function parseUploadedCsv(buffer) {
  const text = decodeCsvBuffer(buffer);
  const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((r) => ({
    asl_id: String(r.ASL || '').trim(),
    anno: toInt(r.ANNO),
    settimana: String(r.SETTIMANA_INDICE || '').trim(),
    id_prestazione: String(r.ID_PRESTAZIONE ?? '').trim() === '' ? null : toInt(r.ID_PRESTAZIONE),
    descrizione: String(r.DESC_PRESTAZIONE || '').trim(),
    codice: String(r.COD_PRESTAZIONE ?? '').trim() === '' ? null : String(r.COD_PRESTAZIONE).trim(),
    prenotazioni: toInt(r.PRENOTAZIONI),
    da_garantire: toInt(r.PRENOTAZIONI_DAGARANTIRE),
    b_tot: toInt(r.PRENOTAZIONI_DAGARANTIRE_B),
    b_fuori_tmax: toInt(r.PRENOTAZIONI_DAGARANTIRE_B_TMAX),
    d_tot: toInt(r.PRENOTAZIONI_DAGARANTIRE_D),
    d_fuori_tmax: toInt(r.PRENOTAZIONI_DAGARANTIRE_D_TMAX),
    p_tot: toInt(r.PRENOTAZIONI_DAGARANTIRE_P),
    p_fuori_tmax: toInt(r.PRENOTAZIONI_DAGARANTIRE_P_TMAX),
  }));
}

// Upsert idempotente verso Supabase: prestazioni per descrizione (UNIQUE),
// rilevazioni su UNIQUE(asl_id, prestazione_id, settimana). Richiede service_role.
export async function upsertRows(rows) {
  if (!supabase) throw new Error('Supabase non configurato');
  const byDesc = new Map();
  for (const r of rows) {
    if (!r.descrizione) continue; // descrizione vuota non importabile: scartata, mai crash
    if (!byDesc.has(r.descrizione)) {
      byDesc.set(r.descrizione, { id_prestazione: r.id_prestazione, descrizione: r.descrizione, codice: r.codice });
    }
  }
  const { data: prestUpserted, error: prestErr } = await supabase
    .from('prestazione')
    .upsert([...byDesc.values()], { onConflict: 'descrizione' })
    .select('id, descrizione');
  if (prestErr) throw prestErr;

  const prestIdByDesc = new Map((prestUpserted || []).map((p) => [p.descrizione, p.id]));
  const rilev = [];
  for (const r of rows) {
    const pid = prestIdByDesc.get(r.descrizione);
    if (!r.descrizione || !pid || !r.asl_id || !r.settimana) continue;
    rilev.push({
      asl_id: r.asl_id, prestazione_id: pid, anno: r.anno, settimana: r.settimana,
      prenotazioni: r.prenotazioni, da_garantire: r.da_garantire,
      b_tot: r.b_tot, b_fuori_tmax: r.b_fuori_tmax,
      d_tot: r.d_tot, d_fuori_tmax: r.d_fuori_tmax,
      p_tot: r.p_tot, p_fuori_tmax: r.p_fuori_tmax,
    });
  }
  let scritte = 0;
  for (let i = 0; i < rilev.length; i += 500) {
    const { error } = await supabase.from('rilevazione_settimanale')
      .upsert(rilev.slice(i, i + 500), { onConflict: 'asl_id,prestazione_id,settimana' });
    if (error) throw error;
    scritte += Math.min(500, rilev.length - i);
  }
  return {
    righe_lette: rows.length,
    prestazioni_distinte: byDesc.size,
    asl_distinte: new Set(rows.map((r) => r.asl_id).filter(Boolean)).size,
    rilevazioni_scritte: scritte,
  };
}
