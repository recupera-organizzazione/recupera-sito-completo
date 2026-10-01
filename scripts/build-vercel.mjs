// Prepara vercel-out/ con i file statici del sito (serviti dalla CDN di Vercel):
//   /            web/ (landing, 404)          /design/       design/
//   /dashboard/  apps/dashboard/dist (build)  /prenota/      apps/prenota/public
//   /test-server/ apps/test-server/public (senza la copia di Prenota: su Vercel /prenota/ è l'app vera)
// Le API sono funzioni in api/ (vedi vercel.json).
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const radice = fileURLToPath(new URL('..', import.meta.url));
const out = `${radice}vercel-out`;
rmSync(out, { recursive: true, force: true });
if (!existsSync(`${radice}apps/dashboard/dist/index.html`)) throw new Error('Manca la build della dashboard: esegui prima npm run build');
cpSync(`${radice}web`, out, { recursive: true });
cpSync(`${radice}design`, `${out}/design`, { recursive: true });
cpSync(`${radice}apps/dashboard/dist`, `${out}/dashboard`, { recursive: true });
cpSync(`${radice}apps/prenota/public`, `${out}/prenota`, { recursive: true });
cpSync(`${radice}apps/test-server/public`, `${out}/test-server`, {
  recursive: true,
  filter: (sorgente) => !sorgente.includes('/public/prenota'),
});
console.log('vercel-out pronto');
