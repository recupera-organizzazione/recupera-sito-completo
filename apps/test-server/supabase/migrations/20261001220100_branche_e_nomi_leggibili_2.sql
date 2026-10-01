-- Parte 2/2 (dopo l'aggiornamento di slots/appointments/cancellation_events/waiting_list con
-- test_server.mappa_codici, fatto a blocchi per anno): gli id del catalogo diventano gli stessi testi
-- usati nei record di Prenota, e la prestazione esatta si ricava da struttura + medico (offerta).

alter table test_server.offerta
  drop constraint offerta_struttura_id_fkey,
  add constraint offerta_struttura_id_fkey foreign key (struttura_id) references test_server.strutture(id) on update cascade,
  drop constraint offerta_medico_id_fkey,
  add constraint offerta_medico_id_fkey foreign key (medico_id) references test_server.medici(id) on update cascade;

update test_server.strutture st set id = m.nuovo from test_server.mappa_codici m where m.tipo = 'struttura' and m.vecchio = st.id;
update test_server.medici md set id = m.nuovo from test_server.mappa_codici m where m.tipo = 'medico' and m.vecchio = md.id;
-- Un medico per struttura e prestazione: struttura + medico individuano la prestazione.
alter table test_server.offerta add constraint offerta_struttura_medico_key unique (struttura_id, medico_id);

drop table test_server.mappa_codici;

-- prestazione/prestazione_id dalla offerta; specialty_id ora è la branca.
create or replace view test_server.prenotazioni as
select a.id, a.patient_id, a.slot_id, a.specialty_id, p.descrizione as prestazione,
       a.facility_id, st.nome as struttura, st.comune, asl.sigla as asl,
       a.professional_id, m.nome as medico,
       a.starts_at, a.ends_at, a.status, a.source, a.created_at,
       case when pf.user_id is null then 'loggata' else 'fittizia' end as tipo,
       u.email,
       coalesce((u.raw_app_meta_data ->> 'utente_prova')::boolean, false) as utente_prova,
       o.prestazione_id
from public.appointments a
left join test_server.pazienti_fittizi pf on pf.user_id = a.patient_id
left join auth.users u on u.id = a.patient_id
left join test_server.offerta o on o.struttura_id = a.facility_id and o.medico_id = a.professional_id
left join test_server.prestazioni p on p.id = o.prestazione_id
left join test_server.strutture st on st.id = a.facility_id
left join test_server.asl asl on asl.id = st.asl_id
left join test_server.medici m on m.id = a.professional_id;

create or replace view test_server.confronto_dataset as
with scala as (select valore::numeric v from test_server.parametri where chiave = 'scala'),
giorni as (
  select sum(case when extract(isodow from g) = 6 then 0.5 else 1 end) as equivalenti
  from (select distinct (starts_at at time zone 'Europe/Rome')::date g from public.slots
        where starts_at >= date '2028-01-01') d),
simulate as (
  select st.asl_id, o.prestazione_id,
         count(*) filter (where s.status = 'booked') prenotati,
         count(*) slot
  from public.slots s
  join test_server.strutture st on st.id = s.facility_id
  join test_server.offerta o on o.struttura_id = s.facility_id and o.medico_id = s.professional_id
  where s.starts_at >= date '2028-01-01'
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
join simulate sim on sim.asl_id = pr.asl_id and sim.prestazione_id = pr.prestazione_id
cross join scala cross join giorni;

-- p_prestazione: branca ("cardiologia") oppure id della prestazione del catalogo ("1").
create or replace function test_server.crea_prenotazione_prova(p_prestazione text default null)
returns jsonb
language plpgsql
set search_path = test_server, public, pg_temp
as $$
declare
  uid uuid;
  slot_id uuid;
begin
  select id into uid from auth.users where email = 'utente.prova@prenota.recupera.test';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
                            email_change_token_new, email_change, email_change_token_current,
                            reauthentication_token, phone_change, phone_change_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
            'utente.prova@prenota.recupera.test', '',
            '{"provider":"email","providers":["email"],"utente_prova":true}',
            '{"nome":"Utente","cognome":"Prova"}', now(), now(), '', '', '', '', '', '', '', '');
  end if;

  -- Come un utente vero: una delle prime 20 disponibilità (con l'agenda piena fino al 2027 sono nel
  -- 2028), così restano prenotazioni fittizie precedenti da disdire.
  select f.id into slot_id
  from (select s.id from public.slots s
        where s.status = 'available'
          and s.starts_at > now() + interval '2 days'
          and (p_prestazione is null or s.specialty_id = p_prestazione
               or exists (select 1 from test_server.offerta o where o.struttura_id = s.facility_id
                          and o.medico_id = s.professional_id and o.prestazione_id = p_prestazione))
        order by s.starts_at limit 20) f
  order by random() limit 1;

  if slot_id is null then
    raise exception using errcode = 'P0002', message = 'Nessuno slot libero per questa prestazione';
  end if;

  -- Prenota con la funzione del team Prenota, come farebbe l'app.
  return public.book_available_slot(slot_id, uid) || jsonb_build_object('patientId', uid);
end $$;

revoke all on all tables in schema test_server from public, anon, authenticated;
