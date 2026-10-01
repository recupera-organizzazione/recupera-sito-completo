// Stato dei servizi letto dal vivo dai loro endpoint /health (passando dal gateway).
// Nessun valore fisso: se un servizio non risponde lo diciamo.
const servizi = {
  prenota: { url: '/prenota/health', ok: (corpo) => corpo?.status === 'ok' },
  dashboard: { url: '/dashboard/api/v1/health', ok: (corpo) => corpo?.data?.status === 'ok' },
  'test-server': { url: '/test-server/api/v1/health', ok: (corpo) => corpo?.ok === true },
};

function mostraStato(nome, stato) {
  const badge = document.querySelector(`[data-service="${nome}"]`);
  if (!badge) return;
  const testi = { ok: 'online', ko: 'non raggiungibile', wait: 'verifica…' };
  badge.className = `rc-status rc-status--${stato}`;
  badge.textContent = testi[stato];
}

async function leggi(url) {
  const risposta = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  const corpo = await risposta.json().catch(() => null);
  return { risposta, corpo };
}

function formattaData(valore) {
  const data = new Date(valore);
  return Number.isNaN(data.getTime())
    ? null
    : new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(data);
}

async function controlla() {
  const nota = document.getElementById('dataset-note');
  await Promise.all(Object.entries(servizi).map(async ([nome, servizio]) => {
    mostraStato(nome, 'wait');
    try {
      const { risposta, corpo } = await leggi(servizio.url);
      const online = risposta.ok && servizio.ok(corpo);
      mostraStato(nome, online ? 'ok' : 'ko');
      if (nome === 'dashboard') {
        const dati = corpo?.data;
        if (online && dati?.settimana_corrente) {
          const sync = formattaData(dati.ultima_sync);
          nota.textContent = `Dati regionali: ultima settimana ${dati.settimana_corrente.toLowerCase()}, ${dati.settimane} settimane sincronizzate da dati.puglia.it${sync ? ` (ultima sync ${sync})` : ''}.`;
        } else {
          nota.textContent = 'Dati regionali: non disponibili, il backend della dashboard non risponde.';
        }
      }
    } catch {
      mostraStato(nome, 'ko');
      if (nome === 'dashboard') nota.textContent = 'Dati regionali: non disponibili, il backend della dashboard non risponde.';
    }
  }));
}

document.getElementById('status-refresh')?.addEventListener('click', controlla);
controlla();
