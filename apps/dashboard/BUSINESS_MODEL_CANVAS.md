# Business Model Canvas — reCUPera

Sintesi del modello strategico ed economico della piattaforma integrata **reCUPera** (Cittadino + Dashboard Regionale ASL Puglia).

---

### 1. Valore Offerto (Value Proposition)
- **Cittadino & Caregiver:** Accesso equo e tempestivo alle cure pubbliche nei tempi massimi garantiti (TMAX); recupero attivo e anticipo visite da slot disdetti; interfaccia accessibile per anziani supportati da familiari.
- **ASL & Management Sanitario:** Azzeramento degli slot sprecati da no-show/cancellazioni tardive; cruscotto di governo basato sui dati reali della domanda e delle priorità (B, D, P); simulatore di capacità per riallocare ore specialistiche tra presidi.
- **Regione Puglia / SSR:** Rispetto dei LEA e del PNGLA; contenimento della mobilità passiva extra-regionale e riduzione del ricorso forzato alla spesa privata.

---

### 2. Segmenti di Clientela & Utenti (Customer Segments)
- **Buyer (Chi acquista/paga):** Regione Puglia (Assessorato / Dipartimento Promozione della Salute) o in alternativa i System Integrator titolari dei contratti quadro del SISR.
- **Clienti B2B/B2G (Operatori del sistema):** Direzioni Generali e Sanitarie delle 6 ASL pugliesi (BA, FG, LE, TA, BT, BR), responsabili RUGLA e coordinatori CUP.
- **Utenti Finali:** Cittadini pugliesi assistiti, Family Caregiver (supporto alla popolazione anziana o fragile), Medici di Medicina Generale (MMG).

---

### 3. Canali (Channels)
- **Istituzionali / B2G:** Gare telematiche su portale EmPulia / convenzioni InnovaPuglia; tavoli tecnici regionali sulle liste d'attesa.
- **Territoriali & Media (Cittadinanza):** Emittenti TV locali ad alta penetrazione (es. Telenorba, Antenna Sud); punti fisici del SSR (farmacie convenzionate, sale d'attesa CUP, ambulatori MMG).
- **Digitali:** Portale PugliaSalute, canali social regionali, comunicati stampa.

---

### 4. Relazioni con gli Utenti (Customer Relationships)
- **Cittadino:** Web App responsive senza barriere d'installazione; comunicazioni dirette via email e notifiche istantanee (SMS transazionali per conferme/disdette immediate in 1 clic); tone of voice chiaro e non burocratico.
- **ASL & P.A.:** Change management e formazione degli operatori di sportello/CUP; supporto tecnico continuativo regolato da SLA; monitoraggio costante dei flussi e reportistica periodica.

---

### 5. Flussi di Ricavo ed Esternalità (Revenue Streams)
- **Ricavi Diretti (SaaS B2G / Servizi P.A.):**
  - Canone annuale di licenza e utilizzo (su scala regionale o proporzionato alle ASL attive).
  - Setup e integrazione tecnica con il SISR e il motore CUP regionale (una tantum).
  - Canone di manutenzione evolutiva, adeguamenti normativi (PNGLA) e supporto specialistico.
- **Esternalità Positive:** Risparmio diretto per il SSR da ottimizzazione delle risorse diagnostico-specialistiche già contrattualizzate; decongestionamento dei Pronto Soccorso per accessi impropri; tutela del reddito delle famiglie (riduzione spesa out-of-pocket).

---

### 6. Partner Chiave (Key Partners)
- **InnovaPuglia S.p.A.:** Partner strategico centrale per la qualificazione tecnica, interoperabilità con l'ecosistema digitale regionale e procurement pubblico.
- **Fornitori/Integratori del CUP Regionale:** Società IT affidatarie del sistema informativo sanitario (gestione DB transazionali agende).
- **Enti e Associazioni del Territorio:** FIMMG (Medici di Famiglia), Federfarma Puglia (rete farmacie di prossimità).
- **Cloud Provider Qualificati ACN/AGID:** Infrastrutture cloud conformi al trattamento di dati sanitari sensibili.

---

### 7. Attività Chiave (Key Activities)
- **Sviluppo & Algoritmi:** Manutenzione del motore di matching e riassegnazione rapida; calibrazione del simulatore predittivo di riallocazione ore specialistiche.
- **Integrazione Dati:** Sincronizzazione continua con API regionali (CKAN, flussi CUP, standard HL7/FHIR).
- **Sicurezza & Compliance:** Monitoraggio conformità GDPR/DPIA e gestione della sicurezza applicativa.
- **Supporto & Formazione:** Training del personale sanitario e monitoraggio degli indicatori di performance della rete.

---

### 8. Risorse Chiave (Key Resources)
- **Umane:** Team software (Node.js, React, Data Engineering), specialisti di accessibilità e sanità digitale, esperti legali/DPO (privacy sanitaria), referenti relazioni B2G.
- **Tecnologiche:** Piattaforma software (dashboard gestionale, motori previsionali e di notifica), pipeline ETL dati regionali.
- **Certificazioni & Asset:** DPIA approvata, accreditamento/qualificazione nel catalogo servizi cloud della PA (ACN/AGID).

---

### 9. Struttura dei Costi (Cost Structure)
- **Personale & Sviluppo:** Retribuzioni e consulenze del team tecnico, design, data analysis e supporto normativo/legale.
- **Infrastruttura & Esercizio:** Costi di hosting cloud certificato ad alta affidabilità e gateway di messaggistica/notifiche transazionali (SMS/email).
- **Integrazione & Interoperabilità:** Oneri per collaudo, test di sicurezza e certificazione con i sistemi legacy del CUP.
- **Divulgazione & Formazione:** Materiali informativi per farmacie/ambulatori, sessioni formative per operatori e campagne di informazione locale.
