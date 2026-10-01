-- Agenda piena fino a fine 2027 (seed 05): le prime disponibilità sono nel 2028.
-- - crea_prenotazione_prova: l'utente di prova prende una delle prime disponibilità, come un utente vero
--   (prima cercava uno slot tra 30 e 120 giorni, che ora non esiste più).
-- - confronto_dataset: i volumi calibrati sul dataset valgono solo per il 2028, l'unico anno non saturato.

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
          and (p_prestazione is null or s.specialty_id = p_prestazione)
        order by s.starts_at limit 20) f
  order by random() limit 1;

  if slot_id is null then
    raise exception using errcode = 'P0002', message = 'Nessuno slot libero per questa prestazione';
  end if;

  -- Prenota con la funzione del team Prenota, come farebbe l'app.
  return public.book_available_slot(slot_id, uid) || jsonb_build_object('patientId', uid);
end $$;

create or replace view test_server.confronto_dataset as
with scala as (select valore::numeric v from test_server.parametri where chiave = 'scala'),
giorni as (
  select sum(case when extract(isodow from g) = 6 then 0.5 else 1 end) as equivalenti
  from (select distinct (starts_at at time zone 'Europe/Rome')::date g from public.slots
        where starts_at >= date '2028-01-01') d),
simulate as (
  select st.asl_id, s.specialty_id,
         count(*) filter (where s.status = 'booked') prenotati,
         count(*) slot
  from public.slots s
  join test_server.strutture st on st.id = s.facility_id
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
join simulate sim on sim.asl_id = pr.asl_id and sim.specialty_id = pr.prestazione_id
cross join scala cross join giorni;

revoke all on all tables in schema test_server from public, anon, authenticated;
