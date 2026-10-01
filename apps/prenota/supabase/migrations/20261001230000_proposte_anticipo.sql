-- Proposte di anticipo (accetta / rifiuta).
-- Quando una prenotazione viene disdetta e nessuno in lista d'attesa la prende, lo slot liberato non
-- viene assegnato d'ufficio: viene PROPOSTO a un utente reale che ha già una prenotazione successiva
-- per la stessa prestazione. L'utente accetta (il nuovo appuntamento sostituisce il vecchio, che a sua
-- volta si libera e viene proposto al prossimo) o rifiuta (resta com'è; lo slot passa al prossimo).
-- I pazienti fittizi del test server non ricevono MAI slot né proposte (public.is_real_patient).

-- 1. Chi può ricevere uno slot liberato: utente reale che può fare login su Prenota.
--    Doppio controllo sui fittizi: flag app_metadata.fittizio e tabella test_server.pazienti_fittizi.
create or replace function public.is_real_patient(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from auth.users u
           where u.id = p_user_id
             and u.deleted_at is null
             and coalesce(u.raw_app_meta_data ->> 'fittizio', 'false') <> 'true'
             and coalesce(u.encrypted_password, '') <> '')
     and not exists (select 1 from test_server.pazienti_fittizi pf where pf.user_id = p_user_id)
$$;

-- 2. Proposte.
create table public.slot_offers (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id),
  patient_id uuid not null references auth.users(id) on delete cascade,
  current_appointment_id uuid not null references public.appointments(id),
  source_appointment_id uuid references public.appointments(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'withdrawn')),
  expires_at timestamptz not null,
  responded_at timestamptz,
  new_appointment_id uuid references public.appointments(id),
  created_at timestamptz not null default now()
);
comment on table public.slot_offers is 'Proposte di anticipo: slot liberato da una disdetta proposto a un utente reale con una prenotazione successiva per la stessa prestazione.';
create unique index slot_offers_pending_slot_idx on public.slot_offers (slot_id) where status = 'pending';
create unique index slot_offers_pending_appointment_idx on public.slot_offers (current_appointment_id) where status = 'pending';
create index slot_offers_patient_idx on public.slot_offers (patient_id, created_at desc);
create index slot_offers_expiry_idx on public.slot_offers (expires_at) where status = 'pending';
alter table public.slot_offers enable row level security;
-- Nessuna policy client: accesso solo dal server (service_role / test server).

-- 3. Proponi uno slot libero al prossimo candidato.
-- Candidati: prenotazioni attive di utenti reali, stessa prestazione (stessa branca e, quando il
-- catalogo del CUP la conosce, stessa prestazione esatta), più tardi dello slot, senza sovrapposizioni,
-- senza un'altra proposta in sospeso e a cui questo slot non sia già stato proposto.
-- Ordine: prima la stessa ASL della prenotazione attuale, poi chi ha prenotato da più tempo.
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
  left join test_server.strutture st_slot on st_slot.id = s.facility_id
  left join test_server.strutture st_cur on st_cur.id = a.facility_id
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
  order by (st_slot.asl_id is not distinct from st_cur.asl_id) desc, a.created_at asc, a.starts_at desc
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

-- 4. Disdetta (funzione del team Prenota) con tre cambiamenti:
--    a) la lista d'attesa considera solo utenti reali (mai fittizi);
--    b) le proposte in sospeso legate alla prenotazione disdetta vengono ritirate e passate oltre;
--    c) se nessuno in lista prende lo slot, lo slot viene proposto (offer_freed_slot).
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
  order by candidate.priority_score desc, candidate.created_at asc
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

-- 5. Risposta dell'utente. Gli esiti non validi tornano come status (non eccezioni), così le modifiche
--    fatte prima (es. proposta scaduta → passata oltre) restano salvate.
create or replace function public.respond_slot_offer(p_offer_id uuid, p_patient_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.slot_offers%rowtype;
  s public.slots%rowtype;
  cur public.appointments%rowtype;
  nuovo public.appointments%rowtype;
  disdetta jsonb;
begin
  select * into o from public.slot_offers where id = p_offer_id for update;
  if not found or o.patient_id <> p_patient_id then raise exception 'Offer not found'; end if;
  if o.status <> 'pending' then return jsonb_build_object('status', 'already_answered', 'offerStatus', o.status); end if;

  if o.expires_at <= now() then
    update public.slot_offers set status = 'expired', responded_at = now() where id = o.id;
    perform public.offer_freed_slot(o.slot_id, o.source_appointment_id);
    return jsonb_build_object('status', 'expired');
  end if;

  if not p_accept then
    update public.slot_offers set status = 'rejected', responded_at = now() where id = o.id;
    return jsonb_build_object('status', 'rejected', 'next', public.offer_freed_slot(o.slot_id, o.source_appointment_id));
  end if;

  select * into s from public.slots where id = o.slot_id for update;
  select * into cur from public.appointments where id = o.current_appointment_id for update;
  if s.status <> 'available' or s.starts_at <= now() then
    update public.slot_offers set status = 'withdrawn', responded_at = now() where id = o.id;
    return jsonb_build_object('status', 'slot_unavailable');
  end if;
  if cur.status <> 'booked' or cur.starts_at <= now() then
    update public.slot_offers set status = 'withdrawn', responded_at = now() where id = o.id;
    perform public.offer_freed_slot(o.slot_id, o.source_appointment_id);
    return jsonb_build_object('status', 'appointment_inactive');
  end if;

  insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source)
  values (p_patient_id, s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at, 'booked', 'waitlist_reallocation')
  returning * into nuovo;
  update public.slots set status = 'booked', appointment_id = nuovo.id, updated_at = now() where id = s.id;
  update public.slot_offers set status = 'accepted', responded_at = now(), new_appointment_id = nuovo.id where id = o.id;

  -- Il vecchio appuntamento si libera e viene proposto al prossimo (stessa logica delle disdette).
  disdetta := public.cancel_appointment_and_reallocate(cur.id, p_patient_id, 'patient');

  return jsonb_build_object('status', 'accepted', 'appointmentId', nuovo.id, 'startAt', nuovo.starts_at,
    'previousAppointmentId', cur.id, 'previousStartAt', cur.starts_at,
    'daysSaved', (cur.starts_at::date - nuovo.starts_at::date), 'previousSlot', disdetta);
