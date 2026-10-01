import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { soloAdmin } from '../auth.js';
import { validazione } from '../errors.js';

export const prenotazioniRouter = Router();

const filtriSchema = z.object({
  tipo: z.enum(['loggata', 'fittizia', 'tutte']).default('tutte'),
  stato: z.enum(['booked', 'cancelled', 'tutti']).default('booked'),
  prestazione: z.string().optional(),
  struttura: z.string().optional(),
  paziente: z.uuid().optional(),
  da: z.iso.date().optional(),
  a: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Elenco prenotazioni: "loggata" = utente reale di Prenota, "fittizia" = generata dal seed.
prenotazioniRouter.get('/', soloAdmin, async (req, res) => {
  const f = validazione(filtriSchema, req.query);
  const condizioni = [];
  const valori = [];
  const aggiungi = (sql, valore) => {
    valori.push(valore);
    condizioni.push(sql.replace('?', `$${valori.length}`));
  };

  if (f.tipo !== 'tutte') aggiungi('tipo = ?', f.tipo);
  if (f.stato !== 'tutti') aggiungi('status = ?', f.stato);
  // prestazione: id del catalogo ("1") o branca ("cardiologia", cioè lo specialty_id)
  if (f.prestazione) aggiungi('(prestazione_id = ? or specialty_id = $' + (valori.length + 1) + ')', f.prestazione);
  if (f.struttura) aggiungi('facility_id = ?', f.struttura);
  if (f.paziente) aggiungi('patient_id = ?', f.paziente);
  if (f.da) aggiungi(`starts_at >= (?::date at time zone 'Europe/Rome')`, f.da);
  if (f.a) aggiungi(`starts_at < ((?::date + 1) at time zone 'Europe/Rome')`, f.a);

  const where = condizioni.length ? `where ${condizioni.join(' and ')}` : '';
  const { rows } = await pool.query(
    `select *, count(*) over () as totale from test_server.prenotazioni ${where}
     order by starts_at limit ${f.limit} offset ${f.offset}`,
    valori,
  );
  res.json({
    totale: rows.length ? Number(rows[0].totale) : 0,
    prenotazioni: rows.map(({ totale, ...p }) => p),
  });
});
