// Avvia le tre app e il gateway in un solo terminale.
//   node scripts/avvia.mjs        sviluppo: riavvio automatico + Vite con HMR per la dashboard
//   node scripts/avvia.mjs --prod produzione locale: gateway serve apps/dashboard/dist (npm run build)
// Le porte interne si cambiano con le variabili qui sotto; dotenv nelle app non sovrascrive
// PORT già impostata, quindi il PORT dei loro .env viene ignorato quando partono da qui.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env di radice facoltativo (vedi .env.example): solo porte, nessun segreto.
const envRadice = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envRadice)) process.loadEnvFile(envRadice);

const prod = process.argv.includes('--prod');
const porte = {
  gateway: process.env.PORT ?? '3000',
  dashboardApi: process.env.DASHBOARD_API_PORT ?? '3101',
  prenota: process.env.PRENOTA_PORT ?? '3102',
  testServer: process.env.TEST_SERVER_PORT ?? '3103',
  vite: process.env.DASHBOARD_VITE_PORT ?? '5180',
};
const script = prod ? 'start' : 'dev';

const processi = [
  { nome: 'dashboard-api', cartella: 'apps/dashboard/backend', comando: ['run', script], env: { PORT: porte.dashboardApi } },
  { nome: 'prenota', cartella: 'apps/prenota', comando: ['run', script], env: { PORT: porte.prenota } },
  { nome: 'test-server', cartella: 'apps/test-server', comando: ['run', script], env: { PORT: porte.testServer } },
  ...(prod ? [] : [{ nome: 'dashboard-vite', cartella: 'apps/dashboard', comando: ['run', 'dev', '--', '--port', porte.vite, '--strictPort'], env: {} }]),
  {
    nome: 'gateway',
    cartella: '.',
    comando: ['run', prod ? 'start:gateway' : 'dev:gateway'],
    env: {
      PORT: porte.gateway,
      DASHBOARD_API_URL: `http://localhost:${porte.dashboardApi}`,
      PRENOTA_URL: `http://localhost:${porte.prenota}`,
      TEST_SERVER_URL: `http://localhost:${porte.testServer}`,
      ...(prod ? {} : { DASHBOARD_VITE_URL: `http://localhost:${porte.vite}` }),
    },
  },
];

const radice = fileURLToPath(new URL('..', import.meta.url));
const figli = processi.map(({ nome, cartella, comando, env }) => {
  const figlio = spawn('npm', comando, {
    cwd: `${radice}${cartella}`,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  const prefisso = `[${nome}]`.padEnd(17);
  const stampa = (flusso) => (dati) => {
    for (const riga of String(dati).split('\n')) if (riga.trim()) flusso.write(`${prefisso}${riga}\n`);
  };
  figlio.stdout.on('data', stampa(process.stdout));
  figlio.stderr.on('data', stampa(process.stderr));
  figlio.on('exit', (codice) => console.log(`${prefisso}terminato (codice ${codice})`));
  return figlio;
});

console.log(`reCUPera: apri http://localhost:${porte.gateway} (Ctrl+C per fermare tutto)`);
const ferma = () => {
  figli.forEach((figlio) => figlio.kill('SIGTERM'));
  process.exit(0);
};
process.on('SIGINT', ferma);
process.on('SIGTERM', ferma);
