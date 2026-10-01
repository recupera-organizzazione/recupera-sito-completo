// Gateway del sito completo: un solo indirizzo per landing e le tre app.
//   /              landing (web/)
//   /design/       design system condiviso (design/)
//   /dashboard/    dashboard React (build in apps/dashboard/dist, oppure Vite in sviluppo)
//   /dashboard/api backend della dashboard (Express, apps/dashboard/backend)
//   /prenota/      app Prenota (Express, apps/prenota)
//   /test-server/  finto CUP (Express, apps/test-server)
// Le app restano processi separati (versioni di Express diverse e /api/v1 in comune
// tra dashboard e test-server): il gateway le inoltra togliendo il prefisso.
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';

const radice = fileURLToPath(new URL('..', import.meta.url));
const porta = Number(process.env.PORT ?? 3000);
const destinazioni = {
  dashboardApi: process.env.DASHBOARD_API_URL ?? 'http://localhost:3101',
  dashboardVite: process.env.DASHBOARD_VITE_URL, // solo in sviluppo (npm run dev)
  prenota: process.env.PRENOTA_URL ?? 'http://localhost:3102',
  testServer: process.env.TEST_SERVER_URL ?? 'http://localhost:3103',
};

// App non avviata: errore leggibile invece della pagina vuota del proxy.
const nonRaggiungibile = (nome) => ({
  error: (err, req, res) => {
    if (!res.writeHead || res.headersSent) return res.destroy?.();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'servizio_non_raggiungibile', message: `${nome} non risponde (${err.code ?? err.message})` } }));
  },
});

const app = express();
app.disable('x-powered-by');

// I frontend usano percorsi relativi: /prenota va servito come /prenota/.
app.use((req, res, next) => {
  const [percorso, query = ''] = req.originalUrl.split('?');
  if (['/dashboard', '/prenota', '/test-server'].includes(percorso)) {
    return res.redirect(301, `${percorso}/${query ? `?${query}` : ''}`);
  }
  next();
});

app.use('/dashboard/api', createProxyMiddleware({ target: `${destinazioni.dashboardApi}/api`, on: nonRaggiungibile('Il backend della dashboard') }));
app.use('/prenota', createProxyMiddleware({ target: destinazioni.prenota, on: nonRaggiungibile('Prenota') }));
app.use('/test-server', createProxyMiddleware({ target: destinazioni.testServer, on: nonRaggiungibile('Il test server') }));

let proxyVite;
if (destinazioni.dashboardVite) {
  // Vite gira con base /dashboard/: il percorso resta intero, websocket incluso per l'HMR.
  proxyVite = createProxyMiddleware({ target: destinazioni.dashboardVite, pathFilter: '/dashboard', ws: true, on: nonRaggiungibile('Vite (dashboard)') });
  app.use(proxyVite);
} else {
  const build = `${radice}apps/dashboard/dist`;
  if (!existsSync(`${build}/index.html`)) {
    console.warn('AVVISO: manca apps/dashboard/dist, esegui `npm run build` per servire la dashboard.');
  }
  app.use('/dashboard', express.static(build));
  // Fallback della single page app: ogni /dashboard/* senza file torna a index.html.
  app.get('/dashboard/{*resto}', (req, res, next) => (existsSync(`${build}/index.html`) ? res.sendFile(`${build}/index.html`) : next()));
}

app.use('/design', express.static(`${radice}design`));
app.use(express.static(`${radice}web`));

app.use((req, res) => {
  res.status(404).sendFile(`${radice}web/404.html`);
});

const server = app.listen(porta, () => {
  console.log(`reCUPera sito completo su http://localhost:${porta}`);
});
if (proxyVite) server.on('upgrade', proxyVite.upgrade);
