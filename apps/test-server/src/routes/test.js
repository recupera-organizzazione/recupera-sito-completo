import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { soloAdmin } from '../auth.js';
import { ApiError, validazione } from '../errors.js';

export const testRouter = Router();

const disdettaSchema = z.object({
  // id di una prenotazione (appointments) o di una voce di lista d'attesa (waiting_list)
  // di un utente reale; se assente il target è scelto a caso.
  target_id: z.uuid().optional(),
  // categoria (branca) della visita da disdire, es. "mammografia"; se assente qualsiasi.
  categoria: z.string().trim().min(1).max(40).optional(),
});

// Disdice a caso una prenotazione fittizia compatibile con una prenotazione reale di Prenota:
// stessa prestazione, slot futuro e precedente a quello del target (stessa ASL se possibile).
testRouter.post('/disdici-casuale', soloAdmin, async (req, res) => {
  const { target_id, categoria } = validazione(disdettaSchema, req.body ?? {});
  try {
    const { rows } = await pool.query('select test_server.disdici_casuale($1, $2, $3) as esito', [
      target_id ?? null,
      req.admin.id,
      categoria ?? null,
    ]);
    res.json(rows[0].esito);
  } catch (err) {
    // P0002 = nessun target reale o nessuna prenotazione fittizia compatibile
    if (err.code === 'P0002') throw new ApiError(404, 'nessuna_compatibile', err.message);
    throw err;
  }
});

const prenotazioneProvaSchema = z.object({
  prestazione: z.string().max(20).optional(),
});

// Simula un utente loggato su Prenota che prenota uno slot libero tra 30 e 120 giorni.
testRouter.post('/prenotazione-prova', soloAdmin, async (req, res) => {
  const { prestazione } = validazione(prenotazioneProvaSchema, req.body ?? {});
  try {
    const { rows } = await pool.query('select test_server.crea_prenotazione_prova($1) as esito', [
      prestazione ?? null,
    ]);
    res.status(201).json(rows[0].esito);
  } catch (err) {
    if (err.code === 'P0002') throw new ApiError(404, 'nessuno_slot', err.message);
    throw err;
  }
});

testRouter.get('/disdette', soloAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `select d.id, d.created_at, a.username as admin, d.esito
     from test_server.disdette_test d left join test_server.admin_users a on a.id = d.admin_id
     order by d.created_at desc limit 50`,
  );
  res.json({ disdette: rows });
});

// Reset del database allo stato iniziale (funzioni test_server.reset_*, migrazione
// 20261001230100_reset_e_proposte.sql): agenda da domani al 2028 con SOLO prenotazioni fittizie,
// nessuna prenotazione, lista d'attesa, proposta o disdetta di utenti reali (gli account restano).
// Una sola transazione: se una fase fallisce non cambia nulla. Dura qualche minuto, quindi parte in
// background e lo stato si legge con GET /reset.
const resetSchema = z.object({ conferma: z.literal('RESET') });
let reset = { stato: 'mai_eseguito' };

async function eseguiReset(passi) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local statement_timeout = '30min'");
    for (const [i, [, sql, parametri]] of passi.entries()) {
      reset.passo = i;
      const { rows } = await client.query(sql, parametri);
      if (rows[0]?.r) reset.dettagli.push(rows[0].r);
    }
    await client.query('commit');
    await client.query('analyze public.slots, public.appointments');
    reset = { ...reset, stato: 'completato', passo: passi.length, finito: new Date().toISOString() };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('Reset non riuscito:', err);
    reset = { ...reset, stato: 'errore', errore: err.message, finito: new Date().toISOString() };
  } finally {
    client.release();
  }
}

testRouter.get('/reset', soloAdmin, (req, res) => {
  res.json(reset);
});

testRouter.post('/reset', soloAdmin, async (req, res) => {
  validazione(resetSchema, req.body ?? {});
  if (reset.stato === 'in_corso') throw new ApiError(409, 'reset_in_corso', 'Un reset è già in corso');
  const anni = [];
  for (let anno = new Date().getFullYear(); anno <= 2028; anno++) anni.push(anno);
  const passi = [
    ["Svuoto prenotazioni, slot, liste d'attesa, proposte, notifiche e disdette", 'select test_server.reset_svuota()'],
    ...anni.map((anno) => [`Genero agenda e prenotazioni fittizie del ${anno}`, 'select test_server.reset_genera_anno($1) as r', [anno]]),
    ...anni.filter((anno) => anno < 2028).map((anno) => [`Riempio le agende del ${anno} (liste piene fino al 2027)`, 'select test_server.reset_riempi_anno($1) as r', [anno]]),
  ];
  reset = {
    stato: 'in_corso', passo: 0, passi: passi.map(([descrizione]) => descrizione),
    iniziato: new Date().toISOString(), admin: req.admin.username, dettagli: [],
  };
  // Su Vercel una funzione si ferma dopo la risposta: il reset gira dentro la richiesta (maxDuration in vercel.json).
  if (process.env.VERCEL) {
    await eseguiReset(passi);
    return res.json(reset);
  }
  eseguiReset(passi);
  res.status(202).json(reset);
});
