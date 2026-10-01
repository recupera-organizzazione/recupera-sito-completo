# recupera-test-server

> **Nel sito completo** (`recupera-sito-completo`) questa app si avvia dalla radice con `npm run dev` ed è servita dal gateway su `/test-server/`: vedi il `README.md` di radice. Le istruzioni qui sotto valgono per l'avvio separato.

Finto sistema **CUP** per sviluppare e testare reCUPera senza il CUP reale: agenda di slot, prenotazioni fittizie fino al 2028 con volumi basati sul dataset reale della Regione Puglia (settimana 07-11 ottobre 2024), login admin, frontend di test e disdetta casuale di una prenotazione per provare il flusso di riassegnazione dell'app Prenota.

## Architettura

- **Database:** progetto Supabase `recupera` (condiviso con Prenota).
  - Tabelle `public.slots`, `public.appointments`, `public.waiting_list`, `public.cancellation_events`, `public.notifications` e funzioni `book_available_slot` / `cancel_appointment_and_reallocate`: create dal **team Prenota**, il test-server le popola e le usa senza cambiarne la struttura.
  - Schema `test_server` (non esposto dall'API Supabase): admin, catalogo, vista `monitoraggio` (dataset sincronizzato), pazienti fittizi, log delle disdette, viste `prenotazioni`, `pressione`, `confronto_dataset`, funzioni `disdici_casuale`, `crea_prenotazione_prova`, `carico_strutture`.
- **Server:** Node.js 22 + Express 5, `pg` diretto al database, `zod` per la validazione, JWT per le sessioni admin.
- **Frontend di test:** un solo file `public/index.html` (HTML, CSS e JS senza framework), servito dallo stesso server.

### Prenotazioni loggate e fittizie

Ogni prenotazione (`public.appointments`) è legata a un utente `auth.users` tramite `patient_id`:

- **loggata**: utente reale che ha fatto login su Prenota e ha prenotato;
- **fittizia**: paziente generato dal seed (in `test_server.pazienti_fittizi`, email `@paziente.recupera.test`, senza password: non può fare login).

La vista `test_server.prenotazioni` le unisce con la colonna `tipo`.

## Dati generati

> **Volumi basati sul dataset reale "Monitoraggio dei tempi di attesa" della Regione Puglia,
> settimana 07-11 ottobre 2024** ([dati.puglia.it](https://dati.puglia.it/ckan/dataset/monitoraggio-tempi-di-attesa), CC BY 4.0),
> lo stesso CSV di `recupera-dashboard`. Prenotazioni, pazienti e medici sono **fittizi**; i volumi sono in **scala 1:20**.

| Cosa | Quantità |
|---|---|
| Slot | ~250.000, dal 2 ottobre 2026 al 31 dicembre 2028 |
| Prenotazioni fittizie | ~148.000 (~1.287 a settimana = 25.732 del dataset / 20) |
| Pazienti fittizi | 2.500, ripartiti per ASL |
| Strutture | 12 (2 per ASL), tutte le 10 prestazioni, 1 medico per prestazione |

### Come i dati seguono il dataset

- **Volumi:** per ogni ASL e prestazione, le prenotazioni settimanali generate = `PRENOTAZIONI` del dataset / 20 (verificato: scarto entro ±1% per ASL, ±3% per prestazione; vista `test_server.confronto_dataset`).
- **Quali centri sono più pieni:** il dataset non ha strutture né capacità, solo ASL. Il riempimento delle agende segue la **pressione** dell'ASL per prestazione: `pressione = 1 - (B_TMAX + D_TMAX + P_TMAX) / PRENOTAZIONI_DAGARANTIRE`, riempimento obiettivo `50% + 45% × pressione` (vista `test_server.pressione`). Risultato: BT e BA sono le ASL più piene, FG la più vuota.
- **Interpretazione di `*_TMAX`:** il dataset non ha dizionario dati. Lo leggiamo come prenotazioni garantite **entro** il tempo massimo, perché la quota cresce con la tolleranza della classe (B 10 gg: 40%, D: 52%, P 120 gg: 69%), cosa coerente solo con "entro". `recupera-dashboard` oggi lo descrive come "oltre": da allineare tra i team.
- **Inventato:** la ripartizione dell'offerta di un'ASL tra le sue 2 strutture (principale 60%, secondaria 40%), orari, durate, nomi di medici e pazienti. Per ASL piccole il numero di slot è arrotondato per eccesso, quindi il riempimento reale è un po' sotto l'obiettivo.

Orari: dalle 08:30 (ora di Roma), lun-ven slot pieni, sabato metà, domenica e festivi nazionali chiusi. Il volume settimanale è costante fino al 2028 (il dataset copre una sola settimana).

### Fonti

- **Reali:** codici e nomi delle 6 ASL, le 10 prestazioni più prenotate (ID, codice, descrizione), volumi e quote TMAX dal dataset; nomi e comuni di 12 ospedali reali delle ASL pugliesi.
- **Inventati:** tutto il resto (vedi sopra).

## Frontend di test

`npm run dev` e apri <http://localhost:3001>: login admin, poi tre schede.

- **Centri:** riempimento delle 12 strutture nel periodo scelto e confronto per ASL (e per prestazione) tra dataset e simulazione.
- **Prenotazioni:** elenco con filtri (loggate/fittizie, stato, prestazione, struttura, date).
- **Test disdetta:** crea una prenotazione con l'utente di prova (simula un utente loggato su Prenota), poi disdici a caso una prenotazione fittizia compatibile e guarda lo slot liberato.

## Avvio

```bash
cp .env.example .env   # inserisci DATABASE_URL (Supabase > Connect > Session pooler), JWT_SECRET, SUPABASE_ANON_KEY e ADMIN_EMAIL
npm install
npm run dev            # http://localhost:3001
```

**Admin condivisi con la dashboard:** il login si comporta come quello di `recupera-dashboard`: lo username deve coincidere con `ADMIN_USER`, la password è verificata da Supabase Auth sull'account `ADMIN_EMAIL`, che deve avere `app_metadata.role = 'admin'`. Usa gli stessi `ADMIN_USER`/`ADMIN_EMAIL` del `.env` della dashboard, così lo stesso account entra in entrambi i pannelli. La password non è scritta nel repo: chiedila a chi gestisce il progetto. Non c'è registrazione: l'account si crea o aggiorna dalla dashboard con `ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run create:admin` (in `recupera-dashboard/backend`). `public.admin_users` non è più usata per il login. `test_server.admin_users` resta solo come anagrafica locale, creata al primo login, per collegare le disdette all'admin.

## Formato dei record (come li usa Prenota)

Prenota confronta prestazione e sede come **testo esatto** (lista d'attesa ↔ slot liberati), quindi i record di test sono scritti come li scriverebbe un utente:

| Campo | Esempio | Da dove |
|---|---|---|
| `specialty_id` | `cardiologia` | branca della prestazione (`test_server.prestazioni.branca`) |
| `facility_id` | `Ospedale San Paolo - Bari` | `test_server.strutture.id` |
| `professional_id` | `Dott. Angela Lattanzio` | `test_server.medici.id` |

Branche: cardiologia (prima visita cardiologica ed elettrocardiogramma), oculistica, fisiatria, otorinolaringoiatria, dermatologia, ortopedia, neurologia, ecografia (addome completo), mammografia (bilaterale). La prestazione esatta del dataset (`ID_PRESTAZIONE`) si ricava da struttura + medico in `test_server.offerta`; le viste `prenotazioni` e `confronto_dataset` lo fanno già (colonna `prestazione_id`).

## App Prenota dentro il test-server (`/prenota/`)

<http://localhost:3001/prenota/> è il frontend di `recupera-prenotazioni` (cartella `public/`), copiato in `public/prenota` con `scripts/importa-prenota.sh` (rende relativi i percorsi assoluti, nient'altro). Le sue API (`/prenota/api/...`, stesso contratto di `recupera-prenotazioni/src/server.js`) sono in `src/routes/prenota.js`: login con Supabase Auth (serve `SUPABASE_URL` e `SUPABASE_ANON_KEY` nel `.env`), prenotazione e disdetta con `public.book_available_slot` e `public.cancel_appointment_and_reallocate`.

- Chi si registra qui è un utente reale: le sue prenotazioni risultano **loggate** e possono essere target della disdetta casuale.
- Nella lista d'attesa prestazione e sedi si possono scrivere in modo approssimativo (`Cardiologia`, `visita fisiatrica`, `Bari`): il test-server le salva come nei record di test (`cardiologia`, `Ospedale San Paolo - Bari`, …).
- Account di prova con password: `paziente.test@prenota.recupera.test` (password non nel repo, chiedila a chi gestisce il progetto); `reset.sql` lo cancella come l'utente di prova.
- Dopo una modifica di Prenota (`apps/prenota/public` nel sito completo): `sh scripts/importa-prenota.sh`.

## API (`/api/v1`)

Errori sempre nel formato `{ "error": { "code", "message" } }`. 🔒 = richiede `Authorization: Bearer <token>`.

| Metodo | Endpoint | Descrizione |
|---|---|---|
| GET | `/health` | stato server e database |
| POST | `/auth/login` | `{ username, password }` → `{ token, admin }` (token valido 8 ore) |
| GET | `/auth/me` 🔒 | admin del token |
| GET | `/catalogo` | ASL, prestazioni, strutture, medici e offerta, per tradurre gli id di slot e prenotazioni |
| GET | `/prenotazioni` 🔒 | filtri: `tipo` (`loggata`, `fittizia`, `tutte`), `stato` (`booked`, `cancelled`, `tutti`), `prestazione`, `struttura`, `paziente`, `da`, `a` (YYYY-MM-DD), `limit` (max 500), `offset` |
| POST | `/test/disdici-casuale` 🔒 | `{ target_id? }` disdice una prenotazione fittizia compatibile con una prenotazione reale (vedi sotto) |
| POST | `/test/prenotazione-prova` 🔒 | `{ prestazione? }` l'account di prova con login (`paziente.test@prenota.recupera.test`, altrimenti `utente.prova@…` senza login) prenota uno dei primi slot liberi con `public.book_available_slot`; la prenotazione risulta loggata e può ricevere proposte di anticipo |
| GET | `/test/disdette` 🔒 | ultime 50 disdette di test |
| POST | `/test/reset` 🔒 | `{ conferma: "RESET" }` riporta il database allo stato iniziale (vedi sotto); risponde `202` e prosegue in background |
| GET | `/test/reset` 🔒 | stato dell'ultimo reset: `stato` (`mai_eseguito`, `in_corso`, `completato`, `errore`), `passi`, `passo`, `dettagli` |
| GET | `/slot/liberi` 🔒 | slot futuri liberi con nomi dal catalogo; filtri `prestazione`, `struttura`, `asl`, `da`, `a`, `limit`, `offset`; in più `mesi` (liberi per mese) e `primi` (prima disponibilità per prestazione); `da_disdetta` = slot liberato da una disdetta |
| GET | `/statistiche/centri` 🔒 | `da`, `a` (default: prossime 8 settimane) → slot, prenotati, liberi e riempimento per struttura, dal più pieno |
| GET | `/statistiche/dataset` 🔒 | confronto per ASL e prestazione tra prenotazioni settimanali del dataset e simulate, con pressione e riempimento |

### Reset del database

Pulsante **Resetta il database** nella scheda *Test disdetta* (chiede di scrivere `RESET`). In **una sola transazione** (circa 80 secondi; se fallisce non cambia nulla): svuota `slots`, `appointments`, `waiting_list`, `notifications`, `cancellation_events`, `slot_offers` e `test_server.disdette_test` — **anche le prenotazioni degli utenti reali**, gli account restano — poi rigenera l'agenda da domani al 31/12/2028 con solo prenotazioni fittizie (come i seed 04 e 05: liste piene fino a fine 2027, 2028 calibrato sul dataset). Funzioni `test_server.reset_svuota`, `reset_genera_anno`, `reset_riempi_anno` (migrazione `20261001230100_reset_e_proposte.sql`). Durante il reset Prenota e dashboard restano in attesa.

### Disdetta casuale compatibile

1. Sceglie un **target reale**: la prenotazione indicata da `target_id`, oppure una a caso tra quelle future (oltre 2 giorni), di un utente che può ricevere proposte (`public.is_real_patient`: reale e con login) e senza una proposta già in sospeso. Se non ce ne sono, usa una voce di lista d'attesa di un utente reale.
2. Cerca a caso una **prenotazione fittizia compatibile**: stessa prestazione esatta (catalogo `offerta`), slot tra più di 24 ore e **prima** di quello del target, senza sovrapposizioni, preferendo la stessa ASL (per la lista d'attesa rispetta strutture, medici e finestra di date richieste).
3. La disdice con `public.cancel_appointment_and_reallocate`: lo slot va alla lista d'attesa reale oppure diventa una **proposta di anticipo** per un utente reale con una prenotazione successiva (vedi `apps/prenota/README.md`), che la accetta o rifiuta da Prenota. I pazienti fittizi non ricevono mai nulla.
4. Risponde con slot liberato, target e giorni di anticipo possibili; registra tutto in `test_server.disdette_test`.

Se non esistono prenotazioni reali o nessuna è compatibile risponde `404 nessuna_compatibile`.

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"recupera","password":"<password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -X POST localhost:3001/api/v1/test/disdici-casuale -H "authorization: Bearer $TOKEN"
```

## Database: migrazioni e seed

Migrazioni in `supabase/migrations/` (già applicate al progetto `recupera`), poi i seed in ordine:

1. `supabase/seed/01_catalogo_admin_pazienti.sql`: ASL, prestazioni, strutture, pazienti fittizi.
2. Il dataset non ha più un seed: `test_server.monitoraggio` è una vista sulla settimana `parametri.settimana_dataset` dei dati sincronizzati da dati.puglia.it (migrazione `20261001200000_monitoraggio_vista.sql`).
3. `supabase/seed/03_offerta.sql`: offerta calibrata sul dataset (slot al giorno e probabilità di prenotazione).
4. `supabase/seed/04_slot_prenotazioni.sql`: slot e prenotazioni, un anno alla volta per il timeout di 2 minuti: `psql "$DATABASE_URL" -v anno=2026 -f supabase/seed/04_slot_prenotazioni.sql` (poi 2027, 2028).
5. `supabase/seed/05_agenda_piena_fino_2027.sql`: prenota con pazienti fittizi tutti gli slot liberi fino a fine 2027 (liste piene come in un CUP reale: le prime disponibilità sono nel 2028), tranne quelli liberati da una disdetta. Rieseguibile, un anno alla volta (`-v anno=2026`, poi 2027). Il confronto con il dataset (`confronto_dataset`) usa solo il 2028.

### Collegamento al dataset della Regione

Il dataset è pubblicato su dati.puglia.it con API CKAN: `package_show?id=monitoraggio-tempi-di-attesa` elenca le settimane (oggi 18, da luglio 2020 a ottobre 2024) e `datastore_search?resource_id=…` restituisce le righe in JSON, con le stesse colonne del CSV.

- `supabase/functions/sync-dataset`: Edge Function che scarica le settimane nuove o modificate e le scrive nelle tabelle della dashboard (`public.prestazione`, `public.rilevazione_settimanale`) tramite `public.sincronizza_settimana_dataset` (migrazione `20261001180000_sync_dataset_puglia.sql`, già applicata). `?forza=1` riscarica tutto.
- `public.dataset_fonte`: una riga per settimana sincronizzata (risorsa CKAN, data di inizio, ultima modifica).
- Funzione pubblicata e pianificata con pg_cron ogni giorno alle 04:00 UTC (job `sync-dataset-puglia`, migrazione `20261001191000_cron_sync_dataset.sql`); la chiave per chiamarla sta nel Vault (`sync_dataset_anon_key`). Oggi: 18 settimane, 7.452 righe.
- In tre risorse (03-07 luglio 2023, 17-21 aprile 2023, 13-17 luglio 2020) l'anno di `SETTIMANA_INDICE` cresce riga per riga: l'etichetta della settimana usa sempre la colonna `ANNO` (migrazione `20261001190000`).
- Legenda ufficiale: `*_TMAX` = prenotazioni con appuntamento **entro** il tempo massimo della classe (B 10 gg, D 30/60 gg, P 120 gg).

`supabase/seed/reset.sql` cancella solo pazienti fittizi, utente di prova e le loro prenotazioni (prenotazioni e utenti reali restano).
