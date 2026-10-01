# AGENTS.md — Guida operativa per agenti (recupera-sito-completo)

Questo file è l'unica fonte di istruzioni per agenti e contributori su questo repo. `CLAUDE.md` e `GEMINI.md` rimandano qui.

## 0. Prima di qualsiasi cosa: `git pull`

Altri team lavorano sugli stessi repo. **Prima di leggere, modificare o eseguire qualunque cosa**, aggiorna il repo:

```bash
git pull --ff-only
```

- Se il pull fallisce (modifiche locali o storie divergenti), fermati e chiedi all'utente: non usare `reset`, `stash` o `push --force` di tua iniziativa.
- Ripeti il pull prima di ogni commit/push, così lavori sempre sull'ultima versione.

## 1. Contesto e stato reale

- Monorepo del **sito completo** di reCUPera: landing (`web/`), design system condiviso (`design/recupera.css`), gateway Express 5 (`gateway/server.js`) e le tre app copiate dai loro repo in `apps/`: `apps/dashboard` (da `recupera-dashboard`), `apps/prenota` (da `recupera-prenotazioni`), `apps/test-server` (da `recupera-test-server`). Struttura, porte e avvio: `README.md`.
- Le app restano **processi separati** dietro il gateway (`/dashboard/`, `/prenota/`, `/test-server/`); non fonderle in un solo server Express (versioni di Express diverse, `/api/v1` in comune tra dashboard e test server).
- I frontend di Prenota e del test server usano **percorsi relativi** (`api/...`, `health`, `design/recupera.css`): non reintrodurre percorsi assoluti, si romperebbero sotto il prefisso del gateway. La dashboard usa `base: '/dashboard/'` di Vite e `import.meta.env.BASE_URL` per le API.
- `apps/test-server/public/prenota` è una copia del frontend di Prenota: dopo ogni modifica di `apps/prenota/public` riesegui `sh apps/test-server/scripts/importa-prenota.sh`.
- Design: generato con Stitch (progetto "reCUPera — sito completo"). Ogni pagina usa la barra `.rc-sitebar` e i token `--rc-*` di `design/recupera.css`; non introdurre palette o font diversi nelle singole app.
- Hosting: **Vercel** (`vercel.json`, funzioni in `api/`, statici da `scripts/build-vercel.mjs`). Ogni nuova rotta va aggiunta sia al gateway (`gateway/server.js`) sia a `vercel.json`. Niente script inline nelle pagine (la CSP li blocca) e niente lavoro dopo la risposta nelle funzioni (Vercel le ferma). Non creare altri progetti Vercel, domini o variabili d'ambiente remote senza richiesta esplicita dell'utente.

## 1.1 Vincoli ereditati dai repo delle app

- **Database condiviso** (progetto Supabase `recupera`, ref `jjkxvbjwruobclgwhtdt`): le tabelle `public.slots`, `appointments`, `waiting_list`, `cancellation_events`, `notifications` e le funzioni `public.book_available_slot` / `public.cancel_appointment_and_reallocate` sono del team Prenota: non cambiarne struttura senza accordo. Lo schema `test_server` è del test server e non va esposto ad `anon`/`authenticated`. Ogni modifica di schema = nuova migrazione in `apps/*/supabase/migrations/`, mai dalla dashboard Supabase.
- **Test server:** solo dati fittizi; le disdette passano sempre da `public.cancel_appointment_and_reallocate`. Unica eccezione voluta dall'utente: il **reset** (`POST /test-server/api/v1/test/reset`, funzioni `test_server.reset_*`) svuota tutte le prenotazioni, liste d'attesa, proposte e disdette, anche degli utenti reali (gli account restano), e rigenera l'agenda fittizia fino al 2028 in una sola transazione. Nessun altro codice deve cancellare dati di utenti reali.
- **Proposte di anticipo** (`apps/prenota/supabase/migrations/20261001230000_proposte_anticipo.sql`): lo slot liberato da una disdetta va alla lista d'attesa reale oppure viene proposto (tabella `public.slot_offers`, accetta/rifiuta da Prenota) a un utente reale con una prenotazione successiva della stessa prestazione. Ogni scelta di destinatari passa da `public.is_real_patient`: **i pazienti fittizi non devono mai ricevere slot o proposte**. Se aggiungi un nuovo modo di riassegnare slot, usa lo stesso controllo e verificalo (0 proposte/riassegnazioni a fittizi).
- **Dataset** (dashboard): fonte viva = Supabase sincronizzato da dati.puglia.it; `*_TMAX` = prenotazioni **entro** il tempo massimo; mapping ASL fisso `160106=BR, 160112=TA, 160113=BT, 160114=BA, 160115=FG, 160116=LE`; mai inventare giorni di attesa, serie storiche o coordinate (le stime vanno marcate `stimato`). Totali di controllo per la settimana 07-11 ottobre 2024: BA 19.370, FG 10.042, LE 7.754, TA 7.113, BT 5.607, BR 4.686.
- **Admin** condivisi tra dashboard e test server: Supabase Auth con `app_metadata.role = 'admin'`, stessi `ADMIN_USER`/`ADMIN_EMAIL`; nessuna password in repo.

## 2. Regole di lavoro

1. **Verifica prima di affermare:** leggi i file che citi; non descrivere funzionalità che non esistono.
2. **Stack:** allineato alle decisioni di `recupera-dashboard/AGENTS.md` (React web + Vite + TS, Supabase, Node 22/Express; niente React Native, niente Postgres locale in Docker). Altre scelte richiedono approvazione dell'utente.
3. **Dati:** nessun numero hardcoded presentato come reale: ogni valore deve venire da API/Supabase o essere marcato `demo`. Mai dati personali reali di pazienti.
4. **Segreti:** mai committare `.env`, password del database o chiavi Supabase; versiona solo `.env.example`. Nel frontend solo la chiave `anon`, mai `service_role`.
5. **UI:** in italiano, `lang="it"`, `aria-label` sui controlli senza testo, niente `innerHTML` con dati non sanitizzati.
6. **Piccoli diff:** un task = pochi file; aggiorna questo file e il `README.md` quando cambi struttura, stack o contratti.
7. **Git:** modifica i file, ma `commit`/`push`/PR solo su richiesta esplicita dell'utente.

## 3. Definizione di "fatto"

- `npm run build` passa e `npm run dev` / `npm start` avviano tutto su http://localhost:3000 senza errori in console; `curl` su ogni percorso toccato (landing, `/prenota/health`, `/dashboard/api/v1/health`, `/test-server/api/v1/health`). Riporta comandi e output.
- Le pagine toccate usano la barra comune e i token del design system, anche a 390px di larghezza (niente scroll orizzontale).
- Nessun nuovo dato hardcoded non marcato `demo`.
