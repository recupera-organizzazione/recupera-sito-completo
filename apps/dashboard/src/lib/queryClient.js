import { QueryClient } from '@tanstack/react-query';

// Defaults dashboard admin: dati semi-statici (CSV settimanale), niente refetch aggressivo.
// - staleTime 30s: evita refetch a ogni mount delle card
// - refetchInterval 60s: aggiornamento quasi-real-time (il backend interroga il DB
//   a ogni richiesta, senza cache server; niente Realtime push per ora —
//   polling leggero via backend con service_role, nessun dato paziente esposto)
// - retry 1: backend locale/Supabase può essere down, mostra subito error fallback (obbligo AGENTS §5.3)
// - refetchOnWindowFocus false: evita curl inutili su Supabase
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchInterval: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
