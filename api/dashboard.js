// Funzione Vercel: /dashboard/api/* → backend Express della dashboard (apps/dashboard/backend)
// senza il prefisso /dashboard, come fa il gateway in locale.
import app from '../apps/dashboard/backend/src/index.js';

export default function handler(req, res) {
  // Solo tramite le rewrite di vercel.json: le chiamate dirette a /api/dashboard non sono previste.
  if (!/^\/dashboard(\/|\?|$)/.test(req.url)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: { code: 'non_trovato', message: 'Risorsa non trovata' } }));
  }
  req.url = req.url.replace(/^\/dashboard(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
