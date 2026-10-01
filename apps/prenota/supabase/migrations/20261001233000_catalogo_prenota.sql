-- Catalogo per le liste di Prenota: visite (branche, es. "mammografia", con le prestazioni esatte)
-- e sedi ("Nome - Comune", con l'ASL). Prenota confronta prestazione e sede come testo esatto,
-- quindi le liste usano gli stessi id dei record (test_server.prestazioni.branca, test_server.strutture.id).
create or replace function public.prenota_catalogo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'specialties', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.branca, 'label', initcap(b.branca), 'prestazioni', b.prestazioni) order by b.branca)
      from (select branca, jsonb_agg(descrizione order by descrizione) prestazioni
            from test_server.prestazioni group by branca) b), '[]'::jsonb),
    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'comune', s.comune,
                                          'aslSigla', a.sigla, 'aslNome', a.nome) order by a.nome, s.nome)
      from test_server.strutture s join test_server.asl a on a.id = s.asl_id), '[]'::jsonb));
$$;

revoke all on function public.prenota_catalogo() from public, anon, authenticated;
grant execute on function public.prenota_catalogo() to service_role;
