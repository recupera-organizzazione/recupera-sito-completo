-- Schema del test-server: finto CUP sopra le tabelle public (slots, appointments, waiting_list)
-- create dal team Prenota. Le tabelle public non vengono modificate, solo indicizzate.
-- Lo schema test_server NON è esposto da PostgREST: ci accede solo il server Node via DATABASE_URL.

create schema if not exists test_server;
revoke all on schema test_server from public, anon, authenticated;

-- Account admin: solo generati qui, nessuna registrazione.
create table test_server.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Catalogo (dati Regione Puglia, vedi README)
create table test_server.asl (
  id char(6) primary key,
  sigla text not null unique,
  nome text not null
);

create table test_server.prestazioni (
  id text primary key,            -- ID_PRESTAZIONE del dataset "Monitoraggio dei tempi di attesa"
  codice text not null,           -- COD_PRESTAZIONE (non univoco: 89.7 = tutte le prime visite)
  descrizione text not null,
  durata_min int not null check (durata_min > 0)
);

create table test_server.strutture (
  id text primary key,
  asl_id char(6) not null references test_server.asl(id),
  nome text not null,
  comune text not null,
  quota_riempimento numeric(3,2) not null check (quota_riempimento between 0 and 1)
);

create table test_server.medici (
  id text primary key,
  nome text not null
);

-- Quali prestazioni eroga ogni struttura, con quale medico e quanti slot al giorno.
create table test_server.offerta (
  struttura_id text not null references test_server.strutture(id),
  prestazione_id text not null references test_server.prestazioni(id),
  medico_id text not null references test_server.medici(id),
  slot_giornalieri int not null check (slot_giornalieri > 0),
  primary key (struttura_id, prestazione_id)
);

-- Pazienti fittizi (utenti auth senza password, non possono fare login).
-- Ogni utente auth NON presente qui è un utente reale loggato su Prenota.
create table test_server.pazienti_fittizi (
  user_id uuid primary key references auth.users(id) on delete cascade,
  asl_id char(6) not null references test_server.asl(id),
  k int not null,                 -- progressivo per ASL, usato dal seed
  unique (asl_id, k)
);

-- Log delle disdette casuali generate per i test.
create table test_server.disdette_test (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references test_server.admin_users(id) on delete set null,
  appuntamento_disdetto uuid not null references public.appointments(id),
  appuntamento_target uuid references public.appointments(id),
  lista_attesa_target uuid references public.waiting_list(id),
  esito jsonb not null,
  created_at timestamptz not null default now()
);

-- Vista unica delle prenotazioni con tipo loggata/fittizia.
create view test_server.prenotazioni as
select a.id, a.patient_id, a.slot_id, a.specialty_id, p.descrizione as prestazione,
       a.facility_id, st.nome as struttura, st.comune, asl.sigla as asl,
       a.professional_id, m.nome as medico,
       a.starts_at, a.ends_at, a.status, a.source, a.created_at,
       case when pf.user_id is null then 'loggata' else 'fittizia' end as tipo,
       u.email
from public.appointments a
left join test_server.pazienti_fittizi pf on pf.user_id = a.patient_id
left join auth.users u on u.id = a.patient_id
left join test_server.prestazioni p on p.id = a.specialty_id
left join test_server.strutture st on st.id = a.facility_id
left join test_server.asl asl on asl.id = st.asl_id
left join test_server.medici m on m.id = a.professional_id;

-- Indici per le ricerche del test-server sulle tabelle public.
create index if not exists appointments_specialty_status_start_idx
  on public.appointments (specialty_id, status, starts_at);
create index if not exists appointments_slot_idx on public.appointments (slot_id);
create index if not exists slots_facility_start_idx on public.slots (facility_id, starts_at);

