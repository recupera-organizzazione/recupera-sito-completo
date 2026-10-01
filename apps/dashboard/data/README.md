# Dati — Monitoraggio tempi di attesa (Regione Puglia)

Fonte: file originale `monitoraggio-tempi-di-attesa-07_11-ottobre-2024.csv`
(ricevuto in radice repo, encoding originale `cp1252/latin1`).

## File

- `monitoraggio-tempi-di-attesa-07_11-ottobre-2024.csv` — copia normalizzata in **UTF-8**
  convertita dall'originale `cp1252` (byte `0x92` in `TC dell'addome superiore`,
  `�` residuo documentato in `AGENTS.md` §3). Contenuto invariato, solo encoding.

## Caratteristiche (verificate via parser `latin1`)

- Righe: **414** (header escluso), 6 ASL, 69 prestazioni (`ID_PRESTAZIONE` distinti
  inclusa stringa vuota per `ELETTROMIOGRAFIA SEMPLICE [EMG]…`, 6 righe senza `ID`/`CODICE`)
- Settimana unica: `07-11 OTTOBRE 2024`, anno `2024`
- Colonne: `ASL, ANNO, SETTIMANA_INDICE, ID_PRESTAZIONE, DESC_PRESTAZIONE, COD_PRESTAZIONE, PRENOTAZIONI, PRENOTAZIONI_DAGARANTIRE, *_B, *_B_TMAX, *_D, *_D_TMAX, *_P, *_P_TMAX`
- Celle vuote (`""`) = `NULL/0` (es. `Mammografia monolaterale`, `Polipectomia…`): il parser non deve crashare
- Totali `PRENOTAZIONI` per ASL (assert import): `BA 19.370, FG 10.042, LE 7.754, TA 7.113, BT 5.607, BR 4.686` — totale `54.572`

## Mapping ASL (fisso, fonte Min. Salute/HL7 — non re-derivare)

`160106=BR, 160112=TA, 160113=BT, 160114=BA, 160115=FG, 160116=LE`

## Limiti (cfr. `AGENTS.md` §3)

- Una sola settimana → serie `ultimi 30 giorni` impossibile: l'API restituisce 1 punto + nota `dati insufficienti`
- `*_TMAX` = prenotazioni **entro** il tempo massimo della classe (legenda ufficiale); oltre = totale classe − `*_TMAX`
- Questo file è solo archivio: il backend legge da Supabase, popolato dall'API CKAN di dati.puglia.it
- Nessun dato reale su: giorni di attesa, CAP, slot recuperati, tasso conferma → solo euristiche `*_stimato` documentate o seed `demo`
