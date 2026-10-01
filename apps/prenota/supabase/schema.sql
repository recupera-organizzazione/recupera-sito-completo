-- Esegui una sola volta nel SQL Editor del progetto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  specialty_id text not null,
  facility_id text not null,
  professional_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'booked')),
  appointment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  slot_id uuid not null references public.slots(id),
  specialty_id text not null,
  facility_id text not null,
  professional_id text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('booked', 'cancelled')),
  source text not null check (source in ('self_booking', 'waitlist_reallocation')),
  waitlist_entry_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.slots drop constraint if exists slots_appointment_id_fkey;
alter table public.slots add constraint slots_appointment_id_fkey foreign key (appointment_id) references public.appointments(id) deferrable initially deferred;

create table if not exists public.waiting_list (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id),
  specialty_id text not null,
  facility_ids text[] not null default '{}',
  professional_ids text[] not null default '{}',
  earliest_at timestamptz,
  latest_at timestamptz,
  priority_score integer not null default 0 check (priority_score between 0 and 100),
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'withdrawn')),
  appointment_id uuid references public.appointments(id),
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (earliest_at is null or latest_at is null or latest_at >= earliest_at)
);
alter table public.appointments drop constraint if exists appointments_waitlist_entry_id_fkey;
alter table public.appointments add constraint appointments_waitlist_entry_id_fkey foreign key (waitlist_entry_id) references public.waiting_list(id) deferrable initially deferred;

create table if not exists public.cancellation_events (
  appointment_id uuid primary key references public.appointments(id),
  slot_id uuid not null references public.slots(id),
  specialty_id text not null,
  facility_id text not null,
  starts_at timestamptz not null,
  cancelled_at timestamptz not null default now(),
  reallocated boolean not null
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null,
  appointment_id uuid not null references public.appointments(id),
  slot_id uuid not null references public.slots(id),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists slots_availability_idx on public.slots (status, starts_at);
create index if not exists appointments_patient_created_idx on public.appointments (patient_id, starts_at desc);
create index if not exists waiting_patient_created_idx on public.waiting_list (patient_id, created_at desc);
create index if not exists waiting_candidate_idx on public.waiting_list (specialty_id, status, priority_score desc, created_at);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists cancellations_date_idx on public.cancellation_events (cancelled_at);
create index if not exists appointments_created_idx on public.appointments (created_at);

alter table public.slots enable row level security;
alter table public.appointments enable row level security;
alter table public.waiting_list enable row level security;
alter table public.cancellation_events enable row level security;
alter table public.notifications enable row level security;
-- Nessuna policy client: accesso ai dati solo dal server con service_role.

create or replace function public.book_available_slot(p_slot_id uuid, p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.slots%rowtype; a public.appointments%rowtype;
begin
  select * into s from public.slots where id = p_slot_id for update;
  if not found then raise exception 'Slot not found'; end if;
  if s.status <> 'available' or s.starts_at <= now() then raise exception 'Slot not available'; end if;
  insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source)
  values (p_patient_id, s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at, 'booked', 'self_booking') returning * into a;
  update public.slots set status = 'booked', appointment_id = a.id, updated_at = now() where id = s.id;
  return jsonb_build_object('appointmentId', a.id, 'slotId', s.id, 'startAt', a.starts_at);
end $$;

create or replace function public.cancel_appointment_and_reallocate(p_appointment_id uuid, p_actor_id uuid, p_actor_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.appointments%rowtype;
  s public.slots%rowtype;
  w public.waiting_list%rowtype;
  new_appointment public.appointments%rowtype;
  has_candidate boolean := false;
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
  order by candidate.priority_score desc, candidate.created_at asc
  limit 1 for update skip locked;
  has_candidate := found;

  update public.appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_id where id = a.id;
  insert into public.cancellation_events(appointment_id, slot_id, specialty_id, facility_id, starts_at, reallocated)
  values (a.id, a.slot_id, a.specialty_id, a.facility_id, a.starts_at, has_candidate);

  if has_candidate then
    insert into public.appointments(patient_id, slot_id, specialty_id, facility_id, professional_id, starts_at, ends_at, status, source, waitlist_entry_id)
    values (w.patient_id, s.id, a.specialty_id, a.facility_id, s.professional_id, s.starts_at, s.ends_at, 'booked', 'waitlist_reallocation', w.id)
    returning * into new_appointment;
    update public.slots set status = 'booked', appointment_id = new_appointment.id, updated_at = now() where id = s.id;
    update public.waiting_list set status = 'matched', appointment_id = new_appointment.id, matched_at = now(), updated_at = now() where id = w.id;
    insert into public.notifications(user_id, type, appointment_id, slot_id)
    values (w.patient_id, 'waitlist_match', new_appointment.id, s.id);
    return jsonb_build_object('cancelled', true, 'reallocated', true);
  end if;

  update public.slots set status = 'available', appointment_id = null, updated_at = now() where id = s.id;
  return jsonb_build_object('cancelled', true, 'reallocated', false, 'slotId', s.id);
end $$;

revoke all on function public.book_available_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_appointment_and_reallocate(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.book_available_slot(uuid, uuid) to service_role;
grant execute on function public.cancel_appointment_and_reallocate(uuid, uuid, text) to service_role;

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
