import { useRiassegnazioni } from '../hooks/useDashboard.js';

// Ultime disdette e riprenotazioni reali fatte in Prenota (GET /riassegnazioni):
// disdetta = annullata dall'utente, anticipo = proposta accettata, lista_attesa = assegnata dalla lista.

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

const giorno = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });

const STATI = {
  disdetta: ['Disdetta dall’utente', 'expired'],
  anticipo: ['Anticipo accettato', 'success'],
  lista_attesa: ['Assegnata dalla lista d’attesa', 'success'],
};

function dettaglio(r) {
  const sede = `${r.struttura}${r.asl ? ` (${r.asl})` : ''}`;
  if (r.tipo === 'anticipo') {
    return `${sede} · ${giorno(r.slot_inizio)} invece del ${giorno(r.prima_inizio)} · ${r.giorni_guadagnati} giorni prima`;
  }
  return `${sede} · visita del ${giorno(r.slot_inizio)}`;
}

export default function ReassignmentQueue() {
  const { data, isLoading, isError, error } = useRiassegnazioni(6);
  const righe = data?.data?.rows ?? [];

  return (
    <article className="panel queue-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Prenota · attività reali</p>
          <h3>Ultime disdette e riprenotazioni</h3>
        </div>
      </div>
      <div className="queue-list">
        {isLoading && <p className="panel-note" role="status">Caricamento…</p>}
        {isError && <p className="panel-error" role="alert">Attività non disponibili: {error.message}</p>}
        {!isLoading && !isError && righe.length === 0 && <p className="panel-note">Nessuna disdetta o riprenotazione degli utenti finora.</p>}
        {righe.map((r) => {
          const [simbolo, tipo] = icona(r.prestazione);
          const [etichetta, classe] = STATI[r.tipo] ?? [r.tipo, 'pending'];
          return (
            <div className="queue-item" key={r.id}>
              <span className={`service-icon ${tipo}`}>{simbolo}</span>
              <div>
                <strong>{r.prestazione}</strong>
                <small>{dettaglio(r)}</small>
              </div>
              <span className="queue-time">{quando(r.quando)}</span>
              <span className={`queue-state ${classe}`}>{etichetta}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