end $$;

-- 6. Scadenza: proposte non risposte entro expires_at passano al prossimo candidato.
create or replace function public.expire_slot_offers()
returns integer language plpgsql security definer set search_path = public as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select id, slot_id, source_appointment_id from public.slot_offers
    where status = 'pending' and expires_at <= now()
    for update skip locked
  loop
    update public.slot_offers set status = 'expired', responded_at = now() where id = o.id;
    perform public.offer_freed_slot(o.slot_id, o.source_appointment_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- 7. Proposte di un utente, con i nomi dal catalogo del CUP (test_server: struttura, comune, ASL,
--    prestazione esatta). Prima fa scadere le proposte vecchie.
create or replace function public.patient_slot_offers(p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.expire_slot_offers();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'status', o.status, 'createdAt', o.created_at, 'expiresAt', o.expires_at,
      'respondedAt', o.responded_at,
      'slot', jsonb_build_object('id', s.id, 'specialtyId', s.specialty_id, 'facilityId', s.facility_id,
        'professionalId', s.professional_id, 'startAt', s.starts_at, 'endAt', s.ends_at,
        'prestazione', p.descrizione, 'struttura', st.nome, 'comune', st.comune,
        'aslSigla', asl.sigla, 'aslNome', asl.nome),
      'current', jsonb_build_object('id', a.id, 'facilityId', a.facility_id, 'startAt', a.starts_at,
        'struttura', stc.nome, 'comune', stc.comune, 'aslSigla', aslc.sigla, 'aslNome', aslc.nome),
      'daysSaved', (a.starts_at::date - s.starts_at::date)
    ) order by (o.status = 'pending') desc, o.created_at desc)
    from public.slot_offers o
    join public.slots s on s.id = o.slot_id
    join public.appointments a on a.id = o.current_appointment_id
    left join test_server.offerta ofr on ofr.struttura_id = s.facility_id and ofr.medico_id = s.professional_id
    left join test_server.prestazioni p on p.id = ofr.prestazione_id
    left join test_server.strutture st on st.id = s.facility_id
    left join test_server.asl asl on asl.id = st.asl_id
    left join test_server.strutture stc on stc.id = a.facility_id
    left join test_server.asl aslc on aslc.id = stc.asl_id
    where o.patient_id = p_patient_id
      and (o.status = 'pending' or o.created_at > now() - interval '30 days')
  ), '[]'::jsonb);
end $$;

-- 8. Prenotazione diretta: uno slot con una proposta in sospeso non è prenotabile da altri.
create or replace function public.book_available_slot(p_slot_id uuid, p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.slots%rowtype; a public.appointments%rowtype;
begin
  select * into s from public.slots where id = p_slot_id for update;
  if not found then raise exception 'Slot not found'; end if;
  if s.status <> 'available' or s.starts_at <= now() then raise exception 'Slot not available'; end if;
  if exists (select 1 from public.slot_offers where slot_id = s.id and status = 'pending') then
    raise exception 'Slot not available: offered to another patient';
  end if;
  insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source)
  values (p_patient_id, s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at, 'booked', 'self_booking') returning * into a;
  update public.slots set status = 'booked', appointment_id = a.id, updated_at = now() where id = s.id;
  return jsonb_build_object('appointmentId', a.id, 'slotId', s.id, 'startAt', a.starts_at);
end $$;

-- 9. Abbinamento automatico dei nuovi slot dalla lista d'attesa: solo utenti reali.
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
  order by candidate.priority_score desc, candidate.created_at asc
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

-- Permessi: solo server (service_role) e test server (postgres).
revoke all on function public.is_real_patient(uuid) from public, anon, authenticated;
revoke all on function public.offer_freed_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.respond_slot_offer(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.expire_slot_offers() from public, anon, authenticated;
revoke all on function public.patient_slot_offers(uuid) from public, anon, authenticated;
revoke all on function public.cancel_appointment_and_reallocate(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.book_available_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.match_waitlist_after_slot_insert() from public, anon, authenticated;
grant execute on function public.is_real_patient(uuid) to service_role;
grant execute on function public.offer_freed_slot(uuid, uuid) to service_role;
grant execute on function public.respond_slot_offer(uuid, uuid, boolean) to service_role;
grant execute on function public.expire_slot_offers() to service_role;
grant execute on function public.patient_slot_offers(uuid) to service_role;
grant execute on function public.cancel_appointment_and_reallocate(uuid, uuid, text) to service_role;
grant execute on function public.book_available_slot(uuid, uuid) to service_role;
revoke all on public.slot_offers from anon, authenticated;
grant select, insert, update, delete on public.slot_offers to service_role;

-- Scadenze controllate ogni 10 minuti anche se nessuno apre Prenota.
select cron.schedule('scadenza-proposte-anticipo', '*/10 * * * *', 'select public.expire_slot_offers()');
