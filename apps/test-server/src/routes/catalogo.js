import { Router } from 'express';
import { pool } from '../db.js';

export const catalogoRouter = Router();

// Pubblico: catalogo di ASL, prestazioni, strutture e medici. Nei record di Prenota specialty_id = branca
// della prestazione, facility_id = id della struttura ("Nome - Comune"), professional_id = id del medico.
// La prestazione esatta di uno slot è quella dell'offerta con la stessa struttura e lo stesso medico.
catalogoRouter.get('/', async (req, res) => {
  const [asl, prestazioni, strutture, offerta, parametri] = await Promise.all([
    pool.query('select id, sigla, nome from test_server.asl order by sigla'),
    pool.query('select id, codice, descrizione, durata_min, branca from test_server.prestazioni order by descrizione'),
    pool.query('select id, asl_id, nome, comune from test_server.strutture order by id'),
    pool.query(
      `select o.struttura_id, o.prestazione_id, o.medico_id, m.nome as medico, o.slot_giornalieri
       from test_server.offerta o join test_server.medici m on m.id = o.medico_id
       order by o.struttura_id, o.prestazione_id`,
    ),
    pool.query('select chiave, valore from test_server.parametri'),
  ]);
  res.json({
    parametri: Object.fromEntries(parametri.rows.map((p) => [p.chiave, p.valore])),
    asl: asl.rows,
    prestazioni: prestazioni.rows,
    strutture: strutture.rows,
    offerta: offerta.rows,
  });
});
