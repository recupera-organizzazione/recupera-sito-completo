import express from 'express';
import { pool } from './db.js';
import { gestisciErrori, ApiError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { catalogoRouter } from './routes/catalogo.js';
import { prenotaRouter } from './routes/prenota.js';
import { prenotazioniRouter } from './routes/prenotazioni.js';
import { slotRouter } from './routes/slot.js';
import { statisticheRouter } from './routes/statistiche.js';
import { testRouter } from './routes/test.js';

export const app = express();
app.disable('x-powered-by');
// Dietro il proxy di Vercel l'IP del client arriva in X-Forwarded-For (limite tentativi di login).
if (process.env.VERCEL) app.set('trust proxy', 1);

// CORS solo per pagine aperte in locale (es. Live Server di VS Code sulla porta 5500).
app.use((req, res, next) => {
  const origine = req.get('origin');
  if (origine && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine)) {
    res.set({
      'Access-Control-Allow-Origin': origine,
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      Vary: 'Origin',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Design system condiviso del sito completo (cartella design/ nella radice del monorepo),
// anche per la copia di Prenota su /prenota che lo chiede con percorso relativo.
app.use(['/design', '/prenota/design'], express.static(new URL('../../../design', import.meta.url).pathname));

// Frontend di Prenota con le sue API (vedi routes/prenota.js); i percorsi relativi richiedono la "/" finale.
app.use('/prenota', (req, res, next) => (req.originalUrl === '/prenota' ? res.redirect(301, '/prenota/') : next()));
app.use('/prenota', prenotaRouter);

// Frontend di test (public/index.html)
app.use(express.static(new URL('../public', import.meta.url).pathname));

app.get('/api/v1/health', async (req, res) => {
  await pool.query('select 1');
  res.json({ ok: true });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/catalogo', catalogoRouter);
app.use('/api/v1/prenotazioni', prenotazioniRouter);
app.use('/api/v1/slot', slotRouter);
app.use('/api/v1/statistiche', statisticheRouter);
app.use('/api/v1/test', testRouter);

app.use((req, res) => {
  throw new ApiError(404, 'non_trovato', `${req.method} ${req.path} non esiste`);
});
app.use(gestisciErrori);
