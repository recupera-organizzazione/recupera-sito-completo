-- Seed 1/4: catalogo Regione Puglia, pazienti fittizi.
-- Gli admin non si creano qui: sono condivisi con la dashboard (Supabase Auth, vedi README).
-- Ordine: 01 catalogo, 03 offerta, 04 slot e prenotazioni (dopo tutte le migrazioni; il dataset
-- arriva dalla sync con dati.puglia.it, vedi README).
-- Non idempotente: per rigenerare usa prima supabase/seed/reset.sql.

-- ASL Puglia (codici del dataset Min. Salute, come in recupera-dashboard).
insert into test_server.asl (id, sigla, nome) values
  ('160114', 'BA', 'ASL Bari'),
  ('160106', 'BR', 'ASL Brindisi'),
  ('160113', 'BT', 'ASL Barletta-Andria-Trani'),
  ('160115', 'FG', 'ASL Foggia'),
  ('160116', 'LE', 'ASL Lecce'),
  ('160112', 'TA', 'ASL Taranto');

-- Le 10 prestazioni con più prenotazioni nel dataset (settimana 07-11 ottobre 2024).
-- branca = specialty_id dei record di Prenota, come la scrive un paziente ("cardiologia").
insert into test_server.prestazioni (id, codice, descrizione, durata_min, branca) values
  ('56', '89.52',   'Elettrocardiogramma', 15, 'cardiologia'),
  ('5',  '95.02',   'Prima visita oculistica', 30, 'oculistica'),
  ('1',  '89.7',    'Prima visita cardiologica', 30, 'cardiologia'),
  ('45', '88.76.1', 'Ecografia dell''addome completo', 30, 'ecografia'),
  ('11', '89.7',    'Prima visita fisiatrica', 30, 'fisiatria'),
  ('8',  '89.7',    'Prima visita otorinolaringoiatrica', 30, 'otorinolaringoiatria'),
  ('10', '89.7',    'Prima visita dermatologica', 30, 'dermatologia'),
  ('6',  '89.7',    'Prima visita ortopedica', 30, 'ortopedia'),
  ('4',  '89.13',   'Prima visita neurologica', 30, 'neurologia'),
  ('15', '87.37.1', 'Mammografia bilaterale', 20, 'mammografia');

-- Ospedali reali delle ASL pugliesi (il dataset è per ASL: l'attribuzione alle strutture è inventata).
-- quota_capacita: quota dell'offerta dell'ASL erogata dalla struttura (principale 60%, secondaria 40%).
-- id = "Nome - Comune": è il facility_id dei record di Prenota (testo leggibile, confrontato esatto).
insert into test_server.strutture (id, asl_id, nome, comune, quota_capacita) values
  ('Ospedale San Paolo - Bari',   '160114', 'Ospedale San Paolo',               'Bari',                0.60),
  ('Ospedale Di Venere - Bari',   '160114', 'Ospedale Di Venere',               'Bari',                0.40),
  ('Ospedale Antonio Perrino - Brindisi',    '160106', 'Ospedale Antonio Perrino',         'Brindisi',            0.60),
  ('Ospedale Dario Camberlingo - Francavilla Fontana','160106', 'Ospedale Dario Camberlingo',       'Francavilla Fontana', 0.40),
  ('Ospedale Mons. R. Dimiccoli - Barletta',  '160113', 'Ospedale Mons. R. Dimiccoli',      'Barletta',            0.60),
  ('Ospedale Lorenzo Bonomo - Andria',     '160113', 'Ospedale Lorenzo Bonomo',          'Andria',              0.40),
  ('Ospedale Giuseppe Tatarella - Cerignola',  '160115', 'Ospedale Giuseppe Tatarella',      'Cerignola',           0.60),
  ('Ospedale Teresa Masselli Mascia - San Severo',   '160115', 'Ospedale Teresa Masselli Mascia',  'San Severo',          0.40),
  ('Ospedale Vito Fazzi - Lecce',      '160116', 'Ospedale Vito Fazzi',              'Lecce',               0.60),
  ('Ospedale Santa Caterina Novella - Galatina',   '160116', 'Ospedale Santa Caterina Novella',  'Galatina',            0.40),
  ('Ospedale SS. Annunziata - Taranto', '160112', 'Ospedale SS. Annunziata',          'Taranto',             0.60),
  ('Ospedale Valle d''Itria - Martina Franca',    '160112', 'Ospedale Valle d''Itria',          'Martina Franca',      0.40);

-- Pazienti fittizi: utenti auth senza password (non possono fare login), ripartiti per ASL
-- in proporzione approssimativa alla popolazione.
with quote(asl_id, sigla, n) as (values
       ('160114', 'ba', 770), ('160116', 'le', 500), ('160115', 'fg', 385),
       ('160112', 'ta', 360), ('160106', 'br', 245), ('160113', 'bt', 240)),
     nomi as (select array['Luca','Giulia','Francesco','Sofia','Alessandro','Aurora','Lorenzo','Alice',
                           'Mattia','Ginevra','Andrea','Emma','Gabriele','Giorgia','Leonardo','Beatrice',
                           'Riccardo','Anna','Tommaso','Vittoria','Davide','Chiara','Giuseppe','Martina',
                           'Antonio','Sara','Nicola','Rosa','Vito','Angela','Michele','Teresa'] n,
                     array['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci',
                           'Marino','Greco','Bruno','Gallo','Conti','De Luca','Mancini','Costa',
                           'Giordano','Rizzo','Lombardi','Moretti','Lorusso','Lomuscio','Caputo','Laterza',
                           'Lacatena','Diomede','Introna','Sasso','Carella','Fanelli','Lerario','Schiavone'] c),
     p as (select gen_random_uuid() id, q.asl_id, q.sigla, k,
                  nomi.n[1 + floor(random() * 32)::int] nome,
                  nomi.c[1 + floor(random() * 32)::int] cognome
           from quote q cross join generate_series(1, q.n) k cross join nomi),
     u as (insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                                   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                                   confirmation_token, recovery_token, email_change_token_new,
                                   email_change, email_change_token_current, reauthentication_token,
                                   phone_change, phone_change_token)
           select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
                  lower(replace(nome || '.' || cognome, ' ', '')) || '.' || sigla || k || '@paziente.recupera.test',
                  '',
                  '{"provider":"email","providers":["email"],"fittizio":true}'::jsonb,
                  jsonb_build_object('nome', nome, 'cognome', cognome, 'asl', upper(sigla)),
                  now() - random() * interval '2 years', now(),
                  '', '', '', '', '', '', '', ''
           from p
           returning id)
insert into test_server.pazienti_fittizi (user_id, asl_id, k)
select p.id, p.asl_id, p.k from p join u on u.id = p.id;
