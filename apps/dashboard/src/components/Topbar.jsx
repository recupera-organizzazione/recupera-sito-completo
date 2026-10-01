import { salutoPerOra } from '../lib/strings.js';

// Saluto coerente con l'ora reale e account reale da sessione. Avatar ed "Esci"
// stanno nella barra comune del sito (SiteBar), come in Prenota e nel test server.
export default function Topbar({ username }) {
  return (
    <header className="topbar">
      <div>
        <p className="breadcrumb">
          Regione Puglia <span>/</span> Centro operativo
        </p>
        <h1>
          {salutoPerOra(new Date().getHours())}, {username}
        </h1>
      </div>
    </header>
  );
}
