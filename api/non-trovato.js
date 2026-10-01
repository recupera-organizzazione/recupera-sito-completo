// Funzione Vercel: indirizzi che non corrispondono a nessun file o API → pagina 404 con stato 404.
// (Senza questa regola Vercel rimanderebbe ogni indirizzo sconosciuto alla landing con stato 200.)
import { readFileSync } from 'node:fs';

const pagina = readFileSync(new URL('../web/404.html', import.meta.url), 'utf8');

export default function handler(req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(pagina);
}
