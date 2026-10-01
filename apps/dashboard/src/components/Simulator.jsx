import { useEffect, useState } from 'react';
import { useHotspot, useProiezione } from '../hooks/useDashboard.js';

// Simulatore: POST /simulatori/proiezione con le ASL reali della settimana più recente.
// Il risultato è un'euristica del backend, dichiarata come stima.

export default function Simulator() {
  const { data } = useHotspot();
  const asl = data?.data ?? [];
  const [da, setDa] = useState('');
  const [a, setA] = useState('');
  const [ore, setOre] = useState(8);
  const proiezione = useProiezione();
  const esito = proiezione.data?.data;

  // Default: dalla ASL meno sotto pressione a quella più sotto pressione.
  useEffect(() => {
    if (asl.length > 1 && !da && !a) {
      setA(asl[0].sigla);
      setDa(asl[asl.length - 1].sigla);
    }
  }, [asl, da, a]);

  return (
    <article className="panel simulator-panel" id="simulatore">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Proiezione stimata</p>
          <h3>Sposta risorse</h3>
        </div>
        <span className="simulator-badge">Stima</span>
      </div>
      <p className="simulator-copy">Sposta ore di specialista da una zona con meno pressione verso una zona in sofferenza.</p>
      <label className="field-label" htmlFor="from">Da</label>
      <select id="from" value={da} onChange={(e) => setDa(e.target.value)}>
        {asl.map((r) => (
          <option value={r.sigla} key={r.asl_id}>{r.sigla} · {r.nome.replace(/^ASL /, '')} ({Math.round(r.fuori_tmax_pct * 100)}% oltre tempo max)</option>
        ))}
      </select>
      <label className="field-label" htmlFor="to">A</label>
      <select id="to" value={a} onChange={(e) => setA(e.target.value)}>
        {asl.map((r) => (
          <option value={r.sigla} key={r.asl_id}>{r.sigla} · {r.nome.replace(/^ASL /, '')} ({r.attesa_stimata_gg} gg stimati)</option>
        ))}
      </select>
      <div className="range-label"><span>Ore settimanali</span><strong>{ore} ore</strong></div>
      <input id="hours" type="range" min="2" max="20" value={ore} aria-label="Ore settimanali" onChange={(e) => setOre(Number(e.target.value))} />
      {esito && (
        <div className="simulation-result">
          <span>Nuova attesa stimata {esito.a_asl.sigla}</span>
          <strong>{esito.nuova_attesa_stimata_gg} giorni <small>↓ {esito.riduzione_stimata_gg} giorni</small></strong>
        </div>
      )}
      {proiezione.isError && <p className="panel-error" role="alert">{proiezione.error.message}</p>}
      <button className="primary-button" type="button" disabled={!da || !a || proiezione.isPending}
        onClick={() => proiezione.mutate({ da_asl: da, a_asl: a, ore })}>
        {proiezione.isPending ? 'Calcolo…' : 'Calcola scenario'} <span>→</span>
      </button>
      {esito && <p className="panel-note">{esito.nota}</p>}
    </article>
  );
}
