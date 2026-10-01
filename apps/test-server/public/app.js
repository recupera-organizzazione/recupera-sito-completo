// Frontend di test del server CUP: niente framework, solo fetch + DOM.
// Servita dal test-server (anche sotto /test-server/ del gateway del sito completo): percorso relativo.
// Aperta con Live Server (porta 5500) o da file: punta al server locale standalone.
const API = location.protocol.startsWith('http') && location.port !== '5500' ? 'api/v1' : 'http://localhost:3001/api/v1';
const $ = (sel) => document.querySelector(sel);

let token = leggiToken();
let catalogo = null;
let offsetPren = 0;
const LIMITE_PREN = 50;

function leggiToken() {
  try { return sessionStorage.getItem('token'); } catch { return null; }
}
function salvaToken(t) {
  token = t;
  try { t ? sessionStorage.setItem('token', t) : sessionStorage.removeItem('token'); } catch { /* storage non disponibile */ }
}

async function api(percorso, opzioni = {}) {
  const risposta = await fetch(API + percorso, {
    ...opzioni,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const corpo = await risposta.json().catch(() => ({}));
  if (risposta.status === 401 && percorso !== '/auth/login') {
    salvaToken(null);
    mostraLogin();
  }
  if (!risposta.ok) throw new Error(corpo.error?.message ?? `Errore ${risposta.status}`);
  return corpo;
}

// --- helper DOM (solo textContent: niente innerHTML con dati) ---
function el(tag, attributi = {}, ...figli) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(attributi)) {
    if (k === 'class') nodo.className = v;
    else nodo.setAttribute(k, v);
  }
  for (const f of figli) nodo.append(f instanceof Node ? f : document.createTextNode(f ?? ''));
  return nodo;
}
function riga(...celle) {
  return el('tr', {}, ...celle.map((c) => (c instanceof Node && c.tagName === 'TD' ? c : el('td', {}, c))));
}
function num(v, cifre = 0) {
  return v === null || v === undefined ? '–' : Number(v).toLocaleString('it-IT', { maximumFractionDigits: cifre, minimumFractionDigits: cifre });
}
function pct(v) {
  return v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`;
}
function dataOra(iso) {
  return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
}
function barra(valore) {
  const colore = valore >= 0.75 ? 'var(--barra-alta)' : valore >= 0.55 ? 'var(--barra-media)' : 'var(--barra-bassa)';
  const riempita = el('div', { class: 'riempita' });
  riempita.style.width = `${Math.round((valore ?? 0) * 100)}%`;
  riempita.style.background = colore;
  return el('td', {}, el('div', { class: 'barra' }, el('div', { class: 'traccia' }, riempita), el('span', {}, pct(valore))));
}
function tdNum(testo) {
  return el('td', { class: 'num' }, testo);
}
function messaggio(tbody, colonne, testo) {
  tbody.replaceChildren(el('tr', {}, el('td', { colspan: String(colonne), class: 'muted' }, testo)));
}
function isoGiorno(offsetGiorni) {
  const d = new Date();
  d.setDate(d.getDate() + offsetGiorni);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}
async function conBottone(form, azione) {
  const bottone = form.querySelector('button[type=submit]');
  bottone.disabled = true;
  try { await azione(); } finally { bottone.disabled = false; }
}

// --- login ---
function mostraLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dati = Object.fromEntries(new FormData(e.target));
  $('#login-errore').textContent = '';
  await conBottone(e.target, async () => {
    try {
      const { token: t } = await api('/auth/login', { method: 'POST', body: JSON.stringify(dati) });
      salvaToken(t);
      e.target.reset();
      await avvia();
    } catch (err) {
      $('#login-errore').textContent = err.message;
    }
  });
});

$('#logout').addEventListener('click', () => {
  salvaToken(null);
  mostraLogin();
});

// --- tab ---
for (const tab of document.querySelectorAll('button.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('button.tab')) t.classList.toggle('attiva', t === tab);
    for (const p of document.querySelectorAll('.pannello')) p.hidden = p.id !== `tab-${tab.dataset.tab}`;
    if (tab.dataset.tab === 'prenotazioni') caricaPrenotazioni();
    if (tab.dataset.tab === 'slot') caricaSlot();
    if (tab.dataset.tab === 'test') { caricaDisdette(); seguiReset().catch(() => {}); }
  });
}

// --- centri ---
async function caricaCentri() {
  const corpo = $('#centri-body');
  messaggio(corpo, 6, 'Caricamento…');
  const params = new URLSearchParams(new FormData($('#centri-form')));
  try {
    const { centri } = await api(`/statistiche/centri?${params}`);
    if (!centri.length) return messaggio(corpo, 6, 'Nessuna struttura');
    corpo.replaceChildren(...centri.map((c) =>
      riga(`${c.struttura} (${c.comune})`, c.asl, tdNum(num(c.slot)), tdNum(num(c.prenotati)), tdNum(num(c.liberi)), barra(c.riempimento))));
  } catch (err) {
    messaggio(corpo, 6, err.message);
  }
}

async function caricaConfronto() {
  const corpoAsl = $('#asl-body');
  const corpoDett = $('#dettaglio-body');
  messaggio(corpoAsl, 6, 'Caricamento…');
  try {
    const { parametri, righe } = await api('/statistiche/dataset');
    $('#fonte-settimana').textContent = `settimana ${parametri.settimana_dataset}`;
    $('#fonte-scala').textContent = `1:${parametri.scala}`;

    const perAsl = new Map();
    for (const r of righe) {
      const a = perAsl.get(r.asl) ?? { asl: r.asl, dataset: 0, simulate: 0, prenotati: 0, slot: 0, pressPesata: 0 };
      a.dataset += r.dataset_settimana;
      a.simulate += r.simulate_settimana_scalate;
      a.prenotati += r.prenotati;
      a.slot += r.slot;
      a.pressPesata += (r.pressione ?? 0) * r.dataset_settimana;
      perAsl.set(r.asl, a);
    }
    const asl = [...perAsl.values()]
      .map((a) => ({ ...a, pressione: a.pressPesata / a.dataset, riempimento: a.prenotati / a.slot }))
      .sort((x, y) => y.pressione - x.pressione);
    corpoAsl.replaceChildren(...asl.map((a) =>
      riga(a.asl, tdNum(num(a.dataset)), tdNum(num(a.simulate)), tdNum(`${a.simulate >= a.dataset ? '+' : ''}${num((a.simulate / a.dataset - 1) * 100, 1)}%`),
        tdNum(pct(a.pressione)), barra(a.riempimento))));
    corpoDett.replaceChildren(...righe.map((r) =>
      riga(r.asl, r.prestazione, tdNum(num(r.dataset_settimana)), tdNum(num(r.simulate_settimana_scalate)), tdNum(pct(r.pressione)), tdNum(pct(r.riempimento_simulato)))));
  } catch (err) {
    messaggio(corpoAsl, 6, err.message);
  }
}

$('#centri-form').addEventListener('submit', (e) => {
  e.preventDefault();
  conBottone(e.target, caricaCentri);
});

// --- prenotazioni ---
async function caricaPrenotazioni() {
  const corpo = $('#pren-body');
  messaggio(corpo, 8, 'Caricamento…');
  const params = new URLSearchParams([...new FormData($('#pren-form'))].filter(([, v]) => v !== ''));
  params.set('limit', LIMITE_PREN);
  params.set('offset', offsetPren);
  try {
    const { totale, prenotazioni } = await api(`/prenotazioni?${params}`);
    $('#pren-totale').textContent = totale
      ? `${num(totale)} prenotazioni · ${num(offsetPren + 1)}–${num(offsetPren + prenotazioni.length)}`
      : '';
    $('#pren-prec').disabled = offsetPren === 0;
    $('#pren-succ').disabled = offsetPren + LIMITE_PREN >= totale;
    if (!prenotazioni.length) return messaggio(corpo, 8, 'Nessuna prenotazione con questi filtri');
    corpo.replaceChildren(...prenotazioni.map((p) =>
      riga(dataOra(p.starts_at), p.prestazione, p.struttura, p.medico, p.email,
        el('td', {}, el('span', { class: `badge ${p.tipo}` }, p.utente_prova ? 'loggata (prova)' : p.tipo)),
        p.status === 'booked' ? 'attiva' : 'disdetta',
        el('td', { class: 'id' }, p.id))));
  } catch (err) {
    messaggio(corpo, 8, err.message);
  }
}

$('#pren-form').addEventListener('submit', (e) => {
  e.preventDefault();
  offsetPren = 0;
  conBottone(e.target, caricaPrenotazioni);
});
$('#pren-prec').addEventListener('click', () => { offsetPren = Math.max(0, offsetPren - LIMITE_PREN); caricaPrenotazioni(); });
$('#pren-succ').addEventListener('click', () => { offsetPren += LIMITE_PREN; caricaPrenotazioni(); });

// --- slot liberi ---
let offsetSlot = 0;
const LIMITE_SLOT = 50;
const nomeMese = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

async function caricaSlot() {
  const corpo = $('#slot-body');
  messaggio(corpo, 7, 'Caricamento…');
  const params = new URLSearchParams([...new FormData($('#slot-form'))].filter(([, v]) => v !== ''));
  params.set('limit', LIMITE_SLOT);
  params.set('offset', offsetSlot);
  try {
    const { totale, slot, mesi, primi } = await api(`/slot/liberi?${params}`);
    $('#slot-totale').textContent = totale
      ? `${num(totale)} slot liberi · ${num(offsetSlot + 1)}–${num(offsetSlot + slot.length)}`
      : '';
    $('#slot-prec').disabled = offsetSlot === 0;
    $('#slot-succ').disabled = offsetSlot + LIMITE_SLOT >= totale;
    $('#slot-mesi').replaceChildren(...mesi.map((m) => riga(nomeMese(m.mese), tdNum(num(m.liberi)))));
    $('#slot-primi').replaceChildren(...primi.map((p) => riga(p.prestazione ?? p.specialty_id, dataOra(p.primo), tdNum(num(p.liberi)))));
    if (!slot.length) return messaggio(corpo, 7, 'Nessuno slot libero con questi filtri');
    corpo.replaceChildren(...slot.map((s) =>
      riga(dataOra(s.starts_at), s.prestazione ?? s.specialty_id, s.struttura ? `${s.struttura} (${s.comune})` : s.facility_id,
        s.asl ?? '–', s.medico ?? '–',
        el('td', {}, el('span', { class: `badge ${s.da_disdetta ? 'loggata' : 'fittizia'}` }, s.da_disdetta ? 'da disdetta' : 'agenda')),
        el('td', { class: 'id' }, s.id))));
  } catch (err) {
    messaggio(corpo, 7, err.message);
  }
}

$('#slot-form').addEventListener('submit', (e) => {
  e.preventDefault();
  offsetSlot = 0;
  conBottone(e.target, caricaSlot);
});
$('#slot-prec').addEventListener('click', () => { offsetSlot = Math.max(0, offsetSlot - LIMITE_SLOT); caricaSlot(); });
$('#slot-succ').addEventListener('click', () => { offsetSlot += LIMITE_SLOT; caricaSlot(); });

// --- test disdetta ---
function descriviEsitoPrenota(r) {
  const p = r.risultato_prenota;
  if (p.reallocated) return 'Prenota: slot riassegnato dalla lista d\'attesa a un utente reale';
  const o = p.offer;
  if (o?.offered) {
    const chi = o.patientId === r.target.patient_id ? 'all\'utente del target' : `a un altro utente reale (${o.patientId.slice(0, 8)}…), in attesa da più tempo`;
    return `Prenota: proposta di anticipo inviata ${chi}: ${o.daysSaved} giorni prima della sua prenotazione del ${dataOra(o.currentStartAt)}. `
      + `La vede in Prenota con Accetta / Rifiuta fino al ${dataOra(o.expiresAt)}.`;
  }
  return 'Prenota: slot tornato libero, nessun utente reale con una prenotazione successiva compatibile';
}

function nomePrestazione(id) {
  return catalogo?.prestazioni.find((p) => p.id === id)?.descrizione ?? id;
}
function nomeStruttura(id) {
  return catalogo?.strutture.find((s) => s.id === id)?.nome ?? id;
}

$('#prova-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const prestazione = new FormData(e.target).get('prestazione');
  const esito = $('#prova-esito');
  conBottone(e.target, async () => {
    try {
      const r = await api('/test/prenotazione-prova', {
        method: 'POST',
        body: JSON.stringify(prestazione ? { prestazione } : {}),
      });
      esito.textContent = `Prenotazione creata il ${dataOra(r.startAt)}\nID prenotazione: ${r.appointmentId}\n(copiala nel campo "ID prenotazione target" qui sotto per usarla come target)`;
      $('#disdici-form').elements.target_id.value = r.appointmentId;
    } catch (err) {
      esito.textContent = err.message;
    }
    esito.hidden = false;
  });
});

$('#disdici-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const dati = new FormData(e.target);
  const targetId = dati.get('target_id').trim();
  const categoria = dati.get('categoria');
  const box = $('#disdici-esito');
  conBottone(e.target, async () => {
    box.classList.remove('errore-box');
    try {
      const r = await api('/test/disdici-casuale', {
        method: 'POST',
        body: JSON.stringify({ ...(targetId ? { target_id: targetId } : {}), ...(categoria ? { categoria } : {}) }),
      });
      const d = r.disdetta;
      const t = r.target;
      box.replaceChildren(
        el('strong', {}, 'Prenotazione fittizia disdetta'),
        el('div', {}, `${nomePrestazione(d.specialty_id)} · ${nomeStruttura(d.facility_id)} · ${dataOra(d.starts_at)}`),
        el('div', {}, t.tipo === 'prenotazione'
          ? `Target: prenotazione loggata del ${dataOra(t.starts_at)} a ${nomeStruttura(t.facility_id)} → anticipo possibile di ${t.giorni_anticipo} giorni`
          : t.tipo === 'lista_attesa' ? `Target: lista d'attesa ${t.waiting_list_id}`
            : `Nessun utente reale con una visita di ${r.categoria}: disdetta comunque una visita fittizia`),
        el('div', {}, descriviEsitoPrenota(r)),
        el('div', { class: 'id' }, `slot ${d.slot_id}`),
      );
      caricaDisdette();
    } catch (err) {
      box.classList.add('errore-box');
      box.replaceChildren(el('div', {}, err.message));
    }
    box.hidden = false;
  });
});

