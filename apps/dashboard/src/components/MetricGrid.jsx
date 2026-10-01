import MetricCard from './MetricCard.jsx';
import { useKpi } from '../hooks/useKpi.js';

// KPI tutti da GET /dashboard/kpi: dataset regionale (settimana più recente
// sincronizzata) + disdette e riprenotazioni reali fatte in Prenota negli ultimi 30 giorni
// (utenti reali; esclusi i pazienti fittizi del test server).

function formatIT(n, decimals = 0) {
  if (n == null) return '—';
  return Number(n).toLocaleString('it-IT', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function buildMetrics(data, fuoriTmaxPct) {
  const canc = data.cancellazioni || {};
  const zone = data.zone_sotto_pressione || [];
  return [
    {
      label: 'Riprenotazioni',
      value: formatIT(canc.slot_recuperati_riallocati),
      trend: '30 giorni',
      note: (
        <>
          {formatIT(canc.anticipi_accettati)} anticipi accettati (<b>{formatIT(canc.giorni_guadagnati)} giorni</b> guadagnati) · {formatIT(canc.da_lista_attesa)} dalla lista d’attesa
        </>
      ),
      type: 'emphasis',
    },
    {
      label: 'Disdette in Prenota',
      value: formatIT(canc.totale_cancellate),
      trend: '30 giorni',
      note: (
        <>
          fatte dagli utenti · <b>{formatIT((canc.tasso_cancellazione_pct || 0) * 100, 1)}%</b> di {formatIT(canc.totale_prenotazioni)} prenotazioni
        </>
      ),
      type: 'days',
    },
    {
      label: 'Oltre il tempo massimo',
      value: formatIT(fuoriTmaxPct, 1),
      unit: '%',
      trend: 'settimana',
      note: `${formatIT(data.totale_fuori_tmax)} prenotazioni B/D/P oltre la soglia della classe`,
      type: 'confirmation',
      progress: fuoriTmaxPct,
    },
    {
      label: 'Zone sotto pressione',
      value: formatIT(zone.length),
      trend: zone.length ? 'attenzione' : 'nessuna',
      note: 'ASL con oltre il 50% delle prenotazioni fuori tempo massimo',
      type: 'pressure',
      tags: zone,
    },
  ];
}

export default function MetricGrid() {
  const { data, loading, error, fuoriTmaxPct } = useKpi();
  const ready = !loading && !error && data && !data._empty;

  return (
    <>
      <section className="kpi-real-bar" aria-label="Indicatori dal dataset regionale" aria-live="polite">
        {loading && (
          <div className="kpi-real loading" role="status">
            <span className="skeleton" /> Caricamento KPI…
          </div>
        )}
        {!loading && error && (
          <div className="kpi-real error" role="alert">
            API non raggiungibile ({error}). Avvia il backend: `npm --prefix backend run dev`.
          </div>
        )}
        {ready && (
          <div className="kpi-real ok">
            <span>
              Prenotazioni <strong>{formatIT(data.totale_prenotazioni)}</strong>
            </span>
            <span>
              Da garantire <strong>{formatIT(data.totale_da_garantire)}</strong>
            </span>
            <span>
              Oltre il tempo massimo <strong>{formatIT(data.totale_fuori_tmax)}</strong>
              {fuoriTmaxPct != null && <small> ({formatIT(fuoriTmaxPct, 1)} % delle prenotazioni B/D/P)</small>}
            </span>
            <small className="kpi-source">Fonte: Monitoraggio tempi di attesa, Regione Puglia · settimana {data.settimana}</small>
          </div>
        )}
        {!loading && !error && data?._empty && (
          <div className="kpi-real empty" role="status">
            Nessun dato per questa settimana nel dataset regionale.
          </div>
        )}
      </section>

      {ready && (
        <section className="metric-grid" aria-label="Indicatori principali">
          {buildMetrics(data, fuoriTmaxPct).map((metric) => (
            <MetricCard metric={metric} key={metric.label} />
          ))}
        </section>
      )}
    </>
  );
}
