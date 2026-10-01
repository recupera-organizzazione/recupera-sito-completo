-- Test server: reset del database allo stato iniziale e disdetta casuale con proposta di anticipo.
-- Richiede la migrazione di Prenota "proposte_anticipo" (public.slot_offers, public.is_real_patient).

-- 1. Reset allo stato iniziale, in tre fasi chiamate dal server in UNA transazione
--    (src/routes/test.js): se una fase fallisce non si perde nulla.
--    Stato iniziale = agenda da domani al 31/12/2028, prenotazioni SOLO di pazienti fittizi
--    (liste piene fino a fine 2027, 2028 calibrato sul dataset), nessuna prenotazione, lista d'attesa,
--    notifica, proposta o disdetta di utenti reali. Gli account (auth.users) restano.

create or replace function test_server.reset_svuota()
returns void language plpgsql set search_path = test_server, public, pg_temp as $$
begin
  -- Senza CASCADE: se un'altra tabella punta a queste, il reset si ferma invece di svuotarla.
  truncate table public.slot_offers, public.notifications, public.cancellation_events,
                 test_server.disdette_test, public.waiting_list, public.appointments, public.slots;
end $$;

-- Come supabase/seed/04_slot_prenotazioni.sql, per un anno.
create or replace function test_server.reset_genera_anno(p_anno int)
returns jsonb language plpgsql set search_path = test_server, public, pg_temp as $$
declare n_slot bigint; n_pren bigint;
begin
  insert into public.slots (specialty_id, facility_id, professional_id, starts_at, ends_at, status)
  select p.branca, o.struttura_id, o.medico_id,
         ((d::date + time '08:30' + make_interval(mins => n * p.durata_min)) at time zone 'Europe/Rome'),
         ((d::date + time '08:30' + make_interval(mins => (n + 1) * p.durata_min)) at time zone 'Europe/Rome'),
         'available'
  from generate_series(greatest(current_date + 1, make_date(p_anno, 1, 1))::timestamp,
                       make_date(p_anno, 12, 31)::timestamp, interval '1 day') d
  cross join test_server.offerta o
  join test_server.prestazioni p on p.id = o.prestazione_id
  cross join lateral generate_series(0, case when extract(isodow from d) = 6
                                             then o.slot_giornalieri / 2 else o.slot_giornalieri end - 1) n
  where extract(isodow from d) < 7
    and to_char(d, 'MM-DD') not in ('01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26')
    and d::date not in (date '2027-03-29', date '2028-04-17');  -- Pasquetta
  get diagnostics n_slot = row_count;

  with conteggi as (select asl_id, count(*) n from test_server.pazienti_fittizi group by asl_id),
       candidati as materialized (
         select s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at,
                st.asl_id, o.prob_prenotazione, random() r, 1 + floor(random() * c.n)::int k
         from public.slots s
         join test_server.offerta o on o.struttura_id = s.facility_id and o.medico_id = s.professional_id
         join test_server.strutture st on st.id = s.facility_id
         join conteggi c on c.asl_id = st.asl_id
         where s.status = 'available'
           and s.starts_at >= make_date(p_anno, 1, 1) and s.starts_at < make_date(p_anno + 1, 1, 1)),
       nuove as (
         insert into public.appointments (patient_id, slot_id, specialty_id, facility_id, professional_id,
                                          starts_at, ends_at, status, source, created_at)
         select pf.user_id, s.id, s.specialty_id, s.facility_id, s.professional_id,
                s.starts_at, s.ends_at, 'booked', 'self_booking', now() - random() * interval '90 days'
         from candidati s
         join test_server.pazienti_fittizi pf on pf.asl_id = s.asl_id and pf.k = s.k
         where s.r < s.prob_prenotazione
         returning id, slot_id),
       agg as (update public.slots s set status = 'booked', appointment_id = nuove.id, updated_at = now()
               from nuove where nuove.slot_id = s.id returning 1)
  select count(*) into n_pren from agg;

  return jsonb_build_object('anno', p_anno, 'slot', n_slot, 'prenotazioni', n_pren);
end $$;

-- Come supabase/seed/05_agenda_piena_fino_2027.sql, per un anno prima del 2028.
create or replace function test_server.reset_riempi_anno(p_anno int)
returns jsonb language plpgsql set search_path = test_server, public, pg_temp as $$
declare n_pren bigint;
begin
  with conteggi as (select asl_id, count(*) n from test_server.pazienti_fittizi group by asl_id),
       candidati as materialized (
         select s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at,
                st.asl_id, 1 + floor(random() * c.n)::int k
         from public.slots s
         join test_server.strutture st on st.id = s.facility_id
         join conteggi c on c.asl_id = st.asl_id
         where s.status = 'available'
           and s.starts_at > now()
           and s.starts_at >= make_date(p_anno, 1, 1) and s.starts_at < make_date(p_anno + 1, 1, 1)
           and s.starts_at < date '2028-01-01'),
       nuove as (
         insert into public.appointments (patient_id, slot_id, specialty_id, facility_id, professional_id,
                                          starts_at, ends_at, status, source, created_at)
         select pf.user_id, s.id, s.specialty_id, s.facility_id, s.professional_id,
                s.starts_at, s.ends_at, 'booked', 'self_booking', now() - random() * interval '90 days'
         from candidati s
         join test_server.pazienti_fittizi pf on pf.asl_id = s.asl_id and pf.k = s.k
         returning id, slot_id),
       agg as (update public.slots s set status = 'booked', appointment_id = nuove.id, updated_at = now()
               from nuove where nuove.slot_id = s.id returning 1)
  select count(*) into n_pren from agg;
  return jsonb_build_object('anno', p_anno, 'prenotazioni', n_pren);
end $$;

