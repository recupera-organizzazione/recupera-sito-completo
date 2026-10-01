import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { soloAdmin } from '../auth.js';
import { validazione } from '../errors.js';

export const slotRouter = Router();

const filtriSchema = z.object({
  prestazione: z.string().optional(),
  struttura: z.string().optional(),
  asl: z.string().length(2).optional(),
  da: z.iso.date().optional(),
  a: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Slot liberi futuri (public.slots, status 'available') con nomi dal catalogo, più:
// - mesi: quanti slot liberi per mese (per vedere dove sono le prime disponibilità)
// - primi: prima disponibilità per prestazione
// "da_disdetta" = slot tornato libero dopo una disdetta (cancellation_events).
slotRouter.get('/liberi', soloAdmin, async (req, res) => {
  const f = validazione(filtriSchema, req.query);
  const condizioni = [`s.status = 'available'`, 's.starts_at > now()'];
  const valori = [];
  const aggiungi = (sql, valore) => {
    valori.push(valore);
    condizioni.push(sql.replace('?', `$${valori.length}`));
  };
  // prestazione: id del catalogo ("1") o branca ("cardiologia", cioè lo specialty_id)
  if (f.prestazione) aggiungi('(o.prestazione_id = ? or s.specialty_id = $' + (valori.length + 1) + ')', f.prestazione);
  if (f.struttura) aggiungi('s.facility_id = ?', f.struttura);
  if (f.asl) aggiungi('a.sigla = upper(?)', f.asl);
  if (f.da) aggiungi(`s.starts_at >= (?::date at time zone 'Europe/Rome')`, f.da);
  if (f.a) aggiungi(`s.starts_at < ((?::date + 1) at time zone 'Europe/Rome')`, f.a);
  const where = `where ${condizioni.join(' and ')}`;
  const da = `from public.slots s
    left join test_server.offerta o on o.struttura_id = s.facility_id and o.medico_id = s.professional_id
    left join test_server.prestazioni p on p.id = o.prestazione_id
    left join test_server.strutture st on st.id = s.facility_id
    left join test_server.asl a on a.id = st.asl_id
    left join test_server.medici m on m.id = s.professional_id`;

  const [elenco, mesi, primi] = await Promise.all([
    pool.query(
      `select s.id, s.starts_at, s.ends_at, s.specialty_id, o.prestazione_id, p.descrizione as prestazione,
              s.facility_id, st.nome as struttura, st.comune, a.sigla as asl, m.nome as medico,
              exists (select 1 from public.cancellation_events ce where ce.slot_id = s.id) as da_disdetta,
              count(*) over () as totale
       ${da} ${where}
       order by s.starts_at limit ${f.limit} offset ${f.offset}`,
      valori,
    ),
    pool.query(
      `select to_char(s.starts_at at time zone 'Europe/Rome', 'YYYY-MM') as mese, count(*)::int as liberi
       ${da} ${where} group by 1 order by 1`,
      valori,
    ),
    pool.query(
      `select s.specialty_id, o.prestazione_id, p.descrizione as prestazione, min(s.starts_at) as primo, count(*)::int as liberi
       ${da} ${where} group by 1, 2, 3 order by 4`,
      valori,
    ),
  ]);
  res.json({
    totale: elenco.rows.length ? Number(elenco.rows[0].totale) : 0,
    slot: elenco.rows.map(({ totale, ...s }) => s),
    mesi: mesi.rows,
    primi: primi.rows,
  });
});
