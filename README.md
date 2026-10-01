# recupera-sito-completo

Sito completo di **reCUPera**: landing page, app **Prenota** (cittadino), **Dashboard** (operatori CUP e Regione) e **Test server** (finto CUP) sotto un unico indirizzo, con lo stesso design.

reCUPera recupera i posti liberati dalle disdette delle visite specialistiche e li propone a chi è in lista d'attesa (prima per classe di priorità, poi per tempo di attesa), nelle 6 ASL della Puglia. Nessuno viene spostato senza consenso. Scopo e funzioni dei moduli: `../funzioni-recupera.md` (cartella dell'organizzazione).

## Struttura

```
recupera-sito-completo/
├── web/                 landing page (/) e pagina 404, HTML/CSS/JS statici
├── design/recupera.css  design system condiviso (token Stitch + barra di navigazione comune)
├── gateway/server.js    Express 5: serve landing e design, inoltra alle tre app
├── scripts/avvia.mjs    avvia le tre app + gateway in un terminale (npm run dev / npm start)
└── apps/
    ├── dashboard/       da recupera-dashboard: React + Vite (/dashboard/) e backend Express (backend/)
    ├── prenota/         da recupera-prenotazioni: Express + frontend statico (public/)
    └── test-server/     da recupera-test-server: Express 5 + pg + frontend di test (public/)
```

Le tre app sono state copiate dai rispettivi repo il 1° ottobre 2026 (dopo `git pull`): `recupera-dashboard` @ `8143ebe`, `recupera-prenotazioni` @ `4e2efe7`, `recupera-test-server` @ `da91185`. Da qui in poi si sviluppano in questo repo.

## Indirizzi

| Percorso | Cosa | Processo |
|---|---|---|
| `/` | landing, con stato dei servizi letto dal vivo dai loro `/health` | gateway |
| `/design/recupera.css` | design system condiviso | gateway (e ogni app su `design/`) |
| `/prenota/` | app Prenota, API su `/prenota/api/*`, `/prenota/health` | `apps/prenota` (porta interna 3102) |
| `/dashboard/` | dashboard React (build in `apps/dashboard/dist`, o Vite in sviluppo) | gateway / Vite (5180) |
| `/dashboard/api/v1/*` | API della dashboard | `apps/dashboard/backend` (3101) |
| `/test-server/` | frontend di test, API su `/test-server/api/v1/*` | `apps/test-server` (3103) |

Le app restano processi separati perché usano versioni diverse di Express e dashboard e test-server hanno entrambe `/api/v1`. Il gateway toglie il prefisso (`/prenota`, `/test-server`) prima di inoltrare: per questo i frontend di Prenota e del test server usano **percorsi relativi** (`api/...`, `health`, `design/recupera.css`) e funzionano sia dietro il gateway sia da soli sulla loro porta. Se un'app è spenta il gateway risponde `502 { error: { code: 'servizio_non_raggiungibile', … } }`.

## Avvio

Requisiti: Node.js 22 o superiore, i `.env` delle tre app (vedi sotto).

```bash
npm run setup     # installa le dipendenze di radice e delle tre app
npm run dev       # sviluppo: riavvio automatico + Vite con HMR → http://localhost:3000
npm run build     # build della dashboard (apps/dashboard/dist)
npm start         # produzione locale: il gateway serve la build → http://localhost:3000
```

Porte interne e porta pubblica si cambiano nel `.env` di radice (vedi `.env.example`, nessun segreto). `scripts/avvia.mjs` passa `PORT` a ogni app, quindi il `PORT` scritto nei loro `.env` viene ignorato quando partono da qui.

### Variabili d'ambiente delle app

Ogni app legge il proprio `.env` (mai committato; copia da `.env.example`):

- `apps/dashboard/backend/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_USER`, `ADMIN_EMAIL`.
- `apps/prenota/.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Se il sito è pubblicato dietro un proxy, `TRUST_PROXY=1`.
- `apps/test-server/.env`: `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_USER`, `ADMIN_EMAIL`.

Dashboard e test server condividono lo stesso account admin (Supabase Auth, `app_metadata.role = 'admin'`): usa gli stessi `ADMIN_USER`/`ADMIN_EMAIL` nei due `.env`. In Supabase **Authentication → URL Configuration** aggiungi `http://localhost:3000/prenota/**` alle Redirect URLs per il recupero password di Prenota.

