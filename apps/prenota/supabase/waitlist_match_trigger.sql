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

revoke all on function public.match_waitlist_after_slot_insert() from public, anon, authenticated;
drop trigger if exists slots_match_waitlist_after_insert on public.slots;
create trigger slots_match_waitlist_after_insert
  after insert on public.slots
  for each row execute function public.match_waitlist_after_slot_insert();
