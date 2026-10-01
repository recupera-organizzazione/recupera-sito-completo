import { useQuery } from '@tanstack/react-query';
import { getHealth } from '../lib/api.js';

// Settimana più recente del dataset regionale sincronizzata (GET /health).
export default function Sidebar() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const salute = data?.data;

  return (
    <aside className="sidebar">
      <p className="eyebrow">Centro operativo</p>
      <nav aria-label="Sezioni della dashboard">
        <a className="nav-item active" href="#overview">
          <span>◒</span> Panoramica
        </a>
        <a className="nav-item" href="#territorio">
          <span>⌖</span> Territorio
        </a>
        <a className="nav-item" href="#simulatore">
          <span>↝</span> Simulatore
        </a>
        {/* App Prenota servita dal gateway del sito completo su /prenota/. */}
        <a className="nav-item" href="/prenota/">
          <span>□</span> Prenotazioni
        </a>
      </nav>
      <div className="sidebar-bottom">
        <div className="status-dot">
          <i /> Dati: settimana {salute?.settimana_corrente?.toLowerCase() ?? '…'}
        </div>
        <p className="sidebar-note">
          Monitoraggio tempi di attesa
          <br />
          <strong>Regione Puglia</strong>
        </p>
        {salute && <p className="data-note">{salute.settimane} settimane · aggiornamento automatico da dati.puglia.it</p>}
      </div>
    </aside>
  );
}
