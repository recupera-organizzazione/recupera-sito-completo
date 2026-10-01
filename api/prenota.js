// Funzione Vercel: /prenota/api/*, /prenota/health, /prenota/client-config → app Express di Prenota
// (apps/prenota/src/server.js) senza il prefisso /prenota, come fa il gateway in locale.
import app from '../apps/prenota/src/server.js';

export default function handler(req, res) {
  req.url = req.url.replace(/^\/prenota(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
