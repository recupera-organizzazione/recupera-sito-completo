-- Seed 5/5: liste piene fino a fine 2027, come in un CUP reale con attese lunghe.
-- Dopo il seed 4 ogni anno ha ~41% di slot liberi; qui si prenotano con pazienti fittizi della stessa
-- ASL tutti gli slot liberi prima del 2028, così le prime disponibilità sono nel 2028.
-- Restano liberi gli slot liberati da una disdetta (cancellation_events): sono quelli che Prenota
-- deve riassegnare. I volumi calibrati sul dataset restano validi solo per il 2028
-- (vista test_server.confronto_dataset). Idempotente: si può rieseguire dopo nuove disdette.
-- Eseguire un anno alla volta: psql "$DATABASE_URL" -v anno=2026 -f supabase/seed/05_agenda_piena_fino_2027.sql (poi 2027)

with conteggi as (select asl_id, count(*) n from test_server.pazienti_fittizi group by asl_id),
     candidati as materialized (
       select s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at,
              st.asl_id, 1 + floor(random() * c.n)::int k
       from public.slots s
       join test_server.strutture st on st.id = s.facility_id
       join conteggi c on c.asl_id = st.asl_id
       where s.status = 'available'
         and s.starts_at > now()
         and s.starts_at >= make_date(:anno, 1, 1) and s.starts_at < make_date(:anno + 1, 1, 1)
         and s.starts_at < date '2028-01-01'
         and not exists (select 1 from public.cancellation_events ce where ce.slot_id = s.id)),
     nuove as (
       insert into public.appointments (patient_id, slot_id, specialty_id, facility_id, professional_id,
                                        starts_at, ends_at, status, source, created_at)
       select pf.user_id, s.id, s.specialty_id, s.facility_id, s.professional_id,
              s.starts_at, s.ends_at, 'booked', 'self_booking',
              now() - random() * interval '90 days'
       from candidati s
       join test_server.pazienti_fittizi pf on pf.asl_id = s.asl_id and pf.k = s.k
       returning id, slot_id)
update public.slots s
set status = 'booked', appointment_id = nuove.id, updated_at = now()
from nuove where nuove.slot_id = s.id;