// --- reset del database ---
function mostraReset(r) {
  const box = $('#reset-stato');
  if (!r || r.stato === 'mai_eseguito') { box.hidden = true; return; }
  const titolo = { in_corso: 'Reset in corso…', completato: 'Reset completato', errore: 'Reset non riuscito: nessun dato modificato' }[r.stato];
  box.classList.toggle('errore-box', r.stato === 'errore');
  box.replaceChildren(
    el('strong', {}, titolo),
    ...r.passi.map((passo, i) => el('div', {}, `${i < r.passo || r.stato === 'completato' ? '✓' : i === r.passo && r.stato === 'in_corso' ? '…' : '·'} ${passo}`)),
    ...(r.stato === 'completato' ? [el('div', {}, `Generati: ${r.dettagli.map((d) => `${d.anno} ${d.slot != null ? `${d.slot} slot, ` : ''}${d.prenotazioni} prenotazioni fittizie`).join(' · ')}`)] : []),
    ...(r.errore ? [el('div', {}, r.errore)] : []),
    el('div', { class: 'id' }, `avviato da ${r.admin} il ${dataOra(r.iniziato)}${r.finito ? `, finito il ${dataOra(r.finito)}` : ''}`),
  );
  box.hidden = false;
}
async function seguiReset() {
  const bottone = $('#reset-avvia');
  let r;
  do {
    r = await api('/test/reset');
    mostraReset(r);
    bottone.disabled = r.stato === 'in_corso';
    if (r.stato === 'in_corso') await new Promise((ok) => setTimeout(ok, 2000));
  } while (r.stato === 'in_corso');
  if (r.stato === 'completato') caricaDisdette();
}
$('#reset-avvia').addEventListener('click', async () => {
  const conferma = window.prompt('Il reset cancella TUTTE le prenotazioni (anche degli utenti reali) e rigenera quelle fittizie fino al 2028.\nScrivi RESET per confermare.');
  if (conferma !== 'RESET') return;
  const bottone = $('#reset-avvia');
  bottone.disabled = true;
  const box = $('#reset-stato');
  box.classList.remove('errore-box');
  box.replaceChildren(el('strong', {}, 'Reset in corso… (circa un minuto e mezzo, non chiudere la pagina)'));
  box.hidden = false;
  try {
    // In locale risponde subito ("in_corso") e si segue lo stato; su Vercel risponde a reset finito.
    const r = await api('/test/reset', { method: 'POST', body: JSON.stringify({ conferma: 'RESET' }) });
    mostraReset(r);
    if (r.stato === 'in_corso') await seguiReset();
    else if (r.stato === 'completato') caricaDisdette();
  } catch (err) {
    box.classList.add('errore-box');
    box.replaceChildren(el('div', {}, err.message));
  } finally {
    bottone.disabled = false;
  }
});

