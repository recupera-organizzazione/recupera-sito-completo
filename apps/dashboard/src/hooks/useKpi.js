import { useQuery } from '@tanstack/react-query';
import { getKpi } from '../lib/api.js';

// Hook KPI: ritorni { data, loading, error, fuoriTmaxPct, isDemo } con cache TanStack Query.
// MetricGrid.jsx non cambia interfaccia.
// Backend ritorna envelope { data: {...} } con forma canonica store.js
// ({ prenotazioni, da_garantire, fuori_tmax_tot, settimana, cancellazioni }):
// qui si normalizza in { totale_* } come atteso dai componenti, senza inventare nulla.
// Totali attesi settimana 07-11 ott 2024: BA 19.370, FG 10.042, LE 7.754, TA 7.113, BT 5.607, BR 4.686

const DEMO_FALLBACK = {
  totale_prenotazioni: null,
  totale_da_garantire: null,
  totale_fuori_tmax: null,
  _demo: true,
};

export function useKpi(settimana) {
  const query = useQuery({
    queryKey: ['kpi', settimana || 'default'],
    queryFn: () => getKpi(settimana),
  });

  // Unwrap envelope { data } del backend + normalizza nomi canonici in totale_*.
  const body = query.data;
  const envelope = body?.data ?? body;
  const normalized = envelope
    ? {
        totale_prenotazioni: envelope.prenotazioni,
        totale_da_garantire: envelope.da_garantire,
        totale_fuori_tmax: envelope.fuori_tmax_tot,
        fuori_tmax_pct: envelope.fuori_tmax_pct,
        zone_sotto_pressione: envelope.zone_sotto_pressione ?? [],
        settimana: envelope.settimana,
        cancellazioni: envelope.cancellazioni ?? null,
      }
    : null;

  const isEmpty =
    !!normalized && (normalized.totale_prenotazioni === 0 && normalized.totale_da_garantire === 0);

  // Fallback demo etichettato: non inventa numeri, MetricGrid mostra error + demo esistenti
  const data = normalized
    ? { ...normalized, _demo: false, ...(isEmpty ? { _empty: true } : {}) }
    : query.isError
      ? {
          ...DEMO_FALLBACK,
          _error: query.error?.message,
        }
      : null;

  // Quota sulle prenotazioni con classe B/D/P (calcolata dal backend), in %.
  const fuoriTmaxPct = data?.fuori_tmax_pct != null ? data.fuori_tmax_pct * 100 : null;

  return {
    data,
    loading: query.isLoading,
    error: query.isError ? query.error?.message || 'Errore sconosciuto' : null,
    fuoriTmaxPct,
    isDemo: !data || data._demo === true,
    // esposti per debug / future parti (grafico, territorio)
    isEmpty,
    refetch: query.refetch,
  };
}
