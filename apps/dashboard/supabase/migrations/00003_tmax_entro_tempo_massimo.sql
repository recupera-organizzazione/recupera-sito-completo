-- ============================================================
-- ReCUPera - Dashboard Regionale CUP
-- Migrazione 00003: interpretazione corretta di *_TMAX
-- ============================================================
-- Legenda ufficiale del dataset (dati.puglia.it, legendamonittempiattesa.ods):
-- PRENOTAZIONI_DAGARANTIRE_B_TMAX = prenotazioni di classe B "con data di
-- appuntamento ENTRO 10 giorni" (D: entro 30/60 gg, P: entro 120 gg).
-- Le colonne b/d/p_fuori_tmax di rilevazione_settimanale contengono quindi le
-- prenotazioni ENTRO il tempo massimo (il nome resta per non rompere l'import).
-- Oltre il tempo massimo = totale della classe - entro TMAX.
-- I nomi delle colonne della vista restano invariati (contratto API).
-- ============================================================

COMMENT ON COLUMN public.rilevazione_settimanale.b_fuori_tmax IS 'PRENOTAZIONI_DAGARANTIRE_B_TMAX: classe B ENTRO 10 giorni (nome storico)';
COMMENT ON COLUMN public.rilevazione_settimanale.d_fuori_tmax IS 'PRENOTAZIONI_DAGARANTIRE_D_TMAX: classe D ENTRO 30/60 giorni (nome storico)';
COMMENT ON COLUMN public.rilevazione_settimanale.p_fuori_tmax IS 'PRENOTAZIONI_DAGARANTIRE_P_TMAX: classe P ENTRO 120 giorni (nome storico)';

-- fuori_tmax_pct = oltre tempo max / (B + D + P), cioè sulle sole prenotazioni con classe.
-- attesa_stimata_gg = EURISTICA documentata (non dato reale): ROUND(7 + 40 * fuori_tmax_pct)
CREATE OR REPLACE VIEW public.kpi_territorio AS
WITH r AS (
    SELECT
        asl_id, anno, settimana, prenotazioni, da_garantire,
        COALESCE(b_tot, 0) AS b_tot, COALESCE(d_tot, 0) AS d_tot, COALESCE(p_tot, 0) AS p_tot,
        GREATEST(COALESCE(b_tot, 0) - COALESCE(b_fuori_tmax, 0), 0) AS b_oltre,
        GREATEST(COALESCE(d_tot, 0) - COALESCE(d_fuori_tmax, 0), 0) AS d_oltre,
        GREATEST(COALESCE(p_tot, 0) - COALESCE(p_fuori_tmax, 0), 0) AS p_oltre
    FROM public.rilevazione_settimanale
)
SELECT
    a.id AS asl_id,
    a.sigla AS sigla,
    a.nome AS nome,
    r.anno AS anno,
    r.settimana AS settimana,
    SUM(r.prenotazioni)::INT AS prenotazioni,
    SUM(r.da_garantire)::INT AS da_garantire,
    SUM(r.b_oltre + r.d_oltre + r.p_oltre)::INT AS fuori_tmax_tot,
    COALESCE(SUM(r.b_oltre + r.d_oltre + r.p_oltre)::FLOAT
             / NULLIF(SUM(r.b_tot + r.d_tot + r.p_tot), 0)::FLOAT, 0) AS fuori_tmax_pct,
    ROUND(7 + 40 * COALESCE(SUM(r.b_oltre + r.d_oltre + r.p_oltre)::FLOAT
             / NULLIF(SUM(r.b_tot + r.d_tot + r.p_tot), 0)::FLOAT, 0))::INT AS attesa_stimata_gg,
    SUM(r.b_tot) AS totale_b_tot,
    SUM(r.b_oltre) AS totale_b_fuori_tmax,
    SUM(r.d_tot) AS totale_d_tot,
    SUM(r.d_oltre) AS totale_d_fuori_tmax,
    SUM(r.p_tot) AS totale_p_tot,
    SUM(r.p_oltre) AS totale_p_fuori_tmax,
    COALESCE(ROUND(SUM(r.b_oltre)::NUMERIC / NULLIF(SUM(r.b_tot), 0) * 100, 2), 0) AS percentuale_b_fuori_soglia,
    COALESCE(ROUND(SUM(r.d_oltre)::NUMERIC / NULLIF(SUM(r.d_tot), 0) * 100, 2), 0) AS percentuale_d_fuori_soglia,
    COALESCE(ROUND(SUM(r.p_oltre)::NUMERIC / NULLIF(SUM(r.p_tot), 0) * 100, 2), 0) AS percentuale_p_fuori_soglia
FROM r
JOIN public.asl a ON r.asl_id = a.id
GROUP BY a.id, a.sigla, a.nome, r.anno, r.settimana;
