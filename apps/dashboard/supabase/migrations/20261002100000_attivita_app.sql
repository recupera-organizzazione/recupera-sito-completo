-- Dashboard: disdette e riprenotazioni EFFETTIVE fatte nell'app Prenota da utenti reali
-- (public.is_real_patient: non fittizi, con login). Esclude le disdette di pazienti fittizi fatte dal
-- test server. Eventi:
--   disdetta      prenotazione annullata dall'utente in Prenota (non quella sostituita da un anticipo)
--   anticipo      proposta di anticipo accettata (public.slot_offers), con i giorni guadagnati
--   lista_attesa  slot assegnato dalla lista d'attesa (appointments.waitlist_entry_id)
-- Giorni in ora di Roma. p_specialty / p_facility facoltativi (specialty_id / facility_id dei record).
create or replace function public.dashboard_attivita_app(
  p_da date, p_a date, p_limit int default 10, p_specialty text default null, p_facility text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with eventi as (
    select 'disdetta'::text tipo, a.id, a.cancelled_at quando, a.specialty_id, a.facility_id, a.professional_id,
           a.starts_at slot_inizio, null::timestamptz prima_inizio, null::text prima_struttura, null::int giorni
    from public.appointments a
    where a.status = 'cancelled' and a.cancelled_at is not null and a.cancelled_by is not null
      and public.is_real_patient(a.patient_id)
      and not exists (select 1 from public.slot_offers o where o.current_appointment_id = a.id and o.status = 'accepted')
    union all
    select 'anticipo', o.id, o.responded_at, n.specialty_id, n.facility_id, n.professional_id,
           n.starts_at, v.starts_at, v.facility_id, (v.starts_at::date - n.starts_at::date)
    from public.slot_offers o
    join public.appointments n on n.id = o.new_appointment_id
    join public.appointments v on v.id = o.current_appointment_id
    where o.status = 'accepted' and public.is_real_patient(o.patient_id)
    union all
    select 'lista_attesa', a.id, a.created_at, a.specialty_id, a.facility_id, a.professional_id,
           a.starts_at, null, null, null
    from public.appointments a
    where a.source = 'waitlist_reallocation' and a.waitlist_entry_id is not null
      and public.is_real_patient(a.patient_id)
  ),
  filtrati as (
    select e.*, (e.quando at time zone 'Europe/Rome')::date giorno
    from eventi e
    where (p_specialty is null or e.specialty_id = p_specialty)
      and (p_facility is null or e.facility_id = p_facility)
  ),
  periodo as (select * from filtrati where giorno between p_da and p_a),
  prenotazioni as (
    select count(*) n from public.appointments a
    where (a.created_at at time zone 'Europe/Rome')::date between p_da and p_a
      and a.waitlist_entry_id is null and a.source = 'self_booking'
      and public.is_real_patient(a.patient_id)
      and (p_specialty is null or a.specialty_id = p_specialty)
      and (p_facility is null or a.facility_id = p_facility)
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('da', p_da, 'a', p_a),
    'totali', jsonb_build_object(
      'prenotazioni', (select n from prenotazioni),
      'disdette', (select count(*) from periodo where tipo = 'disdetta'),
      'riprenotazioni', (select count(*) from periodo where tipo <> 'disdetta'),
      'anticipi', (select count(*) from periodo where tipo = 'anticipo'),
      'da_lista_attesa', (select count(*) from periodo where tipo = 'lista_attesa'),
      'giorni_guadagnati', (select coalesce(sum(giorni), 0) from periodo where tipo = 'anticipo')),
    'serie', (
      select jsonb_agg(jsonb_build_object('giorno', d::date,
               'disdette', (select count(*) from periodo p where p.giorno = d::date and p.tipo = 'disdetta'),
               'riprenotazioni', (select count(*) from periodo p where p.giorno = d::date and p.tipo <> 'disdetta'))
             order by d)
      from generate_series(p_da::timestamp, p_a::timestamp, interval '1 day') d),
    'eventi', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'tipo', e.tipo, 'quando', e.quando, 'slot_inizio', e.slot_inizio,
               'prestazione', coalesce(pr.descrizione, e.specialty_id), 'categoria', e.specialty_id,
               'struttura', coalesce(st.nome, e.facility_id), 'comune', st.comune, 'asl', asl.sigla,
               'prima_inizio', e.prima_inizio, 'prima_struttura', coalesce(stp.nome, e.prima_struttura),
               'giorni_guadagnati', e.giorni)
             order by e.quando desc)
      from (select * from filtrati order by quando desc limit greatest(1, least(p_limit, 50))) e
      left join test_server.offerta ofr on ofr.struttura_id = e.facility_id and ofr.medico_id = e.professional_id
      left join test_server.prestazioni pr on pr.id = ofr.prestazione_id
      left join test_server.strutture st on st.id = e.facility_id
      left join test_server.asl asl on asl.id = st.asl_id
      left join test_server.strutture stp on stp.id = e.prima_struttura), '[]'::jsonb)
  );
$$;

revoke all on function public.dashboard_attivita_app(date, date, int, text, text) from public, anon, authenticated;
grant execute on function public.dashboard_attivita_app(date, date, int, text, text) to service_role;
