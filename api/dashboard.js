// Funzione Vercel: /dashboard/api/* → backend Express della dashboard (apps/dashboard/backend)
// senza il prefisso /dashboard, come fa il gateway in locale.
import app from '../apps/dashboard/backend/src/index.js';

export default function handler(req, res) {
  req.url = req.url.replace(/^\/dashboard(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
