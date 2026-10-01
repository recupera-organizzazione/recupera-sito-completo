-- Rimuove SOLO i dati generati dal test-server: pazienti fittizi, utente di prova, le loro prenotazioni
-- e gli slot non usati da utenti reali. Prenotazioni e utenti reali di Prenota restano intatti,
-- così come gli slot che occupano. Admin, catalogo e dataset non vengono toccati
-- (per rigenerare l'offerta: delete from test_server.offerta; delete from test_server.medici; poi seed 03).

begin;

create temp table fittizi on commit drop as
  select user_id from test_server.pazienti_fittizi
  union
  select id from auth.users where raw_app_meta_data ->> 'utente_prova' = 'true';

delete from test_server.disdette_test;
delete from public.notifications where user_id in (select user_id from fittizi);
delete from public.cancellation_events ce using public.appointments a
  where a.id = ce.appointment_id and a.patient_id in (select user_id from fittizi);
update public.slots set appointment_id = null
  where appointment_id in (select id from public.appointments where patient_id in (select user_id from fittizi));
-- Prima la lista d'attesa: waiting_list.appointment_id punta alle prenotazioni (vincolo non differibile).
delete from public.waiting_list where patient_id in (select user_id from fittizi);
delete from public.appointments where patient_id in (select user_id from fittizi);
-- Slot senza prenotazioni reali (anche storiche) e senza riferimenti residui.
delete from public.slots s
  where s.appointment_id is null
    and not exists (select 1 from public.appointments a where a.slot_id = s.id)
    and not exists (select 1 from public.cancellation_events ce where ce.slot_id = s.id)
    and not exists (select 1 from public.notifications n where n.slot_id = s.id);
delete from auth.users where id in (select user_id from fittizi);  -- cascata su pazienti_fittizi

commit;
