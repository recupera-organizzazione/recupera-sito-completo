# ReCUPera — backend prenotazioni Supabase

> **Nel sito completo** (`recupera-sito-completo`) questa app si avvia dalla radice con `npm run dev` ed è servita dal gateway su `/prenota/`: vedi il `README.md` di radice. Le istruzioni qui sotto valgono per l'avvio separato.

API Node.js/Express collegata al progetto Supabase `jjkxvbjwruobclgwhtdt`. Usa Supabase Auth per i token e PostgreSQL per slot, appuntamenti, liste d'attesa, notifiche e dati aggregati.

## Configurazione

1. Configura le variabili di `.env.example` nel `.env` locale o nelle impostazioni del servizio di hosting. `SUPABASE_SERVICE_ROLE_KEY` resta nell'ambiente Node; `SUPABASE_ANON_KEY` è la chiave pubblica usata dal login.
2. Se le tabelle e le funzioni Supabase non esistono ancora, esegui `supabase/schema.sql` una sola volta. Nome e cognome vengono salvati nei metadati di Supabase Auth e non richiedono modifiche alle tabelle applicative.
3. In Supabase **Authentication → URL Configuration**, imposta il dominio pubblicato come Site URL e aggiungilo alle Redirect URLs. Per i test locali aggiungi anche `http://localhost:3001/**`; questi indirizzi sono usati per conferma email e recupero password.
4. Usa Node.js 20 o superiore; installa con `npm install` e avvia con `npm start`. In PowerShell usa `npm.cmd`; in sviluppo puoi usare `npm.cmd run dev`. Frontend e API sono serviti dallo stesso processo sulla porta indicata dall'ambiente.

L'URL del progetto è già configurato in `.env.example`. Se nel progetto esistono già tabelle con questi nomi, confronta le colonne con `supabase/schema.sql` prima di applicare eventuali modifiche.

Configura una volta `SUPABASE_ANON_KEY` nel `.env` con la chiave `anon`/`publishable` di **Project Settings → API Keys**. L'applicazione non espone `SUPABASE_SERVICE_ROLE_KEY`. Se l'hosting usa un singolo proxy, imposta `TRUST_PROXY=1`; se la conferma email è attiva, l'utente deve confermare l'indirizzo prima di accedere. La sezione operatore appare agli utenti con ruolo `operator` o `admin` in `app_metadata`.

## Autenticazione e ruoli

Le rotte `/api/*` richiedono `Authorization: Bearer <access_token>` emesso da Supabase Auth. Il ruolo è letto da `user.app_metadata.role` e può essere `patient`, `operator`, `regional_admin` o `admin`. Impostare `app_metadata` è un'operazione amministrativa server-side: il client non deve poter assegnare ruoli. Gli utenti senza claim esplicita sono trattati come `patient`.

RLS è attivo su tutte le tabelle e non ci sono policy per client anonimo/autenticato: il backend usa la service role key, che bypassa RLS. Mantienila soltanto sul server e limita l'accesso all'ambiente che la contiene.

## API

| Metodo | Percorso | Ruolo | Funzione |
| --- | --- | --- | --- |
| `GET` | `/health` | pubblico | Verifica che l'API possa leggere Supabase |
| `GET` | `/api/slots` | patient, operator, admin | Elenca gli slot futuri disponibili |
| `POST` | `/api/slots` | operator, admin | Crea uno slot futuro |
| `POST` | `/api/slots/:slotId/book` | patient, operator, admin | Prenota atomicamente uno slot libero |
| `POST` | `/api/appointments/:appointmentId/cancel` | patient, operator, admin | Cancella e riassegna allo slot un paziente in lista |
| `POST` | `/api/waitlist` | patient, operator, admin | Inserisce una richiesta in lista d'attesa |
| `DELETE` | `/api/waitlist/:entryId` | patient, operator, admin | Ritira una richiesta in attesa |
| `GET` | `/api/waitlist/me` | patient | Elenca le proprie richieste |
| `GET` | `/api/appointments/me` | patient | Elenca le proprie prenotazioni |
| `GET` | `/api/notifications/me` | patient | Elenca gli avvisi di riassegnazione |
| `GET` | `/api/analytics/summary?from=...&to=...` | regional_admin, admin | KPI aggregati per prestazione e sede |
| `POST` | `/api/analytics/simulate` | regional_admin, admin | Stima l'effetto di variazioni di capacità |

Per i ruoli `operator` e `admin`, i payload di prenotazione e iscrizione richiedono `patientId`. Il paziente viene invece identificato dal token. Solo personale autorizzato può impostare `priorityScore`.

Esempio di slot:

```json
{
  "specialtyId": "cardiology",
  "facilityId": "asl-roma-1",
  "professionalId": "doctor-123",
  "startAt": "2028-11-12T08:30:00+01:00",
  "endAt": "2028-11-12T09:00:00+01:00"
}
```

Esempio di lista d'attesa:

```json
{
  "specialtyId": "cardiology",
  "facilityIds": ["asl-roma-1", "asl-roma-2"],
  "earliestDate": "2028-11-01T00:00:00+01:00",
  "latestDate": "2029-02-01T00:00:00+01:00"
}
```

## Note operative

Le funzioni SQL bloccano la riga dello slot e scelgono il candidato compatibile in una singola transazione PostgreSQL, così richieste concorrenti non possono prenotare lo stesso slot. Le notifiche di abbinamento sono mostrate nell'app; l'invio email o SMS richiede un provider esterno non configurato in questo progetto. La simulazione è una stima statica e non incorpora durate cliniche o vincoli di personale.

Le tabelle `slots`, `appointments`, `waiting_list`, `cancellation_events` e `notifications` definiscono il modello atteso dall'API. Adatta lo script prima dell'esecuzione se il progetto contiene già dati o tabelle operative.

Per un database in cui le tabelle esistono già, esegui una volta `supabase/waitlist_match_trigger.sql` nel SQL Editor: non crea o modifica colonne, ma aggiunge il trigger che abbina un nuovo slot disponibile dal 2028 al primo paziente compatibile in attesa. Quando una ricerca non trova slot, il paziente viene inserito automaticamente in lista; le notifiche sono mostrate nell'app al successivo aggiornamento (ogni minuto mentre è aperta). L'invio via email o SMS richiede un provider esterno non configurato in questo progetto.
