// Funzione Vercel: /test-server/api/* → app Express del test server (apps/test-server/src/app.js)
// senza il prefisso /test-server, come fa il gateway in locale.
import { app } from '../apps/test-server/src/app.js';

export default function handler(req, res) {
  req.url = req.url.replace(/^\/test-server(?=\/|\?|$)/, '') || '/';
  return app(req, res);
}
