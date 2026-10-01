import { useMutation, useQuery } from '@tanstack/react-query';
import {
  getAsl,
  getCancellazioni,
  getHotspot,
  getPrestazioni,
  getRiassegnazioni,
  getSerie,
  postProiezione,
} from '../lib/api.js';

// Hook dei pannelli. Tutti con loading/error/empty (obbligo AGENTS.md §5.3).
// Nessuna UI qui: solo queryKey + fetcher; il backend risponde con envelope { data }.

export function useAsl() {
  return useQuery({ queryKey: ['asl'], queryFn: getAsl });
}

export function usePrestazioni(q) {
  return useQuery({
    queryKey: ['prestazioni', q || ''],
    queryFn: () => getPrestazioni(q),
  });
}

export function useHotspot(settimana) {
  return useQuery({
    queryKey: ['hotspot', settimana || 'default'],
    queryFn: () => getHotspot(settimana),
  });
}

export function useSerie({ asl = '', prestazione = '' } = {}) {
  return useQuery({
    queryKey: ['serie', asl, prestazione],
    queryFn: () => getSerie({ asl, prestazione }),
  });
}

export function useCancellazioni({ da = '', a = '' } = {}) {
  return useQuery({
    queryKey: ['cancellazioni', da, a],
    queryFn: () => getCancellazioni({ da, a }),
  });
}

export function useRiassegnazioni(limit = 10) {
  return useQuery({
    queryKey: ['riassegnazioni', limit],
    queryFn: () => getRiassegnazioni(limit),
  });
}

export function useProiezione() {
  // POST /simulatori/proiezione { da_asl, a_asl, ore } — validazione in api.js (2..20, da!=a)
  return useMutation({
    mutationFn: postProiezione,
  });
}