## Pubblicazione su Vercel

Produzione: **https://recupera-sito-completo.vercel.app** (progetto Vercel `recupera-sito-completo`). Deploy dalla CLI: `npx vercel deploy` (anteprima, protetta da Vercel Authentication) e `npx vercel deploy --prod`. Il repo GitHub non è collegato (l'app GitHub di Vercel non ha accesso all'organizzazione): per i deploy automatici a ogni push va autorizzata da GitHub.

Su Vercel non ci sono processi sempre accesi, quindi il gateway non serve: le stesse regole sono in `vercel.json`.

- **Statici** (CDN): `npm run build:vercel` costruisce la dashboard e prepara `vercel-out/` con landing, design, `/dashboard/`, `/prenota/`, `/test-server/` (`scripts/build-vercel.mjs`).
- **404**: `api/non-trovato.js` risponde 404 con `web/404.html` a ogni indirizzo sconosciuto (altrimenti Vercel rimanderebbe alla landing con 200). Le chiamate dirette a `/api/prenota` ecc. danno 404.
- **`.vercelignore`**: i `.env` locali, `node_modules` e le build non vengono mai caricati su Vercel.
- **API** (funzioni serverless in `api/`): `api/prenota.js`, `api/dashboard.js`, `api/test-server.js` importano le app Express e tolgono il prefisso, come il gateway. Il reset del test server gira dentro la richiesta (`maxDuration` 300 s).
- **Sicurezza** (intestazioni per tutto il sito in `vercel.json`): HSTS, Content Security Policy senza script inline, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `no-store` sulle API. Login admin limitati a 10 tentativi ogni 5 minuti per IP (dashboard e test server), CORS chiuso (stessa origine), `service_role` e `DATABASE_URL` solo nelle variabili d'ambiente del progetto Vercel.

Variabili d'ambiente del progetto Vercel (mai nel repo): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Supabase **Transaction pooler**, porta 6543), `JWT_SECRET` (diverso da quello locale), `ADMIN_USER`, `ADMIN_EMAIL`, `TRUST_PROXY=1`; facoltativa `DATABASE_CA` (certificato CA di Supabase, per verificare il certificato del database). Dopo il primo deploy, in Supabase **Authentication → URL Configuration** imposta il dominio Vercel come Site URL e aggiungi `https://<dominio>/prenota/**` alle Redirect URLs.

## Design

Il design è stato generato con **Stitch** (progetto "reCUPera — sito completo", design system "reCUPera": primario `#146b51`, corallo `#f17f65`, giallo `#f3c64e`, carta `#f3f5ef`, Manrope + JetBrains Mono, angoli 4px) e implementato a mano in CSS, senza Tailwind:

- `design/recupera.css`: token `--rc-*`, barra di navigazione comune `.rc-sitebar` (Home, Prenota, Dashboard, Test server), `.rc-kicker`, `.rc-button`, `.rc-status`, griglia `.rc-grid-bg`.
- Le app collegano le loro variabili storiche (`--ink`, `--green`, …) ai token condivisi, quindi un colore si cambia in un solo posto.
- Dalle schermate Stitch sono stati tolti i contenuti inventati (numeri finti, SMS/App IO, SPID, NRE, loghi e diciture istituzionali della Regione): il sito mostra solo dati reali o etichettati `demo`.

## Dati

Dataset *Monitoraggio dei tempi di attesa* della Regione Puglia ([dati.puglia.it](https://dati.puglia.it/ckan/dataset/monitoraggio-tempi-di-attesa), CC BY 4.0), sincronizzato ogni giorno in Supabase (progetto `recupera`, ref `jjkxvbjwruobclgwhtdt`). Pazienti, medici e prenotazioni del test server sono fittizi. Dettagli e limiti: `apps/dashboard/README.md` e `apps/test-server/README.md`.

Vedi `AGENTS.md` per le regole di lavoro.
