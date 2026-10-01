-- La copia del dataset nel test-server diventa una vista sui dati sincronizzati da dati.puglia.it
-- (public.rilevazione_settimanale, vedi 20261001180000): una sola copia del dataset nel progetto.

-- test_server.monitoraggio non è più una copia del CSV: è la settimana di calibrazione
-- (parametri.settimana_dataset) letta dai dati sincronizzati. id_prestazione = ID ministeriale come
-- testo, cioè lo specialty_id del catalogo test_server.prestazioni.
drop view test_server.confronto_dataset;
drop view test_server.pressione;
drop table test_server.monitoraggio;

create view test_server.monitoraggio as
select r.asl_id, r.anno, r.settimana, p.id_prestazione::text as id_prestazione, p.descrizione, p.codice,
       r.prenotazioni, r.da_garantire,
       r.b_tot as b, r.b_fuori_tmax as b_tmax,
       r.d_tot as d, r.d_fuori_tmax as d_tmax,
       r.p_tot as p, r.p_fuori_tmax as p_tmax
from public.rilevazione_settimanale r
join public.prestazione p on p.id = r.prestazione_id
where p.id_prestazione is not null
  and r.settimana = (select upper(valore) from test_server.parametri where chiave = 'settimana_dataset');

create view test_server.pressione as
select m.asl_id, m.id_prestazione as prestazione_id, m.settimana,
       m.prenotazioni,
       m.da_garantire,
       coalesce(m.b_tmax, 0) + coalesce(m.d_tmax, 0) + coalesce(m.p_tmax, 0) as entro_tmax,
       round(1 - (coalesce(m.b_tmax, 0) + coalesce(m.d_tmax, 0) + coalesce(m.p_tmax, 0))::numeric
                 / nullif(m.da_garantire, 0), 3) as pressione,
       round(0.5 + 0.45 * coalesce(1 - (coalesce(m.b_tmax, 0) + coalesce(m.d_tmax, 0) + coalesce(m.p_tmax, 0))::numeric
                 / nullif(m.da_garantire, 0), 0), 3) as riempimento_obiettivo
from test_server.monitoraggio m;

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
