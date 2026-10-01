-- Collegamento al dataset ufficiale "Monitoraggio tempi di attesa" (dati.puglia.it, CKAN DataStore).
-- La Edge Function sync-dataset scarica ogni settimana pubblicata e la passa a
-- public.sincronizza_settimana_dataset, che aggiorna le tabelle della dashboard
-- (public.prestazione, public.rilevazione_settimanale). Così una settimana nuova o una correzione
-- della Regione arriva in automatico alla dashboard (job pg_cron giornaliero).
-- Legenda ufficiale: *_TMAX = prenotazioni con appuntamento ENTRO il tempo massimo della classe.

-- Una riga per risorsa CSV del dataset: quale settimana copre e quando è stata sincronizzata.
create table public.dataset_fonte (
  resource_id text primary key,
  settimana text not null unique,
  anno int not null,
  inizio date,
  righe int not null,
  ultima_modifica text,
  sincronizzato_at timestamptz not null default now()
);
alter table public.dataset_fonte enable row level security;
create policy "Lettura pubblica fonti dataset" on public.dataset_fonte
  for select to anon, authenticated using (true);

-- Righe = record del DataStore CKAN (chiavi come nel CSV: ASL, ANNO, ID_PRESTAZIONE, ...).
-- Prestazione cercata per ID ministeriale, poi per descrizione (6 righe hanno ID vuoto);
-- la descrizione esistente non viene sovrascritta (è UNIQUE e cambia grafia tra gli anni).
create function public.sincronizza_settimana_dataset(p_fonte jsonb, p_righe jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mesi constant text[] := array['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO',
                                'AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'];
  r jsonb;
  v_sett text;
  v_anno int;
  v_inizio date;
  v_asl text;
  v_desc text;
  v_idp int;
  v_pid int;
  scritte int := 0;
  scartate int := 0;
begin
  for r in select * from jsonb_array_elements(p_righe) loop
    v_sett := upper(trim(r->>'SETTIMANA_INDICE'));
    v_anno := (r->>'ANNO')::numeric::int;
    v_asl := trim(r->>'ASL');
    v_desc := nullif(trim(r->>'DESC_PRESTAZIONE'), '');
    if v_sett is null or v_desc is null or not exists (select 1 from asl where id = v_asl) then
      scartate := scartate + 1;
      continue;
    end if;
    -- ID_PRESTAZIONE è testo: a volte vuoto o un intervallo ("66 - 67"), allora vale la descrizione.
    v_idp := case when trim(r->>'ID_PRESTAZIONE') ~ '^[0-9]+$' then trim(r->>'ID_PRESTAZIONE')::int end;

    v_pid := null;
    if v_idp is not null then
      select id into v_pid from prestazione where id_prestazione = v_idp;
    end if;
    if v_pid is null then
      select id into v_pid from prestazione where lower(descrizione) = lower(v_desc) limit 1;
    end if;
    if v_pid is null then
      insert into prestazione (id_prestazione, codice, descrizione)
      values (v_idp, nullif(trim(r->>'COD_PRESTAZIONE'), ''), v_desc)
      returning id into v_pid;
    end if;

    insert into rilevazione_settimanale (asl_id, prestazione_id, anno, settimana, prenotazioni, da_garantire,
                                         b_tot, b_fuori_tmax, d_tot, d_fuori_tmax, p_tot, p_fuori_tmax)
    values (v_asl, v_pid, v_anno, v_sett,
            (nullif(r->>'PRENOTAZIONI', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_B', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_B_TMAX', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_D', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_D_TMAX', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_P', ''))::numeric::int,
            (nullif(r->>'PRENOTAZIONI_DAGARANTIRE_P_TMAX', ''))::numeric::int)
    on conflict (asl_id, prestazione_id, settimana) do update set
      anno = excluded.anno, prenotazioni = excluded.prenotazioni, da_garantire = excluded.da_garantire,
      b_tot = excluded.b_tot, b_fuori_tmax = excluded.b_fuori_tmax,
      d_tot = excluded.d_tot, d_fuori_tmax = excluded.d_fuori_tmax,
      p_tot = excluded.p_tot, p_fuori_tmax = excluded.p_fuori_tmax;
    scritte := scritte + 1;
  end loop;

  if scritte = 0 then
    raise exception 'Nessuna riga valida nella risorsa %', p_fonte->>'resource_id';
  end if;

  -- "07-11 OTTOBRE 2024" -> 2024-10-07 (null se il formato cambia)
  begin
    v_inizio := make_date(v_anno, array_position(mesi, split_part(v_sett, ' ', 2)),
                          split_part(split_part(v_sett, ' ', 1), '-', 1)::int);
  exception when others then
    v_inizio := null;
  end;

  insert into dataset_fonte (resource_id, settimana, anno, inizio, righe, ultima_modifica, sincronizzato_at)
  values (p_fonte->>'resource_id', v_sett, v_anno, v_inizio, scritte, p_fonte->>'ultima_modifica', now())
  on conflict (resource_id) do update set
    settimana = excluded.settimana, anno = excluded.anno, inizio = excluded.inizio, righe = excluded.righe,
    ultima_modifica = excluded.ultima_modifica, sincronizzato_at = excluded.sincronizzato_at;

  return jsonb_build_object('settimana', v_sett, 'inizio', v_inizio, 'righe', scritte, 'scartate', scartate);
end $$;

revoke all on function public.sincronizza_settimana_dataset(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizza_settimana_dataset(jsonb, jsonb) to service_role;

-- La settimana già importata dal CSV viene registrata come fonte, così la sync non la riscarica.
insert into public.dataset_fonte (resource_id, settimana, anno, inizio, righe, ultima_modifica)
select '26096f59-111e-41ec-a726-281d1dd2dbdf', '07-11 OTTOBRE 2024', 2024, date '2024-10-07', count(*), null
from public.rilevazione_settimanale where settimana = '07-11 OTTOBRE 2024'
on conflict do nothing;