-- 2. Disdetta casuale compatibile: il target è una prenotazione di un utente che può ricevere la
--    proposta (public.is_real_patient: reale e con login), la prenotazione fittizia disdetta è della
--    stessa prestazione esatta (catalogo test_server.offerta) e precedente al target.
create or replace function test_server.disdici_casuale(p_target uuid default null, p_admin_id uuid default null)
returns jsonb language plpgsql set search_path = test_server, public, pg_temp as $$
declare
  t_app public.appointments%rowtype;
  t_wl public.waiting_list%rowtype;
  t_asl char(6);
  t_prest text;
  f public.appointments%rowtype;
  esito jsonb;
  risultato jsonb;
begin
  -- 1. Target reale: una prenotazione futura di un utente reale...
  select a.* into t_app
  from public.appointments a
  where a.status = 'booked'
    and a.starts_at > now() + interval '2 days'
    and public.is_real_patient(a.patient_id)
    and not exists (select 1 from public.slot_offers so where so.current_appointment_id = a.id and so.status = 'pending')
    and (p_target is null or a.id = p_target)
  order by random() limit 1;

  -- ...oppure una voce di lista d'attesa di un utente reale.
  if t_app.id is null then
    select w.* into t_wl
    from public.waiting_list w
    where w.status = 'waiting'
      and public.is_real_patient(w.patient_id)
      and (p_target is null or w.id = p_target)
    order by random() limit 1;
  end if;

  if t_app.id is null and t_wl.id is null then
    raise exception using errcode = 'P0002',
      message = case when p_target is null
        then 'Nessuna prenotazione o lista d''attesa di utenti reali (con login su Prenota) con cui essere compatibili'
        else 'Prenotazione target non trovata, non attiva, già con una proposta in sospeso o non di un utente reale' end;
  end if;

  -- 2. Prenotazione fittizia da disdire.
  if t_app.id is not null then
    select st.asl_id into t_asl from strutture st where st.id = t_app.facility_id;
    select o.prestazione_id into t_prest from offerta o
      where o.struttura_id = t_app.facility_id and o.medico_id = t_app.professional_id;
    select a.* into f
    from public.appointments a
    join pazienti_fittizi pf on pf.user_id = a.patient_id
    left join offerta o on o.struttura_id = a.facility_id and o.medico_id = a.professional_id
    left join strutture st on st.id = a.facility_id
    where a.status = 'booked'
      and a.specialty_id = t_app.specialty_id
      and (t_prest is null or o.prestazione_id = t_prest)
      and a.starts_at > now() + interval '1 day'
      and a.starts_at < t_app.starts_at
      and not exists (select 1 from public.appointments b
                      where b.patient_id = t_app.patient_id and b.status = 'booked'
                        and b.starts_at < a.ends_at and b.ends_at > a.starts_at)
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

  -- 3. Disdici con la funzione di Prenota (attore admin): lo slot va alla lista d'attesa reale
  --    oppure viene proposto a un utente reale con una prenotazione successiva.
  risultato := public.cancel_appointment_and_reallocate(f.id, null, 'admin');

  esito := jsonb_build_object(
    'disdetta', jsonb_build_object(
      'appointment_id', f.id, 'slot_id', f.slot_id, 'specialty_id', f.specialty_id,
      'facility_id', f.facility_id, 'starts_at', f.starts_at),
    'target', case when t_app.id is not null
      then jsonb_build_object('tipo', 'prenotazione', 'appointment_id', t_app.id,
             'patient_id', t_app.patient_id, 'facility_id', t_app.facility_id,
             'starts_at', t_app.starts_at,
             'giorni_anticipo', (t_app.starts_at::date - f.starts_at::date))
      else jsonb_build_object('tipo', 'lista_attesa', 'waiting_list_id', t_wl.id,
             'patient_id', t_wl.patient_id) end,
    'risultato_prenota', risultato);

  insert into disdette_test(admin_id, appuntamento_disdetto, appuntamento_target, lista_attesa_target, esito)
  values (p_admin_id, f.id, t_app.id, t_wl.id, esito);

  return esito;
end $$;

-- 3. Prenotazione di prova: per l'account di prova CON login (paziente.test@prenota.recupera.test),
--    così la proposta di anticipo si vede e si accetta da Prenota; se non esiste, l'utente di prova
--    senza password (non può ricevere proposte). Mai su uno slot con una proposta in sospeso.
create or replace function test_server.crea_prenotazione_prova(p_prestazione text default null)
returns jsonb language plpgsql set search_path = test_server, public, pg_temp as $$
declare
  uid uuid;
  slot_id uuid;
begin
  select id into uid from auth.users
  where email = 'paziente.test@prenota.recupera.test' and public.is_real_patient(id);
  if uid is null then
    select id into uid from auth.users where email = 'utente.prova@prenota.recupera.test';
  end if;
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

  select f.id into slot_id
  from (select s.id from public.slots s
        where s.status = 'available'
          and s.starts_at > now() + interval '2 days'
          and not exists (select 1 from public.slot_offers so where so.slot_id = s.id and so.status = 'pending')
          and (p_prestazione is null or s.specialty_id = p_prestazione
               or exists (select 1 from test_server.offerta o where o.struttura_id = s.facility_id
                          and o.medico_id = s.professional_id and o.prestazione_id = p_prestazione))
        order by s.starts_at limit 20) f
  order by random() limit 1;

  if slot_id is null then
    raise exception using errcode = 'P0002', message = 'Nessuno slot libero per questa prestazione';
  end if;

  return public.book_available_slot(slot_id, uid) || jsonb_build_object('patientId', uid);
end $$;

revoke all on function test_server.reset_svuota() from public;
revoke all on function test_server.reset_genera_anno(int) from public;
revoke all on function test_server.reset_riempi_anno(int) from public;
