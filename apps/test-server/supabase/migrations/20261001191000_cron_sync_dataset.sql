-- Sincronizzazione giornaliera del dataset dati.puglia.it: pg_cron chiama la Edge Function sync-dataset
-- ogni giorno alle 04:00 UTC. La chiave per chiamarla (anon, pubblica) sta nel Vault con nome
-- 'sync_dataset_anon_key', creata a parte con vault.create_secret: non è nel repo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-dataset-puglia',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://jjkxvbjwruobclgwhtdt.supabase.co/functions/v1/sync-dataset',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sync_dataset_anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
