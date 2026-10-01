-- Record di test leggibili come li usa Prenota (che confronta prestazione e sede come testo esatto):
--   slots/appointments.specialty_id  = branca come la scrive un paziente ("cardiologia"),
--   facility_id                      = "Ospedale ... - Comune",
--   professional_id                  = nome del medico.
-- La prestazione esatta del dataset (test_server.prestazioni, ID_PRESTAZIONE) resta nel catalogo e si
-- ricava da struttura + medico (test_server.offerta), così la calibrazione sul dataset non cambia.
-- Parte 1/2: branca per prestazione e tabella di corrispondenza vecchi -> nuovi codici.

alter table test_server.prestazioni add column branca text;
update test_server.prestazioni set branca = case id
  when '1' then 'cardiologia'          -- Prima visita cardiologica
  when '56' then 'cardiologia'         -- Elettrocardiogramma
  when '5' then 'oculistica'
  when '11' then 'fisiatria'
  when '8' then 'otorinolaringoiatria'
  when '10' then 'dermatologia'
  when '6' then 'ortopedia'
  when '4' then 'neurologia'
  when '45' then 'ecografia'           -- Ecografia dell'addome completo
  when '15' then 'mammografia'         -- Mammografia bilaterale
end;
alter table test_server.prestazioni alter column branca set not null;

create table test_server.mappa_codici (
  tipo text not null check (tipo in ('prestazione', 'struttura', 'medico')),
  vecchio text not null,
  nuovo text not null,
  primary key (tipo, vecchio)
);
insert into test_server.mappa_codici
select 'prestazione', id, branca from test_server.prestazioni
union all select 'struttura', id, nome || ' - ' || comune from test_server.strutture
union all select 'medico', id, nome from test_server.medici;

revoke all on all tables in schema test_server from public, anon, authenticated;
