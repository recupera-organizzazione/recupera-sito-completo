// Funzione Vercel: /prenota/api/*, /prenota/health, /prenota/client-config → app Express di Prenota
// (apps/prenota/src/server.js) senza il prefisso /prenota, come fa il gateway in locale.
import app from '../apps/prenota/src/server.js';

export default function handler(req, res) {
  // Solo tramite le rewrite di vercel.json: le chiamate dirette a /api/prenota non sono previste.
  if (!/^\/prenota(\/|\?|$)/.test(req.url)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: { code: 'non_trovato', message: 'Risorsa non trovata' } }));
  }
  req.url = req.url.replace(/^\/prenota(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
