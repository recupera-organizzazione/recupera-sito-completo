import { useState } from 'react';
import { useCancellazioni } from '../hooks/useDashboard.js';

// Disdette e riassegnazioni giornaliere dal gestionale (GET /dashboard/cancellazioni).

const W = 650;
const H = 180;

function isoGiorniFa(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function percorso(valori, max) {
  if (valori.length === 0) return '';
  const passo = valori.length > 1 ? W / (valori.length - 1) : 0;
  return valori.map((v, i) => `${i ? 'L' : 'M'}${(i * passo).toFixed(1)} ${(H - (v / max) * (H - 10)).toFixed(1)}`).join(' ');
}

const formatGiorno = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });

export default function RecoveryChart() {
  const [giorni, setGiorni] = useState(30);
  const { data, isLoading, isError, error } = useCancellazioni({ da: isoGiorniFa(giorni - 1) });
  const serie = data?.data?.serie ?? [];
  const max = Math.max(1, ...serie.map((g) => Math.max(g.cancellate, g.da_riassegnazione)));
  const tacche = [max, (max * 3) / 4, max / 2, max / 4, 0].map((v) => Math.round(v));
  const etichette = serie.filter((_, i) => i % Math.max(1, Math.ceil(serie.length / 6)) === 0);

  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Gestionale prenotazioni · dati reali</p>
          <h3>Slot recuperati dalla rete</h3>
        </div>
        <select aria-label="Intervallo grafico" value={giorni} onChange={(e) => setGiorni(Number(e.target.value))}>
          <option value={30}>Ultimi 30 giorni</option>
          <option value={7}>Ultimi 7 giorni</option>
        </select>
      </div>
      <div className="legend">
        <span><i className="legend-green" />Riassegnati</span>
        <span><i className="legend-gray" />Disdette</span>
      </div>
      {isLoading && <p className="panel-note" role="status">Caricamento…</p>}
      {isError && <p className="panel-error" role="alert">Disdette non disponibili: {error.message}</p>}
      {!isLoading && !isError && (
        <div className="big-chart">
          <div className="y-axis">{tacche.map((t, i) => <span key={i}>{t}</span>)}</div>
          <div className="chart-area">
            <div className="grid-lines"><i /><i /><i /><i /><i /></div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`Disdette e riassegnazioni degli ultimi ${giorni} giorni`}>
              <path className="curve" style={{ stroke: 'var(--muted, #9aa3a0)' }} d={percorso(serie.map((g) => g.cancellate), max)} />
              <path className="curve" d={percorso(serie.map((g) => g.da_riassegnazione), max)} />
            </svg>
            <div className="x-axis">{etichette.map((g) => <span key={g.giorno}>{formatGiorno(g.giorno)}</span>)}</div>
          </div>
        </div>
      )}
      {data?.data?.nota && <p className="panel-note">{data.data.nota}</p>}
    </article>
  );
}
