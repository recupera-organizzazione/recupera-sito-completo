import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

// API versioning
app.use('/api/v1', apiRoutes);
// Alias senza versione (compatibilità mappa endpoint README: /api/health)
app.get('/api/health', (_req, res) => res.redirect(307, '/api/v1/health'));

// 404 Handler (stesso shape { error: { code, message } } delle route)
app.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `Endpoint non trovato: ${req.path}` } });
});

export default app;

app.listen(PORT, () => {
  console.log(`ReCUPera Backend API in esecuzione sulla porta ${PORT} (Supabase: ${process.env.SUPABASE_URL})`);
});
