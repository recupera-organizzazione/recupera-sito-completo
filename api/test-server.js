// Funzione Vercel: /test-server/api/* → app Express del test server (apps/test-server/src/app.js)
// senza il prefisso /test-server, come fa il gateway in locale.
import { app } from '../apps/test-server/src/app.js';

export default function handler(req, res) {
  // Solo tramite le rewrite di vercel.json: le chiamate dirette a /api/test-server non sono previste.
  if (!/^\/test-server(\/|\?|$)/.test(req.url)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: { code: 'non_trovato', message: 'Risorsa non trovata' } }));
  }
  req.url = req.url.replace(/^\/test-server(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
