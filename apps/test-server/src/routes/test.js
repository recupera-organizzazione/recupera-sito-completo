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
});

// Disdice a caso una prenotazione fittizia compatibile con una prenotazione reale di Prenota:
// stessa prestazione, slot futuro e precedente a quello del target (stessa ASL se possibile).
testRouter.post('/disdici-casuale', soloAdmin, async (req, res) => {
  const { target_id } = validazione(disdettaSchema, req.body ?? {});
  try {
    const { rows } = await pool.query('select test_server.disdici_casuale($1, $2) as esito', [
      target_id ?? null,
      req.admin.id,
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
