-- Test server: disdetta casuale per categoria (es. "mammografia"), dalla scheda "Test disdetta".
-- Sostituisce test_server.disdici_casuale(uuid, uuid) di 20261001230100_reset_e_proposte.sql con un
-- terzo parametro facoltativo; le chiamate a due argomenti continuano a funzionare.

-- Disdetta casuale con categoria facoltativa (p_branca, es. 'mammografia').
-- Il target è una prenotazione di un utente che può ricevere la proposta (public.is_real_patient),
-- della categoria scelta se indicata; la prenotazione fittizia disdetta è della stessa prestazione esatta
-- e precedente al target. Con una categoria ma nessun utente reale compatibile, disdice comunque una
-- prenotazione fittizia futura di quella categoria (target "nessuno": lo slot torna libero).
drop function if exists test_server.disdici_casuale(uuid, uuid);
create or replace function test_server.disdici_casuale(p_target uuid default null, p_admin_id uuid default null, p_branca text default null)
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
  if p_branca is not null and not exists (select 1 from prestazioni where branca = p_branca) then
    raise exception using errcode = 'P0002', message = format('Categoria sconosciuta: %s', p_branca);
  end if;

  -- 1. Target reale: una prenotazione futura di un utente reale...
  select a.* into t_app
  from public.appointments a
  where a.status = 'booked'
    and a.starts_at > now() + interval '2 days'
    and public.is_real_patient(a.patient_id)
    and not exists (select 1 from public.slot_offers so where so.current_appointment_id = a.id and so.status = 'pending')
    and (p_branca is null or a.specialty_id = p_branca)
    and (p_target is null or a.id = p_target)
  order by random() limit 1;

  -- ...oppure una voce di lista d'attesa di un utente reale.
  if t_app.id is null then
    select w.* into t_wl
    from public.waiting_list w
    where w.status = 'waiting'
      and public.is_real_patient(w.patient_id)
      and (p_branca is null or w.specialty_id = p_branca)
      and (p_target is null or w.id = p_target)
    order by random() limit 1;
  end if;

  if t_app.id is null and t_wl.id is null and p_branca is not null and p_target is null then
    -- Nessun utente reale per questa categoria: disdici comunque una visita fittizia della categoria.
    select a.* into f
    from public.appointments a
    join pazienti_fittizi pf on pf.user_id = a.patient_id
    where a.status = 'booked' and a.specialty_id = p_branca and a.starts_at > now() + interval '1 day'
    order by random() limit 1;
  elsif t_app.id is null and t_wl.id is null then
    raise exception using errcode = 'P0002',
      message = case when p_target is null
        then 'Nessuna prenotazione o lista d''attesa di utenti reali (con login su Prenota) con cui essere compatibili'
        else 'Prenotazione target non trovata, non attiva, già con una proposta in sospeso o non di un utente reale' end;
  end if;

  -- 2. Prenotazione fittizia da disdire.
  if f.id is not null then
    null;  -- già scelta sopra (categoria senza target reale)
  elsif t_app.id is not null then
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
      message = case when t_app.id is null and t_wl.id is null
        then format('Nessuna prenotazione fittizia futura di %s da disdire', p_branca)
        else 'Nessuna prenotazione fittizia compatibile (stessa prestazione, slot futuro e precedente al target)' end;
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
      when t_wl.id is not null then jsonb_build_object('tipo', 'lista_attesa', 'waiting_list_id', t_wl.id,
             'patient_id', t_wl.patient_id)
      else jsonb_build_object('tipo', 'nessuno') end,
    'categoria', p_branca,
    'risultato_prenota', risultato);

  insert into disdette_test(admin_id, appuntamento_disdetto, appuntamento_target, lista_attesa_target, esito)
  values (p_admin_id, f.id, t_app.id, t_wl.id, esito);

  return esito;
end $$;

revoke all on function test_server.disdici_casuale(uuid, uuid, text) from public;
