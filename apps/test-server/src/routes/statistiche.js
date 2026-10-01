import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { soloAdmin } from '../auth.js';
import { validazione } from '../errors.js';

export const statisticheRouter = Router();

const periodoSchema = z.object({
  da: z.iso.date().optional(),
  a: z.iso.date().optional(),
});

// Carico delle strutture (slot prenotati / totali) nel periodo; default: prossime 8 settimane.
statisticheRouter.get('/centri', soloAdmin, async (req, res) => {
  const f = validazione(periodoSchema, req.query);
  const { rows } = await pool.query(
    `select struttura_id, struttura, comune, asl, slot::int, prenotati::int, liberi::int, riempimento::float8
     from test_server.carico_strutture(coalesce($1::date, current_date + 1), coalesce($2::date, current_date + 56))`,
    [f.da ?? null, f.a ?? null],
  );
  res.json({ centri: rows });
});

// Confronto con il dataset reale: prenotazioni settimanali per ASL e prestazione.
statisticheRouter.get('/dataset', soloAdmin, async (req, res) => {
  const [confronto, parametri] = await Promise.all([
    pool.query(
      `select asl, prestazione_id, prestazione, dataset_settimana,
              simulate_settimana_scalate::float8, simulate_settimana::float8,
              pressione::float8, riempimento_obiettivo::float8, riempimento_simulato::float8,
              prenotati::int, slot::int
       from test_server.confronto_dataset order by asl, prestazione`,
    ),
    pool.query('select chiave, valore from test_server.parametri'),
  ]);
  res.json({
    parametri: Object.fromEntries(parametri.rows.map((p) => [p.chiave, p.valore])),
    righe: confronto.rows,
  });
});
