import { useHotspot } from '../hooks/useDashboard.js';
import { getExportUrl } from '../lib/api.js';

// Pressione per ASL dalla settimana più recente del dataset (GET /territorio/hotspot).
// Attesa stimata = euristica del backend (7 + 40 × quota oltre il tempo massimo), non un dato reale.

const pct = (v) => `${(v * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%`;

export default function TerritoryPanel() {
  const { data, isLoading, isError, error } = useHotspot();
  const righe = data?.data ?? [];

  return (
    <article className="panel territory-panel" id="territorio">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Mappa delle criticità · {data?.settimana ?? '…'}</p>
          <h3>La domanda dove serve</h3>
        </div>
        <a className="text-button" href={getExportUrl({ settimana: data?.settimana })} download>Esporta CSV ↓</a>
      </div>
      <div className="territory-layout">
        <div className="puglia-map" aria-label="Mappa stilizzata della Puglia">
          <span className="map-shape" />
          <span className="map-label l1">FG</span>
          <span className="map-label l2">BA</span>
          <span className="map-label l3">BR</span>
          <span className="map-label l4">LE</span>
          <span className="map-label l5">TA</span>
        </div>
        <div className="territory-table">
          <div className="table-row table-header">
            <span>Zona / ASL</span>
            <span>Attesa stimata</span>
            <span>Oltre tempo max</span>
          </div>
          {isLoading && <p className="panel-note" role="status">Caricamento…</p>}
          {isError && <p className="panel-error" role="alert">Territorio non disponibile: {error.message}</p>}
          {righe.map((r) => (
            <div className="table-row" key={r.asl_id}>
              <span><b>{r.sigla}</b> {r.nome.replace(/^ASL /, '')}</span>
              <span>{r.attesa_stimata_gg} gg</span>
              <span>
                <em className={`bar ${r.fuori_tmax_pct < 0.25 ? 'ok' : ''}`}><i style={{ width: pct(r.fuori_tmax_pct) }} /></em> {pct(r.fuori_tmax_pct)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
