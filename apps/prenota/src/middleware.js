const { supabase } = require('./supabase');

async function authenticate(req, res, next) {
  const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Token Supabase mancante.' });
  try {
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data.user) return res.status(401).json({ error: 'Token Supabase non valido o scaduto.' });
    req.user = { uid: data.user.id, role: data.user.app_metadata?.role || 'patient' };
    next();
  } catch {
    return res.status(401).json({ error: 'Token Supabase non valido o scaduto.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Permessi insufficienti.' });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.name === 'ZodError') return res.status(400).json({ error: 'Dati non validi.', details: err.issues });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Errore interno.' });
}

module.exports = { authenticate, requireRole, errorHandler };
