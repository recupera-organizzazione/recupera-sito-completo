-- Seed 4/4: agenda e prenotazioni fittizie da domani al 31/12/2028.
-- Lun-ven slot pieni, sabato metà slot, domenica e festivi nazionali chiusi.
-- Ogni slot è prenotato con probabilità offerta.prob_prenotazione, calcolata nel seed 3 in modo che le
-- prenotazioni settimanali per ASL e prestazione = dataset 07-11 ottobre 2024 / scala (20).
-- Eseguire un anno alla volta per stare nel timeout di 2 minuti:
--   psql "$DATABASE_URL" -v anno=2026 -f supabase/seed/04_slot_prenotazioni.sql   (poi 2027, 2028)

-- 1. Slot: specialty_id = branca ("cardiologia"), facility_id = "Ospedale ... - Comune",
--    professional_id = nome del medico (testi leggibili, confrontati esatti da Prenota).
insert into public.slots (specialty_id, facility_id, professional_id, starts_at, ends_at, status)
select p.branca, o.struttura_id, o.medico_id,
       ((d::date + time '08:30' + make_interval(mins => n * p.durata_min)) at time zone 'Europe/Rome'),
       ((d::date + time '08:30' + make_interval(mins => (n + 1) * p.durata_min)) at time zone 'Europe/Rome'),
       'available'
-- cast a timestamp: senza, generate_series sceglie timestamptz e l'orario slitta
from generate_series(greatest(current_date + 1, make_date(:anno, 1, 1))::timestamp,
                     make_date(:anno, 12, 31)::timestamp, interval '1 day') d
cross join test_server.offerta o
join test_server.prestazioni p on p.id = o.prestazione_id
cross join lateral generate_series(0, case when extract(isodow from d) = 6
                                           then o.slot_giornalieri / 2 else o.slot_giornalieri end - 1) n
where extract(isodow from d) < 7
  and to_char(d, 'MM-DD') not in ('01-01','01-06','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26')
  and d::date not in (date '2027-03-29', date '2028-04-17');  -- Pasquetta

-- 2. Prenotazioni fittizie, con paziente della stessa ASL.
-- random() va calcolato in una CTE materializzata: scritto nel WHERE accanto a o.prob_prenotazione
-- Postgres lo valuta una volta per riga di offerta invece che per slot.
with conteggi as (select asl_id, count(*) n from test_server.pazienti_fittizi group by asl_id),
     candidati as materialized (
       select s.id, s.specialty_id, s.facility_id, s.professional_id, s.starts_at, s.ends_at,
              st.asl_id, o.prob_prenotazione, random() r, 1 + floor(random() * c.n)::int k
       from public.slots s
       join test_server.offerta o on o.struttura_id = s.facility_id and o.medico_id = s.professional_id
       join test_server.strutture st on st.id = s.facility_id
       join conteggi c on c.asl_id = st.asl_id
       where s.status = 'available'
         and s.starts_at >= make_date(:anno, 1, 1) and s.starts_at < make_date(:anno + 1, 1, 1)),
     nuove as (
       insert into public.appointments (patient_id, slot_id, specialty_id, facility_id, professional_id,
                                        starts_at, ends_at, status, source, created_at)
       select pf.user_id, s.id, s.specialty_id, s.facility_id, s.professional_id,
              s.starts_at, s.ends_at, 'booked', 'self_booking',
              now() - random() * interval '90 days'
       from candidati s
       join test_server.pazienti_fittizi pf on pf.asl_id = s.asl_id and pf.k = s.k
       where s.r < s.prob_prenotazione
       returning id, slot_id)
update public.slots s
set status = 'booked', appointment_id = nuove.id, updated_at = now()
from nuove where nuove.slot_id = s.id;
