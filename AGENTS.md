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

- Repo appena creato per il **sito completo** di reCUPera: contiene solo i file di istruzioni per agenti (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`). Nessun codice, `package.json`, build o backend.
- Repo collegati nella stessa organizzazione: `recupera-dashboard` (dashboard ASL), `recupera-prenotazioni` (area cittadino), `recupera-test-server` (finto sistema CUP). Leggi i loro `AGENTS.md` prima di riusarne codice o dati.
- Hosting previsto: **Vercel** (non ancora configurato). Non creare progetti Vercel, domini o variabili d'ambiente remote senza richiesta esplicita dell'utente.

## 2. Regole di lavoro

1. **Verifica prima di affermare:** leggi i file che citi; non descrivere funzionalità che non esistono.
2. **Stack:** allineato alle decisioni di `recupera-dashboard/AGENTS.md` (React web + Vite + TS, Supabase, Node 22/Express; niente React Native, niente Postgres locale in Docker). Altre scelte richiedono approvazione dell'utente.
3. **Dati:** nessun numero hardcoded presentato come reale: ogni valore deve venire da API/Supabase o essere marcato `demo`. Mai dati personali reali di pazienti.
4. **Segreti:** mai committare `.env`, password del database o chiavi Supabase; versiona solo `.env.example`. Nel frontend solo la chiave `anon`, mai `service_role`.
5. **UI:** in italiano, `lang="it"`, `aria-label` sui controlli senza testo, niente `innerHTML` con dati non sanitizzati.
6. **Piccoli diff:** un task = pochi file; aggiorna questo file e il `README.md` quando cambi struttura, stack o contratti.
7. **Git:** modifica i file, ma `commit`/`push`/PR solo su richiesta esplicita dell'utente.

## 3. Definizione di "fatto"

- Il sito si avvia in locale senza errori in console e `npm run build` (quando esisterà) passa. Riporta comandi e output.
- Nessun nuovo dato hardcoded non marcato `demo`.
