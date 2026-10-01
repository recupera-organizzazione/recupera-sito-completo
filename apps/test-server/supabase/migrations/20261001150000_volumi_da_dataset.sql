-- Volumi delle prenotazioni fittizie calibrati sul dataset reale
-- "Monitoraggio dei tempi di attesa" (Regione Puglia, settimana 07-11 ottobre 2024).

-- Dataset completo (414 righe), caricato da supabase/seed/00_monitoraggio.sql.
create table test_server.monitoraggio (
  asl_id char(6) not null references test_server.asl(id),
  anno int not null,
  settimana text not null,
  id_prestazione text not null,
  descrizione text not null,
  codice text not null,
  prenotazioni int,
  da_garantire int,
  b int, b_tmax int,
  d int, d_tmax int,
  p int, p_tmax int,
  primary key (asl_id, id_prestazione, settimana)
);

-- Parametri della simulazione, letti anche dal frontend.
create table test_server.parametri (
  chiave text primary key,
  valore text not null,
  descrizione text not null
);
insert into test_server.parametri values
  ('scala', '20', 'Prenotazioni fittizie = prenotazioni settimanali del dataset diviso questo valore'),
  ('settimana_dataset', '07-11 ottobre 2024', 'Settimana del dataset usata per calibrare i volumi'),
  ('fonte_dataset', 'Monitoraggio dei tempi di attesa - Regione Puglia (dati.puglia.it, CC BY 4.0)', 'Fonte');

-- La quota di riempimento inventata per struttura sparisce: ora conta solo la capacità relativa
-- (struttura principale 60%, secondaria 40% dell'offerta dell'ASL; ripartizione inventata).
alter table test_server.strutture drop column quota_riempimento;
alter table test_server.strutture add column quota_capacita numeric(3,2) not null default 0.5
  check (quota_capacita > 0 and quota_capacita <= 1);

alter table test_server.offerta add column prob_prenotazione numeric(4,3) not null default 0.5
  check (prob_prenotazione between 0 and 1);

-- Pressione per ASL e prestazione dal dataset.
-- *_TMAX è interpretato come prenotazioni garantite ENTRO il tempo massimo: nel dataset la quota cresce
-- con la tolleranza della classe (B 10 gg: 40%, D: 52%, P 120 gg: 69%), coerente solo con "entro".
-- pressione = quota NON garantita entro il tempo massimo; riempimento obiettivo = 50% + 45% * pressione.
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

revoke all on all tables in schema test_server from public, anon, authenticated;
