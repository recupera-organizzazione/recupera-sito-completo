import { useRiassegnazioni } from '../hooks/useDashboard.js';

// Ultime disdette registrate dal gestionale (GET /riassegnazioni) e loro esito.

function icona(prestazione) {
  const p = String(prestazione).toLowerCase();
  if (p.includes('cardio') || p.includes('elettrocardio')) return ['✚', 'cardio'];
  if (p.includes('oculist') || p.includes('fundus')) return ['◉', 'eye'];
  if (p.includes('pneumo') || p.includes('spirometria')) return ['⊕', 'lungs'];
  return ['◇', 'bone'];
}

function quando(iso) {
  const d = new Date(iso);
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? `oggi, ${ora}`
    : `${d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}, ${ora}`;
}

export default function ReassignmentQueue() {
  const { data, isLoading, isError, error } = useRiassegnazioni(6);
  const righe = data?.data?.rows ?? [];

  return (
    <article className="panel queue-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Gestionale prenotazioni · dati reali</p>
          <h3>Ultime disdette</h3>
        </div>
      </div>
      <div className="queue-list">
        {isLoading && <p className="panel-note" role="status">Caricamento…</p>}
        {isError && <p className="panel-error" role="alert">Disdette non disponibili: {error.message}</p>}
        {!isLoading && !isError && righe.length === 0 && <p className="panel-note">Nessuna disdetta registrata.</p>}
        {righe.map((r) => {
          const [simbolo, tipo] = icona(r.prestazione);
          return (
            <div className="queue-item" key={r.id}>
              <span className={`service-icon ${tipo}`}>{simbolo}</span>
              <div>
                <strong>{r.prestazione}</strong>
                <small>{r.struttura} · slot del {new Date(r.slot_inizio).toLocaleDateString('it-IT')}</small>
              </div>
              <span className="queue-time">{quando(r.disdetta_il)}</span>
              <span className={`queue-state ${r.stato === 'riassegnato' ? 'success' : 'pending'}`}>
                {r.stato === 'riassegnato' ? 'Riassegnato' : 'Slot libero'}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
