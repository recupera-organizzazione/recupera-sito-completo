-- Statistiche per il frontend: carico delle strutture e confronto simulazione/dataset.

-- Carico (slot prenotati / totali) per struttura in un intervallo di date (ora di Roma).
create function test_server.carico_strutture(p_da date, p_a date)
returns table (struttura_id text, struttura text, comune text, asl text, slot bigint, prenotati bigint,
               liberi bigint, riempimento numeric)
language sql stable
set search_path = test_server, public, pg_temp
as $$
  select st.id, st.nome, st.comune, a.sigla,
         count(s.id), count(s.id) filter (where s.status = 'booked'),
         count(s.id) filter (where s.status = 'available'),
         round(count(s.id) filter (where s.status = 'booked')::numeric / nullif(count(s.id), 0), 3)
  from strutture st
  join asl a on a.id = st.asl_id
  left join public.slots s on s.facility_id = st.id
    and s.starts_at >= (p_da::timestamp at time zone 'Europe/Rome')
    and s.starts_at < ((p_a + 1)::timestamp at time zone 'Europe/Rome')
  group by st.id, st.nome, st.comune, a.sigla
  order by 8 desc nulls last
$$;

-- Confronto per ASL e prestazione: prenotazioni settimanali del dataset vs prenotazioni generate.
-- Media settimanale = prenotati / (giorni di apertura equivalenti / 5.5), cioè per settimana "piena"
-- (5 feriali + mezzo sabato, festivi esclusi), poi riportata alla scala reale con il parametro "scala".
create view test_server.confronto_dataset as
with scala as (select valore::numeric v from test_server.parametri where chiave = 'scala'),
giorni as (
  select sum(case when extract(isodow from g) = 6 then 0.5 else 1 end) as equivalenti
  from (select distinct (starts_at at time zone 'Europe/Rome')::date g from public.slots) d),
simulate as (
  select st.asl_id, s.specialty_id,
         count(*) filter (where s.status = 'booked') prenotati,
         count(*) slot
  from public.slots s
  join test_server.strutture st on st.id = s.facility_id
  group by 1, 2)
select a.sigla as asl, pr.prestazione_id, p.descrizione as prestazione,
       pr.prenotazioni as dataset_settimana,
       round(sim.prenotati / (giorni.equivalenti / 5.5) * scala.v, 1) as simulate_settimana_scalate,
       round(sim.prenotati / (giorni.equivalenti / 5.5), 1) as simulate_settimana,
       pr.pressione,
       pr.riempimento_obiettivo,
       round(sim.prenotati::numeric / nullif(sim.slot, 0), 3) as riempimento_simulato,
       sim.prenotati, sim.slot
from test_server.pressione pr
join test_server.asl a on a.id = pr.asl_id
join test_server.prestazioni p on p.id = pr.prestazione_id
join simulate sim on sim.asl_id = pr.asl_id and sim.specialty_id = pr.prestazione_id
cross join scala cross join giorni;

revoke all on all tables in schema test_server from public, anon, authenticated;
revoke all on function test_server.carico_strutture(date, date) from public, anon, authenticated;
