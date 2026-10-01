// Dizionario italiano centralizzato per le stringhe UI introdotte col refactor.
// Regola: i nuovi componenti usano STR (niente literal sparsi); i mock storici
// restano dov sono, etichettati demo (AGENTS.md §1). Estendibile ad altre lingue.

export const STR = {
  login: {
    eyebrow: 'Centro operativo · Regione Puglia',
    title: 'Accesso riservato',
    subtitle: 'Area operatori CUP — accedi con le credenziali dell’account amministratore.',
    username: 'Nome utente',
    password: 'Password',
    submit: 'Accedi',
    submitting: 'Accesso in corso…',
    checking: 'Verifica della sessione in corso…',
    hint: 'Account amministratore unico. Le credenziali sono verificate dal server, mai nel browser.',
  },
  topbar: {
    logout: 'Esci',
    fallbackWho: 'operatore',
  },
};

export function salutoPerOra(ora) {
  if (ora < 6) return 'Buonanotte';
  if (ora < 12) return 'Buongiorno';
  if (ora < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}