async function caricaDisdette() {
  const corpo = $('#disdette-body');
  try {
    const { disdette } = await api('/test/disdette');
    if (!disdette.length) return messaggio(corpo, 6, 'Nessuna disdetta di test');
    corpo.replaceChildren(...disdette.map(({ created_at, admin, esito }) =>
      riga(dataOra(created_at), admin ?? '–',
        `${nomePrestazione(esito.disdetta.specialty_id)} · ${nomeStruttura(esito.disdetta.facility_id)} · ${dataOra(esito.disdetta.starts_at)}`,
        esito.target.tipo === 'prenotazione' ? dataOra(esito.target.starts_at) : esito.target.tipo === 'lista_attesa' ? 'lista d\'attesa' : 'nessuno',
        tdNum(esito.target.giorni_anticipo != null ? `${esito.target.giorni_anticipo} gg` : '–'),
        esito.risultato_prenota.reallocated ? 'riassegnato' : esito.risultato_prenota.offer?.offered ? 'proposto' : 'libero')));
  } catch (err) {
    messaggio(corpo, 6, err.message);
  }
}

// --- avvio ---
async function avvia() {
  try {
    const { admin } = await api('/auth/me');
    $('#admin-nome').textContent = admin.username;
  } catch {
    return mostraLogin();
  }
  $('#login').hidden = true;
  $('#app').hidden = false;

  const formCentri = $('#centri-form');
  formCentri.elements.da.value ||= isoGiorno(1);
  formCentri.elements.a.value ||= isoGiorno(56);

  catalogo = await api('/catalogo');
  for (const select of document.querySelectorAll('.sel-prestazione')) {
    select.replaceChildren(select.options[0],
      ...catalogo.prestazioni.map((p) => el('option', { value: p.id }, `${p.descrizione} (${p.branca})`)));
  }
  const branche = [...new Set(catalogo.prestazioni.map((p) => p.branca))].sort();
  for (const select of document.querySelectorAll('.sel-branca')) {
    select.replaceChildren(select.options[0], ...branche.map((b) => el('option', { value: b },
      `${b.charAt(0).toUpperCase()}${b.slice(1)} (${catalogo.prestazioni.filter((p) => p.branca === b).map((p) => p.descrizione).join(', ')})`)));
  }
  for (const select of document.querySelectorAll('.sel-struttura')) {
    select.replaceChildren(select.options[0],
      ...catalogo.strutture.map((s) => el('option', { value: s.id }, `${s.nome} (${s.comune})`)));
  }

  caricaCentri();
  caricaConfronto();
}

token ? avvia() : mostraLogin();
