-- Seed 3/4: offerta (prestazioni, medici, slot al giorno) calibrata sul dataset.
-- Per ogni struttura e prestazione:
--   w    = prenotazioni settimanali del dataset per l'ASL / scala * quota_capacita della struttura
--   slot = slot giornalieri = ceil(w / riempimento_obiettivo / 5.5)  (5 feriali + mezzo sabato)
--   prob = probabilità che uno slot sia prenotato = w / slot settimanali effettivi
-- Così le prenotazioni settimanali generate = dataset / scala, e le ASL più in sofferenza
-- (vista test_server.pressione) hanno agende più piene. I nomi dei medici sono inventati.

create temp table nuova_offerta as
with scala as (select valore::numeric v from test_server.parametri where chiave = 'scala'),
base as (
  select s.id struttura_id, p.id prestazione_id, pr.riempimento_obiettivo,
         pr.prenotazioni / scala.v * s.quota_capacita as w,
         row_number() over (order by s.id, p.id::int) i
  from test_server.strutture s
  cross join test_server.prestazioni p
  cross join scala
  join test_server.pressione pr on pr.asl_id = s.asl_id and pr.prestazione_id = p.id
  where pr.prenotazioni > 0),
calc as (select *, greatest(1, ceil(w / riempimento_obiettivo / 5.5))::int slot from base)
-- medico_id = nome del medico (professional_id dei record di Prenota), unico: struttura + medico
-- individuano la prestazione.
select struttura_id, prestazione_id,
       'Dott. ' || (array['Marco','Giulia','Antonio','Francesca','Giuseppe','Maria','Nicola','Anna',
                          'Vito','Rosa','Michele','Lucia','Domenico','Angela','Luca','Paola'])[1 + (i * 7) % 16]
       || ' ' || (array['Lorusso','De Santis','Ricci','Lomuscio','Caputo','Greco','Colella','Lattanzio',
                        'Fanizzi','Russo','Morea','Palumbo','Mastrangelo','Carella','Damiani','Zaccaria'])[1 + (i * 5 + i / 16) % 16]
         as medico_id,
       i, slot, w,
       least(0.98, w / (5 * slot + slot / 2))::numeric(4,3) prob
from calc;

insert into test_server.medici (id, nome)
select medico_id, medico_id from nuova_offerta;

insert into test_server.offerta (struttura_id, prestazione_id, medico_id, slot_giornalieri, prob_prenotazione)
select struttura_id, prestazione_id, medico_id, slot, prob from nuova_offerta;

drop table nuova_offerta;