-- Disdice una prenotazione fittizia scelta a caso tra quelle compatibili con una prenotazione
-- (o una voce di lista d'attesa) di un utente reale: stessa prestazione, slot futuro e più vicino
-- nel tempo, preferibilmente nella stessa ASL. La disdetta passa da
-- public.cancel_appointment_and_reallocate, così scatta la logica di Prenota.
create function test_server.disdici_casuale(p_target uuid default null, p_admin_id uuid default null)
returns jsonb
language plpgsql
set search_path = test_server, public, pg_temp
as $$
declare
  t_app public.appointments%rowtype;
  t_wl public.waiting_list%rowtype;
  t_asl char(6);
  f public.appointments%rowtype;
  esito jsonb;
  risultato jsonb;
begin
  -- 1. Scegli il target reale: una prenotazione loggata futura...
  select a.* into t_app
  from public.appointments a
  where a.status = 'booked'
    and a.starts_at > now() + interval '2 days'
    and not exists (select 1 from pazienti_fittizi pf where pf.user_id = a.patient_id)
    and (p_target is null or a.id = p_target)
  order by random() limit 1;

  -- ...oppure una voce di lista d'attesa di un utente reale.
  if t_app.id is null then
    select w.* into t_wl
    from public.waiting_list w
    where w.status = 'waiting'
      and not exists (select 1 from pazienti_fittizi pf where pf.user_id = w.patient_id)
      and (p_target is null or w.id = p_target)
    order by random() limit 1;
  end if;

  if t_app.id is null and t_wl.id is null then
    raise exception using errcode = 'P0002',
      message = case when p_target is null
        then 'Nessuna prenotazione o lista d''attesa di utenti reali con cui essere compatibili'
        else 'Prenotazione target non trovata, non attiva o non di un utente reale' end;
  end if;

  -- 2. Scegli la prenotazione fittizia da disdire.
  if t_app.id is not null then
    select st.asl_id into t_asl from strutture st where st.id = t_app.facility_id;
    select a.* into f
    from public.appointments a
    join pazienti_fittizi pf on pf.user_id = a.patient_id
    left join strutture st on st.id = a.facility_id
    where a.status = 'booked'
      and a.specialty_id = t_app.specialty_id
      and a.starts_at > now() + interval '1 day'
      and a.starts_at < t_app.starts_at
    order by (st.asl_id is not distinct from t_asl) desc, random()
    limit 1;
  else
    select a.* into f
    from public.appointments a
    join public.slots s on s.id = a.slot_id
    join pazienti_fittizi pf on pf.user_id = a.patient_id
    where a.status = 'booked'
      and a.specialty_id = t_wl.specialty_id
      and a.starts_at > now() + interval '1 day'
      and (cardinality(t_wl.facility_ids) = 0 or s.facility_id = any(t_wl.facility_ids))
      and (cardinality(t_wl.professional_ids) = 0 or s.professional_id = any(t_wl.professional_ids))
      and (t_wl.earliest_at is null or s.starts_at >= t_wl.earliest_at)
      and (t_wl.latest_at is null or s.starts_at <= t_wl.latest_at)
    order by random()
    limit 1;
  end if;

  if f.id is null then
    raise exception using errcode = 'P0002',
      message = 'Nessuna prenotazione fittizia compatibile (stessa prestazione, slot futuro e precedente al target)';
  end if;

  -- 3. Disdici con la funzione del team Prenota (attore admin, senza utente auth).
  risultato := public.cancel_appointment_and_reallocate(f.id, null, 'admin');

  esito := jsonb_build_object(
    'disdetta', jsonb_build_object(
      'appointment_id', f.id, 'slot_id', f.slot_id, 'specialty_id', f.specialty_id,
      'facility_id', f.facility_id, 'starts_at', f.starts_at),
    'target', case when t_app.id is not null
      then jsonb_build_object('tipo', 'prenotazione', 'appointment_id', t_app.id,
             'patient_id', t_app.patient_id, 'facility_id', t_app.facility_id,
             'starts_at', t_app.starts_at,
             'giorni_anticipo', extract(day from t_app.starts_at - f.starts_at)::int)
      else jsonb_build_object('tipo', 'lista_attesa', 'waiting_list_id', t_wl.id,
             'patient_id', t_wl.patient_id) end,
    'risultato_prenota', risultato);

  insert into disdette_test(admin_id, appuntamento_disdetto, appuntamento_target, lista_attesa_target, esito)
  values (p_admin_id, f.id, t_app.id, t_wl.id, esito);

  return esito;
end $$;

revoke all on all tables in schema test_server from public, anon, authenticated;
revoke all on function test_server.disdici_casuale(uuid, uuid) from public, anon, authenticated;
