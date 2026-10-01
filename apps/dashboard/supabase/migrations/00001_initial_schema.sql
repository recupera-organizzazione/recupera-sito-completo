-- ============================================================
-- ReCUPera - Dashboard Regionale CUP
-- Migrazione 00001: Schema iniziale
-- NOTA dataset (cfr. AGENTS.md §3): il CSV è cp1252/latin1, una sola
-- settimana '07-11 OTTOBRE 2024' (TEXT, non numero), 6 righe senza
-- ID_PRESTAZIONE/COD_PRESTAZIONE (EMG) → id_prestazione NULL + match
-- per descrizione; celle vuote "" → 0/NULL (mai NOT NULL su codice).
-- ============================================================

-- ------------------------------------------------------------
-- Tabella: asl
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asl (
    id          CHAR(6) PRIMARY KEY,
    sigla       VARCHAR(10) NOT NULL UNIQUE,
    nome        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed ASL Regione Puglia
INSERT INTO public.asl (id, sigla, nome) VALUES
    ('160114', 'BA', 'ASL Bari'),
    ('160115', 'FG', 'ASL Foggia'),
    ('160116', 'LE', 'ASL Lecce'),
    ('160112', 'TA', 'ASL Taranto'),
    ('160113', 'BT', 'ASL Barletta-Andria-Trani'),
    ('160106', 'BR', 'ASL Brindisi')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- Tabella: prestazione
-- ------------------------------------------------------------
-- id = surrogato SERIAL: l'ID ministeriale NON è PK perché il CSV contiene
-- 6 righe con ID_PRESTAZIONE vuoto (ELETTROMIOGRAFIA SEMPLICE [EMG]…).
-- codice = TEXT NULL (valori tipo '88.01.1'; celle vuote → NULL).
CREATE TABLE IF NOT EXISTS public.prestazione (
    id              SERIAL PRIMARY KEY,
    id_prestazione  INT NULL,
    codice          TEXT NULL,
    descrizione     TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Unicità dell'ID ministeriale solo quando presente (NULL esclusi).
CREATE UNIQUE INDEX IF NOT EXISTS prestazione_id_prestazione_uidx
    ON public.prestazione (id_prestazione) WHERE id_prestazione IS NOT NULL;

-- ------------------------------------------------------------
-- Tabella: rilevazione_settimanale
-- ------------------------------------------------------------
-- settimana = TEXT: il CSV riporta '07-11 OTTOBRE 2024' (range con mese),
-- non un numero 1..53. Un CHECK INTEGER rigetterebbe ogni riga.
CREATE TABLE IF NOT EXISTS public.rilevazione_settimanale (
    id                  BIGSERIAL PRIMARY KEY,
    asl_id              CHAR(6) NOT NULL REFERENCES public.asl(id) ON DELETE CASCADE,
    prestazione_id      INTEGER NOT NULL REFERENCES public.prestazione(id) ON DELETE CASCADE,
    anno                INTEGER NOT NULL,
    settimana           TEXT NOT NULL,
    prenotazioni        INTEGER DEFAULT 0,
    da_garantire        INTEGER DEFAULT 0,
    b_tot               INTEGER DEFAULT 0,
    b_fuori_tmax        INTEGER DEFAULT 0,
    d_tot               INTEGER DEFAULT 0,
    d_fuori_tmax        INTEGER DEFAULT 0,
    p_tot               INTEGER DEFAULT 0,
    p_fuori_tmax        INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (asl_id, prestazione_id, settimana)
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_rilevazione_asl ON public.rilevazione_settimanale(asl_id);
CREATE INDEX IF NOT EXISTS idx_rilevazione_prestazione ON public.rilevazione_settimanale(prestazione_id);
CREATE INDEX IF NOT EXISTS idx_rilevazione_settimana ON public.rilevazione_settimanale(settimana);
CREATE INDEX IF NOT EXISTS idx_rilevazione_anno_settimana ON public.rilevazione_settimanale(anno, settimana);

-- ------------------------------------------------------------
-- Vista: kpi_territorio
-- ------------------------------------------------------------
-- Nomi colonna canonici = identici al fallback CSV del backend (store.js),
-- così l'API restituisce la stessa forma con o senza Supabase.
-- fuori_tmax_* = proxy di pressione (classi B/D/P oltre tempo max), NON giorni.
-- attesa_stimata_gg = EURISTICA documentata (non dato reale):
--   ROUND(7 + 40 * fuori_tmax_tot / NULLIF(da_garantire, 0))
CREATE OR REPLACE VIEW public.kpi_territorio AS
SELECT
    a.id AS asl_id,
    a.sigla AS sigla,
    a.nome AS nome,
    r.anno AS anno,
    r.settimana AS settimana,
    SUM(r.prenotazioni)::INT AS prenotazioni,
    SUM(r.da_garantire)::INT AS da_garantire,
    (SUM(r.b_fuori_tmax + r.d_fuori_tmax + r.p_fuori_tmax))::INT AS fuori_tmax_tot,
    CASE
        WHEN SUM(r.da_garantire) > 0
        THEN (SUM(r.b_fuori_tmax + r.d_fuori_tmax + r.p_fuori_tmax)::FLOAT / SUM(r.da_garantire)::FLOAT)
        ELSE 0
    END AS fuori_tmax_pct,
    ROUND(7 + 40 * CASE
        WHEN SUM(r.da_garantire) > 0
        THEN (SUM(r.b_fuori_tmax + r.d_fuori_tmax + r.p_fuori_tmax)::FLOAT / SUM(r.da_garantire)::FLOAT)
        ELSE 0
    END)::INT AS attesa_stimata_gg,
    SUM(r.b_tot) AS totale_b_tot,
    SUM(r.b_fuori_tmax) AS totale_b_fuori_tmax,
    SUM(r.d_tot) AS totale_d_tot,
    SUM(r.d_fuori_tmax) AS totale_d_fuori_tmax,
    SUM(r.p_tot) AS totale_p_tot,
    SUM(r.p_fuori_tmax) AS totale_p_fuori_tmax,
    CASE
        WHEN SUM(r.b_tot) > 0
        THEN ROUND((SUM(r.b_fuori_tmax)::NUMERIC / SUM(r.b_tot)) * 100, 2)
        ELSE 0
    END AS percentuale_b_fuori_soglia,
    CASE
        WHEN SUM(r.d_tot) > 0
        THEN ROUND((SUM(r.d_fuori_tmax)::NUMERIC / SUM(r.d_tot)) * 100, 2)
        ELSE 0
    END AS percentuale_d_fuori_soglia,
    CASE
        WHEN SUM(r.p_tot) > 0
        THEN ROUND((SUM(r.p_fuori_tmax)::NUMERIC / SUM(r.p_tot)) * 100, 2)
        ELSE 0
    END AS percentuale_p_fuori_soglia
FROM public.rilevazione_settimanale r
JOIN public.asl a ON r.asl_id = a.id
GROUP BY a.id, a.sigla, a.nome, r.anno, r.settimana;

-- ------------------------------------------------------------
-- Vista: statistiche_cancellazioni (gestionale prenotazioni)
-- ------------------------------------------------------------
-- Aggrega APPOINTMENTS (dati reali del gestionale: ~1,6k prenotazioni/giorno
-- osservate) per giorno/specialty/facility. La dashboard la usa per le
-- statistiche di cancellazione (tasso disdette, serie giornaliera) senza
-- mai leggere patient_id/cancelled_by (colonne escluse dalla vista).
-- cancellation_events (slot recuperati/riallocati) si legge a parte: è
-- popolata dal gestionale solo quando una disdetta viene riassegnata.
CREATE OR REPLACE VIEW public.statistiche_cancellazioni AS
SELECT
    a.created_at::date AS giorno,
    a.specialty_id AS specialty_id,
    a.facility_id AS facility_id,
    COUNT(*)::INT AS prenotazioni,
    COUNT(*) FILTER (WHERE a.status = 'cancelled')::INT AS cancellate,
    COUNT(*) FILTER (WHERE a.source = 'waitlist_reallocation')::INT AS da_riassegnazione
FROM public.appointments a
GROUP BY 1, 2, 3;

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- ------------------------------------------------------------

-- Abilitazione RLS su tutte le tabelle
ALTER TABLE public.asl ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prestazione ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rilevazione_settimanale ENABLE ROW LEVEL SECURITY;

-- Policy: lettura pubblica/anon per tabelle (DROP prima di CREATE = rerun sicuro)
DROP POLICY IF EXISTS "Lettura pubblica ASL" ON public.asl;
DROP POLICY IF EXISTS "Lettura pubblica Prestazioni" ON public.prestazione;
DROP POLICY IF EXISTS "Lettura pubblica Rilevazioni" ON public.rilevazione_settimanale;
DROP POLICY IF EXISTS "Scrittura service_role ASL" ON public.asl;
DROP POLICY IF EXISTS "Scrittura service_role Prestazioni" ON public.prestazione;
DROP POLICY IF EXISTS "Scrittura service_role Rilevazioni" ON public.rilevazione_settimanale;

CREATE POLICY "Lettura pubblica ASL"
    ON public.asl FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Lettura pubblica Prestazioni"
    ON public.prestazione FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Lettura pubblica Rilevazioni"
    ON public.rilevazione_settimanale FOR SELECT
    TO anon, authenticated
    USING (true);

-- Policy: scrittura solo service_role
CREATE POLICY "Scrittura service_role ASL"
    ON public.asl FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Scrittura service_role Prestazioni"
    ON public.prestazione FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Scrittura service_role Rilevazioni"
    ON public.rilevazione_settimanale FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------
-- Funzione: trigger per updated_at automatico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_rilevazione_updated_at ON public.rilevazione_settimanale;
CREATE TRIGGER trigger_rilevazione_updated_at
    BEFORE UPDATE ON public.rilevazione_settimanale
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
