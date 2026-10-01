import { useEffect, useState } from 'react';
import SiteBar from './components/SiteBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Login from './components/Login.jsx';
import MetricGrid from './components/MetricGrid.jsx';
import RecoveryChart from './components/RecoveryChart.jsx';
import ReassignmentQueue from './components/ReassignmentQueue.jsx';
import TerritoryPanel from './components/TerritoryPanel.jsx';
import Simulator from './components/Simulator.jsx';
import { clearToken, getMe, getToken } from './lib/api.js';
import { queryClient } from './lib/queryClient.js';
import { STR } from './lib/strings.js';

const oggi = () => {
  const d = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return d.charAt(0).toUpperCase() + d.slice(1);
};

function App() {
  const [refreshed, setRefreshed] = useState(false);
  // Gate di sessione: senza token valido si mostra solo Login.
  // All'avvio, un token esistente viene verificato via GET /auth/me.
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(() => !!getToken());

  useEffect(() => {
    if (!getToken()) return;
    getMe()
      .then((me) => {
        setUser(me);
        setChecking(false);
      })
      .catch(() => {
        clearToken();
        setUser(null);
        setChecking(false);
      });
  }, []);

  function handleLogout() {
    clearToken();
    queryClient.clear();
    setUser(null);
  }

  if (checking) {
    return (
      <>
        <SiteBar />
        <div className="login-screen rc-grid-bg">
          <div className="login-card" role="status">
            <p>{STR.login.checking}</p>
          </div>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <SiteBar />
        <Login onLoggedIn={(me) => setUser(me)} />
      </>
    );
  }

  const who = user.username || STR.topbar.fallbackWho;

  return (
    <>
      <SiteBar>
        <span className="live-label">
          <i /> Demo
        </span>
        <div className="avatar" aria-label={`Account ${who}`}>
          {who.trim().charAt(0).toUpperCase() || '?'}
        </div>
        <button className="rc-button rc-button--outline rc-button--small" type="button" onClick={handleLogout}>
          {STR.topbar.logout}
        </button>
      </SiteBar>
      <div className="app-shell">
        <Sidebar />
        <main className="main-content" id="overview">
          <Topbar username={who} />
          <section className="intro-row">
            <div>
              <p className="section-kicker">{oggi()}</p>
              <h2>La rete è sotto pressione.</h2>
              <p className="subline">Domanda, tempi massimi e capacità disponibile, per ASL.</p>
            </div>
            <button className="outline-button" type="button" onClick={() => queryClient.invalidateQueries().then(() => setRefreshed(true))}>
              {refreshed ? '✓ ' : '↻ '}
              <span>{refreshed ? 'Dati aggiornati' : 'Aggiorna dati'}</span>
            </button>
          </section>
          <MetricGrid />
          <section className="content-grid">
            <RecoveryChart />
            <ReassignmentQueue />
          </section>
          <section className="bottom-grid">
            <TerritoryPanel />
            <Simulator />
          </section>
          <footer>
            <span>reCUPera · sistema di ottimizzazione delle liste d'attesa</span>
            <span>Fonte: Monitoraggio tempi di attesa · Regione Puglia</span>
          </footer>
        </main>
      </div>
    </>
  );
}

export default App;
