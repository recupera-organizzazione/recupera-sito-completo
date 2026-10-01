-- Utente di prova che simula un utente loggato su Prenota, per testare la disdetta casuale
-- finché Prenota non ha il login. Non è un paziente fittizio: le sue prenotazioni risultano "loggate".
-- È riconoscibile da raw_app_meta_data.utente_prova = true e si cancella con supabase/seed/reset.sql.

create function test_server.crea_prenotazione_prova(p_prestazione text default null)
returns jsonb
language plpgsql
set search_path = test_server, public, pg_temp
as $$
declare
  uid uuid;
  slot_id uuid;
begin
  select id into uid from auth.users where email = 'utente.prova@prenota.recupera.test';
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

  -- Slot libero tra 30 e 120 giorni: lascia spazio a prenotazioni fittizie precedenti da disdire.
  select s.id into slot_id
  from public.slots s
  where s.status = 'available'
    and (p_prestazione is null or s.specialty_id = p_prestazione)
    and s.starts_at between now() + interval '30 days' and now() + interval '120 days'
  order by random() limit 1;

  if slot_id is null then
    raise exception using errcode = 'P0002', message = 'Nessuno slot libero tra 30 e 120 giorni per questa prestazione';
  end if;

  -- Prenota con la funzione del team Prenota, come farebbe l'app.
  return public.book_available_slot(slot_id, uid) || jsonb_build_object('patientId', uid);
end $$;

-- Vista prenotazioni: aggiunge utente_prova.
create or replace view test_server.prenotazioni as
select a.id, a.patient_id, a.slot_id, a.specialty_id, p.descrizione as prestazione,
       a.facility_id, st.nome as struttura, st.comune, asl.sigla as asl,
       a.professional_id, m.nome as medico,
       a.starts_at, a.ends_at, a.status, a.source, a.created_at,
       case when pf.user_id is null then 'loggata' else 'fittizia' end as tipo,
       u.email,
       coalesce((u.raw_app_meta_data ->> 'utente_prova')::boolean, false) as utente_prova
from public.appointments a
left join test_server.pazienti_fittizi pf on pf.user_id = a.patient_id
left join auth.users u on u.id = a.patient_id
left join test_server.prestazioni p on p.id = a.specialty_id
left join test_server.strutture st on st.id = a.facility_id
left join test_server.asl asl on asl.id = st.asl_id
left join test_server.medici m on m.id = a.professional_id;

revoke all on all tables in schema test_server from public, anon, authenticated;
revoke all on function test_server.crea_prenotazione_prova(text) from public, anon, authenticated;
