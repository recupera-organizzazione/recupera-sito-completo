-- Fix della sync: in tre risorse del dataset (03-07 luglio 2023, 17-21 aprile 2023, 13-17 luglio 2020)
-- l'anno in SETTIMANA_INDICE aumenta di uno a ogni riga, quindi ogni riga diventava una settimana diversa.
-- L'etichetta della settimana ora usa l'anno della colonna ANNO.

create or replace function public.sincronizza_settimana_dataset(p_fonte jsonb, p_righe jsonb)
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
    v_anno := (r->>'ANNO')::numeric::int;
    -- In alcune risorse l'anno finale di SETTIMANA_INDICE cresce riga per riga (2023, 2024, ...):
    -- si usa sempre ANNO, che è corretto.
    v_sett := regexp_replace(upper(trim(r->>'SETTIMANA_INDICE')), '\s*\d{4}$', '') || ' ' || v_anno;
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

-- Etichette delle fonti corrette con l'anno giusto; poi via le righe importate con un'etichetta
-- che non corrisponde a nessuna fonte (la sync con ?forza=1 le reimporta tutte corrette).
update public.dataset_fonte set settimana = regexp_replace(settimana, '\s*\d{4}$', '') || ' ' || anno
where settimana !~ (anno::text || '$');

delete from public.rilevazione_settimanale r
where not exists (select 1 from public.dataset_fonte f where f.settimana = r.settimana);
