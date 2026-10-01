-- Riprenotazioni LIFO (scelta dell'utente): lo slot liberato va prima a chi si è aggiunto PER ULTIMO.
-- - Proposte di anticipo: tra gli utenti reali con una prenotazione successiva della stessa prestazione,
--   prima la prenotazione creata più di recente (prima era: stessa ASL, poi la più vecchia).
-- - Lista d'attesa (disdetta e nuovi slot): a parità di priority_score, prima l'iscrizione più recente.
-- Restano invariati: solo utenti reali (public.is_real_patient), stessa prestazione, nessuna sovrapposizione.

create or replace function public.offer_freed_slot(p_slot_id uuid, p_source_appointment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.slots%rowtype;
  prestazione text;
  c record;
  o public.slot_offers%rowtype;
begin
  select * into s from public.slots where id = p_slot_id for update;
  if not found or s.status <> 'available' or s.starts_at <= now() + interval '2 hours' then
    return jsonb_build_object('offered', false);
  end if;
  if exists (select 1 from public.slot_offers where slot_id = s.id and status = 'pending') then
    return jsonb_build_object('offered', false);
  end if;

  select ofr.prestazione_id into prestazione
  from test_server.offerta ofr where ofr.struttura_id = s.facility_id and ofr.medico_id = s.professional_id;

  select a.id, a.patient_id, a.starts_at into c
  from public.appointments a
  left join test_server.offerta oc on oc.struttura_id = a.facility_id and oc.medico_id = a.professional_id
  where a.status = 'booked'
    and a.specialty_id = s.specialty_id
    and (prestazione is null or oc.prestazione_id is null or oc.prestazione_id = prestazione)
    and a.starts_at > s.starts_at
    and public.is_real_patient(a.patient_id)
    and not exists (select 1 from public.slot_offers so where so.slot_id = s.id and so.patient_id = a.patient_id)
    and not exists (select 1 from public.slot_offers so where so.current_appointment_id = a.id and so.status = 'pending')
    and not exists (select 1 from public.appointments b
                    where b.patient_id = a.patient_id and b.status = 'booked'
                      and b.starts_at < s.ends_at and b.ends_at > s.starts_at)
  order by a.created_at desc, a.starts_at desc
  limit 1
  for update of a skip locked;

  if not found then
    return jsonb_build_object('offered', false);
  end if;

  insert into public.slot_offers (slot_id, patient_id, current_appointment_id, source_appointment_id, expires_at)
  values (s.id, c.patient_id, c.id, p_source_appointment_id,
          least(now() + interval '24 hours', s.starts_at - interval '2 hours'))
  returning * into o;

  insert into public.notifications (user_id, type, appointment_id, slot_id)
  values (c.patient_id, 'slot_offer', c.id, s.id);

  return jsonb_build_object('offered', true, 'offerId', o.id, 'patientId', c.patient_id,
    'currentAppointmentId', c.id, 'currentStartAt', c.starts_at, 'slotStartAt', s.starts_at,
    'daysSaved', (c.starts_at::date - s.starts_at::date), 'expiresAt', o.expires_at);
end $$;

create or replace function public.cancel_appointment_and_reallocate(p_appointment_id uuid, p_actor_id uuid, p_actor_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.appointments%rowtype;
  s public.slots%rowtype;
  w public.waiting_list%rowtype;
  new_appointment public.appointments%rowtype;
  has_candidate boolean := false;
  ritirata record;
  proposta jsonb;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  if p_actor_role = 'patient' and a.patient_id <> p_actor_id then raise exception 'Forbidden: cannot cancel another patient appointment'; end if;
  if p_actor_role not in ('patient', 'operator', 'admin') then raise exception 'Forbidden: role cannot cancel'; end if;
  if a.status <> 'booked' then raise exception 'Appointment not active'; end if;
  if a.starts_at <= now() then raise exception 'Appointment already passed'; end if;

  select * into s from public.slots where id = a.slot_id for update;
  if not found then raise exception 'Slot not found'; end if;

  select * into w
  from public.waiting_list candidate
  where candidate.status = 'waiting'
    and candidate.specialty_id = a.specialty_id
    and (cardinality(candidate.facility_ids) = 0 or s.facility_id = any(candidate.facility_ids))
    and (candidate.earliest_at is null or s.starts_at >= candidate.earliest_at)
    and (candidate.latest_at is null or s.starts_at <= candidate.latest_at)
    and (cardinality(candidate.professional_ids) = 0 or s.professional_id = any(candidate.professional_ids))
    and public.is_real_patient(candidate.patient_id)
  order by candidate.priority_score desc, candidate.created_at desc
  limit 1 for update skip locked;
  has_candidate := found;

  update public.appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_id where id = a.id;
  insert into public.cancellation_events(appointment_id, slot_id, specialty_id, facility_id, starts_at, reallocated)
  values (a.id, a.slot_id, a.specialty_id, a.facility_id, a.starts_at, has_candidate);

  -- Proposte in sospeso per anticipare questa prenotazione: non hanno più senso, lo slot passa oltre.
  for ritirata in
    update public.slot_offers set status = 'withdrawn', responded_at = now()
    where current_appointment_id = a.id and status = 'pending'
    returning slot_id, source_appointment_id
  loop
    perform public.offer_freed_slot(ritirata.slot_id, ritirata.source_appointment_id);
  end loop;

  if has_candidate then
    insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source, waitlist_entry_id)
    values (w.patient_id, s.id, a.specialty_id, a.facility_id, s.professional_id, s.starts_at, s.ends_at, 'booked', 'waitlist_reallocation', w.id)
    returning * into new_appointment;
    update public.slots set status = 'booked', appointment_id = new_appointment.id, updated_at = now() where id = s.id;
    update public.waiting_list set status = 'matched', appointment_id = new_appointment.id, matched_at = now(), updated_at = now() where id = w.id;
    insert into public.notifications(user_id, type, appointment_id, slot_id)
    values (w.patient_id, 'waitlist_match', new_appointment.id, s.id);
    return jsonb_build_object('cancelled', true, 'reallocated', true, 'patientId', w.patient_id);
  end if;

  update public.slots set status = 'available', appointment_id = null, updated_at = now() where id = s.id;
  proposta := public.offer_freed_slot(s.id, a.id);
  return jsonb_build_object('cancelled', true, 'reallocated', false, 'slotId', s.id, 'offer', proposta);
end $$;

create or replace function public.match_waitlist_after_slot_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  w public.waiting_list%rowtype;
  a public.appointments%rowtype;
begin
  if new.status <> 'available' or new.starts_at < timestamptz '2028-01-01 00:00:00+00' then
    return new;
  end if;

  select * into w
  from public.waiting_list candidate
  where candidate.status = 'waiting'
    and candidate.specialty_id = new.specialty_id
    and (cardinality(candidate.facility_ids) = 0 or new.facility_id = any(candidate.facility_ids))
    and (candidate.earliest_at is null or new.starts_at >= candidate.earliest_at)
    and (candidate.latest_at is null or new.starts_at <= candidate.latest_at)
    and (cardinality(candidate.professional_ids) = 0 or new.professional_id = any(candidate.professional_ids))
    and public.is_real_patient(candidate.patient_id)
  order by candidate.priority_score desc, candidate.created_at desc
  limit 1 for update skip locked;

  if not found then return new; end if;

  insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source, waitlist_entry_id)
  values (w.patient_id, new.id, new.specialty_id, new.facility_id, new.professional_id, new.starts_at, new.ends_at, 'booked', 'waitlist_reallocation', w.id)
  returning * into a;

  update public.slots set status = 'booked', appointment_id = a.id, updated_at = now() where id = new.id;
  update public.waiting_list set status = 'matched', appointment_id = a.id, matched_at = now(), updated_at = now() where id = w.id;
  insert into public.notifications(user_id, type, appointment_id, slot_id)
  values (w.patient_id, 'waitlist_match', a.id, new.id);

  return new;
end $$;
