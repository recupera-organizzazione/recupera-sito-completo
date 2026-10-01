// Sincronizza il dataset "Monitoraggio tempi di attesa" (dati.puglia.it) nelle tabelle della dashboard.
// Legge l'elenco delle risorse CSV dall'API CKAN, scarica dal DataStore quelle nuove o modificate
// e le passa a public.sincronizza_settimana_dataset (vedi migrazione 20261001180000).
// Chiamata ogni giorno da pg_cron; ?forza=1 riscarica tutte le settimane.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CKAN = 'https://dati.puglia.it/ckan/api/3/action';
const DATASET = 'monitoraggio-tempi-di-attesa';

async function ckan(azione: string, parametri: Record<string, string>) {
  const risposta = await fetch(`${CKAN}/${azione}?${new URLSearchParams(parametri)}`);
  const corpo = await risposta.json();
  if (!corpo.success) throw new Error(`CKAN ${azione}: ${JSON.stringify(corpo.error)}`);
  return corpo.result;
}

Deno.serve(async (req) => {
  const forza = new URL(req.url).searchParams.get('forza') === '1';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  try {
    const pacchetto = await ckan('package_show', { id: DATASET });
    const risorse = pacchetto.resources.filter(
      (r: { format: string; datastore_active: boolean }) => r.format?.toUpperCase() === 'CSV' && r.datastore_active,
    );

    const { data: fonti, error } = await supabase.from('dataset_fonte').select('resource_id, ultima_modifica');
    if (error) throw error;
    const giaSincronizzate = new Map(fonti.map((f) => [f.resource_id, f.ultima_modifica]));

    const esiti = [];
    for (const risorsa of risorse) {
      const ultimaModifica = risorsa.last_modified ?? risorsa.metadata_modified ?? null;
      if (!forza && giaSincronizzate.has(risorsa.id)) {
        const nota = giaSincronizzate.get(risorsa.id);
        // null = importata a mano dal CSV: la consideriamo aggiornata
        if (nota === null || nota === ultimaModifica) continue;
      }
      const { records } = await ckan('datastore_search', { resource_id: risorsa.id, limit: '5000' });
      const { data, error: errRpc } = await supabase.rpc('sincronizza_settimana_dataset', {
        p_fonte: { resource_id: risorsa.id, ultima_modifica: ultimaModifica },
        p_righe: records,
      });
      esiti.push(errRpc ? { risorsa: risorsa.name, errore: errRpc.message } : { risorsa: risorsa.name, ...data });
    }

    return Response.json({ risorse: risorse.length, sincronizzate: esiti.length, esiti });
  } catch (err) {
    return Response.json({ errore: String(err) }, { status: 502 });
  }
});
